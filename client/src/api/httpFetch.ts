import { userService } from '@service/userService';
import { getUrlWithParams } from '@utils/url';
import { errorHandle } from '@utils/errorHandle';
import { CONTENT_TYPE } from '@constants/contentType';
type FetchOptions = RequestInit;
type ERROR_RESPONSE = {
    code: number;
    message: string;
    messageKey?: string;
};

/**
 * @description fetch 简易封装
 *
 * - 请求拦截：自动附加 Authorization Bearer token
 * - 参数处理：GET/HEAD 将 data 转为 query；其它方法按 contentType 处理请求体(JSON/form‑urlencoded/multipart)
 * - 网络异常(断网/CORS/DNS等)：弹出 network_error 提示后抛出异常
 * - 响应处理：2xx 自动解析 JSON 返回；非2xx解析错误体，经 errorHandle 弹窗，抛出 HttpFetchError
 *
 * @template T 成功返回数据类型
 * @param url 请求地址
 * @param init 请求配置，data：GET/HEAD为query，其余为body；contentType 指定编码；credentials 默认 include
 * @returns Promise<T>
 * @throws {HttpFetchError} 非2xx响应，携带 status、data 错误体
 */
export async function httpFetch<T = any>(url: RequestInfo | URL, init: FetchOptions & {
    contentType?: string
    data?: Record<string, any> | BodyInit | null
} = {}
): Promise<T> {
    const {
        method = 'GET',
        data,
        headers: _headers = {},
        contentType,
        credentials = 'include',
        ...restOpts
    } = init;

    const reqMethod = method.toUpperCase();
    const fetchOpts: FetchOptions = {
        method: reqMethod,
        credentials, // 允许跨域携带cookie
        ...restOpts,
    };

    // ========== 请求拦截（发请求之前） ==========
    const headers = new Headers(_headers);

    // 示例：统一带上token
    const token = userService.getToken();
    if (token) {
        headers.set("Authorization", `Bearer ${token}`);
    }


    let fetchUrl = url;
    if (['GET', 'HEAD'].includes(reqMethod)) {
        if (data !== null && data && typeof data === 'object') {
            const _data = data as Record<string, any>;
            fetchUrl = getUrlWithParams(fetchUrl.toString(), window.location.origin, _data);
        }
    } else {
        if (data) {
            if (data instanceof FormData || contentType === CONTENT_TYPE.MULTIPART_FORM_DATA) {
                headers.delete("Content-Type"); // 浏览器会自动设置正确的Content-Type和boundary
                fetchOpts.body = data as FormData
            } else if (contentType === CONTENT_TYPE.FORM_URLENCODED) {
                headers.set("Content-Type", CONTENT_TYPE.FORM_URLENCODED);
                fetchOpts.body = new URLSearchParams(data as Record<string, any>).toString();
            } else {
                headers.set("Content-Type", CONTENT_TYPE.JSON);
                fetchOpts.body = JSON.stringify(data);
            }
        }
    }

    fetchOpts.headers = headers;

    // ========== 网络层拦截（断网 / 超时 / CORS / DNS 失败） ==========
    // fetch 本身在这些场景下 reject（TypeError: Failed to fetch），不弹 toast 的话业务层
    // 若未 catch 就静默无提示。这里对齐 htmx sendError 的行为：统一弹 network_error。
    let res: Response;
    try {
        res = await fetch(fetchUrl, fetchOpts);
    } catch (err) {
        errorHandle({
            message: undefined,
            fallback: { key: 'toast.network_error' },
        });
        throw err;
    }

    if (res.ok) {
        // 统一解析JSON，业务层不用重复写 res.json()
        let data;
        try {
            data = await res.json();
        } catch {
            data = null;
        }
        return data;
    }

    // ========== 响应拦截（收到响应之后） ==========
    // 读取响应体body，尝试解析为JSON；若失败则返回null
    let errorData: ERROR_RESPONSE | null = null;
    try {
        errorData = await res.json();
    } catch {
        errorData = null;
    }

    // 选词条 + 插值 + 弹 toast 统一走 errorHandle
    const { status, statusText } = res;
    errorHandle({
        message: errorData?.message,
        status,
        fallback: {
            key: 'toast.request_failed',
            params: { status, message: statusText },
            statusText,
        },
    });

    let errorMessage = errorData?.message ?? statusText;
    // 统一抛出错误，业务层可在catch里处理
    throw new HttpFetchError(errorMessage, status, errorData);

}


class HttpFetchError extends Error {
    status?: number;
    data?: ERROR_RESPONSE | null;
    constructor(msg: string, status?: number, data?: ERROR_RESPONSE | null) {
        super(msg);
        this.name = "HttpFetchError";
        this.status = status;
        this.data = data;
    }
}
