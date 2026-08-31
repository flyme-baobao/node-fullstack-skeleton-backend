/**
 * 等价原生命令：vite build
 * 实现：手写 Vite 打包流程、自定义配置合并、命令行参数覆写
 * 配置优先级：命令行传参 > client/vite.config.ts
 */
import { build } from 'vite'
import path from 'path'
import { setupWorkDir, getCliArgs } from './vite-utils.js'

;(async function main() {
  try {
    const { clientDir, rootDir } = setupWorkDir()
    process.chdir(clientDir) // 切换工作区 替代 root设置
    const args = getCliArgs()

    const buildConfig = {
      // root: clientDir,
      build: {
        // 产物输出到项目根目录 dist-client ，不在client内部
        outDir: path.resolve(rootDir, './dist-client'),
        emptyOutDir: true
      },
      mode: 'production'
    }

    for (let i = 0; i < args.length; i++) {
      const arg = args[i]
      if (arg === '--mode' && args[i + 1]) {
        // --mode development（等空分隔）
        buildConfig.mode = args[++i]
      } else if (arg.startsWith('--mode=')) {
        // --mode=development（等号）
        buildConfig.mode = arg.split('=')[1]
      }
    }

    // sourcemap 控制点已移到 client/vite.config.ts：
    // defineConfig(({ mode }) => ...) 里根据 mode 决定 build.sourcemap。
    // 这里的 --mode 仅透传给 ConfigEnv.mode，供 config 函数读取。
    await build(buildConfig)
    console.log(`✅ 打包完成，产物目录：${buildConfig.build.outDir}`)
  } catch (e) {
    console.error('💥打包失败', e)
    process.exit(1)
  }
})()
