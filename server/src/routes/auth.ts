import express from 'express';
import { signup, signin, me } from '../controller/auth.controller.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { API_PREFIX } from '../constants/api.js';

const router = express.Router();

// 鉴权路由（auth）：注册 / 登录 / 当前用户信息。
// 本层只做「路径 → handler」的薄委托，业务在 service，入参校验在 dto。
// 鉴权约定（文档 §3/§8.2）：
//   - POST signup / signin 为白名单接口（未登录可达，否则鸡生蛋死锁）；
//   - GET me 不在白名单：未登录由 auth.middleware 返回 401，前端据此判定登录态。
// asyncHandler 把 async controller 的 throw（rejected Promise）转成 next(err) → 全局 errorHandler。

// 注册：201 + 用户信息，不签发任何凭证（前端引导去登录）
router.post(`${API_PREFIX}/auth/signup`, asyncHandler(signup));

// 登录：200 { token, user } + Set-Cookie(sessionId)
router.post(`${API_PREFIX}/auth/signin`, asyncHandler(signin));

// 当前用户信息（getUserInfo）：需鉴权
router.get(`${API_PREFIX}/auth/me`, asyncHandler(me));

export { router as authRouter };