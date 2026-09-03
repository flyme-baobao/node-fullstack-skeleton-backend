UPDATE __TABLE__
SET
    __COLUMN__ = __VALUE_EXPR__
WHERE
    id IN (
        SELECT id
        FROM __TABLE__
        WHERE __WHERE_CLAUSE__
        ORDER BY id
        LIMIT __BATCH_LIMIT__
        FOR UPDATE
            SKIP LOCKED
    )