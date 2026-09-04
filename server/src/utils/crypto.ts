/**
 * 密码散列与凭证生成（crypto.ts）
 *
 * 密码安全：node:crypto 的 scrypt（零新增依赖）。
 *   - 存储格式 `scrypt$<saltB64>$<hashB64>`，salt 每条 16B 随机；
 *   - 校验用 timingSafeEqual 常量时间比对，防时序侧信道；比对前先校验长度一致。
 * 凭证生成：token / sessionId 用 crypto.randomBytes → base64url（无 -_ 混淆、URL 安全）。
 * 注意：本模块只承担「密码哈希 / 随机串」这类纯加密原语，不含业务语义；
 *       Redis 过期、Cookie 属性的业务决策在 auth.service / controller。
 */
import { randomBytes, scrypt as _scrypt, timingSafeEqual } from 'node:crypto';

/**
 * scrypt 的 Promise 封装（不用 promisify，省去官方的类型体操）。
 * 只关心「成功拿到 Buffer / 失败 reject」，其余透传 node:crypto 原语义；
 * _scrypt 若同步抛错，也会被 Promise 构造器自动捕获转 reject，无需 try/catch。
 * type 对齐 Node 原生签名（password/salt 均支持 string|Buffer…）：内部虽总传 Buffer，
 * 但不自己设限，避免将来接外部输入时被窄类型卡住。
 */
function scryptAsync(
    password: string | Buffer,
    salt: string | Buffer,
    keylen: number,
    opts: { N: number; r: number; p: number; maxmem?: number },
): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        _scrypt(password, salt, keylen, opts, (err, buf) => {
            if (err) return reject(err);
            resolve(buf);
        });
    });
}

/**
 * scrypt 派生参数：N 取 2^14（服务端默认），内存 ≈ 128 × N × r ≈ 16MiB，
 * 低于 Node 默认 maxmem=32MiB，不会触发 EVP_PBE_scrypt:memory limit exceeded。
 * 若将来把 N 提到 OWASP 交互登录档 2^17（128MiB），必须同步显式传 opts.maxmem，
 * 否则同样的内存限制错误会复现。
 */
const SCRYPT_N = 1 << 14;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 32;
const SALT_LEN = 16;

const SCHEMA = 'scrypt';

/** 随机 salt（密码哈希专用长度） */
function randomSalt(): Buffer {
    return randomBytes(SALT_LEN);
}

/**
 * 对明文密码做 scrypt 哈希，返回可持久化存储的格式 `scrypt$saltB$hashB`。
 * salt 与 hash 均为 base64 编码。
 */
export async function hashPassword(password: string): Promise<string> {
    const salt = randomSalt();
    const derived = await scryptAsync(password, salt, KEY_LEN, {
        N: SCRYPT_N,
        r: SCRYPT_R,
        p: SCRYPT_P,
    });
    return [
        SCHEMA,
        salt.toString('base64'),
        derived.toString('base64'),
    ].join('$');
}

/**
 * 校验明文密码是否匹配存储的 scrypt 串。
 * 常量时间比对（timingSafeEqual），并带长度前置校验。
 * 对格式非法 / 校验失败统一返回 false，不区分原因。
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
    const parts = stored.split('$');
    if (parts.length !== 3 || parts[0] !== SCHEMA) {
        return false;
    }
    const salt = Buffer.from(parts[1], 'base64');
    const expected = Buffer.from(parts[2], 'base64');
    const derived = await scryptAsync(password, salt, KEY_LEN, {
        N: SCRYPT_N,
        r: SCRYPT_R,
        p: SCRYPT_P,
    });
    if (derived.length !== expected.length) {
        return false;
    }
    return timingSafeEqual(derived, expected);
}

/**
 * 生成 URL 安全的随机凭证串（base64url，无 padding）。
 * @param byteLength 随机字节数（32 ≈ 256bit，凭证默认使用）
 */
export function generateSecret(byteLength = 32): string {
    return randomBytes(byteLength).toString('base64url');
}
