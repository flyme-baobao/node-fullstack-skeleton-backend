import type { Request, Response, NextFunction } from 'express';

/**
 * render-page 中间件：在 res 上挂载 res.renderPage(...)，一次性完成
 * 「页面内容 + app-layout 外壳」两层嵌套。
 *
 *   - 整页  (pageLayout = true)：内容 -> app-layout.ejs -> 由 express-ejs-layouts 套外层布局（layout.ejs）
 *   - 片段  (pageLayout = false)：内容 -> app-layout.ejs（不套 layout.ejs，供语言切换 /body 整块替换 #root）
 *   - 业务路由统一用 res.renderPage('视图', { ... })，不必再手写两层嵌套。
 *
 * ⚠️ 注册顺序：必须在 render-fragment 之后挂载。
 */
export default function renderPageMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
): void {
    res.renderPage = async function (
        pageView: string,
        options: Record<string, any> = {}
    ): Promise<void> {
        const {
            pageShell = 'layouts/app-layout',
            pageShellSlot = 'outletContent',
            pageLayout = true,
            layout = (pageLayout ? 'layouts/layout' : false) as string | boolean,
            ...pageOptions
        } = options;

        try {
            // ① 先把页面内容渲成纯字符串
            const contentHtml = await new Promise<string>((resolve, reject) => {
                res.render(pageView, { ...pageOptions, layout: false }, (err, html) => {
                    if (err) reject(err);
                    else resolve(html);
                });
            });
            // ② 再用 app-layout 外壳包裹内容；layout 决定继续套哪个外层布局
            // 不传回调 → Express 自动 send + 自动 caught 错误进 next(err)
            res.render(
                pageShell as string,
                {
                    ...pageOptions,
                    [pageShellSlot]: contentHtml,
                    layout,
                },
            );
        } catch (err) {
            return next(err);
        }
    };

    next();
}