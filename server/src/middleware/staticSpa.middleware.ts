import path from 'node:path';
import express, { type Request, type Response, type NextFunction } from 'express';
import { clientDistDir } from '../paths.js';
import { API_PREFIX, PAGE_PREFIX } from '../constants/api.js';
import { logger } from '../utils/logger.js';

/**
 * 静态托管 + SPA 深链兜底中间件（生产单端口专用）。
 *
 * 职责（按挂载顺序）：
 *  1. `express.static`：把构建产物目录（dist-client）直接对外提供，
 *     命中 index.html、js/*.js、assets/*.css 等真实物理文件。
 *  2. SPA fallback：static 未命中时，对「浏览器导航类 GET」兜底返回 index.html，
 *     让前端 SPA 路由器重新开机、按地址栏路径渲染对应页（解决刷新 /list 等深链 404）。
 *
 * —— 依赖 serve-static 默认选项（DEFAULT_OPTIONS）分工 ——
 *  - `index: 'index.html'`：只对「目录型」请求（URL 以 / 结尾，如根路由 /）自动补 index.html；
 *    /list 这类深链不是目录、物理上也不存在 → index 不触发。
 *  - `fallthrough: true`：找不到资源就「不带参」调 next()，把控制权交给我们 → 才轮到 spaFallback。
 *    因此根路径靠 index、深链靠 fallthrough + spaFallback，二者配合才覆盖完整。
 *  - 其余默认（etag/lastModified 缓存、redirect 301 补斜杠、dotfiles:'ignore' 屏蔽 .env 等点文件）
 *    无需额外处理，按缺省即可。
 *
 * 受保护的重叠路径：
 *  - `/api`、`/page` 前缀：由 mountRoutes 内的后端路由处理。若这里的 fallback 先接管，
 *    会把它们吞成 index.html，所以必须显式放行后交给后续路由 → 404 或真正的处理。
 *    ⚠️ 因此本中间件要挂在 mountRoutes 之前（先静态、后业务），真路由才有机会命中。
 *
 * 边界：
 *  - 仅 GET：POST/PUT/DELETE 等不是页面导航，一律 next() 交给路由/404。
 *  - 带扩展名（path.extname 有值）= 静态资源请求，static 都没找到就让它 404，不接管。
 *
 * @returns 一个组合中间件（内部先 static 再 fallback）。
 */
export function serveStaticSpa(): (req: Request, res: Response, next: NextFunction) => void {
    const staticMiddleware = express.static(clientDistDir);

    return (req, res, next) => {
        // 先尝试静态文件。static 未命中时回调分两种：
        //   - 真错误（如权限）→ next(err)，err 有值，交给错误链；
        //   - 只是没找到文件（404，如 /list）→ 回调不带参，才轮到 spaFallback。
        // ⚠️ static 一旦命中真实文件并返回，就【不会】再调用回调（响应已发送，headersSent 必为 false）。
        staticMiddleware(req, res, (err?: unknown) => {
            if (err) {
                return next(err); // static 抛错（如权限）交给错误链
            }
            spaFallback(req, res, next);
        });
    };
}

/**
 * SPA 深链兜底：static 未命中时，若请求具备深链资格（内部用 isSpaFallbackCandidate 判定），
 * 回送 index.html 让前端 SPA 路由器接管；否则放行给后续路由/404。
 */
function spaFallback(req: Request, res: Response, next: NextFunction): void {
    if (!isSpaFallbackCandidate(req)) {
        logger.info('[spa-fallback] skip: not a candidate', { method: req.method, path: req.path });
        return next();
    }
    logger.info('[spa-fallback] HIT: send index.html', { path: req.path });
    res.sendFile(path.join(clientDistDir, 'index.html'));
}

/** 内部判定 util：该请求是否可能是 SPA 深链（导航类 GET + 非后端前缀 + 非静态资源）。 */
function isSpaFallbackCandidate(req: Request): boolean {
    if (req.method !== 'GET') {
        logger.debug('[spa-fallback] skip: non-GET', { method: req.method, path: req.path });
        return false;
    }
    const p = req.path;
    // 后端 handle 的路径放行，交给 mountRoutes 的路由（/api、/page）
    if ([API_PREFIX, PAGE_PREFIX].some((prefix) => p.startsWith(prefix))) {
        logger.debug('[spa-fallback] skip: backend prefix', { path: p });
        return false;
    }
    // 带扩展名 = 静态资源请求，static 没找到就该 404，不该被吞成 index.html
    if (path.extname(p)) {
        logger.debug('[spa-fallback] skip: has extname', { path: p });
        return false;
    }
    return true;
}