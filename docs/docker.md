# Docker 部署与运维手册（Docker Operations Manual）

> 本文档收录本仓库 Docker 相关的**核心校验命令、本地标准启动工作流、日常运维命令**。
> 对应 4 份 Compose 文件：`docker-compose.yml`（生产基座+本地 base，镜像由 CI 提前构建）、`docker-compose.local.yml`（*差异覆盖*，仅将 `fullstack-app` 改为本地构建，需与 `docker-compose.yml` 组合使用）、`docker-compose.test.yml`（*差异覆盖*，仅将 `fullstack-app` 改为拉取已 push 的镜像，需与 `docker-compose.yml` 组合使用）、`docker-compose.develop.yml`（仅中间件，本机跑 Node）。

---

## 1. 核心校验命令（必用）

启动任何 Compose 栈之前，先用它**校验渲染后的完整配置**，尽早暴露变量缺失 / 语法错误 / 引用不一致：

```bash
# 校验并查看渲染后的完整配置（申明 volumes/networks/services 是否合法、环境变量能否正确插值）
docker compose config

# 导出完整渲染配置用于问题排查 / 存档（后续可按 resolved.txt 逐项核对变量）
docker compose config > resolved.txt
```

> 💡 结合父级 `.env` 一起校验：`docker compose --env-file .env config`。若变量未填或写错，`config` 输出中会出现**空值 / 告警**，比 `up` 启动后再失败更早发现。

---

## 2. 本地标准启动工作流

### 0. 前置：环境变量从哪来（本地 `.env` vs 生产 CI 注入）

> **本地**：compose 命令（`up` / `config`）会自动读取**当前目录的 `.env`** 做 `<VAR>` 占位插值，**无需**通过 `set -a && source .env && set +a` 手动加载进 Shell —— 那套在 run 命令里才会用到，这里直接用默认行为即可。想要显式指定就用 `--env-file .env`。
>
> **生产**：**不落 `.env` 文件**。运行期变量全部由 GitLab 后台 CI/CD Variables 注入，经 `deploy_prod` 阶段的 `ssh ... export` 传给远程 shell 再交给 compose。生产机上若调用 `source .env` 会因文件不存在而失败，故生产切勿使用。

### 生产无 `.env` 时，Prisma / schema.prisma 怎么拿到 DATABASE_URL

- [server/src/db/prisma/schema.prisma](server/src/db/prisma/schema.prisma) 里的 `env("DATABASE_URL")` 读取的是“当前进程环境变量”，不是固定读某个 `.env` 文件。
- 生产场景下，Compose 会先用外部注入的 `DB_USER`、`DB_PASSWORD`、`DB_HOST`、`DB_PORT`、`DB_NAME`、`REDIS_PASSWORD`、`REDIS_HOST`、`REDIS_PORT` 把 [docker-compose.yml](docker-compose.yml) 里的 `DATABASE_URL`、`REDIS_URL` 拼出来，再把结果注入 `fullstack-app` 容器进程。
- 因此即使生产机没有 `.env` 文件，只要 `fullstack-app.environment` 里成功注入了 `DATABASE_URL`，应用内的 Prisma Client 与 [server/src/db/db.config.ts](server/src/db/db.config.ts) 都能正常通过 `process.env.DATABASE_URL` 读取到它。
- 同理，后续 Redis 接入业务后，[server/src/db/db.config.ts](server/src/db/db.config.ts) 里的 `process.env.REDIS_URL` 也会读取到 Compose 注入值。
- 需要注意的是：`schema.prisma` 本身不会“主动去读 docker-compose.yml”；真正起作用的是 Compose 把变量写进容器进程环境后，Prisma 在运行时再通过 `env("DATABASE_URL")` 读取当前进程环境变量。

```bash
# —— 本地（compose 自动读当前目录 .env 做插值，无需 source）——
docker compose config            # 校验渲染结果（.env 缺失变量会显示空值/告警）
docker compose up -d             # 启动
# 如果 .env 不在当前目录，显式指定：
docker compose --env-file .env config
docker compose --env-file .env up -d
```

> 💡 **生产注入替代品**：`deploy_prod` 阶段将 GitLab 后台变量经 `ssh ... export` 注入远程 shell 再传给 compose，全程不依赖 `.env` 文件。详见 `.gitlab-ci.yml`。

### 分场景启动

