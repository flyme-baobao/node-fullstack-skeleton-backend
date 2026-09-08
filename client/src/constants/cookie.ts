/**
 * Cookie 键名常量（cookie.ts）
 *
 * 前端读写 cookie 的键名唯一事实来源。后端 Set-Cookie 的键名（如 sessionId）
 * 由服务端 auth 常量定义，此处仅约束「前端 getCookie/setCookie/deleteCookie 用到的键」，
 * 避免散落的字符串字面量拼错导致鉴权/跳转静默失效。
 *
 * httpOnly 约束：会话凭证 sessionId 为 httpOnly Cookie，前端 JS 读不到也删不掉；
 * 因此后端 signin 时同步下发可读的登录态探针 X-Session-Exist（非凭证），
 * 前端一切「本地是否已登录」的判断都基于探针，真实校验一律走后端 getUserInfo。
 */

/**
 * 会话凭证 cookie（sessionId）：httpOnly，服务端 Set-Cookie 下发，前端 JS 不可读——
 * 故不定义前端常量（下行保留注释仅作对照），登录态探测改用下面的 X-Session-Exist。
 */
// export const COOKIE_SESSION_ID = 'sessionId';

/**
 * 登录态探针 cookie：服务端 signin 时与 sessionId 一同下发（非 httpOnly，前端可读），
 * 与 sessionId 同生命周期。仅用于探测「浏览器是否种过会话」，非凭证、不参与鉴权；
 * 会话失效时由 clearAuth 删除（httpOnly 的 sessionId 只能由服务端过期/清除）。
 */
export const COOKIE_X_SESSION_EXIST = 'X-Session-Exist';
export const SESSION_EXIST_TRUE = '1';

/** 登录/注册成功后的跳转目标路径：beforeRender 写入，afterSigninSuccess 读取并清除 */
export const COOKIE_REDIRECT_PATH = 'redirect_path';

/** 鉴权探测标记：'1' 表示本次会话已探测过 /api/auth/me，避免每次路由都重复探测 */
export const COOKIE_IS_AUTH_CHECKED = 'is_auth_checked';

/** is_auth_checked 的取值：已探测 / 未探测 */
export const AUTH_CHECKED_TRUE = '1';
export const AUTH_CHECKED_FALSE = '0';