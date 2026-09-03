SELECT 1
FROM information_schema.columns
WHERE
    table_schema = 'public'
    AND table_name = $1
    AND column_name = 'is_deleted';