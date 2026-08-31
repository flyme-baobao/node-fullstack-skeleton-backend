/**
 * 前端零依赖结构化日志。
 *
 * 与后端的 server/src/utils/logger.ts 保持同一套结构约定：每个 console 调用
 * 都输出 `{ ts, level, msg, ...meta }`，便于在浏览器 DevTools 里按字段展开/过滤对齐排查。
 *
 * 与后端差异：
 *  - 没有 process.stdout / stderr，所有级别都落到浏览器 console；
 *  - 没有 Docker 这类统一的日志采集通道，日志展示在浏览器 DevTools；
 *  - 始终输出不设开关：与后端 logger 行为一致，量级很小无需静默。
 */

type LogMeta = Record<string, unknown>;

function write(level: string, method: 'log' | 'warn' | 'error', msg: string, meta: LogMeta = {}): void {
    const payload = {
        ts: new Date().toISOString(),
        level,
        msg,
        ...meta,
    };
    console[method](payload);
}

export const logger = {
    info: (msg: string, meta: LogMeta = {}): void => write('info', 'log', msg, meta),
    warn: (msg: string, meta: LogMeta = {}): void => write('warn', 'warn', msg, meta),
    error: (msg: string, meta: LogMeta = {}): void => write('error', 'error', msg, meta),
};