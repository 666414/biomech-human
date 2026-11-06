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
import type { JointAngles, MuscleMeta, PartGroup, RigMeta } from '../types'
import { createMuscleMaterial } from './muscleMaterial'
import { MuscleTube } from './muscleTube'
import { applyPose, buildPoseMap, type PoseMap } from './poseMap'
import { rebindSkinnedMeshes } from './skinBind'

const HIGHLIGHT_COLOR = 0x33ddff
const GHOST_OPACITY = 0.15

/** 体表基色（源模型 class="skin" 的 rgba 0.8 0.7 0.5，收敛为类肤色） */
const SKIN_COLOR = 0xd9b38c
/**
 * 激活度染色（%MVC）：肌腹/肌腱的解剖配色写在顶点色里（见 muscleTube.ts），
 * 材质 color 只做「静息中性白 → 激活暖红提亮」的乘法，保留原静息暗红→激活亮红的语义。
 */
const MUSCLE_TINT_REST = new THREE.Color(0xffffff)
const MUSCLE_TINT_ACTIVE = new THREE.Color().setRGB(1.5, 0.78, 0.66)
/** 肌肉管周向分段数（管越粗、条纹越细密） */
const MUSCLE_RADIAL_SEGMENTS = 10
/** 每块肌肉的环数：按折线点数加密，二点肌肉也能显出纺锤形肌腹 */
const MUSCLE_RING_MIN = 8
const MUSCLE_RING_MAX = 17

/** 模型加载失败自动重试（下载/解析失败任意原因，含网络偶发 ERR_ABORTED）：上限次数与延迟 */
const MODEL_LOAD_MAX_RETRIES = 1
const MODEL_LOAD_RETRY_DELAY_MS = 1500

/** human.glb 已知总大小（字节，Draco 压缩后实测）：响应缺 content-length 时进度兜底 */
const MODEL_KNOWN_BYTES = 1014040

/**
 * Draco 解码器（模块级单例）：wasm 解码器只实例化一次，跨 SceneManager 实例
 * （手动重试会整体重建）复用。解码器文件由 sync-assets 复制到 public/draco/
 * （three 自带版本，与 runtime 的 DRACOLoader 同源），相对路径 './draco/' 适配任意 base。
 */
let dracoLoader: DRACOLoader | null = null
function getDracoLoader(): DRACOLoader {
  if (!dracoLoader) {
    dracoLoader = new DRACOLoader()
    dracoLoader.setDecoderPath('./draco/')
  }
  return dracoLoader
}

/** 调试探针状态（Viewport 写入容器 DOM 的 data-debug 属性；供自动化验收与用户排障） */
export interface DebugState {
  /** gltf onLoad 成功且已挂入场景 */
  modelLoaded: boolean
  /** 模型加载尝试次数（手动重试重建实例后归零） */
  attempts: number
  /** 最近一次加载/解析错误 message */
  lastError: string | null
  /** 模型具名 body 节点数（glb 契约：body 节点 ≈ rig body 数 80） */
  bodyCount: number
  /** 渲染循环已执行帧数（RAF 计数） */
  renderFrames: number
  /** 各图层可绘制对象数（骨骼/皮肤=网格数，肌肉=整根管数） */
  layerMeshes: Record<PartGroup, number>
}

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

