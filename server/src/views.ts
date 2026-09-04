import { PAGE_PREFIX } from './constants/api.js';

/**
 * 页面注册表：URL 路径 -> 页面内容视图 + 标题。
 * 渲染链由 res.renderPage 统一处理（内容 -> app-layout 应用外壳，且注入进 SPA 静态壳）。
 *
 * 语言切换 /body 靠它按当前 path 找到对应视图，保证无感切换后重绘的是“当前页”。
 * 新增页面（/signin、/signup…）只需在此登记，整页路由与 /body 重绘自动生效。
 */

export interface PageMeta {
    view: string;
    title: string;
    /** 是否渲染应用外壳 header（登录/注册页隐藏，缺省 true，见 app-layout.ejs） */
    showHeader?: boolean;
}

const INDEX_PATH = `${PAGE_PREFIX}`; // 首页 /page/ 或 /page
const LIST_PATH = `${PAGE_PREFIX}/list`; // 待办清单页 /page/list
const SIGNIN_PATH = `${PAGE_PREFIX}/signin`; // 登录页 /page/signin
const SIGNUP_PATH = `${PAGE_PREFIX}/signup`; // 注册页 /page/signup

export const PAGE_META: Record<string, PageMeta> = {
    [INDEX_PATH]: { view: 'pages/index', title: 'htmx Study' },
    [LIST_PATH]: { view: 'pages/listPage', title: '待办清单 - htmx Study' },
    // 登录/注册页：隐藏应用外壳 header（页面自带品牌位），浏览器路径 /signin、/signup
    [SIGNIN_PATH]: { view: 'pages/signin', title: '登录 - TaskFlow', showHeader: false },
    [SIGNUP_PATH]: { view: 'pages/signup', title: '注册 - TaskFlow', showHeader: false },
};

export const CLIENT_PATHS = Object.keys(PAGE_META).map(path => toClientPath(path));

/** 按 path 取页面元信息；未知 path 兜底到首页。 */
export function metaForPath(path: unknown): PageMeta {
    const _path = String(path || INDEX_PATH);
    return PAGE_META[_path] ?? PAGE_META[_path.replace(/\/$/, '')] ?? PAGE_META[INDEX_PATH];
}

/**
 * 把「内部注册路径」（带 PAGE_PREFIX 前缀）还原成浏览器地址栏路径，供 nav 高亮等按路由区分的场景使用。
 * 示例：'/page/' → '/', '/page/list' → '/list'。
 * 因为在纯 SPA 下，nav 链接 href 是 '/'、'/list'（浏览器路径），而 currentPage 来源是
 * PAGE_META 的 key（带 /page 前缀）或 /body 的 path 参（同样带前缀），两者对不上会导致高亮失效。
 */
export function toClientPath(path: unknown): string {
    const p = String(path || '');
    // 去掉 /page 前缀
    const bare = p.startsWith(PAGE_PREFIX) ? p.slice(PAGE_PREFIX.length) : p;
    // 去掉尾部斜杠，兜底成 '/'。
    return bare.replace(/\/$/, '') || '/';
}