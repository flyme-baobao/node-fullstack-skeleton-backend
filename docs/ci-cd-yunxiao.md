# CI/CD 流水线笔记（Gitee Go → 云效 Flow）

> 记录本仓库 CI/CD 从 **Gitee Go** 迁到 **云效 Flow（.yunxiao/ci.yml）** 的决策与踩坑。
> 目的：构建镜像 → 推送阿里云 ACR。部署（ECS/docker-compose 或 K8s）暂未启用。

## 结论速览

| 项 | 值 |
|---|---|
| 平台 | 云效 Flow（阿里云），免费公共构建 |
| 流水线文件 | `.yunxiao/ci.yml` |
| 源码源 | Gitee（`type: git` 通用 Git 源 + Gitee 服务连接） |
| 构建镜像+推送 | `DockerBuildPushACR`（云效内置步骤，专用于 ACR） |
| 目标 ACR | `crpi-1vp5deeta128cxtu.cn-beijing.personal.cr.aliyuncs.com/my-app-flyme/node-fullstack-skeleton` |
| 本地验证镜像 | `docker-compose.yml` + `-f docker-compose.test.yml`（.env 配 `TEST_IMAGE_NAME` 拉取验证） |
| 部署 | 暂无 ECS/K8s，`kubectl_apply_stage` 已注释 |

## 运行状态

- ✅ **2026-08-28**:`DockerBuildPushACR` 步骤运行成功 —— **镜像构建 + 推送 ACR 已打通**，证明云效链路可行。
- ✅ **2026-08-28**:**本地拉取验证也走通** —— 用 `docker-compose.yml` + `-f docker-compose.test.yml`（.env 配 `TEST_IMAGE_NAME`）在本地把已 push 的镜像整套拉起来，确认镜像可落地运行。至此「**构建 → 推送 ACR → 本地验证**」闭环完成，只剩部署阶段。
- 推送确认完成后，可在 ACR 控制台该镜像仓库的「镜像版本」里看到对应 tag 的镜像。

## 为什么放弃 Gitee Go 的镜像推送

Gitee Go 的 `build@docker` 插件存在一个**致命拼接 bug**：它把「镜像仓库」和「tag」用**斜杠 `/`** 拼接，而不是规范的**冒号 `:`**。

实际现象（已实测 3 次）：

- `tag: ${GITEE_PIPELINE_BUILD_NUMBER}` → 拼出 `.../node-fullstack-skeleton/13`
- `tag: latest` → 拼出 `.../node-fullstack-skeleton/latest`
- 不写 `tag` → `AttributeError`（ImageBuildException.message），直接失败

推 `.../repo/tag` 这种「路径型」地址，ACR 认为是在推一个不存在的仓库 → `insufficient_scope: authorization failed`。**该行为由插件写死，改配置无法绕开。**

`shell@agent` 也不可用：它需要传 `hostGroupID`（自建 agent 主机），且 Gitee CI schema 上无 `gitee` 代码源类型等，自建 agent 前跑不通。

## 云效为什么能解决

云效 `DockerBuildPushACR` 是**阿里云自家为 ACR 做的内置步骤**，`dockerRegistry` 与 `dockerTag` 分开填写，由云效拼成规范 `仓库:tag`，不会再出现 `/` 拼接。

## 踩坑记录

### 1. 服务连接（不用明文账号密码）

- ACR 推送：`serviceConnection: yk3n44swtbuexwyy`（云效「服务连接」里主账号授权的 ACR 连接）。
- Gitee 源码：`certificate.serviceConnection: jro4b9ac34r6534u`（云效里建的 Git 通用连接，访问 Gitee）。

### 2. 云效没有 `type: gitee`，Gitee 要用通用 Git

`sources.type` 的合法值：`gitSample, customGitlab, codeup, git, gitlab, bitbucket, gitlabAPI, githubApp, flowPipeline, packages, acr`。**没有 `gitee`**。连 Gitee 仓库用 `type: git` + 一个能访问该仓库的 Git 服务连接。

### 3. 免费公共构建

- `runsOn.group: public/cn-beijing`＝云效免费公共构建（北京），**不用自建构建机**。
- 若用自己注册的构建机，才是 `private/<构建集群 UUID>`。
- `container` 是构建机运行的环境镜像（阿里公共 `alinux3`），一般不用改。

### 4. 想手写 `docker build` / 换 `docker:dind` —— 公共构建机都不可行（实测）

