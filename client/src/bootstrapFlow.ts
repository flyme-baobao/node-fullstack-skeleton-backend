import { initLoadingTemplate, showGlobalLoading, hideGlobalLoading } from '@components/loading';
import { deleteCookie, getCookie, setCookie } from '@/utils/cookie';
import {
    COOKIE_X_SESSION_EXIST,
    COOKIE_REDIRECT_PATH,
    COOKIE_IS_AUTH_CHECKED,
    AUTH_CHECKED_TRUE,
    AUTH_CHECKED_FALSE,
    SESSION_EXIST_TRUE,
} from '@/constants/cookie';
import { userService } from './service/userService';
import { getUserInfo } from './api/auth.api';
import { SIGNIN_PATH, SIGNUP_PATH } from '@constants/api';
import { getPath } from './utils/url';
/**
 * 顶层应用启动编排入口 bootstrapFlow
 * 执行时序：
 * 1. 等待 DOMContentLoaded DOM树构建完成
 * 2. beforeRender：启动阶段鉴权预检，凭证校验、预跳转逻辑
 * 3. mountApp：初始化应用组件（loading模板、i18n、表单校验、htmx、spa路由）
 *
 * 注意：
 * - beforeRender 仅做启动期鉴权预检；业务页面权限拦截交给 spaRouter 路由守卫
 * - mountApp 使用 void 异步后台执行，不阻塞 bootstrapFlow；内部自带异常兜底
 * - 遮罩关闭：正常场景由 htmx:afterRequest(target=#root) 生命周期关闭；异常分支手动 hideGlobalLoading
 */

/**
 * mountApp：应用组件初始化
 * 职责：加载loading模板、语言包、表单校验委托、htmx、spa‑router；不负责鉴权与流程跳转
 * 内部执行步骤：
 *  0. initLoadingTemplate()   预载视口遮罩模板（幂等，为同步上屏铺路）
 *     showGlobalLoading()     弹出全局启动loading遮罩
 *  1. initLanguagePack()      拉取当前语言包注入 window.I18n（供 t() 函数使用）
 *  2. loadRoutes()            预拉取合法路由清单，供SPA路由守卫，失败不阻断启动
 *  3. initHtmx()              初始化 htmx，挂载全局生命周期事件
 *  4. setupSpaRouter(htmx)    启动SPA路由：a标签点击拦截、pushState补丁、首屏渲染
 *
 * 注：语言菜单位于 app‑layout.ejs，随路由片段置换 #root，绑定交由 afterSwap 统一触发；
 *     启动阶段 #root 为空壳，无需提前绑定。依赖 window.htmx 实例完成路由初始化。
 *     异常兜底：函数内部catch捕获初始化异常，关闭loading遮罩避免卡死白屏。
 */
async function mountApp(): Promise<void> {
    // 预载视口遮罩模板（幂等）：启动最先执行，完成后下方 showGlobalLoading 才能同步上屏
    await initLoadingTemplate();
    
    // 视口覆盖遮罩（同步上屏）：此刻语言包尚未回填，文案沿用模板内置（见 components/loading.ts）
    showGlobalLoading();

    const { initLanguagePack } = await import('@api/language.api');
    const { initHtmx } = await import('./htmx');
    const { setupSpaRouter } = await import('@router/spaRouter');
    const { loadRoutes } = await import('@router/routes');

    try {
        // 首屏 #root 为空壳无容器可绑（见文件头注），此处无需 initLanguageSwitcher
        await initLanguagePack();

        // 表单校验统一挂载：原生 required 气泡文案覆盖（data-required-msg）+ 认证表单校验，
        // 均为 document 级委托，SPA swap 后的动态表单同样生效
        const { initNativeValidity, initAuthFormValidation } = await import('./components/validForm');
        initNativeValidity();
        initAuthFormValidation();

        // 预热合法路由清单：供 SPA 路由守卫用。失败不影响启动（守卫放行）
        await loadRoutes();

        const htmx = await initHtmx();
        setupSpaRouter(htmx);
    } catch (err) {
        // 启动链路任一步失败：关闭遮罩避免卡死白屏（页面级错误反馈由 toast 链路负责）
        console.error('[mountApp] 组件初始化失败', err);
        hideGlobalLoading();
    }
}


