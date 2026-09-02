/**
 * 数据库全局参数配置（db.config.ts）
 *
 * 集中管理数据库（PostgreSQL）连接参数的「拼装规则」，统一从环境变量读取，
 * 供 db/index.ts 创建原生 pg 连接池、scripts/db-init.js 建表时取值，避免散落各处。
 *
 * ⚠️ 只提供函数、不做模块顶层常量：ESM 静态 import 会先于入口文件
 * index.ts 模块体内的 dotenv.config() 执行，顶层读 env 会拿到空配置。
 */
import process from 'node:process';


const SESSION_TZ_QUERY = `?options=${encodeURIComponent('-c timezone=UTC')}`;

export function buildConnectionString(): string | undefined {
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

/** Redis 配置（供未来 redis.ts 使用，来自 .env；当前未接入业务，无冻结风险） */
export const redisConfig = {
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
};