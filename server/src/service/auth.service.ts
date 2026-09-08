/**
 * 鉴权业务服务（auth.service.ts）
 *
 * 职责：注册（查重 → scrypt 散列 → 落库）、登录（校验 → 双凭证签发）、当前用户查询。
 * 分层：controller 只做入参提取与响应编排，业务规则与凭证签发全部在本层；
 *       数据访问在 user.repository，Redis 会话在 db/redis 封装之上。
 *
 * 双凭证模型（文档 §2）：
 *   - signin 成功才同时签发 token（响应体，前端 localStorage）与 sessionId（Set-Cookie）；
 *   - signup 一律不签发任何凭证（前端引导去 signin）；
 *   - 会话只存 Redis（auth:token:* / auth:session:* → userId），不落库，TTL 到期自然失效。
 */
import * as userRepository from '../repository/user.repository.js';
import { createRedisCache } from '../db/redis.js';
import { HttpError } from '../middleware/error.middleware.js';
import { ERROR_DEFS } from '../i18n/error-defs.js';
import { hashPassword, verifyPassword, generateSecret } from '../utils/crypto.js';
import {
    TOKEN_TTL_SECONDS,
    SESSION_TTL_SECONDS,
    tokenKey,
    sessionKey,
    currentUserInfoKey,
    CURRENT_USER_INFO_TTL_SECONDS,
} from '../constants/auth.js';
import type { UserIdentity } from '../repository/user.repository.js';
import { USER_STATUS } from '../repository/user.repository.js';
// 入参契约复用 dto 层（与 todo.service 的 CreateTodoDto 同款风格）：单一事实来源，
// DTO 加字段（如 clientIp）service 签名自动跟随，不存在「DTO 改了 service 忘改」的漂移
import type { SigninDto, SignupDto } from '../dto/auth.dto.js';
import {
    assertNotLocked,
    recordFailureAndThrow,
    clearSigninFailures,
} from './signin-throttle.js';

/** Redis 会话缓存封装（get/set 带 TTL）；模块级创建一次，内部每次操作都经 getRedis() */
const redisUserCache = createRedisCache();

/** 登录成功结果：token 给响应体，sessionId 交给 controller 写 Set-Cookie */
export interface SigninResult {
    token: string;
    sessionId: string;
    user: UserIdentity;
}

/**
 * 注册：任一身份字段已存在 → 40901 account_exists；否则 scrypt 散列后落库。
 * 查重是友好路径（避免白算 ~100ms 的 scrypt）；并发窗口由库端唯一索引兜底
 * （repository.create 的 23505 → 40901），两条路径最终语义一致。
 */
export async function signup(dto: SignupDto): Promise<UserIdentity> {
    const { userName, email, phoneNumber, password } = dto;
    // 逐字段查重（低频操作，三次点查成本可接受）：命中即冲突
    const conflicts = await Promise.all([
        userRepository.findByAccount(userName),
        email ? userRepository.findByAccount(email) : Promise.resolve(undefined),
        phoneNumber ? userRepository.findByAccount(phoneNumber) : Promise.resolve(undefined),
    ]);
    if (conflicts.some(Boolean)) {
        throw new HttpError({ ...ERROR_DEFS.account_exists });
    }
    

    const passwordHash = await hashPassword(password);
    return userRepository.create({
        userName,
        email,
        phoneNumber,
        passwordHash,
    });
}


function convertCurrentUserInfoToString(user: UserIdentity): string {
   const { createdAt, ...rest } = user; 
    const strCreateDate = createdAt?.getTime() ?? 0; // Date → number JSON 序列化成 UTC 时间戳
    return JSON.stringify(Object.assign(rest, { createdAt: strCreateDate }));
}

/**
 * 登录：定位用户、校验状态密码、签发双凭证写入Redis。
 * 凭证失败统一返回，避免账号枚举；根据限流状态分别返回密码错误(40104)或账号锁定(40105)。
 * 限流：入口优先校验锁定，锁定时跳过查库与密码校验；仅凭证失败统计失败次数，登录成功清空限流计数。
 * Redis故障直接抛错，遵循fail‑closed原则。
 */
