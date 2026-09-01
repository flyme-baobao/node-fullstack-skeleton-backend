/**
 * 通用等待工具：sleep 指定毫秒后 resolve。
 *
 * 典型用途：模拟数据库 / 外部服务的 IO 耗时（如让 loading 遮罩人眼可见）。
 * 等多久、为什么等，由调用方决定；本工具只负责「等待」本身。
 */

/** sleep 指定毫秒（ms），期间不阻塞事件循环 */
export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
