import { showToast, ToastVariant } from '../components/toast';
import { t } from './i18n';
import { PAGE_PREFIX, API_PREFIX } from '../constants/api';
import { ROOT_SELECTOR } from '../constants/dom';
import { hideGlobalLoading, showGlobalLoading } from '../components/loading';

/**
 * 自定义语言切换下拉菜单（归属 i18n 内聚目录）。
 * 依赖 + 交互：
 *  - 点击 .lang-trigger 展开/收起 .lang-menu
 *  - 点击菜单项（<a href data-lang>）跳转；跳转期间面板不刷屏
 *  - 点击外部 / Esc 关闭面板
 *  - 键盘方向键可切换高亮项（可选增强）
 *
 * 本模块不携带副作用，由入口（bootstrap）显式调用：
 *  - initLanguageSwitcher()：绑定语言菜单（幂等）；整块替换后的重绑由 htmx afterSwap 统一触发本函数
 *  - initLanguagePack()：拉取当前语言包，注入 window.I18n
 */
const CONTAINER_SELECTOR = '.change-language';
// 每个容器只绑定一次：防止 initLanguageSwitcher 被重复调用时重复 addEventListener 造成事件叠加。
const INITIALIZED = new WeakSet<HTMLElement>();
// WeakSet 没有 size / 迭代器，无法直接查长度，故用一个计数器统计「真正登记过的容器总数」。
// 注意：这是历史累计值（旧容器被 swap 移除后会 GC，但计数不回退），只看增长趋势，不代表内存占用。

export function initLanguageSwitcher(): void {
    document.querySelectorAll<HTMLElement>(CONTAINER_SELECTOR).forEach((container) => {
        if (INITIALIZED.has(container)) return; // 已在首次绑定过的容器，跳过（避免重复绑定）

        const trigger = container.querySelector<HTMLButtonElement>('.lang-trigger')!;
        const menu = container.querySelector<HTMLUListElement>('.lang-menu')!;
        const arrow = container.querySelector<SVGSVGElement>('.lang-arrow')!;

        // 元素缺失说明模板结构不完整，直接跳过（对当前容器不做任何绑定）。
        if (!trigger || !menu) return;

        // 元素齐全，正式绑定并登记，避免再次被 init 重复处理。
        INITIALIZED.add(container);

        // 让菜单宽度与触发器一致：直接读取触发器的渲染宽度再赋给第一个菜单。
        // 用匹配的 offsetWidth 更可靠，因为按钮有 padding/inner 结构，仅 ui 类 w-32 会漂移。
        menu.style.width = `${trigger.offsetWidth}px`;

        const items = Array.from(menu.querySelectorAll<HTMLAnchorElement>('[data-lang]'));

        function setOpen(open: boolean): void {
            menu.hidden = !open;                                      // hidden = true → 面板收起
            trigger.setAttribute('aria-expanded', String(open));            // 无障碍：同步展开状态
            arrow.classList.toggle('rotate-180', open);              // 箭头随展开状态旋转
        }

        // 点击某个菜单项：收起面板，并交给 switchLanguage 做无感语言切换（细节见其实现）。
        const handleItemClick = async (e: MouseEvent): Promise<void> => {
            e.preventDefault();         // ① 拦掉 <a> 默认整页跳转
            const lang = (e.currentTarget as HTMLAnchorElement).dataset.lang; // ② 取本次点的语言
            if (!lang) return;
            setOpen(false);             // ③ 先收起
            await switchLanguage(lang); // ④ 无感刷新
        };

        // 点击触发按钮：stopPropagation 防止事件冒泡到 document 而被“外部点击”分支立即关闭。
        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            setOpen(Boolean(menu.hidden)); // 当前是收起→展开，展开→收起
        });

        items.forEach((item) => item.addEventListener('click', handleItemClick));

        // 点击面板或按钮以外的任意位置 → 收起。利用 document 冒泡捕获“外部点击”。
        document.addEventListener('click', (e) => {
            if (!container.contains(e.target as Node)) setOpen(false);
        });

        // 面板内按 Esc → 收起，并把焦点还给触发按钮（键盘可用性）。
        menu.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                setOpen(false);
                trigger.focus();
            }
        });

        // 展开状态下，↑ / ↓ 在菜单项间循环移动焦点（无障碍方向键导航）。
        trigger.addEventListener('keydown', (e) => {
            if (menu.hidden || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
            e.preventDefault();
            if (!items.length) return;

            const current = menu.querySelector<HTMLAnchorElement>('a:focus'); // 当前聚焦项
            const idx = current ? items.indexOf(current) : -1; // -1 表示尚无聚焦项
            const next = e.key === 'ArrowDown' ? (idx + 1) % items.length : (idx - 1 + items.length) % items.length;
            items[next].focus(); // 取模实现首尾循环
        });
    });
}

/**
 * 拉取「当前语言」的语言包并注入 window.I18n（纯 SPA 首屏用）。
 * shell(index.html) 是 Vite 输出的静态文件，无法像旧 SSR 那样由服务端模板注入语言包；
 * 页面正文文案由服务端 EJS 渲染，此处只服务前端 JS 内的 t()（如 toast）。
 */
export async function initLanguagePack(): Promise<void> {
    try {
        const res = await fetch(`${API_PREFIX}/i18n`);
        if (res.ok) {
            const data = (await res.json()) as {
                lang: string;
                i18nJson?: StringMap;
            };
            if (data.i18nJson) {
                window.I18n = data.i18nJson;
                document.documentElement.lang = data.lang;
            }
        }
    } catch (error) {
        console.error('获取当前语言包失败', error);
        showToast(t('toast.get_current_language_failed'), ToastVariant.Error);
    }
}

async function switchLanguage(lang: string): Promise<void> {
    showGlobalLoading();
    const htmx = window.htmx;
    // 1. POST 设 cookie，并拿回 { i18nJson, isSuccess }
    try {
        const res = await fetch(`${API_PREFIX}/change-language`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lang }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { i18nJson?: StringMap; isSuccess?: boolean };
        // 重新赋值全局文案（供后续直接用，/body 刷新会重绘 DOM 再以此为准）
        if (data.isSuccess && data.i18nJson) {
            window.I18n = data.i18nJson;
        }
    } catch (e) {
        console.error('切换语言失败', e);
        showToast(t('toast.change_language_failed'), ToastVariant.Error);
        hideGlobalLoading();
        return;               // 不继续 GET，避免 旧语言误换
    }

    // 2. GET /body 拿新语言的纯片段（app-layout 层），整块换进 #root。
    //    带当前 path，让服务端按当前路由重绘对应页面内容（多页面支持）。
    //    PAGE_PREFIX 的 key 带前缀，故这里拼上再 encodeURIComponent。
    const path = encodeURIComponent(`${PAGE_PREFIX}${location.pathname}`);
    await htmx.ajax('get', `${PAGE_PREFIX}/body?path=${path}`, {
        target: ROOT_SELECTOR,
        swap: 'innerHTML', // 整个 #root 替换
    });

    // 3. 同步 <html lang>（第 2 步 swap 已完成，现在写 DOM 正确）
    document.documentElement.lang = lang;

    // 4. #root 已换新 DOM，重新绑定语言菜单（幂等）
    initLanguageSwitcher();

    // 5. 整个切换完成后再弹成功 toast（此时文案用新语言，DOM 已换新）
    showToast(t('toast.change_language_success'), ToastVariant.Success);
}