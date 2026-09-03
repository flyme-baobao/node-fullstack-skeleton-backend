INSERT INTO
    todos (text, updated_at)
VALUES ($1, CURRENT_TIMESTAMP)
RETURNING
    uid,
    text,
    done,
    created_at,
    updated_at;