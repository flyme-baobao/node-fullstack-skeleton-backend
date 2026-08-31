/**
 * 服务端路由前缀常量：定义 Express 对外暴露的页面路由前缀与 API 路由前缀。
 * 与前端 client/src/constants/api.ts 保持同构，两侧前缀值需一致。
 *
 * 约定：
 *  - `PAGE_PREFIX` 用于页面/片段路由，如 `/page${path}`、`/page/body?path=...`
 *  - `API_PREFIX` 用于后端 API 路由，如 `/api/change-language`
 *  - 服务端 `PAGE_META`（server/src/views.ts）的 key 同样带 `PAGE_PREFIX`
 *
 * 改前缀优先改这里，再同步前端消费端，避免魔法字符串散落。
 */
export const PAGE_PREFIX = '/page';
export const API_PREFIX = '/api';