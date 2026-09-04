/**
 * 覆盖浏览器原生 required 校验气泡文案：统一入口，替代每个 input 上重复的
 * data-required + oninvalid + oninput 内联样板。
 *
 * 用法：required 输入框只需声明一个数据属性（文案由服务端 t() 注入）：
 *   <input ... required data-required-msg="<%= t('auth.validation.username_required') %>" />
 *
 * 原理：
 *  - invalid 事件不冒泡，须在 document 捕获阶段监听，才能接到任意嵌套深度的表单字段；
 *  - 命中 valueMissing（必填但为空）且有 data-required-msg 时，setCustomValidity 覆盖气泡文案；
 *  - input 时清空自定义校验消息，否则自定义消息残留会让字段永久处于 customError，永远校验不过。
 *
 * document 级委托 + bound 开关幂等，SPA/hhtmx swap 进来的动态表单同样生效，
 * 无需在 htmx:afterSwap 里重复初始化。
 */

let bound = false;

export function initNativeValidity(): void {
    if (bound) return;
    bound = true;

    // 捕获阶段监听 invalid（该事件不冒泡）：提交时浏览器触发原生校验，命中必填即覆盖文案
    document.addEventListener(
        'invalid',
        (e) => {
            const input = e.target;
            if (!(input instanceof HTMLInputElement)) return;
            const message = input.dataset.requiredMsg;
            if (message && input.validity.valueMissing) {
                input.setCustomValidity(message);
            }
        },
        true,
    );

    // 输入即清除自定义消息：让原生约束重新评估，避免 customError 残留把字段锁死
    document.addEventListener('input', (e) => {
        const input = e.target;
        if (!(input instanceof HTMLInputElement)) return;
        if (input.dataset.requiredMsg) {
            input.setCustomValidity('');
        }
    });
}