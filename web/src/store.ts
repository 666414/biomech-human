import { create } from 'zustand'
import { indexKnowledge, loadScene, type KnowledgeIndex } from './data'
import { checkKeyframeCard } from './knowledge/knowledge'
import type { Keyframe, KnowledgeCard, RigMeta, SceneData } from './types'

/** 知识卡弹出来源（面板据此显示触发上下文） */
export type CardSource =
  | { kind: 'part'; partId: string }
  | { kind: 'keyframe'; keyframe: Keyframe }
  | { kind: 'series'; name: string }

/** 全局应用状态：场景加载、播放时间轴、选中部件、知识卡联动 */
export interface AppState {
  /** 当前场景 id，未加载为 null */
  sceneId: string | null
  scene: SceneData | null
  /** 场景数据加载失败信息（null 为无错误；重试成功或重新发起加载时清空） */
  sceneError: string | null
  rigMeta: RigMeta | null
  knowledge: KnowledgeCard[]
  /** 知识卡索引（setKnowledge 时重建） */
  knowledgeIndex: KnowledgeIndex
  /** 当前播放时间（s），始终在 [0, duration] 内 */
  t: number
  playing: boolean
  /** 播放倍速 */
  playbackRate: number
  /** 当前选中部件 id（null 表示未选中） */
  selectedPartId: string | null
  /** 播放到末尾是否循环 */
  loop: boolean
  /** 当前展示的知识卡（null 表示未弹卡/已关闭） */
  activeCard: KnowledgeCard | null
  /** 当前卡的触发来源 */
  activeCardSource: CardSource | null
  /** 关键帧弹卡去重：当前所处关键帧区间的 cardId（不在任何区间为 null） */
  activeKeyframeId: string | null

  /** 切换场景：异步加载，t 归零、暂停、取消选中、关闭知识卡 */
  setScene: (id: string) => Promise<void>
  /** 跳转到指定时间（s），钳位到 [0, duration] */
  seek: (t: number) => void
  /** 播放推进：t += dt * playbackRate，到末尾按 loop 循环或钳位 */
  tick: (dt: number) => void
  togglePlay: () => void
  setPlaybackRate: (r: number) => void
  selectPart: (id: string | null) => void
  setRigMeta: (m: RigMeta) => void
  setKnowledge: (k: KnowledgeCard[]) => void
  /** 设置当前卡与来源（card 为 null 表示关闭） */
  setActiveCard: (card: KnowledgeCard | null, source: CardSource | null) => void
  /** 关闭当前知识卡 */
  closeCard: () => void
  /** 部位拾取弹卡：部位有卡弹第一张；无卡/取消选中时关闭（避免遗留上一部位卡） */
  setActiveCardByPart: (cards: KnowledgeCard[] | undefined, partId: string | null) => void
  /** 关键帧自动弹卡（含去重）：同区间不重复弹；离开区间不强制关闭已弹卡 */
  applyKeyframe: (kf: Keyframe | null) => void
}

export const useStore = create<AppState>((set, get) => ({
  sceneId: null,
  scene: null,
  sceneError: null,
  rigMeta: null,
  knowledge: [],
  knowledgeIndex: { byPartId: {}, byCardId: {} },
  t: 0,
  playing: false,
  playbackRate: 1,
  selectedPartId: null,
  loop: true,
  activeCard: null,
  activeCardSource: null,
  activeKeyframeId: null,

  setScene: async (id) => {
    set({
      sceneId: id,
      scene: null,
      sceneError: null,
      t: 0,
      playing: false,
      selectedPartId: null,
      activeCard: null,
      activeCardSource: null,
      activeKeyframeId: null,
    })
    let scene: SceneData
    try {
      scene = await loadScene(id)
    } catch (e) {
      // 加载失败不向调用方抛出：错误写入状态机，UI 显示错误 + 重试；
      // 加载期间用户已切走则静默丢弃（该错误不属于当前场景）
      if (get().sceneId === id) {
        set({ sceneError: e instanceof Error ? e.message : String(e) })
      }
      return
    }
    // 加载期间用户可能已切换到其它场景，丢弃过期结果
    if (get().sceneId !== id) return
    set({ scene })
  },

  seek: (t) => {
    const { scene } = get()
    if (!scene) return
    set({ t: Math.min(Math.max(t, 0), scene.duration) })
  },

  tick: (dt) => {
    const { scene, playing, playbackRate, loop, t } = get()
    if (!scene || !playing) return
    const next = t + dt * playbackRate
    if (next >= scene.duration) {
      set({ t: loop ? next % scene.duration : scene.duration })
    } else {
      set({ t: next })
    }
  },

  togglePlay: () => set((s) => ({ playing: !s.playing })),
  setPlaybackRate: (r) => set({ playbackRate: r }),
  selectPart: (id) => set({ selectedPartId: id }),
  setRigMeta: (m) => set({ rigMeta: m }),
  setKnowledge: (k) => set({ knowledge: k, knowledgeIndex: indexKnowledge(k) }),
  setActiveCard: (card, source) => set({ activeCard: card, activeCardSource: source }),
  closeCard: () => set({ activeCard: null, activeCardSource: null }),
  setActiveCardByPart: (cards, partId) => {
    const card = cards?.[0]
    if (card && partId) set({ activeCard: card, activeCardSource: { kind: 'part', partId } })
    else set({ activeCard: null, activeCardSource: null })
  },
  applyKeyframe: (kf) => {
    const { popCardId, activeId } = checkKeyframeCard(get().activeKeyframeId, kf)
    if (activeId !== get().activeKeyframeId) set({ activeKeyframeId: activeId })
    if (!popCardId || !kf) return
    const card = get().knowledgeIndex.byCardId[popCardId]?.[0]
    if (card) set({ activeCard: card, activeCardSource: { kind: 'keyframe', keyframe: kf } })
  },
}))
