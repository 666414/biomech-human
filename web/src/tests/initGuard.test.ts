import { describe, expect, it } from 'vitest'
import { shouldDeferInit } from '../charts/initGuard'

/**
 * 图表零尺寸初始化守卫（回归：ECharts "Can't get DOM width or height"）。
 * 背景：.charts-box 高度链断裂时宿主恒为 0 高，挂载期 init 会告警且布局塌缩，
 * ResizeObserver 因宿主尺寸不再变化而无法补救 → 必须在 init 前判定并推迟。
 */
describe('shouldDeferInit（图表初始化尺寸守卫）', () => {
  it('0×0 → 推迟 init', () => {
    expect(shouldDeferInit(0, 0)).toBe(true)
  })

  it('任一维为 0 → 推迟 init', () => {
    expect(shouldDeferInit(800, 0)).toBe(true)
    expect(shouldDeferInit(0, 300)).toBe(true)
  })

  it('非零尺寸 → 立即 init', () => {
    expect(shouldDeferInit(800, 300)).toBe(false)
    expect(shouldDeferInit(1, 1)).toBe(false)
  })

  it('异常输入（NaN/负数）按推迟处理', () => {
    expect(shouldDeferInit(Number.NaN, 300)).toBe(true)
    expect(shouldDeferInit(800, Number.NaN)).toBe(true)
    expect(shouldDeferInit(-1, 300)).toBe(true)
    expect(shouldDeferInit(800, -1)).toBe(true)
  })
})
