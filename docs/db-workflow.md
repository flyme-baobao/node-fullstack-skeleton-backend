# 数据库工作流（原生 node-pg，无 ORM）

本文解释本仓库 PostgreSQL 数据访问的三个环节：连接管理、表结构初始化、业务查询的书写约定。

## 一、技术选型

- 驱动：[node-postgres（pg）](https://node-postgres.com/)，无 ORM、直接写 SQL。
- 连接池：[server/src/db/index.ts](../server/src/db/index.ts) 创建全局唯一 `pg.Pool`（参数来自环境变量，见 `db.config.ts`）。
- SQL：repository 层直接书写参数化 SQL（`$1` 占位符传参），杜绝字符串拼接注入。

## 二、连接参数从哪来

优先级（见 [server/src/db/db.config.ts](../server/src/db/db.config.ts) 的 `buildConnectionString()`）：

1. `DATABASE_URL` —— 完整连接串（CI / docker-compose 注入形态）；
2. `DB_USER` / `DB_PASSWORD` / `DB_HOST` / `DB_PORT` / `DB_NAME` —— 分量拼装（本地 `.env.development` 形态）；
3. 都没有 → 启动阶段显式报错，不允许静默回退。

> 注意：本地开发在 `.env.development` 配置即可（`npm run dev` 与 `npm run db:init` 都会读它）；
> 生产环境一律由 compose/CI 把 `DATABASE_URL` 注入容器进程，不落 `.env` 文件。

## 三、表结构初始化（原生 SQL DDL）

- 建表 DDL 集中在 [server/src/db/sql/init.sql](../server/src/db/sql/init.sql)，全部使用
  `CREATE TABLE IF NOT EXISTS`（枚举类型用 `DO $$ ... duplicate_object` 兜底），**幂等可重复执行**。
- 执行：`npm run db:init`（`scripts/db-init.js`，非生产自动读 `.env.development`）。
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

### 改表结构的约定（无自动 diff，需人工同步）

本项目不使用自动 diff 的迁移工具，表结构变更需人工同步，约定如下：

1. 修改 [server/src/db/sql/init.sql](../server/src/db/sql/init.sql)（新库视角，保持 `IF NOT EXISTS` 语义）；
2. 对**已存在的老库**，把增量变更以幂等形式追加进 init.sql
   （如 `ALTER TABLE todos ADD COLUMN IF NOT EXISTS deadline TIMESTAMP(3);`）；
3. 执行 `npm run db:init`；
4. 同步更新 `todo.repository.ts` 里的 SQL 与行类型 `TodoRow`。

> 取舍：不引入 ORM 与自动迁移，换来完全透明的 SQL 与更少的依赖层；
> 代价是改表结构需人工维护 DDL。将来表多、变更频繁后，可再引入 node-pg-migrate 等轻量迁移工具。

## 四、运行时生命周期

- 启动：`server/src/index.ts` → `connectDatabase()`：从池里借一条连接执行 `SELECT 1` 探测，失败直接终止进程。
- 运行：`pool.query(...)` 自动借还连接；空闲连接异常由 `pool.on('error')` 记日志兜底，不打崩进程。
- 退场：`registerShutdown` → `disconnectDatabase()` → `pool.end()` 优雅释放。
