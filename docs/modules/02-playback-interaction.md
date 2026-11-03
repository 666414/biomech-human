# 02 回放与交互控制 `[P3 已实现]`

## 核心定位

系统的交互中枢：以「时间轴 t」为唯一驱动源，将预计算场景数据回放为 3D 动画，并统一处理用户的所有反向交互（拖动、跳转、部位选择）。

## 设计目标

1. 单一数据源：全局状态只保存一个 `t`（0 → T），所有联动由 t 派生，保证三处显示永远一致。
2. 播放控制完整：播放/暂停/慢速/逐帧/关键帧跳转。
3. 双向联动：拖时间轴 → 三处同步；拖曲线/点部位 → 时间轴跳转。

## 实现逻辑

- **全局状态（Zustand）**：`{ sceneId, t, playing, playbackRate, selectedPartId }`。
- **播放循环**：`requestAnimationFrame` 累加 dt × playbackRate 更新 t；到达 T 循环或停止（可配）。
- **每帧分发**（t 变更时）：
  - 对 t 做帧间插值（场景数据 30~60Hz，渲染 60fps，需线性插值）；
  - 调 01 模块的 `setPose(jointAngles(t))`；
  - 通知 03 模块更新曲线游标与读数；
  - 检查 t 是否落入关键帧区间 → 触发 04 知识卡弹出来自动联动。
- **反向联动**：监听 03 的曲线点击/拖动事件与 01 的部位选中事件 → 更新 t 或 selectedPartId。
- **时间轴 UI**：进度条 + 关键帧标记点（如 ACL 峰值受力时刻），点击标记直接跳转。

## 关键依赖

- 数据源：`scenes/<scene>.json`（06 流水线产物，含时序与 keyframes）。
- 下游调用：01 `setPose`、03 `updateCursor(t)`、04 `onKeyframe/t 变化`。

## 边界范围

- **包含**：播放控制、t 的管理、帧插值、联动分发、场景切换。
- **不包含**：模型渲染细节（01）、曲线绘制（03）、知识内容组织（04）、场景数据生成（06）。

## 核心流程说明

```
[用户选择场景] → 懒加载 scenes/<scene>.json → t 归零
[用户点击播放]
  → RAF 循环：t += dt × rate
  → 插值出当前帧 jointAngles / muscleAct / torques / GRF
  → 01.setPose()          （3D 姿态）
  → 03.updateCursor(t)    （曲线游标 + 读数）
  → 04.checkKeyframe(t)   （关键帧 → 自动弹卡）
[用户拖动曲线某时刻] → t = clickedT → 3D/游标/知识卡同步跳转
[用户点击关键帧标记] → t = keyframeT → 弹对应知识卡
```

## 验收要点

- 拖动时间轴时三处联动响应 < 50ms。
- 反向拖动（曲线 → 时间轴）同样准确。
- 播放/暂停/慢速/关键帧跳转在 4 浏览器一致。

## 实现对齐 `[P3 已实现]`

- 模块：`web/src/player/usePlayback.ts`（RAF 播放循环 + 帧派生订阅）、
  `web/src/player/sampleFrame.ts`（按 t 采样/插值出一帧）、
  `web/src/player/activeKeyframe.ts`（关键帧区间检查）、`web/src/store.ts`（Zustand 单一驱动源：
  sceneId/t/playing/playbackRate/selectedPartId + 场景加载与错误状态）、
  `web/src/components/Timeline.tsx`（进度条/关键帧标记/逐帧 ±/倍速/键盘 ←→ 步进）、
  `web/src/components/ScenePicker.tsx`（场景切换）、`web/src/App.tsx`（帧分发组合层与响应式外壳）
- 关键实现决策：
  - 播放循环体抽成 `createStepper().step(now)` 纯状态机（可单测）；MAX_STEP_DT（0.25s）尖峰钳制
    为增强实现，防后台标签页 RAF 停摆恢复后 t 大步跳变
  - 帧分发在 App 层组合：store.t 变化 → sampleFrame → ① Viewport setPose（ref 句柄）
    ② ParamCharts 游标与读数（同一 PlaybackFrame）③ activeKeyframe 关键帧弹卡，三处同帧一致
  - 反向联动统一走 store：Timeline seek / 曲线点击 onSeek / 部位拾取 selectPart
  - 场景切换异步期间显示全屏 loading 遮罩，失败（store.sceneError）显示错误 + 重试；
    键盘空格 = 播放/暂停（输入控件聚焦时让位原生行为）
- 与设计的偏差：插值与分发不内嵌于播放模块内部，而由 App 层组合（见上）；
  循环默认开启（loop=true，状态保留可配）
