# 数据库工作流（原生 node-pg，无 ORM）

本文解释本仓库 PostgreSQL 数据访问的三个环节：连接管理、表结构初始化、业务查询的书写约定。

## 一、技术选型

- 驱动：[node-postgres（pg）](https://node-postgres.com/)，无 ORM、直接写 SQL。
- 连接池：[server/src/db/index.ts](../server/src/db/index.ts) 创建全局唯一 `pg.Pool`（参数来自环境变量，见 `db.config.ts`）。
- SQL：repository 层直接书写参数化 SQL（`$1` 占位符传参），杜绝字符串拼接注入。

### SQL 参数化：`$n` 占位符的使用边界

node-postgres 用 `$1`、`$2`… 传值，但有严格边界：**`$n` 只能出现在「值（value）」位置；表名、列名、模式名等「标识符（identifier）」位置不能参数化，SQL 关键字同样不能**。

| 位置 | 示例 | `$n` 可用 |
|---|---|---|
| WHERE 等号右边 | `WHERE table_name = $1` | ✅ |
| 比较 / IN 值列表 | `WHERE id IN ($1, $2)` | ✅ |
| INSERT 的 VALUES | `VALUES ($1, $2)` | ✅ |
| LIMIT / OFFSET | `LIMIT $1` | ✅（PG 支持参数化 LIMIT） |
| SET 等号右边 | `SET done = $1` | ✅ |
| 函数参数 | `WHERE lower(email) = lower($1)` | ✅ |
| UPDATE / FROM 后的表名 | `UPDATE todos SET …` | ❌ 标识符位置 |
| SELECT / ORDER BY / GROUP BY 后的列名 | `SELECT id … ORDER BY id` | ❌ 标识符位置 |
| ALTER TABLE / ALTER COLUMN 后的对象名 | `ALTER TABLE users …` | ❌ 标识符位置 |
| SET / ALTER 等号左边的列名 | `SET uid = …` | ❌ 标识符位置 |

判别一句话：**`$n` 替代的是「一个具体的值」，不是「一个名字」**。函数调用也不能参数化——`gen_random_uuid()` 一旦作为参数传入，就变成字符串字面量 `'gen_random_uuid()'`（带引号），不再是函数执行。

标识符位置怎么传？本仓库对**迁移脚本**（[server/src/db/sql/migrate/](../server/src/db/sql/migrate/)）用「模板占位符 + 代码内白名单」方案：

- SQL 模板里写 `__TABLE__` / `__COLUMN__` / `__VALUE_EXPR__` / `__WHERE_CLAUSE__` 等占位符；
  调用方传**裸键**（`TABLE`、`COLUMN`…），[scripts/db-init.js](../scripts/db-init.js) 的 `renderSql()`
  内部用 \`\`__${k}__\`\` 包裹后 `replaceAll`——三方约定：**模板带双下划线、调用方不带、函数负责包**；
- 只按硬编码白名单（`IDENTITY_COLUMNS`）替换，不接用户输入，无注入面；
- 值位置仍然走 `$n` 参数（如 `probe-soft-delete.sql` 的 `table_name = $1`、回填的 `LIMIT $1`）。

migrate/ 目录四个文件的职责（探测 → 计数 → 回填 → 收紧，由 `backfillIdentityColumns()` 串起来）：

| 文件 | 职责 | 值来源 |
|---|---|---|
| `probe-soft-delete.sql` | 探测表是否有 `is_deleted` 列（有才拼软删过滤） | `$1` 表名（值位置） |
| `count-missing.sql` | 统计 `uid/user_id IS NULL` 未删行数，0 则整表跳过 | 模板 `__TABLE__` / `__WHERE_CLAUSE__` |
| `backfill-batch.sql` | 单批回填（`WHERE ... LIMIT ... FOR UPDATE SKIP LOCKED`），脚本循环到清零 | 模板 + `LIMIT $1` 参数 |
| `set-not-null.sql` | 回填清零后才收紧 `SET NOT NULL` | 模板 `__TABLE__` / `__COLUMN__` |

坏例子（把标识符 / 函数调用当参数）：

```js
// ❌ table/column 是标识符、gen_random_uuid() 是函数调用，均不能参数化；
//    传参后列名替换不进 SQL、函数变成字符串字面量、LIMIT $4 倒是合法——三种混在一起必错
await pool.query(backfillBatchSql, [table, column, 'gen_random_uuid()', BACKFILL_BATCH]);
```

好例子（标识符走模板、值走参数）：

```js
const batchSql = renderSql(backfillBatchSql, {
    TABLE: table, COLUMN: column, VALUE_EXPR: 'gen_random_uuid()', WHERE_CLAUSE: whereClause,
});
await pool.query(batchSql, [BACKFILL_BATCH]); // LIMIT $1 走参数
```

> ⚠️ `renderSql()` 的替换是 `replaceAll` 静默执行，两个坑都是真实踩过的：
>
> 1. **占位符键名拼错不报错**（键不匹配就被忽略，占位符原样留在模板里进库才炸）——
>    曾出现过脚本传 `BATCH_LIMIT`、模板写 `__BATCH_SIZE__`，`LIMIT __BATCH_SIZE__` 原样输出直接语法错误；
>    改模板后要核对「模板占位符 ↔ 脚本传键」一一对应；
> 2. **模板缺占位符是静默行为，且后果隐蔽**——`backfill-batch.sql` 曾漏写 `__WHERE_CLAUSE__`，
>    此时 `renderSql` 正常返回、SQL 也能跑，但子查询不过滤 NULL 行，**整批行的 uid 会被重新生成覆盖**；
>    写模板后要检查每个关键 WHERE 条件在模板里真的存在。
>
> 另外：`renderSql` 的产物才是可执行的 SQL——曾出现过渲染出 `countMissingSql` 后
> `pool.query` 仍传模板原文 `countMissingSqlTpl`（`FROM __TABLE__` 原样进库语法错误）的低级失误，核对调用点传的是渲染结果。

## 二、连接参数从哪来

优先级（见 [server/src/db/db.config.ts](../server/src/db/db.config.ts) 的 `buildConnectionString()`）：

1. `DATABASE_URL` —— 完整连接串（CI / docker-compose 注入形态）；
2. `DB_USER` / `DB_PASSWORD` / `DB_HOST` / `DB_PORT` / `DB_NAME` —— 分量拼装（本地 `.env.development` 形态）；
3. 都没有 → 启动阶段显式报错，不允许静默回退。

> 注意：本地开发在 `.env.development` 配置即可（`npm run dev` 与 `npm run db:init:dev` 都会读它）；
> 生产环境一律由 compose/CI 把 `DATABASE_URL` 注入容器进程，不落 `.env` 文件。

## 三、表结构初始化（原生 SQL DDL）

- 建表 DDL 集中在 [server/src/db/sql/init.sql](../server/src/db/sql/init.sql)，全部使用
  `CREATE TABLE IF NOT EXISTS`（枚举类型用 `DO $$ ... duplicate_object` 兜底），**幂等可重复执行**。
- 执行：两个命令跑同一个脚本 `scripts/db-init.js`，按环境取连接参数——
  `npm run db:init:dev`（本地开发：显式 `NODE_ENV=development`，强制读 `.env.development`，与 `npm run dev` 同环境）
  或 `npm run db:init`（通用：跟随 `NODE_ENV`，非生产自动读 `.env.development`；生产容器内不读文件、直接用注入的 `DATABASE_URL`）。

`db-init.js` 实际做**两件事**（结构在前、数据在后）：

1. **结构**：执行 [server/src/db/sql/init.sql](../server/src/db/sql/init.sql)（纯 DDL，幂等，只建缺失对象）；
2. **数据迁移**：`backfillIdentityColumns()` 回填对外标识列并收紧 `NOT NULL`（见下「对外标识列的补列流程」）。
   SQL 拆在 [server/src/db/sql/migrate/](../server/src/db/sql/migrate/) 下，脚本只做编排；
   当前清单见脚本内 `IDENTITY_COLUMNS`（`todos.uid` / `users.user_id`），加表加一行即可。
- 执行时机：

| 场景 | 时机 | 说明 |
|------|------|------|
| 本地首次搭库 | 新建 dev 数据库容器/数据卷后跑一次 | 建出全部表、枚举、索引 |
| 新同事拉代码 | 起好数据库容器后跑一次 | 配合 `.env.development` 即可跑通 |
| 修改了 init.sql | 改完 DDL 后重跑 | 幂等，只补缺失对象，不动已有数据 |
| 生产首次部署 | 数据库就绪后、启动新版本服务前 | 在 app 容器内执行一次 |
| 生产数据卷清空/换库 | 重新执行一次 | 重建全部结构 |

> 不需要每次启动都跑：服务启动只做 `connectDatabase()` 连接探测，不执行任何 DDL；
> 重复执行也无害，只是白白发一遍 SQL。

**生产部署中的插入位置**（对应 [ci-cd-yunxiao.md](ci-cd-yunxiao.md) 的 `deploy_to_ecs`）：

```bash
# 1. 拉起全部容器后台运行
docker compose up -d

# 2. 等待 postgres 服务就绪
#    ⚠️ 通用坑：wait-for-it 写在 exec app 里的前提是 app 容器已经启动成功——
#    若 app 启动即 connectDatabase() 而数据库未就绪，app 会崩溃退出，
#    容器挂掉后 docker compose exec <app> 报 no such container。
#    本仓库不受此坑影响：compose 给 fullstack-app 配了
#    depends_on: postgres/redis condition: service_healthy（pg_isready / redis ping 探测），
#    中间件未就绪 fullstack-app 根本不会被拉起，up -d 返回时 app 必已存在，exec 必能进入。
#    想显式等待用 compose 自带参数（等所有服务 healthy，无需镜像里装任何等待工具）：
docker compose up -d --wait

# 3. 执行建表初始化脚本（在 app 容器内执行，复用容器环境变量 DATABASE_URL）
docker compose exec -T fullstack-app npm run db:init

```
详见  [docker.md](docker.md)

要点：
- 服务名是 `fullstack-app`（compose services 定义名），不是 `app`；
- `npx wait-for-it` 在本镜像不可行：wait-for-it 是 shell 脚本不是 npm 依赖，运行镜像
  `npm ci --omit=dev` 只装 dependencies，npx 现场下载在生产网络下不可靠；
- 更稳的执行方式（不依赖 app 进程存活，app 崩溃/重启中也能跑，天然规避第 2 步的坑）：
  `docker compose run --rm fullstack-app npm run db:init`（临时容器，同一镜像与环境）；
- ⚠️ 容器内能跑 db:init 的前提：Dockerfile 运行阶段已拷入 `scripts/db-init.js` 与
  `server/src/db/sql/init.sql`（运行镜像只重建 dependencies + dist 产物，缺文件会报
  MODULE_NOT_FOUND）；生产 `NODE_ENV=production` 不读 .env，直接用 compose 注入的 `DATABASE_URL`；
- 启动探测只 `SELECT 1`：没建表 app 也能启动成功，但首个业务请求 500 ——
  db:init 必须在对外提供服务前执行完；
- `db-init.js` 幂等，每次部署都执行也安全，通常首建库/改表后跑。

### 主键与对外标识：id 内部化，uid 对外化

todos 表有两个标识字段，分工固定：

| 字段 | 类型 | 角色 | 出现位置 |
|------|------|------|----------|
| `id` | `SERIAL` | 内部主键，仅在 SQL 内部排序（`ORDER BY id DESC`）；**不进 SELECT / RETURNING 投影，不出 repository 对外契约** | 绝不出现在 URL / 路由 / 对外接口 / TypeScript 类型 |
| `uid` | `UUID`，库端 `gen_random_uuid()` 生成 | 对外查找键（唯一索引 `todos_uid_key`） | 路由 `/page/todos/:uid/toggle`、`/page/todos/:uid`；htmx 属性 `hx-post` / `hx-delete` |

设计动机：自增 id 可枚举（`/todos/1`、`/todos/2`…易被遍历爬取），且暴露业务规模；
UUID 不可预测，对外一律用它定位行。controller 层用 UUID 正则校验形态
（非法直接 400 不查库，见 `todo.controller.ts` 的 `parseValidUid`，错误码 40002 `invalid_uid`）。

新增行不写 uid：INSERT 不带该列，走表默认值 `gen_random_uuid()` 生成，`RETURNING` 带回。

### 改表结构的约定（无自动 diff，需人工同步）

本项目不使用自动 diff 的迁移工具，表结构变更需人工同步，约定如下：

1. 修改 [server/src/db/sql/init.sql](../server/src/db/sql/init.sql)（新库视角，保持 `IF NOT EXISTS` 语义）；
2. 对**已存在的老库**，把增量变更以幂等形式追加进 init.sql；
   ⚠️ **给已有表加任何新列，都必须同步追加对应的幂等 ALTER**，否则老库不会自动获得该列，
   后续引用新列的语句（建索引、业务查询）会报 `column "xxx" does not exist`；
3. 执行 `npm run db:init`（若新增了对外标识列，见下一节「对外标识列的补列流程」）；
4. 同步更新 `todo.repository.ts` 里的 SQL 投影与行类型 `TodoRow`（以及 service / controller 签名）。

#### 对外标识列的补列流程（init.sql 纯 DDL + 脚本回填）

给已有表补对外标识列（如 todos.uid / users.user_id）是**职责拆两半**的典型：

**前半（init.sql，纯结构 DDL，不动数据）**——三步幂等补列：

```sql
ALTER TABLE todos ADD COLUMN IF NOT EXISTS uid UUID;                      -- ① 可空补列：O(1) 元数据操作；存量行存在时不能一步加 NOT NULL
ALTER TABLE todos ALTER COLUMN uid SET DEFAULT gen_random_uuid();          -- ② SET DEFAULT：后续 INSERT 不带该列也自动生成
CREATE UNIQUE INDEX IF NOT EXISTS todos_uid_key ON todos (uid);            -- ③ 对外唯一索引（查找走它）
```

**后半（migrate/ + db-init.js，数据迁移）**——由 `scripts/db-init.js` 的 `backfillIdentityColumns()`
在结构就绪后按表串行执行（SQL 见 [migrate/](../server/src/db/sql/migrate/)）：

1. 探测表是否有 `is_deleted`（软删过滤仅对带该列的表生效）；
2. `COUNT` 缺失行数，为 0 则整表跳过；
3. 循环分批 `UPDATE ... SET uid = gen_random_uuid() WHERE ... ORDER BY id LIMIT 1000 FOR UPDATE SKIP LOCKED` 直到清零；
4. 清零后才 `ALTER TABLE ... SET NOT NULL` 收紧。

为什么回填不放 init.sql：init.sql 是 multi-statement 一次发送，无法在「回填完」与「收紧 NOT NULL」之间
编排——存量 NULL 超过单批 LIMIT 时一次 UPDATE 只回填一批，紧接着 SET NOT NULL 必失败，且每次重跑都失败；
脚本可以循环回填到 0 行再收紧，才是真正收敛。

> 新库无需此流程：CREATE TABLE 直接写 `uid UUID NOT NULL DEFAULT gen_random_uuid()`，
> 补列 ALTER 是给老库兜底的（CREATE TABLE IF NOT EXISTS 命中跳过，老库缺列则执行）。

> 取舍：不引入 ORM 与自动迁移，换来完全透明的 SQL 与更少的依赖层；
> 代价是改表结构需人工维护 DDL。将来表多、变更频繁后，可再引入 node-pg-migrate 等轻量迁移工具。

### 开发环境专用：纠正 id 序列（SERIAL 漂移）

`todos.id` 是 `SERIAL`（底层 `todos_id_seq` 序列负责发号）。开发期只要有人**绕过序列手工指定 id**
（手工 `INSERT ... VALUES (1, ...)` 回填测试数据、手删最大 id 的行、从备份/别的库导数据），
序列的当前值不会自动跟上，表现为：

- 下次正常新增报 `duplicate key value violates unique constraint "todos_pkey"`（序列发的号撞上已有 id）；或
- id 大幅跳号（序列停在一个旧值上）。

> `uid` 不受此问题影响：UUID 由 `gen_random_uuid()` 按行随机生成，没有序列、没有漂移；
> 自从 id 内部化（见上文「主键与对外标识」）后，id 漂移的破坏面收窄为「主键冲突 + 内部排序」，
> 但新增撞主键依然会直接报错，修复手段不变。

修复语句（把序列对齐到表内当前最大 id，之后 `nextval` 从 `MAX(id)+1` 继续）：

```sql
SELECT setval('todos_id_seq', COALESCE((SELECT MAX(id) FROM todos), 0));
```

- `COALESCE(..., 0)` 兜底空表：`setval` 置 0 后下一次发号从 1 开始；
- 只改序列游标，不删不动任何已有数据，幂等可重复执行。

执行方式（开发容器 `dev-postgres`，容器内已注入 `POSTGRES_USER` / `POSTGRES_DB`，无需在命令里硬编码账号）：

```bash
docker exec dev-postgres sh -c \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT setval('"'"'todos_id_seq'"'"', COALESCE((SELECT MAX(id) FROM todos), 0));"'
```

也可以直接在 Navicat / DBeaver 里对 dev 库执行这一句。

> ⚠️ **仅限开发环境使用**，且两个纪律：
>
> 1. **不要把这句追加进 [init.sql](../server/src/db/sql/init.sql)**——`npm run db:init`
>    在生产部署也会执行（见上文「生产部署中的插入位置」），init.sql 必须保持纯幂等 DDL，
>    不能混入开发期的数据修正语句；
> 2. **生产环境禁止用 setval 当常规修复**：生产 id 的唯一写入方就是 SERIAL 序列，
>    出现漂移说明有人绕过 nextval 手工插了 id，是流程/代码 bug，要先查根因。
>    （id 已内部化，外链/客户端引用的是 uid，重排 id 不直接伤及外部；
>    但内部仍靠 id 排序，纪律不变——先查根因，再谈修复。）


## 四、运行时生命周期

- 启动：`server/src/index.ts` → `connectDatabase()`：从池里借一条连接执行 `SELECT 1` 探测，失败直接终止进程。
- 运行：`pool.query(...)` 自动借还连接；空闲连接异常由 `pool.on('error')` 记日志兜底，不打崩进程。
- 退场：`registerShutdown` → `disconnectDatabase()` → `pool.end()` 优雅释放。
