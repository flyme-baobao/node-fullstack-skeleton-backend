/**
 * 登录注册表单事件层：document事件委托，SPA动态表单无需重复绑定。
 * 职责：只做事件监听 + 错误提示渲染，校验规则全部下沉至 ./validation.ts。
 * 分工：
 *  - HTML原生约束优先，校验失败不会派发submit事件，与JS校验分层；
 *  - validation.ts负责注册input即时校验、登录账号submit校验；
 *  - 注册确认密码在blur失焦做一致性比对，避免输入过程频繁报错；
 *  - API未对接时拦截提交防止404，接口上线移除handleSubmit内TODO兜底。
 * 启动调用 initAuthFormValidation()，模块bound开关保证幂等。
 */

import { signin, signup } from '@/api/auth.api';
import { t } from '@/i18n/translate';
import { userService } from '@service/userService';
import {
    FORM_FIELD_NAME,
    SIGNUP_FIELD_RULES,
    validAccount,
    validConfirmPassword,
} from './validation';

const FORM_TYPE = {
    SIGNIN: 'signin',
    SIGNUP: 'signup',
};

/** 注册成功 → 跳转登录页的倒计时秒数（与 signup.ejs 的 SIGNUP_REDIRECT_SECONDS 对齐） */
const SIGNUP_REDIRECT_SECONDS = 3;


/** 错误提示 <p> 的样式（Tailwind 工具类；本文件在 @source 扫描范围内，类名会被生成） */
const ERROR_TEXT_CLASS = 'mt-1.5 text-sm text-rose-600';
/** 校验失败时给输入框加的高亮描边（utilities 层，可压过 .input 的组件层样式） */
const INVALID_RING_CLASS = 'ring-2 ring-rose-300';
/** 错误提示节点的标记属性（清除时按此查找，避免误删字段块里的静态 hint） */
const ERROR_ATTR = 'data-auth-error';

// document 级监听注册一次就够；重复 init 会叠加监听器，用模块级开关幂等
let bound = false;

export function initAuthFormValidation(): void {
    if (bound) return;
    bound = true;

    // 输入：清错并对注册表单非空字段做即时格式校验
    // 输入：即时格式校验。注意中文输入法的组合阶段（拼音/候选选择）会高频触发 input，
    // 但组合中 value 是未确认的组合稿，此时校验会误报 + 频繁闪错；用 isComposing 跳过，
    // 组合结束后由 compositionend 事件补一次最终校验。
    document.addEventListener('input', (e) => {
        const input = e.target;
        if (!(input instanceof HTMLInputElement)) return;
        if (e.isComposing) return; // 输入法组合中：跳过即时校验
        validateFieldOnInput(input);
    });

    // 中文输入组合结束：input 阶段可能被 isComposing 跳过，这里补一次，确保收尾校验生效
    document.addEventListener('compositionend', (e) => {
        const input = e.target;
        if (!(input instanceof HTMLInputElement)) return;
        validateFieldOnInput(input);
    });

    // confirm_password 一致性 → blur（失焦时再比对，避免输入过程中就报错）
    document.addEventListener('blur', (e) => {
        const input = e.target;
        if (!(input instanceof HTMLInputElement)) return;
        const form = input.form;
        const name = input.name;
        if (form?.dataset.authForm !== FORM_TYPE.SIGNUP || name !== FORM_FIELD_NAME.CONFIRM_PASSWORD) {
            return;
        }
        const passwordInput = form.elements.namedItem(FORM_FIELD_NAME.PASSWORD);
        if (
            passwordInput instanceof HTMLInputElement &&
            !validConfirmPassword(passwordInput.value, input.value)
        ) {
            showFieldError(input, t('auth.validation.password_mismatch'));
        }
    });

    document.addEventListener('submit', handleSubmit);
}

const getFieldValue = (form: HTMLFormElement, name: string) => {
    const input = form.elements.namedItem(name);
    if (input instanceof HTMLInputElement) {
        return input.value;
    }
    return '';
}

