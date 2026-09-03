UPDATE todos
SET
    done = NOT done,
    updated_at = CURRENT_TIMESTAMP
WHERE
    uid = $1
    AND is_deleted = false
RETURNING
    uid,
    text,
    done,
    created_at,
    updated_at;