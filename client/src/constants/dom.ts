/**
 * DOM 挂载点常量：SPA 根容器（index.html 中的挂载点）。
 *
 * 约定：
 *  - spaRouter / 语言切换都把 fragment 整块换进该容器
 *  - mountHtmxLifecycle 的 afterSwap 用 ROOT_ID 判断「整页替换」才重绑语言菜单
 *
 * 改挂载点只需改这一处（index.html 的 id 需同步修改）。
 */
export const ROOT_ID = 'root';
export const ROOT_SELECTOR = `#${ROOT_ID}`;
