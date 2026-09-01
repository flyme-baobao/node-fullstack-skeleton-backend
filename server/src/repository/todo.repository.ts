import { prisma } from '../db/index.js';
import { logger } from '../utils/logger.js';

/** 待办实体 */
export interface TodoItem {
    id: number;
    text: string;
    done: boolean;
}

function toTodoItem(todo: { id: number; text: string; done: boolean }): TodoItem {
    return { id: todo.id, text: todo.text, done: todo.done };
}

/** 列表：只返回未删除数据，并保持“最新创建在前”的现有展示顺序。 */
export async function list(): Promise<TodoItem[]> {
    // approx SQL:
    // SELECT id, text, done, created_at, updated_at, is_deleted
    // FROM todos WHERE is_deleted = false ORDER BY id DESC;
    const todos = await prisma.todo.findMany({
        where: { isDeleted: false },
        orderBy: { id: 'desc' },
    });
    return todos.map(toTodoItem);
}

/** 新增：返回新条目。 */
export async function create(text: string): Promise<TodoItem> {
    // approx SQL:
    // INSERT INTO todos (text, done, created_at, updated_at, is_deleted)
    // VALUES ($1, false, now(), now(), false)
    // RETURNING id, text, done, created_at, updated_at, is_deleted;
    const todo = await prisma.todo.create({
        data: { text },
    });
    return toTodoItem(todo);
}

/** 切换完成状态：返回该条目（找不到返回 undefined）。 */
export async function toggle(id: number): Promise<TodoItem | undefined> {
    // approx SQL (step 1):
    // SELECT id, text, done FROM todos WHERE id = $1 AND is_deleted = false LIMIT 1;
    const todo = await prisma.todo.findFirst({
        where: { id, isDeleted: false },
        select: { id: true, text: true, done: true },
    });

    if (!todo) {
        return undefined;
    }

    // approx SQL (step 2):
    // UPDATE todos SET done = $2, updated_at = now() WHERE id = $1
    // RETURNING id, text, done, created_at, updated_at, is_deleted;
    const updated = await prisma.todo.update({
        where: { id },
        data: { done: !todo.done },
    });

    return toTodoItem(updated);
}

/** 删除：软删，返回是否删到了（找不到 false）。 */
export async function remove(id: number): Promise<boolean> {
    // approx SQL:
    // UPDATE todos SET is_deleted = true, updated_at = now()
    // WHERE id = $1 AND is_deleted = false;
    // result: { count: 0 | 1 }
    const result = await prisma.todo.updateMany({
        where: { id, isDeleted: false },
        data: { isDeleted: true },
    });

    if (result.count === 0) {
        logger.warn('todo remove missed', { todoId: id });
        return false;
    }

    return true;
}