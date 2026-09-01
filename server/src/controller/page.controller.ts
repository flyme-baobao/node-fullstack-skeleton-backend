import type { Request, Response } from 'express';
import { createWebCtx } from '../adapter/webCtx.js';
import type { PageMeta } from '../views.js';
import { toClientPath } from '../views.js';
import { loadI18n } from '../i18n/locales.js';
import { listTodos } from '../service/todo.service.js';
import { sleep } from '../utils/sleep.js';

/**
 * 整页渲染控制器（controller）：
 * 每个页面路由（GET /<path>）统一委托到这里。职责是「加载 i18n + 组装渲染数据」，
 * 交给 res.renderPage 组合「内容 -> app-layout 应用外壳」。纯数据组装不涉业务逻辑，故不引入 service 层。
 * 通过 webCtx 适配器访问上下文，controller 不直接依赖 req/res。
 *
 * @param path 页面路径（用于 currentPage）
 * @param meta 页面注册表元信息（view/title，来自 PAGE_META）
 */
export function createPageHandler(path: string, meta: PageMeta) {
    return async (req: Request, res: Response): Promise<void> => {
        const ctx = createWebCtx(req, res);
        const lang = ctx.locals.currentLocale || 'zh-CN';
        const i18nJson = await loadI18n(lang);

        await sleep(200); // 模拟请求较慢场景，避免 htmx 请求太快，loading 遮罩一闪而过看不见

        await ctx.renderPage(meta.view, {
            title: meta.title,
            todos: listTodos(),
            i18nJson,
            // 纯 SPA：路由 key 带 /page 前缀，转成浏览器路径('/'、'/list')供 nav 高亮
            currentPage: toClientPath(path),
            // 渲染链：内容 -> app-layout 应用外壳（页面片段，注入 SPA 静态壳 index.html 的 #root）
            layouts: [{ tplName: 'layouts/app-layout', slotKey: 'outletContent' }],
        });
    };
}