-- ============================================================
-- 数据库初始化脚本（原生 SQL）
-- 执行方式：npm run db:init（内部用 pg 驱动执行本文件，幂等可重复执行）
-- 约定：只建缺失的表/类型/索引，不动已有数据（IF NOT EXISTS 语义）
-- ============================================================

-- 待办表
CREATE TABLE IF NOT EXISTS todos (
    id          SERIAL PRIMARY KEY,
    text        VARCHAR(280) NOT NULL,
    done        BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP(3) NOT NULL,
    is_deleted  BOOLEAN NOT NULL DEFAULT false
);

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
    email          VARCHAR(191) NOT NULL,
    user_name      VARCHAR(80),
    phone_number   VARCHAR(32),
    password_hash  VARCHAR(255),
    status         "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    created_at     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP(3) NOT NULL
);

-- 唯一索引
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key        ON users (email);
CREATE UNIQUE INDEX IF NOT EXISTS users_user_name_key    ON users (user_name);
CREATE UNIQUE INDEX IF NOT EXISTS users_phone_number_key ON users (phone_number);
