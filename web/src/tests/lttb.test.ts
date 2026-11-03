import { describe, expect, it } from 'vitest'
import { lttb } from '../charts/lttb'

/** 正弦叠加离群尖峰的典型教学曲线形状 */
function makeSineWithSpike(n = 500) {
  const xs = Array.from({ length: n }, (_, i) => i / (n - 1))
  const ys = xs.map((x) => Math.sin(x * Math.PI * 4) * 10)
  const spikeIndex = Math.floor(n / 2)
  ys[spikeIndex] = 1000 // 离群尖峰
  return { xs, ys, spikeIndex, spikeValue: 1000 }
}

describe('lttb（LTTB 降采样）', () => {
  it('点数 ≤ threshold 时原样返回（同引用）', () => {
    const xs = [0, 1, 2]
    const ys = [0, 1, 0]
    const out = lttb(xs, ys, 2000)
    expect(out.xs).toBe(xs)
    expect(out.ys).toBe(ys)
  })

  it('输出长度 = threshold', () => {
    const { xs, ys } = makeSineWithSpike(500)
    const out = lttb(xs, ys, 50)
    expect(out.xs).toHaveLength(50)
    expect(out.ys).toHaveLength(50)
  })

  it('保留首末点', () => {
    const xs = [0, 1, 2, 3, 4]
    const ys = [0, 5, -5, 5, 7]
    const out = lttb(xs, ys, 3)
    expect(out.xs[0]).toBe(0)
    expect(out.xs[out.xs.length - 1]).toBe(4)
    expect(out.ys[0]).toBe(0)
    expect(out.ys[out.ys.length - 1]).toBe(7)
  })

  it('threshold = 2 时只保留首末两点', () => {
    const out = lttb([1, 2, 3, 4], [9, 1, 1, 8], 2)
    expect(out.xs).toEqual([1, 4])
    expect(out.ys).toEqual([9, 8])
  })

  it('正弦 + 离群尖峰：尖峰点保留在输出中', () => {
    const { xs, ys, spikeIndex, spikeValue } = makeSineWithSpike(500)
    const out = lttb(xs, ys, 50)
    expect(out.ys).toContain(spikeValue)
    const keptIndex = out.ys.indexOf(spikeValue)
    expect(out.xs[keptIndex]).toBe(xs[spikeIndex])
  })

  it('输出 x 严格递增（单调性）', () => {
    const { xs, ys } = makeSineWithSpike(500)
    const out = lttb(xs, ys, 37)
    for (let i = 1; i < out.xs.length; i++) {
      expect(out.xs[i]).toBeGreaterThan(out.xs[i - 1])
    }
  })

  it('输出点均取自原始数据（不产生插值新点）', () => {
    const xs = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
    const ys = [0, 3, -2, 5, -4, 6, -1, 4, 2, 1]
    const out = lttb(xs, ys, 5)
    for (const y of out.ys) expect(ys).toContain(y)
    for (const x of out.xs) expect(xs).toContain(x)
  })
})
