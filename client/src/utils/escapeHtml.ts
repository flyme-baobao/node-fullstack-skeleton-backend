import { t } from '../i18n/i18n';

/**
 * 转义 HTML，避免外部文本（用户输入 / 待办标题等）把人注入到 DOM 结构里（防 XSS 注入）。
 * 支持 i18n：可选 defaultKey，str 为空时用该 key 的词条兜底。
 * @param str 待转义文本
 * @param defaultKey 可选 i18n key，str 为空时取 t(defaultKey) 兜底
 */
export function escapeHtml(str?: string, defaultKey?: string): string {
    if (!str) {
        return defaultKey ? escapeHtml(t(defaultKey)) : '';
    }
    return str.replace(
        /[&<>"']/g,
        (c) =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
    );
}