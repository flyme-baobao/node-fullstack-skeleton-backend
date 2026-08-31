import express from 'express';
import { PAGE_META } from '../views.js';
import { createPageHandler } from '../controller/page.controller.js';

const router = express.Router();

// 整页路由：按页面注册表 PAGE_META 生成 GET /<path>，真正的渲染组装逻辑在 controller。
// 本层只做「路径 -> handler」的薄委托。
for (const [path, meta] of Object.entries(PAGE_META)) {
    router.get(path, createPageHandler(path, meta));
}

export { router as pagesRouter };