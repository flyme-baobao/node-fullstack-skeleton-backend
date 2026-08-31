import { existsSync } from 'node:fs';
import { join } from 'node:path';

// 本项目 Vite 相关工具函数，独立成文件以保持 vite.config.ts 干净。
// 纯常量请放到 vite.constants.ts。
// 供 vite.config.ts 的 server.proxy.bypass 分流判断使用。

// 判断 url 是否对应 client/public 下真实存在的静态文件（Vite 把 public/ 内容以根路径暴露）
export const publicFileExists = (url: string) => existsSync(join(process.cwd(), 'client', 'public', url));