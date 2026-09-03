/**
 * db/redis.ts Redis连接与生命周期管理
 * 使用官方底层驱动 @redis/client：在此统一管理连接创建与退场，
 * 封装 @redis/client，业务层通过本模块获取实例，不直接操作底层驱动。
 * 生命周期：启动调用 connectRedis() 建连探测；进程退出调用 disconnectRedis() 释放连接。
 * ⚠️ ESM禁止模块顶层创建客户端/读取环境变量，dotenv尚未加载，使用 getRedis() 惰性初始化。
 * 对外统一由 db/index.ts 导出，业务无需感知内部文件。
 */

import { createClient, type RedisClientType } from '@redis/client';
import { logger } from '../utils/logger.js';
import { buildRedisUrl } from './db.config.js';
import { HttpError } from '../middleware/error.middleware.js';
import { ERROR_DEFS } from '../i18n/error-defs.js';

/** 缓存默认过期时间（秒）：业务侧未特别指定时使用 */
export const DEFAULT_TTL_SECONDS = 60 * 60; // 1 小时

/** 业务侧缓存口径（不含发布订阅等高级能力），屏蔽底层驱动类型 */
export interface RedisClientLike {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, ttlSeconds?: number): Promise<void>;
}

type GlobalWithRedisClient = typeof globalThis & {
    __redisClient?: RedisClientType;
};

const globalForRedis = globalThis as GlobalWithRedisClient;

let client: RedisClientType | undefined;

/**
 * 惰性获取全局唯一 Redis 客户端：首次调用时才读取环境变量并创建。
 *
 * 仅创建不建连（node-redis 的 connect() 由 connectRedis() 显式驱动）；
 * buildRedisUrl() 允许返回空（与 buildPostgresUrl 同款），缺配置在此
 * 显式抛 HttpError（业务码 50011），与 pg 的 getPool() 同款约定。
 */
export function getRedis(): RedisClientType {
    const cached = globalForRedis.__redisClient ?? client;
    if (cached) {
        return cached;
    }

    const url = buildRedisUrl();
    if (!url) {
        // 记日志后再统一抛 HttpError（业务码 50011）：避免裸 Error 落入 errorHandler「未知异常」分支
        logger.error('redis client init failed: connection not configured', {
            hint: 'set REDIS_URL (CI/Docker) or REDIS_HOST/REDIS_PORT/REDIS_PASSWORD (.env.development)',
        });
        throw new HttpError({
            ...ERROR_DEFS.redis_not_configured,
        });
    }

    const created = createClient({
        url,
        socket: {
            // Redis 重启/网络抖动时避免建连无限挂起
            connectTimeout: Number(process.env.REDIS_CONNECT_TIMEOUT_MS ?? 5_000),
        },
    });

    // 必须监听 error：空闲连接意外断开（Redis 重启、网络抖动、重连失败）时，
    // 不监听会被 node-redis 当作未捕获异常打崩进程
    created.on('error', (err) => {
        logger.error('Unexpected redis client error (idle connection)', {
            message: err instanceof Error ? err.message : String(err),
        });
    });

    client = created;
    // 非 production 挂到 globalThis 复用（避免热重启/多入口重复建连）
    if (process.env.NODE_ENV !== 'production') {
        globalForRedis.__redisClient = created;
    }
    return created;
}

let ready = false;

/** Redis 是否已完成连接初始化。 */
export function redisReady(): boolean {
    return ready;
}

/**
 * 启动阶段主动建立 Redis 连接（connect 握手 + PING 探测），
 * 失败直接抛 HttpError，不允许静默回退：
 *   - 缺配置（REDIS_URL / REDIS_HOST+REDIS_PORT 都没有）→ 50011 redis_not_configured（getRedis 内抛出）；
 *   - 建连/认证/探测失败（Redis 没起、密码错、超时等）→ 50010 redis_connect_error。
 */
export async function connectRedis(): Promise<RedisClientType> {
    const current = getRedis();

    if (ready) {
        return current;
    }

    try {
        await current.connect();
        await current.ping();
    } catch (err) {
        // 建连/认证/探测失败（Redis 没起、密码错、连接超时等）：记原始原因后统一抛 HttpError
        logger.error('Redis connect probe failed', {
            error: err instanceof Error ? err.message : String(err),
        });
        throw new HttpError({
            ...ERROR_DEFS.redis_connect_error,
        });
    }

    ready = true;
    logger.info('Redis connected');
    return current;
}

/** 进程退出时断开 Redis 连接。 */
export async function disconnectRedis(): Promise<void> {
    const current = client ?? globalForRedis.__redisClient;
    if (!ready || !current) {
        return;
    }

    await current.disconnect();
    ready = false;
    client = undefined;
    globalForRedis.__redisClient = undefined;
    logger.info('Redis disconnected');
}

/**
 * 创建缓存包装：业务侧只依赖 RedisClientLike 接口使用缓存。
 *
 * 前置条件：启动链路已调用 connectRedis()；未连接时操作会抛错（fail-fast，与 pg 同款约定）。
 */
export function createRedisCache(): RedisClientLike {
    return {
        async get(key): Promise<string | null> {
            return getRedis().get(key);
        },
        async set(key, value, ttlSeconds): Promise<void> {
            if (ttlSeconds === undefined) {
                await getRedis().set(key, value);
                return;
            }
            await getRedis().set(key, value, { EX: ttlSeconds });
        },
    };
}