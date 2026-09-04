import dotenv from 'dotenv';
import { defineConfig, type ProxyOptions } from 'vite';
import { fileURLToPath } from 'url';
import path from 'path';
import tailwindcss from '@tailwindcss/vite';

// 常量(扩展名分组/大正则)与工具函数(public 静态检测)分别独立，keep vite.config.ts 干净
// import { ASSET_EXT_RE } from './vite.constants.ts';
// import { publicFileExists } from './vite.utils.ts';

// NODE_ENV 由【进程环境】决定（docker/cli 注入），不从 .env 读
const isProd = process.env.NODE_ENV === 'production';

if (!isProd) {
    // 相对路径会因 dev/build 脚本 chdir 到 client/ 而失效，必须基于本文件位置定位根目录
    const configDir = path.dirname(fileURLToPath(import.meta.url));
    // 开发环境：读取 .env，加载到 process.env，不覆盖 已有的环境变量（例如 docker-compose.yml 注入的），避免覆盖掉 compose 注入的端口等配置
    dotenv.config({ path: path.resolve(configDir, '../.env.development'), override: false });
}
// env 驱动端口：VITE_PORT(前端默认5173)、 SERVER_PORT(代理目标/后端默认3006)
const vitePort = Number(process.env.VITE_PORT) || 5173;
const serverPort = Number(process.env.SERVER_PORT) || 3006;

let reqId = 0; // 用于给每个请求分配唯一 id，便于日志追踪

const createProxyConfig = (): ProxyOptions => ({ 
    target: `http://localhost:${serverPort}`, 
    changeOrigin: true, 
    configure(proxy) {
        // 代理发生错误时打印
        proxy.on('error', (err, req, res) => {
            console.error('【代理错误】URL:', req.url, 'err:', err.message);
        });
        // 打印转发出去的真实路径
        proxy.on('proxyReq', (proxyReq, req) => {
            console.log('转发', req.method, req.url, '→', proxyReq.path);
        });
    } 
})

// 该项目的角色：为服务端渲染的 Express 应用编译前端资源（htmx 入口、CSS）
// - dev: 独立 dev server（双端口），把「SSR 页面路由」代理到 Express 后端，前端模块交给 Vite transform
// - build: 产出带 contenthash 的产物，由 Vite 生成的 index.html 自引（纯 SPA 架构，后端只做静态托管）
//   · JS → dist-client/js/[name].[hash].js（entryFileNames）
//   · CSS → dist-client/assets/style.[hash].css（cssCodeSplit:false + assetFileNames 归入 assets）

