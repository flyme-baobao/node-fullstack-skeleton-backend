/**
 * 登录/注册表单纯校验规则层，无DOM依赖，支持独立单元测试。
 * 职责：承载常量、正则、校验函数、字段校验规则表。
 * 与 authForm/index.ts（事件监听+错误呈现）解耦：①可单独对valid*系列函数做单测；
 * ②validAccount / SIGNUP_FIELD_RULES可复用于服务端，保证前后端口径统一。
 * 字段描述：
 *  - user_name 必填，各语言字母/数字/下划线（含汉字），3‑80位（长度按字符计）；禁止空格与特殊符号；
 *  - email / phone_number 选填：邮箱标准格式；手机号11位国内号码或0开头座机；
 *  - password 8‑72位ASCII可打印字符，需包含字母、数字、特殊符号；
 *  - 登录账号按特征自动识别类型，需和服务端逻辑保持一致，不可随意修改。
 */


/** 注册表单字段的 name 常量（key ↔ SIGNUP_FIELD_RULES 与表单模板 name 对齐） */
export const FORM_FIELD_NAME = {
    USERNAME: 'user_name',
    EMAIL: 'email',
    PHONE: 'phone_number',
    PASSWORD: 'password',
    CONFIRM_PASSWORD: 'confirm_password',
} as const;

// 用户名白名单：各语言字母(\p{L})、各类数字(\p{N})、下划线，3-80 位；空格/标点/符号/emoji 等一律非法。
// u 标志下量词按 Unicode 码点计数：汉字/增补平面字符各算 1 位，与 DB VARCHAR(80) 字符计数一致。
const USERNAME_REGEX = /^[\p{L}\p{N}_]{3,80}$/u;
// 手机号：国内 1[3-9] 开头 11 位；座机：0 开头(3-4 位)+7-8 位号码，横线可选（029-xxxx / 029xxxx）
const PHONE_REGEX = /^(?:1[3-9]\d{9}|0\d{2,3}-?\d{7,8})$/;
// 邮箱：简单格式，不含空格，允许常见邮箱形态
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// 密码：8-72 位 ASCII 可打印字符（不含空格、中文、全角），必须含 字母(不分大小写) + 数字 + 特殊符号
// 参考：https://stackoverflow.com/questions/19605150/...；ASCII 可打印 0x21-0x7E，空格 0x20 排除 → [.!-~]
const PASSWORD_REGEX =
    /^(?=.*[A-Za-z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?])[!-~]{8,72}$/;

export function validUsername(username: string): boolean {
    return USERNAME_REGEX.test(username);
}
export function validEmail(email: string): boolean {
    return EMAIL_REGEX.test(email);
}
export function validPhone(phone: string): boolean {
    return PHONE_REGEX.test(phone);
}
export function validPassword(password: string): boolean {
    return PASSWORD_REGEX.test(password);
}
export function validConfirmPassword(password: string, confirm: string): boolean {
    return password === confirm;
}

/** 登录账号按值特征路由到三类（与服务端路由口径一致，不能改）：含 @ → email；纯数字(可+)→ phone；其余 → user_name */
export function resolveAccountType(account: string): 'email' | 'phone' | 'user_name' {
    if (account.includes('@')) return 'email';
    if (/^\+?\d+$/.test(account)) return 'phone';
    return 'user_name';
}

/** 账号对应类别的正则校验（镜像服务端路由，避免客户端与服务端口径分叉） */
export function validAccount(account: string): boolean {
    const type = resolveAccountType(account);
    if (type === 'email') return EMAIL_REGEX.test(account);
    if (type === 'phone') return PHONE_REGEX.test(account);
    return USERNAME_REGEX.test(account);
}

export type FieldRule = {
    validate: (v: string, compare?: string) => boolean; // compare 仅 confirm_password 用
    errorKey: string;
};

/** signup 各字段的即时校验规则表（新增字段在此加一行即可，逻辑零改动） */
export const SIGNUP_FIELD_RULES: Record<string, FieldRule> = {
    [FORM_FIELD_NAME.USERNAME]: { validate: validUsername, errorKey: 'auth.username_invalid' },
    [FORM_FIELD_NAME.EMAIL]: { validate: validEmail, errorKey: 'auth.email_invalid' },
    [FORM_FIELD_NAME.PHONE]: { validate: validPhone, errorKey: 'auth.phone_invalid' },
    [FORM_FIELD_NAME.PASSWORD]: { validate: validPassword, errorKey: 'auth.password_invalid' },
    [FORM_FIELD_NAME.CONFIRM_PASSWORD]: {
        // confirm_password 一致性由 blur 事件比对 password；compare 传该字段对应 password 值
        validate: (v, compare_v) => validConfirmPassword(compare_v || '', v),
        errorKey: 'auth.password_mismatch',
    },
};