import { escapeHtml } from '@utils/escapeHtml';
import { loadTemplate } from '@/templates';
import { t } from '@/i18n/translate';

/**
 * 确认弹窗 + htmx:confirm 拦截模块。
 *
 * 只负责：
 *  - showConfirm：打开确认弹窗，resolve(true/false)
 *  - handleHTMXRequestConfirm：htmx:confirm 事件拦截处理器（供多处复用）
 *  - closeModal / VARIANT_STYLES：内部工具
 */

/** htmx:confirm 事件对象：elt 为触发元素，issueRequest 确认后放行请求 */
export type ConfirmEvent = CustomEvent<{
    elt: HTMLElement;
    issueRequest: (skipConfirmation?: boolean) => void;
}>;

/** 弹窗配置：标题、确认文案、配色、图标 */
interface ConfirmOptions {
    title?: string;
    confirmText?: string;
    cancelText?: string;
    /** danger = 红色（删除）；warn = 黄色（警示）；info = 蓝色/常规（切换等） */
    variant?: 'danger' | 'warn' | 'info';
}

/** 变体配色：图标徽章、图标路径、确认按钮，全部随 variant 切换 */
const VARIANT_STYLES = {
    danger: {
        badge: 'bg-rose-50 ring-rose-100 text-rose-500',
        icon: 'M12 9v4m0 4h.01M10.29 3.86l-8.12 14.18A2 2 0 0 0 4 21h16a2 2 0 0 0 1.84-2.96L17.71 7.86a2 2 0 0 0-1.71-3h-.08a2 2 0 0 0-1.72 1z',
        confirmBtn: 'btn-danger',
    },
    warn: {
        badge: 'bg-amber-50 ring-amber-100 text-amber-600',
        icon: 'M12 9v4m0 4h.01M10.29 3.86l-8.12 14.18A2 2 0 0 0 4 21h16a2 2 0 0 0 1.84-2.96L17.71 7.86a2 2 0 0 0-1.71-3h-.08a2 2 0 0 0-1.72 1z',
        confirmBtn: 'btn-warning',
    },
    info: {
        badge: 'bg-emerald-50 ring-emerald-100 text-emerald-600',
        icon: 'M9 12l2 2 4-4m6 2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
        confirmBtn: 'btn-primary',
    },
} as const;

/** 打开确认框，resolve(true) 表示确认，resolve(false) 表示取消 */
export async function showConfirm(
    message: string,
    options: ConfirmOptions = {},
): Promise<boolean> {
    const { title, confirmText, cancelText, variant = 'info' } = options;
    const style = VARIANT_STYLES[variant];

    // 骨架按需从 #confirm-template 加载，这里只填文案 + 切配色
    const source = await loadTemplate('confirm-template');
    const root = source.content.firstElementChild?.cloneNode(true) as
        | HTMLElement
        | undefined;
    if (!root) return false;

    closeModal();

    root.querySelector<HTMLElement>('[data-confirm-title]')!.textContent = escapeHtml(title);
    root.querySelector<HTMLElement>('[data-confirm-msg]')!.textContent = escapeHtml(message);
    root.querySelector<HTMLElement>('[data-confirm-cancel]')!.textContent = escapeHtml(cancelText);
    root.querySelector<HTMLElement>('[data-confirm-ok]')!.textContent = escapeHtml(confirmText);

    const badge = root.querySelector<HTMLElement>('[data-confirm-badge]')!;
    badge.className += ` ${style.badge}`;
    root
        .querySelector<SVGPathElement>('[data-confirm-icon]')!
        .setAttribute('d', style.icon);
    root
        .querySelector<HTMLButtonElement>('[data-action="confirm"]')!
        .classList.add(style.confirmBtn);

    return new Promise<boolean>((resolve) => {
        document.body.appendChild(root);

        // 关闭函数
        const resolveAndClose = (value: boolean) => {
            closeModal();
            resolve(value);
            document.removeEventListener('keydown', onKey);
        };

        // 事件绑定
        root
            .querySelector<HTMLButtonElement>('[data-action="confirm"]')!
            .addEventListener('click', () => resolveAndClose(true));
        root
            .querySelector<HTMLButtonElement>('[data-action="cancel"]')!
            .addEventListener('click', () => resolveAndClose(false));

        // 点击遮罩(100vw×100vh 的 mask)不关闭弹窗，只能通过"取消"按钮或 Esc 关闭
        // Esc 关闭
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') resolveAndClose(false);
        };
        document.addEventListener('keydown', onKey);
    });
}

/** 移除弹窗 DOM */
function closeModal(): void {
    const old = document.getElementById('confirm-overlay');
    if (old) old.remove();
}

/**
 * htmx:confirm 拦截处理器：带 data-confirm 的操作弹出确认框，确认后放行请求。
 *
 * 用法（任意入口注册一次，document 委托，兼容动态渲染的按钮）：
 *   document.addEventListener('htmx:confirm', handleHTMXRequestConfirm);
 *
 * 约定的 data-* 属性（都可选，缺省走 i18n 词条）：
 *   - data-confirm           确认消息文本（无此属性 → 放行不发确认框）
 *   - data-confirm-title     标题（fallback confirm.title）
 *   - data-confirm-confirm   确认按钮文案（fallback confirm.confirm_btn）
 *   - data-confirm-cancel    取消按钮文案（fallback confirm.cancel_btn）
 *   - data-confirm-variant   配色变体：danger / warn / info
 *
 * 注意：该版本 htmx 派发的事件名是 `htmx:confirm`（在 elt 上派发并冒泡到 document），
 *      不是旧版的 `htmx:confirmRequest`，用错事件名会导致监听永不触发。
 */
export function handleHTMXRequestConfirm(event: Event): void {
    const evt = event as ConfirmEvent;
    const elt = evt.detail.elt;
    const getAttr = (name: string) =>
        elt.getAttribute(name) ??
        elt.closest('[data-confirm]')?.getAttribute(name);

    const message = getAttr('data-confirm');

    // 没有确认标记（切换/新增等）→ 放行，htmx 正常发请求
    if (!message) return;

    // 有确认标记 → 拦下来，做异步确认
    evt.preventDefault();
    const getText = (attrName: string, fallbackKey: string) => {
        const text = getAttr(attrName);
        return text?.trim() ? text : t(fallbackKey);
    };

    const texts = {
        title: getText('data-confirm-title', 'confirm.title'),
        confirmText: getText('data-confirm-confirm', 'confirm.confirm_btn'),
        cancelText: getText('data-confirm-cancel', 'confirm.cancel_btn'),
    };

    void showConfirm(message, {
        ...texts,
        variant:
            (getAttr('data-confirm-variant') as ConfirmOptions['variant'] | null) ??
            undefined,
    }).then((ok) => {
        if (ok) evt.detail.issueRequest();
    });
}
