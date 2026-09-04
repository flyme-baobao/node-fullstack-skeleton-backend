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

-- 建表顺序说明：
--   1. 用户状态枚举（users.status 引用它）
--   2. users 表（todos.user_id 外键引用它，故 users 必须先建）
--   3. todos 表（表内联外键 REFERENCES users，顺序已满足）
--   4. 各类索引/唯一索引

-- 用户状态枚举；DO 块兜底「类型已存在」实现幂等
DO $$
BEGIN
    CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');

EXCEPTION WHEN duplicate_object THEN NULL;

END $$;

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL DEFAULT gen_random_uuid (),
    user_name VARCHAR(80) NOT NULL,
    email VARCHAR(191),
    phone_number VARCHAR(32),
    password_hash VARCHAR(255),
    status "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ(3) NOT NULL
);

-- 唯一索引
CREATE UNIQUE INDEX IF NOT EXISTS users_user_id_key ON users (user_id);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (email);

CREATE UNIQUE INDEX IF NOT EXISTS users_user_name_key ON users (user_name);

CREATE UNIQUE INDEX IF NOT EXISTS users_phone_number_key ON users (phone_number);

-- 待办表
-- todos→users 外键用内联约束：users 表已在上方创建，REFERENCES 合法；
-- 外键目标 users.user_id 有唯一索引（users_user_id_key），满足 FK 引用要求；
-- ON DELETE CASCADE：删除用户时级联删除其待办。
CREATE TABLE IF NOT EXISTS todos (
    id          SERIAL PRIMARY KEY,
    uid         UUID NOT NULL DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL,
    text        VARCHAR(280) NOT NULL,
    done        BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMPTZ(3) NOT NULL,
    is_deleted  BOOLEAN NOT NULL DEFAULT false,

-- 表内定义外键约束，关联 users.user_id
    CONSTRAINT fk_todos_user
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- uid 对外唯一索引（查找走它；建在 id 上的 PK 只作内部主键）
CREATE UNIQUE INDEX IF NOT EXISTS todos_uid_key ON todos (uid);

-- 给 user_id 建索引，按用户查待办会非常频繁，不加索引全表扫描
CREATE INDEX IF NOT EXISTS idx_todos_user_id ON todos (user_id);