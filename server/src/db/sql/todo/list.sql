SELECT
    uid,
    text,
    done,
    created_at,
    updated_at
FROM todos
WHERE
    is_deleted = false
ORDER BY id DESC