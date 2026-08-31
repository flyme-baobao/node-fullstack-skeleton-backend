import type http from 'node:http';
import { logger } from './logger.js';

/**
 * listen 重试策略。
 *
 * - maxRetries: EADDRINUSE 时最多重试次数，默认 6
 * - initialDelayMs: 第一次重试前等待时间，默认 300ms
 * - maxDelayMs: 指数退避的最大等待上限，默认 2000ms
 */
type ListenRetryOptions = {
    maxRetries?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
};

/**
 * 入场阶段：为新进程执行带重试的 listen。
 *
 * 这段逻辑只负责“新进程启动时端口还没完全释放怎么办”。
 * 若旧进程刚收到 SIGTERM、仍在退场，新的 server.listen(port) 可能先遇到 EADDRINUSE。
 * 此时稍等再试，让新进程不要因为旧进程晚几百毫秒释放端口而直接崩掉。
 *
 * 注意：这里重试的是当前进程里的 server.listen(port)，不是重启进程本身。
 * 真正结束旧进程并拉起新进程的是 node --watch-path=server ... 这条启动链路。
 *
 * 注意：SIGINT 是用户手动结束当前进程，只走退场，不会自动拉起新进程，
 * 所以通常不会进入这里的重试分支。
 *
 * @param server 已创建的 http.Server
 * @param port 要监听的端口
 * @param onListening 成功监听后的回调
 */
export function listenWithRetry(
    server: http.Server,
    port: number,
    onListening?: () => void,
    options: ListenRetryOptions = {}
): void {
    const {
        maxRetries = 6,
        initialDelayMs = 300,
        maxDelayMs = 2000,
    } = options;

    let attempt = 0;

    const retry = (): void => {
        const handleListening = (): void => {
            server.off('error', handleError);
            onListening?.();
        };

        const handleError = (err: NodeJS.ErrnoException): void => {
            server.off('listening', handleListening);
            if (err?.code === 'EADDRINUSE') {
                if (attempt >= maxRetries) {
                    logger.error(`端口 ${port} 在重试 ${maxRetries} 次后仍被占用，停止重试并退出。`);
                    process.exit(1);
                }

                const nextAttempt = attempt + 1;
                // 每次按 initialDelayMs * 2^attempt 指数退避计算等待时间，但单次最长只等 maxDelayMs；
                // 整体最多只会重试 maxRetries 次，超过后直接失败退出。
                const delayMs = Math.min(initialDelayMs * 2 ** attempt, maxDelayMs);
                attempt = nextAttempt;

                // 旧进程还没完全退场：等端口释放后再重试本次 server.listen。
                logger.warn(`端口 ${port} 仍被占用，第 ${nextAttempt}/${maxRetries} 次重试将在 ${delayMs}ms 后进行…`);
                setTimeout(retry, delayMs);
            } else {
                logger.error('listen 失败', {
                    code: err?.code,
                    message: err?.message,
                });
                process.exit(1);
            }
        };

        server.once('listening', handleListening);
        server.once('error', handleError);
        server.listen(port);
    };
    retry();
}