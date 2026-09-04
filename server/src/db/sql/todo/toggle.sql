-- 切换完成状态：uid + user_id 双条件定位（防越权：A 用户不得切换 B 用户的待办），
-- 一条原子 UPDATE（done = NOT done ... RETURNING）避免「先 SELECT 再 UPDATE」的并发读旧值。
UPDATE todos
SET
    done = NOT done,
    updated_at = CURRENT_TIMESTAMP
WHERE
    uid = $1
    AND user_id = $2
    AND is_deleted = false
RETURNING
    uid,
    text,
    done,
    created_at,
    updated_at;