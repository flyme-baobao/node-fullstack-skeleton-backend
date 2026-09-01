/**
 * 前端模板按需加载模块（与 templates/*.html 就近内聚）。
 *
 * 模板以独立 .html 文件维护在 client/src/templates/。加载时不再预制任何 <template>，
 * 由业务方通过 loadTemplate(id) 按需取用：
 *   - 首次调用：动态 import() 对应 html（Vite 按模板拆成独立 chunk，首次用到才请求）
 *   - 已加载：从缓存 / DOM 命中 <template> 直接返回，业务方 cloneNode 渲染
 *
 * 相比「启动时一次性注册」，首屏 bundle 更小，只有真正用到某个模板才拉取。
 * 副作用进阶：不再需要 main.ts 里 import './templates'。
 */

/** 注册成 <template> 的 DOM id → 模板文件名 */
const TEMPLATE_FILE_BY_ID = {
    'toast-template': 'toast.html',
    'confirm-template': 'confirm.html',
    'loading-template': 'loading.html',
} as const;

export type TemplateId = keyof typeof TEMPLATE_FILE_BY_ID;

/** Vite 惰性 glob：path → () => Promise<原始 HTML 字符串>，按需 import（非 eager） */
const rawTemplates = import.meta.glob('./*.html', {
    query: '?raw',
    import: 'default',
}) as Record<string, () => Promise<string>>;

/** 已注册 <template> 缓存，避免重复查 DOM */
const registered = new Map<string, HTMLTemplateElement>();

/**
 * 按需加载模板：确保该 id 对应的 <template> 已注册到 body 并返回它。
 * 首次调用会动态 import 对应 html（独立 chunk），之后命中缓存/DOM。
 * @param id 模板 DOM id，如 'toast-template' / 'confirm-template'
 */
export async function loadTemplate(id: TemplateId): Promise<HTMLTemplateElement> {
    // 已注册则直接返回（先缓存、再回退 DOM 查询）
    const existing = registered.get(id) ?? document.getElementById(id);
    if (existing instanceof HTMLTemplateElement) return existing;

    const file = TEMPLATE_FILE_BY_ID[id];
    const load = rawTemplates[`./${file}`];
    if (!load) throw new Error(`Unknown template: "${id}"`);

    const html = await load();
    const tpl = document.createElement('template');
    tpl.id = id;
    tpl.innerHTML = html;

    document.body.appendChild(tpl);
    registered.set(id, tpl);
    return tpl;
}

/** 读取已注册模板，未注册时返回 null（同步场景用） */
export function getRegisteredTemplate(id: TemplateId): HTMLTemplateElement | null {
    return registered.get(id) ?? null;
}