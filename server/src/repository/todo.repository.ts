import { logger } from '../utils/logger.js';
import { loadSql } from '../utils/loadSql.js';
import { queryWithLog } from '../db/queryWithLog.js';

/** TodoRow 与 TodoItem 的公共字段：字段名、类型完全一致，才值得上提；各自独有字段由两侧补充 */
interface TodoBase {
    /** 对外查找键（UUID，库端 gen_random_uuid 生成）：对外接口/htmx 路由一律携带它 */
    uid: string;
    text: string;
    done: boolean;
}
// 内部自增 id 不进任何 SELECT / RETURNING 投影（不出 repository 对外契约），
// 只在 SQL 内部参与定位后排序（ORDER BY id DESC）；对外定位一律用 uid。

/** 待办实体（对外契约，camelCase；时间字段为 Date，展示层格式化见 utils/userTime.ts） */
export interface TodoItem extends TodoBase {
    createdAt: Date;
    updatedAt: Date;
}

/** todos 表行形状 = 本文件 SQL 投影（SELECT/RETURNING 的列）；pg 按数据库列名返回 key，故为 snake_case */
interface TodoRow extends TodoBase {
    created_at: Date;
    updated_at: Date;
}

/** 行 → 实体：snake_case 列名收敛为 camelCase 对外字段（TodoRow 与 TodoItem 的转换边界） */
function toItem(row: TodoRow): TodoItem {
    const { created_at, updated_at, ...res } = row;
    return {
        ...res,
        createdAt: created_at,
        updatedAt: updated_at,
    };
}

/** 列表：按登录用户隔离（user_id 过滤），只返回未删除数据，并保持“最新创建在前”的现有展示顺序。 */
export async function list(userId: string): Promise<TodoItem[]> {
    const sql = loadSql('todo/list.sql');
    const { rows } = await queryWithLog<TodoRow>(
        'todo.list',
        // SELECT 的投影就是列清单本身（RETURNING 只属于 INSERT/UPDATE/DELETE）；
        // id 仅出现在 ORDER BY，不进投影——内部主键不出对外契约
        sql,
        [userId],
    );
    return rows.map(toItem);
}

/** 新增：归属登录用户。返回新条目。updated_at 显式写入，与 created_at 走表默认的 CURRENT_TIMESTAMP 同读一个事务时刻，出生时刻两列必然相等。 */
export async function create(userId: string, text: string): Promise<TodoItem> {
    const sql = loadSql('todo/create.sql');
    const { rows } = await queryWithLog<TodoRow>(
        'todo.create',
        sql,
        [userId, text],
    );
    return toItem(rows[0]);
}

/**
 * 切换完成状态：返回该条目（找不到或非本人待办返回 undefined）。
 * 按 uid + user_id 双条件定位（对外查找键 + 归属校验，防越权）；一条原子 UPDATE（done = NOT done ... RETURNING）
 * 取代原「先 SELECT 再 UPDATE」两步往返，天然避免并发下读到旧值再覆盖。
 */
export async function toggle(userId: string, uid: string): Promise<TodoItem | undefined> {
    const sql = loadSql('todo/toggle.sql');
    const { rows } = await queryWithLog<TodoRow>(
        'todo.toggle',
        sql,
        [uid, userId],
    );
    return rows[0] ? toItem(rows[0]) : undefined;
}

/** 删除（软删，uid + user_id 双条件定位防越权），返回是否删到了（rowCount 命中行数，找不到 false）。 */
export async function remove(userId: string, uid: string): Promise<boolean> {
    const sql = loadSql('todo/remove.sql');
    const { rowCount } = await queryWithLog(
        'todo.remove',
        sql,
        [uid, userId],
    );

    if (rowCount === 0) {
        logger.warn('todo remove missed', { todoUid: uid });
        return false;
    }

    return true;
}