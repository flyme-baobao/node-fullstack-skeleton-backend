import type { Request, Response, NextFunction } from 'express';
import type { LayoutLayer, RenderPageOptions } from '../types/render.js';

/**
 * 将 res.render promisify，获取渲染后的html字符串
 * 注意：本渲染链路全程不套外层布局（layout:false），完整 html 壳由 Vite 产出的 index.html 承担。
 */
function renderToHtml(res: Response, view: string, locals: Record<string, any>): Promise<string> {
    return new Promise((resolve, reject) => {
        res.render(view, locals, (err, html) => {
            if (err) return reject(err);
            resolve(html);
        });
    });
}

/**
 * renderPageMiddleware
 *
 * 核心逻辑：
 * 1. 先渲染业务页面，layout:false 拿到初始html片段
 * 2. 遍历layouts数组：
 *    - 非最后一层：renderToHtml 获取字符串，循环拼装，layout强制false
 * 3. layouts为空时直接输出业务页面html
 *
 * @example
 * res.renderPage('admin/dashboard', {
 *   layouts: [
 *     { tplName: 'admin/wrapper', slotKey: 'innerHtml' },
 *     { tplName: 'app-layout', slotKey: 'outletContent' }
 *   ],
 *   title: '管理后台'
 * })
 */
export default function renderPageMiddleware(req: Request, res: Response, next: NextFunction) {
    /**
     * @param pageView 业务页面模板路径
     * @param options 渲染配置与locals变量
     */
    res.renderPage = async function renderPage(pageView: string, options: RenderPageOptions) {
        const {
            layouts = [],
            pageShell = 'layouts/app-layout',
            pageShellSlot = 'outletContent',
            ...pageOptions
        } = options;

        let stack: LayoutLayer[] = [...layouts];

        // 缺省外壳：未传 layouts 时，用 pageShell/pageShellSlot 兜底为单层壳
        if (Array.isArray(layouts) && layouts.length === 0 && pageShell && pageShellSlot) {
            stack = [{ tplName: pageShell, slotKey: pageShellSlot }];
        }

        try {
            // 渲染业务页面本体，关闭布局，拿到原始html片段
            let currentHtml = await renderToHtml(res, pageView, {
                ...pageOptions,
                layout: false
            });

            for (const layout of stack) {
                const { tplName, slotKey } = layout;
                currentHtml = await renderToHtml(res, tplName, {
                    ...pageOptions,
                    [slotKey]: currentHtml,
                    layout: false
                });

                res.status(200).type('html').send(currentHtml);
                // 直接返回，防止执行到 catch / res.send 造成重复响应
                return;
            }

            // layouts为空：没有任何外壳，直接输出业务页面渲染结果
            res.send(currentHtml);

        } catch (err) {
            next(err);
        }
    };

    next();
}