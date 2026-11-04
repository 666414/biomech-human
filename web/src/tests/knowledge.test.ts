// @vitest-environment node
/**
 * 知识卡联动测试（板块 04，T6）：
 * 1. indexKnowledge 按 partId / cardId 索引的命中与未命中；
 * 2. checkKeyframeCard 关键帧弹卡去重判定（纯函数）；
 * 3. findSeriesCard 曲线系列点击查卡（查不到不弹）；
 * 4. clampCursorX 游标钳制（ParamCharts dataZoom 窗口外不越界）；
 * 5. 真实内容校验（node fs 读文件）：content/knowledge/knowledge.json 字段齐全、
 *    keyframe 卡 cardId 与 5 场景 keyframes 的 cardId 集合一致、
 *    partId 都在 rig-meta id 集合内。
 */
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { clampCursorX } from '../charts/cursor'
import { indexKnowledge, SCENE_IDS } from '../data'
import { checkKeyframeCard, findSeriesCard } from '../knowledge/knowledge'
import type { Keyframe, KnowledgeCard, RigMeta } from '../types'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

function readJson(rel: string): unknown {
  return JSON.parse(readFileSync(path.join(repoRoot, rel), 'utf-8'))
}

// ---------- indexKnowledge ----------

const CARDS: KnowledgeCard[] = [
  {
    id: 'c1',
    partId: 'pelvis',
    term: { zh: '骨盆', en: 'Pelvis' },
    anatomy: 'a1',
    biomech: 'b1',
    clinic: 'c1',
    refs: [{ label: 'r1' }],
  },
  {
    id: 'c2',
    partId: 'pelvis',
    term: { zh: '骨盆带', en: 'Pelvic girdle' },
    anatomy: 'a2',
    biomech: 'b2',
    clinic: 'c2',
    refs: [{ label: 'r2' }],
  },
  {
    id: 'c3',
    cardId: 'kf-a',
    term: { zh: '足跟着地', en: 'Heel strike' },
    anatomy: 'a3',
    biomech: 'b3',
    clinic: 'c3',
    refs: [{ label: 'r3' }],
  },
  {
    id: 'c4',
    term: { zh: '无关联卡', en: 'Unlinked' },
    anatomy: 'a4',
    biomech: 'b4',
    clinic: 'c4',
    refs: [{ label: 'r4' }],
  },
]

describe('indexKnowledge', () => {
  const idx = indexKnowledge(CARDS)

  it('byPartId 命中：同 partId 多卡全部入组', () => {
    expect(idx.byPartId.pelvis?.map((c) => c.id)).toEqual(['c1', 'c2'])
  })

  it('byCardId 命中：keyframe 卡按 cardId 检索', () => {
    expect(idx.byCardId['kf-a']?.[0]?.id).toBe('c3')
  })

  it('未命中返回 undefined（不抛错）', () => {
    expect(idx.byPartId['nope']).toBeUndefined()
    expect(idx.byCardId['nope']).toBeUndefined()
  })

  it('无 partId/cardId 的卡不入索引', () => {
    expect(Object.keys(idx.byPartId)).toEqual(['pelvis'])
    expect(Object.keys(idx.byCardId)).toEqual(['kf-a'])
  })
})

// ---------- checkKeyframeCard ----------

const KF_MID: Keyframe = { t: 0.5, label: '负重中期', cardId: 'kf-mid' }
const KF_TOE: Keyframe = { t: 1.5, label: '蹬离', cardId: 'kf-toe' }

describe('checkKeyframeCard（关键帧弹卡去重）', () => {
  it('进入新关键帧区间 → 弹出该卡并更新活跃 id', () => {
    expect(checkKeyframeCard(null, KF_MID)).toEqual({ popCardId: 'kf-mid', activeId: 'kf-mid' })
  })

  it('同区间重复调用 → 不重复弹（popCardId=null）', () => {
    expect(checkKeyframeCard('kf-mid', KF_MID)).toEqual({ popCardId: null, activeId: 'kf-mid' })
  })

  it('区间变更 → 弹出新卡', () => {
    expect(checkKeyframeCard('kf-mid', KF_TOE)).toEqual({ popCardId: 'kf-toe', activeId: 'kf-toe' })
  })

  it('离开所有区间 → 活跃 id 清空且不弹（已弹卡不强制关闭）', () => {
    expect(checkKeyframeCard('kf-mid', null)).toEqual({ popCardId: null, activeId: null })
  })

  it('从区间外再次进入 → 重新弹卡', () => {
    expect(checkKeyframeCard(null, KF_TOE).popCardId).toBe('kf-toe')
  })
})

// ---------- findSeriesCard ----------

