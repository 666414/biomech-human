/**
 * 肌肉示意管几何（écorché 风格近似）。
 *
 * 输入仍是 `muscle-meta.json` 的肌腱站点折线（每个站点绑定一个 body 节点），
 * 但渲染不再是「每段一根等半径圆柱」，而是把整条折线重采样成一根管：
 *
 * - 半径沿弧长做纺锤剖面：中段肌腹最粗、两端肌腱细（参考图的肌肉轮廓）；
 * - 顶点色沿长度从肌腹砖红过渡到两端肌腱米白；
 * - UV：u 绕周向、v 沿长度，供纤维条纹 bump 贴图使用；
 * - 几何直接写在**世界坐标**里，每帧由调用方传入折线世界坐标重写，
 *   与既有 localToWorld → 管段更新的渲染逻辑一致。
 *
 * 纯几何模块（不依赖 DOM），可在 node 环境下单测。
 */
import * as THREE from 'three'

/** 肌腹基色（参考图取样的砖红） */
export const MUSCLE_BELLY_COLOR = 0xbb5540
/** 肌腱 / 筋膜色（参考图取样的米白） */
export const MUSCLE_TENDON_COLOR = 0xece2cd
/** 肌腹最大半径（m）：参考图肌腹的视觉体量，需粗于旧版 9mm 圆柱 */
export const MUSCLE_BELLY_RADIUS = 0.014
/** 肌腱端半径 / 肌腹半径 */
export const MUSCLE_TENDON_RADIUS_RATIO = 0.3
/** 两端肌腱色占据的长度比例（单侧） */
const TENDON_SPAN = 0.12

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

/** 平滑阶跃（0→1），用于肌腱/肌腹过渡 */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

/**
 * 肌腹权重：两端趋 0（肌腱），中段为 1（肌腹）。
 * 用 smoothstep 而非 sin 幂次，保证中段有一整段等宽的「肌腹平台」。
 */
export function muscleBellyWeight(s: number): number {
  const t = clamp01(s)
  return smoothstep(0, TENDON_SPAN, t) * smoothstep(0, TENDON_SPAN, 1 - t)
}

/** 沿弧长的半径剖面（m）：s 为 0→1 的归一化弧长 */
export function muscleRadiusAt(s: number, bellyRadius = MUSCLE_BELLY_RADIUS): number {
  const k = MUSCLE_TENDON_RADIUS_RATIO + (1 - MUSCLE_TENDON_RADIUS_RATIO) * muscleBellyWeight(s)
  return bellyRadius * k
}

/**
 * 一根肌肉管：构造时一次性分配顶点缓冲与静态属性（uv / 顶点色），
 * 之后每次 `update(points)` 只重写 position + normal。
 */
export class MuscleTube {
  readonly geometry: THREE.BufferGeometry
  /** 沿长度的环数（≥3） */
  readonly ringCount: number
  /** 周向分段数 */
  readonly radial: number

  private readonly bellyRadius: number
  /** 重采样后的中心线（世界坐标） */
  private readonly centers: THREE.Vector3[]
  /** 折线累计弧长 */
  private readonly cum: Float32Array
  private readonly position: THREE.BufferAttribute

  private readonly tangent = new THREE.Vector3()
  private readonly prevTangent = new THREE.Vector3(1, 0, 0)
  private readonly normal = new THREE.Vector3()
  private readonly binormal = new THREE.Vector3()
  private readonly firstTangent = new THREE.Vector3()
  private readonly lastTangent = new THREE.Vector3()
  private readonly quat = new THREE.Quaternion()

  constructor(ringCount: number, radial: number, pointCount: number, bellyRadius = MUSCLE_BELLY_RADIUS) {
    this.ringCount = Math.max(3, Math.floor(ringCount))
    this.radial = Math.max(3, Math.floor(radial))
    this.bellyRadius = bellyRadius
    this.centers = Array.from({ length: this.ringCount }, () => new THREE.Vector3())
    this.cum = new Float32Array(Math.max(2, pointCount))

    const vertsPerRing = this.radial + 1
    const vertexCount = this.ringCount * vertsPerRing + 2
    const positions = new Float32Array(vertexCount * 3)
    const normals = new Float32Array(vertexCount * 3)
    const uvs = new Float32Array(vertexCount * 2)
    const colors = new Float32Array(vertexCount * 3)

    const bellyColor = new THREE.Color(MUSCLE_BELLY_COLOR)
    const tendonColor = new THREE.Color(MUSCLE_TENDON_COLOR)
    const c = new THREE.Color()
    for (let k = 0; k < this.ringCount; k++) {
      const s = this.ringCount > 1 ? k / (this.ringCount - 1) : 0
      c.copy(tendonColor).lerp(bellyColor, muscleBellyWeight(s))
      for (let i = 0; i <= this.radial; i++) {
        const vi = k * vertsPerRing + i
        uvs[vi * 2] = i / this.radial
        uvs[vi * 2 + 1] = s
        colors[vi * 3] = c.r
        colors[vi * 3 + 1] = c.g
        colors[vi * 3 + 2] = c.b
      }
    }
    // 两端锥尖顶点：颜色取端点方肌腱色
    const tip0 = this.ringCount * vertsPerRing
    const tip1 = tip0 + 1
    for (const [vi, s] of [
      [tip0, 0],
      [tip1, 1],
    ] as const) {
      uvs[vi * 2] = 0.5
      uvs[vi * 2 + 1] = s
      colors[vi * 3] = tendonColor.r
      colors[vi * 3 + 1] = tendonColor.g
      colors[vi * 3 + 2] = tendonColor.b
    }

    // 侧壁索引（绕向使法线朝外，见 update 中 (tangent, normal, binormal) 右手系）
    const indices: number[] = []
    for (let k = 0; k < this.ringCount - 1; k++) {
      for (let i = 0; i < this.radial; i++) {
        const a = k * vertsPerRing + i
        const b = a + 1
        const d = a + vertsPerRing
        const dd = d + 1
        indices.push(a, b, d, b, dd, d)
      }
    }
    // 两端锥形封口
    const lastBase = (this.ringCount - 1) * vertsPerRing
    for (let i = 0; i < this.radial; i++) {
      indices.push(tip0, i + 1, i)
      indices.push(tip1, lastBase + i, lastBase + i + 1)
    }

    this.geometry = new THREE.BufferGeometry()
    this.position = new THREE.BufferAttribute(positions, 3)
    this.position.setUsage(THREE.DynamicDrawUsage)
    this.geometry.setAttribute('position', this.position)
    this.geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
    this.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    this.geometry.setIndex(indices)
  }

