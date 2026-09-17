import type { Plugin } from 'vite';
import { relative } from 'node:path';

// ============================================================================
// backendReloadPlugin：后端源码/模板变更 → 浏览器整页刷新（full-reload）
// ============================================================================
// 背景（本仓库是 Express SSR + htmx 架构，dev 为双端口）：
//   · 前端 client/src 的改动 → Vite 自己的 watcher 捕获 → HMR / 整页刷新（已生效）
//   · 后端 server/src 的改动 → tsx watch 重启 Express，但 **Vite 对此毫不知情**，
//     浏览器仍停在旧的 SSR 渲染结果上（SSR 页面/接口只能整页刷新，无 HMR）
//   本插件把两者打通：后端一变，浏览器自动刷新到最新渲染结果。
//
// 实现：
//   把 server 源码目录加进 Vite 共用的 chokidar watcher —— 与前端共用同一实例，
//   因此 Docker 下自动继承 server.watch.usePolling 轮询（Windows 绑定挂载事件丢失一并规避）。
//   捕获变更后按类型分流：
//     · .ts 源码   → tsx 会重启进程，需先等 Express 重新监听端口再刷新，
//                    否则刷新请求会打在「重启窗口」上拿到 502；
//                    若后端因编译错误起不来，则放弃刷新并告警（改完再存一次即重试）
//     · 其他文件   → .ejs/.json 等由 Express 每请求直读磁盘、无需重启，防抖后直接刷新
// ============================================================================

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

// TypeScript 源码判定（tsx watch 会因其重启）
const TS_FILE_RE = /\.(?:[cm]?ts)$/;

/**
 * 轮询等待后端 HTTP 端口恢复监听。
 * 关键点：fetch 只要有 **HTTP 响应**（任意状态码，含 404/500）就说明进程已在监听，
 * 只有网络层连不上（ECONNREFUSED 等）才进 catch —— 这正是「是否已重启完成」的判据。
 *
 * @param port           Express 监听端口（SERVER_PORT）
 * @param initialDelayMs 初次探测前的等待，避开 tsx「杀旧进程 → 起新进程」的过渡，免得探到旧进程
 * @param timeoutMs      总超时；超时通常意味着新代码编译失败、进程没起来
 */
async function waitBackendReady(port: number, initialDelayMs: number, timeoutMs: number): Promise<boolean> {
    await sleep(initialDelayMs);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            await fetch(`http://127.0.0.1:${port}/`, { method: 'HEAD', signal: AbortSignal.timeout(1200) });
            return true;
        } catch {
            await sleep(300);
        }
    }
    return false;
}

/**
 * @param serverSrcDir server 源码绝对路径（<root>/server/src），会纳入 Vite watcher 递归监听
 * @param backendPort  Express 端口，用于探测重启是否完成
 */
export function backendReloadPlugin(serverSrcDir: string, backendPort: number): Plugin {
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;

    return {
        name: 'backend-reload',
        apply: 'serve', // 仅 dev server：build 无浏览器连接，也不该干这事
        configureServer(server) {
            // watcher.add 支持目录路径，chokidar 会递归监听其下所有文件
            server.watcher.add(serverSrcDir);

            const reload = (rel: string, reason: string) => {
                server.ws.send({ type: 'full-reload' });
                console.log(`[backend-reload] ${reason}，整页刷新 → ${rel}`);
            };

            // 只监听 change：'add' 事件在 watcher 启动时会为「已存在的文件」逐个触发，
            // 用它会把启动瞬间变成刷新风暴，故不采用（本仓库用 VS Code 原地写盘，change 稳定触发）。
            server.watcher.on('change', async (file) => {
                // 仅处理 server 源码目录内的变更（Vite watcher 同时也在监听 client 等目录）
                const rel = relative(serverSrcDir, file);
                if (!rel || rel.startsWith('..') || rel.includes('node_modules')) return;

                if (TS_FILE_RE.test(rel)) {
                    const ready = await waitBackendReady(backendPort, 500, 20_000);
                    if (ready) reload(rel, '后端重启完成');
                    else
                        console.warn(
                            `[backend-reload] ${rel} 变更后端 20s 内未就绪（多半是编译报错），已跳过自动刷新；修好后保存即会重试`,
                        );
                } else {
                    // 模板/字典等：Express 请求时直读磁盘，无需等重启，防抖后即刷
                    clearTimeout(debounceTimer);
                    debounceTimer = setTimeout(() => reload(rel, '后端模板/资源变更'), 150);
                }
            });
        },
    };
}