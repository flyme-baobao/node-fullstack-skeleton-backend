/**
 * DB 查询统一入口（queryWithLog.ts）
 *
 * 由本函数执行 SQL 并记日志（耗时 / 慢查询 / 失败原因），各 repository 只关心 SQL 本身。
 * 层级选择：数据库操作日志放 db 层（真正执行 SQL 的一层）——所有进库流量必经此处，
 * 放 controller/service 会随调用方增多而重复、遗漏。
 * 命名语义：query 在前 = 本函数负责执行（读写都算 query），WithLog 在后 = 附带统一日志。
 * ⚠️ 日志只记 SQL 模板（$1 占位符），不记 params——防止敏感数据（密码/内容）落日志。
 * 级别策略：成功 debug（生产自动过滤）、慢查询 warn、失败 error 后统一转 HttpError 上抛（错误响应由上层处理）。
 *
 * 错误映射：默认统一抛 db_query_error；调用方可通过 options.mapError 定制
 * （如 users 唯一索引冲突 23505 → 40901 account_exists），映射函数返回的 Error
 * 会原样上抛（通常是携带业务码的 HttpError）。
 */
import { getPool } from './index.js';
import { logger } from '../utils/logger.js';
import { HttpError } from '../middleware/error.middleware.js';
import { ERROR_DEFS } from '../i18n/error-defs.js';
import type { QueryResult, QueryResultRow } from 'pg';

/** 慢查询阈值（毫秒）：超过记 warn（生产也输出），DB_SLOW_LOG_MS 可覆盖。 */
const SLOW_DB_MS = Number(process.env.DB_SLOW_DB_MS ?? process.env.DB_SLOW_LOG_MS ?? 200);

export interface QueryWithLogOptions {
    /** 定制失败时的错误转换；缺省统一抛 db_query_error（50005） */
    mapError?: (err: unknown) => Error;
}

export async function queryWithLog<T extends QueryResultRow>(
    op: string,
    sql: string,
    params: readonly unknown[] = [],
    options: QueryWithLogOptions = {}
): Promise<QueryResult<T>> {
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
        throw options.mapError
            ? options.mapError(err)
            : new HttpError({ ...ERROR_DEFS.db_query_error });
    }
}