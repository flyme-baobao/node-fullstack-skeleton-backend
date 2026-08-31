/**
 * 全局路由常量：SPA 路由统一从 Express 拉取的 API / 页面 fragment 入口前缀。
 *
 * 约定：
 *  - SPA 路由 `router/spaRouter.ts` 请求 `/page${path}` 拿页面内容
 *  - 语言切换 `i18n/language.ts` 请求 `/page/body?path=...` 拿整块可替换片段
 *  - 服务端 `PAGE_META`（server/src/views.ts）的 key 同样带此前缀
 *  - 服务端 api 路由统一从 Express 拉取的 API 前缀
 *
 * 改前缀只需改这一处，无需在多个文件里散落魔法字符串。
 */
export const PAGE_PREFIX = '/page';
export const API_PREFIX = '/api';