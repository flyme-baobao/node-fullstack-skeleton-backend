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
  - 本地：首次起库后执行一次；之后**修改过 init.sql**（新增表/列/索引）再执行；
  - 生产：数据库就绪后、启动新版本服务前执行（幂等，重复执行安全）。

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
