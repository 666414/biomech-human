# 04 知识点标注与讲解 `[P3 已实现]`

## 核心定位

教学内容的展示层：将知识库中的结构化讲解与 3D 部位、时间轴关键帧关联，实现「点哪里、讲哪里」的教学联动。

## 设计目标

1. 部位↔知识卡双向联动：3D 点击部位弹卡；卡内定位按钮反向高亮 3D 部位。
2. 关键帧自动讲解：播放到损伤风险等关键帧时自动弹出对应知识卡。
3. 内容可运营：教师通过编辑 JSON 即可增改知识卡，无需改代码。

## 实现逻辑

- **知识卡结构**（与 `content/knowledge/*.json` 一一对应）：
  - `id`（与 rig-meta 部位名表同一套 ID 键）
  - `term`（中英术语）
  - `anatomy`（解剖定位）
  - `biomech`（力学解释）
  - `clinic`（临床/康复关联）
  - `refs`（图文引用）
- **触发路径**：
  1. 01 拾取事件 `onSelectPart(partId)` → 按 partId 查卡 → 弹出；
  2. 02 关键帧事件 → 按场景 keyframe 预置的 cardId 弹出；
  3. 曲线系列点击（03）→ 按肌肉/关节 ID 查卡。
- **反向定位**：卡内「在模型中定位」按钮 → 调 01 高亮该部位并切特写视角。
- **UI 形态**：桌面端右栏卡片；移动端底部抽屉，可展开全屏阅读。

## 关键依赖

- 数据：`content/knowledge/*.json`（07 板块管理）、`rig-meta.json` 部位名表（05 产物）。
- 联动方：01（拾取/高亮接口）、02（关键帧事件）、03（曲线点击事件）。

## 边界范围

- **包含**：知识卡渲染、三类触发联动、反向定位、内容 JSON 读取。
- **不包含**：内容生产与审核（07 负责）、部位拾取实现（01）、关键帧定义（06 场景文件）。

## 核心流程说明

```
[用户点击 3D 部位]
  → 01 onSelectPart(partId)
  → 查 knowledge.json[partId]
  → 弹卡（术语/解剖/力学/临床/引用）
[播放到达关键帧 t']
  → 02 checkKeyframe(t') 命中
  → 自动弹卡 + 时间轴标记高亮
[用户点卡内「定位」]
  → 01.highlight(partId) + 相机特写
```

## 验收要点

- 首批 5 场景 × ≥5 张 = ≥25 张知识卡，全部通过医学方向审核。
- 三条触发路径 + 反向定位全部可用。
- 修改 JSON 无需改代码即可生效（重新部署静态资源）。

## 实现对齐 `[P3 已实现]`

- 模块：`web/src/knowledge/KnowledgePanel.tsx`（卡片渲染：术语/解剖/力学/临床/引用/定位按钮）、
  `web/src/knowledge/knowledge.ts`（checkKeyframeCard 关键帧弹卡判定与 findSeriesCard 查卡，纯函数）、
  `web/src/data.ts`（loadKnowledge 容错加载 + indexKnowledge 索引）、
  `web/src/store.ts`（activeCard/activeCardSource/activeKeyframeId 状态机）、
  `web/src/App.tsx`（三条触发路径接线 + 拾取/关键帧/系列联动 effect）
- 关键实现决策：
  - 三条触发路径齐备：① 3D 拾取 → store.selectPart → 按 partId 弹卡；② 播放进入关键帧区间 →
    checkKeyframeCard 区间去重（同区间不重复弹、离开不强制关）；③ 曲线系列点击 → 按
    关节/肌肉 id 先 partId 后 cardId 查卡
  - 反向定位：卡内「在模型中定位」→ focusPart 相机特写 + selectPart 高亮
  - 知识索引唯一来源 store.knowledgeIndex（setKnowledge 时重建），App 层只读消费
  - 部位拾取弹卡只在「选中变化」时覆盖当前卡：知识索引异步重建不误关正在展示的关键帧/系列卡
- 与设计的偏差：内容为 stub（`web/public/data/knowledge/knowledge.json` 16 张，含 10 张关键帧卡 +
  6 张部位卡，P4 补全并做医学方向审核）；note 字段承载 stub 标注（「P4 医学审核」提示）；
  移动端形态落地为知识 Tab 内底部抽屉（≤900px），桌面为右侧栏卡片
