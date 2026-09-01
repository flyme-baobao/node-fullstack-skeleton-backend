# Prisma 命令与执行顺序

本文只解释两类 Prisma 命令：`migration` 和 `generate`，以及它们在本地开发、CI、生产发布中的正常执行顺序。

## 一句话区分

- **migration：管数据库（SQL 表结构）**
- **generate：管 TypeScript 代码与类型（Prisma Client）**

也可以理解为：

- `migration` 同步的是**数据库世界**
- `generate` 同步的是**代码世界**

## migration 是什么，为什么要执行

Prisma 的 migration 用来把 [server/src/db/prisma/schema.prisma](../../server/src/db/prisma/schema.prisma) 里的模型变化，真正落到数据库里，例如：

- 新增表
- 新增字段
- 修改字段类型
- 增加索引 / 唯一约束
- 调整表映射与列映射

只改 `schema.prisma` 并不会自动改数据库；schema 只是声明，数据库不会自己跟着变，所以需要执行 migration。

### 开发环境：`npm run db:migrate:dev`

开发态执行的是 `npm run db:migrate:dev`。它会：

1. 读取 [server/src/db/prisma/schema.prisma](../../server/src/db/prisma/schema.prisma)
2. 对比当前开发数据库结构
3. 生成新的 migration 文件
4. 立即执行 SQL，把变更应用到开发库
5. 顺带刷新 Prisma Client

因此，**本地开发只要改了表结构，正常流程就是直接执行** `npm run db:migrate:dev`。

### 开发环境重置：`npm run db:reset:dev`

当本地开发库需要整体重置时，可以执行 `npm run db:reset:dev`。它适用于下面这类场景：

- 本地开发库无重要数据，想从干净状态重新建库
- migration 历史与数据库状态发生 drift，需要重新对齐
- 只是本地调试，明确接受“库内数据全部丢失”

这条命令会重置当前开发数据库的 schema，并清空其中已有的表和数据，然后再按现有 migration 重新建立数据库对象。

> ⚠️ **务必谨慎**：`db:reset:dev` 会清空数据库中的现有数据。如果 PostgreSQL 数据目录挂在 Docker volume 上，那么被清空的是这份 volume 中持久化的数据库内容。它不会删除你的源码文件，也不会删除整个 volume 实体本身，但会把其中这套数据库的数据内容清空重建。

### 生产环境：`npm run db:migrate:deploy`

生产态执行的是 `npm run db:migrate:deploy`。它只会执行仓库里**已经提交**的 migration 脚本，不会在生产现场创建新 migration。

这一步存在的意义是：把开发阶段已经确认过的数据库变更，安全地应用到生产数据库。

## generate 是什么，为什么要执行

Prisma 的 generate 用来根据 [server/src/db/prisma/schema.prisma](../../server/src/db/prisma/schema.prisma) 生成 Prisma Client，也就是业务代码里真正 import 和调用的那套 TS API 与类型定义。

生成后的内容包括：

- `PrismaClient`
- 每个 model 的 CRUD 方法类型
- `create` / `update` / `where` / `select` 等输入输出类型
- `.prisma/client` 下的运行时代码与声明文件

它**不会**做下面这些事：

- 不会创建表
- 不会修改字段
- 不会执行 SQL
- 不会连接数据库去改结构

所以 `generate` 的作用不是“改库”，而是让你的 TypeScript 代码和最新 schema 保持一致。

### `generate` 可以离线执行

`generate` 只依赖 schema 和本地依赖产物，**不负责修改数据库结构**。正常理解里，它的职责就是生成 Prisma Client / 类型。

在这个项目里，`db:generate:dev` 通过开发环境变量包装 Prisma CLI，目标仍然是生成 client；你可以把它理解为“按开发环境约定执行的 generate”。

## 两者的关系

### dev 环境

`npm run db:migrate:dev` 通常会**自动帮你 generate**。

所以开发态如果你改的是表结构，正常不用再手工补一次 `npm run db:generate:dev`。

只有下面这些少数情况，才值得单独再跑一次 `generate`：

- `node_modules` 被重装后 Prisma Client 产物丢失
- 切换分支后本地 `.prisma/client` 产物不一致
- 编辑器 / TS Server 缓存异常，类型没有及时刷新
- 你没有改数据库结构，只是需要单独重建 Prisma Client

### deploy 环境

`npm run db:migrate:deploy` **不会替你自动 generate 供构建使用的 Prisma Client**，所以生产链路通常要把 `generate` 单独放进 build 阶段。

这也是为什么本项目把 `npm run db:generate` 放进了 [Dockerfile](../../Dockerfile) 的 builder 阶段：镜像构建时先生成 Prisma Client，再继续后续编译流程。

## 推荐执行顺序

### 本地开发流程

如果你修改了表结构：

1. 修改 [server/src/db/prisma/schema.prisma](../../server/src/db/prisma/schema.prisma)
2. 执行 `npm run db:migrate:dev`

通常到这里就够了，不需要额外执行 `npm run db:generate:dev`。

如果你**没有**修改表结构，只是想刷新 Prisma Client / 类型：

1. 执行 `npm run db:generate:dev`

如果本地开发库已经乱掉、且没有需要保留的数据：

1. 执行 `npm run db:reset:dev`
2. 再执行 `npm run db:migrate:dev`

### CI / 生产流程

推荐流程：

1. build 镜像时执行 `npm run db:generate`
2. 数据库就绪后执行 `npm run db:migrate:deploy`
3. 再启动新版本服务

对这个项目来说：

- `db:generate` 已内置在 [Dockerfile](../../Dockerfile) 的 builder 阶段
- `db:migrate:deploy` 应放在正式发布前执行
- 如果使用容器部署，`db:migrate:deploy` 应在 `docker compose up` 启动新版本之前，或由 CI/CD 发布步骤统一编排执行

## 场景速查

- **改了表结构字段**：执行 `npm run db:migrate:dev`
- **表结构没变，只想刷新 Prisma Client**：执行 `npm run db:generate:dev`
- **本地开发库要整体清空重建**：先执行 `npm run db:reset:dev`，再执行 `npm run db:migrate:dev`
- **CI / Docker build**：执行 `npm run db:generate`
- **生产发布改库**：执行 `npm run db:migrate:deploy`