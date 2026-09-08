/** 项目支持的语言白名单（供语言探测 / 路由校验 / 外部引用） */
export const SUPPORTED_LANGUAGES: string[] = ['zh-CN', 'en-US'];

type WhitelistItem = string | Record<string, string[]>;

/**
 * 未登录i18n白名单（树形声明）
 * - 字符串：取整个顶层对象，例 'common'
 * - 对象：key为源对象属性，值为需要保留的子key数组 { auth: ['validation','permission'] }
 */
const NOT_LOGIN_WHITELIST: WhitelistItem[] = [
    'common',
    { auth: ['validation', 'permission'] },
    'toast',
];

/**
 * 递归按树形白名单拷贝i18n子集
 * @param source 源完整i18n对象
 * @param allowList 白名单节点：string | Record<string,string[]>
 * @returns 过滤后的对象
 */
function filterI18nByWhitelist(
    source: Record<string, unknown>,
    allowList: WhitelistItem[]
): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    /** 递归处理单个节点 */
    function walk(srcObj: Record<string, unknown>, dstObj: Record<string, unknown>, items: WhitelistItem[]) {
        for (const item of items) {
            if (typeof item === 'string') {
                // 场景1：字符串，直接复制整个key下全部内容
                const val = srcObj[item];
                if (val === undefined) {
                    if (process.env.NODE_ENV !== 'production') {
                        console.warn(`[i18n filter] missing key: ${item}`);
                    }
                    continue;
                }
                // 简单深拷贝，切断引用（i18n纯JSON）
                dstObj[item] = structuredClone(val);
            } else {
                // 场景2：对象 { auth: ['validation','permission'] }
                for (const [parentKey, childKeys] of Object.entries(item)) {
                    const parentSrc = srcObj[parentKey];
                    if (parentSrc == null || typeof parentSrc !== 'object') {
                        if (process.env.NODE_ENV !== 'production') {
                            console.warn(`[i18n filter] missing parent key: ${parentKey}`);
                        }
                        continue;
                    }
                    // 目标创建父节点容器
                    dstObj[parentKey] = {};
                    const parentDst = dstObj[parentKey] as Record<string, unknown>;
                    const src = parentSrc as Record<string, unknown>;

                    for (const child of childKeys) {
                        const childVal = src[child];
                        if (childVal === undefined) {
                            if (process.env.NODE_ENV !== 'production') {
                                console.warn(`[i18n filter] missing key ${parentKey}.${child}`);
                            }
                            continue;
                        }
                        parentDst[child] = structuredClone(childVal);
                    }
                }
            }
        }
    }

    walk(source, result, allowList);
    return result;
}


/**
 * 按语言键加载对应翻译 JSON（业务层工具，返回值直接可作模板变量 / 前端 window.I18n）。
 * @param lang 语言码，如 'zh-CN'、'en-US'
 * @param isLogin 是否登录；false 将按白名单过滤返回子集
 */
export async function loadI18n(lang = 'zh-CN', isLogin = false): Promise<Record<string, unknown>> {
    const url = `../locales/${lang}.json`;
    const mod = await import(url, { with: { type: 'json' } });
    const fullI18n = mod.default as Record<string, unknown>;
    if (!isLogin) {
        return filterI18nByWhitelist(fullI18n, NOT_LOGIN_WHITELIST);
    }
    return fullI18n;
}

// 下面的为 Node 各版本 兼容写法，Node 18支持直接 import zhCN from './locales/zh-CN.json'，高版本 需要加上 with { type: 'json' }
// import { createRequire } from 'node:module';
// import { readFileSync } from 'node:fs';
// const require = createRequire(import.meta.url);
// const zhCN = JSON.parse(readFileSync(require.resolve('./locales/zh-CN.json'), 'utf8'));
// const enUS = JSON.parse(readFileSync(require.resolve('./locales/en-US.json'), 'utf8'));