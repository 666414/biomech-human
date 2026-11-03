/**
 * 知识卡联动纯函数（板块 04，T6）：弹卡判定与查卡，不持有状态。
 * UI 状态（activeCard / 去重追踪 activeKeyframeId）由 store 管理。
 */
import type { Keyframe, KnowledgeCard } from '../types'
import type { KnowledgeIndex } from '../data'

/** checkKeyframeCard 判定结果 */
export interface KeyframeCardDecision {
  /** 本次应弹出的卡 id（不弹为 null） */
  popCardId: string | null
  /** 去重追踪的新活跃关键帧 cardId（离开所有区间为 null） */
  activeId: string | null
}

/**
 * 关键帧弹卡判定（纯函数）：
 * - 进入新关键帧区间（cardId ≠ 上一活跃）→ 弹出该区间卡；
 * - 同区间重复调用 → 不重复弹（当前活跃卡已是该卡则跳过）；
 * - 离开所有区间 → 活跃 id 清空（已弹出的卡不强制关闭，由用户关闭）。
 */
export function checkKeyframeCard(
  prevId: string | null,
  kf: Keyframe | null,
): KeyframeCardDecision {
  const activeId = kf?.cardId ?? null
  if (!activeId) return { popCardId: null, activeId: null }
  if (activeId === prevId) return { popCardId: null, activeId }
  return { popCardId: activeId, activeId }
}

/**
 * 曲线系列点击查卡（触发路径 3）：系列名为关节/肌肉 id，
 * 先按 partId 查、再按 cardId 查；查不到返回 null（不弹卡）。
 */
export function findSeriesCard(name: string, index: KnowledgeIndex): KnowledgeCard | null {
  return index.byPartId[name]?.[0] ?? index.byCardId[name]?.[0] ?? null
}
