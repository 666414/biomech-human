/**
 * 3D 视口组件（板块 01）：挂载 SceneManager，桥接全局状态与渲染循环。
 * - 姿态由回放层（usePlayback → App）经 ref 句柄 setPose 注入；渲染循环
 *   只重放缓存位姿（模型晚于首帧加载完成时也能自愈到当前 t 的姿态）
 * - 点击 canvas：pickAt → selectPart；高亮跟随 selectedPartId
 * - 分层显示控件（骨骼/肌肉/皮肤）由布局层（App 顶栏）持有状态，经 layers
 *   prop 下发，本组件集中同步到 SceneManager.setLayerVisible/setLayerOpacity
 * - 浮层：模型加载进度/重试、选中部位中英文名角标（拾取反馈）
 * - 通过 ref 暴露 ViewportHandle（布局层调用 focusPart/setView 等）
 * - 加载进度/就绪/失败经 onProgress/onReady/onError 上报布局层（App 全屏加载态复用）
 * - ?fkcheck=1：运行时 FK 对账，结果打印到 console 并显示浮层
 * - 降质预设（01 文档）：?quality=low|high 显式指定；?lite=1 等价 low
 *   （关抗锯齿 + 像素比上限 1；阴影贴图未启用，见 SceneManager）；缺省自动——
 *   小屏（宽 < 768）或 devicePixelRatio > 2.5 视为低端机 → low 档
 */
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import { useStore } from '../store'
import type { JointAngles, MuscleMeta, PartGroup } from '../types'
import { checkPoseMap, formatFkResult, loadFkReference } from '../three/fkCheck'
import { SceneManager, type DebugState, type Quality, type ViewPreset } from '../three/SceneManager'

/** 调试探针写入 DOM 的节流间隔（ms） */
const DEBUG_INTERVAL_MS = 500

/** 探针初值（SceneManager 建好前/失败时的兜底显示） */
const DEBUG_INITIAL: DebugState = {
  modelLoaded: false,
  attempts: 0,
  lastError: null,
  bodyCount: 0,
  renderFrames: 0,
  layerMeshes: { skeleton: 0, muscle: 0, skin: 0 },
}

function isFkCheck(): boolean {
  return new URLSearchParams(window.location.search).get('fkcheck') === '1'
}

/** 降质档位判定：?lite=1 / ?quality= 查询参数优先，缺省按视口宽 / DPR 自动 */
function detectQuality(): Quality {
  const params = new URLSearchParams(window.location.search)
  if (params.get('lite') === '1') return 'low'
  const q = params.get('quality')
  if (q === 'low' || q === 'high') return q
  return window.innerWidth < 768 || window.devicePixelRatio > 2.5 ? 'low' : 'high'
}

/** 父层（布局）通过 ref 调用的视口能力 */
export interface ViewportHandle {
  setPose: (q: JointAngles) => void
  /** 当前帧肌肉激活度（%MVC，顺序与 scene.muscles 对齐） */
  setMuscleAct: (values: number[]) => void
  focusPart: (partId: string) => void
  setView: (view: ViewPreset) => void
  highlight: (partId: string | null) => void
}

/** 分层显示状态（App 顶栏控件持有，经 prop 下发） */
export interface LayerState {
  visible: Record<PartGroup, boolean>
  opacity: Record<PartGroup, number>
}

const LAYER_GROUPS: Array<{ group: PartGroup; label: string }> = [
  { group: 'skeleton', label: '骨骼' },
  { group: 'muscle', label: '肌肉' },
  { group: 'skin', label: '皮肤' },
]

