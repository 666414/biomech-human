/**
 * 知识卡面板（板块 04，T6）：知识卡展示端，数据来自 store.activeCard。
 * - 字段分区：术语（中英）/ 解剖 / 力学 / 临床 / 引用；
 * - 关键帧卡显示触发时刻与场景 label；部位卡（有 partId）提供「在模型中定位」；
 * - 无卡时显示占位提示；关闭仅收起卡片，下个关键帧区间命中仍会自动弹出。
 * 桌面形态：读数面板同列卡片；移动端（≤900px）知识 Tab 内为底部抽屉（App.css）。
 */
import { useStore } from '../store'

/** 展示分区（与 KnowledgeCard 字段一一对应） */
const SECTIONS = [
  { key: 'anatomy', title: '解剖' },
  { key: 'biomech', title: '力学' },
  { key: 'clinic', title: '临床' },
] as const

export default function KnowledgePanel({ onLocate }: { onLocate: (partId: string) => void }) {
  const card = useStore((s) => s.activeCard)
  const source = useStore((s) => s.activeCardSource)
  const closeCard = useStore((s) => s.closeCard)

  if (!card) {
    return (
      <aside className="knowledge-panel knowledge-panel-empty" aria-label="知识卡">
        点击 3D 部位查看讲解
      </aside>
    )
  }

  return (
    <aside className="knowledge-panel" aria-label="知识卡">
      <header className="knowledge-head">
        <div className="knowledge-term">
          <strong>{card.term.zh}</strong>
          <span>{card.term.en}</span>
        </div>
        <button type="button" className="knowledge-close" aria-label="关闭知识卡" onClick={closeCard}>
          ×
        </button>
      </header>

      {source?.kind === 'keyframe' && (
        <div className="knowledge-meta">
          关键帧 {source.keyframe.t.toFixed(2)}s · {source.keyframe.label}
        </div>
      )}
      {source?.kind === 'series' && <div className="knowledge-meta">曲线系列：{source.name}</div>}

      <dl className="knowledge-body">
        {SECTIONS.map(({ key, title }) => (
          <div key={key} className="knowledge-section">
            <dt>{title}</dt>
            <dd>{card[key]}</dd>
          </div>
        ))}
      </dl>

      {card.refs.length > 0 && (
        <ul className="knowledge-refs">
          {card.refs.map((ref) => (
            <li key={ref.label}>
              {ref.url ? (
                <a href={ref.url} target="_blank" rel="noopener noreferrer">
                  {ref.label}
                </a>
              ) : (
                ref.label
              )}
            </li>
          ))}
        </ul>
      )}

      {card.note && <div className="knowledge-note">{card.note}</div>}

      {card.partId && (
        <button
          type="button"
          className="knowledge-locate"
          onClick={() => onLocate(card.partId as string)}
        >
          在模型中定位
        </button>
      )}
    </aside>
  )
}
