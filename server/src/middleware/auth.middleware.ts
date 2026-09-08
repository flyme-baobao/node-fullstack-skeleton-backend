/**
 * 鉴权中间件（auth.middleware.ts）
 *
 * 职责单一：在进入业务路由前完成「白名单放行 / 凭证校验 / userId 注入」。
 *   - 白名单：公开整页、壳渲染基础资源（i18n/路由清单/切换语言）、signup/signin 自身；
 *     凭证走同一套解析做软校验：有有效凭证注入 userId（isLogin 派生用），失败静默放行不 401；
 *   - 凭证：sessionId Cookie（httpOnly）+ Authorization: Bearer <token> 双通道；
 *   - 单凭证：Redis 校验通过即放行（req.userId 注入）；
 *   - 双凭证：都必须有效且 userId 一致才放行；任一无效 40103，不一致 40102；
 *   - 全缺：40101。
 *
 * 挂载位置：i18nRequest() 之后、业务路由之前——controller 经 createWebCtx 用
 * 本中间件写入的 req.userId 派生 isLogin（见 adapter/webCtx.ts）。
 *
 * 异步顺序保证：Express 中间件链是「调用 next() 才继续」的显式接力；本中间件为裸
 * async 函数——Express 5 原生把 async handler 的 rejected promise 转成 next(err)
 * （router 2.x 对 handler 返回的 promise 挂 .catch），无需 asyncHandler 包裹。
 * await Redis 之后再 next() 顺序天然成立；Redis/凭证异常直接 throw → errorHandler，
 * 不会出现「未 await 就放行」或「请求悬死」。
 */
import type { Request, Response, NextFunction } from 'express';
import { getRedis } from '../db/redis.js';
import { getCookie } from '../utils/cookie.js';
import { logger } from '../utils/logger.js';
import { HttpError } from './error.middleware.js';
import { ERROR_DEFS, type ErrorCodeDefinition } from '../i18n/error-defs.js';
import {
    SESSION_COOKIE,
    isAuthExemptPath,
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

const REASON_MAP = {
    MISSING: 'missing',
    INVALID: 'invalid',
    MISMATCH: 'mismatch',
} as const;

const REASON_ERROR_DEF_MAP = {
    [REASON_MAP.MISSING]: ERROR_DEFS.unauthorized,
    [REASON_MAP.INVALID]: ERROR_DEFS.unauthorized,
    [REASON_MAP.MISMATCH]: ERROR_DEFS.session_mismatch,
} satisfies Record<CredentialResolutionReason, ErrorCodeDefinition>;

type CredentialResolutionReason = typeof REASON_MAP[keyof typeof REASON_MAP];

/** 凭证解析结果：ok=true 携带 userId；ok=false 携带失败原因（供调用方决定放行 / 401 / 静默降级） */
type CredentialResolution =
    | { ok: true; userId: string, token?: string }
    | { ok: false; reason: CredentialResolutionReason; hasSession: boolean; token?: string };

/**
 * 凭证解析唯一实现（白名单 / 受保护路径共用，避免两份「提取 + 查库」逻辑漂移）：
 *   - 全缺 → missing；单凭证查不到或双凭证任一查不到 → invalid；双凭证 userId 不一致 → mismatch。
 * 本函数绝不抛错、绝不写响应——如何处置由调用方决定：
 *   - 白名单路径：失败静默放行（软解析），成功则注入 req.userId 供 isLogin 派生；
 *   - 受保护路径：失败按原因映射 40101/40103/40102 + 告警日志。
 */
async function resolveCredentials(req: Request): Promise<CredentialResolution> {
    const sessionId = getCookie(req.headers.cookie, SESSION_COOKIE);
    const token = extractBearerToken(req);
    // 直接在原始变量上判空（而非布尔别名）：TS 依此把后续分支的 sessionId/token 收窄为 string
    if (!sessionId && !token) {
        return { ok: false, reason: REASON_MAP.MISSING, hasSession: false };
    }
    if (!sessionId || !token) {
        const key = sessionId ? sessionKey(sessionId) : tokenKey(token!);
        const userId = await lookupUserId(key);
        return userId
            ? { ok: true, userId, token }
            : { ok: false, reason: REASON_MAP.INVALID, hasSession: Boolean(sessionId), token };
    }
    const [sessionUserId, tokenUserId] = await Promise.all([
        lookupUserId(sessionKey(sessionId)),
        lookupUserId(tokenKey(token)),
    ]);
    if (!sessionUserId || !tokenUserId) {
        // 双凭证分支：走到这里 sessionId/token 均已收窄为非空串
        return { ok: false, reason: REASON_MAP.INVALID, hasSession: true, token };
    }
    if (sessionUserId !== tokenUserId) {
        return { ok: false, reason: REASON_MAP.MISMATCH, hasSession: true, token };
    }
    return { ok: true, userId: sessionUserId, token };
}

export const authMiddleware = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    // ① 白名单：同一套解析逻辑做「软解析」——失败静默放行（不 401），成功注入 userId
    // 供 getI18n / changeLanguage 等派生 isLogin（未登录返回精简语言包 notLogin.<lang>.json）
    if (isAuthExemptPath(req.method, req.path)) {
        const result = await resolveCredentials(req);
        req.userId = result.ok ? result.userId : undefined;
        req.userToken = result.token;
        next();
        return;
    }

    // ②~⑤ 受保护路径：相同的校验逻辑，根据原因映射错误码（处置权在调用方）
    const result = await resolveCredentials(req);
    if (result.ok) {
        req.userId = result.userId;
        req.userToken = result.token;
        next();
        return;
    }

    const errorDef = REASON_ERROR_DEF_MAP[result.reason];

    if (!errorDef) {
        // 理论不可达：satisfies Record<...> 已在编译期保证全量映射；兜底防请求悬死
        logger.error('[auth] unhandled credential reason', { requestId: req.requestId, reason: result.reason });
        throw new HttpError({ ...ERROR_DEFS.internal_error });
    }

    const message = `[auth] Auth failed: ${result.reason} (hasSession=${result.hasSession}, hasToken=${Boolean(result.token)}) for ${req.method} ${req.path}`;
    logger.error(message, {
        requestId: req.requestId,
        reason: result.reason
    });
    throw new HttpError({ ...errorDef });
};