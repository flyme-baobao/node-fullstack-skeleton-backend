import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpError } from '../middleware/error.middleware.js';
import { ERROR_DEFS } from '../i18n/error-defs.js';

// ESM 没有 __dirname：用 import.meta.url 等价推导本模块所在目录的上级。
// 两种运行形态天然兼容（与 app.ts / paths.ts 的惯例一致）：
//   - dev/tsx：本模块在 <root>/server/src/utils → serverSrc = <root>/server/src
//   - prod/编译：本模块在 <root>/dist-server/utils → serverSrc = <root>/dist-server
//     （build-server.js 会把 server/src 下的 .sql 按相对结构复制进 dist-server）
// 不用 projectRoot 拼固定路径：prod 下 SQL 资源在 dist-server，不在源码目录。
// ESM 获取当前模块目录
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverSrc = path.resolve(__dirname, '..');
// 模块加载时解析一次，避免每次调用重复 resolve
const sqlDir = path.resolve(serverSrc, 'db', 'sql');

/**
 * SQL 文件内存缓存，key为绝对文件路径
 * 开发环境关闭缓存，修改sql不用重启服务；生产启用缓存减少磁盘IO
 */
const sqlCache = new Map<string, string>();
const IS_DEV = process.env.NODE_ENV === 'development';

/**
 * @description 读取 SQL 文件内容（相对 server/src/db/sql/ 的路径）
 * @param filePath 相对 server/src/db/sql/ 的路径，如 'todo/list.sql'
 * @returns SQL 文件内容字符串
 * @throws HttpError
 *  - db_sql_invalid_path: 路径越界 / 非法后缀
 *  - db_sql_file_not_found: 文件不存在
 *  - db_sql_not_a_file: 路径存在但不是普通文件（目录/设备等）
 *  - db_io_error：IO异常、权限错误等底层fs错误
 */
export function loadSql(filePath: string): string {
    const sqlPath = path.resolve(sqlDir, filePath);

    // 防御路径穿越：确保解析后路径落在 sql 目录内部。
    // 带上分隔符防前缀误判（如 sql-evil/）；filePath 为绝对路径时 resolve 会直接返回它，同样在此被拦截
    if (!sqlPath.startsWith(sqlDir + path.sep)) {
        throw new HttpError({ ...ERROR_DEFS.db_sql_invalid_path });
    }

    // 业务约束：仅允许 .sql 后缀（提前拦截，省去无谓的磁盘访问）
    if (!sqlPath.endsWith('.sql')) {
        throw new HttpError({ ...ERROR_DEFS.db_sql_invalid_path });
    }

    // 生产环境命中缓存直接返回
    if (!IS_DEV && sqlCache.has(sqlPath)) {
        return sqlCache.get(sqlPath)!;
    }

    let fileStat;
    try {
        // stat 一次同时回答「存在 + 类型」两个问题，消除 existsSync/statSync 之间的检查窗口
        fileStat = statSync(sqlPath);
    } catch (err) {
        // ENOENT：stat 时文件已不存在，归为文件缺失而非 IO 异常
        if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
            throw new HttpError({ ...ERROR_DEFS.db_sql_file_not_found });
        }
        // stat失败：权限、文件被锁等
        throw new HttpError({ ...ERROR_DEFS.db_io_error });
    }

    // 拒绝目录、设备文件等，只允许普通文件
    if (!fileStat.isFile()) {
        throw new HttpError({ ...ERROR_DEFS.db_sql_not_a_file });
    }

    try {
        const content = readFileSync(sqlPath, 'utf-8');
        // 生产环境存入缓存；开发环境不缓存
        if (!IS_DEV) {
            sqlCache.set(sqlPath, content);
        }
        return content;
    } catch (err) {
        // 读文件失败：权限、IO错误等
        throw new HttpError({ ...ERROR_DEFS.db_io_error });
    }
}

/**
 * 清除SQL缓存，便于开发环境热重载场景手动调用
 * 仅在dev使用，生产不需要调用
 */
export function clearSqlCache(): void {
    sqlCache.clear();
}