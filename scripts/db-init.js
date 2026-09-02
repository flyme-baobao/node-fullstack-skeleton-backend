// 数据库初始化脚本（db-init.js）：用原生 pg 驱动执行 server/src/db/sql/init.sql 建表。
// 定位：无迁移工具下的最小可行方案——init.sql 全部 IF NOT EXISTS，幂等可重复执行，只建缺失对象、不动已有数据。
// 用法：npm run db:init
// 环境变量策略与 server/src/index.ts 保持一致：非生产读 .env.development（文件优先），生产以进程环境为准。
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import pg from 'pg';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

// 非生产环境：加载 .env.development（override 与 dev 启动链路一致，文件压过外部残留）
if (process.env.NODE_ENV !== 'production') {
    const devEnvPath = path.join(root, '.env.development');
    if (existsSync(devEnvPath)) {
        dotenv.config({ path: devEnvPath, override: true });
    }
}

// 连接串拼装：与 server/src/db/db.config.ts 的 buildConnectionString 保持同一规则
// （DATABASE_URL 残留 "${" 说明是 dotenv 未展开的嵌套引用字面量，忽略并走 DB_* 分量兜底，避免 pg Invalid URL）
function buildConnectionString() {
    const url = process.env.DATABASE_URL;
    if (url && !url.includes('${')) return url;
    const { DB_USER, DB_PASSWORD, DB_HOST, DB_NAME } = process.env;
    if (!DB_USER || !DB_PASSWORD || !DB_HOST || !DB_NAME) return undefined;
    const port = process.env.DB_PORT ?? '5432';
    return `postgresql://${encodeURIComponent(DB_USER)}:${encodeURIComponent(DB_PASSWORD)}@${DB_HOST}:${port}/${encodeURIComponent(DB_NAME)}`;
}

const connectionString = buildConnectionString();
if (!connectionString) {
    console.error('[db:init] 数据库未配置：请设置 DATABASE_URL，或填写 DB_USER/DB_PASSWORD/DB_HOST/DB_NAME（.env.development）');
    process.exit(1);
}

const sqlPath = path.join(root, 'server', 'src', 'db', 'sql', 'init.sql');
const sql = readFileSync(sqlPath, 'utf8');

const pool = new pg.Pool({ connectionString });
try {
    // simple query 协议支持一次发送多条语句（init.sql 内含 DO $$ 块，必须走多语句执行）
    await pool.query(sql);
    console.log('[db:init] 数据库结构就绪（init.sql 执行成功）');
} catch (err) {
    console.error('[db:init] 执行失败：', err instanceof Error ? err.message : String(err));
    process.exit(1);
} finally {
    await pool.end();
}
