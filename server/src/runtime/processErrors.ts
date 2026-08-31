import { logger } from '../utils/logger.js';

/**
 * 进程级错误兜底：接管未被业务链路 catch 的异常，防止静默崩溃/带病运行。
 *
 * - unhandledRejection：异步代码 reject 但无人 catch（多为业务漏包 asyncHandler、
 *   第三方库 bug）。记录但不立即退出——可能只是单个请求失败，后续仍可恢复。
 * - uncaughtException：同步异常冒泡到顶层，进程状态可能已损坏。记录后强制退出
 *   （exit(1)），交给进程管理器（node --watch / Docker / PM2 等）重启，
 *   避免带病运行产生更难排查的偶发错误。
 *
 * 需要在 main() 之前调用（index.ts 顶部）。
 */
export function installProcessErrorGuard(): void {
    process.on('unhandledRejection', (reason) => {
        const err = reason instanceof Error ? reason : new Error(String(reason));
        logger.error('[unhandledRejection]', {
            name: err.name,
            message: err.message,
            stack: err.stack,
        });
    });

    process.on('uncaughtException', (err) => {
        logger.error('[uncaughtException]', {
            name: err.name,
            message: err.message,
            stack: err.stack,
        });
        // 强制退出，避免带病状态继续跑出更隐蔽的问题
        process.exitCode = 1;
    });
}