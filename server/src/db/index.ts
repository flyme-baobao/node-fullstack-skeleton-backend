/**
 * 数据库主实例初始化与连接池统一管理（db/index.ts）
 *
 * 规划：未来接入 PostgreSQL + Prisma 在此初始化主数据库实例（连接池），
 * 并通过统一出口导出，供 repository 层调用。
 *
 * 当前仓库仍以 JSON 文件存储待办（server/src/storage.ts），尚未接入数据库，
 * 因此本文件暂不初始化任何真实连接，也不在启动链路中生效（零副作用、typecheck 干净）。
 * 接入时：
 *   1. 在 db/index.ts 内创建/导出统一数据库客户端实例；
 *   2. 在入口（server/src/index.ts 或 app.ts）启动时 await 初始化；
 *   3. repository 层从本模块取实例，而不直接触碰 Prisma。
 */
import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger.js';
import { hasDatabase } from './db.config.js';

type GlobalWithPrisma = typeof globalThis & {
    __prisma?: PrismaClient;
};

const globalForPrisma = globalThis as GlobalWithPrisma;

export const prisma = globalForPrisma.__prisma ?? new PrismaClient({
    log: [
        { level: 'query', emit: 'stdout' }, // ✅打印生成的SQL
        { level: 'info', emit: 'stdout' },
        { level: 'warn', emit: 'stdout' },
        { level: 'error', emit: 'stdout' },
    ]
});

if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.__prisma = prisma;
}

let ready = false;

/** 数据库是否已完成连接初始化。 */
export function databaseReady(): boolean {
    return ready;
}

/**
 * 抛出「数据库未接入」的哨兵错误，防止业务侧误用未初始化的数据库。
 * 接入数据库后此函数不再需要，可由真实初始化流程替代。
 */
export function requireDatabase(): never {
    throw new Error(
        `数据库尚未接入：DATABASE_URL=${hasDatabase ? '已配置' : '未配置'}。当前数据走 JSON 文件存储。`,
    );
}

/** 启动阶段主动建立数据库连接，缺配置时直接失败，不允许静默回退。 */
export async function connectDatabase(): Promise<PrismaClient> {
    if (!hasDatabase) {
        throw new Error('DATABASE_URL 未配置，无法连接 PostgreSQL。');
    }

    if (ready) {
        return prisma;
    }

    await prisma.$connect();
    ready = true;
    logger.info('PostgreSQL connected');
    return prisma;
}

/** 进程退出时释放 Prisma 连接。 */
export async function disconnectDatabase(): Promise<void> {
    if (!ready) {
        return;
    }

    await prisma.$disconnect();
    ready = false;
    logger.info('PostgreSQL disconnected');
}