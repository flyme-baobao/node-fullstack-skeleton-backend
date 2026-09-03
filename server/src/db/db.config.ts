/**
 * db.config.ts 数据库全局配置
 * 优先DATABASE_URL，PostgreSQL连接参数拼装，读取环境变量，供pg连接池、初始化脚本使用。
 * ⚠️ 使用函数导出，ESM下避免模块顶层读取env导致dotenv未加载拿到空值。
 */
import process from 'node:process';


const SESSION_TZ_QUERY = `?options=${encodeURIComponent('-c timezone=UTC')}`;

export function buildPostgresUrl(): string | undefined {
    const url = process.env.DATABASE_URL;
    if (url) {
        return url.includes('options=') ? url : `${url}${SESSION_TZ_QUERY}`;
    }

    const user = process.env.DB_USER;
    const password = process.env.DB_PASSWORD;
    const host = process.env.DB_HOST;
    const name = process.env.DB_NAME;
    if (!user || !password || !host || !name) {
        return undefined;
    }

    // 账号/密码/库名做 URL 编码，防止含 @ : / # 等特殊字符破坏连接串结构；
    // 分量拼装同样追加 SESSION_TZ_QUERY，保证两条路径的会话时区约定一致
    const port = process.env.DB_PORT ?? '5432';
    return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(name)}${SESSION_TZ_QUERY}`;
}

/**
 * Redis连接串配置，与PG配置逻辑一致。
 * 优先REDIS_URL，否则用主机/端口/密码拼装；密码URL编码处理特殊字符。
 * ⚠️ 函数导出，防止ESM模块加载阶段env尚未初始化。
 */
export function buildRedisUrl(): string | undefined {
    const url = process.env.REDIS_URL;
    if (url) {
        return url;
    }

    const host = process.env.REDIS_HOST;
    const port = process.env.REDIS_PORT;
    if (!host || !port) {
        return undefined;
    }
    const password = process.env.REDIS_PASSWORD;
    return password
        ? `redis://:${encodeURIComponent(password)}@${host}:${port}/0`
        : `redis://${host}:${port}/0`;
}