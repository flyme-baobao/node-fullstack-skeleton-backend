import type { Request, Response } from 'express';
import { createWebCtx } from '../adapter/webCtx.js';
import { SUPPORTED_LANGUAGES, loadI18n } from '../i18n/locales.js';
import { metaForPath, toClientPath } from '../views.js';
import { listTodos } from '../service/todo.service.js';
import { HttpError } from '../middleware/error.middleware.js';
import { ERROR_DEFS } from '../i18n/error-defs.js';
import { sleep } from '../utils/sleep.js';

/**
 * 语言会话控制器（controller）：
 * 承载 locale 路由（语言切换 / 无感重绘）的处理逻辑；同样只做数据组装，不引入 service 层。
 * 通过 webCtx 适配器访问上下文，controller 不直接依赖 req/res。
 * 业务错误统一抛 HttpError，由全局 errorHandler 映射状态码（本路由须经 asyncHandler 包裹）。
 */

/** GET /i18n —— 纯 SPA 首屏语言包注入：读当前探测语言，返回语言包（不写 cookie） */
export async function getI18n(req: Request, res: Response): Promise<void> {
    const ctx = createWebCtx(req, res);
    const lang = ctx.locals.currentLocale || 'zh-CN';
    const i18nJson = await loadI18n(lang);
    ctx.status(200).json({ lang, i18nJson });
}

/** POST /change-language —— 语言切换：校验语言码、写 cookie、返回最新语言包 */
export async function changeLanguage(req: Request, res: Response): Promise<void> {
    const ctx = createWebCtx(req, res);
    const lang = String(ctx.body?.lang || '');
    if (!SUPPORTED_LANGUAGES.includes(lang)) {
        throw new HttpError({
            ...ERROR_DEFS.unsupported_lang,
            params: { lang },
        });
    }
    ctx.cookie('lang', lang, { httpOnly: false, path: '/' });
    const i18nJson = await loadI18n(lang);
    ctx.status(200).json({ i18nJson, isSuccess: true });
}

/**
 * GET /body — 语言无感切换：按当前 path 重绘 app-layout 片段（不套其他壳，由 SPA 静态壳承载），
 * 供 htmx 整块替换 #root。前端会带 ?path=<location.pathname>，据此还原“当前页”。
 */
export async function renderBody(req: Request, res: Response): Promise<void> {
    const ctx = createWebCtx(req, res);
    const lang = ctx.locals.currentLocale || 'zh-CN';
    const i18nJson = await loadI18n(lang);
    const meta = metaForPath(ctx.query.path);

    await sleep(200); // 模拟请求较慢场景，避免 htmx 请求太快，loading 遮罩一闪而过看不见

    const todos = await listTodos(ctx.userContext);
    await ctx.renderPage(meta.view, {
        title: meta.title,
        todos,
        i18nJson,
        // 纯 SPA：/body 的 path 参带 /page 前缀，转成浏览器路径('/'、'/list')供 nav 高亮
        currentPage: toClientPath(ctx.query.path || '/'),
    });
}