import { fileURLToPath } from 'url'
import path from 'path'
import fs from 'fs'

/**
 * 递归向上查找包含 package.json 的目录 → 项目根目录
 * 兼容传入 文件路径 / 目录路径 两种情况
 * @param {string} startPath 起始查找路径
 * @returns {string} 项目根目录绝对路径
 */
export function findProjectRoot(startPath) {
    let current = path.resolve(startPath)

    if (fs.existsSync(current) && fs.statSync(current).isFile()) {
        current = path.dirname(current)
    }

    while (true) {
        const pkgPath = path.join(current, 'package.json')
        if (fs.existsSync(pkgPath)) {
            return current
        }

        const parent = path.dirname(current)
        if (parent === current) {
            throw new Error('❌ 未找到 package.json，无法定位项目根目录，请确认项目结构')
        }
        current = parent
    }
}

/**
 * 获取当前脚本所在目录
 * @returns {string}
 */
function getScriptDir() {
    const __filename = fileURLToPath(import.meta.url)
    return path.dirname(__filename)
}

/**
 * 获取项目根目录
 * @returns {string}
 */
export function getProjectRoot() {
    const scriptDir = getScriptDir()
    return findProjectRoot(scriptDir)
}

/**
 * 获取 client 前端目录，不修改 process.cwd()
 * @returns {{clientDir: string, rootDir: string}}
 */
export function setupWorkDir() {
    const rootDir = getProjectRoot()
    const clientDir = path.resolve(rootDir, './client')

    if (!fs.existsSync(clientDir)) {
        throw new Error(`❌ 前端目录不存在：${clientDir}`)
    }
    return { clientDir, rootDir }
}

/**
 * 获取命令行入参，剔除 node 和脚本路径
 * @returns {string[]}
 */
export function getCliArgs() {
    return process.argv.slice(2)
}