describe('findSeriesCard（曲线系列点击查卡）', () => {
  const idx = indexKnowledge(CARDS)

  it('系列名命中 partId 卡（关节/肌肉同名卡优先）', () => {
    expect(findSeriesCard('pelvis', idx)?.id).toBe('c1')
  })

  it('partId 未命中时按 cardId 查', () => {
    expect(findSeriesCard('kf-a', idx)?.id).toBe('c3')
  })

  it('查不到返回 null（不弹卡）', () => {
    expect(findSeriesCard('gaslat_r', idx)).toBeNull()
  })
})

// ---------- clampCursorX（ParamCharts 游标钳制） ----------

describe('clampCursorX（游标钳制到 grid 内）', () => {
  it('grid 内不钳制', () => {
    expect(clampCursorX(200, 64, 388)).toBe(200)
  })

  it('左越界钳到 grid 左界（dataZoom 窗口外）', () => {
    expect(clampCursorX(10, 64, 388)).toBe(64)
  })

  it('右越界钳到 grid 右界', () => {
    expect(clampCursorX(400, 64, 388)).toBe(388)
  })
})

// ---------- 真实内容校验（content/knowledge/knowledge.json） ----------

const contentCards = readJson('content/knowledge/knowledge.json') as KnowledgeCard[]
const rigMeta = readJson('web/public/data/models/rig-meta.json') as RigMeta

/** 5 场景 keyframes 的 cardId 全集 */
const sceneCardIds = new Set<string>()
const sceneFiles = readdirSync(path.join(repoRoot, 'web/public/data/scenes')).filter((f) =>
  f.endsWith('.json'),
)
for (const file of sceneFiles) {
  const scene = readJson(`web/public/data/scenes/${file}`) as { keyframes: Keyframe[] }
  for (const kf of scene.keyframes) sceneCardIds.add(kf.cardId)
}

describe('knowledge.json 内容校验（P4 正式教学卡）', () => {
  it('场景数据源就位：5 场景、10 个关键帧 cardId', () => {
    expect(SCENE_IDS).toHaveLength(5)
    expect(sceneFiles).toHaveLength(5)
    expect(sceneCardIds.size).toBe(10)
  })

  it('≥14 张卡且字段齐全（term/anatomy/biomech/clinic/refs、id 唯一）', () => {
    expect(contentCards.length).toBeGreaterThanOrEqual(14)
    const ids = new Set<string>()
    for (const c of contentCards) {
      expect(c.id, '卡 id 必填').toBeTruthy()
      expect(ids.has(c.id), `卡 id 重复：${c.id}`).toBe(false)
      ids.add(c.id)
      expect(c.term?.zh, `卡 ${c.id} 缺 term.zh`).toBeTruthy()
      expect(c.term?.en, `卡 ${c.id} 缺 term.en`).toBeTruthy()
      expect(c.anatomy, `卡 ${c.id} 缺 anatomy`).toBeTruthy()
      expect(c.biomech, `卡 ${c.id} 缺 biomech`).toBeTruthy()
      expect(c.clinic, `卡 ${c.id} 缺 clinic`).toBeTruthy()
      expect(c.refs?.length, `卡 ${c.id} refs 至少 1 条`).toBeGreaterThanOrEqual(1)
      for (const ref of c.refs ?? []) expect(ref.label, `卡 ${c.id} 引用缺 label`).toBeTruthy()
      expect(c.cardId || c.partId, `卡 ${c.id} 须关联 cardId 或 partId`).toBeTruthy()
    }
  })

  it('keyframe 卡 cardId 与 5 场景 keyframes 的 cardId 集合完全一致（肌肉卡不在集合内）', () => {
    const kfCards = contentCards.filter((c) => c.cardId && sceneCardIds.has(c.cardId))
    const cardIds = new Set(kfCards.map((c) => c.cardId as string))
    expect(kfCards).toHaveLength(sceneCardIds.size)
    expect([...cardIds].sort()).toEqual([...sceneCardIds].sort())
  })

  it('部位卡 ≥4 张且 partId 都在 rig-meta id 集合内', () => {
    const partCards = contentCards.filter((c) => c.partId)
    expect(partCards.length).toBeGreaterThanOrEqual(4)
    const partIds = new Set(rigMeta.parts.map((p) => p.id))
    for (const c of partCards) {
      expect(partIds.has(c.partId as string), `未知 partId：${c.partId}`).toBe(true)
    }
  })

  it('正式教学卡 note 已标注（P4 Task 2：note 含「P4 内容」标记）', () => {
    for (const c of contentCards) {
      expect(c.note, `卡 ${c.id} 缺 P4 内容标注`).toContain('P4 内容')
    }
  })
})
