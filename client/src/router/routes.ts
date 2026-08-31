import { API_PREFIX } from '../constants/api';

export interface RoutesManifest {
    valid: string[];
    base: string;
}

let manifest: RoutesManifest | null = null;

/** 归一化浏览器路径：只取 pathname，去掉尾部斜杠，兜底成 '/'（search/hash 不参与守卫）。 */
function normalize(path: string): string {
    const p = new URL(path, window.location.origin).pathname;
    return p.replace(/\/$/, '') || '/';
}

/** 校验 path 是否为合法路由（清单未就绪时放行）。 */
export function isValidPath(path: string): boolean {
    if (!manifest) return true; // 清单未就绪 → 放行（安全默认）
    return manifest.valid.includes(normalize(path));
}

/** 运行时拉取合法路由清单并缓存；失败时置为 null（守卫退化为放行），不抛出。 */
export async function loadRoutes(): Promise<void> {
    try {
        const res = await fetch(`${API_PREFIX}/__routes`);
        if (!res.ok) throw new Error(`routes fetch ${res.status}`);
        const data = (await res.json()) as RoutesManifest;
        if (!Array.isArray(data.valid)) throw new Error('invalid manifest');
        manifest = { valid: data.valid, base: data.base ?? '/' };
    } catch (err) {
        // 拉取失败：manifest=null，守卫放行所有路径，保证首屏不被阻塞。
        console.warn('[routes] 拉取合法路径失败，路由守卫放行', err);
        manifest = null;
    }
}