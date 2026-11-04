// Draco 压缩管线（P5 Task 1）：pipeline 原始 glb → KHR_draco_mesh_compression → public/data/models/human.glb。
//
// 契约不变量（P1/P3）：
// - 只用 `gltf-transform draco` 压缩 mesh 几何，不用 optimize（其 flatten/join 会破坏节点层级）；
//   节点名/层级/变换不变（matrix 字段被等价改写为 TRS，实测误差 ≤ 2.2e-16），
//   glbNodes.ts / poseMap FK 对账 / 浏览器 ?fkcheck=1 均不受影响。
// - 产物 < 8MB（P5 验收线），超限 exit 1。
// - 源未变（sha256 一致）且产物通过 magic+hash 校验 → 跳过压缩（stamp 在 node_modules/.cache/，不入库）。
//
// 用法：node scripts/compress-glb.mjs（独立运行）或被 sync-assets.mjs 调用 compressHumanGlb()；
// --force 忽略 stamp 缓存强制重压（npm run compress-glb -- --force）。
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

/** P5 验收线：压缩产物不得超过 8MB */
const MAX_GLB_BYTES = 8 * 1024 * 1024

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const webRoot = path.resolve(scriptDir, '..')
const repoRoot = path.resolve(webRoot, '..')

const SRC_GLB = path.join(repoRoot, 'pipeline', 'out', 'fullbody', 'human.glb')
const DEST_GLB = path.join(webRoot, 'public', 'data', 'models', 'human.glb')
/** 压缩跳过判定 stamp（记录源/产物 hash 与大小；node_modules 天然不入库且可随时重建） */
const STAMP_FILE = path.join(webRoot, 'node_modules', '.cache', 'human-glb-draco.json')

// three 自带 Draco 解码器 → public/draco/（DRACOLoader.setDecoderPath('./draco/') 相对路径命中）。
// wasm 双件是常规路径；draco_decoder.js 是无 WebAssembly 环境的 JS fallback（DRACOLoader
// _initDecoder 的 useJS 分支会拉取），一并就位避免 fallback 404。
const DECODER_SRC_DIR = path.join(webRoot, 'node_modules', 'three', 'examples', 'jsm', 'libs', 'draco', 'gltf')
const DECODER_FILES = ['draco_decoder.wasm', 'draco_wasm_wrapper.js', 'draco_decoder.js']
const DECODER_DEST_DIR = path.join(webRoot, 'public', 'draco')

/** @gltf-transform/cli 的 bin 入口（经 exports 主入口上溯定位，避免 bin 路径硬编码失败） */
function gltfTransformBin() {
  const require = createRequire(import.meta.url)
  const entry = require.resolve('@gltf-transform/cli') // <pkg>/dist/cli.mjs
  const bin = path.resolve(path.dirname(entry), '..', 'bin', 'cli.js')
  if (!existsSync(bin)) {
    throw new Error(`@gltf-transform/cli bin 不存在：${bin}（请检查 devDependencies 是否安装完整）`)
  }
  return bin
}

/**
 * 复制 three 自带 Draco 解码器到 public/draco/（幂等：目标存在且同尺寸则跳过）。
 * 返回本次实际复制的字节数（跳过计 0）。
 */
export async function ensureDracoDecoders() {
  let copied = 0
  if (!existsSync(DECODER_SRC_DIR)) {
    console.log(`[warn] three 自带 Draco 解码器目录缺失（${path.relative(repoRoot, DECODER_SRC_DIR)}），跳过复制`)
    return 0
  }
  for (const name of DECODER_FILES) {
    const src = path.join(DECODER_SRC_DIR, name)
    const dest = path.join(DECODER_DEST_DIR, name)
    if (!existsSync(src)) {
      console.warn(`[warn] 解码器源文件缺失：${name}，跳过`)
      continue
    }
    const srcSize = (await stat(src)).size
    if (existsSync(dest) && (await stat(dest)).size === srcSize) {
      console.log(`[skip] ${path.relative(repoRoot, dest)} 已就位`)
      continue
    }
    await mkdir(DECODER_DEST_DIR, { recursive: true })
    await copyFile(src, dest)
    copied += srcSize
    console.log(`[ok]   ${path.relative(repoRoot, dest)} (${srcSize} bytes)`)
  }
  return copied
}

