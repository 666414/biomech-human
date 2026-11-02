/**
 * P3 Task 3 临时外壳：加载 rigMeta + 默认场景（gait_cycle）+ Viewport + 时间轴。
 * 仅用于验证渲染引擎与姿态动画；T4 会替换为正式布局与回放控制组件。
 */
import { useEffect } from 'react'
import Viewport from './components/Viewport'
import { loadRigMeta, SCENE_IDS } from './data'
import { useStore } from './store'
import './App.css'

function App() {
  const sceneId = useStore((s) => s.sceneId)
  const scene = useStore((s) => s.scene)
  const t = useStore((s) => s.t)
  const playing = useStore((s) => s.playing)
  const seek = useStore((s) => s.seek)
  const togglePlay = useStore((s) => s.togglePlay)
  const setScene = useStore((s) => s.setScene)
  const selectedPartId = useStore((s) => s.selectedPartId)
  const rigMeta = useStore((s) => s.rigMeta)
  const selectedZh = selectedPartId
    ? (rigMeta?.parts.find((p) => p.id === selectedPartId)?.names.zh ?? selectedPartId)
    : null

  useEffect(() => {
    void (async () => {
      try {
        useStore.getState().setRigMeta(await loadRigMeta())
      } catch {
        // rig 加载失败不阻塞渲染（FK 对账会提示），T4 再统一错误处理
      }
    })()
  }, [])

  useEffect(() => {
    // jsdom/离线环境无数据源会 reject，静默（T4 统一错误处理）
    setScene('gait_cycle').catch(() => {})
  }, [setScene])

  return (
    <div className="app">
      <header className="app-header">
        <h1>人体运动可视化</h1>
        <select value={sceneId ?? ''} onChange={(e) => void setScene(e.target.value)} aria-label="选择场景">
          {SCENE_IDS.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
        <span className="part-badge">{selectedZh ? `${selectedZh}（${selectedPartId}）` : '未选中部位'}</span>
      </header>

      <Viewport />

      <footer className="app-timeline">
        <button type="button" onClick={togglePlay} disabled={!scene}>
          {playing ? '暂停' : '播放'}
        </button>
        <input
          type="range"
          min={0}
          max={scene?.duration ?? 1}
          step={0.01}
          value={t}
          disabled={!scene}
          onChange={(e) => seek(Number(e.target.value))}
          aria-label="时间轴"
        />
        <span className="time-label">
          {t.toFixed(2)}s / {(scene?.duration ?? 0).toFixed(2)}s
        </span>
      </footer>
    </div>
  )
}

export default App
