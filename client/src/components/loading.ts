import './loading.scss';
import { loadTemplate } from '../templates/templates';
import { t } from '../i18n/i18n';

/**
 * 请求 Loading 组件 —— 两种形态，按场景选用：
 *
 *  1) 全局视口遮罩（本文件，JS 驱动）：
 *     fixed inset-0 覆盖整个视口，用于「应用启动」这类没有局部容器可挂的阶段
 *     （bootstrap 首屏：语言包/路由清单/htmx 加载完成、#root 换入首屏内容前）。
 *     模板先经 initLoadingTemplate 预载（幂等），show / hide 均同步且幂等。
 *
 *  2) DOM 区域遮罩（CSS 驱动，无 JS）：
 *     htmx 元素用 hx-indicator 指向带 .loading-region 类的容器，请求期间 htmx
 *     自动给它加/摘 .htmx-request，loading.scss 据此显示/隐藏容器内的 .loading-overlay。
 *     适用局部刷新（如 /list 手动刷新按钮），见 server/src/views/pages/listPage.ejs。
 *
 * 骨架按需从 templates/loading.html 加载（与 toast / confirm 同一套模板机制）。
 */

/** 预载的遮罩模板元素；initLoadingTemplate 完成后可用，show 时克隆一份上屏 */
let templateEl: HTMLElement | null = null;

/** 模板预载 Promise 缓存：initLoadingTemplate 幂等的关键（重复调用复用同一份） */
let templateReady: Promise<void> | null = null;

/** 当前视口遮罩实例；null = 未显示（show / hide 幂等的关键） */
let globalEl: HTMLElement | null = null;

/**
 * 预载 loading 模板（幂等）。bootstrap 启动最早期调用，先于语言包/htmx 等
 * 模块加载，使后续 showGlobalLoading 可以同步上屏。
 * 遮罩属辅助反馈：预载失败仅记录日志并保持不可用，不阻断启动流程。
 */
export function initLoadingTemplate(): Promise<void> {
    templateReady ??= loadTemplate('loading-template')
        .then((source) => {
            templateEl =
                (source.content.firstElementChild?.cloneNode(true) as HTMLElement | undefined) ??
                null;
        })
        .catch((err) => {
            console.error('[loading] 模板预载失败，视口遮罩不可用', err);
        });
    return templateReady;
}

/**
 * 显示全局视口 Loading 遮罩（同步）。前置条件：initLoadingTemplate 已完成
 * （bootstrap 启动第一步已保证）；模板未就绪或预载失败时为无操作。
 * - 幂等：已显示时直接跳过，不叠加。
 * - 文案：i18n 已就绪则覆写为 t('common.loading')；启动初期语言包尚未回填
 *   （t() 会兜底返回 key 本身），此时沿用模板内置文案，避免把 key 露给用户。
 */
export function showGlobalLoading(): void {
    if (globalEl || !templateEl) return;

    const el = templateEl.cloneNode(true) as HTMLElement;

    const text = el.querySelector<HTMLElement>('[data-loading-text]');
    if (text) {
        const translated = t('common.loading');
        if (translated !== 'common.loading') text.textContent = translated;
    }

    document.body.appendChild(el);
    globalEl = el;
}

/**
 * 隐藏全局视口 Loading 遮罩。未显示时为无操作（幂等），可挂在
 * 首屏 swap 完成、启动失败、路由兜底等多处收尾点，不必担心重复调用。
 */
export function hideGlobalLoading(): void {
    globalEl?.remove();
    globalEl = null;
}
