/**
 * 数据库主实例初始化与连接池统一管理（db/index.ts）
 *
 * 使用原生 node-postgres（pg）驱动：在此惰性创建全局唯一连接池（getPool），
 * repository 层只从本模块取实例执行参数化 SQL，不直接触碰 pg。
 *
 * 生命周期：
 *   1. 入口（server/src/index.ts）启动时 await connectDatabase() 主动建连探测；
 *   2. 进程退场（registerShutdown → closeApp）时 disconnectDatabase() 释放连接池。
 */
import { Pool } from 'pg';
import { logger } from '../utils/logger.js';
import { buildConnectionString } from './db.config.js';

type GlobalWithPgPool = typeof globalThis & {
    __pgPool?: Pool;
};

const globalForPg = globalThis as GlobalWithPgPool;

let pool: Pool | undefined;

/**
 * 惰性获取全局唯一连接池：首次调用时才读取环境变量并建池。
 *
 * ⚠️ 不能在模块顶层直接 new Pool(...)：ESM 的静态 import 会先于入口文件
 * index.ts 模块体内的 dotenv.config() 执行，顶层读 env 拿到的是空配置
 * （pg 的 connectionString 在构造时即冻结）。
 * 因此必须在启动链路 connectDatabase() / 请求链路里经本函数建池。
 */
export function getPool(): Pool {
    const cached = globalForPg.__pgPool ?? pool;
    if (cached) {
        return cached;
    }

    const connectionString = buildConnectionString();
    if (!connectionString) {
        throw new Error(
            '数据库未配置：请设置 DATABASE_URL（CI/Docker 注入），或提供 DB_USER/DB_PASSWORD/DB_HOST/DB_NAME（本地 .env.development）。',
        );
    }

    const created = new Pool({
        connectionString,
        max: Number(process.env.DB_POOL_MAX ?? 10),
        idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS ?? 30_000),
        connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT_MS ?? 5_000),
    });

    // 空闲连接意外断开（如数据库重启、网络抖动）：不监听会被当作未捕获异常打崩进程
    created.on('error', (err) => {
        logger.error('Unexpected pg pool error (idle client)', { message: err.message });
    });

    pool = created;
    // 非 production 挂到 globalThis 复用（避免热重启/多入口重复建池）
    if (process.env.NODE_ENV !== 'production') {
        globalForPg.__pgPool = created;
    }
    return created;
}

let ready = false;

/** 数据库是否已完成连接初始化。 */
export function databaseReady(): boolean {
    return ready;
}

/**
 * 启动阶段主动建立数据库连接（借一条连接执行 SELECT 1 探测），
 * 缺配置时直接失败，不允许静默回退。
 */
export async function connectDatabase(): Promise<Pool> {
    const current = getPool(); // 缺配置时在此显式抛错

    if (ready) {
        return current;
    }

    const client = await current.connect();
    try {
        await client.query('SELECT 1');
    } finally {
        client.release();
    }

    ready = true;
    logger.info('PostgreSQL connected (pg pool)', { max: current.options.max });
    return current;
}

/** 进程退出时释放 pg 连接池。 */
export async function disconnectDatabase(): Promise<void> {
    const current = pool ?? globalForPg.__pgPool;
    if (!ready || !current) {
        return;
    }

    await current.end();
    ready = false;
    pool = undefined;
    globalForPg.__pgPool = undefined;
    logger.info('PostgreSQL disconnected');
}