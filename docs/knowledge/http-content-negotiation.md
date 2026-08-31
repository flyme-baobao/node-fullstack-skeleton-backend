# HTTP 内容协商：根据请求意图决定响应形态

服务端经常需要根据**请求方的意图**决定响应形态（HTML 页面 / htmx 片段 / JSON）。HTTP 提供了一组请求头（`Accept`、`HX-Request` 等）来表达这种意图，服务端据此「协商」出最合适的响应。本文件记录这套判定依据的来龙去脉，供各中间件与后续维护参考。

## 一、核心：三个可用的判定信号

### 1. `Accept` 头 —— 浏览器导航自动携带（内置行为）

浏览器在**地址栏输入 URL 回车 / 刷新 / 点击 `<a>` 链接**时，会自动给请求加上一组偏向 HTML 的 `Accept` 头，例如：

```
Accept: text/html,application/xhtml+xml,application/xml;q=0.9,...,*/*;q=0.8
```

关键点：

- 这是**浏览器内置行为**，与后端代码无关；后端**从不主动设置**它，只是「读取」它来判断客户端意图。
- 其中 `text/html` 与 `application/xhtml+xml` 是「我想要一个页面」的标志。
- `q=`（质量权重）表示优先级，值越大越优先；`*/*;q=0.8` 是兜底。对判定只需看是否 `includes('text/html')` 即可，不必拆 q 值。
- **fetch / curl / 第三方 API** 默认通常不带 `text/html`（curl 默认 `Accept: */*`），因此它们走 JSON 分支。

### 2. `HX-Request` 头 —— htmx 事务

htmx 发起的任何请求（含 `htmx.ajax()`）都会自动带上 `HX-Request` 头。因此**判断 htmx 事务只需看这个头**，不要依赖 `Accept`，因为 htmx 默认也发的是 XHR 风格的普通头。

### 3. `X-Requested-With` 头 —— 传统 AJAX（可选，jQuery/部分框架）

非 jQuery 框架通常用 `X-Requested-With: XMLHttpRequest` 标记 AJAX。本项目主要基于 htmx，故以 `HX-Request` 为准，此头仅作背景。

## 二、一套组合判定范式（推荐契约）

```
要 HTML 形态（文本片段/页面）  = HX-Request 存在  OR  Accept 含 text/html|xhtml+xml
要 JSON（fetch / API / curl）   = 以上都不满足
```

代码形态（各中间件可统一遵循）：

```ts
function wantsHtml(req): boolean {
    return req.isHXRequest || prefersHtml(req);
}
function prefersHtml(req): boolean {
    const accept = String(req.headers.accept ?? '');
    return accept.includes('text/html') || accept.includes('application/xhtml+xml');
}
```

两个函数语义分离：

- `wantsHtml` —— 整体意图：htmx 事务 **或** 浏览器导航都要 HTML。
- `prefersHtml` —— 只看 `Accept`，不含 htmx 判定，单纯判断「浏览器导航型请求」。

## 三、各处如何消费这套判定

| 场景 | 判断 | 依据 | 产物 |
|---|---|---|---|
| 渲染整页 | `prefersHtml` (Accept 含 text/html) | 浏览器导航 | HTML 页面 |
| htmx 局部刷新 | `req.isHXRequest` | htmx 事务 | 片段 |
| 出错响应 | `wantsHtml` = 两者之一 | 任一 | 纯文本片段 vs JSON |
| SPA 深链兜底 | method + 前缀 + 扩展名（粗判） | 非 /api、/page、无扩展名的 GET | index.html |

> 补充：SPA 兜底目前用「method + 前缀 + 扩展名」粗判导航，已覆盖主要路径；
> 若未来想更精确地区分「浏览器导航 vs fetch/API」，可在此基础上补上对 `Accept` 含 `text/html` 的判定。

## 四、为什么响应要区分形态

- 浏览器导航 / 刷新中我们直接把翻译好的文案作为**纯文本片段**返回，方便接入页面。
- htmx 默认把响应 body 当 DOM 片段，无法读 JSON，因此错误信息通过响应头（如 `X-Error-Key`/`X-Error-Code`）透出，供 `responseError` 读取。
- fetch / API 调用方拿到 **JSON** + 原始 i18n `messageKey`，自行做本地化或路由判断。

遇到「同样的路径，浏览器和 curl 返回形态不同」时，不必视为 bug——这正是本套 `Accept`/`HX-Request` 内容协商的正常表现。

---

> 说明：浏览器「自动加 Accept」只在**导航**时发生。fetch/curl 即使不指定 `Accept`，默认值也不同（`*/*`），因此形态自然区分。