import type { Request, Response, NextFunction } from 'express';
import { getCookie } from '../utils/cookie.js';

/**
 * 每请求解析用户上下文，挂 req.userTimeZone / req.userLocale，下游直接读。
 * 学 requestId / i18nRequest 的「中间件解析一次、下游直接读」模式：
 * SSR 格式化时间的 controller 不再各自解析 cookie 头。
 *   - userTimeZone：读 browser_tz cookie（非法/缺失回落 UTC），格式化工具见 utils/userTime.ts；
 *   - userLocale：代理 req.language（i18next 探测结果，语言单一事实来源仍在 i18next），
 *     挂载需在 i18nRequest() 之后；别名存在的意义是让 controller 的语义对仗
 *     （formatUserDateTime(req, date)）。
 * cookie 解析函数在 utils/cookie.ts（纯解析，无业务语义）；本文件只留 cookie 名常量与业务校验。
 */

/** 承载浏览器时区的 cookie 名（client/index.html 首屏前同步写入） */
const BROWSER_TZ_COOKIE = 'browser_tz';

/** 校验时区字符串能否被 Intl 识别（cookie 可被客户端篡改，脏值会让 format 直接抛错） */
function isSupportedTimeZone(tz: string): boolean {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz });
        return true;
    } catch {
        return false;
    }
}

/** 从 Cookie 字符串提取用户时区：缺失/非法回落 'UTC' */
function resolveTimeZone(cookieHeader: string | undefined): string {
    const tz = getCookie(cookieHeader, BROWSER_TZ_COOKIE);
    return tz && isSupportedTimeZone(tz) ? tz : 'UTC';
}

export function userContext(req: Request, _res: Response, next: NextFunction): void {
    req.userTimeZone = resolveTimeZone(req.headers.cookie);
    req.userLocale = req.language;
    // 登录态派生标记（文档 §7）：authMiddleware 已先行校验凭证并写入 req.userId，
    // 这里只做布尔派生，不重查凭证；模板渲染经 locals 带给 EJS（未登录降级/引导面板用）
    req.isLogin = Boolean(req.userId);
    next();
}
