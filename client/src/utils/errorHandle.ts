import { showToast, ToastVariant } from '@components/toast';
import { t } from '@/i18n/translate';

/**
 * 统一错误提示出口（errorHandle.ts）
 *
 * 收敛「错误响应 → 可读消息 → 弹 toast」的公共逻辑，供 httpFetch 与
 * mountHtmxLifecycle 共用。两处各自只负责「从响应里抠出 message」，
 * 选词条、插值、兜底、弹 toast 全部在这里完成，避免重复。
 *
 * 消息优先级：
 *   1. data.message（调用方已从响应体/头解析出的可读消息）→ 直接用；
 *   2. fallback.key 词条（t() 插值后）→ 用词条文案；
 *   3. 词条未命中（t() 返回 key 本身）→ 用 fallback 里的 status/statusText 拼兜底文案。
 */
export interface ErrorHandleData {
    /** 已解析出的可读消息（优先）；缺省时走 fallback 词条 */
    message?: string;
    /** 兜底词条：key 为 i18n 点号路径，params 为插值参数 */
    fallback: {
        key: string;
        params?: Record<string, string | number>;
        /** 词条未命中时的最终兜底：HTTP 状态码 */
        status?: number;
        /** 词条未命中时的最终兜底：HTTP 状态文本 */
        statusText?: string;
    };
}

/** 静默路由名单：这些页面路径下 errorHandle 只计算文案、不弹全局 toast。
 *  适用场景：错误已在页面内联回显的页面（登录/注册表单 422 放行渲染），
 *  全局 toast 会与表单错误提示重复。新增静默页往数组里加 pathname 即可。 */
const SILENT_ROUTES: string[] = ['/signin', '/signup'];

/** 当前页面 pathname 是否命中静默名单（去尾斜杠归一化，与 routes.ts 口径一致）。 */
function isSilentRoute(): boolean {
    const path = window.location.pathname.replace(/\/$/, '') || '/';
    return SILENT_ROUTES.includes(path);
}

/** 按优先级解析出最终展示文案（不弹 toast）：① 调用方消息 → ② 兜底词条 → ③ status/statusText 拼接。 */
function resolveErrorText(data: ErrorHandleData): string {
    const { message, fallback } = data;

    // ① 已解析出的可读消息优先
    if (message && message.trim()) {
        return message;
    }

    // ② 兜底词条（t() 插值；未命中时返回 key 本身）
    const fallbackText = t(fallback.key, fallback.params);
    if (fallbackText !== fallback.key) {
        return fallbackText;
    }

    // ③ 词条未命中 → 用 status/statusText 拼最终兜底
    return `Request failed: ${fallback.status ?? ''} ${fallback.statusText ?? ''}`.trim();
}

/**
 * 解析错误消息并弹全局 toast（error 变体）；静默路由名单内的页面只返回文案不弹。
 * 返回最终展示的文案，便于调用方在日志里复用同一份消息。
 */
export function errorHandle(data: ErrorHandleData): string {
    const text = resolveErrorText(data);
    // 静默路由：文案照常返回（日志可复用），只是不上屏
    if (isSilentRoute()) {
        return text;
    }
    showToast(text, ToastVariant.Error);
    return text;
}