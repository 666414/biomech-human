// 将 pipeline 产物与知识库内容同步到 web/public/data，供前端静态加载。
// 用法：npm run sync-assets（cwd = web/）
import { copyFile, mkdir, readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateKnowledge } from './lib/validate-knowledge.mjs'
import { loadKnowledgeCards, loadRigMetaParts, loadScenes, makeAssetsExist } from './lib/load-knowledge.mjs'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const webRoot = path.resolve(scriptDir, '..')
const repoRoot = path.resolve(webRoot, '..')
const publicData = path.join(webRoot, 'public', 'data')

/** 单文件复制：源不存在则提示跳过；目标目录自动创建。返回复制字节数。 */
async function syncFile(src, destDir, destName) {
  const dest = path.join(destDir, destName)
  if (!existsSync(src)) {
    console.log(`[skip] ${path.relative(repoRoot, src)} 不存在，跳过`)
    return 0
  }
  await mkdir(destDir, { recursive: true })
  await copyFile(src, dest)
  const bytes = (await stat(dest)).size
  console.log(`[ok]   ${path.relative(repoRoot, dest)} (${bytes} bytes)`)
  return bytes
}

/** 目录下全部 *.json（仅顶层，不递归）：目录缺失时打印提示并跳过。 */
async function syncJsonDir(srcDir, destDir) {
  if (!existsSync(srcDir)) {
    console.log(`[skip] ${path.relative(repoRoot, srcDir)} 不存在，跳过该目录`)
    return 0
  }
  const entries = (await readdir(srcDir, { withFileTypes: true })).filter(
    (e) => e.isFile() && e.name.endsWith('.json'),
  )
  if (entries.length === 0) {
    console.log(`[warn] ${path.relative(repoRoot, srcDir)} 下没有顶层 .json 文件`)
  }
  let total = 0
  for (const entry of entries) {
    total += await syncFile(path.join(srcDir, entry.name), destDir, entry.name)
  }
  return total
}

/**
 * 知识目录校验 + 复制（P4 Task 1）：复制前先跑一致性校验，errors 非空 →
 * 打印全部错误并 exit 1（sync 失败即构建失败，防脏数据上线）；
 * knowledge 目录缺失时维持现状 skip。
 */
async function syncKnowledgeDir(srcDir, destDir) {
  if (!existsSync(srcDir)) {
    console.log(`[skip] ${path.relative(repoRoot, srcDir)} 不存在，跳过该目录`)
    return 0
  }
  const rigMetaPath = path.join(publicData, 'models', 'rig-meta.json')
  const scenesDir = path.join(publicData, 'scenes')
  try {
    const { cards, baseDir } = loadKnowledgeCards(srcDir)
    const { ok, errors, warnings, stats } = validateKnowledge({
      cards,
      rigMetaParts: loadRigMetaParts(rigMetaPath),
      scenes: loadScenes(scenesDir),
      assetsExist: makeAssetsExist(baseDir),
    })
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
      console.error(`\n[fail] 知识库校验失败（${errors.length} 个错误），中止同步`)
      process.exit(1)
    }
    console.log(
      `[ok]   知识库校验通过：${stats.cards} 张卡（部位 ${stats.partCards} / 关键帧 ${stats.keyframeCards} / ` +
        `肌肉 ${stats.muscleCards} / 未关联 ${stats.unlinkedCards}），警告 ${warnings.length}`,
    )
  } catch (err) {
    console.error(`[fail] 知识库数据加载失败：${err.message}`)
    process.exit(1)
  }
  return syncJsonDir(srcDir, destDir)
}

let total = 0
total += await syncFile(
  path.join(repoRoot, 'pipeline', 'out', 'fullbody', 'human.glb'),
  path.join(publicData, 'models'),
  'human.glb',
)
total += await syncFile(
  path.join(repoRoot, 'pipeline', 'out', 'fullbody', 'rig-meta.json'),
  path.join(publicData, 'models'),
  'rig-meta.json',
)
total += await syncJsonDir(
  path.join(repoRoot, 'pipeline', 'out', 'scenes'),
  path.join(publicData, 'scenes'),
)
total += await syncKnowledgeDir(
  path.join(repoRoot, 'content', 'knowledge'),
  path.join(publicData, 'knowledge'),
)

console.log(`\n同步完成，共 ${total} bytes`)
