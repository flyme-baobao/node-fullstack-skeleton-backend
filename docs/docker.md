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
> ⚠️ **例外：develop 栈**（`docker-compose.develop.yml`）默认读 `.env` 会插值出生产参数（`DB_HOST=postgres` 宿主机连不上、库名/账号也是 prod 套），必须显式 `--env-file .env.development`。
>
> **生产**：**不落 `.env` 文件**。运行期变量全部由 GitLab 后台 CI/CD Variables 注入，经 `deploy_prod` 阶段的 `ssh ... export` 传给远程 shell 再交给 compose。生产机上若调用 `source .env` 会因文件不存在而失败，故生产切勿使用。

### 生产无 `.env` 时，pg 驱动怎么拿到 DATABASE_URL

- 原生 pg 驱动没有 schema 文件：连接参数在 [server/src/db/db.config.ts](server/src/db/db.config.ts) 里从**当前进程环境变量**读取（`DATABASE_URL`，或 `DB_*` 分量拼装），不是固定读某个 `.env` 文件。
- 生产场景下，Compose 会先用外部注入的 `DB_USER`、`DB_PASSWORD`、`DB_HOST`、`DB_PORT`、`DB_NAME`、`REDIS_PASSWORD`、`REDIS_HOST`、`REDIS_PORT` 把 [docker-compose.yml](docker-compose.yml) 里的 `DATABASE_URL`、`REDIS_URL` 拼出来，再把结果注入 `fullstack-app` 容器进程。
- 因此即使生产机没有 `.env` 文件，只要 `fullstack-app.environment` 里成功注入了 `DATABASE_URL`，[server/src/db/db.config.ts](server/src/db/db.config.ts) 就能正常通过 `process.env.DATABASE_URL` 读取到它。
- 同理，后续 Redis 接入业务后，[server/src/db/db.config.ts](server/src/db/db.config.ts) 里的 `process.env.REDIS_URL` 也会读取到 Compose 注入值。

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
# 适用：日常业务开发、热更新调试，无需容器打包
# 固定三步顺序不可乱：①启动PG+Redis中间件 ②执行db:init:dev（首次/改表执行，脚本幂等）③启动本机Node；
# ⚠️②必须在③之前，否则服务启动探测连通但无表，业务请求500；①必须早于②，中间件未就绪db:init:dev直接报错；
# ⚠️compose插值默认只读 .env（生产参数，DB_HOST=postgres 宿主机连不上、库名/账号也是 prod 套），develop 栈必须 --env-file 显式指定 .env.development；
# DB_HOST统一使用.env.development的127.0.0.1；db:init:dev 显式NODE_ENV=development读取宿主机.env.development的DB_*变量
docker compose --env-file .env.development -f docker-compose.develop.yml up -d
npm run db:init:dev
npm run dev          # 或只启服务端：npm run dev:server

# ---- 2. 本地全容器模拟生产（完整容器环境、本地构建镜像）----
#    适用：上线前本地全量自测、复现线上生产环境
#    local 是 override：必须与 base(docker-compose.yml) 合并，-f 后面的文件覆盖前面的 key。
#    公共内容（postgres/redis/ports/environment/healthcheck…）全部由 base 提供，local 只把
#    fullstack-app 从“CI 预构建镜像”覆盖为“本地 Dockerfile 构建”。
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build

#     默认按生产 mode 构建（vite build 无 sourcemap）；
#     需要带调试信息（sourcemap）时，临时注入 MODE 构建参数：
MODE=development docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build
# ⚠️必须带--build，否则复用旧镜像，不会重新构建Dockerfile，出现代码修改不生效；
# --build仅生成镜像，建表是运行时操作；首次部署/down‑v重置数据卷/修改init.sql后容器内执行db:init，幂等，普通up/down无需重复执行；
# 容器NODE_ENV=production，不读取.env，使用compose注入DATABASE_URL，以服务名postgres访问数据库
docker compose -f docker-compose.yml -f docker-compose.local.yml exec -T fullstack-app npm run db:init

# 备选方案：up -d --build 之后发现 app 容器崩溃/退出、exec 无法进入时，run --rm 起临时容器执行
#（同一镜像同一环境变量，跑完自动删除）。前置：镜像必须先构建好（上面 up -d --build 已完成）。
# compose run 默认就不发布端口，不会与 app 的 3000 冲突，无需额外旗标；
# 若担心误启依赖可加 --no-deps（db:init 需连库，通常保持默认让 compose 自动带上 postgres/redis）
docker compose -f docker-compose.yml -f docker-compose.local.yml run --rm fullstack-app npm run db:init
# 建表完成之后，再重新拉起业务app
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d fullstack-app

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
# down 不需要环境变量插值（project 名由 develop.yml 的 name: 决定），带 --env-file 仅为命令统一
docker compose --env-file .env.development -f docker-compose.develop.yml down -v

