// 数据库初始化脚本（db-init.js）：用原生 pg 驱动执行 server/src/db/sql/init.sql 建表。
// 定位：无迁移工具下的最小可行方案——init.sql 全部 IF NOT EXISTS，幂等可重复执行，只建缺失对象、不动已有数据。
// 用法：npm run db:init:dev（本地开发，显式 NODE_ENV=development）/ npm run db:init（通用，跟随 NODE_ENV）
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

const SESSION_TZ_QUERY = `?options=${encodeURIComponent('-c timezone=UTC')}`;

function buildPostgresUrl() {
    const url = process.env.DATABASE_URL;
    if (url) return url.includes('options=') ? url : `${url}${SESSION_TZ_QUERY}`;
    const { DB_USER, DB_PASSWORD, DB_HOST, DB_NAME } = process.env;
    if (!DB_USER || !DB_PASSWORD || !DB_HOST || !DB_NAME) return undefined;
    const port = process.env.DB_PORT ?? '5432';
    return `postgresql://${encodeURIComponent(DB_USER)}:${encodeURIComponent(DB_PASSWORD)}@${DB_HOST}:${port}/${encodeURIComponent(DB_NAME)}${SESSION_TZ_QUERY}`;
}

const connectionString = buildPostgresUrl();
if (!connectionString) {
    console.error('[db:init] 数据库未配置：请设置 DATABASE_URL，或填写 DB_USER/DB_PASSWORD/DB_HOST/DB_NAME（.env.development）');
    process.exit(1);
}
const sqlDir = path.resolve(root, 'server', 'src', 'db', 'sql')

const loadSql = (filePath) => {
    const sqlPath = path.resolve(sqlDir, filePath);
    return readFileSync(sqlPath, 'utf8');
}

const initSql = loadSql('init.sql');

const pool = new pg.Pool({ connectionString });
try {
    // simple query 协议支持一次发送多条语句（init.sql 内含 DO $$ 块，必须走多语句执行）
    await pool.query(initSql);
    console.log('[db:init] 数据库结构就绪（init.sql 执行成功）');
} catch (err) {
    console.error('[db:init] 执行失败：', err instanceof Error ? err.message : String(err));
    process.exit(1);
}

/**
 * 模板字符串替换，仅用于迁移脚本，所有变量均为代码内置常量，无用户输入，无注入风险
 */
function renderSql(template, vars) {
  let sql = template;
  for(const [k,v] of Object.entries(vars)){
    sql = sql.replaceAll(`__${k}__`, String(v));
  }
  return sql;
}

/**
 * 回填对外标识（UUID 列）并收紧 NOT NULL。
 *
 * 为什么在脚本里做而不是 init.sql：
 *   1. init.sql 保持「纯结构 DDL、不动已有数据」的语义（头部注释约定），回填是数据迁移，归脚本；
 *   2. init.sql 是 multi-statement 一次发送，无法「回填完再收紧」——若存量 NULL 行超过单批 LIMIT，
 *      一次 UPDATE 只回填一批，紧接着 SET NOT NULL 必失败；脚本可以循环回填到 0 行再收紧，真正收敛；
 *   3. 对表近空的场景（当前演示数据），检测到 0 个 NULL 行即零开销跳过。
 *
 * 收敛对象：比如 todos.uid（对外查找键，CREATE TABLE 已自带则无需任何操作）。
 * 示例对象： { table: 'todos', column: 'uid', value: 'gen_random_uuid()'},
 * 软删过滤：仅对带 is_deleted 列的表（如 todos）生效。
 */
const IDENTITY_COLUMNS = [
    // 业务预留：后续新增对外标识列（UUID）时在此登记回填对象。
    // 示例：{ table: 'todos', column: 'uid', value: 'gen_random_uuid()' }
    // 目前无待回填列，保持为空数组（零开销跳过回填）。
];
const BACKFILL_BATCH = 1000;


async function backfillIdentityColumns() {
    const migrateSqlPath = path.resolve(sqlDir, 'migrate');
    const probeSoftDeleteSql = loadSql(path.resolve(migrateSqlPath, 'probe-soft-delete.sql'));
    const countMissingSqlTpl = loadSql(path.resolve(migrateSqlPath, 'count-missing.sql'));
    const batchSqlTpl = loadSql(path.resolve(migrateSqlPath, 'backfill-batch.sql'));
    const setNotNullSqlTpl = loadSql(path.resolve(migrateSqlPath, 'set-not-null.sql'))
    for (const { table, column, value } of IDENTITY_COLUMNS) {
        // 该表是否有软删列（若无则视为「未删除」直通回填）
        const { rows: colRows } = await pool.query(
            probeSoftDeleteSql,
            [table]
        );
        const softDeleteClause = colRows.length > 0 ? 'AND is_deleted = false' : '';
        const whereClause = `${column} IS NULL ${softDeleteClause}`;

        const countMissingSql = renderSql(countMissingSqlTpl, {
            TABLE: table,
            WHERE_CLAUSE: whereClause
        })
        const { rows } = await pool.query(countMissingSql);
        const missing = rows[0].missing;
        if (missing === 0) {
            // 新库建表自带该列 / 早已回填过 → 零开销跳过回填
            console.log(`[db:init] ${table}.${column} 不存在 NULL 行，直接收紧 NOT NULL`);
        } else {
            console.log(`[db:init] ${table}.${column} 存在 ${missing} 个 NULL 行，开始分批回填…`);
            const batchSql = renderSql(batchSqlTpl, {
                TABLE: table,
                COLUMN: column,
                VALUE_EXPR: value,
                WHERE_CLAUSE: whereClause,
                BATCH_LIMIT: String(BACKFILL_BATCH)
            })
            // 循环分批回填直到清零：FOR UPDATE SKIP LOCKED 并发安全，LIMIT 控单批锁面
            let batch = -1;
            while (batch !== 0) {
                const result = await pool.query(batchSql);
                batch = result.rowCount ?? 0;
            }
            console.log(`[db:init] ${table}.${column} 数据回填完成`);
        }

        // 收紧 NOT NULL 放在分支外：回填分支（清零后收紧）与零缺失分支（直接收紧）都需要
        const setNotNullSql = renderSql(setNotNullSqlTpl, {
            TABLE: table,
            COLUMN: column
        })
        await pool.query(setNotNullSql);
        console.log(`[db:init] ${table}.${column} 已确保 NOT NULL约束`);
    }
}

try {
    const identityColumnsLen = IDENTITY_COLUMNS.length;
    if (identityColumnsLen) {
        await backfillIdentityColumns();
        let finishInfo = IDENTITY_COLUMNS.reduce((pre, cur, index) => {
            pre = `${cur.table}.${cur.column}`
            if (index < identityColumnsLen - 1) {
                pre += ' /'
            }
            return pre;
        }, '')
        finishInfo += ' → NOT NULL'
        console.log(`[db:init] 对外标识列回填完成 (${finishInfo}) )`);
    }
} catch (err) {
    console.error('[db:init] 回填失败：', err instanceof Error ? err.message : String(err));
    process.exit(1);
} finally {
    await pool.end();
}
