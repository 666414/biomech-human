import { beforeEach, describe, expect, it } from 'vitest'
import { activeKeyframe } from '../player/activeKeyframe'
import { MAX_STEP_DT, createStepper } from '../player/usePlayback'
import { sampleFrame } from '../player/sampleFrame'
import type { SceneData } from '../types'
import { useStore } from '../store'

// 内存 fixture，与 store.test.ts 的 makeScene 同构（不发真实请求）
function makeScene(): SceneData {
  return {
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
    keyframes: [
      { t: 0.5, label: '负重中期', cardId: 'kf-mid-stance' },
      { t: 1.5, label: '蹬离', cardId: 'kf-toe-off' },
    ],
  }
}

const initialState = {
  sceneId: null as string | null,
  scene: null as SceneData | null,
  t: 0,
  playing: false,
  playbackRate: 1,
  selectedPartId: null as string | null,
  loop: true,
}

beforeEach(() => {
  useStore.setState(initialState)
})

describe('sampleFrame', () => {
  const scene = makeScene()

  it('精确帧：jointAngles 键名对 joints[i]、值为 qpos 行', () => {
    const f = sampleFrame(scene, 1)
    expect(f.time).toBe(1)
    expect(f.jointAngles).toEqual({ hip_flexion_r: 0.1, knee_angle_r: -0.2 })
  })

  it('精确帧：grf / muscleAct / torques 取对应行', () => {
    const f = sampleFrame(scene, 2)
    expect(f.grf).toEqual([0, 0, 550])
    expect(f.muscleAct).toEqual([90])
    expect(f.torques).toEqual([3, 4])
  })

  it('中间帧线性插值：t=0.5 各序列取半程值', () => {
    const f = sampleFrame(scene, 0.5)
    expect(f.jointAngles).toEqual({ hip_flexion_r: 0.05, knee_angle_r: -0.1 })
    expect(f.grf).toEqual([50, 10, 550])
    expect(f.muscleAct).toEqual([30])
    expect(f.torques).toEqual([0.5, 1])
  })

  it('t 越界钳位到端点帧', () => {
    const f = sampleFrame(scene, 99)
    expect(f.jointAngles).toEqual({ hip_flexion_r: 0.2, knee_angle_r: -0.4 })
  })
})

describe('activeKeyframe', () => {
  const kfs = makeScene().keyframes
  const duration = 2

  it('t 落在关键帧区间内返回该关键帧', () => {
    expect(activeKeyframe(kfs, 0.7, duration)?.cardId).toBe('kf-mid-stance')
    expect(activeKeyframe(kfs, 1.9, duration)?.cardId).toBe('kf-toe-off')
  })

  it('t 恰为关键帧 t 时命中该关键帧（区间起点含）', () => {
    expect(activeKeyframe(kfs, 0.5, duration)?.cardId).toBe('kf-mid-stance')
    expect(activeKeyframe(kfs, 1.5, duration)?.cardId).toBe('kf-toe-off')
  })

  it('下一关键帧 t 归属下一关键帧（区间终点不含）', () => {
    expect(activeKeyframe(kfs, 1.5, duration)?.cardId).toBe('kf-toe-off')
    expect(activeKeyframe(kfs, 1.499, duration)?.cardId).toBe('kf-mid-stance')
  })

  it('区间外（首个关键帧之前）返回 null', () => {
    expect(activeKeyframe(kfs, 0.3, duration)).toBeNull()
  })

  it('末尾关键帧区间闭到 duration', () => {
    expect(activeKeyframe(kfs, duration, duration)?.cardId).toBe('kf-toe-off')
  })

  it('t 超出 duration 返回 null', () => {
    expect(activeKeyframe(kfs, duration + 0.1, duration)).toBeNull()
  })

  it('空关键帧数组返回 null', () => {
    expect(activeKeyframe([], 1, duration)).toBeNull()
  })
})

describe('createStepper（播放循环一拍）', () => {
  function loadFixtureAndPlay() {
    useStore.setState({ scene: makeScene(), sceneId: 'gait_cycle', playing: true })
  }

  it('首拍只记录基准时间，不推进 t', () => {
    loadFixtureAndPlay()
    const stepper = createStepper()
    stepper.step(1000)
    expect(useStore.getState().t).toBe(0)
  })

  it('按 dt × playbackRate 推进', () => {
    loadFixtureAndPlay()
    useStore.getState().setPlaybackRate(2)
    const stepper = createStepper()
    stepper.step(1000)
    stepper.step(1100) // dt = 0.1s × 2 = 0.2s
    expect(useStore.getState().t).toBeCloseTo(0.2, 10)
  })

  it('dt 尖峰钳制到 MAX_STEP_DT（后台标签页恢复防跳变）', () => {
    loadFixtureAndPlay()
    const stepper = createStepper()
    stepper.step(0)
    stepper.step(10000) // 10s 间隔 → 只按 MAX_STEP_DT 推进
    expect(useStore.getState().t).toBeCloseTo(MAX_STEP_DT, 10)
  })

  it('暂停时 step 不推进', () => {
    loadFixtureAndPlay()
    useStore.setState({ playing: false })
    const stepper = createStepper()
    stepper.step(0)
    stepper.step(500)
    expect(useStore.getState().t).toBe(0)
  })

  it('到末尾按 loop 循环归零（委托 store.tick）', () => {
    loadFixtureAndPlay()
    useStore.getState().seek(1.9)
    const stepper = createStepper()
    stepper.step(0)
    stepper.step(200) // t = 1.9 + 0.2 = 2.1 ≥ duration 2 → 归零 0.1
    expect(useStore.getState().t).toBeCloseTo(0.1, 10)
  })
})
