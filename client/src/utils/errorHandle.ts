import { showConfirm, CONFIRM_VARIANT } from '@components/confirm';
import { showToast, ToastVariant } from '@components/toast';
import { t } from '@/i18n/translate';
import { SIGNIN_PATH } from '@/constants/api';
import { cacheRedirectAuth } from './authCache';

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
    /** HTTP 状态码：用于区分「权限问题(401/403)→弹确认框」与「普通错误→toast」 */
    status?: number;
    /** 兜底词条：key 为 i18n 点号路径，params 为插值参数 */
    fallback: {
        key: string;
        params?: Record<string, string | number>;
        /** 词条未命中时的最终兜底：HTTP 状态文本 */
        statusText?: string;
    };
}

/** 静默路由名单：这些页面路径下 errorHandle 只计算文案、不弹全局 toast。
 *  适用场景：错误已在页面内联回显的页面（登录/注册表单 422 放行渲染），
 *  全局 toast 会与表单错误提示重复。新增静默页往数组里加 pathname 即可。 */
const SILENT_ROUTES: string[] = [];

/** 当前页面 pathname 是否命中静默名单（去尾斜杠归一化，与 routes.ts 口径一致）。 */
function isSilentRoute(): boolean {
    const path = window.location.pathname.replace(/\/$/, '') || '/';
    return SILENT_ROUTES.includes(path);
}
/**
 * 权限问题状态码集合：401（未认证）/ 403（无权限）。
 * 429（请求过频）被排除在外——它属于登录页场景，按普通错误走 toast，不弹权限告警。
 */
const PERMISSION_STATUSES = new Set<number>([401, 403]);

/** 当前 status 是否判定为权限问题（401/403，429 除外）。status 缺失一律按普通错误处理。 */
function isPermissionStatus(status?: number): boolean {
    return Boolean(status) && PERMISSION_STATUSES.has(status!);
}

/** 按优先级解析出最终展示文案（不弹 toast）：① 调用方消息 → ② 兜底词条 → ③ status/statusText 拼接。 */
function resolveErrorText(data: ErrorHandleData): string {
    const { message, status, fallback } = data;

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
    return `Request failed: ${status ?? ''} ${fallback.statusText ?? ''}`.trim();
}

/**
 * 解析错误消息并弹出全局提示。
 *
 * 提示形态按状态码区分（静默路由名单内的页面只返回文案不弹）：
 *  - 权限问题（401/403，429 除外）→ 弹确认弹窗，引导用户重新登录
 *  - 其它（含 429）→ 弹全局 toast
 * 返回最终展示的文案，便于调用方在日志里复用同一份消息。
 */
export function errorHandle(data: ErrorHandleData): string {
    const text = resolveErrorText(data);
    // 静默路由：文案照常返回（日志可复用），只是不上屏
    if (isSilentRoute()) {
        return text;
    }
    // 权限问题 → 弹确认弹窗（告警配色），引导重新登录；其它 → toast
    if (isPermissionStatus(data.status)) {
        const message = t('auth.permission.message') || text;
        void showConfirm(message, {
            title: t('auth.permission.title'),
            confirmText: t('auth.permission.confirm'),
            cancelText: t('auth.permission.cancel'),
            variant: CONFIRM_VARIANT.WARN,
        }).then((ok) => {
            if (ok) {
                // 权限失效：凭证已无效，探针标记为已探测（true），跳登录页前记录回跳路径
                cacheRedirectAuth(true);
                // 重新登录：刷新页面，走 auth.middleware 重新解析凭证
                history.pushState({}, '', SIGNIN_PATH);
            };
        });
    } else {
        void showToast(text, ToastVariant.Error);
    }
    return text;
}