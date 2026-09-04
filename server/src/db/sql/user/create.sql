-- 注册落库（signup 用）。
-- email / phone_number 可为 NULL（选填）；PostgreSQL 唯一索引不约束 NULL，
-- 多个用户都可为空值，不与唯一索引冲突。
-- user_name / email / phone_number 任一命中唯一索引 → pg 错误码 23505，
-- 由 repository 的 mapError 转业务码 40901（account_exists）。
INSERT INTO
    users (user_name, email, phone_number, password_hash, updated_at)
VALUES
    ($1, $2, $3, $4, CURRENT_TIMESTAMP)
RETURNING
    user_id,
    user_name,
    email,
    phone_number,
    created_at;