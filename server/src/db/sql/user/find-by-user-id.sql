-- 按对外 user_id 查用户（GET /api/auth/me 用）。
-- 投影不含 password_hash：me 接口只回显公开字段，散列不出库。
SELECT
    user_id,
    user_name,
    email,
    phone_number,
    status,
    created_at
FROM
    users
WHERE
    user_id = $1
LIMIT 1;