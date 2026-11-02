/**
 * 关键帧区间检查（板块 02）：关键帧自其 t 起生效，到下一关键帧 t 为止
 * （起点含、终点不含）；末个关键帧区间闭到 duration。
 * T4 只提供纯函数，T6 用它触发知识卡自动弹出。
 */
import type { Keyframe } from '../types'

/**
 * 返回 t 当前命中的关键帧；未落入任何区间返回 null。
 * keyframes 须按 t 升序（06 数据流水线保证）；duration 缺省视为无上界。
 */
export function activeKeyframe(
  keyframes: Keyframe[],
  t: number,
  duration = Infinity,
): Keyframe | null {
  for (let i = 0; i < keyframes.length; i++) {
    const kf = keyframes[i]
    if (t < kf.t) return null // 升序前提下已越过所有更早区间
    const next = keyframes[i + 1]
    if (next) {
      if (t < next.t) return kf
    } else if (t <= duration) {
      return kf // 末个关键帧：区间闭到 duration
    }
  }
  return null
}
