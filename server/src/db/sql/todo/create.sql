-- 新增：归属登录用户（user_id NOT NULL，由 service 层保证已鉴权后才调用）。
-- updated_at 显式写入，与 created_at 走表默认的 CURRENT_TIMESTAMP 同读一个事务时刻，出生时刻两列必然相等。
INSERT INTO
    todos (user_id, text, updated_at)
VALUES
    ($1, $2, CURRENT_TIMESTAMP)
RETURNING
    uid,
    text,
    done,
    created_at,
    updated_at;