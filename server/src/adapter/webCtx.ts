// src/adapter/webCtx.ts
import type { Request, Response, CookieOptions } from 'express';
import type { RenderPageOptions } from '../types/render.js';
export type UserContext = {
  /** 用户语言区域，如 zh‑CN / en‑US */
  userLocale: string;
  /** IANA 时区标识符，如 Asia/Shanghai、Etc/UTC */
  userTimeZone: string;
  /** 当前登录用户id，未登录可为 undefined */
  userId?: string;
};

/**
 * 标准化 Web 上下文（WebContext）。
 *
 * 作用：把 controller 层从「直接操作 req / res」解耦出来，改用一个统一的上下文对象。
 * - 请求侧：params / query / body / locals（读入参）
 * - 响应侧：status / send / json / sendHtml / render / renderPage / set / setHeader / cookie / end
 *
 * 这样 controller 不依赖具体的 Express 类型，将来要换成别的 Web 框架（Hono、Fastify…）
 * 只需提供同一个 createWebCtx 的实现即可，业务控制器不用改。
 * 所有「写响应」方法都返回 this，支持链式调用（如 ctx.status(400).json(...)）。
 */
export type WebContext = {
    // ---- 请求侧（只读入参）----
   /** 路径参数，如 /todos/:id -> { id: '1' } */
    params: Record<string, string | string[]>;
    /** 查询参数（可能多值） */
    query: Record<string, string | string[]>;
    /** 请求体（express.json / urlencoded 解析后的对象） */
    body: any;
    /** 请求级共享变量（对应 res.locals，如 currentLocale） */
    locals: Record<string, any>;
    userContext: UserContext;

    // ---- 响应侧 ----
    /**
     * 设置 HTTP 状态码，返回 this 支持链式。
     * 之后调 send/json/end 时使用此状态码。
     */
    status(code: number): WebContext;
    /** 发送纯文本 / 任意响应体 */
    send(body?: any): WebContext;
    /** 发送 JSON 响应体 */
    json(body: any): WebContext;
    /** 发送 HTML 片段（method 用于 htmx 片段接口） */
    sendHtml(html: string): WebContext;
    /** 渲染单个视图（局部片段，走 fragment.middleware 自动注入 layout:false） */
    render(view: string, data?: any): void;
    /** 多层布局组装渲染（整页 / /body 无感重绘） */
    renderPage(view: string, options: RenderPageOptions): Promise<void>;
    /** 设置单个响应头（如 HTMX 指令 HX-Reswap / HX-Retarget） */
    setHeader(name: string, value: string): WebContext;
    set(name: string, value: string): WebContext;
    /** 设置 cookie，options 必填（如 httpOnly / path / maxAge） */
    cookie(name: string, value: string, options: CookieOptions): WebContext;
    /** 结束响应（无响应体，如 DELETE 成功分支） */
    end(): WebContext;
};

/**
 * Express 适配层：把 req / res 包装成标准化 WebContext。
 * 设计：内部保存 `statusCode`，由 status() 写入，send/json/end 统一消费，
 * 其余方法直接委托给 res 对应能力。
 */
export function createWebCtx(req: Request, res: Response): WebContext {
    /** 本次请求待发送状态码（默认 200） */
    let statusCode = 200;

    const ctx: WebContext = {
        params: req.params,
        query: req.query as Record<string, string | string[]>,
        body: req.body,
        locals: res.locals,
        userContext: {
            userLocale: req.userLocale,
            userTimeZone: req.userTimeZone,
            userId: req.userId,
        },
        status: (code) => {
            statusCode = code;
            return ctx;
        },
        send: (body) => {
            res.status(statusCode).send(body);
            return ctx;
        },
        json: (body) => {
            res.status(statusCode).json(body);
            return ctx;
        },
        sendHtml: (html) => {
            res.status(statusCode).type('html').send(html);
            return ctx;
        },
        render: (view, data) => {
            res.render(view, data);
        },
        renderPage: (view, options) => res.renderPage(view, options),
        setHeader: (name, value) => {
            res.setHeader(name, value);
            return ctx;
        },
        set: (name, value) => {
            res.set(name, value);
            return ctx;
        },
        cookie: (name, value, options) => {
            res.cookie(name, value, options);
            return ctx;
        },
        end: () => {
            res.status(statusCode).end();
            return ctx;
        },
    };

    return ctx;
}