import type { Request, Response, NextFunction } from 'express';

/**
 * render-fragment 中间件：统一处理局部片段渲染。
 * 凡是 partials 模板都强制 layout:false，
 * 让 express-ejs-layouts 直接走原始 render、不套任何布局，
 * 返回可被 htmx 替换的纯片段。这样路由里就不必每一处都写 layout: false 了。
 *
 * ⚠️ 注册顺序：必须在 render-page 之前挂载（renderPage 内部会调用 res.render）。
 */
export default function fragmentRenderMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
): void {
    // 此时 res.render 已被 express-layouts 包装，转发时需保留 this（内部依赖 this.req）
    const layoutRender = res.render.bind(res);

    res.render = function (
        this: Response,
        view: string,
        options?: object | ((err: Error, html: string) => void),
        callback?: (err: Error, html: string) => void
    ): void {
        // 仅判断“视图名”：partials/ 开头的模板一律强制关闭外层布局
        if (view.startsWith('partials/') && typeof options !== 'function') {
            // 注入 layout:false，让 express-layouts 直接走原 render、不套布局
            return layoutRender(view, { ...(options ?? {}), layout: false }, callback);
        }
        // 其余（含 (view, callback) 调用形态）原样交还 express-layouts 处理
        if (typeof options === 'function') {
            return layoutRender(view, options);
        }
        return layoutRender(view, options, callback);
    };

    next();
}