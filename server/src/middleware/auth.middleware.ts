/**
 * 鉴权中间件（auth.middleware.ts）
 *
 * 职责单一：在进入业务路由前完成「白名单放行 / 凭证校验 / userId 注入」。
 *   - 白名单：公开整页、壳渲染基础资源（i18n/路由清单/切换语言）、signup/signin 自身；
 *   - 凭证：sessionId Cookie（httpOnly）+ Authorization: Bearer <token> 双通道；
 *   - 单凭证：Redis 校验通过即放行（req.userId 注入）；
 *   - 双凭证：都必须有效且 userId 一致才放行；任一无效 40103，不一致 40102；
 *   - 全缺：40101。
 *
 * 挂载位置：i18nRequest() 之后、userContext 之前——userContext 的 isLogin 依赖
 * 本中间件写入的 req.userId（见 user-context.middleware.ts）。
 *
 * 异步顺序保证：Express 中间件链是「调用 next() 才继续」的显式接力，本文件全程
 * asyncHandler 包裹——await Redis 之后再 next() 顺序天然成立；Redis 异常转 next(err)，
 * 交给 errorHandler，不会出现「未 await 就放行」或「请求悬死」。
 */
import type { Request, Response, NextFunction } from 'express';
import { getRedis } from '../db/redis.js';
import { getCookie } from '../utils/cookie.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { logger } from '../utils/logger.js';
import { HttpError } from './error.middleware.js';
import { ERROR_DEFS } from '../i18n/error-defs.js';
import {
    SESSION_COOKIE,
    isPublicPath,
    tokenKey,
    sessionKey,
} from '../constants/auth.js';

/** Authorization 头前缀（Bearer） */
const BEARER_PREFIX = 'Bearer ';

/** 从 Authorization 头解析 Bearer token；缺失或前缀不符返回 undefined */
function extractBearerToken(req: Request): string | undefined {
    const header = req.headers.authorization;
    if (!header || !header.startsWith(BEARER_PREFIX)) {
        return undefined;
    }
    const token = header.slice(BEARER_PREFIX.length).trim();
    return token || undefined;
}

/** Redis 查询一条凭证对应的 userId；键不存在（过期/伪造）返回 null */
async function lookupUserId(key: string): Promise<string | null> {
    return getRedis().get(key);
}

export const authMiddleware = asyncHandler(
    async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
        // ① 白名单：公开资源直接放行，不做凭证解析
        if (isPublicPath(req.method, req.path)) {
            next();
            return;
        }

        // ② 提取双通道凭证
        const sessionId = getCookie(req.headers.cookie, SESSION_COOKIE);
        const token = extractBearerToken(req);

        // ③ 全缺 → 40101（前端据此触发重定向/弹窗，后端不做重定向）
        if (!sessionId && !token) {
            throw new HttpError({ ...ERROR_DEFS.unauthorized });
        }

        // ④ 单凭证：只校验自己那份
        if (!sessionId || !token) {
            const key = sessionId
                ? sessionKey(sessionId)
                : tokenKey(token as string);
            const userId = await lookupUserId(key);
            if (!userId) {
                // 凭证存在但 Redis 查不到：过期或伪造 → 40103
                throw new HttpError({ ...ERROR_DEFS.credential_invalid });
            }
            req.userId = userId;
            next();
            return;
        }

        // ⑤ 双凭证：各自校验 + userId 一致性
        const [sessionUserId, tokenUserId] = await Promise.all([
            lookupUserId(sessionKey(sessionId)),
            lookupUserId(tokenKey(token)),
        ]);
        if (!sessionUserId || !tokenUserId) {
            // 任一失效 → 40103（不区分哪一份失效，避免给攻击者探针信息）
            logger.warn('[auth] dual credential one side invalid', {
                requestId: req.requestId,
                hasSession: Boolean(sessionUserId),
                hasToken: Boolean(tokenUserId),
            });
            throw new HttpError({ ...ERROR_DEFS.credential_invalid });
        }
        if (sessionUserId !== tokenUserId) {
            // 都有效但归属不同用户 → 40102（疑似凭证串用/CSRF 残留风险）
            logger.warn('[auth] dual credential userId mismatch', {
                requestId: req.requestId,
            });
            throw new HttpError({ ...ERROR_DEFS.session_mismatch });
        }
        req.userId = sessionUserId;
        next();
    }
);