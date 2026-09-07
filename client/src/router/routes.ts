import { getSpaRoutes } from '@api/routes.api';

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
    let err: unknown;
    try {
        const data = await getSpaRoutes<RoutesManifest>();
        if (Array.isArray(data.valid) && data.valid.every((p) => typeof p === 'string')) {
            manifest = { valid: data.valid, base: data.base ?? '/' };
        }
    } catch (error) {
        manifest = null;
        err = error;
    } finally {
        if (!manifest) {
            console.warn('[routes] 拉取合法路径失败，路由守卫放行', err);
        } else {
            console.info('[routes] 已加载合法路径清单', manifest);
        }
    }
}