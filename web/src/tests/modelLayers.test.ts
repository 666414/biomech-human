// @vitest-environment node
/**
 * 模型图层契约回归（肌肉/皮肤滑杆必须有可作用对象）。
 *
 * 历史故障：glb 只导出骨骼网格、rig-meta 只有 skeleton 分组，导致两个滑杆
 * 的过滤循环体永不执行（无对象可改），表现为「滑动没有任何效果」。
 * 本测试直接校验产物契约，管线回退即可发现。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseGlbNodes } from '../three/glbNodes'
import type { MuscleMeta, RigMeta } from '../types'

const ASSET = (rel: string) => readFileSync(resolve(process.cwd(), rel))
const meta = JSON.parse(ASSET('public/data/models/rig-meta.json').toString('utf8')) as RigMeta
const muscles = JSON.parse(ASSET('public/data/models/muscle-meta.json').toString('utf8')) as MuscleMeta
const glb = parseGlbNodes(ASSET('public/data/models/human.glb'))

const SCENE_DIR = resolve(process.cwd(), 'public/data/scenes')
const sceneFiles = readdirSync(SCENE_DIR).filter((f) => f.endsWith('.json'))

describe('模型图层契约（滑杆可作用）', () => {
  it('rig-meta 声明皮肤图层节点，且节点与父 body 都在 glb 中', () => {
    const attachments = meta.attachments ?? []
    expect(attachments.length).toBeGreaterThan(0)
    for (const a of attachments) {
      expect(a.group).toBe('skin')
      expect(glb.byName.has(a.id), `glb 缺少皮肤节点 ${a.id}`).toBe(true)
      expect(glb.byName.has(a.parent), `glb 缺少父节点 ${a.parent}`).toBe(true)
    }
  })

  it('glb 里所有蒙皮网格节点都被 rig-meta 声明为皮肤图层', () => {
    const attachments = meta.attachments ?? []
    // 蒙皮网格以节点上的 skin 索引为判据，不依赖节点命名（胶囊皮肤与完整体表命名不一致）
    const skinned = glb.locals.filter((n) => n.skin !== undefined)
    expect(skinned.length).toBeGreaterThanOrEqual(1)
    const declared = new Set(attachments.map((a) => a.id))
    for (const n of skinned) {
      expect(declared.has(n.name), `皮肤网格 ${n.name} 未在 rig-meta 声明`).toBe(true)
    }
    expect(attachments.every((a) => glb.byName.has(a.id))).toBe(true)
  })

  it('骨骼分组仍覆盖全部 body（皮肤/肌肉不混入 parts）', () => {
    expect(meta.parts.length).toBe(80)
    expect(meta.parts.every((p) => p.group === 'skeleton')).toBe(true)
  })

  it('每个场景的每块肌肉都能在 muscle-meta 找到 ≥2 个附着点', () => {
    for (const file of sceneFiles) {
      const scene = JSON.parse(readFileSync(resolve(SCENE_DIR, file), 'utf8')) as {
        muscles: string[]
      }
      for (const name of scene.muscles) {
        const def = muscles.muscles[name]
        expect(def, `${file}: 缺少肌肉 ${name} 的折线数据`).toBeDefined()
        expect(def.points.length).toBeGreaterThanOrEqual(2)
        for (const p of def.points) {
          expect(glb.byName.has(p.body), `${name} 的附着 body ${p.body} 不在 glb`).toBe(true)
        }
      }
    }
  })
})
