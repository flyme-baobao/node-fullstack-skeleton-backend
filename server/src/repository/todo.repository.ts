import { getPool } from '../db/index.js';
import { loadSql } from '../utils/loadSql.js';
import { logger } from '../utils/logger.js';
import { HttpError } from '../middleware/error.middleware.js';
import { ERROR_DEFS } from '../i18n/error-defs.js';
import type { QueryResult, QueryResultRow } from 'pg';

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
        // 响应带业务码 50005（db_query_error，运行时查询失败）+ i18n 文案；
        throw new HttpError({ ...ERROR_DEFS.db_query_error });
    }
}

/** 列表：只返回未删除数据，并保持“最新创建在前”的现有展示顺序。 */
export async function list(): Promise<TodoItem[]> {
    const sql = loadSql('todo/list.sql');
    const { rows } = await queryWithLog<TodoRow>(
        'todo.list',
        // SELECT 的投影就是列清单本身（RETURNING 只属于 INSERT/UPDATE/DELETE）；
        // id 仅出现在 ORDER BY，不进投影——内部主键不出对外契约
        sql,
    );
    return rows.map(toItem);
}

/** 新增：返回新条目。updated_at 显式写入，与 created_at 走表默认的 CURRENT_TIMESTAMP 同读一个事务时刻，出生时刻两列必然相等。 */
export async function create(text: string): Promise<TodoItem> {
    const sql = loadSql('todo/create.sql');
    const { rows } = await queryWithLog<TodoRow>(
        'todo.create',
        sql,
        [text],
    );
    return toItem(rows[0]);
}

/**
 * 切换完成状态：返回该条目（找不到返回 undefined）。
 * 按 uid 定位（对外查找键）；一条原子 UPDATE（done = NOT done ... RETURNING）取代原
 * 「先 SELECT 再 UPDATE」两步往返，天然避免并发下读到旧值再覆盖。
 */
export async function toggle(uid: string): Promise<TodoItem | undefined> {
    const sql = loadSql('todo/toggle.sql');
    const { rows } = await queryWithLog<TodoRow>(
        'todo.toggle',
        sql,
        [uid],
    );
    return rows[0] ? toItem(rows[0]) : undefined;
}

/** 删除（软删，按 uid 定位），返回是否删到了（rowCount 命中行数，找不到 false）。 */
export async function remove(uid: string): Promise<boolean> {
    const sql = loadSql('todo/remove.sql');
    const { rowCount } = await queryWithLog(
        'todo.remove',
        sql,
        [uid],
    );

    if (rowCount === 0) {
        logger.warn('todo remove missed', { todoUid: uid });
        return false;
    }

    return true;
}