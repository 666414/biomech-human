/**
 * 3D 场景管理器（板块 01，非 React）：模型加载、相机交互、拾取高亮、
 * 分层显示、姿态写入。生命周期由 Viewport 组件驱动。
 *
 * 世界坐标系：Z-up（与 MuJoCo/XML 一致，P1 转换未重定向，pelvis 的 Rx(90°)
 * 建模约定 quat 原样保留），地面网格需旋转到 XY 平面。
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { JointAngles, PartGroup, RigMeta } from '../types'
import { applyPose, buildPoseMap, type PoseMap } from './poseMap'

const HIGHLIGHT_COLOR = 0x33ddff
const GHOST_OPACITY = 0.15

/** 高亮会话开始时记录的材质原始属性（恢复用） */
interface MaterialSnapshot {
  material: THREE.MeshStandardMaterial
  emissive: THREE.Color
  emissiveIntensity: number
  opacity: number
  transparent: boolean
  depthWrite: boolean
}

/** 视角预设：front=正面 / side=侧面 / reset=复位（初始机位） */
export type ViewPreset = 'front' | 'side' | 'reset'

/** 画质档位（01 文档降质预设）：low 关抗锯齿 + 像素比上限 1 */
export type Quality = 'low' | 'high'

export class SceneManager {
  readonly scene: THREE.Scene
  readonly camera: THREE.PerspectiveCamera
  readonly renderer: THREE.WebGLRenderer
  readonly controls: OrbitControls

  private modelRoot: THREE.Object3D | null = null
  private poseMapState: PoseMap | null = null
  private rig: RigMeta | null = null
  /** 加载时去共享后的逐 mesh 材质 */
  private meshMaterials = new Map<THREE.Mesh, THREE.MeshStandardMaterial>()
  /** 当前高亮会话的材质快照 */
  private snapshots: MaterialSnapshot[] = []
  private highlightedPart: string | null = null

  private raycaster = new THREE.Raycaster()
  private rafId = 0
  private disposed = false
  private ro: ResizeObserver | null = null

  /** 渲染循环前回调（Viewport 借此每帧读 store → setPose，保证同帧生效） */
  onFrame: ((sm: SceneManager) => void) | null = null

  /** 已加载的 glTF 场景根（未加载为 null），FK 对账用 */
  get model(): THREE.Object3D | null {
    return this.modelRoot
  }

  /** 姿态映射（模型+rig 就绪后可用）；rest 恒为模型静止位，FK 对账依赖此性质 */
  get poseMap(): PoseMap | null {
    return this.poseMapState
  }

  private readonly canvas: HTMLCanvasElement
  private quality: Quality

