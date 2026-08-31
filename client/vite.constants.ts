// 本项目 Vite 相关常量，独立成文件以保持 vite.config.ts 干净。
// 仅放「纯常量」；函数（如 publicFileExists）请放到 vite.utils.ts。
// 供 vite.config.ts 的 server.proxy.bypass 分流判断使用。

// ---- 扩展名分组：按类别归类，便于阅读 / 增补 ----
// 样式（CSS 预处理器 + 基础样式）
const STYLE_EXT = ['css', 'scss', 'sass', 'less', 'styl'];
// 代码 / 脚本 / 单文件组件
const CODE_EXT = ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'vue', 'svelte'];
// 图片（含 ico、bmp）
const IMAGE_EXT = ['svg', 'png', 'jpe?g', 'gif', 'webp', 'avif', 'bmp', 'ico'];
// 字体
const FONT_EXT = ['woff2?', 'ttf', 'otf', 'eot'];
// 音视频
const MEDIA_EXT = ['mp4', 'webm', 'mp3', 'wav', 'ogg'];
// 数据 / 结构 / 程序
const DATA_EXT = ['map', 'json', 'xml', 'wasm'];
// 文档
const DOC_EXT = ['pdf', 'txt', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'csv', 'md'];

// 组装为 Asset 扩展名大正则；忽略大小写；
//   \\.      = 字面量点号（new RegExp 传字符串，反斜杠要多写一层，字符串 \\ 解码成正则 \.）
//             作用：把"图片名 foo"和"扩展名 png"分隔开的那个小圆点
//   (?:...)  = 非捕获分组：只用来把下面一大串扩展名"框成一个整体"，让结尾的 $ 对整个列表生效
//              不捕获 = 不记录"具体匹配到了哪个扩展名"，因为我们只关心"是不是扩展名结尾"
//   () vs (?:)：匹配结果完全一样，差别只在捕获。() 会把这段匹配到的内容编成"组1"存起来，
//              之后可用 match[1] / $1 取回；(?:) 不编号不存，取不到。这里只 test() 不取值→用 ?: 更省。
//   ?        = 量词，修饰它【前面的单个字符】"出现 0 或 1 次"：
//              jpe?g 里的 e? = 前面的 e 可有可无 → 同时匹配 jpg/jpeg
//              woff2? 里的 2? = 前面的 2 可有可无 → 同时匹配 woff/woff2
//   ${...join('|')} = 把上面 7 个扩展名数组拼成 css|scss|...|md 的"或"选择列表
//   $        = 锚定到字符串结尾，保证必须是"某些扩展名收尾"，避免 ...md 之类半截误命中
//   'i'      = 忽略大小写，.PNG / .png 都算
export const ASSET_EXT_RE = new RegExp(
    `\\.(?:${['html', ...STYLE_EXT, ...CODE_EXT, ...IMAGE_EXT, ...FONT_EXT, ...MEDIA_EXT, ...DATA_EXT, ...DOC_EXT].join('|')})$`,
    'i',
);