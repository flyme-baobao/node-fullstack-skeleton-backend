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
import { PAGE_PATHS } from '../views.js';

/** sessionId 的 Cookie 名（httpOnly，浏览器自动携带，前端 JS 不可读） */
export const SESSION_COOKIE = 'sessionId';

/** 前后端约定的目的是：Authorization: Bearer <token>（toki 名不做硬编码，由 httpFetch 统一处理） */

/** Redis key 前缀：token */
const TOKEN_PREFIX = 'auth:token:';

/** Redis key 前缀：session */
const SESSION_PREFIX = 'auth:session:';

/** Redis key 前缀：当前用户信息（userId → UserIdentity） */
export const CURRENT_USER_INFO_PREFIX = 'auth:current-user-info:';

/** token 有效期（秒）：2 小时 */
export const TOKEN_TTL_SECONDS = 60 * 60 * 2;

/** sessionId 有效期（秒）：7 天（与前端「到期自动重新登录」的 Cookie maxAge 对齐） */
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

/** 当前用户信息 有效期（秒）：60 分钟 */
export const CURRENT_USER_INFO_TTL_SECONDS = 60 * 60;

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
export function currentUserInfoKey(userId: string): string {
    return `${CURRENT_USER_INFO_PREFIX}${userId}`;
}

/**
 * Redis key 前缀：signin 限流失败计数，双维度双键：
 *   - 账号键 auth:signin-fail:<归一化账号>：同一账号跨全部设备的合计失败数；
 *   - 账号×IP 组合键 auth:signin-ip-fail:<归一化账号>:<clientIp>：同一账号在单台设备的失败数。
 * 组合键（而非纯 IP 键）语义：设备配额按「账号×设备」隔离，换账号即换键、设备配额重置，
 * 该绕过面由账号维度合计上限兜底；也避免 NAT 共享出口下无辜用户互相消耗同一个 IP 配额。
 */
const SIGNIN_FAIL_PREFIX = 'auth:signin-fail:';
const SIGNIN_ACCOUNT_IP_FAIL_PREFIX = 'auth:signin-ip-fail:';

/** 同一账号 15 分钟窗口内允许的最大失败次数（跨全部设备合计），超过即锁定 */
export const SIGNIN_MAX_ATTEMPTS = 10;

/** 同一账号×同一 IP 15 分钟窗口内允许的最大失败次数（单台设备配额），超过即锁定；紧于账号合计，单设备撞库先撞到它 */
export const SIGNIN_IP_MAX_ATTEMPTS = 5;

/** 登录失败计数窗口（秒）：15 分钟，从首次失败起算（固定窗口，不随失败顺延） */
export const SIGNIN_WINDOW_SECONDS = 15 * 60;

/** 由登录账号生成失败计数键：账号做 trim + 小写归一化，防大小写变体绕过计数 */
export function signinFailKey(account: string): string {
    return `${SIGNIN_FAIL_PREFIX}${account.trim().toLowerCase()}`;
}

/** 由登录账号 + 客户端 IP 生成设备维度失败计数键：账号做 trim + 小写归一化（与账号键同口径），IP 由 webCtx 兜底（'unknown'） */
export function signinIpFailKey(account: string, clientIp: string): string {
    return `${SIGNIN_ACCOUNT_IP_FAIL_PREFIX}${account.trim().toLowerCase()}:${clientIp}`;
}

/**
 * 页面级白名单：PAGE_META 登记的「整页 GET」全部放行（首页/清单壳/登录/注册），未登录可达。
 * 清单页放行的代价由 service 层数据降级承担：未登录时 listTodos 返回空数组、不查库，
 * 模板经 isLogin=false 渲染登录引导（文档 §7）——这里只拦请求，不做数据兜底；
 * GET /page/body（语言无感重绘）不在 PAGE_META，故不在其列 → 需鉴权（登录态功能）。
 */
export const ALLOWLIST_PAGES = [...PAGE_PATHS];

/**
 * auth 自身接口白名单（POST）：未登录发起注册/登录，必须放行（文档 §8.2「signin/signup 等白名单接口」）。
 * 注：GET /api/auth/me 不放行——由中间件保护，未登录返回 401（前端据此判定登录态）；
 *     /api/i18n、/api/change-language、/api/__routes 按文档 §3 均需鉴权，auth 页内的
 *     401 由前端「auth 页内静默」策略消化（见文档 §8.2）。
 */
export const ALLOWLIST_AUTH_POSTS = [
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
export function isAuthExemptPath(method: string, path: string): boolean {
    // 尾部斜杠归一化：Express 路由默认宽松匹配（/page/ 能命中 /page 的注册路由），
    // 而下方白名单是精确串比较——不归一化，/page/ 会被 401（views.ts 的 metaForPath
    // 已对尾斜杠兜底，两侧语义须一致）。根路径 '/' 不剥（避免变空串）。
    const normalized = path.length > 1 ? path.replace(/\/+$/, '') : path;
    if (!normalized.startsWith(API_PREFIX) && !normalized.startsWith(PAGE_PREFIX)) {
        return true;
    }
    if (method === 'GET' && ALLOWLIST_PAGES.includes(normalized)) {
        return true;
    }
    if (method === 'POST' && ALLOWLIST_AUTH_POSTS.includes(normalized)) {
        return true;
    }
    return false;
}