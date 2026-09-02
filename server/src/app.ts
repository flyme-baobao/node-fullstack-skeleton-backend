import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initI18n } from './i18n/config.js';
import { i18nRequest, localeBridge } from './middleware/i18n.middleware.js';
import { requestId } from './middleware/requestId.middleware.js';
import { userContext } from './middleware/user-context.middleware.js';
import renderPageMiddleware from './middleware/render.middleware.js';
import {
    injectFragmentFlagMiddleware,
    fragmentRenderMiddleware,
    protectPartialsRoute,
} from './middleware/fragment.middleware.js';
import type { Express } from 'express';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 创建 Express 应用（不含路由与前端中间件）。
 * 这样测试端可通过 createApp() + mountRoutes() 直接组合，
 * 生产端通过静态目录，开发端由 index.js 注入 Vite middleware。
 */
export async function createApp(): Promise<Express> {
    const app = express();

    // 视图引擎
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, 'views'));

    // 视图可见标志：开发(true) 由 Vite 提供前端资源；生产(false) 用 dist 静态资源
    app.locals.isDev = process.env.NODE_ENV !== 'production';

    // 请求体解析
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    await initI18n(); // i18next 初始化（语言包 / 语言探测规则），见 middleware/i18n.middleware.js

    // 每个请求一个 requestId，回写 X-Request-Id；放在 body 解析之后、业务之前，
    // 让后续路由与 errorHandler 都能拿到 req.id 用于结构化日志串连。
    app.use(requestId);

    app.use(i18nRequest()); // ① 每请求解析语言，挂 req.t() / req.i18n

    // 每请求挂用户上下文：req.userTimeZone（browser_tz cookie）+ req.userLocale（代理 req.language）；
    // 依赖 i18next 已探测好 req.language，故必须在 i18nRequest() 之后
    app.use(userContext);

    // ② 把 req.t 桥接到 res.locals，EJS 模板（含 partials）才能直接用 <%= t('...') %>
    app.use(localeBridge);

    // htmx 请求标记：先注入标记，再重写 render，最后挂 partials 保护
    // ⚠️ 顺序不能乱：inject -> fragmentRender -> protectPartials
    app.use(injectFragmentFlagMiddleware);
    app.use(fragmentRenderMiddleware);
    app.use('/partials/{*splat}', protectPartialsRoute);
    // 页面组装渲染器（res.renderPage）：整页 / 片段 由 render.middleware 内部完成
    app.use(renderPageMiddleware);
    
    return app;
}