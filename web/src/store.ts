import { create } from 'zustand'
import { loadScene } from './data'
import type { KnowledgeCard, RigMeta, SceneData } from './types'

/** 全局应用状态：场景加载、播放时间轴、选中部件 */
export interface AppState {
  /** 当前场景 id，未加载为 null */
  sceneId: string | null
  scene: SceneData | null
  rigMeta: RigMeta | null
  knowledge: KnowledgeCard[]
  /** 当前播放时间（s），始终在 [0, duration] 内 */
  t: number
  playing: boolean
  /** 播放倍速 */
  playbackRate: number
  /** 当前选中部件 id（null 表示未选中） */
  selectedPartId: string | null
  /** 播放到末尾是否循环 */
  loop: boolean

  /** 切换场景：异步加载，t 归零、暂停、取消选中 */
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
}

export const useStore = create<AppState>((set, get) => ({
  sceneId: null,
  scene: null,
  rigMeta: null,
  knowledge: [],
  t: 0,
  playing: false,
  playbackRate: 1,
  selectedPartId: null,
  loop: true,

  setScene: async (id) => {
    set({ sceneId: id, scene: null, t: 0, playing: false, selectedPartId: null })
    const scene = await loadScene(id)
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
  setKnowledge: (k) => set({ knowledge: k }),
}))
