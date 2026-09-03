/**
 * 错误码词典（单一事实来源）。
 *
 * 职责：把「数字业务码 → HTTP 状态码 + i18n key」集中登记，
 * HttpError 构造时按 code 做映射，controller 只需 `new HttpError({ code })`。
 *
 * 约定：
 *   - 业务码：`xxyyy`（3 位 HTTP 状态 + 2 位序号），如 40001；通用兜底用裸状态码（400/404/500）。
 *   - `message` 为 i18n key，对应 server/src/i18n/${lng}.json 的 `errors.*` 条目。
 */

export interface ErrorCodeDefinition {
    /** 数字业务码（响应内带出） */
    readonly code: number;
    /** i18n key，指向 locales 的 errors.* */
    readonly message: string;
    /** HTTP 状态码 */
    readonly status: number;
}

export const ERROR_CODES = {
    todo_empty:       { code: 40001, message: 'errors.todo_empty', status: 400 },
    invalid_uid:      { code: 40002, message: 'errors.invalid_uid', status: 400 },
    unsupported_lang: { code: 40003, message: 'errors.unsupported_lang', status: 400 },
    toggle_not_found: { code: 40401, message: 'errors.toggle_not_found', status: 404 },
    remove_not_found: { code: 40402, message: 'errors.remove_not_found', status: 404 },
    create_failed:    { code: 50001, message: 'errors.create_failed', status: 500 },
    remove_failed:    { code: 50002, message: 'errors.remove_failed', status: 500 },
    db_not_configured: { code: 50003, message: 'errors.db_not_configured', status: 500 },
    db_connect_error:  { code: 50004, message: 'errors.db_connect_error', status: 500 },
    db_query_error:    { code: 50005, message: 'errors.db_query_error', status: 500 },
    bad_request:      { code: 400,   message: 'errors.bad_request', status: 400 },
    not_found:        { code: 404,   message: 'errors.not_found', status: 404 },
    internal_error:   { code: 500,   message: 'errors.internal_error', status: 500 },
} as const satisfies Record<string, ErrorCodeDefinition>;

export type ErrorCodeName = keyof typeof ERROR_CODES;

const BY_CODE = new Map<number, ErrorCodeDefinition>(
    Object.values(ERROR_CODES).map((def) => [def.code, def]),
);

/** 按数字业务码取定义；未知码返回 undefined */
export function getErrorByCode(code: number): ErrorCodeDefinition | undefined {
    return BY_CODE.get(code);
}
