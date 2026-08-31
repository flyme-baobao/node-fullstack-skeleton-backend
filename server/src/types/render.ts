/**
 * 渲染配套类型（普通导出模块）。
 *
 * 与全局声明类型的分离：*This* 文件是普通 TS 模块，纯导出可复用的具名类型；
 * 全局的 Express.Request / Response 扩展则放在 types/express.d.ts 中一并声明。
 * 两边通过 `import type` 互相解耦，避免把「类型定义」和「全局环境注入」揉在一起。
 */

/**
 * res.render 的宽松业务 locals（可透传给模板的任意键值）。
 * 与 RenderPageOptions 不同：它只描述「透传数据」，不含渲染专用配置字段。
 */
export type RenderOptions = Record<string, string | number | boolean | object | null | undefined>;

/**
 * 单层布局壳配置（renderPage 的 layouts 数组元素）。
 */
export interface LayoutLayer {
    /** 模板名称，对应 views 下模板 */
    tplName: string;
    /** 接收上一层输出内容的插槽变量名 */
    slotKey: string;
}

/**
 * renderPage 入参选项（结构化配置 payload）。
 */
export interface RenderPageOptions {
    /** 中间布局外壳数组，由内向外执行 */
    layouts?: LayoutLayer[];

    /** 单中间壳模板名 */
    pageShell?: string;
    /** 接收上一层输出内容的插槽变量名 */
    pageShellSlot?: string;

    /** 其余透传给模板的业务 locals */
    [key: string]: any;
}