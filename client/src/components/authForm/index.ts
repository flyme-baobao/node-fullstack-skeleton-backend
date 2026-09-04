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
import { t } from '../../i18n/i18n';
import {
    FORM_FIELD_NAME,
    SIGNUP_FIELD_RULES,
    validAccount,
    validConfirmPassword,
} from './validation';

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
    document.addEventListener('input', (e) => {
        const input = e.target;
        if (!(input instanceof HTMLInputElement)) return;
        const form = input.form;
        if (form?.dataset.authForm !== 'signup') {
            // 非注册表单：只清错不动
            clearFieldError(input);
            return;
        }
        const name = input.name;
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
    });

    // confirm_password 一致性 → blur（失焦时再比对，避免输入过程中就报错）
    document.addEventListener('blur', (e) => {
        const input = e.target;
        if (!(input instanceof HTMLInputElement)) return;
        const form = input.form;
        const name = input.name;
        if (form?.dataset.authForm !== 'signup' || name !== FORM_FIELD_NAME.CONFIRM_PASSWORD) {
            return;
        }
        const passwordInput = form.elements.namedItem(FORM_FIELD_NAME.PASSWORD);
        if (
            passwordInput instanceof HTMLInputElement &&
            !validConfirmPassword(passwordInput.value, input.value)
        ) {
            showFieldError(input, t('auth.password_mismatch'));
        }
    });

    document.addEventListener('submit', handleSubmit);
}

function handleSubmit(e: SubmitEvent): void {
    const form = e.target;
    if (!(form instanceof HTMLFormElement) || !form.dataset.authForm) return;

    const errors: Array<{ input: HTMLInputElement; message: string }> = [];

    // signin 账号：按值特征路由到三类之一做正则校验（密码无需重复校验，与 signup 同策略）
    if (form.dataset.authForm === 'signin') {
        const account = form.elements.namedItem('account');
        if (account instanceof HTMLInputElement && account.value && !validAccount(account.value)) {
            errors.push({ input: account, message: t('auth.account_invalid') });
        }
    }

    if (errors.length > 0) {
        e.preventDefault();
        errors.forEach(({ input, message }) => showFieldError(input, message));
        errors[0]?.input.focus();
        return;
    }

    // TODO: (鉴权 API 接线)：删除本兜底，改为提交到 POST /api/auth/signin|signup
    e.preventDefault();
    console.info('[authForm] 客户端校验通过；鉴权 API 未接线，暂不提交');
}

/** 在输入框所在字段块末尾插入错误提示，并给输入框打失败态（aria-invalid + 描边） */
function showFieldError(input: HTMLInputElement, message: string): void {
    clearFieldError(input); // 先清旧提示，防重复叠加
    const tip = document.createElement('p');
    tip.className = ERROR_TEXT_CLASS;
    tip.setAttribute(ERROR_ATTR, '');
    tip.textContent = message;
    input.closest('div')?.appendChild(tip);

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