const SIGN_PATHS = [SIGNUP_PATH, SIGNIN_PATH];

// 凭证失效清理：localStorage token + 登录态探针 cookie（X-Session-Exist，非 httpOnly 可删）。
// httpOnly 的 sessionId 前端删不掉，只能等服务端过期/登出清除；探针删除后本地即视为未登录，
// 后续请求若仍携带过期 sessionId，由后端 401 兜底。
const clearAuth = () => {
    userService.clearToken();
    deleteCookie(COOKIE_X_SESSION_EXIST, { path: '/' });
}

// 缓存 cookie 仅由非登录页管理：启动时清除、跳转前写入（见 beforeRender 末尾）。
// 登录页是纯消费方——不清不写，保留 redirect_path 供登录成功（afterSigninSuccess）跳回原目标页。
const clearCache = () => {
    deleteCookie(COOKIE_IS_AUTH_CHECKED, { path: '/' });
    deleteCookie(COOKIE_REDIRECT_PATH, { path: '/' });
}

/**
 * beforeRender：启动阶段鉴权预检
 * 本地凭证 = X-Session-Exist 探针 cookie（sessionId 为 httpOnly 不可读）或 localStorage token；
 * 持有凭证时调用 getUserInfo 向后端校验会话有效性（顺带刷新短时效 token）；
 * 完成鉴权标记cookie写入，执行预跳转逻辑。
 * 注意：当前执行时机早于 mountApp，此时 htmx、spaRouter 尚未初始化；
 */
const beforeRender = async (): Promise<void> => {
    // 登录态探针：sessionId httpOnly 不可读，读后端同步下发的 X-Session-Exist
    const sessionExist = getCookie(COOKIE_X_SESSION_EXIST) === SESSION_EXIST_TRUE;
    const is_auth_checked = getCookie(COOKIE_IS_AUTH_CHECKED) === AUTH_CHECKED_TRUE;
    const redirectPath = getCookie(COOKIE_REDIRECT_PATH) || '/';
    const token = userService.getToken();
    const pathName = window.location.pathname;

    const hasCredential = !!(sessionExist || token);

    const isSignPath = SIGN_PATHS.includes(pathName);

    if (!isSignPath) {
        clearCache();
    }
    
    if ((!isSignPath || !is_auth_checked) && hasCredential) {
        try {
            const userInfo = await getUserInfo();
            if (userInfo?.user) {
                if (isSignPath) {
                    window.location.href = redirectPath; // 强制刷新页面，确保 SPA 路由正确加载
                } else {
                    userService.setCurrentUser(userInfo.user, userInfo.token);
                }
                return;
            } else {
                clearAuth();
            }
        } catch (error) {
            console.warn('[beforeRender] getUserInfo 校验失败', error);
            // 会话失效，清理本地凭证
            clearAuth();
        }
    }

    
    if (isSignPath) return; // 已在登录/注册页：无需重新写缓存，也不跳转
    
    // 非登录页（业务页）：本次已探测过鉴权 + 记录当前页为登录后跳转目标
    const is_auth_checked_val = hasCredential ? AUTH_CHECKED_TRUE : AUTH_CHECKED_FALSE;
    const nextRedirectPath = getPath(new URL(window.location.href));

    setCookie(COOKIE_IS_AUTH_CHECKED, is_auth_checked_val, { path: '/' });
    setCookie(COOKIE_REDIRECT_PATH, nextRedirectPath, { path: '/' });

    window.location.href = hasCredential ? SIGNIN_PATH : SIGNUP_PATH; // 强制刷新页面，确保 SPA 路由正确加载
};


const domContentLoadedHandler = () => {
    if (document.readyState !== 'loading') {
        return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
        window.addEventListener('DOMContentLoaded', () => {
            resolve();
        });
    });
};


const bootstrapFlow = async (): Promise<void> => {
    await domContentLoadedHandler();
    await beforeRender();
    void mountApp();
}

bootstrapFlow().catch((err) => {
    console.error('[bootstrapFlow] 启动失败', err);
    hideGlobalLoading();
});
