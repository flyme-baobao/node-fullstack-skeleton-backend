import type { Request, Response } from 'express';
import type { WebContext } from '../adapter/webCtx.js';
import { createWebCtx } from '../adapter/webCtx.js';
import * as todoService from '../service/todo.service.js';
import { HttpError } from '../middleware/error.middleware.js';

/**
 * 待办控制器（controller）：
 * 只做「读请求 + 定响应」，业务判断一律下沉到 service。路由层薄薄一层委托到这里。
 * 通过 webCtx 适配器（而非直接操作 req/res）访问请求与响应，便于测试与换 Web 实现时复用。
 * 返回「partials/…」时，由 fragment.middleware 自动注入 layout:false 绕过外壳。
 * 本 controller 的具体 400/404/500 状态码映射统一见 server/src/routes.ts 的全局约定。
 */

/** GET /todos —— 待办列表局部片段（htmx 刷新 #todo-list） */
export function listFragment(req: Request, res: Response): void {
    const ctx = createWebCtx(req, res);
    ctx.render('partials/list', { todos: todoService.listTodos() });
}

/**
 * 解析并校验路径参数里的待办 id（/todos/:id）。
 * 要求：必须是「可转的、非负的整数」。非法（NaN / 小数 / 负数）时
 * 抛 HttpError(400)，交由全局 errorHandler 统一映射，不进入 service。
 */
function parseValidId(ctx: WebContext): number {
    const id = Number(ctx.params.id ?? '');
    if (!Number.isInteger(id) || id < 0) {
        // 40002 = invalid_id；status 由调用方定，code 属业务层并映射 i18n key
        throw new HttpError({ status: 400, code: 40002 });
    }
    return id;
}

/** POST /todos —— 新增待办并返回局部片段 */
export function createTodo(req: Request, res: Response): void {
    const ctx = createWebCtx(req, res);
    // 数据清洗：取字段 -> 兜底空串 -> 去首尾空白，交给 service 前已保证是「干净文本」
    const text = String(ctx.body?.text ?? '').trim();
    if (!text) {
        // 非法入参：空文本，直接拦截，不进入 service
        throw new HttpError({ status: 400, code: 40001 }); // 40001 todo_empty
    }

    const newItem = todoService.createTodo({ text });
    if (!newItem) {
        // 入参已清洗且非空，此处仍失败 = 服务端故障（持久化/底层异常）→ 500
        throw new HttpError({ status: 500, code: 50001 }); // 50001 create_failed
    }

    // 空 → 第一条：原来是空列表占位，必须整体替换才能去掉“暂无待办”
    if (todoService.countTodos() === 1) {
        ctx.setHeader('HX-Reswap', 'outerHTML'); // 覆盖 hx-swap="afterbegin"
        ctx.render('partials/list', { todos: todoService.listTodos() });
        return;
    }

    ctx.render('partials/item', newItem);
}

/** POST /todos/:id/toggle —— 切换完成状态，返回该条目局部片段 */
export function toggleTodo(req: Request, res: Response): void {
    const ctx = createWebCtx(req, res);

    // 数据清洗：非法 id（非数字）直接抛 400，不查库
    const id = parseValidId(ctx);

    const item = todoService.toggleTodo(id);
    if (!item) {
        throw new HttpError({ status: 404, code: 40401 }); // 40401 toggle_not_found，待切换的待办不存在
    }
    ctx.render('partials/item', item);
}

/** DELETE /todos/:id —— 删除待办 */
export function removeTodo(req: Request, res: Response): void {
    const ctx = createWebCtx(req, res);

    const id = parseValidId(ctx);

    // 校验 id 合法后删除；service 已把 status/code 拼进结果，controller 直接透传给 HttpError
    const result = todoService.removeTodo(id);
    if (!result.success) {
        const _defaultStatus = 500;
        throw new HttpError({ status: result.status ?? _defaultStatus, code: result.code ?? _defaultStatus });
    }

    if (todoService.countTodos() === 0) {
        // 删光最后一条：留 `#todo-list` 的空白占位回来
        ctx.set('HX-Retarget', '#todo-list'); // 覆盖 closest .todo-item
        ctx.setHeader('HX-Reswap', 'outerHTML'); // 覆盖 hx-swap="delete"
        ctx.render('partials/list', { todos: todoService.listTodos() });
        return;
    }
    ctx.status(200).end();
}