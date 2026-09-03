/**
 * 响应码登记表（协议层：响应体数字码的唯一事实来源）。
 *
 * 响应协议有两层数字，且业务码前三位即 HTTP 状态（`xxyyy` 约定），故集中在一个文件登记：
 *   - HTTP_STATUS：常用 HTTP 状态码。值由 HTTP 标准（IANA）冻结，此处仅登记项目实际用到的，用到再补；
 *   - BUSINESS_CODE：数字业务码（对外协议值，一经发布即冻结）。
 *
 * 约定：
 *   - 业务码格式 `xxyyy`：3 位 HTTP 状态 + 2 位序号，如 40001（400 组 01 号）。
 *   - 序号在组内只保证唯一与递增，不编码类别；新码一律取当前组内最大号 +1。
 *   - 通用兜底（400/404/500）无独立序号，直接引用 HTTP_STATUS。
 *   - 新增错误码两步走：①在 BUSINESS_CODE 登记数字 ②到 error-defs.ts 接线词条；
 *     漏了第②步不会编译报错（会留下无引用的死常量），可用词典完整性测试兜底。
 */

/** 常用 HTTP 状态码（值随 HTTP 标准，本项目只登记用到的） */
export const HTTP_STATUS = {
    BAD_REQUEST: 400,
    NOT_FOUND: 404,
    INTERNAL_SERVER_ERROR: 500,
} as const;

/** HTTP 状态码联合类型 */
export type HttpStatus = (typeof HTTP_STATUS)[keyof typeof HTTP_STATUS];

/** 数字业务码（本项目冻结协议值；测试等「只认数字」的场景也可直接 import 本表） */
export const BUSINESS_CODE = {
    // 400 组：客户端入参问题
    TODO_EMPTY: 40001,
    INVALID_UID: 40002,
    UNSUPPORTED_LANG: 40003,

    // 404 组：资源不存在
    TOGGLE_NOT_FOUND: 40401,
    REMOVE_NOT_FOUND: 40402,

    // 500 组：服务端故障
    // 500 业务
    CREATE_FAILED: 50001,
    REMOVE_FAILED: 50002,
    // 500 数据库
    DB_NOT_CONFIGURED: 50003,
    DB_CONNECT_ERROR: 50004,
    DB_QUERY_ERROR: 50005,
    DB_SQL_FILE_NOT_FOUND: 50006,
    DB_SQL_INVALID_PATH: 50007,
    DB_SQL_NOT_A_FILE: 50008,
    DB_IO_ERROR: 50009,

    // 通用兜底：直接复用 HTTP 状态码（单一事实来源）
    BAD_REQUEST: HTTP_STATUS.BAD_REQUEST,
    NOT_FOUND: HTTP_STATUS.NOT_FOUND,
    INTERNAL_ERROR: HTTP_STATUS.INTERNAL_SERVER_ERROR,
} as const;

/** 所有已登记数字业务码的联合类型 */
export type BusinessCode = (typeof BUSINESS_CODE)[keyof typeof BUSINESS_CODE];
