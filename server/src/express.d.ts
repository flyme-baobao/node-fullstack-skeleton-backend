/**
 * Express 全局类型声明（环境级 .d.ts，不是模块）。
 *
 * 文件位置说明：放在 server/src 根（与应用入口同名目录），因为它属于
 * 「对整个服务端生效的全局类型环境」，而非某个业务模块——由 tsconfig
 * include 自动拾取，任何文件都不需要显式 import 它。
 *
 * 职责单一：把自定义类型合并进 Express 命名空间。
 * 渲染配套的具名类型（RenderOptions / LayoutLayer / RenderPageOptions）
 * 作为普通模块放在 server/src/types/render.ts，此处通过 `import type` 引用，
 * 避免重复定义，也不把「类型定义」和「全局环境注入」揉在同一文件。
 */
import type { RenderPageOptions } from './types/render.js';

declare global {
    namespace Express {
        interface Request {
            /** 是否存在 hx-request 请求头（原始 header 状态） */
            isHXRequest: boolean;
            /** 是否存在 hx-history-restore-request 请求头（原始 header 状态） */
            isHistoryRestore: boolean;
            /** 衍生标记：有效的 htmx 片段请求，排除历史恢复回退场景 */
            isFragment: boolean;
            /** 当前请求唯一标识（requestId 中间件生成，回写 X-Request-Id） */
            requestId: string;
            /** 用户时区（userContext 中间件读 browser_tz cookie，非法/缺失回落 UTC） */
            userTimeZone: string;
            /** 用户语言（userContext 中间件代理 req.language，i18next 探测结果） */
            userLocale: string;
            /**
             * 当前登录用户id（userContext 中间件从 session / token / cookie 解析，未登录可为 undefined）
             */
            userId?: string;
        }

        interface Response {
            /**
             * 判断本次渲染是否应当输出片段（关闭 layout）。
             * @param viewName 待渲染模板名称
             */
            isFragmentRequest(viewName: string): boolean;
            /**
             * 一次性完成「内容 -> 多个壳」多层嵌套渲染（如 app-layout 应用外壳注入 fragment），
             * 由 middleware/render.middleware.ts 挂载到 res。
             */
            renderPage(pageView: string, options: RenderPageOptions): Promise<void>;
        }
    }
}