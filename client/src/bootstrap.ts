/**
 * 应用启动装配入口，DOMContentLoaded 里按序执行：
 *  1. initLanguagePack()      拉取当前语言包注入 window.I18n（供前端 t() 用）
 *  2. loadRoutes()            预取合法路由清单（供 SPA 路由守卫；失败放行）
 *  3. initHtmx()              加载 htmx.org → window.htmx，并挂载生命周期事件
 *  4. setupSpaRouter(htmx)    启动 SPA 路由（点击拦截 + pushState 补丁 + 首屏加载）
 *
 * 注：语言菜单位于 app-layout.ejs，随路由片段换进 #root，绑定由 afterSwap 统一触发；
 *     启动时 #root 为空壳，无需预绑。依赖：先有 window.htmx，才能初始化路由。
 */
async function bootstrap(): Promise<void> {
    const { initLanguagePack } = await import('./i18n/language');
    const { initHtmx } = await import('./htmx/htmx');
    const { setupSpaRouter } = await import('./router/spaRouter');
    const { loadRoutes } = await import('./router/routes');

    // 首屏 #root 为空壳无容器可绑（见文件头注），此处无需 initLanguageSwitcher
    await initLanguagePack();

    // 预热合法路由清单：供 SPA 路由守卫用。失败不影响启动（守卫放行）
    await loadRoutes();

    const htmx = await initHtmx();
    setupSpaRouter(htmx);
}

window.addEventListener('DOMContentLoaded', () => {
    void bootstrap();
});