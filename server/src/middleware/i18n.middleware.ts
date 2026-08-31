import i18next from 'i18next';
import { handle as i18nHandle } from 'i18next-http-middleware';
import type { Request, Response, NextFunction } from 'express';

/**
 * 每请求解析语言，挂 req.t() / req.i18n。需在 initI18n() 完成后挂载。
 * （req 上的 language / i18n / t 已由 i18next-http-middleware 的类型声明
 *  通过 declare global 补齐到 Express.Request，无需自定义接口。）
 */
export function i18nRequest() {
    return i18nHandle(i18next);
}

/**
 * 请求级桥接：把 req.t 接到 res.locals。
 * EJS 模板（含 partials）才能直接用 <%= t('...') %>，并暴露 currentLocale。
 */
export function localeBridge(req: Request, res: Response, next: NextFunction): void {
    res.locals.t = req.t; // 模板里的 t 即当前请求语言的翻译函数
    res.locals.currentLocale = req.language || 'zh-CN'; // html lang 等场景需要
    next();
}