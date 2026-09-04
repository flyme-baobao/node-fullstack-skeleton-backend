import { escapeHtml } from '@utils/escapeHtml';
import { loadTemplate } from '@/templates';

/**
 * 全局 Toast 提示 —— 纯 UI 组件。
 *
 * 只负责：showToast 弹出提示 + 自动消失 + ✕ 手动关闭。
 * 触发时机由 router/mountHtmxLifecycle.ts 决定（4xx/5xx、网络错误等）。
 * 骨架按需从 templates/templates.ts 加载，克隆后注入到 <div id="toast-slot">（fixed 定位）。
 */

/** toast 变体（错误 / 一般提示）：导出常量 + 派生类型，供外部复用 */
export const ToastVariant = {
    Error: 'error',
    Success: 'success',
} as const;

export type ToastVariant = (typeof ToastVariant)[keyof typeof ToastVariant];

/** 不同变体的配色类（骨架在 templates/toast.html 里） */
const VARIANT_CLASSES: Record<ToastVariant, string> = {
    error: 'border-rose-200 bg-rose-50 text-rose-700',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
};

/** 自动消失延迟（ms） */
const AUTO_DISMISS_MS = 5000;

let dismissTimer: number | undefined;

/**
 * 弹出全局 toast。连续调用会替换上一条，不堆叠。
 * 骨架按需从 #toast-template 加载，克隆后只切配色 + 填文案。
 * @param message 提示文案
 * @param variant error = 红色（错误）/ success = 绿色（一般提示）
 */
export async function showToast(
    message: string,
    variant: ToastVariant = 'error',
): Promise<void> {
    const source = await loadTemplate('toast-template');

    const slot = document.querySelector<HTMLElement>('#toast-slot');
    if (!slot) return;

    // 替换旧 toast：先清掉旧定时器与旧节点（避免连续错误堆叠）
    window.clearTimeout(dismissTimer);
    slot.replaceChildren();

    const toast = source.content.firstElementChild?.cloneNode(true) as
        | HTMLElement
        | undefined;
    if (!toast) return;

    const msg = toast.querySelector<HTMLElement>('[data-toast-msg]');
    if (msg) msg.textContent = escapeHtml(message);

    toast.setAttribute('role', variant === 'error' ? 'alert' : 'status');
    toast.classList.add(...VARIANT_CLASSES[variant].split(' '));

    toast
        .querySelector<HTMLElement>('[data-toast-close]')
        ?.addEventListener('click', () => dismiss(toast));

    slot.appendChild(toast);

    dismissTimer = window.setTimeout(() => dismiss(toast), AUTO_DISMISS_MS);
}

/** 移除指定 toast 并清掉定时器 */
function dismiss(toast: HTMLElement): void {
    window.clearTimeout(dismissTimer);
    toast.remove();
}