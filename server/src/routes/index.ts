import { pagesRouter } from './pages.js';
import { localeRouter } from './locale.js';
import { listRouter } from './list.js';
import { routesManifestRouter } from './routes-manifest.js';
import { authRouter } from './auth.js';
import type { Express } from 'express';
import { notFoundHandler, errorHandler } from '../middleware/error.middleware.js';

/**
 * 挂载业务路由到 app（全局路由装配入口，测试端与生产端都经由 mountRoutes）。
 *
 * 错误处理：
 *   - 业务错误：controller 抛 `new HttpError(status, message)`，由 errorHandler 统一映射其状态码。
 *   - 渲染管道真实异常：`nativeRender` / `renderPageMiddleware` 走 `next(err)`，同样到 errorHandler。
 *   - 未命中路由：notFoundHandler 兜底 404。
 *   ⚠️ 顺序要求：先挂业务/路由，再 notFoundHandler，最后 errorHandler（必须最后，靠 4 参签名识别）。
 */
export function mountRoutes(app: Express): void {
    // 鉴权：注册 / 登录 / me（signup/signin 已在 auth.middleware 白名单放行）
    app.use('/', authRouter);

    // 业务路由: 整页渲染 / 局部渲染 / 列表数据 / 路由清单 /切换语言
    app.use('/', pagesRouter);
    app.use('/', localeRouter);
    app.use('/', listRouter);
    app.use('/', routesManifestRouter);
    
    // 兜底：所有未命中路由的请求 → 404
    app.use(notFoundHandler);
    // 全局错误：Express 渲染/controller 抛错 → 状态码响应（须放在所有路由与 notFound 之后）
    app.use(errorHandler);
}