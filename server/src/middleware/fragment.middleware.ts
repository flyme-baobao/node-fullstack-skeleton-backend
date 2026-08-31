import type { Request, Response, NextFunction } from 'express';
import type { RenderOptions } from '../types/render.js';

/**
 * 获取htmx两个核心请求标记
 * 分别独立判断：优先读取req已挂载属性；不存在则解析http header兜底
 */
function getHtmxRequestFlags(req: Request): {
    isHXRequest: boolean;
    isHistoryRestore: boolean;
} {
    let isHXRequest: boolean;
    if (req.isHXRequest !== undefined) {
        isHXRequest = req.isHXRequest;
    } else {
        isHXRequest = !!req.headers['hx-request'];
    }

    let isHistoryRestore: boolean;
    if (req.isHistoryRestore !== undefined) {
        isHistoryRestore = req.isHistoryRestore;
    } else {
        isHistoryRestore = !!req.headers['hx-history-restore-request'];
    }

    return {
        isHXRequest,
        isHistoryRestore,
    };
}

/**
 * 计算是否需要片段渲染
 * 业务规则：
 * 1. 如果是history‑restore回退，直接返回false，强制完整页面
 * 2. htmx请求 或者 模板以partials/开头 → true，输出片段
 */
function calcIsFragmentRequest(req: Request, viewName: string): boolean {
    const { isHXRequest, isHistoryRestore } = getHtmxRequestFlags(req);

    if (isHistoryRestore) {
        return false;
    }

    const isPartialView = viewName.startsWith('partials/');
    return isHXRequest || isPartialView;
}

/**
 * 标准中间件：请求入口，解析headers挂载到req，并在res挂载工具方法
 * app.use(injectFragmentFlagMiddleware)
 */
export function injectFragmentFlagMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
): void {
    const { isHXRequest, isHistoryRestore } = getHtmxRequestFlags(req);

    req.isHXRequest = isHXRequest;
    req.isHistoryRestore = isHistoryRestore;
    req.isFragment = req.isHXRequest && !req.isHistoryRestore;

    // 闭包捕获当前req，挂载到res
    res.isFragmentRequest = (viewName: string): boolean => {
        return calcIsFragmentRequest(req, viewName);
    };

    next();
}

/**
 * 标准中间件：重写 res.render，自动注入 layout:false
 * app.use(fragmentRenderMiddleware)
 */
export function fragmentRenderMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
): void {
    const originalRender = res.render;

    res.render = function (
        this: Response,
        view: string,
        options?: RenderOptions | ((err: Error, html: string) => void),
        callback?: (err: Error, html: string) => void
    ): void {
        // 点击call重载解析的坑：用 bind 提前把 this 固定成 res，
        // 得到的签名仍是 Express 的 (view, options?, callback?)，参数类型检查保留
        const nativeRender = originalRender.bind(res);

        let locals: RenderOptions | undefined;
        let cb: ((err: Error, html: string) => void) | undefined;

        // 处理express render多态参数
        if (typeof options === 'function') {
            cb = options;
            locals = undefined;
        } else {
            locals = options;
            cb = callback;
        }

        const needFragment = this.isFragmentRequest(view);
        const finalLocals = locals ?? {};

        // 用户没有手动设置layout时，自动关闭layout
        if (needFragment && finalLocals.layout === undefined) {
            Object.assign(finalLocals, { layout: false });
        }

        // 交给 express 处理响应；bind 后 this 已固定为 res
        nativeRender(view, finalLocals, cb);
    };

    next();
}

/**
 * 保护partials路由中间件：禁止浏览器直接访问partial片段接口
 * app.use('/partials/{*splat}', protectPartialsRoute)
 */
export function protectPartialsRoute(
    req: Request,
    res: Response,
    next: NextFunction
): void {
    if (!req.isHXRequest) {
        res.status(403).send('Partial endpoint only allow htmx request');
        return;
    }
    next();
}
