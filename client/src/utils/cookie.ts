/**
 * Cookie 请求头解析（cookie.ts）
 *
 * 项目未上 cookie-parser 中间件：Express 原生不解析 cookie（req.cookies 是
 * cookie-parser 注入的），浏览器带来的 cookie 只存在于 req.headers.cookie
 * 原始字符串中，本函数负责「Cookie 头 → 键值对」这一纯解析。
 * 业务校验（如 browser_tz 的合法性）不在此处，由使用方按 cookie 名自行处理。
 */

/** 解析 Cookie 字符串为键值对；值 decodeURIComponent，非法编码原样保留（不因单个脏 cookie 影响其余键） */
export function parseCookies(): Record<string, string> {
    const cookies: Record<string, string> = {};
    if (!document.cookie) return cookies;
    for (const part of document.cookie.split(';')) {
        const idx = part.indexOf('=');
        if (idx === -1) continue;
        const key = part.slice(0, idx).trim();
        if (!key) continue;
        const raw = part.slice(idx + 1).trim();
        try {
            cookies[key] = decodeURIComponent(raw);
        } catch {
            cookies[key] = raw;
        }
    }
    return cookies;
}

/**
 * @description 取单个 cookie 值
 * @param name         cookie 名
 */
export function getCookie( name: string): string | undefined {
    return parseCookies()[name];
}

export function setCookie(name: string, value: string, options?: { 
    path?: string; expires?: Date; maxAge?: number; secure?: boolean; sameSite?: 'Strict' | 'Lax' | 'None'; 
}): void {
    let cookieStr = `${encodeURIComponent(name)}=${encodeURIComponent(value)}`;
    if (options) {
        if (options.path) {
            cookieStr += `; path=${options.path}`;
        }
        if (options.expires) {
            cookieStr += `; expires=${options.expires.toUTCString()}`;
        }
        if (options.maxAge) {
            cookieStr += `; max-age=${options.maxAge}`;
        }
        if (options.secure) {
            cookieStr += `; secure`;
        }
        if (options.sameSite) {
            cookieStr += `; samesite=${options.sameSite}`;
        }
    }
    document.cookie = cookieStr;
}

export function deleteCookie(name: string, options?: { path?: string; }): void {
    setCookie(name, '', { ...options, expires: new Date(0) });
}
