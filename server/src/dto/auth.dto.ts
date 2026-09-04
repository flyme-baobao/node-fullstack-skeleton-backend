/**
 * 鉴权入参 DTO 与校验（auth.dto.ts）
 *
 * 职责：把 HTTP body 清洗/校验成 service 可信的结构化入参；校验失败抛 HttpError(invalid_params)。
 * 规则口径与前端 client/src/components/validForm/authForm/validation.ts 保持一致
 * （正则逐字对齐，改动任一侧必须同步另一侧——防「绕过前端直接打 API」提交弱口令/脏字段）。
 * confirm_password 属 UI 交互语义（两次输入一致性），服务端不校验：服务端只认 password 本身。
 */
import { HttpError } from '../middleware/error.middleware.js';
import { ERROR_DEFS } from '../i18n/error-defs.js';

/** 用户名：各语言字母/数字/下划线，3-80 位（u 标志按 Unicode 码点计数，对齐 DB VARCHAR(80)） */
const USERNAME_REGEX = /^[\p{L}\p{N}_]{3,80}$/u;
/** 手机号：国内 1[3-9] 开头 11 位；座机 0 开头（横线可选） */
const PHONE_REGEX = /^(?:1[3-9]\d{9}|0\d{2,3}-?\d{7,8})$/;
/** 邮箱：简单格式 */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** 密码：8-72 位 ASCII 可打印，必含字母 + 数字 + 特殊符号 */
const PASSWORD_REGEX =
    /^(?=.*[A-Za-z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?])[!-~]{8,72}$/;

/** 注册入参（清洗后） */
export interface SignupDto {
    userName: string;
    email?: string;
    phoneNumber?: string;
    password: string;
}

/** 登录入参（清洗后） */
export interface SigninDto {
    /** 登录账号：user_name / email / phone_number 三选一 */
    account: string;
    password: string;
}

/** 取 body 字符串字段：undefined/null → ''，其余 String() 收敛 */
function str(body: unknown, key: string): string {
    const raw = (body as Record<string, unknown> | undefined)?.[key];
    return raw === undefined || raw === null ? '' : String(raw);
}

/** 校验失败统一抛 40004（invalid_params）；service 与 DB 约束不再重复兜底必填 */
function invalid(): never {
    throw new HttpError({ ...ERROR_DEFS.invalid_params });
}

/** 解析并校验注册入参：user_name/password 必填，email/phone_number 选填（有值才校验格式） */
export function parseSignup(body: unknown): SignupDto {
    const userName = str(body, 'user_name').trim();
    const email = str(body, 'email').trim();
    const phoneNumber = str(body, 'phone_number').trim();
    const password = str(body, 'password');

    if (!userName || !password) invalid();
    if (!USERNAME_REGEX.test(userName)) invalid();
    if (email && !EMAIL_REGEX.test(email)) invalid();
    if (phoneNumber && !PHONE_REGEX.test(phoneNumber)) invalid();
    if (!PASSWORD_REGEX.test(password)) invalid();

    return {
        userName,
        email: email || undefined,
        phoneNumber: phoneNumber || undefined,
        password,
    };
}

/** 解析并校验登录入参：account/password 必填（account 格式交给按特征识别 + 库端匹配，不做正则白名单） */
export function parseSignin(body: unknown): SigninDto {
    const account = str(body, 'account').trim();
    const password = str(body, 'password');
    if (!account || !password) invalid();
    return { account, password };
}