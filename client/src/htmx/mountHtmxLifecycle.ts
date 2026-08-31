import { handleConfirm } from '../components/confirm';
import { showToast, ToastVariant } from '../components/toast';
import { t } from '../i18n/i18n';
import { initLanguageSwitcher } from '../i18n/language';
import { logger } from '../utils/logger';
import { ROOT_ID } from '../constants/dom';
/**
 * HTMX 2.x 完整生命周期事件（权威定稿·生产无坑全覆盖）
 * 对齐官方源码 + 生产踩坑修正 + 全特殊状态码规则 + 422专属特例
 * 完整覆盖：正常渲染、网络错误、4xx/5xx业务错误、渲染异常、204/304空响应、422表单校验、3xx重定向场景
 *  * 【全局强制前置规范】
 * 1. 所有请求头、URL、请求参数动态修改，仅可在 configRequest 执行
 * 2. beforeRequest 阶段修改网络配置不生效，禁止在此处修改请求配置
 *
 * 【状态码核心固定规则】
 * 1. 204 NoContent / 304 NotModified：成功响应、无报错、跳过全套Swap渲染链路，直达afterRequest
 * 2. 4xx/5xx：默认触发responseError、禁止DOM Swap
 * 3. 422 为全局唯一可手动放行的4xx状态码，可强制渲染DOM片段
 * 4. 301/302/303/307：XHR底层自动跟随重定向，HTMX无法捕获，业务跳转只用HX-Redirect响应头
 * htmx:confirm                         👉 请求生命周期第一层钩子，hx-confirm弹窗确认阶段
 *                                      👉 可通过event.preventDefault()终止整条请求，后续所有事件不执行
 *                                      👉 用途：自定义确认弹窗、权限预检、请求前置拦截、黑名单拦截
 *
 * htmx:configRequest                   👉 XHR初始化、参数编码完成，正式发包前的配置阶段
 *                                      👉 【唯一合法钩子】动态修改请求头、URL、Query/Body参数、注入Token
 *                                      👉 支持取消请求，阻断后续链路
 *
 * htmx:beforeRequest                   👉 请求配置完全就绪，即将发起网络IO
 *                                      👉 最佳用途：开启Loading、添加inert、锁定按钮/表单交互状态
 *                                      👉 可取消请求，终止发包
 *                                      👉 禁止修改请求配置（此处修改不生效）
 *
 * htmx:beforeSend                      👉 XHR open执行完毕，即将执行xhr.send()最终时刻
 *                                      👉 无法取消请求，请求已进入浏览器发送队列
 *                                      👉 用途：操作原生XHR实例、网络层最终只读配置
 *
 * htmx:sendError                       👉 纯网络层异常：断网、DNS失败、CORS跨域、请求超时
 *                                      👉 固定链路：confirm → configRequest → beforeRequest → beforeSend → sendError → afterRequest
 *                                      👉 跳过所有DOM Swap渲染逻辑
 *
 * htmx:beforeSwap                      👉 【2.0.10 时序铁律】所有含HTTP响应的请求(2xx/4xx/5xx，排除204/304)优先进入此钩子
 *                                      👉 4xx/5xx 不会直接报错，先进 beforeSwap，通过 isError/shouldSwap 决定后续所有分支
 *                                      👉 可手动修改 isError 拦截后续 responseError 事件，彻底自定义错误链路
 *
 * htmx:responseError                   👉 后置错误分支！仅 beforeSwap 执行完毕 && isError===true 才触发
 *                                      👉 网络通信正常，服务端返回4xx/5xx HTTP错误码
 *                                      👉 固定正确时序：beforeSend → beforeSwap → responseError → afterRequest
 *                                      👉 204/304成功状态永不触发此事件
 *                                      👉 422放行后设置 isError=false，天然不触发此事件，无需手动过滤
 *
 * htmx:swapError/htmx:afterSwap        👉 (afterSwap)DOM 替换完成(立刻触发，临时class还没清理)
 *      swapError                       👉 DOM 替换失败 不走  afterSwap、afterSettle，直接跳到 afterRequest**
 *      afterSwap                       👉 DOM 刚插入完成立即触发；带htmx‑added/htmx‑settling临时class；适合focus、简单初始化
 *
 * htmx:afterSettle                     👉 默认延时20ms；属性同步、清理临时CSS类，DOM布局与动画稳定后触发；读取元素尺寸、滚动逻辑放此处
 *
 * htmx:sendAbort                       👉 请求被主动中止（手动 abort），无响应体可显示, 后面的时间声明周期只会走到 afterRequest
 * 
 * htmx:afterRequest                    👉 请求生命周期终点，【无论成功失败必触发】；loading关闭、统一收尾写这里
 *  * 状态码特殊行为：
 *  204 NoContent / 304 NotModified：成功响应，不触发responseError，直接跳过整套Swap事件，走到afterRequest
 *  301/302/303/307：浏览器XHR底层自动跟随重定向，htmx拿不到原始3xx状态；业务跳转请使用HX‑Redirect响应头，不要使用HTTP重定向
 *
 * ⚠️重要：header、请求参数修改写在 configRequest；不要写在 beforeRequest，此时修改请求配置已经不生效
 *  * 【官方标准五套链路】
 * 1. 网络错误：confirm → configRequest → beforeRequest → beforeSend → sendError → afterRequest
 * 2. 业务4xx/5xx错误：confirm → configRequest → beforeRequest → beforeSend → responseError → afterRequest
 * 3. 204/304空成功：confirm → configRequest → beforeRequest → beforeSend → 跳过全部Swap → afterRequest
 * 4. 正常渲染成功：confirm → configRequest → beforeRequest → beforeSend → beforeSwap → afterSwap → afterSettle → afterRequest
 * 5. 渲染异常失败：confirm → configRequest → beforeRequest → beforeSend → beforeSwap → swapError → afterRequest
 *  特性链路
 * 6. 422属于4xx，默认走【链路2】不渲染；可在 beforeSwap 手动配置 shouldSwap=true、isError=false 强制开启渲染。
 *    confirm → configRequest → beforeRequest → beforeSend → beforeSwap(手动放行) → responseError(依旧触发) → afterSwap → afterSettle → afterRequest
 *     isError true 的话，走完 responseError 直接是 afterRequest ，但是 dom 正常 wrap 除非发生 swapError 对把
 *
 */

