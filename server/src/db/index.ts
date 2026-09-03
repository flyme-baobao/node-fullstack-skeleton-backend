/**
 * db 模块统一出口（db/index.ts）
 *
 * 仅做聚合 re-export，不放实现：各数据库连接管理按文件名各归其位
 * （postgres.ts / redis.ts），引用方统一从这里导入，无需感知具体文件。
 */
export * from './postgres.js';
export * from './redis.js';