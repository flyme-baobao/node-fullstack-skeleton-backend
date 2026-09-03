-- ============================================================
-- 数据库初始化脚本（原生 SQL）
-- 执行方式：npm run db:init（内部用 pg 驱动执行本文件，幂等可重复执行）
-- 约定：只建缺失的表/类型/索引，不动已有数据（IF NOT EXISTS 语义）
-- 主键约定：自增 id 仅内部使用；对外查找/路由一律用 UUID 对外标识（todos.uid / users.user_id，
--          库端 gen_random_uuid 生成，PG13+ 内置），不把自增 id 暴露给客户端（可枚举、可被爬遍历）
-- 时区约定：时间列一律 TIMESTAMPTZ（存绝对时刻）+ 连接串 options=-c timezone=UTC
--          锁会话时区 UTC，存储口径与时区解耦；展示由 SSR（browser_tz cookie）/
--          前端 Intl 按用户时区格式化，见 server/src/utils/userTime.ts
-- ============================================================

-- 待办表
CREATE TABLE IF NOT EXISTS todos (
    id          SERIAL PRIMARY KEY,
    uid         UUID NOT NULL DEFAULT gen_random_uuid(),
    text        VARCHAR(280) NOT NULL,
    done        BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMPTZ(3) NOT NULL,
    is_deleted  BOOLEAN NOT NULL DEFAULT false
);

-- 为 todos 补对外标识 uid 列（幂等）：已存在则跳过。可空补列（O(1) 元数据操作，不重写表）；
-- 存量 NULL 行的回填与 NOT NULL 收紧由 db-init.js 在结构就绪后执行（见该文件「回填对外标识」节）
-- SET DEFAULT 保证后续 INSERT 不带该列（create.sql 约定）也能自动生成
ALTER TABLE todos ADD COLUMN IF NOT EXISTS uid UUID;
ALTER TABLE todos ALTER COLUMN uid SET DEFAULT gen_random_uuid();

-- uid 对外唯一索引（查找走它；建在 id 上的 PK 只作内部主键）
CREATE UNIQUE INDEX IF NOT EXISTS todos_uid_key ON todos (uid);

-- 用户状态枚举；DO 块兜底「类型已存在」实现幂等
DO $$
BEGIN
    CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- 用户表
CREATE TABLE IF NOT EXISTS users (
    id             SERIAL PRIMARY KEY,
    user_id        UUID NOT NULL DEFAULT gen_random_uuid(),
    email          VARCHAR(191) NOT NULL,
    user_name      VARCHAR(80),
    phone_number   VARCHAR(32),
    password_hash  VARCHAR(255),
    status         "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    created_at     TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMPTZ(3) NOT NULL
);


-- 为 users 补对外标识 user_id 列（幂等）：已存在则跳过。可空补列（O(1)，存量行存在时不能一步加 NOT NULL）；
-- 存量 NULL 行的回填与 NOT NULL 收紧由 db-init.js 在结构就绪后执行（见该文件「回填对外标识」节）
-- SET DEFAULT 保证后续 INSERT 不带该列也能自动生成
ALTER TABLE users ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE users ALTER COLUMN user_id SET DEFAULT gen_random_uuid();

-- user_id 对外唯一索引（查找走它；建在 id 上的 PK 只作内部主键）
CREATE UNIQUE INDEX IF NOT EXISTS users_user_id_key ON users (user_id);

-- 唯一索引
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key        ON users (email);
CREATE UNIQUE INDEX IF NOT EXISTS users_user_name_key    ON users (user_name);
CREATE UNIQUE INDEX IF NOT EXISTS users_phone_number_key ON users (phone_number);
