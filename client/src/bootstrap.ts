import { initLoadingTemplate, showGlobalLoading, hideGlobalLoading } from './components/loading';
/**
 * 应用启动装配入口，DOMContentLoaded 里按序执行：
 *  0. initLoadingTemplate()   预载视口遮罩模板（幂等，为同步上屏铺路）
 *     showGlobalLoading()     视口覆盖遮罩（同步上屏；启动期反馈，首屏 swap 完成后由 htmx 生命周期收尾）
 *  1. initLanguagePack()      拉取当前语言包注入 window.I18n（供前端 t() 用）
 *  2. loadRoutes()            预取合法路由清单（供 SPA 路由守卫；失败放行）
 *  3. initHtmx()              加载 htmx.org → window.htmx，并挂载生命周期事件
 *  4. setupSpaRouter(htmx)    启动 SPA 路由（点击拦截 + pushState 补丁 + 首屏加载）
 *
 * 注：语言菜单位于 app-layout.ejs，随路由片段换进 #root，绑定由 afterSwap 统一触发；
 *     启动时 #root 为空壳，无需预绑。依赖：先有 window.htmx，才能初始化路由。
 *     遮罩关闭点：htmx:afterRequest target=#root（mountHtmxLifecycle）正常收尾；
 *     启动失败走本函数 catch、首屏导航网络失败走 spaRouter catch，均为兜底。
 */
async function bootstrap(): Promise<void> {
    // 预载视口遮罩模板（幂等）：启动最先执行，完成后下方 showGlobalLoading 才能同步上屏
    await initLoadingTemplate();
    
    // 视口覆盖遮罩（同步上屏）：此刻语言包尚未回填，文案沿用模板内置（见 components/loading.ts）
    showGlobalLoading();

    const { initLanguagePack } = await import('./i18n/language');
    const { initHtmx } = await import('./htmx/htmx');
    const { setupSpaRouter } = await import('./router/spaRouter');
    const { loadRoutes } = await import('./router/routes');

    try {
        // 首屏 #root 为空壳无容器可绑（见文件头注），此处无需 initLanguageSwitcher
        await initLanguagePack();

        // 认证表单客户端校验：document 级委托，注册一次即覆盖 SPA swap 后的动态表单
        const { initAuthFormValidation } = await import('./components/authForm');
        initAuthFormValidation();

        // 预热合法路由清单：供 SPA 路由守卫用。失败不影响启动（守卫放行）
        await loadRoutes();

        const htmx = await initHtmx();
        setupSpaRouter(htmx);
    } catch (err) {
        // 启动链路任一步失败：关闭遮罩避免卡死白屏（页面级错误反馈由 toast 链路负责）
        console.error('[bootstrap] 启动失败', err);
        hideGlobalLoading();
    }
}

window.addEventListener('DOMContentLoaded', () => {
    void bootstrap();
});