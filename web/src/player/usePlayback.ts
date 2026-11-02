/**
 * 回放引擎 hook（板块 02）：RAF 播放循环 + 帧派生分发。
 * - 循环体抽成 createStepper().step(now) 纯状态机（可单测一拍）：
 *   dt 由 performance.now 时间戳计算，钳制尖峰后委托 store.tick(dt)。
 * - 帧派生：store.subscribe 订阅 t/scene 变化 → sampleFrame 缓存为 React state
 *   返回给 App；由 App 的 effect 把帧传给 Viewport setPose，并留给 03 图表
 *   游标 / 04 关键帧（activeKeyframe）在同一帧数据上联动。
 */
import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { sampleFrame, type PlaybackFrame } from './sampleFrame'

/** 单拍最大 dt（s）：后台标签页恢复等导致 RAF 停摆时，钳制防止 t 大步跳变 */
export const MAX_STEP_DT = 0.25

/** 播放循环一拍：首次调用只记录基准时间戳，其后每次推进 dt × playbackRate */
export interface PlaybackStepper {
  step: (now: number) => void
}

/** 创建独立于 RAF 的循环体（每轮播放新建，基准时间自动重置） */
export function createStepper(): PlaybackStepper {
  let last = -1
  return {
    step(now: number) {
      if (last < 0) {
        last = now
        return
      }
      let dt = (now - last) / 1000
      last = now
      if (dt > MAX_STEP_DT) dt = MAX_STEP_DT
      useStore.getState().tick(dt)
    },
  }
}

/** 当前帧（scene 未加载为 null），App 据此统一分发给视口与图表 */
export function usePlayback(): PlaybackFrame | null {
  const [frame, setFrame] = useState<PlaybackFrame | null>(() => {
    const { scene, t } = useStore.getState()
    return scene ? sampleFrame(scene, t) : null
  })

  // 播放循环：playing 时启动 RAF，暂停/卸载取消（tick 内部自校验 playing）
  const playing = useStore((s) => s.playing)
  useEffect(() => {
    if (!playing) return
    const stepper = createStepper()
    let rafId = requestAnimationFrame(function loop(now) {
      stepper.step(now)
      rafId = requestAnimationFrame(loop)
    })
    return () => cancelAnimationFrame(rafId)
  }, [playing])

  // 帧派生：仅 t 或 scene 变化时重采样（其余 store 变更不触发，避免重复分发）
  useEffect(() => {
    let prevT = useStore.getState().t
    let prevScene = useStore.getState().scene
    return useStore.subscribe((s) => {
      if (s.t === prevT && s.scene === prevScene) return
      prevT = s.t
      prevScene = s.scene
      setFrame(s.scene ? sampleFrame(s.scene, s.t) : null)
    })
  }, [])

  return frame
}
