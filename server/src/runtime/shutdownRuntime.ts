import { createGracefulShutdown, SHUTDOWN_SIGNALS } from '../utils/gracefulShutdown.js';
import type http from 'node:http';

type RegisterShutdownOptions = {
    server: http.Server;
    closeApp?: () => Promise<void>;
};

/**
 * 把退场逻辑注册到进程信号。
 *
 * 双端口模式下 Express 只管理自身进程（Vite 开发服务器已独立成前端进程，
 * 由 concurrently 统一启停），因此这里只负责在收到 SIGTERM / SIGINT 时关闭
 * HTTP server，不再处理开发环境下的 Vite 资源。
 */
export function registerShutdown({ server, closeApp }: RegisterShutdownOptions): void {
    const shutdown = createGracefulShutdown({ server, closeApp });

    for (const signal of SHUTDOWN_SIGNALS) {
        process.once(signal, () => {
            void shutdown(signal);
        });
    }
}