/**
 * Redis 底层连接与配置（db/redis.ts）
 *
 * 未来需要缓存 / 会话等 Redis 能力时，在此统一管理连接与配置，
 * 从 db.config.ts 获取参数，避免散落各处。
 *
 * 当前仓库尚未安装 redis 客户端，也未在业务中使用 Redis，
 * 因此本文件仅提供调用骨架（ttl 常量等），不导入任何未安装的依赖，
 * 保证 typecheck 零副作用、启动链路不受影响。
 */
import { redisConfig } from './db.config.js';

/** 缓存默认过期时间（秒）：业务侧未特别指定时使用 */
export const DEFAULT_TTL_SECONDS = 60 * 60; // 1 小时

export interface RedisClientLike {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, ttlSeconds?: number): Promise<void>;
}

/**
 * 创建缓存包装的骨架（当前未接真实 Redis）。
 *
 * @returns 一个「什么都未命中」的空实现，避免业务在接入前引用到 undefined 报错。
 *          接入真实客户端后替换为本模块内部的真实实现。
 */
export function createRedisCache(): RedisClientLike {
    return {
        async get(): Promise<string | null> {
            return null;
        },
        async set(): Promise<void> {
            // 未接入 Redis，静默不写
        },
    };
}

export { redisConfig };