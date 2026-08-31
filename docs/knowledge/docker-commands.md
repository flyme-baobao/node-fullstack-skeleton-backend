# Docker 常用命令速查

## 一、`docker exec` 系列（进入容器、容器内执行命令）

```bash
# 1. 交互式进入容器 shell（最常用，alpine 用 sh，debian/ubuntu 用 bash）
docker exec -it 容器名/容器ID sh

# 2. 如果容器是 ubuntu/debian，用 bash
docker exec -it 容器名/容器ID bash

# 3. 只执行一条命令，不进入交互 shell（执行完立刻返回宿主机）
docker exec 容器名 printenv
docker exec 容器名 ls -l /app

# 4. 后台执行命令，不需要交互
docker exec -d 容器名 touch /app/test.txt

# ✨compose 版本（不用记带 -1 的容器全名，直接写 yml 里的 service 名字）
docker compose exec 服务名 sh
docker compose exec 服务名 printenv
```

### 参数说明

| 参数 | 说明 |
| --- | --- |
| `-i` | 保持标准输入打开 |
| `-t` | 分配伪终端，组合 `-it` 才可以交互式敲命令；只执行单条命令可不用 `-t` |

> ⚠️ 注意：`exec` 只能作用于 **Up 运行状态** 的容器；容器已停止无法 `exec`。

---

## 二、全套高频 Docker 日常开发命令清单

### 1. 镜像 image

```bash
# 查看本地镜像
docker images

# 构建镜像，当前目录 Dockerfile
docker build -t 镜像名:tag .

# 删除镜像
docker rmi 镜像ID/镜像名

# 清理无用镜像
docker image prune
```

### 2. 容器 container

```bash
# 列出正在运行的容器
docker ps

# 列出全部容器（包含已停止的）
docker ps -a

# 启动已经存在的停止容器
docker start 容器ID

# 停止容器
docker stop 容器ID

# 强制杀死容器
docker kill 容器ID

# 删除停止的容器
docker rm 容器ID

# 查看容器日志
docker logs 容器ID
# 实时滚动日志
docker logs -f 容器ID
# 看最近 100 行
docker logs --tail 100 容器ID

# 查看容器完整配置信息（环境变量、端口、挂载）
docker inspect 容器ID

# 容器 ↔ 宿主机 文件拷贝
# 容器内文件复制到 Windows 宿主机
docker cp 容器ID:/app/file.txt ./
# Windows 宿主机复制进容器
docker cp ./local.txt 容器ID:/app/
```

### 3. Docker-Compose

```bash
# 启动全部服务，-d 后台静默运行
docker compose up -d

# 构建镜像 + 启动
docker compose up -d --build

# 停止并删除容器（保留镜像、数据卷 volume）
docker compose down

# 停止删除容器 + 删除数据卷（数据库数据会清空，谨慎！）
docker compose down -v

# 查看 compose 管理的容器日志
docker compose logs -f

# 直接进入 compose 服务容器（推荐，不用管 -1 后缀）
docker compose exec 服务名 sh

# 校验解析 yml 配置，查看插值后的 env、端口
docker compose config

# 重启某个服务
docker compose restart 服务名
```

### 4. 系统清理

```bash
# 清理停止容器、悬空镜像、无用网络，不删数据卷
docker system prune

# 全部清理（谨慎！会删掉未使用的数据卷，数据库数据丢失）
docker system prune -a --volumes
```