export default function Viewport({
  ref,
  layers,
  onProgress,
  onReady,
  onError,
}: {
  ref?: Ref<ViewportHandle>
  layers: LayerState
  /** 模型加载进度上报（App 全屏加载态的进度条复用同一回调） */
  onProgress?: (pct: number) => void
  /** 模型就绪上报 */
  onReady?: () => void
  /** 模型加载 / WebGL 初始化失败上报（App 据此收起全屏加载态，错误浮层留在视口内） */
  onError?: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const smRef = useRef<SceneManager | null>(null)
  /** 调试探针宿主元素（SceneManager 状态经 data-debug 属性实时外露） */
  const debugRef = useRef<HTMLDivElement>(null)
  /** 回放层最近一次注入的位姿（渲染循环每帧重放，模型加载完成自愈） */
  const poseRef = useRef<JointAngles | null>(null)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  /** 肌肉示意线数据是否就绪（缺失时肌肉图层无几何，不影响模型可用） */
  const [muscleReady, setMuscleReady] = useState(false)
  const [fkText, setFkText] = useState<string | null>(null)
  const [reloadNonce, setReloadNonce] = useState(0)

  // 初始化 SceneManager + 加载模型（一次性；reloadNonce 变化时重建，
  // 重建即新实例 → 模型加载的自动重试计数随之重置，等效手动重试重置计数）。
  // 加载回调依赖为布局层经 useCallback 固化的稳定引用（setState 本身稳定），
  // 正常不触发重建；重建会销毁 WebGL 上下文，勿传入非稳定内联箭头。
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let cancelled = false
    let sm: SceneManager | null = null
    setProgress(0)
    setError(null)
    setReady(false)
    setMuscleReady(false)

    try {
      sm = new SceneManager(canvas, detectQuality())
    } catch (e) {
      // jsdom / 无 WebGL 环境降级：显示占位文案，不阻塞应用
      const msg = `WebGL 初始化失败：${e instanceof Error ? e.message : String(e)}`
      debugRef.current?.setAttribute(
        'data-debug',
        JSON.stringify({ ...DEBUG_INITIAL, lastError: msg }),
      )
      setError(msg)
      onError?.()
      return
    }
    smRef.current = sm

    // 调试探针：SceneManager 关键状态节流写入容器 DOM（开发/生产均启用，
    // 供自动化验收与用户排障——WebGL canvas 像素不可读，DOM 属性是可靠判定源）
    const writeDebug = (): void => {
      debugRef.current?.setAttribute('data-debug', JSON.stringify(sm!.debugState()))
    }
    writeDebug()
    const debugTimer = window.setInterval(writeDebug, DEBUG_INTERVAL_MS)

    // 渲染循环回调：只重放缓存位姿（注入走 ref 句柄，见 useImperativeHandle）
    sm.onFrame = (instance) => {
      if (poseRef.current) instance.setPose(poseRef.current)
    }

    const load = async () => {
      try {
        await sm!.loadModel('/data/models/human.glb', (pct) => {
          if (!cancelled) setProgress(pct)
          onProgress?.(pct)
        })
        if (cancelled) return
        setReady(true)
        onReady?.()

        // 肌肉示意线数据（执行器 → 肌腱站点折线）：加载失败仅降级为空图层
        try {
          const res = await fetch('/data/models/muscle-meta.json')
          if (res.ok) {
            const meta = (await res.json()) as MuscleMeta
            if (!cancelled) {
              sm!.setMuscleData(meta)
              setMuscleReady(true)
            }
          }
        } catch {
          // 忽略：肌肉图层无几何，骨骼/皮肤不受影响
        }

        if (isFkCheck()) {
          const refJson = await loadFkReference()
          if (cancelled || !sm) return
          // 用 SceneManager 自己的 poseMap（rest = 模型静止位）；现场新建会
          // 捕获到已被 RAF 回放摆姿势的变换，导致关节复合两次（实测踩坑）。
          // rig 由 App 异步注入，这里等 poseMap 就绪（上限 10s）。
          let pm = sm.poseMap
          const deadline = Date.now() + 10000
          while (!pm && Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 100))
            if (cancelled) return
            pm = sm.poseMap
          }
          const result = pm ? checkPoseMap(pm, refJson) : null
          if (result) {
            const text = formatFkResult(result)
            console.log(text)
            setFkText(text)
          }
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e))
          onError?.()
        }
      }
    }
    void load()

    return () => {
      cancelled = true
      window.clearInterval(debugTimer)
      sm?.dispose()
      smRef.current = null
    }
  }, [reloadNonce, onProgress, onReady, onError])

  // rig 元数据到达后注入（App 已通过 store 加载）
  const rigMeta = useStore((s) => s.rigMeta)
  useEffect(() => {
    if (rigMeta) smRef.current?.setRig(rigMeta)
  }, [rigMeta])

  // 场景切换：只为当前场景关注的肌肉生成示意线（其余 700 块不建几何）
  const scene = useStore((s) => s.scene)
  useEffect(() => {
    if (!ready || !muscleReady) return
    smRef.current?.setActiveMuscles(scene?.muscles ?? [])
  }, [scene, ready, muscleReady, rigMeta])

  // 高亮跟随选中状态
  const selectedPartId = useStore((s) => s.selectedPartId)
  useEffect(() => {
    smRef.current?.highlight(selectedPartId)
  }, [selectedPartId])

  // 分层状态 → SceneManager（集中走 effect，避免控件渲染路径直接依赖实例）
  useEffect(() => {
    const sm = smRef.current
    if (!sm) return
    for (const { group } of LAYER_GROUPS) {
      sm.setLayerVisible(group, layers.visible[group])
      sm.setLayerOpacity(group, layers.opacity[group])
    }
  }, [layers, ready, rigMeta])

  // 暴露给父层的类型化句柄
  useImperativeHandle(
    ref,
    () => ({
      setPose: (q) => {
        poseRef.current = q
        smRef.current?.setPose(q)
      },
      setMuscleAct: (values) => {
        const current = useStore.getState().scene
        if (!current) return
        const rec: Record<string, number> = {}
        current.muscles.forEach((name, i) => {
          rec[name] = values[i] ?? 0
        })
        smRef.current?.setMuscleActivations(rec)
      },
      focusPart: (partId) => smRef.current?.focusPart(partId),
      setView: (view) => smRef.current?.setView(view),
      highlight: (partId) => useStore.getState().selectPart(partId),
    }),
    [],
  )

  // 点击拾取（click 语义）：pointerdown 记录坐标，pointerup 位移 < 5px 才算点击，
  // 避免 OrbitControls 拖拽视角的起始按下被误判为点击而误选/误清选部位
  const pointerDownPosRef = useRef<{ x: number; y: number } | null>(null)

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    pointerDownPosRef.current = { x: e.clientX, y: e.clientY }
  }

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const down = pointerDownPosRef.current
    pointerDownPosRef.current = null
    const sm = smRef.current
    if (!down || !sm) return
    const dx = e.clientX - down.x
    const dy = e.clientY - down.y
    if (dx * dx + dy * dy >= 25) return // 位移 ≥ 5px，视为拖拽视角
    const rect = e.currentTarget.getBoundingClientRect()
    const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1
    const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1
    useStore.getState().selectPart(sm.pickAt(ndcX, ndcY))
  }

  // 选中部位信息（经 SceneManager 查 rig-meta 中英文名）
  const info = selectedPartId ? (smRef.current?.getSelectedInfo(selectedPartId) ?? null) : null

  return (
    <div className="viewport">
      <canvas
        ref={canvasRef}
        className="viewport-canvas"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
      />
      {!ready && !error && (
        <div className="viewport-overlay">
          {progress > 0 ? `模型加载中 ${progress}%` : '准备加载…'}
          <div className="progress-track">
            <div className="progress-bar" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}
      {error && (
        <div className="viewport-overlay">
          <p>{error}</p>
          <button type="button" onClick={() => setReloadNonce((n) => n + 1)}>
            重试
          </button>
        </div>
      )}
      {info && (
        <div className="part-card">
          <strong>{info.zh}</strong>
          <span>{info.en}</span>
          <span className="part-card-id">{info.id}</span>
        </div>
      )}
      {fkText && <pre className="fk-panel">{fkText}</pre>}
      {/* 调试探针：SceneManager 状态 JSON（自动化验收读取，视觉隐藏） */}
      <div ref={debugRef} data-debug={JSON.stringify(DEBUG_INITIAL)} hidden />
    </div>
  )
}
