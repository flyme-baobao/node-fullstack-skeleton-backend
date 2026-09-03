import type { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';
import { getErrorByCode } from '../i18n/error-defs.js';

/**
 * HttpError 构造参数。
 * status 是网络/HTTP 层状态码，code 是业务码。二者可解耦：
 * 可以保持 status 恒为 200、只靠 code 区分业务（适合返回 JSON 供前端解析），
 * 也可以按语义返回真实 4xx/5xx。要求显式传 status 与 code（或 message）之一。
 */
export interface HttpErrorInit {
    /** HTTP 状态码（网络层） */
    status: number;
    /** 数字业务码（业务层）：据此映射 message 的 i18n key；供前端解析区分场景 */
    code?: number;
    /** i18n key（如 'errors.toggle_not_found'）或原样自定义文案；未通过 code 映射时兜底 */
    message?: string;
    /** i18n 插值参数（如 errors.unsupported_lang 的 {{lang}}） */
    params?: Record<string, string | number>;
}

/**
 * 业务错误（携带 HTTP 状态码 + 数字业务码）。
 * status 是网络层状态码，code 是业务码（用于前端区分场景）。
 * controller 统一 `throw new HttpError({ status, code })`，构造器按错误码词典映射出
 * message（i18n key）；errorHandler 据此翻译并响应。
 * 也可 `throw new HttpError({ status, message })` 传 i18n key 或自由文案。
 */
export class HttpError extends Error {
    readonly status: number;
    /** 已解析的数字业务码（响应内带出）；无对应码时为 null */
    readonly code: number | null;
    /** 传给 i18n 翻译的 message：可能是已登记 key，也可能是自由文案 */
    readonly messageKey: string;
    readonly params?: Record<string, string | number>;

    constructor(init: HttpErrorInit) {
        // ① 有数字业务码 → 由词典映射出 i18n key（status 由调用方显式传）
        const byCode = init.code != null ? getErrorByCode(init.code) : undefined;
        // ② code / message 二选一兜底出 messageKey；都没有则用内部错误
        const messageKey = byCode?.message ?? init.message ?? 'errors.internal_error';

        super(messageKey);
        this.name = 'HttpError';
        this.status = init.status;
        this.code = init.code ?? byCode?.code ?? null;
        this.messageKey = messageKey;
        this.params = init.params;
    }
}

/**
 * 404 兜底：把所有未命中任何路由的请求集中到这里。
 * 对 htmx 请求返回片段友好的纯文本，其余按 JSON/文本返回。
 */
export function notFoundHandler(req: Request, res: Response): void {
    logger.warn('[not-found]', {
        requestId: req.requestId,
        method: req.method,
        url: req.originalUrl,
    });
    const messageKey = 'errors.not_found';
    const message = `${resolveMessage(req, messageKey)} - ${req.method} ${req.originalUrl}`;
    const sendData = { code: 404, message, messageKey };
    if (wantsHtml(req)) {
        attachErrorHeaders(res, sendData);
        res.status(404).type('text').send(message);
        return;
    }
    res.status(404).json(sendData);
}

/**
 * 全局错误处理中间件（必须 4 参，Express 才能识别为 error handler）。
 *
 * 拦截两类错误：
 *   1. Express 渲染管道的真实异常——fragmentRenderMiddleware 的 `nativeRender`（无回调
 *      → 自动 next(err)）以及 renderPageMiddleware 的 `try/catch → next(err)`（见
 *      render.middleware.ts 110 行）。
 *   2. controller 里显式 `throw new HttpError(...)`（经 next(err) 到达这里）。
 *
 * 处理策略：
 *   - instanceOf HttpError → 按其 status 映射（400/404 等业务状态码）；
 *   - 其余未知异常 → 记日志 + 500（技术故障）。
 */
export function errorHandler(
    err: unknown,
    req: Request,
    res: Response,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    next: NextFunction
): void {
    // 响应可能已发送（头已 flush）则只能交给 Express 默认处理，避免二次响应
    if (res.headersSent) {
        return next(err);
    }

    // 业务错误：所有 HttpError 都在这处理。
    // 涵盖各类 4xx / 5xx（及任意自定义状态码）——只要 controller 抛 HttpError，
    // 响应状态码一律取 `err.status`，数字业务码取 `err.code`，不做 4xx/5xx 之分的特判。
    // 响应形态按请求类型：htmx / 浏览器导航 → 纯文本片段；fetch（API）→ JSON。
    if (err instanceof HttpError) {
        // 业务错误（含 controller 直接 throw 的 400/404/500）：此分支此前不记日志，
        // 导致 4xx 输入校验错误在 Docker Logs 里静默。这里统一补一条结构化日志。
        // 分级：5xx（服务端故障）走 error，4xx（客户端输入、未命中资源等）走 warn。
        const meta = {
            requestId: req.requestId,
            method: req.method,
            url: req.originalUrl,
            status: err.status,
            code: err.code,
            messageKey: err.messageKey,
        };
        logger[err.status >= 500 ? 'error' : 'warn']('[http-error]', meta);

        const text = resolveMessage(req, err.messageKey, err.params);
        // 对 htmx / 浏览器导航返回纯文本片段，其余（fetch/API）返回 JSON；
        // 具体如何展示/渲染由前端监听 htmx 生命周期或读响应自行处理。
        const sendData = { code: err.code ?? err.status, message: text, messageKey: err.messageKey };
        if (wantsHtml(req)) {
            attachErrorHeaders(res, sendData);
            res.status(err.status).type('text').send(text);
        } else {
            // messageKey：让 API 调用方拿到「原 i18n key」做进一步本地化/路由判断；
            // 无业务码/自由文案进来时它 == message，供前端兜底展示。
            res.status(err.status).json(sendData);
        }
        return;
    }

    // body-parser / express.urlencoded 的请求体解析错误：自带 4xx，不能当未知异常打 500。
    // 常见：`entity.parse.failed`（畸形 JSON）、`entity.too.large`（超出 limit）等。
    // 惯例是挂到 err.status（number，通常 400）+ err.type（形如 'entity.parse.failed'）。
    const parseErr = err as { status?: unknown; type?: string };
    if (
        typeof parseErr.status === 'number' &&
        parseErr.status >= 400 &&
        parseErr.status < 500 &&
        typeof parseErr.type === 'string' &&
        parseErr.type.startsWith('entity.')
    ) {
        logger.warn('[bad-request]', {
            requestId: req.requestId,
            method: req.method,
            url: req.originalUrl,
            status: parseErr.status,
            detail: parseErr.type,
        });
        const messageKey = 'errors.bad_request';
        const text = resolveMessage(req, messageKey);
        const sendData = { code: 400, message: text, messageKey };
        if (wantsHtml(req)) {
            attachErrorHeaders(res, sendData);
            res.status(parseErr.status).type('text').send(text);
        } else {
            res.status(parseErr.status).json(sendData);
        }
        return;
    }

    // 未知异常：结构化记录，统一 500
    const e = err instanceof Error ? err : new Error(String(err));
    logger.error('[error]', {
        requestId: req.requestId,
        method: req.method,
        url: req.originalUrl,
        name: e.name,
        message: e.message,
        stack: e.stack,
    });

    const messageKey = 'errors.internal_error';
    const text = resolveMessage(req, messageKey);
    const sendData = { code: 500, message: text, messageKey };
    if (wantsHtml(req)) {
        attachErrorHeaders(res, sendData);
        res.status(500).type('text').send(text);
    } else {
        res.status(500).json(sendData);
    }
}

/**
 * 为纯文本片段响应附加错误元信息头，供 htmx/fetch 在 responseError 里读取：
 *   - X-Error-Code：数字业务码（与 JSON body 的 code 一致）；
 *   - X-Error-Key：原始 i18n key（与 JSON body 的 messageKey 一致）。
 * 特别适合 htmx 场景：htmx 默认把响应 body 直接作 DOM 片段，业务层拿不到 JSON body，
 * 但可在 responseError 事件里 getResponseHeader 取到结构化元信息。
 */
function attachErrorHeaders(
    res: Response,
    sendData: { code: number; message: string; messageKey: string }
): void {
    const { code, message, messageKey } = sendData;
    res.setHeader('X-Error-Code', String(code));
    // HTTP 头值只允许 latin-1（字节 0-255）：翻译后的 message 可能是中文（非 ASCII），
    // 直接 setHeader 会抛 ERR_INVALID_CHAR（Invalid character in header content）。这里安全化：
    // 非 ASCII 一律替换为 '?'，避免整条请求因头非法而连锁 500。
    res.setHeader('X-Error-Message', toHeaderSafe(message));
    res.setHeader('X-Error-Key', messageKey);
}

/** 把可能含非 ASCII（如中文文案）的字符串转成 HTTP 头安全值：超出 latin-1 的字符替换为 '?'。 */
function toHeaderSafe(value: string): string {
    return value.replace(/[^\x00-\x7F]/g, '?');
}

/**
 * 把 messageKey 转成响应文案：
 *   - 若 message 是已注册的 i18n key → 按当前语言翻译并插值后返回文案；
 *   - 否则（未注册 key / 自由文本）→ 原样透传。
 * @returns 响应用文案；若 req.t 在缺语言态下抛错则退化为传入的原始字符串。
 */
function resolveMessage(
    req: Request,
    message: string,
    params?: Record<string, string | number>,
): string {
    try {
        const resolved = params ? req.t(message, params) : req.t(message);
        // 未命中 / 自由文本
        return typeof resolved === 'string' ? resolved : message;
    } catch {
        return message;
    }
}

/**
 * 客户端是否偏好 HTML 响应（据此决定纯文本片段 vs JSON）：
 *   - htmx 事务（带 hx-request 头）→ 纯文本片段；htmx.ajax() 发起的请求同样带此头。
 *   - 浏览器导航（Accept 含 text/html / application/xhtml+xml）→ 纯文本片段。
 *   - fetch / 第三方 API / curl → JSON。
 */
function wantsHtml(req: Request): boolean {
    return req.isHXRequest || prefersHtml(req);
}

/**
 * 客户端是否偏好 HTML。仅看 Accept 头，不含 htmx 判定：
 * 浏览器导航（直接访问 / 刷新）会带 text/html 或 application/xhtml+xml；
 * fetch / curl 等则通常带通配类型或 application/json。应与 req.isHXRequest 配合判断响应形态。
 */
function prefersHtml(req: Request): boolean {
    const accept = String(req.headers.accept ?? '');
    return accept.includes('text/html') || accept.includes('application/xhtml+xml');
}