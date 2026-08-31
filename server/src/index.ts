import dotenv from 'dotenv';
import http from 'node:http';
import { createApp } from './app.js';
import { mountRoutes } from './routes/index.js';
import { serveStaticSpa } from './middleware/staticSpa.middleware.js';
import { registerShutdown } from './runtime/shutdownRuntime.js';
import { installProcessErrorGuard } from './runtime/processErrors.js';
import { logger } from './utils/logger.js';
import { listenWithRetry } from './utils/listenWithRetry.js';

// NODE_ENV 由【进程环境】决定（docker/cli 注入），不从 .env 读
const isProd = process.env.NODE_ENV === 'production';

if (!isProd) {
    // 开发环境：读取 .env，加载到 process.env，不覆盖 已有的环境变量（例如 docker-compose.yml 注入的），避免覆盖掉 compose 注入的端口等配置
    dotenv.config({ path: '.env.development', override: false });
}
// 生成 环境 CI注入 和 docker-compose.yml 注入，而且生成环境 也没有 .env 文件

// 生产环境固定监听 3000（与 Dockerfile 公开端口 / compose 内部端口强绑定）
// 开发环境才读取 SERVER_PORT，便于本地灵活换端口
const port = isProd ? 3000 : Number(process.env.SERVER_PORT) || 3000;

// 进程级兜底：接管 unhandledRejection / uncaughtException，须在任何异步逻辑之前注册
installProcessErrorGuard();

async function main(): Promise<void> {
    const app = await createApp();

    // 生产：Express 直连服务构建产物（dist-client），并对 /list 等深链做 SPA 兜底。
    // 开发（双端口架构）：前端资源由 Vite:5173 出（transform + HMR），其余请求经 proxy 转发回本服务，故不挂 static。
    if (isProd) {
        app.use(serveStaticSpa());
    }

    const server = http.createServer(app);
    mountRoutes(app);

    // 带自动重试的 listen，遇端口占用稍等后自愈，消灭随机 EADDRINUSE（见 utils/listenWithRetry.ts）
    listenWithRetry(server, port, () => {
        logger.info(`Node Server backend → http://localhost:${port}`, { env: isProd ? 'production' : 'dev' });
    });

    // 把退场逻辑注册到 SIGTERM / SIGINT，收到信号时尽快释放 server（Vite 已独立，由 concurrently 统一管理）
    registerShutdown({ server });
}

main().catch((err) => {
    logger.error('Start Failed', { error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
});