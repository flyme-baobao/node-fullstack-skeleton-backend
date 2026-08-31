// 通用静态资源拷贝：把 server/src 下「tsc 不会产出」的文件原样复制到 dist-server。
// tsc -p tsconfig.server.json 负责：编译 .ts -> .js，以及「被动 import 的 .json」（resolveJsonModule）。
// 本脚本补齐 tsc 不碰的文件：.ejs、未被 import 的 .json、.svg/.png/.woff 等其他一切静态资源。
// 用法：node scripts/build-server.js
import { mkdirSync, readdirSync, copyFileSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 向上逐级查找包含 package.json 的目录，确定项目根。
 * 与 server/src/paths.ts 的 findProjectRoot 保持一致，不依赖脚本当前所在的固定层数，
 * 避免 scripts/ 目录改名或搬动时失效。
 */
function findProjectRoot(from) {
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

const root = findProjectRoot(__dirname);
const srcRoot = path.join(root, 'server', 'src');
const outRoot = path.join(root, 'dist-server');

/**
 * 会被 tsc 产出的后缀，这里一律跳过，避免重复。
 * 注意：**不含** .json —— 原因见下方说明。
 */
const TSC_HANDLED_EXT = new Set(['.ts', '.js', '.map', '.tsbuildinfo']);

/**
 * 递归 server/src，保留相对目录结构，把「tsc 不管」的文件全部复制到 dist-server。
 */
function copyAssets(relPath) {
    const absSrc = path.join(srcRoot, relPath);
    if (!existsSync(absSrc)) return;
    if (statSync(absSrc).isDirectory()) {
        for (const entry of readdirSync(absSrc)) {
            copyAssets(path.join(relPath, entry));
        }
        return;
    }
    if (TSC_HANDLED_EXT.has(path.extname(absSrc))) return; // 交给 tsc

    const target = path.join(outRoot, relPath);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(absSrc, target);
    console.log('  ✔', relPath);
}

console.log('[copy-assets] 复制服务端静态资源到 dist-server');
copyAssets('.');
console.log('[copy-assets] 完成');