```bash
# ---- 1. 纯开发模式（本机跑 Node、Docker 仅启动中间件）----
# 适用：日常业务开发、热更新调试、无需容器打包
# 启动 Postgres + Redis 两个中间件容器
docker compose -f docker-compose.develop.yml up -d

# ---- 2. 本地全容器模拟生产（完整容器环境、本地构建镜像）----
#    适用：上线前本地全量自测、复现线上生产环境
#    local 是 override：必须与 base(docker-compose.yml) 合并，-f 后面的文件覆盖前面的 key。
#    公共内容（postgres/redis/ports/environment/healthcheck…）全部由 base 提供，local 只把
#    fullstack-app 从“CI 预构建镜像”覆盖为“本地 Dockerfile 构建”。
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build

#     默认按生产 mode 构建（vite build 无 sourcemap）。
#     需要带调试信息（sourcemap）时，临时注入 MODE 构建参数：
MODE=development docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build

#     ⚠️ 务必保留 `--build`：`up` 不带 --build 会**直接复用本地已有的 image tag（如
#     node-fullstack-skeleton:local）**，不重新走 Dockerfile 构建，改了 Dockerfile 却不
#     带 --build 就会用到旧镜像（“改了没生效”的常见坑）。带 --build 才保证每次重建。

# ---- 3. 本地验证「已 push 的镜像」（拉取测试，不重新构建）----
# 适用：验证 CI 构建推送的镜像能否在本地整套跑起来（不改代码，纯验证镜像可用性）
# 与 local 同理：test 也是 override，仅把 fullstack-app.image 覆盖为 .env 的
# TEST_IMAGE_NAME（前置：在 .env 配完整镜像名含 tag，漏配会空值报错）。
docker compose -f docker-compose.yml -f docker-compose.test.yml up -d

# ---- 4. 停止 local / test 栈（保留数据卷）----
#    local 与 test 用的都是 base + 各自 override，停哪套记得带对应文件。
docker compose -f docker-compose.yml -f docker-compose.local.yml down
docker compose -f docker-compose.yml -f docker-compose.test.yml down

# ---- 5. 彻底清空 local / test 数据（测试重置使用，谨慎操作）----
docker compose -f docker-compose.yml -f docker-compose.local.yml down -v
docker compose -f docker-compose.yml -f docker-compose.test.yml down -v

# ---- 6. 查询容器里面的环境变量 ----
docker ps
# 使用上一步 找到的 NAMES 字段 替换 POD_NAME (下面2个都行)
docker exec ${POD_NAME} printenv
docker inspect ${POD_NAME} -f '{{range .Config.Env}}{{.}}{{"\n"}}{{end}}'
```

### 场景速查表

| 场景 | 用哪个文件 | 命令 | Node 位置 | DB/Redis 访问地址 |
|---|---|---|---|---|
| 日常开发（本机跑 Node） | `docker-compose.develop.yml` | `up -d` | 宿主机 | `127.0.0.1`（须在 Node 侧适配）|
| 本地全容器模拟生产 | `docker-compose.yml` + `-f docker-compose.local.yml` | `up -d --build` | 容器 | `postgres` / `redis`（服务名）|
| 验证已 push 镜像 | `docker-compose.yml` + `-f docker-compose.test.yml` | `up -d` | 容器 | `postgres` / `redis`（服务名）|
| 停止 local / test 栈 | base+local 或 base+test（与启动时一致） | `down` | — | — |
| 重置数据 | base+local 或 base+test（与启动时一致） | `down -v` | — | — |

> ⚠️ `docker-compose.develop.yml` 只有 Postgres + Redis；此时 Node 跑在宿主机，`.env` 里的 `DB_HOST` / `REDIS_HOST` 需为 `127.0.0.1` 并经 Node 侧适配，容器模式才用服务名 `postgres`/`redis`。

---

## 2. 日常运维命令

```bash
# ---- 停止服务、保留数据卷（下次启动数据仍在）----
docker compose down

# ---- 停止服务、清空所有数据（仅测试环境 / 彻底重置使用，谨慎）----
docker compose down -v
```

> `down` 默认保留命名数据卷；`down -v` 额外删除数据卷，**数据不可恢复**，生产环境切勿使用。

---

## 附：Compose 文件对照

| 文件 | 作用 | image 来源 | Node 进程位置 |
|---|---|---|---|
| `docker-compose.yml` | 生产部署 + 本地全容器模拟生产的 base | `${IMAGE_NAME}:${IMAGE_TAG}`（CI 预构建） | 容器 |
| `docker-compose.local.yml` | 差异覆盖（仅把 `fullstack-app` 改为本地构建） | `build: .` 本地构建 | 容器 |
| `docker-compose.test.yml` | 差异覆盖（仅把 `fullstack-app` 改为拉取已 push 的镜像） | `${TEST_IMAGE_NAME}`（.env 指定镜像） | 容器 |
| `docker-compose.develop.yml` | 纯开发中间件 | 官方镜像 | 宿主机 |