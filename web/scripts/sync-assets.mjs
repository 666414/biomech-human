// 将 pipeline 产物与知识库内容同步到 web/public/data，供前端静态加载。
// 用法：npm run sync-assets（cwd = web/）
import { copyFile, mkdir, readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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
total += await syncJsonDir(
  path.join(repoRoot, 'content', 'knowledge'),
  path.join(publicData, 'knowledge'),
)

console.log(`\n同步完成，共 ${total} bytes`)
