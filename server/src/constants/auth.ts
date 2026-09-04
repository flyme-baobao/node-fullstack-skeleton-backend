/**
 * 鉴权常量（constants/auth.ts）
 *
 * 凭证协议的唯一事实来源：
 *   - sessionId Cookie 名 / token 存储键 / Redis key 前缀 / TTL。
 * 双侧（中间件解析、service 签发）都从本文件取，避免魔法串散落。
 * 注意：authorized Cookie 名（SID_COOKIE）与前端 localStorage 键名约定不在本文件，
 *       前端侧键见 client/src/auth/session.ts。
 */
import { PAGE_PREFIX, API_PREFIX } from './api.js';

/** sessionId 的 Cookie 名（httpOnly，浏览器自动携带，前端 JS 不可读） */
export const SESSION_COOKIE = 'sessionId';

/** 前后端约定的目的是：Authorization: Bearer <token>（toki 名不做硬编码，由 httpFetch 统一处理） */

/** Redis key 前缀：token */
const TOKEN_PREFIX = 'auth:token:';

/** Redis key 前缀：session */
const SESSION_PREFIX = 'auth:session:';

/** token 有效期（秒）：2 小时 */
export const TOKEN_TTL_SECONDS = 60 * 60 * 2;

/** sessionId 有效期（秒）：7 天（与前端「到期自动重新登录」的 Cookie maxAge 对齐） */
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

/** sessionId Cookie 的 maxAge（毫秒，Express cookie 用） */
export const SESSION_COOKIE_MAX_AGE_MS = SESSION_TTL_SECONDS * 1000;

/** 由 token 生成 Redis 存储键 */
export function tokenKey(token: string): string {
    return `${TOKEN_PREFIX}${token}`;
}

/** 由 sessionId 生成 Redis 存储键 */
export function sessionKey(sessionId: string): string {
    return `${SESSION_PREFIX}${sessionId}`;
}

/**
 * 页面级白名单：PAGE_META 登记的「整页 GET」，未登录也放行（渲染壳/表单/列表壳）。
 * 数据类整页（/page/todos、/page/body）不在其列 → 需鉴权（未登录时页面内数据由后端降级，见文档 §7）。
 */
export const PUBLIC_PAGES = [
    `${PAGE_PREFIX}`,
    `${PAGE_PREFIX}/list`,
    `${PAGE_PREFIX}/signin`,
    `${PAGE_PREFIX}/signup`,
];

/**
 * auth 自身接口白名单（POST）：未登录发起注册/登录，必须放行（文档 §8.2「signin/signup 等白名单接口」）。
 * 注：GET /api/auth/me 不放行——由中间件保护，未登录返回 401（前端据此判定登录态）；
 *     /api/i18n、/api/change-language、/api/__routes 按文档 §3 均需鉴权，auth 页内的
 *     401 由前端「auth 页内静默」策略消化（见文档 §8.2）。
 */
export const PUBLIC_AUTH_POSTS = [
    '/api/auth/signup',
    '/api/auth/signin',
];

/**
 * 单一白名单判定（文档 §6.1 流程的谓词化）：
 *   1. 非 /api/** 且非 /page/**（静态资源 / SPA 壳 / partials）→ 放行；
 *   2. GET 命中公开整页 → 放行；
 *   3. POST 命中 auth 注册登录接口 → 放行；
 *   其余一律要求鉴权。
 */
export function isPublicPath(method: string, path: string): boolean {
    if (!path.startsWith(API_PREFIX) && !path.startsWith(PAGE_PREFIX)) {
        return true;
    }
    if (method === 'GET' && PUBLIC_PAGES.includes(path)) {
        return true;
    }
    if (method === 'POST' && PUBLIC_AUTH_POSTS.includes(path)) {
        return true;
    }
    return false;
}