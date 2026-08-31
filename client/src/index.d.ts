/**
 * 全局类型声明（纯全局脚本文件，无顶层 import/export）。
 *
 * ⚠️ 注意：本文件绝不能出现顶层 import/export，否则会被 TS 当作模块文件，
 *   内部 interface Window / 全局类型将不会合并进全局作用域，
 *   导致 window.I18n / window.htmx / StringMap 报"不存在属性/找不到名称"。
 *   需要引用 htmx 类型时，用内联 import() 类型查询即可（不会破坏全局性）。
 */

declare type StringMap<T = any> = Record<string, T>;

declare type HTMX = typeof import('htmx.org').default;

declare interface Window {
    /** 客户端 i18n 词条包（服务端注入，供全局 t() 派生） */
    I18n: StringMap;
    /** htmx 实例（bootstrap 里加载后缓存到 window） */
    htmx: HTMX
}


declare const I18n: StringMap;