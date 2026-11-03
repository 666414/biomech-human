/**
 * 应用外壳（板块 02）：ScenePicker + Viewport + Timeline 的组装与帧分发。
 * 分发链路：store.t（唯一驱动源）→ usePlayback 采样帧 →
 *   1. Viewport setPose（3D 姿态）
 *   2. 03 图表游标（T5 接同一 frame：曲线/游标/读数）
 *   3. 04 关键帧弹卡（T6 用 player/activeKeyframe 检查 frame.time，含去重）
 * 反向联动：Timeline seek → store.t；Viewport 拾取 → store.selectPart → 部位卡；
 * 曲线系列点击 → onSeriesClick 查卡；卡内「定位」→ focusPart + selectPart。
 */
import { useCallback, useEffect, useMemo, useRef } from 'react'
import ParamCharts from './charts/ParamCharts'
import { buildChartSets } from './charts/buildChartSets'
import KnowledgePanel from './knowledge/KnowledgePanel'
import { findSeriesCard } from './knowledge/knowledge'
import ReadoutPanel from './components/ReadoutPanel'
import ScenePicker from './components/ScenePicker'
import Timeline from './components/Timeline'
import Viewport, { type ViewportHandle } from './components/Viewport'
import { indexKnowledge, loadKnowledge, loadRigMeta } from './data'
import { activeKeyframe } from './player/activeKeyframe'
import { usePlayback } from './player/usePlayback'
import { useStore } from './store'
import './App.css'

function App() {
  const viewportRef = useRef<ViewportHandle>(null)
  const frame = usePlayback()
  const scene = useStore((s) => s.scene)
  const seek = useStore((s) => s.seek)
  const selectedPartId = useStore((s) => s.selectedPartId)
  const rigMeta = useStore((s) => s.rigMeta)
  const knowledge = useStore((s) => s.knowledge)
  const setScene = useStore((s) => s.setScene)
  // 图表数据准备（板块 03）：场景切换时重算，曲线与读数面板共用
  const chartSets = useMemo(() => (scene ? buildChartSets(scene) : null), [scene])
  // 知识卡索引（板块 04）：三条触发路径共用
  const knowledgeIndex = useMemo(() => indexKnowledge(knowledge), [knowledge])
  const selectedZh = selectedPartId
    ? (rigMeta?.parts.find((p) => p.id === selectedPartId)?.names.zh ?? selectedPartId)
    : null

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
    // jsdom/离线环境无数据源会 reject，静默（错误处理由 T7 统一）
    setScene('gait_cycle').catch(() => {})
  }, [setScene])

  // 帧分发：t 变化 → Viewport setPose（charts/关键帧联动接同一 frame）
  useEffect(() => {
    if (frame) viewportRef.current?.setPose(frame.jointAngles)
  }, [frame])

  // 触发路径 2：关键帧命中自动弹卡（checkKeyframeCard 去重：同区间不重复弹，
  // 离开区间不强制关闭已弹卡，由用户关闭）
  useEffect(() => {
    if (!scene) return
    useStore
      .getState()
      .applyKeyframe(activeKeyframe(scene.keyframes, frame?.time ?? 0, scene.duration))
  }, [frame, scene])

  // 触发路径 1：3D 拾取 → 部位卡；选中有卡的部位弹卡，无卡/取消选中时关闭
  useEffect(() => {
    useStore
      .getState()
      .setActiveCardByPart(
        selectedPartId ? knowledgeIndex.byPartId[selectedPartId] : undefined,
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

  return (
    <div className="app">
      <header className="app-header">
        <h1>人体运动可视化</h1>
        <ScenePicker />
        <span className="part-badge">{selectedZh ? `${selectedZh}（${selectedPartId}）` : '未选中部位'}</span>
      </header>

      <Viewport ref={viewportRef} />

      {/* 板块 03 + 04：参数曲线/游标/读数 + 知识卡（可堆叠 flex 外壳，响应式由 T7 打磨） */}
      {scene && chartSets ? (
        <section className="app-charts">
          <div className="charts-box">
            <ParamCharts
              scene={scene}
              sets={chartSets}
              frame={frame}
              onSeek={seek}
              onSeriesClick={handleSeriesClick}
            />
          </div>
          <aside className="app-side">
            <KnowledgePanel onLocate={handleLocate} />
            <ReadoutPanel sets={chartSets} frame={frame} />
          </aside>
        </section>
      ) : (
        <section className="app-charts app-charts-placeholder">参数图表（场景未加载）</section>
      )}

      <Timeline />
    </div>
  )
}

export default App
