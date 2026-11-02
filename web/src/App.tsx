/**
 * 应用外壳（板块 02）：ScenePicker + Viewport + Timeline 的组装与帧分发。
 * 分发链路：store.t（唯一驱动源）→ usePlayback 采样帧 →
 *   1. Viewport setPose（3D 姿态）
 *   2. 03 图表游标（T5 接同一 frame：曲线/游标/读数）
 *   3. 04 关键帧弹卡（T6 用 player/activeKeyframe 检查 frame.time）
 * 反向联动：Timeline seek → store.t；Viewport 拾取 → store.selectPart。
 */
import { useEffect, useRef } from 'react'
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
  const selectedPartId = useStore((s) => s.selectedPartId)
  const rigMeta = useStore((s) => s.rigMeta)
  const setScene = useStore((s) => s.setScene)
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

      <Timeline />
    </div>
  )
}

export default App
