import { PAGE_PREFIX } from '../constants/api';
import { ROOT_SELECTOR } from '../constants/dom';
import { isValidPath } from './routes';
import { showToast, ToastVariant } from '../components/toast';
import { hideGlobalLoading } from '../components/loading';

/**
 * 轻量 SPA 路由：把 `#root` 内容换成 `${PAGE_PREFIX}/path` fragment。
 * 三类入口（首屏 / 内链点击 pushState / 前进后退 popstate）统一汇入 loadPageByPath。
 * 无自带副作用：由 bootstrap 在拿到 htmx 实例后显式调用。
 *
 * @param htmx 已加载的 htmx 实例
 */
export function setupSpaRouter(htmx: HTMX): void {
    // 导航序号：每次导航自增；响应回来时 navId ≠ navSeq 即过期导航，丢弃（防旧响应覆盖新页面）
    let navSeq = 0;

    async function loadPageByPath(path: string = window.location.pathname) {
        // ===== 路由守卫：非法路径 → replaceState 重定向到根路径（保留 search+hash）=====
        // replaceState 会走进下方补丁并自动再触发一次 loadPageByPath，故这里直接 return 避免重复加载。
        // 【边界】若 fallback 本身也非法（manifest 缺失等）会形成重定向死循环，当前 fallback 恒合法。
        if (!isValidPath(path)) {
            const fallback = `/${window.location.search}${window.location.hash}`;
            console.warn('[router] 非法路径，重定向到', path, '→', fallback);
            history.replaceState({}, '', fallback);
            // 这行调用会走进下面 patch 后的 replaceState：它检测到 fallback 是合法路径
            // 且 ≠ 当前路径，会自动再触发一次 loadPageByPath(fallback) 来加载首页。
            // 这里直接 return，避免守卫自己再加载一次造成重复请求。
            return;
        }

        // abort 在途请求（htmx.ajax 未传 source，xhr 挂在 body 上，故 detail.elt 必须指向 body，
        // 否则 htmx 内部 abort 监听读 null.elt 抛 TypeError）；无在途请求时静默。
        const navId = ++navSeq;
        document.body.dispatchEvent(
            new CustomEvent('htmx:abort', { detail: { elt: document.body } }),
        );

        try {
            const res = await htmx.ajax('get', `${PAGE_PREFIX}${path}`, {
                swap: 'innerHTML',
                target: ROOT_SELECTOR,
            });
            if (navId !== navSeq) return; // 已被更新的导航取代 → 丢弃过期响应
            // swap 进来的内容 htmx 已在自身 settle 阶段自动 process，无需手动 htmx.process（冗余）
            console.log('[router] htmx.ajax get', `${PAGE_PREFIX}${path}`, res);
        } catch (err) {
            // 主动 abort / 过期导航属正常取消，静默；真网络失败才打日志 + toast
            if (navId !== navSeq) return;
            console.error('[router] 页面加载失败', `${PAGE_PREFIX}${path}`, err);
            // 兜底：纯网络断连时 htmx:afterRequest 的 detail.target 为空，
            // 全局遮罩的常规关闭点（mountHtmxLifecycle）够不着，这里收尾（幂等）
            hideGlobalLoading();
            void showToast('页面加载失败，请稍后重试', ToastVariant.Error);
        }
    }

    const getPath = (target: URL) => {
        return target.pathname + target.search + target.hash;
    };

    /** SPA 导航统一入口：pushState 更新地址栏。真正的加载由下方 patch 的 pushState 统一处理 */
    function navigate(urlOrPath: string) {
        const target = new URL(urlOrPath, window.location.origin);
        // 防御：外部域名不进 SPA 路由（否则 getPath 会剥掉 origin，静默导航到外域路径）
        if (target.origin !== window.location.origin) {
            window.location.href = target.href; //外部链接直接原生跳转
            return;
        };
        const nextPath = getPath(target);
        const currentPath = getPath(new URL(window.location.href));
        if (nextPath === currentPath) return; // 同路径不重复加载
        history.pushState({}, '', nextPath);
    }

    // ===== 拦截同源 `<a>` 点击：让它走 SPA 导航，而不是整页跳转 =====
    // 用「捕获阶段 + 事件委托」(window 上统一监听)：
    //   - 任何后代 `<a>` 的 click 都会先经过这里（不管它何时被 htmx 注入到 #root）
    //   - 捕获阶段(true) 抢在任何内部监听器之前执行，保证先拿到导航权利
    window.addEventListener('click', (e) => {
        // 从点击目标向上找最近的 <a>（兼容点到 <a> 内部的 <span>/<svg> 等子元素）
        const anchor = (e.target as HTMLElement).closest<HTMLAnchorElement>('a');
        if (!anchor) return; // 点击的不是链接 → 不处理

        // ── 以下全部是「放行」(return) 逻辑：让浏览器走原生行为 ──
        const href = anchor.getAttribute('href');
        // 无 href / 纯锚点(#...) / 协议链接(mailto:/tel:) → 不是页面路由，放行
        if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
        // 跨域链接（anchor.href 会解析成绝对地址）→ 不该接管，放行让整页跳走
        const target = new URL(anchor.href, window.location.origin);
        if (target.origin !== window.location.origin) return;
        // target 显式指定新开页(_blank 等，非 _self) → 用户/开发者想要新标签页，放行
        if (anchor.target && anchor.target !== '_self') return;
        // download 下载链接 → 截获会破坏下载，放行
        if (anchor.hasAttribute('download')) return;
        // 带修饰键(Ctrl/Cmd/Shift/Alt) 或非左键(中键/右键)点击
        //   → 浏览器默认新开标签/打开新窗口等约定，必须放行
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;

        // ── 通过所有检查 → 这才是我们要接管的内链点击 ──
        e.preventDefault();          // 阻止浏览器默认「整页跳转」
        navigate(anchor.getAttribute('href')!); // 走 SPA 路由（仅改 URL，加载由 patch 的 pushState 统一做）
    }, true); // true = 捕获阶段，抢在 htmx / 其他监听前

    // ===== 补丁 pushState / replaceState：捕获 JS 编程式跳转（history.pushState 等） =====
    //   pushState 不触发 popstate，之前只能靠监听 click 捕获<a>点击；但 JS 里直接 pushState 也改路由，
    //   所以要 patch 原生方法，让"点击 + 编程式跳转"最终都统一到这里加载，同时按 pathname 去重避免重复渲染。
    const patchState = (method: 'pushState' | 'replaceState') => {
        const original = history[method];
        history[method] = function (...args: Parameters<History['pushState']>) {
            const currentPath = getPath(new URL(window.location.href));
            original.apply(this, args);
            const url = args[2] as string | null | undefined;
            // url 为 null/''：规范语义是「URL 不变」→ 未发生导航，不加载（非 bug）
            if (url) {
                const nextPath = getPath(new URL(url, window.location.origin));
                if (nextPath !== currentPath) {
                    loadPageByPath(nextPath);
                }
            }
        };
    };
    patchState('pushState');
    patchState('replaceState');

    // ===== 初始加载 + 前进/后退 =====
    loadPageByPath();
    window.addEventListener('popstate', () => loadPageByPath());
}