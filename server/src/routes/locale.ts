import express from 'express';
import { getI18n, changeLanguage, renderBody } from '../controller/locale.controller.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { PAGE_PREFIX, API_PREFIX } from '../constants/api.js';

const router = express.Router();

// 语言会话路由（locale）：处理“当前语言”的切换与无感重绘。
// 起名 locale 而非 session，避免与“用户登录会话”混淆。
// 本层只做「路径 → handler」的薄委托，处理逻辑集中在 controller/locale.controller。
// asyncHandler 把 async controller 的 throw（rejected Promise）转成 next(err) → 全局 errorHandler。

// 纯 SPA 首屏：拉取当前语言包注入 window.I18n（只读，不写 cookie）
router.get(`${API_PREFIX}/i18n`, asyncHandler(getI18n));

// 语言切换（前端发后拿到当前语言包，更新前端 I18n 字典）
router.post(`${API_PREFIX}/change-language`, asyncHandler(changeLanguage));

// 语言无感切换：按当前 path 重绘 app-layout 片段（由 SPA 静态壳承载），供 htmx 整块替换 #root。
router.get(`${PAGE_PREFIX}/body`, asyncHandler(renderBody));

export { router as localeRouter };