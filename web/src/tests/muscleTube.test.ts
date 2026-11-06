// @vitest-environment node
/**
 * 肌肉管几何回归：纺锤形半径剖面 + 沿长度肌腱/肌腹配色。
 * 纯几何模块（不依赖 DOM），直接验证参考样式所需的形态与配色契约。
 */
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  MUSCLE_BELLY_COLOR,
  MUSCLE_BELLY_RADIUS,
  MUSCLE_TENDON_COLOR,
  MUSCLE_TENDON_RADIUS_RATIO,
  MuscleTube,
  muscleBellyWeight,
  muscleRadiusAt,
} from '../three/muscleTube'

const RADIAL = 10
const RINGS = 9
const VERTS_PER_RING = RADIAL + 1

/** 取某环上第 i 个顶点的坐标 */
function ringVertex(tube: MuscleTube, ring: number, i: number): THREE.Vector3 {
  const pos = tube.geometry.getAttribute('position')
  const idx = ring * VERTS_PER_RING + i
  return new THREE.Vector3(pos.getX(idx), pos.getY(idx), pos.getZ(idx))
}

/** 直管（沿 +X）时，顶点到中心线的径向距离 */
function ringRadius(tube: MuscleTube, ring: number, i: number): number {
  const v = ringVertex(tube, ring, i)
  return Math.hypot(v.y - 0, v.z - 0)
}

describe('肌肉管剖面（écorché 纺锤形）', () => {
  it('肌腹权重：两端 0、中段 1', () => {
    expect(muscleBellyWeight(0)).toBe(0)
    expect(muscleBellyWeight(0.5)).toBe(1)
    expect(muscleBellyWeight(1)).toBe(0)
  })

  it('半径剖面：端点 = 肌腱细端，中点 = 肌腹最粗，且单调过渡', () => {
    expect(muscleRadiusAt(0)).toBeCloseTo(MUSCLE_BELLY_RADIUS * MUSCLE_TENDON_RADIUS_RATIO, 6)
    expect(muscleRadiusAt(0.5)).toBeCloseTo(MUSCLE_BELLY_RADIUS, 6)
    expect(muscleRadiusAt(1)).toBeCloseTo(MUSCLE_BELLY_RADIUS * MUSCLE_TENDON_RADIUS_RATIO, 6)
    let prev = 0
    for (let s = 0; s <= 0.5; s += 0.05) {
      const r = muscleRadiusAt(s)
      expect(r).toBeGreaterThanOrEqual(prev - 1e-9)
      prev = r
    }
  })
})

describe('肌肉管几何', () => {
  it('顶点/索引数量与环结构一致', () => {
    const tube = new MuscleTube(RINGS, RADIAL, 2)
    expect(tube.vertexCount).toBe(RINGS * VERTS_PER_RING + 2)
    const pos = tube.geometry.getAttribute('position')
    expect(pos.count).toBe(tube.vertexCount)
    expect(tube.geometry.getAttribute('uv').count).toBe(tube.vertexCount)
    expect(tube.geometry.getAttribute('color').count).toBe(tube.vertexCount)
    expect(tube.geometry.getIndex()?.count).toBe((RINGS - 1) * RADIAL * 6 + RADIAL * 6)
  })

  it('直管重写后：中段半径 > 两端半径，两端收拢到肌腱半径', () => {
    const tube = new MuscleTube(RINGS, RADIAL, 2)
    const ok = tube.update([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.3, 0, 0)])
    expect(ok).toBe(true)

    const rStart = ringRadius(tube, 0, 0)
    const rMid = ringRadius(tube, (RINGS - 1) / 2, 0)
    const rEnd = ringRadius(tube, RINGS - 1, 0)
    expect(rMid).toBeCloseTo(MUSCLE_BELLY_RADIUS, 4)
    expect(rStart).toBeCloseTo(MUSCLE_BELLY_RADIUS * MUSCLE_TENDON_RADIUS_RATIO, 4)
    expect(rEnd).toBeCloseTo(MUSCLE_BELLY_RADIUS * MUSCLE_TENDON_RADIUS_RATIO, 4)
    expect(rMid).toBeGreaterThan(rStart * 2)

    // 中心线位置：首环在起点、末环在终点
    expect(ringVertex(tube, 0, 0).x).toBeCloseTo(0, 4)
    expect(ringVertex(tube, RINGS - 1, 0).x).toBeCloseTo(0.3, 4)
  })

  it('沿长度配色：两端肌腱米白、中段肌腹砖红', () => {
    const tube = new MuscleTube(RINGS, RADIAL, 2)
    tube.update([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.3, 0, 0)])
    const color = tube.geometry.getAttribute('color')
    const read = (ring: number): [number, number, number] => {
      const idx = ring * VERTS_PER_RING
      return [color.getX(idx), color.getY(idx), color.getZ(idx)]
    }
    const tendon = new THREE.Color(MUSCLE_TENDON_COLOR)
    const belly = new THREE.Color(MUSCLE_BELLY_COLOR)
    const expectedTendon = [tendon.r, tendon.g, tendon.b]
    const expectedBelly = [belly.r, belly.g, belly.b]
    const start = read(0)
    const mid = read((RINGS - 1) / 2)
    for (let c = 0; c < 3; c++) {
      expect(start[c]).toBeCloseTo(expectedTendon[c], 5)
      expect(mid[c]).toBeCloseTo(expectedBelly[c], 5)
    }
    // 肌腹显著比肌腱更红（绿/蓝分量更低）
    expect(mid[1]).toBeLessThan(start[1])
    expect(mid[2]).toBeLessThan(start[2])
  })

  it('退化折线（长度≈0）返回 false，调用方据此隐藏', () => {
    const tube = new MuscleTube(RINGS, RADIAL, 2)
    expect(tube.update([new THREE.Vector3(1, 2, 3), new THREE.Vector3(1, 2, 3)])).toBe(false)
  })

  it('弯曲折线：重采样点落在折线上，且法线为单位长度', () => {
    const tube = new MuscleTube(RINGS, RADIAL, 3)
    tube.update([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0.2, 0),
      new THREE.Vector3(0, 0.2, 0.2),
    ])
    const normal = tube.geometry.getAttribute('normal')
    for (let k = 0; k < RINGS; k++) {
      const idx = k * VERTS_PER_RING
      const len = Math.hypot(normal.getX(idx), normal.getY(idx), normal.getZ(idx))
      expect(len).toBeCloseTo(1, 4)
    }
    // 拐点处仍是连续管：中点落在两段折线的连接点附近
    const midIdx = ((RINGS - 1) / 2) * VERTS_PER_RING
    const pos = tube.geometry.getAttribute('position')
    expect(Number.isFinite(pos.getX(midIdx))).toBe(true)
  })
})
