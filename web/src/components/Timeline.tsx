/**
 * 时间轴（板块 02）：t 的主要交互入口。
 * - 进度条：自绘 track + fill + playhead，点击/拖动 → store.seek
 * - 关键帧标记点：绝对定位小圆点，hover 显示 label，点击跳转到该 t
 * - 控制区：播放/暂停、逐帧 ±（±1/fps）、倍速选择、时间读数（1 位小数）
 */
import { useRef } from 'react'
import { useStore } from '../store'

const PLAYBACK_RATES = [0.25, 0.5, 1, 2]

export default function Timeline() {
  const scene = useStore((s) => s.scene)
  const t = useStore((s) => s.t)
  const playing = useStore((s) => s.playing)
  const playbackRate = useStore((s) => s.playbackRate)
  const seek = useStore((s) => s.seek)
  const togglePlay = useStore((s) => s.togglePlay)
  const setPlaybackRate = useStore((s) => s.setPlaybackRate)

  const trackRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)

  if (!scene) {
    return (
      <footer className="app-timeline">
        <span className="time-label">场景未加载</span>
      </footer>
    )
  }

  const seekFromClientX = (clientX: number) => {
    const el = trackRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0) return
    const f = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1)
    seek(f * scene.duration)
  }

  const pct = (t / scene.duration) * 100

  return (
    <footer className="app-timeline">
      <button type="button" onClick={togglePlay} aria-label={playing ? '暂停' : '播放'}>
        {playing ? '暂停' : '播放'}
      </button>
      <button
        type="button"
        aria-label="上一帧"
        title="上一帧"
        onClick={() => seek(t - 1 / scene.fps)}
      >
        ◀|
      </button>
      <button
        type="button"
        aria-label="下一帧"
        title="下一帧"
        onClick={() => seek(t + 1 / scene.fps)}
      >
        |▶
      </button>

      <div
        ref={trackRef}
        className="timeline-track"
        role="slider"
        aria-label="时间轴"
        aria-valuemin={0}
        aria-valuemax={scene.duration}
        aria-valuenow={t}
        onPointerDown={(e) => {
          draggingRef.current = true
          e.currentTarget.setPointerCapture(e.pointerId)
          seekFromClientX(e.clientX)
        }}
        onPointerMove={(e) => {
          if (draggingRef.current) seekFromClientX(e.clientX)
        }}
        onPointerUp={(e) => {
          draggingRef.current = false
          e.currentTarget.releasePointerCapture(e.pointerId)
        }}
        onPointerCancel={() => {
          draggingRef.current = false
        }}
      >
        <div className="timeline-fill" style={{ width: `${pct}%` }} />
        <div className="timeline-playhead" style={{ left: `${pct}%` }} />
        {scene.keyframes.map((kf) => (
          <button
            key={kf.cardId}
            type="button"
            className="timeline-marker"
            style={{ left: `${(kf.t / scene.duration) * 100}%` }}
            title={`${kf.label}（${kf.t.toFixed(2)}s）`}
            aria-label={`跳转到关键帧：${kf.label}`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              seek(kf.t)
            }}
          />
        ))}
      </div>

      <select
        value={playbackRate}
        onChange={(e) => setPlaybackRate(Number(e.target.value))}
        aria-label="播放倍速"
      >
        {PLAYBACK_RATES.map((r) => (
          <option key={r} value={r}>
            {r}×
          </option>
        ))}
      </select>

      <span className="time-label">
        {t.toFixed(1)}s / {scene.duration.toFixed(1)}s
      </span>
    </footer>
  )
}
