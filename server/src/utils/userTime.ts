import type { Request } from 'express';
/**
 * SSR 用户时区时间格式化（userTime.ts）
 *
 * 时区架构分工（配套 client/index.html 的 browser_tz cookie 与连接串 options=-c timezone=UTC）：
 *  - 存储：DB 统一 UTC——TIMESTAMPTZ 列 + 连接串锁会话时区，服务端/DB 不掺用户时区；
 *  - 日志：Node 进程 TZ 只影响 logger 的 tsLocal（人类可读），与数据无关；
 *  - 展示：SSR 输出时间字符串时按用户上下文格式化——req.userTimeZone / req.userLocale
 *          由 middleware/user-context.middleware.ts 挂载（cookie 解析也在那边内聚），
 *          本模块只负责「Date → 用户时区 + 用户语言的字符串」，不碰请求侧。
 *          纯前端渲染直接 new Intl.DateTimeFormat(...)，不必经过本模块。
 */

/**
 * 按用户时区 + 语言格式化时间（controller 一行直取）。
 * @param req  Express Request（userContext 中间件已挂 userTimeZone / userLocale）
 * @param date DB 取出的时间（pg 驱动已把 TIMESTAMPTZ 解成绝对时刻 Date）
 * @returns    如 zh-CN 用户看到 2026/9/2 14:30，en-US 用户看到 9/2/2026, 2:30 PM
 */
export function formatUserDateTime(req: Request, date: Date): string {
    return new Intl.DateTimeFormat(req.userLocale, {
        timeZone: req.userTimeZone,
        year: 'numeric', month: 'numeric', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
    }).format(date);
}
