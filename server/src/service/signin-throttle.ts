/**
 * service/signin‑throttle.ts 登录失败限流（账号 × IP 双维度）
 *
 * 规则：15 分钟固定窗口内，同一账号×同一 IP 失败 5 次、或同一账号跨全部设备合计失败 10 次，触发锁定(40105)；
 * 锁定请求直接拦截，跳过查库与密码校验。
 * Redis采用 INCR + EXPIRE NX 固定窗口：首次失败开始计时，后续失败不刷新TTL，到期自动解锁；
 * 锁定是窗口剩余时间，并非重新计时15分钟，文案{{minutes}}为窗口总时长。
 * 双键双上限：账号键（trim+小写归一化，防大小写变体绕过）管跨设备合计；账号×IP 组合键管单设备配额。
 * 组合键（非纯 IP 键）语义：换账号即换键、设备配额重置，该绕过面由账号合计 10 次兜底；
 * 也避免 NAT 共享出口下无辜用户互相消耗同一个 IP 配额。
 *
 * 与signin协作：
 * 1. 登录入口先执行assertNotLocked做锁定校验（任一维度达上限即拦）；
 * 2. 凭证类失败走recordFailureAndThrow：未达上限返回 40104 携带剩余尝试次数
 *    （remaining = min(账号剩余, IP剩余)，提示更紧的维度），计满当场触发锁定返回40105；
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
    SIGNIN_IP_MAX_ATTEMPTS,
    SIGNIN_WINDOW_SECONDS,
    signinFailKey,
    signinIpFailKey,
} from '../constants/auth.js';

/** Redis 缓存封装（模块级创建一次，内部每次操作都经 getRedis()，与 auth.service 同款） */
const redisCache = createRedisCache();

/**
 * 锁定判定归一口径（assertNotLocked 入口拦截 与 recordFailureAndThrow 计数后判锁 共用）：
 * 账号合计达上限 或 账号×IP 达上限，任一满足即锁定（OR）。
 * 入参兼容 get 的原始串/未命中 null 与 incr 的数字，统一 Number() 归一后比较
 * （get 未命中 null → Number(null)=0，安全参与比较）。
 * 阈值判定只此一处，两处调用永远同口径，改常量即全跟随。
 */
function isAccountLocked(accountRaw: string | number | null, ipRaw: string | number | null): boolean {
    return Number(accountRaw) >= SIGNIN_MAX_ATTEMPTS || Number(ipRaw) >= SIGNIN_IP_MAX_ATTEMPTS;
}

/**
 * 断言未锁定：账号键或账号×IP 键任一达上限 → 40105 signin_locked（HTTP 429）。
 * 文案经 {{minutes}} 插值窗口时长（词条不硬编码 15，改常量即自动跟随）。
 * 未锁定静默通过（get 未命中返回 null，Number(null)=0 < 上限）。
 * 账号直接透传：归一化（trim+小写）统一由 signinFailKey / signinIpFailKey 内部完成，
 * 保证「判定、计数、清除」三个入口落到同一个键。
 */
export async function assertNotLocked(account: string, clientIp: string): Promise<void> {
    const accountRaw = await redisCache.get(signinFailKey(account));
    const ipRaw = await redisCache.get(signinIpFailKey(account, clientIp));
    if (isAccountLocked(accountRaw, ipRaw)) {
        throw new HttpError({
            ...ERROR_DEFS.signin_locked,
            params: { minutes: SIGNIN_WINDOW_SECONDS / 60 },
        });
    }
}

/** 记录一次登录失败：账号键与账号×IP 键各 +1（顺序执行，第二条失败只少计一桶，fail-closed 方向无害），首次失败时以 EXPIRE NX 固定窗口。返回两个维度的累计失败次数。 */
async function recordFailure(account: string, clientIp: string): Promise<{ account: number; ip: number }> {
    const accountFailures = await redisCache.incr(signinFailKey(account), SIGNIN_WINDOW_SECONDS);
    const ipFailures = await redisCache.incr(signinIpFailKey(account, clientIp), SIGNIN_WINDOW_SECONDS);
    return {
        account: accountFailures,
        ip: ipFailures,
    };
}

/**
 * 记录一次登录失败并抛出对应错误（signin 的凭证失败出口收敛到这里）：
 *   - 计数后任一维度达上限（账号合计满 10 或 账号×IP 满 5）→ 此刻已锁定，直接抛 40105 signin_locked（HTTP 429），
 *     不再报「密码错误」，避免用户再耗一次尝试去撞锁；
 *   - 未达上限 → 抛 40104 signin_credential_invalid（HTTP 401），文案带 {{remaining}}
 *     剩余次数倒计时，取 min(账号剩余, IP剩余)——更紧的维度决定真实可试次数。
 *     与 40103 的分工：40103 是 token 校验等通用凭证失败；
 *     40104 是 signin 专属的倒计时变体，params 由这里传（词条本身不绑定插值）。
 */
export async function recordFailureAndThrow(account: string, clientIp: string): Promise<never> {
    const failures = await recordFailure(account, clientIp);
    if (isAccountLocked(failures.account, failures.ip)) {
        throw new HttpError({
            ...ERROR_DEFS.signin_locked,
            params: { minutes: SIGNIN_WINDOW_SECONDS / 60 },
        });
    }
    const remaining = Math.min(
        SIGNIN_MAX_ATTEMPTS - failures.account,
        SIGNIN_IP_MAX_ATTEMPTS - failures.ip,
    );
    throw new HttpError({
        ...ERROR_DEFS.signin_credential_invalid,
        params: { remaining },
    });
}

/** 登录成功后清除失败计数：账号键整体重置（跨设备合计清零），账号×IP 键只清本次登录 IP；其余设备的组合键保留（各自独立配额，到期自清）。 */
export async function clearSigninFailures(account: string, clientIp: string): Promise<void> {
    await redisCache.del(signinFailKey(account));
    await redisCache.del(signinIpFailKey(account, clientIp));
}
