import i18next from 'i18next';
import type { i18n } from 'i18next';
import { LanguageDetector } from 'i18next-http-middleware';
import zhCN from '../locales/zh-CN.json' with { type: 'json' };
import enUS from '../locales/en-US.json' with { type: 'json' };
import { SUPPORTED_LANGUAGES } from './locales.js';

/**
 * 初始化 i18next（含 LanguageDetector 插件与完整配置）。
 * 需在业务路由使用 req.t / req.i18n 之前 await 完成。
 * @returns 已初始化的 i18next 实例
 */
export async function initI18n(): Promise<i18n> {
    await i18next
        .use(LanguageDetector) // 注册"语言探测器"插件：让 i18next 知道按 detection 规则去探测语言
        .init({

            resources: {                            // resources：静态翻译字典，key = 语言代码，value = 翻译内容对象
                'zh-CN': { translation: zhCN },     // 中文 语言包
                'en-US': { translation: enUS },     // 英文 语言包
            },
            fallbackLng: 'zh-CN',                   // 上面都探测不到 / 语言包缺失时，兜底用的语言
            /**
             * 语言码归一化：
             *  - supportedLngs(保留)：白名单，只允许这两种语言码启用。没有它，i18next 会接受任意语言码
             *    (如 Accept-Language: fr)，写回 lang cookie 会混入脏值；有了它只有 zh-CN/en-US 真正启用。
             *  - nonExplicitSupportedLngs(弃用)：仅配合 supportedLngs 才有意义——允许"无区域语言码"
             *    (如 Accept-Language: zh) 按前缀归一到 zh-CN。但现代浏览器发的是完整码
             *    (Accept-Language: zh-CN,zh;q=0.9)，靠 i18next 默认大小写不敏感匹配已能对上，用不上。
             *
             *  ⚠️ 重要经验(i18next 26.3.6)：supportedLngs 与 nonExplicitSupportedLngs 不可同时开启！
             *    二者突开会嵌套 key 解析失效：整页所有 t('todos.section_hint') 原样返回 key，
             *    req.i18n.exists() === false，即便 getResourceBundle('zh-CN','translation') 结构完全正常
             *    (顶层键 app/nav/hero/validation/todos/confirm 都在)。任一单独开启都正常。
             *    因此本项目保留 supportedLngs，弃用 nonExplicitSupportedLngs。
             */
            supportedLngs: SUPPORTED_LANGUAGES,
            // nonExplicitSupportedLngs: true, // 弃用：勿与 supportedLngs 同时开启，见上方注释
            detection: {
                order: [                          // order：按此优先级依次探测语言来源；排前面的先命中
                    'querystring',
                    'cookie',
                    'header'
                ],
                caches: ['cookie'],               // 一旦确定语言，就写回 cookie，后续 htmx 局部刷新靠它保持语言一致
                lookupCookie: 'lang',             // 探测/写回时，cookie 的名字叫 lang
                lookupQuerystring: 'lang',        // 探测 URL 参数时，参数名也叫 lang
            },
        });

    return i18next;
}