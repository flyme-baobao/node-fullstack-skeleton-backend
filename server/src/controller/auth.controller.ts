/**
 * 鉴权控制器（auth.controller.ts）
 *
 * 职责单一：入参解析（dto）→ service 调用 → 响应编排。
 * 约定（文档 §1）：后端只返回状态码，不做任何重定向；重定向/弹窗全部交给前端。
 *   - signup → 201，不签发任何凭证（前端引导去登录）；
 *   - signin → 200 { token, user } + Set-Cookie(sessionId)，双凭证就此就位；
 *   - me     → 200 { user }（凭证校验已由 auth.middleware 完成，req.userId 必在）。
 * Cookie 安全属性（文档 §5.1）：httpOnly + sameSite=strict + secure(生产) + maxAge 7d + path=/。
 */
import type { Request, Response } from 'express';
import { createWebCtx } from '../adapter/webCtx.js';
import * as authService from '../service/auth.service.js';
import { parseSignup, parseSignin } from '../dto/auth.dto.js';
import { HttpError } from '../middleware/error.middleware.js';
import { ERROR_DEFS } from '../i18n/error-defs.js';
import {
    SESSION_COOKIE,
    SESSION_COOKIE_MAX_AGE_MS,
} from '../constants/auth.js';

/** sessionId Cookie 安全属性（文档 §5.1；secure 仅生产启用——本地 http 环境带 secure 会被浏览器丢弃） */
function sessionCookieOptions() {
    return {
        httpOnly: true,
        sameSite: 'strict',
        secure: process.env.NODE_ENV === 'production',
        maxAge: SESSION_COOKIE_MAX_AGE_MS,
        path: '/',
    } as const;
}

/** POST /api/auth/signup —— 注册：201 + 用户信息；不签发凭证 */
export async function signup(req: Request, res: Response): Promise<void> {
    const ctx = createWebCtx(req, res);
    const dto = parseSignup(ctx.body);
    const user = await authService.signup(dto);
    ctx.status(201).json({ user });
}

/** POST /api/auth/signin —— 登录：200 { token, user } + Set-Cookie(sessionId) */
export async function signin(req: Request, res: Response): Promise<void> {
    const ctx = createWebCtx(req, res);
    const dto = parseSignin(ctx.body);
    const { token, sessionId, user } = await authService.signin(dto);
    // sessionId 只进 httpOnly Cookie，前端 JS 不可读；token 走响应体由前端 localStorage 保管
    ctx.cookie(SESSION_COOKIE, sessionId, sessionCookieOptions());
    ctx.status(200).json({ token, user });
}

/** GET /api/auth/me —— 当前用户信息（getUserInfo） */
export async function me(req: Request, res: Response): Promise<void> {
    const ctx = createWebCtx(req, res);
    // 防御：me 路由在 auth.middleware 之后，userId 必有；缺失说明挂载顺序被破坏，直接 401
    if (!ctx.userContext.userId) {
        throw new HttpError({ ...ERROR_DEFS.unauthorized });
    }
    const user = await authService.me(ctx.userContext.userId);
    ctx.status(200).json({ user });
}