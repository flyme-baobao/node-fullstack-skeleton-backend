/**
 * 注册/登录提交流程（策略对象）：每条业务线一个 AuthFlow，
 * 由 index.ts 的 handleSubmit 骨架统一驱动：flow.validate() → 错误渲染/聚焦 → flow.submit()。
 * 职责：取参、调 API、成功后处置；校验规则在 ./validation.ts，错误渲染在 index.ts。
 * 新增表单类型（如找回密码）：在 AUTH_FLOWS 加一个条目即可，index.ts 骨架零改动。
 */

import { signin, signup } from '@/api/auth.api';
import { t } from '@/i18n/translate';
import { userService } from '@service/userService';
import { getCookie, deleteCookie } from '@/utils/cookie';
import { COOKIE_REDIRECT_PATH } from '@/constants/cookie';
import { validAccount } from './validation';

/** data-auth-form 的合法值（与 EJS 模板的 data-auth-form 属性、validation.ts 的口径对齐） */
export type FormKind = 'signin' | 'signup';

/** 补充校验产生的单条错误：由 index.ts 骨架统一渲染与聚焦 */
export interface AuthFieldError {
    input: HTMLInputElement;
    message: string;
}

/** 提交流程契约：index.ts 骨架只认这个接口，不认识任何具体业务线 */
export interface AuthFlow {
    /** submit 阶段的补充校验（signup 无 → 返回空数组；signin 校验账号格式） */
    validate(form: HTMLFormElement): AuthFieldError[];
    /** 校验通过后的提交流程：取参 → 调 API → 成功后处置（内部自带失败兜底） */
    submit(form: HTMLFormElement): void;
}

/** 判别 data-auth-form 是否为已注册的表单类型，收窄出 FormKind 供查表 */
export function isFormKind(value: string | undefined): value is FormKind {
    return value === 'signin' || value === 'signup';
}

const getFieldValue = (form: HTMLFormElement, name: string) => {
    const input = form.elements.namedItem(name);
    if (input instanceof HTMLInputElement) {
        return input.value;
    }
    return '';
};

/** 注册成功 → 跳转登录页的倒计时秒数（与 signup.ejs 的 SIGNUP_REDIRECT_SECONDS 对齐） */
const SIGNUP_REDIRECT_SECONDS = 3;

const signupFlow: AuthFlow = {
    // 注册字段格式已全部由 input 即时校验 + HTML 原生约束兜住，submit 阶段无补充校验
    validate: () => [],
    submit(form) {
        const userName = getFieldValue(form, 'user_name');
        const email = getFieldValue(form, 'email') || null;
        const phoneNumber = getFieldValue(form, 'phone_number') || null;
        const password = getFieldValue(form, 'password');
        signup({ userName, email, phoneNumber, password })
            .then(() => enterSignupSuccessState(form))
            .catch(() => {
                // 非 2xx 已由 httpFetch/errorHandle 弹 toast；这里吞掉 rejection 防未处理告警
            });
    },
};

const signinFlow: AuthFlow = {
    // 账号：按值特征路由到三类之一做正则校验（密码无需重复校验，与 signup 同策略）
    validate(form) {
        const account = form.elements.namedItem('account');
        if (account instanceof HTMLInputElement && account.value && !validAccount(account.value)) {
            return [{ input: account, message: t('auth.validation.account_invalid') }];
        }
        return [];
    },
    submit(form) {
        const account = getFieldValue(form, 'account');
        const password = getFieldValue(form, 'password');
        signin(account, password)
            .then(({ user, token }) => afterSigninSuccess(user, token))
            .catch(() => {
                // 非 2xx 已由 httpFetch/errorHandle 弹 toast；这里吞掉 rejection 防未处理告警
            });
    },
};

/** index.ts 骨架按 data-auth-form 查这张表分发，业务线互不可见 */
export const AUTH_FLOWS: Record<FormKind, AuthFlow> = {
    signup: signupFlow,
    signin: signinFlow,
};

/**
 * 注册成功后就地切换成功态：隐藏表单、显示 signup.ejs 预置的成功卡片并启动倒计时。
 * 文案由 SSR t()（完整语言包）注入，前端不依赖 window.I18n（未登录态拿到的是精简包）。
 */
function enterSignupSuccessState(form: HTMLFormElement): void {
    const success = form.parentElement?.querySelector<HTMLElement>('[data-signup-success]');
    if (!success) return;
    form.hidden = true;
    // 页脚「已有账号？去登录」随表单隐藏：刚注册完无需再引导，且与成功卡片的跳转入口重复
    form.parentElement?.querySelector<HTMLElement>('[data-signup-footer]')?.setAttribute('hidden', '');
    success.hidden = false;
    startSignupCountdown(success);
}

/**
 * 成功卡片倒计时：每秒递减 {{seconds}}；归零后经 history.pushState 跳登录页——
 * pushState 已被 spaRouter 补丁捕获 → loadPageByPath → htmx.ajax GET /page/signin 回填 #root
 * （SPA 无整页刷新，地址栏同步 /signin）。
 */
function startSignupCountdown(success: HTMLElement): void {
    const textEl = success.querySelector<HTMLElement>('[data-countdown-text]');
    const template = textEl?.dataset.countdownTemplate ?? '';
    let seconds = SIGNUP_REDIRECT_SECONDS;
    let timer: number | undefined;

    const render = () => {
        if (textEl) {
            textEl.textContent = template.replace(/\{\{\s*seconds\s*\}\}/g, String(seconds));
        }
    };
    render();

    // 「立即跳转」：只清倒计时，<a> 导航交给 SPA 路由的捕获拦截（内部同样走 htmx.ajax 回填 #root）
    const jump = success.querySelector<HTMLAnchorElement>('[data-signup-jump]');
    jump?.addEventListener('click', () => {
        if (timer !== undefined) clearInterval(timer);
    }, { once: true });

    timer = window.setInterval(() => {
        seconds -= 1;
        if (seconds <= 0) {
            clearInterval(timer);
            // 成功卡片已不在文档里（用户手动导航/后退走了）→ 静默放弃，避免把新页面顶掉
            if (!document.body.contains(success)) return;
            history.pushState({}, '', '/signin');
            return;
        }
        render();
    }, 1000);
}

function afterSigninSuccess(user: UserInfo, token: string): void {
    if (!user || !token) return;
    const path = getCookie(COOKIE_REDIRECT_PATH) || '/';
    // path 必须与写入处（bootstrapFlow 的 setCookie path:'/'）一致，否则删不掉
    deleteCookie(COOKIE_REDIRECT_PATH, { path: '/' });
    window.location.href = path; // 强制刷新页面，确保 SPA 路由正确加载
}
