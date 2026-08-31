/**
 * 数据库全局参数配置（db.config.ts）
 *
 * 集中管理数据库（PostgreSQL）连接参数，统一从环境变量读取。
 * 后续接入 Prisma / 连接池时直接从此处取值，避免散落各处。
 *
 * 注意：本仓库当前使用 JSON 文件存储待办（server/src/storage.ts），
 * 数据库（PostgreSQL/Redis）尚未接入业务。此文件仅提供参数骨架，
 * 不导入任何业务代码，也不在启动链路中生效，保证 typecheck / 启动零副作用。
 */
import process from 'node:process';

/** 数据库连接串（Prisma 使用，来自 .env 的 DATABASE_URL） */
export const databaseUrl = process.env.DATABASE_URL;

/** 是否已在 .env 配置数据库（用于后续判断是否启用真实数据库） */
export const hasDatabase = Boolean(databaseUrl);

/** 连接池参数（供未来连接池基建使用） */
export const pool = {
    /** 连接池最大连接数 */
    max: Number(process.env.DB_POOL_MAX ?? 10),
    /** 连接空闲时间（毫秒）超时释放 */
    idleTimeoutMs: Number(process.env.DB_IDLE_TIMEOUT_MS ?? 30_000),
    /** 连接获取超时（毫秒） */
    connectionTimeoutMs: Number(process.env.DB_CONNECTION_TIMEOUT_MS ?? 5_000),
};

/** Redis 配置（供未来 redis.ts 使用，来自 .env） */
export const redisConfig = {
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
};