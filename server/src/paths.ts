import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * 向上逐级查找包含 package.json 的目录，确定项目根。
 * 兼容两种运行形态：
 *   - dev/tsx：__dirname = <root>/server/src（深 2 级）
 *   - prod/编译：__dirname = <root>/dist-server（深 1 级）
 * 因此不能用固定层数的相对路径去触碰 dist-client / data，
 * 统一由项目根推导最稳妥。
 */
function findProjectRoot(from: string = here): string {
    let dir = from;
    for (;;) {
        if (existsSync(path.join(dir, 'package.json'))) return dir;
        const parent = path.dirname(dir);
        if (parent === dir) {
            throw new Error('无法定位项目根目录（未找到 package.json）');
        }
        dir = parent;
    }
}

export const projectRoot = findProjectRoot();

/** 前端构建产物目录 */
export const clientDistDir = path.join(projectRoot, 'dist-client');

/** 待办数据目录 */
export const dataDir = path.join(projectRoot, 'data');