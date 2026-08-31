import type { TodoItem } from '../repository/todo.repository.js';
import type { CreateTodoDto, TodoView } from '../dto/todo.dto.js';
import * as todoRepository from '../repository/todo.repository.js';
import { ERROR_CODES } from '../i18n/error-codes.js';

/**
 * 待办业务层（薄）：
 * 承接 controller 的调用，负责「把 repository 从数据库取回的原始数据治理成视图层所需结构」并向下调用 repository。
 * 分工边界：
 *   - controller：入参清洗/校验、请求/响应编排（HTTP 状态码）。
 *   - service：repository 返回之后的「数据治理/成型」（这里收敛到 toView）与业务意图表达。
 *   - repository：查询/持久化，不暴露原始数据形状以外的承诺。
 */

/**
 * 从数据库返回之后的治理收合处：
 * 把 repository 拿到的原始 TodoItem 加工成视图层消费的 TodoView。
 * 当前字段恰一致，故为「直通」；将来存储层调整字段，只在此处补映射即可。
 */
function toView(item: TodoItem): TodoView {
    return { id: item.id, text: item.text, done: item.done };
}

/** 查询当前待办列表（治理后的视图对象） */
export function listTodos(): TodoView[] {
    return todoRepository.list().map(toView);
}

/** 统计待办数量（controller 判断空 / 删光等特殊重绘分支用） */
export function countTodos(): number {
    return todoRepository.list().length;
}

/** 新增待办：直接落库（文本已由 controller 完成清洗），返回被治理后的视图对象；失败返回 null */
export function createTodo(dto: CreateTodoDto): TodoView | null {
    // repository.create 当前同步必成功（返回 TodoItem，非可空）。
    // 防御其未来改为异步/失败时返回空 —— 与 toggle 一致，异常态退化成 null，
    // 由 controller 统一决定状态码（这里是服务端故障语义 → 500），不在 service 抛错。
    const item = todoRepository.create(dto.text);
    return item ? toView(item) : null;
}

/** 切换完成状态：返回被治理后的视图对象（不存在返回 undefined） */
export function toggleTodo(id: number): TodoView | undefined {
    const item = todoRepository.toggle(id);
    return item ? toView(item) : undefined;
}

/** 移除结果：success 表示删除成功；否则 code/status 由 service 拼装好，controller 直接透传给 HttpError */
export type RemoveResult = {
    success: boolean;
    /** 失败时的数字业务码（40402 remove_not_found / 50002 remove_failed） */
    code?: number;
    /** 简要失败原因（可读说明，非判断依据） */
    reason?: string;
    /** 失败时的 HTTP 状态码（404 / 500） */
    status?: number;
};

/** 删除待办：返回成功与否及失败信息（区分「不存在」与「移除失败」） */
export function removeTodo(id: number): RemoveResult {
    try {
        const removed = todoRepository.remove(id);
        if (!removed) {
            return {
                success: false,
                code: ERROR_CODES.remove_not_found.code,
                reason: 'not_found',
                status: 404
            };
        }
        return { success: true };
    } catch {
        // 写盘/底层失败（与「找不到 id」区分）→ 业务码 remove_failed
        return {
            success: false,
            code: ERROR_CODES.remove_failed.code,
            reason: 'remove_failed',
            status: 500
        };
    }
}