// defineConfig 支持函数形式，Vite 会回调 { mode, command }（ConfigEnv）。
// 构建时脚本 scripts/build-client.js 传入的 --mode 会作为这里的 mode，
// 因此源 sourcemap 等可按构建模式动态控制。
export default defineConfig(({ mode }) => {
    const isProdMode = mode === 'production';
    return {
        plugins: [tailwindcss()],
        appType: 'spa',
        // 静态资源目录：Vite dev（middleware 模式）与 build 都会把它暴露/复制到站点根路径 /。
        // 开发模式双端口：
        //   - Vite 监听 VITE_PORT，是浏览器唯一入口
        //   - '/' 代理把「页面 / 片段 / API」SSR 路由转发到 Express(SERVER_PORT)
        //   - bypass 语义（Vite 源码确认）：返回「原 url 字符串」= 交给 Vite 中间件 transform；返回 undefined = 代理到后端；返回 false = 直接 404（勿用）
        server: {
            port: vitePort,
            proxy: {
                // '/': {
                //     target: `http://localhost:${serverPort}`,
                //     changeOrigin: true,
                //     // 属于 Vite 的模块资源：返回原 url 字符串 → 交由 Vite transform / HMR
                //     // 其余 SSR 页面路由：返回 undefined → 转发到 Express 后端
                //     bypass(req) {
                //         const url = (req.url ?? '').split('?')[0];
                //         console.log(`[vite.proxy.bypass] reqId=${++reqId} url=${url}`);
                //         // Vite 应处理的路径判定（前缀 / 扩展名 / 存在的 public 静态文件）：
                //         //   - 前缀：Vite 虚拟模块(@vite/@fs/@id…)、依赖预构建、前端源码树
                //         //   - 扩展名：源码及其 import 引用的同目录资源（图片/字体/map/worker…）
                //         //   - public/ 静态资源：内容以根路径暴露，fs 存在则交给 Vite
                //         // 其余（SSR 页面路由 /、/list、/todos、/api/*…）代理给 Express 后端


                //         const isVitePath =
                //             url.startsWith('/@vite') ||
                //             url.startsWith('/@fs/') ||
                //             url.startsWith('/@id/') ||
                //             url.startsWith('/@react-refresh') ||
                //             url.startsWith('/node_modules/') ||
                //             url.startsWith('/client/src/') ||
                //             ASSET_EXT_RE.test(url);
                //         const isPublicAsset = !isVitePath && url !== '/' && publicFileExists(url);
                //         if (isVitePath || isPublicAsset) return url; // 交给 Vite

                //         // 目前 只提供 /page/*、/api/* 代理给后端，其他全部交给 Vite, 上面的先注释
                //         if (url.startsWith('/api') || url.startsWith('/page')) { // 交给 Express SSR 后端
                //             // /api/* /page/* 由后端处理，返回 undefined → 代理到后端
                //             return undefined;
                //         }
                //         return url; // 交给 Vite
                //     },
                // },
                '/api': createProxyConfig(),
                '/page': createProxyConfig(),
            },
        },
        build: {
            sourcemap: !isProdMode,   // production  无 map，其余有 map
            emptyOutDir: true,
            // 关闭 css code-split，让样式汇总为单一 style 文件，由 Vite 生成的 index.html <link> 引用
            cssCodeSplit: false,
            rollupOptions: {
                // 以 index.html 为 HTML 入口（Vite 自动解析其中 <script src="/src/main.ts"> 作 JS 入口），
                // 产物才会正确输出 index.html + js/ + assets/。
                // ⚠️ 不能改成 'src/main.ts'：那样会丢掉 HTML 壳（index.html 不进产物，express.static 无壳可回退）。
                // input 默认就是 index.html，显式写出以免误删。
                input: 'index.html',
                output: {
                    // 产物布局：JS 进 js/，CSS 等资源进 assets/
                    // 统一采用 [name].[hash] 命名，contenthash 由内容决定，利于浏览器长期缓存；
                    // 文件名不必写死，由 Vite 生成的 index.html 内 <script>/<link> 自动引用。
                    // manualChunks 把 node_modules 里的依赖按库名归入手动 vendor chunk：
                    //   axios→axios-vendor / htmx→htmx-vendor / 其余→common-vendor
                    // 归入手动 chunk 的模块会被合并成具名 chunk（走 chunkFileNames），
                    // 并在 index.html 里以独立 <script> 静态引用（不再按需动态加载）。
                    entryFileNames: 'js/[name].[hash].js',
                    chunkFileNames: 'js/[name].[hash].js',
                    assetFileNames: 'assets/[name].[hash].[ext]',
                    manualChunks(id) {
                        if (id.includes('node_modules')) {
                            if (id.includes('axios')) return 'axios-vendor';
                            if (id.includes('htmx')) return 'htmx-vendor';
                            return 'common-vendor';
                        }
                    }
                },
            },
        },
        resolve: {
            alias: {
                '@': path.resolve(__dirname, './src'),
                '@api': path.resolve(__dirname, './src/api'),
                '@components': path.resolve(__dirname, './src/components'),
                '@constants': path.resolve(__dirname, './src/constants'),
                '@i18n': path.resolve(__dirname, './src/i18n'),
                '@router': path.resolve(__dirname, './src/router'), 
                '@templates': path.resolve(__dirname, './src/templates'),
                '@utils': path.resolve(__dirname, './src/utils'),
            },
        },
    };
});