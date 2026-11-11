/**
 * 应用外壳（板块 02 集成 + Task 7 响应式布局）：帧分发与桌面/移动端外壳。
 * 桌面（> 1024px）：顶栏（标题/场景/视角预设/分层控件）+ 左 3D 视口（主体）+
 * 右侧栏（读数 + 知识卡）+ 参数曲线横排 + 底部时间轴常驻。
 * 移动端（≤ 1024px）：Tab 切换（3D / 曲线 / 知识），时间轴常驻底部，
 * 知识卡为底部抽屉；曲线 Tab 内提供图表全屏展开。
 * 全屏加载态：首次加载（进度条复用 Viewport 模型进度回调）与场景切换遮罩共用，
 * 场景数据加载失败在遮罩内显示错误 + 重试。
 * 分发链路：store.t（唯一驱动源）→ usePlayback 采样帧 →
 *   1. Viewport setPose（3D 姿态）
 *   2. 03 图表游标（ParamCharts 接同一 frame：曲线/游标/读数）
 *   3. 04 关键帧弹卡（player/activeKeyframe 检查 frame.time，含去重）
 * 反向联动：Timeline seek → store.t；Viewport 拾取 → store.selectPart → 部位卡；
 * 曲线系列点击 → onSeriesClick 查卡；卡内「定位」→ focusPart + selectPart；
 * 键盘空格 = 播放/暂停（输入控件/按钮聚焦时交给原生行为）。
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildChartSets } from './charts/buildChartSets'
import KnowledgePanel from './knowledge/KnowledgePanel'
import { findSeriesCard } from './knowledge/knowledge'
import ReadoutPanel from './components/ReadoutPanel'
import ScenePicker from './components/ScenePicker'
import Timeline from './components/Timeline'
import Viewport, { type LayerState, type ViewportHandle } from './components/Viewport'
import { loadKnowledge, loadRigMeta } from './data'
import { activeKeyframe } from './player/activeKeyframe'
import { usePlayback } from './player/usePlayback'
import { useStore } from './store'
import type { PartGroup } from './types'
import './App.css'

/**
 * 曲线图懒加载（P5 性能迭代）：echarts + zrender 约 559 kB（gzip 189 kB），静态引入时
 * 其下载与执行挤在首屏关键路径上（TBT/SI 主因之一）。改为 React.lazy 后，echarts chunk
 * 在首帧渲染完成、模型开始加载之后才拉取执行，与模型下载并行互不阻塞。
 * 移动端默认 3D Tab，图表延迟到切「曲线」Tab 才拉取，首屏完全免掉这 559 kB。
 */
const ParamCharts = lazy(() => import('./charts/ParamCharts'))

/** 移动端断点（与 App.css 的 media query 一致） */
const MOBILE_QUERY = '(max-width: 1024px)'
type TabId = '3d' | 'charts' | 'knowledge'

/** 分层显示控件（顶栏）：接 SceneManager.setLayerVisible/setLayerOpacity */
const LAYERS: Array<{ group: PartGroup; label: string }> = [
  { group: 'skeleton', label: '骨骼' },
  { group: 'muscle', label: '肌肉' },
  { group: 'skin', label: '皮肤' },
]

/** 是否移动端布局（jsdom 等无 matchMedia 环境回退到 innerWidth 初值） */
function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 1024)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(MOBILE_QUERY)
    const onChange = () => setIsMobile(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return isMobile
}