# ---- 6. 查询容器里面的环境变量 ----
docker ps
# 使用上一步 找到的 NAMES 字段 替换 POD_NAME (下面2个都行)
docker exec ${POD_NAME} printenv
docker inspect ${POD_NAME} -f '{{range .Config.Env}}{{.}}{{"\n"}}{{end}}'
```

### 场景速查表

| 场景 | 用哪个文件 | 命令 | Node 位置 | DB/Redis 访问地址 | db:init 时机 |
|---|---|---|---|---|---|
| 日常开发（本机跑 Node） | `docker-compose.develop.yml` | `--env-file .env.development up -d` → `db:init:dev` → `npm run dev` | 宿主机 | `127.0.0.1`（须在 Node 侧适配）| 中间件起来后、dev 前（宿主机执行） |
| 本地全容器模拟生产 | `docker-compose.yml` + `-f docker-compose.local.yml` | `up -d --build` → `exec db:init` | 容器 | `postgres` / `redis`（服务名）| 首次起栈后（容器内执行） |
| 验证已 push 镜像 | `docker-compose.yml` + `-f docker-compose.test.yml` | `up -d` → `exec db:init` | 容器 | `postgres` / `redis`（服务名）| 首次起栈后（容器内执行） |
| 停止 local / test 栈 | base+local 或 base+test（与启动时一致） | `down` | — | — | 不需要 |
| 重置数据 | base+local 或 base+test（与启动时一致） | `down -v` | — | — | 重启后需重跑（数据卷已清空） |

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

## 3. 线上数据库连接（psql / Docker exec）

> 生产 postgres 容器的 `ports` 是**注释掉的**（端口不裸露宿主机），宿主机上的
> Navicat / DBeaver 连不上，**只能 `docker exec` 进容器内用 psql** 操作。

### 账号/库名的来源链

`prod_user` / `prod_business` 不是写死在命令里的魔法值，而是一条链的产物：

```
.env（DB_USER=prod_user / DB_NAME=prod_business）
  → compose ${} 插值
  → postgres 镜像 environment（POSTGRES_USER / POSTGRES_DB）
  → 镜像首次初始化时用它们建出账号与库
```

生产 `DATABASE_URL` 也是同一份变量拼的：
`postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}`（见 docker-compose.yml）。
改了 `.env` 的 `DB_USER` / `DB_NAME` 并重建数据卷后，连接命令里的名字要跟着变。

### 进入线上库

```bash
# ① 容器名直连（最稳：不依赖 compose 解析，生产机无 .env 也不受影响）
#    -it 用于交互式 psql；脚本/自动化场景改用 -T
#    ⚠️ Windows Git Bash（mintty）下 -it 会报 "the input device is not a TTY"，
#      必须加 winpty 前缀；PowerShell / CMD / Linux 直接可用
winpty docker exec -it prod-postgres psql -U prod_user -d prod_business

# ② 复用容器内已注入的 POSTGRES_USER / POSTGRES_DB，不硬编码账号（推荐）
winpty docker exec -it prod-postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'

# ③ compose 按服务名进（任意目录可行；但需解析 compose 文件，缺 .env 会空值告警，通常不影响 exec postgres）
docker compose -f docker-compose.yml exec postgres psql -U prod_user -d prod_business

# ④ 非交互形态①（Git Bash 下无需 winpty）：只保留 -i、不分配 TTY；
#    不进交互提示符，psql 从 stdin 读 SQL（键入后回车执行，Ctrl+D 退出）
docker exec -i prod-postgres psql -U prod_user -d prod_business

# ⑤ 非交互形态②：对应 ② 的去 -t 版本，同样复用容器内注入的账号变量
docker exec -i prod-postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

> **非交互 / 脚本场景**：④⑤ 形态无 TTY，psql 不会进入交互提示符，而是从 stdin 读 SQL；
> 一次性 SQL 建议直接带 `-c`：
> `docker exec -i prod-postgres psql -U prod_user -d prod_business -c "SELECT count(*) FROM todos;"`
> 想进交互式 psql（有提示符 / 历史记录）必须用上面的 `-it` / winpty 形态。

### 退出方式速查