尝试在 `step: Command` 里手写 `git rev-parse HEAD` + `docker login` + `docker buildx build --push`，卡在两点：

- **公共构建机没有可用的 Docker daemon**：`docker login` 能成功（只走 CLI，不连 daemon），但 `docker buildx build --push` 立刻报：
  `ERROR: Cannot connect to the Docker daemon at tcp://127.0.0.1:2375. Is the docker daemon running?`
- **`container: docker:dind` 不可用**：把环境镜像改成 `docker:dind` 去申请运行环境，会**一直卡在「申请运行环境」**。

根因：**`public/cn-beijing` 公共构建集群的运行时环境是固定 / 受限的**，`container` 只能指向云效预先提供的基础镜像（`build-steps-public-registry.../alinux3:latest`），**不能随便换成 `docker:dind` 之类外部镜像**。

结论：**公共免费构建下，唯一可行的镜像构建+推送是云效内置步骤 `DockerBuildPushACR`**（它内部封装了 daemon/构建）。
想要自定义 Dockerfile 环境、`docker buildx` 多架构、长 hash tag 等，**必须用私有构建机 / 自建 agent（`private/<构建集群 UUID>`）**，公共免费绕不开。

### 5. 镜像 tag 的动态化

- 已验证可用：`dockerTag: ${CI_COMMIT_ID}` —— 云效内置变量，展开为本次拉取提交的**短 hash**（如 `9ae675be`），对 Gitee 等外部 git 源也生效，**无需 step 间传递**。
- `step: Command` / `step: Shell` 里 `echo ... >> $GITHUB_ENV` 或 `::set-output` 这类**步骤间输出传递**方式，`DockerBuildPushACR` 的内置步骤解析不到，**收不到**。
- 若要**长 hash（40 位）**，公共免费构建拿不到对应内置长变量，同样需要私有构建机（`git rev-parse HEAD`）才可行。

### 验收争议点：Dockerfile 基础镜像源

Dockerfile 用了 `docker.m.daocloud.io/library/node:20-alpine`（国内 DaoCloud 加速，可匿名拉取）。若云效公共构建机拉不到该源，需换回公共构建机可访问的镜像源（例如 `node:20-alpine` 直连，或阿里镜像 `registry.aliyuncs.com/...`）。

## 后面构想：改用 ECS 自建 docker 环境（更具性价比）

> 目前公共构建 `DockerBuildPushACR` 已验证可行，但受限于公共机无 docker daemon、不能自定义构建、长 hash tag 拿不到。**下一步构想**是买一个 ECS、装好 Docker，把「构建 + 部署」全挪到自己的服务器上跑。

### 架构：云效只当「编排调度」，重活全在 ECS

```
云效 sources(拉 Gitee 代码)
   └─ job: group=public/cn-beijing + container=alinux3
        └─ step: Command（只做 SSH 连接 / 传脚本）
             └─ ECS（装好 docker daemon / docker compose）
                  ├─ git pull / 或用 CI 传来的代码
                  ├─ docker login ACR
                  ├─ docker compose build / push    ← docker 全跑在 ECS
                  └─ docker compose up -d --wait    ← 部署也在 ECS
```

### 三点权衡（为什么可行）

1. **`sources` 只负责拉代码** ✅
2. **`step: Command` 只负责连 SSH**，之后 docker build/push/compose **全在 ECS 本地执行，与云效无关** ✅ —— 不占云效构建积分，也绕开公共机无 docker daemon 的坑
3. **`group: public/cn-beijing` + `container: alinux3` 继续用** ✅ —— 这个作业只做 SSH，不构建镜像，公共构建机完全能胜任，不必换 private

### 三种代码落地选型（A / B）

核心矛盾：**云效的 `sources` 把代码拉到了「云效构建机」上，不会自动到 ECS**。「云效已帮你拉好」不等于「ECS 上有代码」。要让代码到 ECS，有三条路：

| | A. 云效 sources + scp 整包上传 | B. ECS 自己 git pull（最稳） |
|---|---|---|
| 依赖云效 sources | ✅ 用 | ▶️ 基本不用（可删） |
| 代码来源 | 云效拉好后 scp → ECS | ECS 本地 git pull Gitee |
| 大静态资源 | 每次传，慢 | 不传，git 只存增量 |
| 首次配置 | 无 | ECS 首次 git clone + 配 Gitee 凭据 |
| 复杂度 | 高（scp 目录/ignore/清理） | **低，最标准** |

