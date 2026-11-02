/**
 * 场景选择器（板块 02）：5 个场景的下拉，切换触发懒加载并重置播放状态。
 */
import { SCENE_IDS } from '../data'
import { useStore } from '../store'

export default function ScenePicker() {
  const sceneId = useStore((s) => s.sceneId)
  const setScene = useStore((s) => s.setScene)

  return (
    <select
      value={sceneId ?? ''}
      onChange={(e) => void setScene(e.target.value)}
      aria-label="选择场景"
    >
      {SCENE_IDS.map((id) => (
        <option key={id} value={id}>
          {id}
        </option>
      ))}
    </select>
  )
}
