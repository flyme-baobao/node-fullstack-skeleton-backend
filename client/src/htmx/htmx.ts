import { mountHtmxLifecycle } from './mountHtmxLifecycle';

/**
 * htmx 装配入口：加载 htmx.org + 挂载生命周期事件。
 *
 * 负责把 htmx 拉起来并配好全局事件。
 */

/**
 * 初始化 htmx：动态加载并将实例缓存到 window.htmx，随后挂载生命周期事件。
 * @returns 已加载的 htmx 实例
 */
export async function initHtmx(): Promise<HTMX> {
    const htmx = (await import('htmx.org')).default;
    
    window.htmx = htmx;

    mountHtmxLifecycle();
    console.log('[htmx] loaded & lifecycle mounted');
    return htmx;
}