import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadScene } from '../data'
import type { KnowledgeCard, RigMeta, SceneData } from '../types'
import { useStore } from '../store'

// 不发真实请求：mock 数据加载模块，loadScene 返回内存 fixture
vi.mock('../data', () => {
  const makeScene = (): SceneData => ({
    scene: 'gait_cycle',
    xml: 'gait_cycle.xml',
    fps: 100,
    duration: 2,
    frames: 200,
    joints: ['hip_flexion_r', 'knee_angle_r'],
    muscles: ['gas_r'],
    series: {
      time: [0, 1, 2],
      qpos: [
        [0, 0],
        [0.1, -0.2],
        [0.2, -0.4],
      ],
      qfrc_actuator: [
        [0, 0],
        [1, 2],
        [3, 4],
      ],
      muscle_act: [[10], [50], [90]],
      grf: [
        [0, 0, 500],
        [100, 20, 600],
        [0, 0, 550],
      ],
    },
    keyframes: [{ t: 0, label: '足跟着地', cardId: 'kf-heel-strike' }],
  })
  return {
    SCENE_IDS: ['gait_cycle', 'drop_landing', 'lift_task', 'shoulder_abduction', 'ankle_inversion'],
    loadRigMeta: vi.fn(async () => ({ parts: [] }) satisfies RigMeta),
    loadScene: vi.fn(async () => makeScene()),
    loadKnowledge: vi.fn(async () => [] satisfies KnowledgeCard[]),
  }
})

const initialState = {
  sceneId: null,
  scene: null,
  rigMeta: null,
  knowledge: [] as KnowledgeCard[],
  t: 0,
  playing: false,
  playbackRate: 1,
  selectedPartId: null,
  loop: true,
}

async function loadSceneIntoStore(): Promise<SceneData> {
  const scene = await loadScene('gait_cycle')
  useStore.setState({ scene, sceneId: 'gait_cycle' })
  return scene
}

beforeEach(() => {
  useStore.setState(initialState)
})

describe('useStore 初始状态', () => {
  it('sceneId=null / t=0 / playing=false', () => {
    const s = useStore.getState()
    expect(s.sceneId).toBeNull()
    expect(s.scene).toBeNull()
    expect(s.t).toBe(0)
    expect(s.playing).toBe(false)
    expect(s.playbackRate).toBe(1)
    expect(s.selectedPartId).toBeNull()
    expect(s.loop).toBe(true)
  })
})

describe('setScene', () => {
  it('加载场景并重置 t=0、playing=false、selectedPartId=null', async () => {
    useStore.setState({ t: 1.5, playing: true, selectedPartId: 'femur_r' })
    await useStore.getState().setScene('gait_cycle')
    const s = useStore.getState()
    expect(s.sceneId).toBe('gait_cycle')
    expect(s.scene).not.toBeNull()
    expect(s.scene?.duration).toBe(2)
    expect(s.scene?.joints).toEqual(['hip_flexion_r', 'knee_angle_r'])
    expect(s.t).toBe(0)
    expect(s.playing).toBe(false)
    expect(s.selectedPartId).toBeNull()
  })
})

describe('seek', () => {
  it('越界钳位到 [0, duration]', async () => {
    await loadSceneIntoStore()
    useStore.getState().seek(-1)
    expect(useStore.getState().t).toBe(0)
    useStore.getState().seek(99)
    expect(useStore.getState().t).toBe(2)
    useStore.getState().seek(1.5)
    expect(useStore.getState().t).toBe(1.5)
  })

  it('scene 为 null 时 seek 不动', () => {
    useStore.getState().seek(5)
    expect(useStore.getState().t).toBe(0)
  })
})

describe('tick', () => {
  it('playing=true 时按 dt*playbackRate 推进', async () => {
    await loadSceneIntoStore()
    const s = useStore.getState()
    s.togglePlay()
    s.setPlaybackRate(2)
    s.tick(0.25)
    expect(useStore.getState().t).toBe(0.5)
  })

  it('到 duration 循环归零（默认 loop=true）', async () => {
    await loadSceneIntoStore()
    const s = useStore.getState()
    s.togglePlay()
    s.seek(1.75)
    s.tick(0.5)
    expect(useStore.getState().t).toBe(0.25)
  })

  it('playing=false 时 tick 不动', async () => {
    await loadSceneIntoStore()
    useStore.setState({ t: 0.5 })
    useStore.getState().tick(1)
    expect(useStore.getState().t).toBe(0.5)
  })

  it('scene 为 null 时 tick 不动', () => {
    useStore.getState().tick(1)
    expect(useStore.getState().t).toBe(0)
  })
})

describe('selectPart', () => {
  it('selectPart(id)/selectPart(null) 生效', () => {
    useStore.getState().selectPart('femur_r')
    expect(useStore.getState().selectedPartId).toBe('femur_r')
    useStore.getState().selectPart(null)
    expect(useStore.getState().selectedPartId).toBeNull()
  })
})
