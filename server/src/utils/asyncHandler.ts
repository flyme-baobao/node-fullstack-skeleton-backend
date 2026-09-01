import type { Request, Response, NextFunction } from 'express';

type AsyncHandler = (
    req: Request,
    res: Response,
    next: NextFunction
) => Promise<unknown>;

/**
 * 包装 async 路由/控制器：把 async 函数里 throw 出来的错误（rejected Promise）
 * 转成 `next(err)`，让 Express 错误管道（errorHandler）统一接管。
 *
 * 为什么需要它：Express 只会同步捕获 handler 抛出的异常；async 函数抛错变成
 * rejected promise，若不 catch，会变 unhandled rejection，请求挂起且错误漏网。
 * 对同步同学也无副作用（Promise.resolve 兜底），可统一包裹。
 *
 * @example
 * router.post('/change-language', asyncHandler(changeLanguage));
 */
export function asyncHandler(
    fn: AsyncHandler
): (req: Request, res: Response, next: NextFunction) => void {
    return (req, res, next: NextFunction) => {
        try {
            Promise.resolve(fn(req, res, next)).catch((err) => {
                if (res.headersSent) {
                    console.error('[asyncHandler] headers已经发出，无法转发错误', err);
                    return;
                }
                next(err);
            });
        } catch (syncErr) {
            // 兜底捕获同步函数直接throw的异常
            if (res.headersSent) {
                console.error('[asyncHandler] sync throw headersSent', syncErr);
                return;
            }
            next(syncErr);
        }
    };
}