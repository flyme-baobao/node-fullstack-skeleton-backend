import { getUrlWithParams } from '@/utils/url';
import { errorHandle } from '@/utils/errorHandle';

type FetchOptions = RequestInit;
type ERROR_RESPONSE = {
    code: number;
    message: string;
    messageKey?: string;
};

/**
 * fetch封装，简易拦截器能力
 */
export async function httpFetch<T = any>(url: RequestInfo | URL, init: FetchOptions & { 
    contentType?: string 
    data?: Record<string, any> | BodyInit | null
} = {}
): Promise<T> {
    const {
        method = 'GET',
        data,
        headers: _headers ={},
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
    const token = localStorage.getItem("token");
    if (token) {
        headers.set("Authorization", `Bearer ${token}`);
    }


    let fetchUrl = url;
    if (['GET', 'HEAD'].includes(reqMethod)) {
        if ( data && typeof data === 'object') {
            const _data = data as Record<string, any>;
            fetchUrl = getUrlWithParams(fetchUrl.toString(), window.location.origin, _data);
        }
    } else {
        if (data) {
            if (data instanceof FormData || contentType === 'multipart/form-data') {
                headers.delete("Content-Type"); // 浏览器会自动设置正确的Content-Type和boundary
                fetchOpts.body = data as FormData
            } else if (contentType === 'application/x-www-form-urlencoded') {
                headers.set("Content-Type", "application/x-www-form-urlencoded");
                fetchOpts.body = new URLSearchParams(data as Record<string, any>).toString();
            } else {
                headers.set("Content-Type", "application/json");
                fetchOpts.body = JSON.stringify(data);
            }
        }
    }

    fetchOpts.headers = headers;

    const res = await fetch(fetchUrl, fetchOpts);

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
    } finally {
    }

    // 选词条 + 插值 + 弹 toast 统一走 errorHandle
    errorHandle({
        message: errorData?.message,
        fallback: {
            key: 'toast.request_failed',
            params: { status: res.status, message: res.statusText },
            status: res.status,
            statusText: res.statusText,
        },
    });
    // 统一抛出错误，业务层可在catch里处理
    const error = new Error(JSON.stringify(errorData));
    (error as any).status = res.status;
    (error as any).data = errorData;
    throw error;

}
