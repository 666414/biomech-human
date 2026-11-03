/**
 * LTTB（Largest-Triangle-Three-Buckets）降采样（板块 03）。
 * 交互态把曲线降到 threshold 个点：保留首末点，其余按「桶内与前选点、
 * 下一桶平均点构成三角形面积最大」选取，尖峰/极值特征不易丢失。
 * 点数 ≤ threshold 时原样返回（当前场景 ≤2000 点不触发，教学验收 + 未来扩展）。
 */
export interface LttbResult {
  xs: number[]
  ys: number[]
}

export function lttb(xs: number[], ys: number[], threshold: number): LttbResult {
  const n = xs.length
  if (n <= threshold) return { xs, ys }
  if (threshold < 3) {
    // 无法构成桶：退化为只保留首末点
    return { xs: [xs[0], xs[n - 1]], ys: [ys[0], ys[n - 1]] }
  }

  const outXs = new Array<number>(threshold)
  const outYs = new Array<number>(threshold)
  outXs[0] = xs[0]
  outYs[0] = ys[0]
  outXs[threshold - 1] = xs[n - 1]
  outYs[threshold - 1] = ys[n - 1]

  // 桶宽（浮点），候选/平均桶按 floor(i * every) 边界切分
  const every = (n - 2) / (threshold - 2)
  let a = 0 // 上一个被选点的索引

  for (let i = 1; i < threshold - 1; i++) {
    // 平均点：当前桶之后的下一桶（末桶钳位，不含末点）
    const avgStart = Math.min(Math.floor(i * every) + 1, n - 2)
    const avgEnd = Math.min(Math.floor((i + 1) * every) + 1, n - 1)
    let avgX = 0
    let avgY = 0
    let count = 0
    for (let j = avgStart; j < avgEnd; j++) {
      avgX += xs[j]
      avgY += ys[j]
      count++
    }
    if (count > 0) {
      avgX /= count
      avgY /= count
    } else {
      // 边界钳位导致的空桶：取钳位处单点作为平均点
      avgX = xs[avgStart]
      avgY = ys[avgStart]
    }

    // 候选桶：当前桶（floor 边界保证覆盖 [1, n-1) 且非空，因 every ≥ 1）
    const candStart = Math.floor((i - 1) * every) + 1
    const candEnd = Math.floor(i * every) + 1
    const ax = xs[a]
    const ay = ys[a]
    let maxArea = -1
    let nextA = candStart
    for (let j = candStart; j < candEnd; j++) {
      // 三角形 (a, 候选点, 平均点) 面积（叉积一半，绝对值比较）
      const area = Math.abs((ax - avgX) * (ys[j] - ay) - (ax - xs[j]) * (avgY - ay))
      if (area > maxArea) {
        maxArea = area
        nextA = j
      }
    }
    outXs[i] = xs[nextA]
    outYs[i] = ys[nextA]
    a = nextA
  }

  return { xs: outXs, ys: outYs }
}
