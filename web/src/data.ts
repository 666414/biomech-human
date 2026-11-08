import type { KnowledgeCard, RigMeta, SceneData } from './types'

/** 全部场景 id（固定 5 个） */
export const SCENE_IDS = [
  'gait_cycle',
  'drop_landing',
  'lift_task',
  'shoulder_abduction',
  'ankle_inversion',
] as const

export type SceneId = (typeof SCENE_IDS)[number]

/**
 * 静态资源 URL：拼 Vite 基座（`base: './'`），保证产物在任意子目录部署时
 * 数据请求跟着落到子目录下，而不是写死站点根。传参可带或不带前导 `/`。
 */
export function assetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`加载 ${url} 失败：HTTP ${res.status}`)
  }
  return (await res.json()) as T
}

/** 模型刚体层级与关节定义 */
export function loadRigMeta(): Promise<RigMeta> {
  return fetchJson<RigMeta>(assetUrl('/data/models/rig-meta.json'))
}

/** 按场景 id 加载场景数据 */
export function loadScene(id: string): Promise<SceneData> {
  return fetchJson<SceneData>(assetUrl(`/data/scenes/${id}.json`))
}

/**
 * 知识卡加载：404 或网络失败时返回 []，不抛错
 * （P3 前半段 knowledge.json 尚未由 T6 生成）。
 */
export async function loadKnowledge(): Promise<KnowledgeCard[]> {
  try {
    const res = await fetch(assetUrl('/data/knowledge/knowledge.json'))
    if (!res.ok) return []
    return (await res.json()) as KnowledgeCard[]
  } catch {
    return []
  }
}

/** 知识卡索引：按部件 id 与关键帧 cardId 分组 */
export interface KnowledgeIndex {
  byPartId: Record<string, KnowledgeCard[]>
  byCardId: Record<string, KnowledgeCard[]>
}

/** 把知识卡数组建成按 partId / cardId 查询的索引 */
export function indexKnowledge(cards: KnowledgeCard[]): KnowledgeIndex {
  const byPartId: Record<string, KnowledgeCard[]> = {}
  const byCardId: Record<string, KnowledgeCard[]> = {}
  for (const card of cards) {
    if (card.partId) {
      ;(byPartId[card.partId] ??= []).push(card)
    }
    if (card.cardId) {
      ;(byCardId[card.cardId] ??= []).push(card)
    }
  }
  return { byPartId, byCardId }
}
