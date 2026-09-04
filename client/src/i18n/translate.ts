/**
 * 客户端 i18n 取词条工具。
 * 词条定义在服务端（server/src/locales/*.json），纯 SPA 下：
 *  - 首屏由入口 bootstrap 调 i18n/language.ts 的 initLanguagePack() 拉取 → window.I18n；
 *  - 切换语言由 i18n/language.ts 调 POST /api/change-language 更新 window.I18n。
 * 本函数根据点号 key（如 "toast.network_error"）从该对象取值，
 * 支持 {{var}} 插值，找不到时回退返回 key 本身。
 */

/**
 * 从 window.I18n 取词条。
 * @param key 点号路径，如 "toast.network_error"
 * @param params 插值参数，模板里用 {{name}} 占位
 */
export function t(
    key: string,
    params: Record<string, string | number> = {},
): string {
    const source = window.I18n as Record<string, unknown> | undefined;
    let value: unknown = key
        .split('.')
        .reduce<unknown>((acc, seg) => {
            if (acc && typeof acc === 'object') {
                return (acc as Record<string, unknown>)[seg];
            }
            return undefined;
        }, source);

    if (typeof value !== 'string') return key; // 兜底：返回 key，便于发现缺失词条

    return value.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) =>
        params[name] != null ? String(params[name]) : '',
    );
}