/**
 * 读数面板（板块 03）：当前帧各参数数值（1 位小数 + 单位）。
 * 数值来自 sampleFrame（与 3D 视口 / 曲线游标同一帧），换算口径与曲线共用
 * buildChartSets，保证三处一致、与场景 JSON 原值对账。
 */
import { useMemo } from 'react'
import { readAt, type ChartSets } from '../charts/buildChartSets'
import type { PlaybackFrame } from '../player/sampleFrame'

interface ReadoutPanelProps {
  sets: ChartSets | null
  frame: PlaybackFrame | null
}

export default function ReadoutPanel({ sets, frame }: ReadoutPanelProps) {
  const groups = useMemo(() => (sets && frame ? readAt(frame, sets) : []), [sets, frame])

  if (!sets || !frame) {
    return <aside className="readout-panel readout-empty">场景未加载</aside>
  }

  return (
    <aside className="readout-panel" aria-label="当前帧读数">
      {groups.map((g) => (
        <section key={g.title} className="readout-group">
          <h3>{g.title}</h3>
          <ul>
            {g.items.map((it) => (
              <li key={it.name}>
                <span className="readout-name" title={it.name}>
                  {it.name}
                </span>
                <span className="readout-value">
                  {it.value.toFixed(1)} <i>{it.unit}</i>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </aside>
  )
}
