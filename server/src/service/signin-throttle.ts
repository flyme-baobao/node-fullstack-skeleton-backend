/**
 * service/signin‑throttle.ts 登录失败限流
 *
 * 规则：同一账号15分钟内失败5次触发锁定(40105)，锁定请求直接拦截，跳过查库与密码校验。
 * Redis采用 INCR + EXPIRE NX 固定窗口：首次失败开始计时，后续失败不刷新TTL，到期自动解锁；
 * 锁定是窗口剩余时间，并非重新计时15分钟，文案{{minutes}}为窗口总时长。
 * 仅按账号限流（trim+小写归一化，规避大小写绕过）；dev环境不使用IP锁避免误伤，生产可扩展账号+IP双锁。
 *
 * 与signin协作：
 * 1. 登录入口先执行assertNotLocked做锁定校验；
 * 2. 凭证类失败走recordFailureAndThrow：1‑4次返回 40104 携带剩余尝试次数，第5次触发锁定返回40105；
 *    参数格式错误由controller拦截，不计入失败；
 * 3. 登录成功调用clearSigninFailures清空计数。
 *
 * 安全权衡：返回剩余次数存在少量信息泄露风险，但对正常用户提示收益更高，予以保留。
 */
import { createRedisCache } from '../db/redis.js';
import { HttpError } from '../middleware/error.middleware.js';
import { ERROR_DEFS } from '../i18n/error-defs.js';
import {
    SIGNIN_MAX_ATTEMPTS,
    SIGNIN_WINDOW_SECONDS,
    signinFailKey,
} from '../constants/auth.js';

/** Redis 缓存封装（模块级创建一次，内部每次操作都经 getRedis()，与 auth.service 同款） */
const redisCache = createRedisCache();

/**
 * 断言账号未被锁定：失败计数已达上限 → 40105 signin_locked（HTTP 429）。
 * 文案经 {{minutes}} 插值窗口时长（词条不硬编码 15，改常量即自动跟随）。
 * 未锁定的账号静默通过（get 未命中返回 null，Number(null)=0 < 上限）。
 * 账号直接透传：归一化（trim+小写）统一由 signinFailKey 内部完成，
 * 保证「判定、计数、清除」三个入口落到同一个键。
 */
export async function assertNotLocked(account: string): Promise<void> {
    const raw = await redisCache.get(signinFailKey(account));
    if (Number(raw) >= SIGNIN_MAX_ATTEMPTS) {
        throw new HttpError({
            ...ERROR_DEFS.signin_locked,
            params: { minutes: SIGNIN_WINDOW_SECONDS / 60 },
        });
    }
}

/** 记录一次登录失败：计数 +1，首次失败时以 EXPIRE NX 固定窗口。返回累计失败次数。 */
async function recordFailure(account: string): Promise<number> {
    return redisCache.incr(signinFailKey(account), SIGNIN_WINDOW_SECONDS);
}

/**
 * 记录一次登录失败并抛出对应错误（signin 的凭证失败出口收敛到这里）：
 *   - 计数后达到上限 → 账号此刻已锁定，直接抛 40105 signin_locked（HTTP 429），
 *     不再报「密码错误」，避免用户再耗一次尝试去撞锁；
 *   - 未达上限 → 抛 40104 signin_credential_invalid（HTTP 401），文案带 {{remaining}}
 *     剩余次数倒计时。与 40103 的分工：40103 是 token 校验等通用凭证失败；
 *     40104 是 signin 专属的倒计时变体，params 由这里传（词条本身不绑定插值）。
 */
export async function recordFailureAndThrow(account: string): Promise<never> {
    const failures = await recordFailure(account);
    if (failures >= SIGNIN_MAX_ATTEMPTS) {
        throw new HttpError({
            ...ERROR_DEFS.signin_locked,
            params: { minutes: SIGNIN_WINDOW_SECONDS / 60 },
        });
    }
    throw new HttpError({
        ...ERROR_DEFS.signin_credential_invalid,
        params: { remaining: SIGNIN_MAX_ATTEMPTS - failures },
    });
}

/** 登录成功后清除失败计数，重置该账号的限流窗口。 */
export async function clearSigninFailures(account: string): Promise<void> {
    await redisCache.del(signinFailKey(account));
}
