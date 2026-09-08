import { userService } from '@service/userService';
import { setCookie, deleteCookie } from './cookie';
import { getPath } from './url';
import {
    COOKIE_IS_AUTH_CHECKED,
    COOKIE_REDIRECT_PATH,
    AUTH_CHECKED_TRUE,
    AUTH_CHECKED_FALSE,
    COOKIE_X_SESSION_EXIST,
} from '@/constants/cookie';

/**
 * @description 跳转登录/注册前缓存认证状态与回跳路径
 *
 * 复用入口：bootstrapFlow.beforeRender、errorHandle（权限失效确认跳转）。
 * 设置 `is_auth_checked`、`redirect_path` 两个 Cookie；
 * 登录页面与登录成功回调 afterSigninSuccess 读取缓存，实现认证状态复用和页面回跳。
 *
 * @param authenticated 凭证探测结果
 * - true：写入 AUTH_CHECKED_TRUE。对应后端401/403权限失效，标记已完成探测，防止登录页重复校验。
 * - false：写入 AUTH_CHECKED_FALSE。本地无有效凭证，登录页需要重新执行认证探测。
 */
export function cacheRedirectAuth(authenticated: boolean): void {
    const authChecked = authenticated ? AUTH_CHECKED_TRUE : AUTH_CHECKED_FALSE;
    const redirectPath = getPath(new URL(window.location.href));
    setCookie(COOKIE_IS_AUTH_CHECKED, authChecked, { path: '/' });
    setCookie(COOKIE_REDIRECT_PATH, redirectPath, { path: '/' });
}

/**
 * @description 清除本地登录凭证与登录态探针
 *
 * 清空 localStorage token，删除非 httpOnly 的 X‑Session‑Exist 探针 Cookie。
 * httpOnly 类型 sessionId 前端无法移除，依赖服务端过期或登出销毁。
 * 移除探针后本地视作未登录；若请求依旧携带过期 sessionId，由后端返回401兜底拦截。
 */
export function clearAuth(): void {
    userService.clearToken();
    deleteCookie(COOKIE_X_SESSION_EXIST, { path: '/' });
}

/**
 * @description 清除登录跳转相关缓存 Cookie
 *
 * 缓存生命周期：非登录页面负责写入与清理（beforeRender 执行清除）。
 * 登录页仅读取缓存，不做写入、清除操作；依靠保留的 redirect_path，在 afterSigninSuccess 完成回跳。
 */
export function clearCache(): void {
    deleteCookie(COOKIE_IS_AUTH_CHECKED, { path: '/' });
    deleteCookie(COOKIE_REDIRECT_PATH, { path: '/' });
}