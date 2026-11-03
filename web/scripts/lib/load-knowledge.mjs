/**
 * 校验脚本的数据加载器（fs 侧，供 CLI 与 sync-assets 复用）。
 * 纯校验逻辑见 ./validate-knowledge.mjs。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

/** 解析 JSON 文件，失败时抛出带文件路径的 Error。 */
export function readJsonFile(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'))
  } catch (err) {
    throw new Error(`JSON 解析失败：${filePath}（${err.message}）`)
  }
}

/**
 * 加载知识卡：--knowledge 可为单个 .json 文件或目录（读顶层全部 .json 并合并数组）。
 * 返回 { cards, baseDir }；baseDir 供图片 src 相对定位（<baseDir>/assets）。
 * @returns {{cards: Array, baseDir: string}}
 */
export function loadKnowledgeCards(knowledgePath) {
  if (!existsSync(knowledgePath)) throw new Error(`路径不存在：${knowledgePath}`)
  if (!statSync(knowledgePath).isDirectory()) {
    const data = readJsonFile(knowledgePath)
    if (!Array.isArray(data)) throw new Error(`知识卡文件不是数组：${knowledgePath}`)
    return { cards: data, baseDir: path.dirname(knowledgePath) }
  }
  const files = readdirSync(knowledgePath, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.json'))
    .map((e) => e.name)
    .sort()
  if (files.length === 0) throw new Error(`知识目录下没有顶层 .json 文件：${knowledgePath}`)
  const cards = []
  for (const file of files) {
    const data = readJsonFile(path.join(knowledgePath, file))
    if (!Array.isArray(data)) throw new Error(`知识卡文件不是数组：${path.join(knowledgePath, file)}`)
    cards.push(...data)
  }
  return { cards, baseDir: knowledgePath }
}

/** 加载 rig-meta，返回 parts 数组；shape 不对时抛错。 */
export function loadRigMetaParts(rigMetaPath) {
  const data = readJsonFile(rigMetaPath)
  if (!Array.isArray(data?.parts)) throw new Error(`rig-meta 缺少 parts 数组：${rigMetaPath}`)
  return data.parts
}

/**
 * 加载场景目录（顶层全部 .json），每个场景附加 name（文件名去扩展名，供报错展示）。
 * @returns {Array<{name?: string, scene?: string, muscles?: string[], keyframes?: Array}>}
 */
export function loadScenes(scenesDir) {
  if (!existsSync(scenesDir)) throw new Error(`场景目录不存在：${scenesDir}`)
  const files = readdirSync(scenesDir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.json'))
    .map((e) => e.name)
    .sort()
  return files.map((file) => ({
    name: file.replace(/\.json$/, ''),
    ...readJsonFile(path.join(scenesDir, file)),
  }))
}

/**
 * 生成图片 src 存在性检查回调（相对 <knowledgeBaseDir>/assets 解析）。
 * @returns {(src: string) => boolean}
 */
export function makeAssetsExist(baseDir) {
  const assetsDir = path.join(baseDir, 'assets')
  return (src) => existsSync(path.join(assetsDir, src))
}
