import type { Request, Response } from 'express';
import type { WebContext } from '../adapter/webCtx.js';
import { createWebCtx } from '../adapter/webCtx.js';
import * as todoService from '../service/todo.service.js';
import { HttpError } from '../middleware/error.middleware.js';
import { ERROR_CODES } from '../i18n/error-codes.js';
import { sleep } from '../utils/sleep.js';

/**
 * 待办控制器（controller）：
 * 只做「读请求 + 定响应」，业务判断一律下沉到 service。路由层薄薄一层委托到这里。
 * 通过 webCtx 适配器（而非直接操作 req/res）访问请求与响应，便于测试与换 Web 实现时复用。
 * 返回「partials/…」时，由 fragment.middleware 自动注入 layout:false 绕过外壳。
 * 本 controller 的具体 400/404/500 状态码映射统一见 server/src/routes.ts 的全局约定。
 */

/** 模拟数据库延迟（毫秒）：本机响应太快，loading 遮罩一闪而过看不见，用 sleep 模拟真实数据库 IO。
 *  默认 500ms，环境变量 SIMULATE_DB_LATENCY_MS 可覆盖（设 0 关闭）；生产（NODE_ENV=production）强制为 0。 */
const DB_LATENCY_MS =
    process.env.NODE_ENV === 'production'
        ? 0
        : Number(process.env.SIMULATE_DB_LATENCY_MS ?? 500);

/** GET /todos —— 待办列表局部片段（htmx 刷新 #todo-list） */
export async function listFragment(req: Request, res: Response): Promise<void> {
    const ctx = createWebCtx(req, res);

    await sleep(DB_LATENCY_MS); // 模拟数据库查询

    const todos = await todoService.listTodos(ctx.userContext);
    ctx.render('partials/list', { todos });
}

/**
 * 解析并校验路径参数里的待办 id（/todos/:id）。
 * 要求：必须是「可转的、非负的整数」。非法（NaN / 小数 / 负数）时
 * 抛 HttpError(400)，交由全局 errorHandler 统一映射，不进入 service。
 */
function parseValidId(ctx: WebContext): number {
    const id = Number(ctx.params.id ?? '');
    if (!Number.isInteger(id) || id < 0) {
        // status 由调用方定，code 属业务层并映射 i18n key
        throw new HttpError({ ... ERROR_CODES.invalid_id });
    }
    return id;
}

/** POST /todos —— 新增待办并返回局部片段 */
export async function createTodo(req: Request, res: Response): Promise<void> {
    const ctx = createWebCtx(req, res);
    // 数据清洗：取字段 -> 兕底空串 -> 去首尾空白，交给 service 前已保证是「干净文本」
    const text = String(ctx.body?.text ?? '').trim();
    if (!text) {
        // 非法入参：空文本，直接拦截，不进入 service
        throw new HttpError({ ...ERROR_CODES.todo_empty });
    }

    const newItem = await todoService.createTodo(ctx.userContext, { text });

    await sleep(DB_LATENCY_MS); // 模拟数据库写入

    if (!newItem) {
        // 入参已清洗且非空，此处仍失败 = 服务端故障（持久化/底层异常）→ 500
        throw new HttpError({ ...ERROR_CODES.create_failed });
    }

    // 空 → 第一条：原来是空列表占位，必须整体替换才能去掉“暂无待办”
    const todos = await todoService.listTodos(ctx.userContext);
    if (todos.length=== 1) {
        ctx.setHeader('HX-Reswap', 'outerHTML'); // 覆盖 hx-swap="afterbegin"
        ctx.render('partials/list', { todos });
        return;
    }

    ctx.render('partials/item', newItem);
}

/** POST /todos/:id/toggle —— 切换完成状态，返回该条目局部片段 */
export async function toggleTodo(req: Request, res: Response): Promise<void> {
    const ctx = createWebCtx(req, res);

    // 数据清洗：非法 id（非数字）直接抛 400，不查库
    const id = parseValidId(ctx);

    const item = await todoService.toggleTodo(ctx.userContext, id);

    await sleep(DB_LATENCY_MS); // 模拟数据库读写

    if (!item) {
        throw new HttpError({
            ...ERROR_CODES.toggle_not_found,
        });
    }
    ctx.render('partials/item', item);
}

/** DELETE /todos/:id —— 删除待办 */
export async function removeTodo(req: Request, res: Response): Promise<void> {
    const ctx = createWebCtx(req, res);

    const id = parseValidId(ctx);
   
    // 校验 id 合法后删除；service 已把 status/code 拼进结果，controller 直接透传给 HttpError
    const result = await todoService.removeTodo(ctx.userContext, id);

    await sleep(DB_LATENCY_MS); // 模拟数据库删除

    if (!result.success) {
        // result 未带 status/code 时兑底为 remove_failed（50002/500）
        throw new HttpError({
            status: result.status ?? ERROR_CODES.remove_failed.status,
            code: result.code ?? ERROR_CODES.remove_failed.code,
        });
    }

    const todos = await todoService.listTodos(ctx.userContext);
    if (todos.length === 0) {
        // 删光最后一条：留 `#todo-list` 的空白占位回来
        ctx.set('HX-Retarget', '#todo-list'); // 覆盖 closest .todo-item
        ctx.setHeader('HX-Reswap', 'outerHTML'); // 覆盖 hx-swap="delete"
        ctx.render('partials/list', { todos });
        return;
    }
    ctx.status(200).end();
}