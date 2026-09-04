/**
 * 表单校验统一出口：供 bootstrap 一次性加载挂载。
 *  - initAuthFormValidation：认证表单（登录/注册）校验事件层（document 级委托）；
 *  - initNativeValidity：原生 required 气泡文案覆盖（data-required-msg）。
 * 两者均为 document 级委托 + bound 幂等，SPA/hhtmx swap 进来的动态表单自动生效。
 */
export { initAuthFormValidation } from './authForm';
export { initNativeValidity } from './nativeValidity';