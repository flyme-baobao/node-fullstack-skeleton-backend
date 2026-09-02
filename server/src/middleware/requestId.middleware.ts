import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

/**
 * 为每个请求生成唯一 requestId，并回写 X-Request-Id 响应头。
 * 配合 utils/logger 带上 requestId，日志里按请求串联/排障。
 * 需在业务路由之前挂载（app.ts 里放在 body 解析之后）。
 */
export function requestId(req: Request, res: Response, next: NextFunction): void {
    const id = randomUUID();
    req.requestId = id;
    res.setHeader('X-Request-Id', id);
    next();
}