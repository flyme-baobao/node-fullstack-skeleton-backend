import type { UserContext } from '../adapter/webCtx.js';
import type { TodoItem } from '../repository/todo.repository.js';
import type { CreateTodoDto, TodoView } from '../dto/todo.dto.js';
import * as todoRepository from '../repository/todo.repository.js';
import { HttpError } from '../middleware/error.middleware.js';
import { ERROR_DEFS } from '../i18n/error-defs.js';
import { formatUserDateTime } from '../utils/userTime.js';
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
function toView(userContext: UserContext, item: TodoItem): TodoView {
    const { createdAt, updatedAt } = item;
    return {
        ...item,
        createTimeFormat: formatUserDateTime(userContext, createdAt),
        modifyTimeFormat: formatUserDateTime(userContext, updatedAt),
        createTimeStamp: createdAt.getTime(),
        modifyTimeStamp: updatedAt.getTime(),
    };
}

/** 查询当前登录用户的待办列表（治理后的视图对象）。
 *  未登录（无 userId，公开页降级场景）返回空数组，不查库（文档 §7）。 */
export async function listTodos(userContext: UserContext): Promise<TodoView[]> {
    if (!userContext.userId) {
        return [];
    }
    return (await todoRepository.list(userContext.userId)).map(item => toView(userContext, item));
}

/** 统计待办数量（controller 判断空 / 删光等特殊重绘分支用） */
export async function countTodos(userContext: UserContext): Promise<number> {
    return (await listTodos(userContext)).length;
}

/** 新增待办：归属当前登录用户；未登录不该到达（API 已鉴权），防御性抛 401 */
export async function createTodo(userContext: UserContext, dto: CreateTodoDto): Promise<TodoView | null> {
    if (!userContext.userId) {
        throw new HttpError({ ...ERROR_DEFS.unauthorized });
    }
    // repository.create 当前同步必成功（返回 TodoItem，非可空）。
    // 防御其未来改为异步/失败时返回空 —— 与 toggle 一致，异常态退化成 null，
    // 由 controller 统一决定状态码（这里是服务端故障语义 → 500），不在 service 抛错。
    const item = await todoRepository.create(userContext.userId, dto.text);
    return item ? toView(userContext, item) : null;
}

/** 切换完成状态：返回被治理后的视图对象（不存在或非本人待办返回 undefined） */
export async function toggleTodo(userContext: UserContext, uid: string): Promise<TodoView | undefined> {
    if (!userContext.userId) {
        throw new HttpError({ ...ERROR_DEFS.unauthorized });
    }
    const item = await todoRepository.toggle(userContext.userId, uid);
    return item ? toView(userContext, item) : undefined;
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

/** 删除待办：返回成功与否及失败信息（区分「不存在」与「移除失败」）；
 *  repository 按 uid + user_id 双条件软删，他人待办删不到 → 语义等同 not_found（不泄露存在性） */
export async function removeTodo(userContext: UserContext, uid: string): Promise<RemoveResult> {
    if (!userContext.userId) {
        // 未登录不该到达（API 已鉴权），防御性拦截
        return {
            success: false,
            code: ERROR_DEFS.unauthorized.code,
            reason: 'unauthorized',
            status: ERROR_DEFS.unauthorized.status
        };
    }
    try {
        const removed = await todoRepository.remove(userContext.userId, uid);
        if (!removed) {
            return {
                success: false,
                code: ERROR_DEFS.remove_not_found.code,
                reason: 'not_found',
                status: ERROR_DEFS.remove_not_found.status
            };
        }
        return { success: true };
    } catch {
        // 写盘/底层失败（与「找不到 id」区分）→ 业务码 remove_failed
        return {
            success: false,
            code: ERROR_DEFS.remove_failed.code,
            reason: 'remove_failed',
            status: ERROR_DEFS.remove_failed.status
        };
    }
}