  constructor(canvas: HTMLCanvasElement, quality: Quality = 'high') {
    this.canvas = canvas
    this.quality = quality
    // 抗锯齿是 WebGL 上下文属性，仅在创建时生效：low 档在此关闭
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: quality === 'high' })
    this.renderer.setPixelRatio(this.targetPixelRatio())

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x101418)

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.05, 50)
    this.camera.position.set(3.2, 0.4, 1.1)
    this.camera.up.set(0, 0, 1) // Z-up

    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.target.set(0, 0, 0.95)

    // 灯光：环境 + 主方向光（Z-up 世界，光从头顶偏前上方来）
    const ambient = new THREE.AmbientLight(0xffffff, 0.55)
    const dir = new THREE.DirectionalLight(0xffffff, 1.6)
    dir.position.set(2, -3, 5)
    this.scene.add(ambient, dir)

    // 淡色地面网格（GridHelper 默认躺 XZ 平面，转到 XY = Z-up 地面）
    const grid = new THREE.GridHelper(8, 32, 0x3a4450, 0x232a32)
    grid.rotation.x = Math.PI / 2
    this.scene.add(grid)

    this.handleResize()
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this.handleResize())
      this.ro.observe(canvas)
    }
    this.startLoop()
  }

  // ---------- 模型 ----------

  /** rig 元数据需外部传入；与模型都就绪后自动建姿态映射 */
  setRig(rig: RigMeta): void {
    this.rig = rig
    this.tryBuildPoseMap()
  }

  /** 加载 glb（未启用 Draco——模型未压缩，仅留接口） */
  loadModel(url: string, onProgress?: (pct: number) => void): Promise<void> {
    const loader = new GLTFLoader()
    const draco = new DRACOLoader() // 模型未 Draco 压缩，不解码器路径；保留扩展点
    draco.dispose()
    loader.setDRACOLoader(draco)

    return new Promise((resolve, reject) => {
      loader.load(
        url,
        (gltf) => {
          if (this.disposed) return resolve()
          this.modelRoot = gltf.scene
          this.scene.add(gltf.scene)
          this.deshareMaterials(gltf.scene)
          this.tryBuildPoseMap()
          resolve()
        },
        (ev) => {
          if (onProgress && ev.total > 0) onProgress(Math.round((ev.loaded / ev.total) * 100))
        },
        (err) => reject(err instanceof Error ? err : new Error(String(err))),
      )
    })
  }

  private tryBuildPoseMap(): void {
    if (this.modelRoot && this.rig && !this.poseMapState) {
      this.poseMapState = buildPoseMap(this.modelRoot, this.rig)
    }
  }

  /**
   * 材质去共享：每个 mesh 独享 clone，保证高亮/透明互不影响
   * （glb 中多个 body 可能共享同一材质实例）。
   */
  private deshareMaterials(root: THREE.Object3D): void {
    root.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return
      const mat = obj.material
      const clone = (m: THREE.Material) => {
        const c = m.clone()
        c.name = m.name
        return c
      }
      obj.material = Array.isArray(mat) ? mat.map(clone) : clone(mat)
      for (const m of Array.isArray(obj.material) ? obj.material : [obj.material]) {
        if (m instanceof THREE.MeshStandardMaterial) {
          this.meshMaterials.set(obj as THREE.Mesh, m)
          break // 一个 mesh 记一个主材质（本模型 mesh 均单材质）
        }
      }
    })
  }

  // ---------- 画质（01 文档降质预设） ----------

  /** 各档位像素比上限：high 1.5，low 1（低端机降采样保帧率） */
  private targetPixelRatio(): number {
    return this.quality === 'low' ? 1 : Math.min(window.devicePixelRatio, 1.5)
  }

  /** 运行期切换画质档（重设像素比；抗锯齿受限于创建时的上下文属性，low 建档才生效） */
  setQuality(q: Quality): void {
    if (q === this.quality) return
    this.quality = q
    this.renderer.setPixelRatio(this.targetPixelRatio())
  }

  // ---------- 姿态 ----------

  /** 每帧驱动：applyPose 直接改局部变换，无对象分配 */
  setPose(q: JointAngles): void {
    if (this.poseMapState) applyPose(this.poseMapState, q)
  }

  // ---------- 拾取与高亮 ----------

  /** 屏幕拾取：NDC 坐标 → 命中部位 id（空白/无映射返回 null） */
  pickAt(ndcX: number, ndcY: number): string | null {
    if (!this.modelRoot || !this.poseMapState) return null
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera)
    const hits = this.raycaster.intersectObject(this.modelRoot, true)
    for (const hit of hits) {
      if (!this.isVisible(hit.object)) continue
      // 向上找具名 body 节点（mesh 子节点命名为 <partId>__<geom>，不在映射中）
      let cur: THREE.Object3D | null = hit.object
      while (cur) {
        if (this.poseMapState.nodes.has(cur.name)) return cur.name
        cur = cur.parent
      }
    }
    return null
  }

  private isVisible(obj: THREE.Object3D): boolean {
    for (let o: THREE.Object3D | null = obj; o; o = o.parent) {
      if (!o.visible) return false
    }
    return true
  }

  /**
   * 高亮部位：命中部位 emissive 高亮，其余部位半透明遮罩。
   * partId 为 null 或未命中时恢复。材质已在加载时去共享，直接改属性并快照还原。
   */
  highlight(partId: string | null): void {
    if (!this.modelRoot || !this.rig) return
    // 还原上一会话
    for (const s of this.snapshots) {
      s.material.emissive.copy(s.emissive)
      s.material.emissiveIntensity = s.emissiveIntensity
      s.material.opacity = s.opacity
      s.material.transparent = s.transparent
      s.material.depthWrite = s.depthWrite
      s.material.needsUpdate = false
    }
    this.snapshots = []
    this.highlightedPart = partId
    if (!partId || !this.poseMapState?.nodes.has(partId)) return

    for (const [mesh, mat] of this.meshMaterials) {
      const part = this.partOfMesh(mesh)
      if (!part) continue
      this.snapshots.push({
        material: mat,
        emissive: mat.emissive.clone(),
        emissiveIntensity: mat.emissiveIntensity,
        opacity: mat.opacity,
        transparent: mat.transparent,
        depthWrite: mat.depthWrite,
      })
      if (part === partId) {
        mat.emissive.setHex(HIGHLIGHT_COLOR)
        mat.emissiveIntensity = 0.6
      } else {
        mat.opacity = GHOST_OPACITY
        mat.transparent = true
        mat.depthWrite = false
      }
      mat.needsUpdate = true
    }
  }

  /** mesh 所属部位 id：向上遍历 parent 命中 poseMap.nodes */
  private partOfMesh(mesh: THREE.Object3D): string | null {
    let cur: THREE.Object3D | null = mesh
    while (cur) {
      if (this.poseMapState?.nodes.has(cur.name)) return cur.name
      cur = cur.parent
    }
    return null
  }

  // ---------- 分层 ----------

  setLayerVisible(group: PartGroup, visible: boolean): void {
    if (!this.rig || !this.poseMapState) return
    for (const part of this.rig.parts) {
      if (part.group !== group) continue
      const node = this.poseMapState.nodes.get(part.id)
      if (node) node.visible = visible
    }
  }

  setLayerOpacity(group: PartGroup, v: number): void {
    if (!this.rig) return
    const opacity = Math.min(Math.max(v, 0), 1)
    for (const [mesh, mat] of this.meshMaterials) {
      const part = this.partOfMesh(mesh)
      if (part === this.highlightedPart) continue // 高亮态不动
      const groupOf = this.rig.parts.find((p) => p.id === part)?.group
      if (groupOf !== group) continue
      mat.opacity = opacity
      mat.transparent = opacity < 1
      mat.depthWrite = opacity >= 1
      mat.needsUpdate = true
    }
  }

  // ---------- 相机 ----------

  /** 部位信息（供 UI 显示中英文名与分层归属；未知 id 返回 null） */
  getSelectedInfo(partId: string): { id: string; zh: string; en: string; group: PartGroup } | null {
    const part = this.rig?.parts.find((p) => p.id === partId)
    if (!part) return null
    return { id: part.id, zh: part.names.zh, en: part.names.en, group: part.group }
  }

  /** 视角预设：模型面向 +x（步态前进方向）。front=正面(x+)，side=侧面(y+)，reset=初始机位 */
  setView(view: ViewPreset): void {
    const d = 3.2
    if (view === 'front') {
      this.camera.position.set(d, 0, 1.0)
    } else if (view === 'side') {
      this.camera.position.set(0, d, 1.0)
    } else {
      this.camera.position.set(3.2, 0.4, 1.1) // 与构造函数一致的初始机位
    }
    this.controls.target.set(0, 0, 0.95)
    this.controls.update()
  }

  /** 相机聚焦部位：target 移到该部位世界坐标，相机拉近 */
  focusPart(partId: string): void {
    const node = this.poseMapState?.nodes.get(partId)
    if (!node) return
    const wp = new THREE.Vector3()
    node.getWorldPosition(wp)
    const offset = this.camera.position.clone().sub(this.controls.target)
    if (offset.lengthSq() < 1e-6) offset.set(0.5, -0.5, 0.3)
    offset.setLength(0.55)
    this.controls.target.copy(wp)
    this.camera.position.copy(wp).add(offset)
    this.controls.update()
  }

  // ---------- 循环与生命周期 ----------

  private startLoop(): void {
    const tick = () => {
      if (this.disposed) return
      this.rafId = requestAnimationFrame(tick)
      this.onFrame?.(this)
      this.controls.update()
      this.renderer.render(this.scene, this.camera)
    }
    this.rafId = requestAnimationFrame(tick)
  }

  handleResize(): void {
    const w = this.canvas.clientWidth || 1
    const h = this.canvas.clientHeight || 1
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  dispose(): void {
    this.disposed = true
    cancelAnimationFrame(this.rafId)
    this.ro?.disconnect()
    this.highlight(null)
    this.controls.dispose()
    this.modelRoot?.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose()
        for (const m of Array.isArray(obj.material) ? obj.material : [obj.material]) m.dispose()
      }
    })
    this.scene.remove(this.modelRoot ?? new THREE.Object3D())
    this.renderer.dispose()
  }
}