function App() {
  const viewportRef = useRef<ViewportHandle>(null)
  const frame = usePlayback()
  const scene = useStore((s) => s.scene)
  const sceneId = useStore((s) => s.sceneId)
  const sceneError = useStore((s) => s.sceneError)
  const seek = useStore((s) => s.seek)
  const selectedPartId = useStore((s) => s.selectedPartId)
  // 知识卡索引（板块 04）：唯一来源是 store（setKnowledge 时重建），App 只读
  const knowledgeIndex = useStore((s) => s.knowledgeIndex)
  const setScene = useStore((s) => s.setScene)
  const rigMeta = useStore((s) => s.rigMeta)
  // 图表数据准备（板块 03）：场景切换时重算，曲线与读数面板共用
  const chartSets = useMemo(() => (scene ? buildChartSets(scene) : null), [scene])

  // 响应式外壳状态
  const isMobile = useIsMobile()
  const [tab, setTab] = useState<TabId>('3d')
  const [chartsExpanded, setChartsExpanded] = useState(false)
  // 分层显示状态（顶栏控件持有，经 prop 下发给 Viewport → SceneManager）
  const [layerVisible, setLayerVisible] = useState<Record<PartGroup, boolean>>({
    skeleton: true,
    muscle: true,
    skin: true,
  })
  const [layerOpacity, setLayerOpacity] = useState<Record<PartGroup, number>>({
    skeleton: 1,
    muscle: 1,
    // 皮肤为半透明外壳：全不透明会完全遮住骨骼，默认 0.25（近似源模型 rgba 0.2）
    skin: 0.25,
  })
  // 全屏加载态：模型加载进度经 Viewport onProgress 上报给遮罩；视口内浮层保留
  // 供「模型失败 → 重试」流程使用（App 遮罩此时已收起）
  const [modelPct, setModelPct] = useState(0)
  const [modelState, setModelState] = useState<'loading' | 'ready' | 'error'>('loading')
  // 稳定回调（Viewport 以此为 effect 依赖，非稳定内联箭头会导致 SceneManager 重建）
  const handleModelReady = useCallback(() => setModelState('ready'), [])
  const handleModelError = useCallback(() => setModelState('error'), [])

  useEffect(() => {
    void (async () => {
      try {
        useStore.getState().setRigMeta(await loadRigMeta())
      } catch {
        // rig 加载失败不阻塞渲染（FK 对账会提示）
      }
    })()
  }, [])

  useEffect(() => {
    // 知识卡内容（loadKnowledge 内部容错：404/离线 → []，不阻塞渲染）
    void loadKnowledge().then((cards) => useStore.getState().setKnowledge(cards))
  }, [])

  useEffect(() => {
    // setScene 失败写入 store.sceneError（不 reject），由全屏加载态显示错误 + 重试
    void setScene('gait_cycle')
  }, [setScene])

  // 键盘空格 = 播放/暂停；输入控件/按钮聚焦时交给原生行为（选择器/滑杆/逐帧按钮）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
      const el = e.target as HTMLElement | null
      const tag = el?.tagName
      if (
        tag === 'INPUT' ||
        tag === 'SELECT' ||
        tag === 'TEXTAREA' ||
        tag === 'BUTTON' ||
        el?.isContentEditable
      ) {
        return
      }
      e.preventDefault()
      useStore.getState().togglePlay()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 帧分发：t 变化 → Viewport setPose + 肌肉激活着色（charts/关键帧联动接同一 frame）
  useEffect(() => {
    if (!frame) return
    viewportRef.current?.setPose(frame.jointAngles)
    viewportRef.current?.setMuscleAct(frame.muscleAct)
  }, [frame])

  // 触发路径 2：关键帧命中自动弹卡（checkKeyframeCard 去重：同区间不重复弹，
  // 离开区间不强制关闭已弹卡，由用户关闭）
  useEffect(() => {
    if (!scene) return
    useStore
      .getState()
      .applyKeyframe(activeKeyframe(scene.keyframes, frame?.time ?? 0, scene.duration))
  }, [frame, scene])

  // 触发路径 1：3D 拾取 → 部位卡；选中有卡的部位弹卡，无卡/取消选中时关闭。
  // 仅在「选中变化」时覆盖当前卡；knowledgeIndex 异步重建（选中未变）时，
  // 若正在展示关键帧/曲线卡则跳过——避免知识异步加载完成瞬间误关当前卡；
  // 若无卡且有选中部位则补弹（选中先于 knowledge 就绪的竞态）。
  const prevPartRef = useRef<string | null>(null)
  useEffect(() => {
    const partChanged = prevPartRef.current !== selectedPartId
    prevPartRef.current = selectedPartId
    const state = useStore.getState()
    if (!partChanged && state.activeCard && state.activeCardSource?.kind !== 'part') return
    state.setActiveCardByPart(
      selectedPartId ? state.knowledgeIndex.byPartId[selectedPartId] : undefined,
      selectedPartId,
    )
  }, [selectedPartId, knowledgeIndex])

  // 触发路径 3：曲线系列点击 → 按系列名（关节/肌肉 id）查卡，查不到不弹
  const handleSeriesClick = useCallback(
    (name: string) => {
      const card = findSeriesCard(name, knowledgeIndex)
      if (card) useStore.getState().setActiveCard(card, { kind: 'series', name })
    },
    [knowledgeIndex],
  )

  // 反向定位：相机特写 + 高亮（高亮经 selectPart 联动部位信息与部位卡）
  const handleLocate = useCallback((partId: string) => {
    viewportRef.current?.focusPart(partId)
    useStore.getState().selectPart(partId)
  }, [])

  // 场景数据加载失败的重试：用当前 sceneId 重新发起 setScene
  const retryScene = useCallback(() => {
    const id = useStore.getState().sceneId
    if (id) void setScene(id)
  }, [setScene])

  const layers: LayerState = { visible: layerVisible, opacity: layerOpacity }
  const chartsReady = scene !== null && chartSets !== null

  // 全屏加载态：首次加载（模型未就绪）或场景数据请求中（含失败待重试）
  const sceneLoading = sceneId !== null && scene === null
  const booting = modelState === 'loading' || sceneLoading

  // 曲线区（桌面横排 / 移动端曲线 Tab 共用）。ParamCharts 为 lazy 组件，
  // Suspense 回退占位与已加载态共用同一容器样式，避免布局跳动
  const chartsBox = (
    <div className="charts-box">
      {scene && chartSets ? (
        <Suspense fallback={<div className="charts-placeholder">图表加载中…</div>}>
          <ParamCharts
            scene={scene}
            sets={chartSets}
            frame={frame}
            onSeek={seek}
            onSeriesClick={handleSeriesClick}
          />
        </Suspense>
      ) : (
        <div className="charts-placeholder">参数图表（场景未加载）</div>
      )}
    </div>
  )

  return (
    <div className="app">
      <header className="app-header">
        <h1>人体生物力学交互演示</h1>
        <ScenePicker />
        <div className="view-controls" role="group" aria-label="视角预设">
          <button type="button" onClick={() => viewportRef.current?.setView('front')}>
            正面
          </button>
          <button type="button" onClick={() => viewportRef.current?.setView('side')}>
            侧面
          </button>
          <button type="button" onClick={() => viewportRef.current?.setView('reset')}>
            复位
          </button>
        </div>
        <div className="layer-controls" role="group" aria-label="分层显示">
          {LAYERS.map(({ group, label }) => (
            <span key={group} className="layer-item">
              <input
                type="checkbox"
                checked={layerVisible[group]}
                aria-label={`${label}显示`}
                onChange={(e) =>
                  setLayerVisible((s) => ({ ...s, [group]: e.target.checked }))
                }
              />
              {label}
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={layerOpacity[group]}
                aria-label={`${label}不透明度`}
                onChange={(e) =>
                  setLayerOpacity((s) => ({ ...s, [group]: Number(e.target.value) }))
                }
              />
            </span>
          ))}
        </div>
      </header>

      {isMobile && (
        <nav className="app-tabs" role="tablist" aria-label="面板切换">
          <button type="button" role="tab" aria-selected={tab === '3d'} onClick={() => setTab('3d')}>
            3D
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'charts'}
            onClick={() => setTab('charts')}
          >
            曲线
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'knowledge'}
            onClick={() => setTab('knowledge')}
          >
            知识
          </button>
        </nav>
      )}

      <main className="app-main">
        {/* 3D 视口常驻挂载：移动端经 CSS 隐藏（切 Tab 不销毁 WebGL 上下文/重载模型） */}
        <div className={`vp-slot${isMobile && tab !== '3d' ? ' slot-hidden' : ''}`}>
          <Viewport
            ref={viewportRef}
            layers={layers}
            onProgress={setModelPct}
            onReady={handleModelReady}
            onError={handleModelError}
          />
        </div>

        {!isMobile && (
          <aside className="app-side">
            {chartsReady ? (
              <>
                <ReadoutPanel sets={chartSets} frame={frame} />
                <KnowledgePanel onLocate={handleLocate} />
              </>
            ) : (
              <div className="side-placeholder">
                {rigMeta ? '场景加载中…' : '资源加载中…'}
              </div>
            )}
          </aside>
        )}

        {isMobile && tab === 'charts' && (
          <section className={`app-charts-tab${chartsExpanded ? ' expanded' : ''}`}>
            <button
              type="button"
              className="charts-expand"
              onClick={() => setChartsExpanded((v) => !v)}
            >
              {chartsExpanded ? '退出全屏' : '全屏展开'}
            </button>
            {chartsBox}
            {chartsReady && <ReadoutPanel sets={chartSets} frame={frame} />}
          </section>
        )}

        {isMobile && tab === 'knowledge' && <KnowledgePanel onLocate={handleLocate} />}
      </main>

      {!isMobile && <section className="app-charts">{chartsBox}</section>}

      <Timeline />

      {/* 全屏加载态：首次加载（进度条复用 Viewport 模型进度回调）+ 场景切换遮罩 +
          场景数据失败重试；模型自身的错误/重试浮层留在视口内（此时遮罩已收起） */}
      {booting && (
        <div className="app-boot" role="status" aria-live="polite">
          {sceneError ? (
            <>
              <p>场景数据加载失败：{sceneError}</p>
              <button type="button" onClick={retryScene}>
                重试
              </button>
            </>
          ) : (
            <>
              {modelState === 'loading' && (
                <div className="progress-track">
                  <div className="progress-bar" style={{ width: `${modelPct}%` }} />
                </div>
              )}
              <p>
                {modelState === 'loading' && modelPct > 0
                  ? `模型加载中 ${modelPct}%`
                  : '场景数据加载中…'}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default App