> ⚠️ 大坑澄清：**`云效 sources 拉好` ≠ `ECS 上有代码`**。云效机（alinux3）工作目录那份代码要落到 ECS，必须显式 `scp`/`rsync` 传过去，`ssh ECS 'git pull'` 走的是 **ECS 本地仓库的 remote（`origin`），跟云效 `sources` 无关**。

#### 方案 A：云效 sources 拉码 → scp 整包上传 ECS

```yaml
steps:
  deploy_to_ecs:
    step: Command
    name: "scp 上传并在 ECS 构建部署"
    with:
      run: |
        # 云效工作目录即 sources 克隆下来的工程根（不再是公共无 daemon，build 在 ECS 做）
        # 先写 SSH 私钥，避免明文；node_modules/.git 用 tar 排除，减少传输
        mkdir -p /tmp/ssh && printf '%s' "$ECS_SSH_PRIVATE_KEY" > /tmp/ssh/id_ed25519 && chmod 600 /tmp/ssh/id_ed25519
        tar --exclude='./node_modules' --exclude='./.git' -czf - . \
          | ssh -i /tmp/ssh/id_ed25519 -o StrictHostKeyChecking=no "$ECS_SSH_USER@${ECS_HOST}" \
              "cat > /tmp/app-src.tar.gz && cd ${DEPLOY_PATH} && tar -xzf /tmp/app-src.tar.gz && \
               echo ${ACR_PASSWORD} | docker login ${REGISTRY%%/*} -u ${ACR_USERNAME} --password-stdin && \
               docker compose build && docker compose up -d --wait"
```

#### 方案 B：ECS 自己 `git clone/pull`（推荐，最简单）

ECS 上放一个项目目录作为 working clone，git 自己管理增量，**云效 sources 可有可无**：

```yaml
steps:
  deploy_to_ecs:
    step: Command
    name: "在 ECS 内 git pull + docker compose"
    with:
      run: |
        # 本地（云效机）取私钥、SSH 到 ECS 执行远程脚本
        mkdir -p /tmp/ssh && printf '%s' "$ECS_SSH_PRIVATE_KEY" > /tmp/ssh/id && chmod 600 /tmp/ssh/id
        ssh -i /tmp/ssh/id -o StrictHostKeyChecking=no "$ECS_SSH_USER@${ECS_HOST}" 'bash -s' <<'EOF'
        set -e
        # DEPLOY_VERSION 可传分支名或 tag，缺省 master
        VERSION="${DEPLOY_VERSION:-master}"

        if [ -d "${DEPLOY_DIR}/.git" ]; then
          # 已存在 → fetch 并切到指定版本
          cd ${DEPLOY_DIR}
          git fetch --all --prune --tags
          git checkout ${VERSION}
          # 若是分支（非 tag）再 pull 一次拉到该分支最新；tag 没有 pull 意义
          if [ "$(git rev-parse --verify -q "refs/remotes/origin/${VERSION}" || true)" ]; then
            git pull --no-rebase origin "${VERSION}"
          fi
        else
          # 全新 clone 已自带默认分支的 checkout，切到指定版本后再拉最新
          mkdir -p ${DEPLOY_DIR}
          git clone ${REPO_URL} ${DEPLOY_DIR} && cd ${DEPLOY_DIR}
          git checkout ${VERSION} 2>/dev/null || git checkout -b ${VERSION} origin/${VERSION}
          if [ "$(git rev-parse --verify -q refs/remotes/origin/${VERSION} || true)" ]; then
            git pull --no-rebase origin "${VERSION}"
          fi
        fi

        # —— 在 ECS 上构建 + 推送 ACR + 部署 ——
        LONG_HASH=$(git rev-parse HEAD)
        echo ${ACR_PASSWORD} | docker login ${REGISTRY%%/*} -u ${ACR_USERNAME} --password-stdin
        docker compose build
        docker compose up -d --wait
        EOF
```

> ECS 侧注意：`node_modules` 在 `.gitignore` 里不会进 git；镜像内 Dockerfile 多阶段构建会重新 `npm ci --omit=dev`，最终镜像只留运行依赖，宿主机/构建机的 node_modules 是 git 忽略项，删不删随意，`npm ci` 会重建，**不会自动清除也不影响结果**。

#### 分支/标签与取版本

