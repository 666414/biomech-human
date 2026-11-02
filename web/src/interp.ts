/**
 * 逐帧序列线性插值。
 * 精确命中帧时逐元素返回该行；t 越界钳位到首/末帧。
 */
export function sampleSeries(time: number[], rows: number[][], t: number): number[] {
  const n = time.length
  if (n === 0) return []
  if (t <= time[0]) return rows[0].slice()
  if (t >= time[n - 1]) return rows[n - 1].slice()

  // 二分找 i 使 time[i] <= t < time[i+1]
  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (time[mid] <= t) lo = mid
    else hi = mid
  }
  const t0 = time[lo]
  const t1 = time[hi]
  const f = t1 === t0 ? 0 : (t - t0) / (t1 - t0)
  const a = rows[lo]
  const b = rows[hi]
  const out = new Array<number>(a.length)
  for (let j = 0; j < a.length; j++) {
    out[j] = a[j] + (b[j] - a[j]) * f
  }
  return out
}

/** 向量插值别名（如 grf 的 [fx, fy, fz]） */
export const interpVec = sampleSeries