/** stamp 载荷：源 hash + 产物 hash/大小（跳过路径据此验证缓存产物仍然有效） */
async function readStamp() {
  if (!existsSync(STAMP_FILE)) return null
  try {
    return JSON.parse(await readFile(STAMP_FILE, 'utf8'))
  } catch {
    return null
  }
}

/** 产物有效性：GLB magic 正确且内容与 stamp 记录的 outHash 一致（防脏缓存被沿用） */
async function destIsValid(outHash) {
  const buf = await readFile(DEST_GLB)
  return buf.length >= 12 && buf.readUint32LE(0) === 0x46546c67 && createHash('sha256').update(buf).digest('hex') === outHash
}

/**
 * 压缩 human.glb：源未变、产物存在且通过 magic+hash 校验 → 跳过；
 * force=true（--force）忽略缓存强制重压；
 * 否则 gltf-transform draco 压缩，超过 8MB 上限 exit 1。
 * 返回产物字节数（源缺失时返回 0）。
 */
export async function compressHumanGlb(force = false) {
  if (!existsSync(SRC_GLB)) {
    console.log(`[skip] ${path.relative(repoRoot, SRC_GLB)} 不存在，跳过压缩`)
    return 0
  }
  const srcBuf = await readFile(SRC_GLB)
  const srcHash = createHash('sha256').update(srcBuf).digest('hex')

  const stamp = await readStamp()
  if (!force && existsSync(DEST_GLB) && stamp?.srcHash === srcHash && (await destIsValid(stamp.outHash))) {
    console.log(`[skip] human.glb 源未变，沿用已有 Draco 压缩产物 (${stamp.outBytes} bytes)`)
    return stamp.outBytes
  }
  console.log(force ? '[info] human.glb 强制重压（--force）' : '[info] human.glb 需要压缩（源变更或产物缺失/失效）')

  await mkdir(path.dirname(DEST_GLB), { recursive: true })
  // 临时文件必须保留 .glb 扩展：gltf-transform CLI 按扩展名选择写出格式，
  // 用 .tmp 会被误写成 .gltf JSON 文本（实测踩坑）
  const tmp = DEST_GLB.replace(/\.glb$/, '.tmp.glb')
  await rm(tmp, { force: true })

  const r = spawnSync(process.execPath, [gltfTransformBin(), 'draco', SRC_GLB, tmp], { stdio: 'inherit' })
  if (r.error || r.status !== 0) {
    await rm(tmp, { force: true })
    console.error(`[fail] gltf-transform draco 压缩失败（exit=${r.status ?? r.error?.message ?? 'unknown'}）`)
    process.exit(1)
  }

  // GLB magic 校验（'glTF'）：防 CLI 静默写出非 GLB 格式（如扩展名误判为 .gltf）
  const tmpBuf = await readFile(tmp)
  if (tmpBuf.length < 12 || tmpBuf.readUint32LE(0) !== 0x46546c67) {
    await rm(tmp, { force: true })
    console.error(`[fail] 压缩产物不是合法 GLB（magic 不符，${tmpBuf.length} bytes），已丢弃`)
    process.exit(1)
  }

  const outBytes = tmpBuf.length
  if (outBytes >= MAX_GLB_BYTES) {
    await rm(tmp, { force: true })
    console.error(`[fail] 压缩后 ${outBytes} bytes 达到 8MB 上限（${MAX_GLB_BYTES}），中止同步（需在管线侧减面/减属性）`)
    process.exit(1)
  }

  await rename(tmp, DEST_GLB)
  await mkdir(path.dirname(STAMP_FILE), { recursive: true })
  const outHash = createHash('sha256').update(tmpBuf).digest('hex')
  await writeFile(STAMP_FILE, JSON.stringify({ srcHash, srcBytes: srcBuf.length, outBytes, outHash, tool: 'gltf-transform draco' }, null, 2))

  const ratio = ((1 - outBytes / srcBuf.length) * 100).toFixed(1)
  console.log(`[ok]   ${path.relative(repoRoot, DEST_GLB)} Draco 压缩完成：${srcBuf.length} → ${outBytes} bytes（- ${ratio}%）`)
  return outBytes
}

// 直接运行：压缩 + 确保 decoder 就位（sync-assets 集成时同样按此顺序调用）
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await compressHumanGlb(process.argv.includes('--force'))
  await ensureDracoDecoders()
}
