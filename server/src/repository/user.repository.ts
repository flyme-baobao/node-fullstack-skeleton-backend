/**
 * users 表数据访问（user.repository.ts）
 *
 * 职责：登录账号定位用户 / 对外 user_id 查用户 / 注册落库。
 * 口径对齐：账号特征分类与前端 client/src/components/validForm/authForm/validation.ts
 * 的 resolveAccountType 一致（含 @ → email；纯数字/带+ → phone；否则 user_name），
 * 改动任一侧必须同步另一侧（注释双方互链）。
 * 密码散列只进不出：find-by-identity 的 password_hash 行仅 signin 校验用，
 * 不进任何对外实体（UserIdentity 不含该字段）。
 */
import { loadSql } from '../utils/loadSql.js';
import { queryWithLog } from '../db/queryWithLog.js';
import { HttpError } from '../middleware/error.middleware.js';
import { ERROR_DEFS } from '../i18n/error-defs.js';
import type { QueryResultRow } from 'pg';

/** 用户对外实体（不含 password_hash；时间字段为 Date，展示层格式化） */
export interface UserIdentity {
    /** 对外查找键（UUID，库端 gen_random_uuid 生成），对外接口一律携带它 */
    userId: string;
    userName: string;
    email: string | null;
    phoneNumber: string | null;
}

/** 登录凭证行（内部使用：仅 signin 校验密码时出现，不对外） */
export interface UserCredential extends UserIdentity {
    passwordHash: string | null;
    /** 库端枚举 'ACTIVE' | 'DISABLED' */
    status: string;
    createdAt: Date;
}

/** find-by-identity 行形状（snake_case，pg 按列名返回 key） */
interface UserIdentityRow extends QueryResultRow {
    user_id: string;
    user_name: string;
    email: string | null;
    phone_number: string | null;
    password_hash: string | null;
    status: string;
    created_at: Date;
}

/** 行 → 凭证实体的转换边界（snake_case → camelCase） */
function toCredential(row: UserIdentityRow): UserCredential {
    return {
        userId: row.user_id,
        userName: row.user_name,
        email: row.email,
        phoneNumber: row.phone_number,
        passwordHash: row.password_hash,
        status: row.status,
        createdAt: row.created_at,
    };
}

/** 行 → 对外实体（剥掉 password_hash / status / createdAt） */
function toIdentity(row: UserIdentityRow): UserIdentity {
    return {
        userId: row.user_id,
        userName: row.user_name,
        email: row.email,
        phoneNumber: row.phone_number,
    };
}

/**
 * 登录账号特征分类（与前端 resolveAccountType 保持一致）：
 *   含 @ → email；纯数字（可带 + 国际区号）→ phone；其余 → user_name。
 */
function resolveAccountType(account: string): 'email' | 'phone' | 'user_name' {
    if (account.includes('@')) return 'email';
    if (/^\+?\d+$/.test(account)) return 'phone';
    return 'user_name';
}

/** pg 唯一约束冲突错误码（23505）：注册时 user_name/email/phone_number 撞唯一索引 */
function isPgUniqueViolation(err: unknown): boolean {
    return (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code?: unknown }).code === '23505'
    );
}

/**
 * 按登录账号（user_name / email / phone_number 三选一）查用户；
 * 找不到返回 undefined（由 service 决定 40103/40901 语义，repository 不做业务判断）。
 */
export async function findByAccount(account: string): Promise<UserCredential | undefined> {
    const sql = loadSql('user/find-by-identity.sql');
    const { rows } = await queryWithLog<UserIdentityRow>(
        'user.find_by_identity',
        sql,
        [resolveAccountType(account), account],
    );
    return rows[0] ? toCredential(rows[0]) : undefined;
}

/** 按对外 user_id 查用户；找不到返回 undefined。 */
export async function findByUserId(userId: string): Promise<UserIdentity | undefined> {
    const sql = loadSql('user/find-by-user-id.sql');
    const { rows } = await queryWithLog<UserIdentityRow>(
        'user.find_by_user_id',
        sql,
        [userId],
    );
    return rows[0] ? toIdentity(rows[0]) : undefined;
}

/**
 * 注册落库：user_name 必填，email / phone_number 选填（空串统一收敛为 NULL，
 * 与「选填 = 不提供」语义对齐，也避免唯一索引对空串的误撞）。
 * 唯一索引冲突（23505）→ 业务码 40901 account_exists；其余 DB 失败 → 50005。
 */
export async function create(input: {
    userName: string;
    email?: string;
    phoneNumber?: string;
    passwordHash: string;
}): Promise<UserIdentity> {
    const sql = loadSql('user/create.sql');
    const { rows } = await queryWithLog<UserIdentityRow>(
        'user.create',
        sql,
        [
            input.userName,
            input.email || null,
            input.phoneNumber || null,
            input.passwordHash,
        ],
        {
            mapError: (err) =>
                isPgUniqueViolation(err)
                    ? new HttpError({ ...ERROR_DEFS.account_exists })
                    : new HttpError({ ...ERROR_DEFS.db_query_error }),
        },
    );
    return toIdentity(rows[0]);
}