/** 单块肌肉的运行时几何：折线点绑定到 body 节点，每帧按世界坐标重写整根管 */
interface MuscleSegment {
  name: string
  material: THREE.MeshStandardMaterial
  /** 整条肌肉一根管（纺锤剖面 + 沿长度肌腱/肌腹配色） */
  tube: MuscleTube
  mesh: THREE.Mesh
  points: Array<{ node: THREE.Object3D | null; local: THREE.Vector3 }>
  /** 每帧复用的世界坐标缓冲 */
  world: THREE.Vector3[]
}

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

  /** 图层绑定（模型 + rig 就绪后建立）：mesh → 图层分组 */
  private meshGroup = new Map<THREE.Mesh, PartGroup>()
  /** 图层控件状态（控件可能早于模型就绪下发，先存后应用） */
  private layerVisible: Record<PartGroup, boolean> = {
    skeleton: true,
    muscle: true,
    skin: true,
  }
  private layerOpacity: Record<PartGroup, number> = { skeleton: 1, muscle: 1, skin: 1 }
  /** 肌肉示意线数据与运行时几何 */
  private muscleMeta: MuscleMeta | null = null
  private muscleRoot: THREE.Group | null = null
  private muscleSegments: MuscleSegment[] = []
  private activeMuscleNames = new Set<string>()
  private muscleActivation = new Map<string, number>()

  private raycaster = new THREE.Raycaster()
  private rafId = 0
  private disposed = false
  private ro: ResizeObserver | null = null
  /** 本次 loadModel 已自动重试次数（手动重试会整体重建实例，计数随之归零） */
  private loadRetries = 0
  // ---------- 调试探针状态（debugState 暴露） ----------
  /** 模型加载尝试次数 */
  private loadAttempts = 0
  /** 最近一次加载/解析错误 message */
  private lastError: string | null = null
  /** gltf onLoad 成功且已挂入场景 */
  private modelLoaded = false
  /** 模型具名 body 节点数（加载完成时统计一次） */
  private bodyCount = 0
  /** 渲染循环已执行帧数 */
  private renderFrames = 0
  /**
   * 按需渲染脏标记：仅交互/图层/姿态/数据变化时提交 WebGL，空闲帧跳过渲染。
   * （headless 软光栅下连续 RAF 渲染是主线程长任务主因；真机上同为省电优化）
   */
  private needsRender = true
  /** 上一帧应用的姿态值（相同姿态跳过 applyPose/肌肉重写/渲染） */
  private lastPose: JointAngles | null = null

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
    // 按需渲染：轨道交互（含阻尼惯性期间）每次相机变化都标脏
    this.controls.addEventListener('change', () => {
      this.needsRender = true
    })

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

  /**
   * 加载 glb（Draco 压缩：KHR_draco_mesh_compression，节点层级/变换不变，
   * poseMap/FK 对账契约不受影响）。解码器单例见 getDracoLoader()。
   * 自管 fetch 流式读取完整字节后交给 loader.parse（不再走 FileLoader 流式请求，
   * 绕开自动化浏览器中 GLTFLoader.load 报 net::ERR_ABORTED 的问题）。
   * 下载/解析失败（任意原因）自动重试 MODEL_LOAD_MAX_RETRIES 次
   * （间隔 MODEL_LOAD_RETRY_DELAY_MS，console.warn 记录），仍失败才 reject
   * 进错误态；重试期间 onProgress 照常上报（进度从 0 重新计）。
   */
  loadModel(url: string, onProgress?: (pct: number) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const attempt = (): void => {
        this.loadGltfOnce(url, onProgress).then(resolve, (err: Error) => {
          if (this.disposed) return reject(err)
          if (this.loadRetries >= MODEL_LOAD_MAX_RETRIES) return reject(err)
          this.loadRetries += 1
          console.warn(
            `[SceneManager] 模型加载失败，${MODEL_LOAD_RETRY_DELAY_MS}ms 后自动重试（第 ${this.loadRetries}/${MODEL_LOAD_MAX_RETRIES} 次）：`,
            err,
          )
          setTimeout(() => {
            if (this.disposed) return reject(err)
            attempt()
          }, MODEL_LOAD_RETRY_DELAY_MS)
        })
      }
      attempt()
    })
  }

  /** 单次 glb 加载（loadModel 的重试编排单元）：fetch 流式下载 → loader.parse */
  private async loadGltfOnce(url: string, onProgress?: (pct: number) => void): Promise<void> {
    this.loadAttempts += 1
    const loader = new GLTFLoader()
    loader.setDRACOLoader(getDracoLoader())

    let buffer: ArrayBuffer
    try {
      buffer = await this.fetchGlb(url, onProgress)
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e))
      this.lastError = err.message
      throw err
    }
    if (this.disposed) throw new Error('模型加载已取消（实例已销毁）')

    await new Promise<void>((resolve, reject) => {
      loader.parse(
        buffer,
        '',
        (gltf) => {
          try {
            if (this.disposed) return resolve()
            this.modelRoot = gltf.scene
            this.scene.add(gltf.scene)
            // 蒙皮网格重绑：GLTFLoader 以单位阵绑定 + attached 模式抵消网格世界变换，
            // skin_mesh 挂在 pelvis（非单位变换）下会导致皮肤留在局部空间（躺卧错位）
            rebindSkinnedMeshes(gltf.scene)
            this.deshareMaterials(gltf.scene)
            this.bodyCount = this.countBodyNodes(gltf.scene)
            this.modelLoaded = true
            this.needsRender = true // 异步加载完成后必须补一帧
            this.tryBuildPoseMap()
            resolve()
          } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e))
            this.lastError = err.message
            reject(err)
          }
        },
        (err: unknown) => {
          const e = err instanceof Error ? err : new Error(String(err))
          this.lastError = e.message
          reject(e)
        },
      )
    })
  }

  /** 流式下载 glb：累积字节分块，按 content-length（缺失用已知大小兜底）上报进度 */
  private async fetchGlb(url: string, onProgress?: (pct: number) => void): Promise<ArrayBuffer> {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`模型下载失败：HTTP ${res.status} ${res.statusText}`)
    const total = Number(res.headers.get('content-length')) || MODEL_KNOWN_BYTES

    if (!res.body) {
      // 无流式 body（极端环境）：整体读入，进度直接到 100
      const buf = await res.arrayBuffer()
      onProgress?.(100)
      return buf
    }

    const reader = res.body.getReader()
    const chunks: Uint8Array[] = []
    let loaded = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      loaded += value.byteLength
      if (onProgress && total > 0) onProgress(Math.min(Math.round((loaded / total) * 100), 100))
      if (this.disposed) {
        void reader.cancel().catch(() => {})
        throw new Error('模型加载已取消（实例已销毁）')
      }
    }
    const out = new Uint8Array(loaded)
    let off = 0
    for (const chunk of chunks) {
      out.set(chunk, off)
      off += chunk.byteLength
    }
    return out.buffer
  }

  /** 统计具名 body 节点数（glb 契约：body 节点名 = XML body id，mesh 子节点含 '__'） */
  private countBodyNodes(root: THREE.Object3D): number {
    let n = 0
    root.traverse((obj) => {
      if (obj.name && !obj.name.includes('__')) n += 1
    })
    return n
  }

  /** 调试探针：加载与渲染关键状态（Viewport 实时写入容器 DOM 供自动化验收/排障） */
  debugState(): DebugState {
    return {
      modelLoaded: this.modelLoaded,
      attempts: this.loadAttempts,
      lastError: this.lastError,
      bodyCount: this.bodyCount,
      renderFrames: this.renderFrames,
      layerMeshes: this.countLayerMeshes(),
    }
  }

  /** 各图层可绘制对象数（骨骼/皮肤按网格计，肌肉按整根管计） */
  private countLayerMeshes(): Record<PartGroup, number> {
    const counts: Record<PartGroup, number> = { skeleton: 0, muscle: 0, skin: 0 }
    for (const group of this.meshGroup.values()) counts[group] += 1
    counts.muscle += this.muscleSegments.length
    return counts
  }

  private tryBuildPoseMap(): void {
    if (this.modelRoot && this.rig && !this.poseMapState) {
      this.poseMapState = buildPoseMap(this.modelRoot, this.rig)
      this.bindLayers()
      this.rebuildMuscles()
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

  /** 每帧驱动：姿态与上一帧相同则整帧跳过（applyPose/肌肉重写/渲染全省） */
  setPose(q: JointAngles): void {
    if (this.poseUnchanged(q)) return
    if (this.poseMapState) applyPose(this.poseMapState, q)
    this.updateMuscleGeometry()
    this.lastPose = { ...q }
    this.needsRender = true
  }

  /** 姿态值比较：键集与数值全同视为未变化（键集恒为 rig joints） */
  private poseUnchanged(q: JointAngles): boolean {
    const last = this.lastPose
    if (!last) return false
    let n = 0
    for (const k in q) {
      n += 1
      if (last[k] !== q[k]) return false
    }
    return n === Object.keys(last).length
  }

  /** 外部绕过 setPose 直接改姿态树（FK 对账）后调用：强制下一帧重新应用姿态 */
  invalidatePose(): void {
    this.lastPose = null
    this.needsRender = true
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
    this.needsRender = true
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

  /**
   * 图层显隐：按 mesh 逐个控制。骨骼与皮肤网格同挂在 body 节点下，
   * 不能整节点隐藏（否则骨骼关掉会连带隐藏皮肤），故一律落到 mesh.visible。
   * 肌肉为运行时几何，整体切换 muscleRoot。
   */
  setLayerVisible(group: PartGroup, visible: boolean): void {
    this.layerVisible[group] = visible
    this.applyLayerVisibility()
    this.needsRender = true
  }

  /** 图层不透明度：只改该组材质；高亮中的部位保持高亮态 */
  setLayerOpacity(group: PartGroup, v: number): void {
    this.layerOpacity[group] = Math.min(Math.max(v, 0), 1)
    this.applyLayerOpacity(group)
    this.needsRender = true
  }

  /** 建立 mesh → 图层映射（模型与 rig 都就绪后调用一次） */
  private bindLayers(): void {
    if (!this.modelRoot) return
    this.meshGroup.clear()
    const skinNodes = new Set<string>()
    for (const a of this.rig?.attachments ?? []) {
      if (a.group === 'skin') skinNodes.add(a.id)
    }
    this.modelRoot.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return
      // 向上找最近的皮肤节点；找不到即骨骼网格
      let cur: THREE.Object3D | null = obj
      let group: PartGroup = 'skeleton'
      while (cur) {
        if (skinNodes.has(cur.name)) {
          group = 'skin'
          break
        }
        cur = cur.parent
      }
      this.meshGroup.set(obj, group)
      if (group === 'skin') {
        // 完整体表 glb 不带 NORMAL：three 对缺失法线用常量 (0,0,0)，光照会全黑。
        // 蒙皮网格按绑定姿态补算一次即可，蒙皮着色器会自动对法线施加蒙皮矩阵。
        if (!obj.geometry.getAttribute('normal')) obj.geometry.computeVertexNormals()
        for (const m of Array.isArray(obj.material) ? obj.material : [obj.material]) {
          if (!(m instanceof THREE.MeshStandardMaterial)) continue
          m.color.setHex(SKIN_COLOR)
          m.roughness = 0.9
          m.metalness = 0
          m.side = THREE.DoubleSide
        }
      }
    })
    this.applyLayerVisibility()
    this.applyLayerOpacity()
  }

  private applyLayerVisibility(): void {
    for (const [mesh, group] of this.meshGroup) mesh.visible = this.layerVisible[group]
    if (this.muscleRoot) this.muscleRoot.visible = this.layerVisible.muscle
  }

  private applyLayerOpacity(only?: PartGroup): void {
    for (const [mesh, group] of this.meshGroup) {
      if (only && group !== only) continue
      if (this.partOfMesh(mesh) === this.highlightedPart) continue // 高亮态不动
      this.applyOpacityToMesh(mesh, this.layerOpacity[group])
    }
    if (!only || only === 'muscle') {
      for (const seg of this.muscleSegments) {
        this.setMaterialOpacity(seg.material, this.layerOpacity.muscle)
      }
    }
  }

  private applyOpacityToMesh(mesh: THREE.Mesh, opacity: number): void {
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (m instanceof THREE.MeshStandardMaterial) this.setMaterialOpacity(m, opacity)
    }
  }

  private setMaterialOpacity(material: THREE.MeshStandardMaterial, opacity: number): void {
    material.opacity = opacity
    material.transparent = opacity < 1
    material.depthWrite = opacity >= 1
    material.needsUpdate = true
  }

  // ---------- 肌肉示意线 ----------

  /** 注入肌肉示意线数据（Viewport 在模型就绪后加载 muscle-meta.json） */
  setMuscleData(meta: MuscleMeta): void {
    this.muscleMeta = meta
    this.rebuildMuscles()
  }

  /** 当前场景关注的肌肉集合：只为这些执行器生成几何（避免 700 块全量渲染） */
  setActiveMuscles(names: string[]): void {
    this.activeMuscleNames = new Set(names)
    this.rebuildMuscles()
  }

  /** 肌肉激活度（%MVC，键为执行器名）：只改颜色，不改几何；值未变则整帧跳过 */
  setMuscleActivations(values: Record<string, number>): void {
    let changed = false
    for (const [name, v] of Object.entries(values)) {
      if (this.muscleActivation.get(name) !== v) {
        this.muscleActivation.set(name, v)
        changed = true
      }
    }
    if (!changed) return
    this.updateMuscleColors()
    this.needsRender = true
  }

  private updateMuscleColors(): void {
    for (const seg of this.muscleSegments) {
      const raw = (this.muscleActivation.get(seg.name) ?? 0) / 100
      const act = Math.min(Math.max(raw, 0), 1)
      seg.material.color.copy(MUSCLE_TINT_REST).lerp(MUSCLE_TINT_ACTIVE, act)
    }
  }

  /** 重建肌肉几何：每块肌肉 = 一根沿折线的纺锤形管（世界坐标，逐帧重写） */
  private rebuildMuscles(): void {
    if (this.muscleRoot) {
      this.scene.remove(this.muscleRoot)
      for (const seg of this.muscleSegments) {
        seg.material.dispose()
        seg.tube.dispose()
      }
      this.muscleRoot = null
    }
    this.muscleSegments = []
    if (!this.muscleMeta || !this.modelRoot || !this.poseMapState) return

    const root = new THREE.Group()
    root.name = 'muscle-layer'
    for (const name of this.activeMuscleNames) {
      const def = this.muscleMeta.muscles[name]
      if (!def || def.points.length < 2) continue
      const ringCount = Math.min(
        MUSCLE_RING_MAX,
        Math.max(MUSCLE_RING_MIN, (def.points.length - 1) * 4 + 1),
      )
      const tube = new MuscleTube(ringCount, MUSCLE_RADIAL_SEGMENTS, def.points.length)
      const material = createMuscleMaterial()
      const mesh = new THREE.Mesh(tube.geometry, material)
      mesh.name = `muscle:${name}`
      mesh.frustumCulled = false
      root.add(mesh)
      const points = def.points.map((p) => ({
        node: this.poseMapState?.nodes.get(p.body) ?? null,
        local: new THREE.Vector3(p.pos[0], p.pos[1], p.pos[2]),
      }))
      this.muscleSegments.push({
        name,
        material,
        tube,
        mesh,
        points,
        world: points.map(() => new THREE.Vector3()),
      })
    }
    this.muscleRoot = root
    this.scene.add(root)
    this.applyLayerVisibility()
    this.applyLayerOpacity('muscle')
    this.updateMuscleColors()
    this.updateMuscleGeometry()
    this.needsRender = true
  }

  /** 每个姿态帧刷新肌肉：把 body 局部坐标转到世界坐标后重写整根管的顶点 */
  private updateMuscleGeometry(): void {
    if (!this.modelRoot || this.muscleSegments.length === 0) return
    // applyPose 刚改过局部变换，matrixWorld 需先刷新才能 localToWorld
    this.modelRoot.updateMatrixWorld(true)
    for (const seg of this.muscleSegments) {
      let valid = true
      for (let i = 0; i < seg.points.length; i++) {
        const p = seg.points[i]
        if (!p.node) {
          valid = false
          break
        }
        seg.world[i].copy(p.local)
        p.node.localToWorld(seg.world[i])
      }
      seg.mesh.visible = valid && seg.tube.update(seg.world)
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
    this.needsRender = true
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
    this.needsRender = true
  }

  // ---------- 循环与生命周期 ----------

  private startLoop(): void {
    const tick = () => {
      if (this.disposed) return
      this.rafId = requestAnimationFrame(tick)
      this.onFrame?.(this) // Viewport 同步 store 姿态；姿态未变时 setPose 内部跳过
      this.controls.update() // 阻尼：活动期持续派发 change → 标脏
      // 按需渲染：无变化的空闲帧不提交 WebGL
      if (this.needsRender) {
        this.renderer.render(this.scene, this.camera)
        this.needsRender = false
      }
      this.renderFrames += 1 // 调试探针：RAF 帧计数（含空转帧，反映循环存活）
    }
    this.rafId = requestAnimationFrame(tick)
  }

  handleResize(): void {
    const w = this.canvas.clientWidth || 1
    const h = this.canvas.clientHeight || 1
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.needsRender = true
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
    for (const seg of this.muscleSegments) {
      seg.material.dispose()
      seg.tube.dispose()
    }
    this.scene.remove(this.modelRoot ?? new THREE.Object3D())
    this.renderer.dispose()
  }
}