function handleSubmit(e: SubmitEvent): void {
    const form = e.target;
    if (!(form instanceof HTMLFormElement) || !form.dataset.authForm) return;

    const errors: Array<{ input: HTMLInputElement; message: string }> = [];

    // signin 账号：按值特征路由到三类之一做正则校验（密码无需重复校验，与 signup 同策略）
    if (form.dataset.authForm === FORM_TYPE.SIGNIN) {
        const account = form.elements.namedItem('account');
        if (account instanceof HTMLInputElement && account.value && !validAccount(account.value)) {
            errors.push({ input: account, message: t('auth.validation.account_invalid') });
        }
    }

    if (errors.length > 0) {
        e.preventDefault();
        errors.forEach(({ input, message }) => showFieldError(input, message));
        errors[0]?.input.focus();
        return;
    }

    
    e.preventDefault();
    const password = getFieldValue(form, 'password');
    if (form.dataset.authForm === FORM_TYPE.SIGNUP) {
        const userName = getFieldValue(form, 'user_name');
        const email = getFieldValue(form, 'email') || null;
        const phoneNumber = getFieldValue(form, 'phone_number') || null;
        signup({ userName, email, phoneNumber, password })
            .then(() => enterSignupSuccessState(form))
            .catch(() => {
                // 非 2xx 已由 httpFetch/errorHandle 弹 toast；这里吞掉 rejection 防未处理告警
            });
    }
    if (form.dataset.authForm === FORM_TYPE.SIGNIN) {
        const account = getFieldValue(form, 'account');
        signin(account, password).then( ({ user, token}) => {
            console.log('signin success user', user);
            userService.setCurrentUser(user!, token);
        });
    }
}

/**
 * 注册成功后就地切换成功态：隐藏表单、显示 signup.ejs 预置的成功卡片并启动倒计时。
 * 文案由 SSR t()（完整语言包）注入，前端不依赖 window.I18n（未登录态拿到的是精简包）。
 */
function enterSignupSuccessState(form: HTMLFormElement): void {
    const success = form.parentElement?.querySelector<HTMLElement>('[data-signup-success]');
    if (!success) return;
    form.hidden = true;
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

/** 注册表单字段的即时格式校验（input / compositionend 共用）。非注册字段仅清错 */
function validateFieldOnInput(input: HTMLInputElement): void {
    const form = input.form;
    const name = input.name;
    if (form?.dataset.authForm !== FORM_TYPE.SIGNUP) {
        // 非注册表单：只清错不动
        clearFieldError(input);
        return;
    }
    const inputValue = input.value;
    if (!inputValue || name === FORM_FIELD_NAME.CONFIRM_PASSWORD) {
        // 空值 / confirm 字段：即时格式校验不适用，先清错（confirm 一致性走 blur）
        clearFieldError(input);
        return;
    }
    const rule = SIGNUP_FIELD_RULES[name];
    if (rule && !rule.validate(inputValue)) {
        showFieldError(input, t(rule.errorKey));
    } else {
        clearFieldError(input);
    }
}

/** 显示（或更新）输入框错误提示。已有提示则复用节点仅改文本，避免每次输入都重建 <p> 造成闪屏 */
function showFieldError(input: HTMLInputElement, message: string): void {
    const fieldBlock = input.closest('div');
    // 幂等：若已存在 data-auth-error，只更新文本，不重复 append（防止 input 事件里 删/建 抖动）
    let tip = fieldBlock?.querySelector(`[${ERROR_ATTR}]`) as HTMLElement | null;
    if (!tip) {
        tip = document.createElement('p');
        tip.className = ERROR_TEXT_CLASS;
        tip.setAttribute(ERROR_ATTR, '');
        fieldBlock?.appendChild(tip);
    }
    tip.textContent = message;

    input.setAttribute('aria-invalid', 'true');
    input.classList.add(INVALID_RING_CLASS);
}

/** 复原输入框失败态并移除其错误提示 */
function clearFieldError(input: HTMLInputElement): void {
    input.closest('div')?.querySelector(`[${ERROR_ATTR}]`)?.remove();
    if (input.getAttribute('aria-invalid') === 'true') {
        input.removeAttribute('aria-invalid');
        input.classList.remove(INVALID_RING_CLASS);
    }
}