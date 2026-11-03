/**
 * 应用外壳（板块 02）：ScenePicker + Viewport + Timeline 的组装与帧分发。
 * 分发链路：store.t（唯一驱动源）→ usePlayback 采样帧 →
 *   1. Viewport setPose（3D 姿态）
 *   2. 03 图表游标（T5 接同一 frame：曲线/游标/读数）
 *   3. 04 关键帧弹卡（T6 用 player/activeKeyframe 检查 frame.time）
 * 反向联动：Timeline seek → store.t；Viewport 拾取 → store.selectPart。
 */
import { useEffect, useMemo, useRef } from 'react'
import ParamCharts from './charts/ParamCharts'
import { buildChartSets } from './charts/buildChartSets'
import ReadoutPanel from './components/ReadoutPanel'
import ScenePicker from './components/ScenePicker'
import Timeline from './components/Timeline'
import Viewport, { type ViewportHandle } from './components/Viewport'
import { loadRigMeta } from './data'
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
  const setScene = useStore((s) => s.setScene)
  // 图表数据准备（板块 03）：场景切换时重算，曲线与读数面板共用
  const chartSets = useMemo(() => (scene ? buildChartSets(scene) : null), [scene])
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
    // jsdom/离线环境无数据源会 reject，静默（错误处理由 T7 统一）
    setScene('gait_cycle').catch(() => {})
  }, [setScene])

  // 帧分发：t 变化 → Viewport setPose（charts/关键帧联动接同一 frame）
  useEffect(() => {
    if (frame) viewportRef.current?.setPose(frame.jointAngles)
  }, [frame])

  return (
    <div className="app">
      <header className="app-header">
        <h1>人体运动可视化</h1>
        <ScenePicker />
        <span className="part-badge">{selectedZh ? `${selectedZh}（${selectedPartId}）` : '未选中部位'}</span>
      </header>

      <Viewport ref={viewportRef} />

      {/* 板块 03：参数曲线 + 游标 + 读数面板（可堆叠 flex 外壳，响应式由 T7 打磨） */}
      {scene && chartSets ? (
        <section className="app-charts">
          <div className="charts-box">
            <ParamCharts scene={scene} sets={chartSets} frame={frame} onSeek={seek} />
          </div>
          <ReadoutPanel sets={chartSets} frame={frame} />
        </section>
      ) : (
        <section className="app-charts app-charts-placeholder">参数图表（场景未加载）</section>
      )}

      <Timeline />
    </div>
  )
}

export default App
