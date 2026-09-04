-- 列表：按登录用户隔离（user_id 过滤），只返回未删除数据，最新创建在前。
-- 未登录时 controller 层直接给空数组，不进本 SQL（公开页降级，见 page.controller）。
SELECT
    uid,
    text,
    done,
    created_at,
    updated_at
FROM todos
WHERE
    user_id = $1
    AND is_deleted = false
ORDER BY id DESC