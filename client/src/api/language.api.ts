import { showToast, ToastVariant } from '@components/toast';
import { t } from '@/i18n/translate';
import { API_PREFIX } from '@constants/api';
import { httpFetch } from './httpFetch';

/**
 * 拉取「当前语言」的语言包并注入 window.I18n（纯 SPA 首屏用）。
 * shell(index.html) 是 Vite 输出的静态文件，无法像旧 SSR 那样由服务端模板注入语言包；
 * 页面正文文案由服务端 EJS 渲染，此处只服务前端 JS 内的 t()（如 toast）。
 */
export const initLanguagePack = async (): Promise<void> => {
    try {
        const data = await httpFetch<{
            lang: string;
            i18nJson?: StringMap;
        }>(`${API_PREFIX}/i18n`);
        if (data.i18nJson) {
            window.I18n = data.i18nJson;
            document.documentElement.lang = data.lang;
        }
    } catch (error) {
        console.error('获取当前语言包失败', error);
    }
}

export const changeLanguage = async (lang: string): Promise<void> => {
    try {
        const data = await httpFetch<{
            i18nJson?: StringMap;
            isSuccess?: boolean;
        }>(`${API_PREFIX}/change-language`, {
            method: 'POST',
            data: { lang },
        });
        // 重新赋值全局文案（供后续直接用，/body 刷新会重绘 DOM 再以此为准）
        if (data.isSuccess && data.i18nJson) {
            window.I18n = data.i18nJson;
        }
    } catch (error) {
        console.error('切换语言失败', error);
    }
}