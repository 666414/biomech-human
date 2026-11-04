#!/usr/bin/env node
// 知识库构建期一致性校验 CLI（P4 Task 1）。
// 用法（cwd = web/）：
//   node scripts/validate-knowledge.mjs --knowledge ../content/knowledge \
//     --rigmeta public/data/models/rig-meta.json --scenes public/data/scenes
// 退出码：0 通过 ｜ 1 校验错误 ｜ 2 用法/路径缺失
import { existsSync } from 'node:fs'
import path from 'node:path'
import { validateKnowledge } from './lib/validate-knowledge.mjs'
import { loadKnowledgeCards, loadRigMetaParts, loadScenes, makeAssetsExist } from './lib/load-knowledge.mjs'

const USAGE = `用法：node scripts/validate-knowledge.mjs
  --knowledge <dir|file>   知识卡目录（顶层 .json 数组）或单个 .json 文件
  --rigmeta <file>         rig-meta.json（模型部件 id 集合来源）
  --scenes <dir>           场景目录（顶层 .json，含 keyframes/muscles）`

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]
    if (!key.startsWith('--') || i + 1 >= argv.length) return null
    args[key.slice(2)] = argv[i + 1]
  }
  return args
}

const parsed = parseArgs(process.argv.slice(2))
if (parsed === null || !parsed.knowledge || !parsed.rigmeta || !parsed.scenes) {
  console.error(USAGE)
  const missing = ['knowledge', 'rigmeta', 'scenes'].filter((k) => !parsed || !parsed[k])
  if (parsed !== null) console.error(`缺少参数：${missing.map((k) => `--${k}`).join(' ')}`)
  process.exit(2)
}

// 路径缺失 → 明确报错 exit 2
const notExist = [parsed.knowledge, parsed.rigmeta, parsed.scenes].filter((p) => !existsSync(p))
if (notExist.length > 0) {
  console.error(`路径不存在：\n${notExist.map((p) => `  ${path.resolve(p)}`).join('\n')}`)
  process.exit(2)
}

let cards
let rigMetaParts
let scenes
let assetsExist
try {
  const { cards: loadedCards, baseDir } = loadKnowledgeCards(parsed.knowledge)
  cards = loadedCards
  rigMetaParts = loadRigMetaParts(parsed.rigmeta)
  scenes = loadScenes(parsed.scenes)
  assetsExist = makeAssetsExist(baseDir)
} catch (err) {
  console.error(`数据加载失败：${err.message}`)
  process.exit(2)
}

const { ok, errors, warnings, stats } = validateKnowledge({ cards, rigMetaParts, scenes, assetsExist })

for (const w of warnings) {
  // 卡定位由 message 内的 tag（卡 "id" / 第 N 张卡）承载，where 只补场景，避免输出重复卡名
  const where = w.scene ? ` ${w.scene}` : ''
  console.warn(`[warn] [${w.code}]${where} ${w.message}`)
}

if (!ok) {
  for (const e of errors) {
    const where = e.scene ? ` ${e.scene}` : ''
    console.error(`[error] [${e.code}]${where} ${e.message}`)
  }
  console.error(`\n知识库校验失败：${errors.length} 个错误，${warnings.length} 个警告`)
  process.exit(1)
}

console.log(
  `知识库校验通过：${stats.cards} 张卡（部位卡 ${stats.partCards}，关键帧卡 ${stats.keyframeCards}，` +
    `肌肉卡 ${stats.muscleCards}，未关联 ${stats.unlinkedCards}），场景 ${stats.scenes} / 关键帧 ${stats.keyframes}，` +
    `警告 ${warnings.length}`,
)
process.exit(0)