export async function signin(dto: SigninDto): Promise<SigninResult> {
    const { account, password, clientIp } = dto;
    // 先查锁再查库：锁定期内的请求不消耗 DB 查询与 scrypt 校验成本
    await assertNotLocked(account, clientIp);
    const user = await userRepository.findByAccount(account);
    const { passwordHash, status, ...rest } = user ?? {};
    if (!user || !passwordHash || status !== USER_STATUS.ACTIVE) {
        // 记失败并抛错；return（而非 await）以保持后续 passwordHash 收窄为 string
        return recordFailureAndThrow(account, clientIp);
    }
    const passwordOk = await verifyPassword(password, passwordHash);
    if (!passwordOk) {
        return recordFailureAndThrow(account, clientIp);
    }
    // 登录成功：清掉失败计数，重置该账号的限流窗口
    await clearSigninFailures(account, clientIp);

    // 签发双凭证：token（响应体）+ sessionId（Set-Cookie），都映射到同一 userId
    const token = generateSecret();
    const sessionId = generateSecret();
    const userInfo = {
        ...rest,
    } as UserIdentity;

    const currentUserInfoString = convertCurrentUserInfoToString(userInfo);

    // 会话只存 Redis：SET EX 语义由 cache.set(key, value, ttlSeconds) 承载；
    // 两个键写入必须都成功，任一失败向上抛（Redis 故障 → errorHandler 500，不发放半套凭证）
    await Promise.all([
        redisUserCache.set(tokenKey(token), user.userId, TOKEN_TTL_SECONDS),
        redisUserCache.set(sessionKey(sessionId), user.userId, SESSION_TTL_SECONDS),
        redisUserCache.set(currentUserInfoKey(user.userId), currentUserInfoString, CURRENT_USER_INFO_TTL_SECONDS),
    ]);

    return {
        token,
        sessionId,
        user: userInfo
    };
}

export async function getUserToken(rawToken: string | undefined): Promise<string | null> {
    if (!rawToken) return null;
    // 校验：token 在 Redis 中存在（握手远端会话有效）才回传，过期/伪造返回 null
    const userId = await redisUserCache.get(tokenKey(rawToken));
    return userId ? rawToken : null;
}


/**
 * 当前用户信息（GET /api/auth/me）：userId 由 auth.middleware 校验后注入。
 * 凭证有效但用户已不存在（被删/被禁后清理）→ 40103，前端走「重新登录」链路。
 * 采用 Cache‑Aside 后期如果要更新用户信息（昵称/头像/邮箱等）直接更新 PG，清掉 Redis 缓存即可（下次访问 /api/auth/me 会重新查库）。
 */
export async function getUserInfo(userId: string): Promise<UserIdentity> {
    let userInfo: UserIdentity | null | undefined = null;
    const userInfoFromCache = await redisUserCache.get(currentUserInfoKey(userId));
    if (userInfoFromCache) {
        try {
            userInfo = JSON.parse(userInfoFromCache) as UserIdentity;
            userInfo.createdAt = new Date(userInfo.createdAt); // string → Date
        } catch (err) {
            // JSON 解析失败 → 缓存脏数据，清掉让下次重新查库
            await redisUserCache.del(currentUserInfoKey(userId));
        }
    }
    if (!userInfo) {
        // 缓存未命中，继续查库
        userInfo = await userRepository.findByUserId(userId);
        if (!userInfo) {
            throw new HttpError({ ...ERROR_DEFS.unauthorized });
        }
        const currentUserInfoString = convertCurrentUserInfoToString(userInfo!);
        await redisUserCache.set(currentUserInfoKey(userId), currentUserInfoString, CURRENT_USER_INFO_TTL_SECONDS);
    }
    if (!userInfo) {
        throw new HttpError({ ...ERROR_DEFS.unauthorized });
    }
    return userInfo;
}