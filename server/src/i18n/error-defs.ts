/**
 * 错误码词典（词条映射层）。
 *
 * 职责：把「数字业务码 → HTTP 状态码 + i18n key」集中登记，
 * HttpError 构造时按 code 做映射，controller 只需 `new HttpError({ code })`。
 *
 * 与 constants/response-codes.ts 的分工：
 *   - HTTP_STATUS / BUSINESS_CODE：数字登记点（HTTP 状态码为标准值；业务码为本项目冻结协议值）；
 *   - 本词典：每个码的呈现配置（i18n key / HTTP status），code 与 status 一律引用上述常量，不写裸数字。
 *
 * 约定：
 *   - 业务码：`xxyyy`（3 位 HTTP 状态 + 2 位序号），如 40001；通用兜底直接复用 HTTP 状态码本身。
 *   - `message` 为 i18n key，对应 server/src/i18n/${lng}.json 的 `errors.*` 条目。
 */
import {
    BUSINESS_CODE,
    HTTP_STATUS,
    type BusinessCode,
    type HttpStatus,
} from '../constants/response-codes.js';

export interface ErrorCodeDefinition {
    /** 数字业务码（响应内带出） */
    readonly code: number;
    /** i18n key，指向 locales 的 errors.* */
    readonly message: string;
    /** HTTP 状态码（取值来自 HTTP_STATUS） */
    readonly status: HttpStatus;
}

export const ERROR_DEFS = {
    todo_empty: {
        code: BUSINESS_CODE.TODO_EMPTY,
        message: 'errors.todo_empty',
        status: HTTP_STATUS.BAD_REQUEST
    },
    invalid_uid: {
        code: BUSINESS_CODE.INVALID_UID,
        message: 'errors.invalid_uid',
        status: HTTP_STATUS.BAD_REQUEST
    },
    unsupported_lang: {
        code: BUSINESS_CODE.UNSUPPORTED_LANG,
        message: 'errors.unsupported_lang',
        status: HTTP_STATUS.BAD_REQUEST
    },
    invalid_params: {
        code: BUSINESS_CODE.INVALID_PARAMS,
        message: 'errors.invalid_params',
        status: HTTP_STATUS.BAD_REQUEST
    },
    toggle_not_found: {
        code: BUSINESS_CODE.TOGGLE_NOT_FOUND,
        message: 'errors.toggle_not_found',
        status: HTTP_STATUS.NOT_FOUND
    },
    remove_not_found: {
        code: BUSINESS_CODE.REMOVE_NOT_FOUND,
        message: 'errors.remove_not_found',
        status: HTTP_STATUS.NOT_FOUND
    },
    create_failed: {
        code: BUSINESS_CODE.CREATE_FAILED,
        message: 'errors.create_failed',
        status: HTTP_STATUS.INTERNAL_SERVER_ERROR
    },
    remove_failed: {
        code: BUSINESS_CODE.REMOVE_FAILED,
        message: 'errors.remove_failed',
        status: HTTP_STATUS.INTERNAL_SERVER_ERROR
    },
    db_not_configured: {
        code: BUSINESS_CODE.DB_NOT_CONFIGURED,
        message: 'errors.db_not_configured',
        status: HTTP_STATUS.INTERNAL_SERVER_ERROR
    },
    db_connect_error: {
        code: BUSINESS_CODE.DB_CONNECT_ERROR,
        message: 'errors.db_connect_error',
        status: HTTP_STATUS.INTERNAL_SERVER_ERROR
    },
    db_query_error: {
        code: BUSINESS_CODE.DB_QUERY_ERROR,
        message: 'errors.db_query_error',
        status: HTTP_STATUS.INTERNAL_SERVER_ERROR
    },
    db_sql_file_not_found: {
        code: BUSINESS_CODE.DB_SQL_FILE_NOT_FOUND,
        message: 'errors.db_sql_file_not_found',
        status: HTTP_STATUS.INTERNAL_SERVER_ERROR
    },
    db_sql_invalid_path: {
        code: BUSINESS_CODE.DB_SQL_INVALID_PATH,
        message: 'errors.db_sql_invalid_path',
        status: HTTP_STATUS.INTERNAL_SERVER_ERROR
    },
    db_sql_not_a_file: {
        code: BUSINESS_CODE.DB_SQL_NOT_A_FILE,
        message: 'errors.db_sql_not_a_file',
        status: HTTP_STATUS.INTERNAL_SERVER_ERROR
    },
    db_io_error: {
        code: BUSINESS_CODE.DB_IO_ERROR,
        message: 'errors.db_io_error',
        status: HTTP_STATUS.INTERNAL_SERVER_ERROR
    },
    redis_connect_error: {
        code: BUSINESS_CODE.REDIS_CONNECT_ERROR,
        message: 'errors.redis_connect_error',
        status: HTTP_STATUS.INTERNAL_SERVER_ERROR
    },
    redis_not_configured: {
        code: BUSINESS_CODE.REDIS_NOT_CONFIGURED,
        message: 'errors.redis_not_configured',
        status: HTTP_STATUS.INTERNAL_SERVER_ERROR
    },
    bad_request: {
        code: BUSINESS_CODE.BAD_REQUEST,
        message: 'errors.bad_request',
        status: HTTP_STATUS.BAD_REQUEST
    },
    unauthorized: {
        code: BUSINESS_CODE.UNAUTHORIZED,
        message: 'errors.unauthorized',
        status: HTTP_STATUS.UNAUTHORIZED
    },
    session_mismatch: {
        code: BUSINESS_CODE.SESSION_MISMATCH,
        message: 'errors.session_mismatch',
        status: HTTP_STATUS.UNAUTHORIZED
    },
    credential_invalid: {
        code: BUSINESS_CODE.CREDENTIAL_INVALID,
        message: 'errors.credential_invalid',
        status: HTTP_STATUS.UNAUTHORIZED
    },
    forbidden: {
        code: BUSINESS_CODE.FORBIDDEN,
        message: 'errors.forbidden',
        status: HTTP_STATUS.FORBIDDEN
    },
    account_exists: {
        code: BUSINESS_CODE.ACCOUNT_EXISTS,
        message: 'errors.account_exists',
        status: HTTP_STATUS.CONFLICT
    },
    not_found: {
        code: BUSINESS_CODE.NOT_FOUND,
        message: 'errors.not_found',
        status: HTTP_STATUS.NOT_FOUND
    },
    internal_error: {
        code: BUSINESS_CODE.INTERNAL_ERROR,
        message: 'errors.internal_error',
        status: HTTP_STATUS.INTERNAL_SERVER_ERROR
    },
} as const satisfies Record<string, ErrorCodeDefinition & { code: BusinessCode }>;

export type ErrorCodeName = keyof typeof ERROR_DEFS;

const BY_CODE = new Map<number, ErrorCodeDefinition>(
    Object.values(ERROR_DEFS).map((def) => [def.code, def]),
);

/** 按数字业务码取定义；未知码返回 undefined */
export function getErrorByCode(code: number): ErrorCodeDefinition | undefined {
    return BY_CODE.get(code);
}
