-- 软删：uid + user_id 双条件定位（防越权：A 用户不得删除 B 用户的待办），返回是否删到。
UPDATE todos
SET
    is_deleted = true,
    updated_at = CURRENT_TIMESTAMP
WHERE
    uid = $1
    AND user_id = $2
    AND is_deleted = false;