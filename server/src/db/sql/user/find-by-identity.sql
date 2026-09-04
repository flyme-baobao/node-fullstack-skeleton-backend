-- 按登录账号查用户（signin 用）。
-- account 由服务端按特征分类后显式传入类型（'email' | 'phone' | 'user_name'），
-- 与前端 client/src/components/validForm/authForm/validation.ts 的 resolveAccountType 口径一致：
--   email     → users.email
--   phone     → users.phone_number
--   user_name → users.user_name
-- 三个布尔条件互斥（类型只传一个），等价于动态列选择但全程参数化，无拼接注入面。
SELECT
    user_id,
    user_name,
    email,
    phone_number,
    password_hash,
    status
FROM
    users
WHERE
    ($1 = 'email' AND email = $2)
    OR ($1 = 'phone' AND phone_number = $2)
    OR ($1 = 'user_name' AND user_name = $2)
LIMIT 1;