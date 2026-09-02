import { getPool } from '../db/index.js';
import { logger } from '../utils/logger.js';

/** 待办实体 */
export interface TodoItem {
    id: number;
    text: string;
    done: boolean;
}

/** todos 表行形状（与 db/sql/init.sql 建表列对应；业务只取这三个字段） */
interface TodoRow {
    id: number;
    text: string;
    done: boolean;
}

/** 列表：只返回未删除数据，并保持“最新创建在前”的现有展示顺序。 */
export async function list(): Promise<TodoItem[]> {
    const { rows } = await getPool().query<TodoRow>(
        `SELECT id, text, done
           FROM todos
          WHERE is_deleted = false
          ORDER BY id DESC`,
    );
    return rows;
}

/** 新增：返回新条目（updated_at 无表默认值须显式 now()；created_at 走表默认 CURRENT_TIMESTAMP）。 */
export async function create(text: string): Promise<TodoItem> {
    const { rows } = await getPool().query<TodoRow>(
        `INSERT INTO todos (text, updated_at)
         VALUES ($1, now())
         RETURNING id, text, done`,
        [text],
    );
    return rows[0];
}

/**
 * 切换完成状态：返回该条目（找不到返回 undefined）。
 * 一条原子 UPDATE（done = NOT done ... RETURNING）取代原「先 SELECT 再 UPDATE」两步往返，
 * 天然避免并发下读到旧值再覆盖。
 */
export async function toggle(id: number): Promise<TodoItem | undefined> {
    const { rows } = await getPool().query<TodoRow>(
        `UPDATE todos
            SET done = NOT done,
                updated_at = now()
          WHERE id = $1
            AND is_deleted = false
         RETURNING id, text, done`,
        [id],
    );
    return rows[0];
}

/** 删除：软删，返回是否删到了（rowCount 命中行数，找不到 false）。 */
export async function remove(id: number): Promise<boolean> {
    const { rowCount } = await getPool().query(
        `UPDATE todos
            SET is_deleted = true,
                updated_at = now()
          WHERE id = $1
            AND is_deleted = false`,
        [id],
    );

    if (rowCount === 0) {
        logger.warn('todo remove missed', { todoId: id });
        return false;
    }

    return true;
}