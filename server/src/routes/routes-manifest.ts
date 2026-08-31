import express from 'express';
import { CLIENT_PATHS } from '../views.js';
import { API_PREFIX } from '../constants/api.js';

const router = express.Router();

/**
 * 合法页面路径清单（routes manifest）：供前端 SPA 路由守卫拉取。
 *
 * 单一来源保证：`valid` 由 PAGE_META 派生（对每个注册路径做 toClientPath 归一，
 * 例如 '/page' -> '/'、'/page/list' -> '/list'），后端加页面此清单自动跟随，
 * 前端无需在源码里硬编码第二份路径表，也无需 import 后端源码（运行时拿 JSON）。
 *
 * 前端 bootstrap 阶段预拉并缓存；拉取失败时前端守卫退化为放行，不阻塞首屏。
 */
router.get(`${API_PREFIX}/__routes`, (_req, res) => {
    res.json({ valid: CLIENT_PATHS, base: '/' });
});

export { router as routesManifestRouter };