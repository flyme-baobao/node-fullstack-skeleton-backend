/**
 * 零依赖结构化日志。
 *
 * 为什么不用第三方库（pino / winston）：
 *  - 本项目是研究/演示性质，日志量级很小，内置 console + JSON 序列化已足够。
 *  - 结构化体现在「每行是一个 JSON 对象」，便于 grep 单个 requestId / 字段定位问题。
 *  - 若要升级（文件、轮转、按级别过滤），再低成本替换成本文件即可，不影响调用方。
 */

type LogMeta = Record<string, unknown>;


/**
 * 本地时间的人类可读文案（供日志的 tsLocal 字段）。
 *
 * 目标格式：`2026-08-27 11:44:51 GMT+0800 (中国标准时间)`，一眼可读且带时区偏移+区名。
 * 日期部分用 `'sv-SE'`：默认恰是 `YYYY-MM-DD HH:mm:ss`，与 `ts`（ISO 8601）风格统一、
 * 可排序、易 grep。
 * 偏移 + 区名没有单一 Intl 选项一次给全，故拆两次：
 *  - 偏移：`en-US` + `timeZoneName:'longOffset'` → `GMT+08:00`，去掉冒号得 `GMT+0800`
 *  - 区名：`zh-CN` + `timeZoneName:'long'` → `中国标准时间`（英文环境给 China Standard Time）
 *
 * 注意：`.env` 里 `TZ` 只决定时区值（如 Asia/Shanghai）；时区名是中文还是英文由这里
 * 的 locale 决定，与 `TZ` 无关。
 */
function localTs(): string {
    const shellDefaultTZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const tz = process.env.TZ || shellDefaultTZ;
    const dateTimeFormat= new Intl.DateTimeFormat('sv-SE', {
        timeZone: tz,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false,
    });
    const datePart = dateTimeFormat.format(new Date());
    const timeZonePart = (loc: string, tzName: 'longOffset' | 'long'): string => {
        const part = new Intl.DateTimeFormat(loc, { timeZone: tz, timeZoneName: tzName })
            .formatToParts(new Date())
            .find((p) => p.type === 'timeZoneName');
        return part ? part.value : '';
    };
    const offset = timeZonePart('en-US', 'longOffset').replace(':', '');      // GMT+0800
    const zoneName = timeZonePart('zh-CN', 'long');                           // 中国标准时间
    return `${datePart} ${offset} (${zoneName})`;
}
const LOG_LEVELS = {
    DEBUG: 'debug', // 调试级：用于排查细节（如被排除的请求），生产默认不输出。
    INFO: 'info',  // 信息级：用于记录关键事件（如启动、请求、路由命中、数据库连接等）。
    WARN: 'warn',  // 警告级：用于记录非致命异常（如请求参数错误、404、第三方服务异常等）。
    ERROR: 'error', // 错误级：用于记录致命异常（如未捕获异常、数据库连接失败、服务崩溃等）。
} as const;
/** 日志级别定义：此处集中声明可用级别及优先级（越靠前越详细）。 */
type LogLevel = typeof LOG_LEVELS[keyof typeof LOG_LEVELS];

/** console 输出通道：warn/error 走 stderr，log（debug/info）走 stdout，便于按流筛选。 */
const LOG_METHODS = {
    LOG: 'log',   // stdout（debug / info）
    WARN: 'warn', // stderr（warn）
    ERROR: 'error', // stderr（error）
} as const;
type LogMethod = typeof LOG_METHODS[keyof typeof LOG_METHODS];

/** 判断生产环境：仅产线需要排除 debug，其余环境全量输出。 */
function isProduction(): boolean {
    return process.env.NODE_ENV === 'production';
}

function write(level: LogLevel, method: LogMethod, msg: string, meta: LogMeta = {}): void {
    // 生产环境只丢弃 debug（info/warn/error 照常）；其它环境不过滤，所有级别都打印。
    if (level === LOG_LEVELS.DEBUG && isProduction()) {
        return;
    }
    const line = JSON.stringify({
        ts: new Date().toISOString(),
        tsLocal: localTs(),
        level,
        msg,
        ...meta,
    });
    // method 本身就是 'log' | 'warn' | 'error'，直接按名调用即可（warn/error 落 stderr，log 落 stdout）。
    console[method](line);
}

export const logger = {
    /** 调试级日志：用于排查细节（如被排除的请求），生产默认不输出。 */
    debug: (msg: string, meta: LogMeta = {}): void => write(LOG_LEVELS.DEBUG, LOG_METHODS.LOG, msg, meta),
    info: (msg: string, meta: LogMeta = {}): void => write(LOG_LEVELS.INFO, LOG_METHODS.LOG, msg, meta),
    warn: (msg: string, meta: LogMeta = {}): void => write(LOG_LEVELS.WARN, LOG_METHODS.WARN, msg, meta),
    error: (msg: string, meta: LogMeta = {}): void => write(LOG_LEVELS.ERROR, LOG_METHODS.ERROR, msg, meta),
};