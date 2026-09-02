import { getPool } from '../db/index.js';
import { logger } from '../utils/logger.js';
import { HttpError } from '../middleware/error.middleware.js';
import { ERROR_CODES } from '../i18n/error-codes.js';
import type { QueryResult, QueryResultRow } from 'pg';

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

/** 慢查询阈值（毫秒）：超过记 warn（生产也输出），DB_SLOW_LOG_MS 可覆盖。 */
const SLOW_DB_MS = Number(process.env.DB_SLOW_LOG_MS ?? 200);

/**
 * DB 查询统一入口：由本函数执行 SQL 并记日志（耗时 / 慢查询 / 失败原因），各函数只关心 SQL 本身。
 * 层级选择：数据库操作日志放 repository（真正执行 SQL 的一层）——所有进库流量必经此处，
 * 放 controller/service 会随调用方增多而重复、遗漏。
 * 命名语义：query 在前 = 本函数负责执行（读写都算 query），WithLog 在后 = 附带统一日志。
 * ⚠️ 日志只记 SQL 模板（$1 占位符），不记 params——防止敏感数据（密码/内容）落日志。
 * 级别策略：成功 debug（生产自动过滤）、慢查询 warn、失败 error 后统一转 HttpError 上抛（错误响应由上层处理）。
 */
async function queryWithLog<T extends QueryResultRow>(op: string, sql: string, params: readonly unknown[] = []): Promise<QueryResult<T>> {
    // 读写分类：SELECT/WITH（CTE 可包读或写，先归 read）归 read，其余 INSERT/UPDATE/DELETE 等归 write。
    const kind = /^\s*(SELECT|WITH)\b/i.test(sql) ? 'read' : 'write';
    const startedAt = performance.now();
    try {
        const result = await getPool().query<T>(sql, params as never[]);
        const durationMs = Math.round(performance.now() - startedAt);
        logger.debug('db query done', { op, kind, durationMs, sql });
        if (durationMs >= SLOW_DB_MS) {
            logger.warn('db slow query', { op, kind, durationMs, sql });
        }
        return result;
    } catch (err) {
        const durationMs = Math.round(performance.now() - startedAt);
        logger.error('db query failed', {
            op,
            kind,
            durationMs,
            sql,
            error: err instanceof Error ? err.message : String(err),
        });
        // 统一转 HttpError 上抛（不再裸抛原始 pg 错误）：errorHandler 走 HttpError 分支，
        // 响应带业务码 50003 + i18n 文案；原始错误细节只留在上方日志里，不外泄给客户端。
        throw new HttpError({ ...ERROR_CODES.db_error });
    }
}

/** 列表：只返回未删除数据，并保持“最新创建在前”的现有展示顺序。 */
export async function list(): Promise<TodoItem[]> {
    const { rows } = await queryWithLog<TodoRow>(
        'todo.list',
        `SELECT id, text, done
           FROM todos
          WHERE is_deleted = false
          ORDER BY id DESC`,
    );
    return rows;
}

/** 新增：返回新条目（updated_at 无表默认值须显式 now()；created_at 走表默认 CURRENT_TIMESTAMP）。 */
export async function create(text: string): Promise<TodoItem> {
    const { rows } = await queryWithLog<TodoRow>(
        'todo.create',
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
    const { rows } = await queryWithLog<TodoRow>(
        'todo.toggle',
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
    const { rowCount } = await queryWithLog(
        'todo.remove',
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