/**
 * 挂载 htmx 生命周期事件处理器。
 * 仅在入口（main.ts bootstrap）显式调用一次；所有监听用 document/body 委托，
 * 兼容动态渲染的内容（htmx swap 进的新 DOM 无需重挂）。
 */
export function mountHtmxLifecycle(): void {
    /** htmx:confirm 拦截已提取到 components/confirm 的 handleConfirm（单一职责，这里只负责注册）。 */
    document.addEventListener('htmx:confirm', handleConfirm);

    /** configRequest 阶段：唯一合法钩子，用于注入动态请求头、URL、Query/Body 参数与 Token。 */
    document.body.addEventListener('htmx:configRequest', (event: Event) => {
        const detail = (event as CustomEvent).detail as {
            headers: Record<string, string>;
            path: string;
            parameters: Record<string, string>;
        };
        // 例：从缓存读取 token 注入鉴权头，无则跳过。
        // const token = localStorage.getItem('token');
        // if (token) detail.headers['Authorization'] = `Bearer ${token}`;
        // detail.headers['X-Requested-With'] = 'XMLHttpRequest';
        void detail.path;
    });

    /** 从 4xx/5xx 响应里尽量提取可读消息：JSON {message} → 纯文本 → 状态码兜底。 */
    function extractErrorMessage(xhr: XMLHttpRequest): string {
        const contentType = xhr.getResponseHeader('content-type') ?? '';
        if (contentType.includes('application/json')) {
            try {
                const body = JSON.parse(xhr.responseText);
                if (typeof body?.message === 'string' && body.message.trim()) {
                    return body.message.trim();
                }
            } catch { /* 解析失败走兜底 */ }
        }
        if (xhr.responseText && !xhr.responseText.includes('<')) {
            const plain = xhr.responseText.trim();
            if (plain) return plain.slice(0, 120);
        }
        return String(xhr.status);
    }

    /** 把 XHR 错误标准化成结构化 meta，供 logger.error 使用：status + 可读 message + 错误详情。 */
    const errorMeta = (detail: {
        xhr: XMLHttpRequest;
        error: Error;
    }): Record<string, unknown> => {
        const { xhr, error } = detail;
        return {
            status: xhr.status,
            message: extractErrorMessage(xhr),
            error: error instanceof Error ? error.message : String(error || 'unknown'),
        };
    }

    /** beforeRequest 阶段：请求即将发起。错误反馈改用全局 toast，无需清空容器；loading 靠 hx-indicator。 */
    document.body.addEventListener('htmx:beforeRequest', (event: Event) => {
        const detail = (event as CustomEvent).detail as { elt: HTMLElement };
        void detail.elt;
    });

    /** beforeSend 阶段：不可修改配置，仅可只读操作原生 XHR。 */
    document.body.addEventListener('htmx:beforeSend', (event: Event) => {
        const detail = (event as CustomEvent).detail as { xhr: XMLHttpRequest };
        void detail;
    });

    /** sendError 阶段：纯网络层异常（断网 / 超时 / CORS / 被拦截），无响应体可显示。 */
    document.body.addEventListener('htmx:sendError', (event: Event) => {
        const detail = (event as CustomEvent).detail as {
            xhr: XMLHttpRequest;
            error: Error;
        };
        logger.error('网络请求失败', errorMeta(detail));
        showToast(t('toast.network_error'), ToastVariant.Error);
    });

    /** beforeSwap 阶段：核心放行逻辑。
     *  规则：422（表单校验）强制放行渲染、isError=false 静默 responseError → 表单回显字段错误；
     *        其余 4xx/5xx 保持 htmx 默认不 swap，交由 responseError 弹全局 toast。 */
    document.body.addEventListener('htmx:beforeSwap', (event: Event) => {
        const detail = (event as CustomEvent).detail as {
            xhr: XMLHttpRequest;
            shouldSwap: boolean;
            isError: boolean;
        };
        // 422 表单校验：放行渲染（把服务端错误 HTML swap 进原 target），且 isError=false 避免触发 responseError
        if (detail.xhr.status === 422) {
            detail.shouldSwap = true;
            detail.isError = false;
            return;
        }
        // 其余 4xx/5xx：保持默认（shouldSwap=false），交给 responseError 弹全局 toast
    });

    /** responseError 阶段：网络正常返回 4xx/5xx（422 已在 beforeSwap 置 isError=false，天然不会进这里）。 */
    document.body.addEventListener('htmx:responseError', (event: Event) => {
        const detail = (event as CustomEvent).detail as {
            xhr: XMLHttpRequest;
            error: Error;
            isError: boolean;
        };
        // 兜底过滤：万一 422 仍到这里（配置差异）也静默，不弹全局 toast
        if (detail.xhr.status === 422) return;
        logger.error('htmx responseError', errorMeta(detail));
        showToast(
            t('toast.request_failed', {
                status: detail.xhr.status,
                message: extractErrorMessage(detail.xhr),
            }),
            ToastVariant.Error,
        );
        void detail.error;
    });



    /** swapError 阶段：DOM 替换失败（多为 2xx 但 HTML 解析/渲染异常），走不到 afterSwap/afterSettle，直接弹 toast 提示。 */
    document.body.addEventListener('htmx:swapError', (event: Event) => {
        const detail = (event as CustomEvent).detail as { xhr: XMLHttpRequest; error: Error };
        logger.error('htmx swap failed', errorMeta(detail));
        showToast(t('toast.swap_failed'), ToastVariant.Error);
    });

    /**
     * afterSwap 阶段：DOM 刚插入完成（临时 class 未清理），适合 focus、简单初始化。
     * 语言菜单位于 app-layout，仅整页替换（target 为 #root）才重绑；
     * 局部碎片替换（#list/<li> 等）不波及菜单，跳过。
     */
    document.body.addEventListener('htmx:afterSwap', (event: Event) => {
        const detail = (event as CustomEvent).detail as { elt: HTMLElement; target: HTMLElement };
        void detail.elt;
        if (detail.target?.id === ROOT_ID) {
            initLanguageSwitcher();
        }
    });

    /** afterSettle 阶段：默认延时 20ms 后触发，布局与动画稳定。读取尺寸、滚动定位放此处。 */
    document.body.addEventListener('htmx:afterSettle', (event: Event) => {
        const detail = (event as CustomEvent).detail as { elt: HTMLElement };
        void detail;
    });

    /** 手动 abort 会进入 htmx:sendAbort 阶段 */
    document.body.addEventListener('htmx:sendAbort', (event: Event) => {
        const detail = (event as CustomEvent).detail as { elt: HTMLElement };
        void detail;
    });

    /** afterRequest 阶段：无论成功 / 失败 / 204 / 网络错误，必触发。统一收尾：关闭 loading、解锁交互。 */
    document.body.addEventListener('htmx:afterRequest', (event: Event) => {
        const detail = (event as CustomEvent).detail as { elt: HTMLElement };
        // 移除 beforeRequest 加的交互锁定态
        // detail.elt.removeAttribute('disabled');
        // detail.elt.classList.remove('opacity-60');
        void detail;
    });
}