| 当前在… | 提示符 | 退出操作 | 说明 |
|---|---|---|---|
| psql 交互提示符 | `prod_business=#` | `\q` 或 `Ctrl+D` | 退出 psql，回到宿主机 shell；**不影响容器** |
| psql 正在执行长查询 | （无提示符） | `Ctrl+C` | 取消当前语句，回到 psql 提示符 |
| 容器 shell（Alpine） | `/ #` | `exit` 或 `Ctrl+D` | 退出 exec 会话；**容器照常运行** |
| socat 隧道（前台） | — | `Ctrl+C` | 断开隧道（加 `-d` 后台跑的不受影响） |

> 例行说明：以上操作退出的只是「本次 exec / 隧道」会话，postgres 服务一直在容器里跑，
> 随时可再 `docker exec` 进入；想真正停止服务请用 `docker compose stop` / `down`。

> **容器名 vs 服务名**：`prod-postgres` 是 compose `container_name` 固定名（`docker exec` 用）；
> `postgres` 是 compose **服务名**，只在自定义网络（app-network）内解析，`docker exec` 用不了服务名——
> 按服务名必须走 `docker compose exec postgres`。

### socat 端口转发：宿主机 GUI 直连容器内 postgres

生产 postgres 的 `ports` 注释掉了，宿主机 Navicat / DBeaver 连不上。除了 `docker exec` 进容器用 psql，
还可以用 **socat 临时隧道**把容器内 5432 转发到宿主机回环端口，GUI 工具直连即可：

```bash
# ⑥ socat 隧道：宿主机 127.0.0.1:5433 → 同网络内 prod-postgres:5432
#    --rm 用完即删；前台跑，Ctrl+C 断开；常驻加 -d
#    网络名 = compose project 名(默认目录名) + _ + compose 里定义的网络名(app-network)
#    prod-postgres 是 container_name，自定义网络内 DNS 可解析
# 先拉取 alpine/socat
docker pull alpine/socat
# 查询 网桥
docker network ls

docker run --rm -p 127.0.0.1:5433:5432 \
  --network node-fullstack-skeleton-backend_app-network \
  alpine/socat \
  tcp-listen:5432,fork,reuseaddr \
  tcp:prod-postgres:5432
```

> **参数拆解**：
> - `-p 127.0.0.1:5433:5432` — 宿主机 5433 → socat 容器内 5432（绑 127.0.0.1 只允许本机访问）
> - `--network ...app-network` — 加入 postgres 所在的自定义网络，socat 才能按容器名解析 prod-postgres
> - `tcp-listen:5432,fork,reuseaddr` — socat 在容器内监听 5432（fork 支持多连接、reuseaddr 复用端口）
> - `tcp:prod-postgres:5432` — 转发目标：同网络内 prod-postgres 容器的 5432
>
> **使用**：Navicat / DBeaver 填 `127.0.0.1` / 端口 `5433` / `prod_user` / `prod_business` 即可。
> **验证**：`psql -h 127.0.0.1 -p 5433 -U prod_user -d prod_business`（宿主机有 psql 时）。
>
> ⚠️ **前提**：① 栈在跑（`docker ps` 能看到 `prod-postgres`）；② 网络名正确
>（`docker network ls` 核对 `node-fullstack-skeleton-backend_app-network`）。
> 任意一个不对，socat 会解析失败直接退出。
>
> ⚠️ **这是本地栈的隧道**：连的是本机 Docker 里跑的 postgres（local 栈模拟生产的那套），
> 不是远程生产服务器上的库。远程库需在**服务器本机**做同样操作，或给 compose 临时加 `ports`。

### 开发 vs 生产对照

| 环境 | 容器名 | 端口裸露 | 连接方式 |
|---|---|---|---|
| 开发 | `dev-postgres` | 有（`${DB_PORT}:5432` 映射到宿主机） | Navicat / DBeaver 直连，或 exec |
| 生产 | `prod-postgres` | 无（ports 注释掉） | exec 进容器内 psql，或 socat 隧道转发到宿主机 |

---

## 附：Compose 文件对照

| 文件 | 作用 | image 来源 | Node 进程位置 |
|---|---|---|---|
| `docker-compose.yml` | 生产部署 + 本地全容器模拟生产的 base | `${IMAGE_NAME}:${IMAGE_TAG}`（CI 预构建） | 容器 |
| `docker-compose.local.yml` | 差异覆盖（仅把 `fullstack-app` 改为本地构建） | `build: .` 本地构建 | 容器 |
| `docker-compose.test.yml` | 差异覆盖（仅把 `fullstack-app` 改为拉取已 push 的镜像） | `${TEST_IMAGE_NAME}`（.env 指定镜像） | 容器 |
| `docker-compose.develop.yml` | 纯开发中间件 | 官方镜像 | 宿主机 |