/** 项目支持的语言白名单（供语言探测 / 路由校验 / 外部引用） */
export const SUPPORTED_LANGUAGES: string[] = ['zh-CN', 'en-US'];

/**
 * 按语言键加载对应翻译 JSON（业务层工具，返回值直接可作模板变量 / 前端 window.I18n）。
 * @param lang 语言码，如 'zh-CN'、'en-US'
 */
export async function loadI18n(lang = 'zh-CN'): Promise<Record<string, unknown>> {
    const mod = await import(`../locales/${lang}.json`, { with: { type: 'json' } });
    return mod.default as Record<string, unknown>;
}

// 下面的为 Node 各版本 兼容写法，Node 18支持直接 import zhCN from './locales/zh-CN.json'，高版本 需要加上 with { type: 'json' }
// import { createRequire } from 'node:module';
// import { readFileSync } from 'node:fs';
// const require = createRequire(import.meta.url);
// const zhCN = JSON.parse(readFileSync(require.resolve('./locales/zh-CN.json'), 'utf8'));
// const enUS = JSON.parse(readFileSync(require.resolve('./locales/en-US.json'), 'utf8'));