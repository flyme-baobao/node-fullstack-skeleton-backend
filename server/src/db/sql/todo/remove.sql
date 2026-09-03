UPDATE todos
SET
    is_deleted = true,
    updated_at = CURRENT_TIMESTAMP
WHERE
    uid = $1
    AND is_deleted = false;