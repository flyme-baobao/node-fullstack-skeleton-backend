type FetchOptions = RequestInit;

/**
 * fetch封装，简易拦截器能力
 */
async function httpFetch(input: RequestInfo | URL, init?: FetchOptions) {
    // ========== 请求拦截（发请求之前） ==========
    const headers = new Headers(init?.headers);

    // 示例：统一带上token
    const token = localStorage.getItem("token");
    if (token) {
        headers.set("Authorization", `Bearer ${token}`);
    }
    // 默认json请求头
    if (!headers.has("Content-Type") && !(init?.body instanceof FormData)) {
        headers.set("Content-Type", "application/json");
    }

    const mergedInit: FetchOptions = {
        ...init,
        headers,
    };

    const res = await fetch(input, mergedInit);

    // ========== 响应拦截（拿到response之后） ==========
    // 401 未授权，跳登录页
    if (res.status === 401) {
        localStorage.removeItem("token");
        location.href = "/login";
        throw new Error("登录已过期，请重新登录");
    }

    // 统一解析JSON，业务层不用重复写 res.json()
    let data;
    try {
        data = await res.json();
    } catch {
        data = null;
    }

    if (!res.ok) {
        // http状态非2xx，抛出异常，业务try‑catch捕获
        throw { status: res.status, data };
    }

    return data;
}