- 云效「运行」时填的**分支/标签**，**会覆盖** `ci.yml` 里 `sources.branch: master`：运行时填的优先，留空回退 `branch` 默认值。
- `sources` 拉到的版本是「触发时刻指定分支的最新提交」；若 ECS 每次从独立 git 仓库拉更新，则 ECS 要统一切到相同版本：`ssh ... "git fetch --tags && git checkout ${部署目标}"`。
- `git pull` 在 ECS 上是**拉它的 remote 的最新**，不走“云效拉好的那份”；要让 ECS 锁指定版本，用 `git checkout <tag>` 而不是 `git pull`。

### 关键校验点

- **SSH 凭据进云效「变量/凭据」，不落地仓库**：`ECS_HOST`、`ECS_SSH_USER`、`ECS_SSH_PRIVATE_KEY`、`ACR_USERNAME`、`ACR_PASSWORD`、`ACR_REGISTRY`。
- 远程脚本经 `ssh ... 'bash -s' <<'EOF'` 传入，或让 ECS 自己 `git pull`（需 ECS 配置 Gitee 拉取凭据）。
- 取 ACR host 用 `${REGISTRY%%/*}`（完整地址剥掉 `/` 后路径）；若带 `https://` 先 `#*//` 去协议。
- 长 hash tag：在 ECS 上 `git rev-parse HEAD` 随意取一，不再受云效内置变量限制。

## 待办（后续）

- [ ] **（构想）购买 ECS** 装 docker daemon + docker compose，把构建/部署迁到 ECS（见上文「后面构想」）。
- [ ] 暂用公共构建 `DockerBuildPushACR` + `${CI_COMMIT_ID}`（短 hash）作为稳妥基线。
- [ ] 恢复部署阶段（ECS 上 `docker compose up`，`.yunxiao/ci.yml` 里 kubectl 注释先留着）。
- [ ] 确认 Gitee 默认分支是 `master`，`branch: master` 才能拉到代码。

### ECS 部署前置检查清单（买了 ECS 后按序核对）

> 对应 `.yunxiao/deploy-ecs.yml`（方案 B 启用、方案 A 注释保留）。逐项打勾后再跑流水线，避免「配置完才报错」。

#### 1. 云效「变量/凭据」配置齐全

| 变量 | 说明 |
|---|---|
| `ACR_REGISTRY` | 完整 ACR 地址：`crpi-1vp5deeta128cxtu.cn-beijing.personal.cr.aliyuncs.com/my-app-flyme/node-fullstack-skeleton` |
| `ACR_USERNAME` / `ACR_PASSWORD` | ACR 登录账号 / 密码（ECS 上 `docker login` 用） |
| `ECS_HOST` / `ECS_USER` | ECS IP 或域名 / SSH 用户名 |
| `ECS_SSH_PRIVATE_KEY` | ECS 登录 SSH 私钥（进「变量/凭据」，多行，勿落地仓库） |
| `ECS_DEPLOY_DIR` | ECS 部署目录（方案 B 的 clone 目录） |
| `REPO_URL` | Gitee 仓库地址（方案 B 用） |
| `DEPLOY_VERSION` | （可选）分支名或 tag，缺省 `master` |

#### 2. 核对 `sources` 的服务连接 ID

`.yunxiao/deploy-ecs.yml` 里写的是 `serviceConnection: "jro4b9ac34r6534u"`。此 ID 需与云效「服务连接」里真实创建的 Gitee 连接一致——若对不上，`sources` 拉不到代码，流水线在第一步就失败。**建议运行前到云效「服务连接」确认该 ID，或直接引用于已跑通的 `.yunxiao/ci.yml` 所用的同一连接。**

> ⚠️ 实录曾有另一个写法 `jro4b9ac34r63w4u`，结尾几位不一致，务必以云效后台实际 ID 为准。

#### 3. ECS 侧前置

- [ ] 已装 Docker Engine（`docker version` 通过）
- [ ] 已装 Docker Compose 插件（`docker compose version` 通过）
- [ ] 已配好 SSH 密钥登录（云效能用 `ECS_SSH_PRIVATE_KEY` 免密登录 `ECS_USER@ECS_HOST`）
- [ ] 安全组放行所需端口（应用端口映射已在 compose 里声明的那几个）
- [ ] `ECS_DEPLOY_DIR` 存在或可由脚本 `mkdir -p` 创建（方案 B 会自动建）
- [ ] 首次部署方案 B 需 ECS 能拉到 Gitee（`REPO_URL` 可达，或配好 ECS 上的 Gitee 拉取凭据）