  /** 顶点数（含两端锥尖），供测试/调试 */
  get vertexCount(): number {
    return this.ringCount * (this.radial + 1) + 2
  }

  /**
   * 用一条世界坐标折线重写管体。返回 false 表示折线退化（长度≈0），调用方应隐藏。
   * 折线点数须与构造时的 pointCount 一致。
   */
  update(points: THREE.Vector3[]): boolean {
    const n = points.length
    if (n < 2) return false
    let total = 0
    this.cum[0] = 0
    for (let i = 1; i < n; i++) {
      total += points[i].distanceTo(points[i - 1])
      this.cum[i] = total
    }
    if (total < 1e-6) return false

    // 1) 按均匀弧长重采样中心线（保证纺锤剖面不随折线段长短失真）
    const centers = this.centers
    let seg = 0
    for (let k = 0; k < this.ringCount; k++) {
      const target = (total * k) / (this.ringCount - 1)
      while (seg < n - 2 && this.cum[seg + 1] < target) seg += 1
      const span = this.cum[seg + 1] - this.cum[seg]
      const t = span > 1e-9 ? clamp01((target - this.cum[seg]) / span) : 0
      centers[k].lerpVectors(points[seg], points[seg + 1], t)
    }

    // 2) 沿线推进切向 + 平行传输法向（避免扭转导致条纹打旋）
    const arr = this.position.array as Float32Array
    const vertsPerRing = this.radial + 1
    for (let k = 0; k < this.ringCount; k++) {
      const tangent = this.tangent
      if (k === 0) tangent.subVectors(centers[1], centers[0])
      else if (k === this.ringCount - 1) tangent.subVectors(centers[k], centers[k - 1])
      else tangent.subVectors(centers[k + 1], centers[k - 1])
      if (tangent.lengthSq() < 1e-12) tangent.copy(this.prevTangent)
      tangent.normalize()
      if (k === 0) this.firstTangent.copy(tangent)
      if (k === this.ringCount - 1) this.lastTangent.copy(tangent)

      const normal = this.normal
      if (k === 0) {
        normal.set(0, 0, 1)
        if (Math.abs(tangent.z) > 0.9) normal.set(0, 1, 0)
        normal.addScaledVector(tangent, -normal.dot(tangent))
      } else {
        this.quat.setFromUnitVectors(this.prevTangent, tangent)
        normal.applyQuaternion(this.quat)
        normal.addScaledVector(tangent, -normal.dot(tangent))
      }
      if (normal.lengthSq() < 1e-12) normal.set(1, 0, 0)
      normal.normalize()
      this.prevTangent.copy(tangent)
      this.binormal.crossVectors(tangent, normal)

      const s = this.ringCount > 1 ? k / (this.ringCount - 1) : 0
      const r = muscleRadiusAt(s, this.bellyRadius)
      const center = centers[k]
      const nx = normal.x
      const ny = normal.y
      const nz = normal.z
      const bx = this.binormal.x
      const by = this.binormal.y
      const bz = this.binormal.z
      const base = k * vertsPerRing
      for (let i = 0; i <= this.radial; i++) {
        const a = (i / this.radial) * Math.PI * 2
        const ca = Math.cos(a) * r
        const sa = Math.sin(a) * r
        const o = (base + i) * 3
        arr[o] = center.x + nx * ca + bx * sa
        arr[o + 1] = center.y + ny * ca + by * sa
        arr[o + 2] = center.z + nz * ca + bz * sa
      }
    }

    // 3) 两端锥尖（收拢成小圆头，避免看到空心截面）
    const tip0Offset = muscleRadiusAt(0, this.bellyRadius) * 0.85
    const tip1Offset = muscleRadiusAt(1, this.bellyRadius) * 0.85
    const tipBase = this.ringCount * vertsPerRing
    const c0 = centers[0]
    const c1 = centers[this.ringCount - 1]
    arr[tipBase * 3] = c0.x - this.firstTangent.x * tip0Offset
    arr[tipBase * 3 + 1] = c0.y - this.firstTangent.y * tip0Offset
    arr[tipBase * 3 + 2] = c0.z - this.firstTangent.z * tip0Offset
    arr[(tipBase + 1) * 3] = c1.x + this.lastTangent.x * tip1Offset
    arr[(tipBase + 1) * 3 + 1] = c1.y + this.lastTangent.y * tip1Offset
    arr[(tipBase + 1) * 3 + 2] = c1.z + this.lastTangent.z * tip1Offset

    this.position.needsUpdate = true
    this.geometry.computeVertexNormals()
    return true
  }

  dispose(): void {
    this.geometry.dispose()
  }
}
