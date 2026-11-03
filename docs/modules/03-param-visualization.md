# 03 生物力学参数可视化（ECharts） `[P3 已实现]`

## 核心定位

将预计算仿真数据转化为可读的力学参数曲线，与 3D 回放联动，帮助学生把「动作」与「数据」对应起来。

## 设计目标

1. 曲线类型覆盖教学核心：关节角度、关节力矩（N·m）、地面反作用力 GRF（N）、重点肌肉激活度（%MVC）。
2. 万级数据点下缩放/拖动流畅（dataZoom + LTTB 降采样）。
3. 游标与时间轴双向同步。

## 实现逻辑

- **数据接入**：读取当前场景 JSON，按参数类别分组为多个 series；每场景仅含 6~10 块教学重点肌肉。
- **图表布局**：右侧面板纵向堆叠多图（角度/力矩/GRF/肌肉激活），共享 x 轴（时间）；移动端 Tab 切换 + 全屏展开。
- **降采样**：LTTB 算法将曲线降到 ~2000 点用于交互态渲染；缩放（dataZoom）时按当前窗口重新取原始数据渲染。
- **游标联动**：监听 02 的 t 更新 → `markLine` 游标移动 + 当前帧读数面板（数值+单位）实时刷新。
- **反向联动**：监听用户在曲线上的点击/拖动 → 发出 `onSeek(t)`，由 02 统一处理跳转。
- **单位与精度**：数值统一保留 1 位小数，单位固定标注（N·m / N / %MVC），避免歧义。

## 关键依赖

- 库：echarts。
- 数据：`scenes/<scene>.json`（06 产物）。
- 联动方：02（t 来源与 onSeek 接收方）、04（肌肉选中事件可联动知识卡）。

## 边界范围

- **包含**：曲线渲染、降采样、游标联动、反向 seek 事件、读数面板。
- **不包含**：时间轴管理（02）、数据生成与单位定义（06 的场景文件约定）、教学解读文案（04）。

## 核心流程说明

```
场景加载 → 解析 JSON → LTTB 降采样 → 初始化 ECharts 多图
回放中  → 02 推送 t → markLine 游标移动 → 读数面板更新
[用户拖 dataZoom] → 按窗口取原始数据重渲
[用户点击曲线某时刻] → emit onSeek(t) → 02 跳转 → 全部联动
```

## 验收要点

- 单场景 1~2MB 数据下，dataZoom 拖动不卡顿（中端手机实测）。
- 游标与时间轴误差 ≤ 1 帧。
- 读数与场景 JSON 原始值一致（抽查对账）。

## 实现对齐 `[P3 已实现]`

- 模块：`web/src/charts/ParamCharts.tsx`（单 ECharts 实例 4 grid 纵向堆叠：曲线/dataZoom/
  graphic 游标/点击反向 seek/系列点击上抛）、`web/src/charts/buildChartSets.ts`（场景 JSON →
  图表数据组装 + readAt 帧读数，教学子集过滤规则在此）、`web/src/charts/lttb.ts`（LTTB 降采样）、
  `web/src/charts/cursor.ts`（游标 x 钳制）、`web/src/components/ReadoutPanel.tsx`（当前帧读数）
- 关键实现决策：
  - markLine 游标落为 graphic 竖线：单实例多 grid 布局下按 id 增量 setOption 移动，
    逐帧与 t 同步（≤ 1 帧），避免整卡重建
  - 教学子集双侧保 `_r` 规则：按模式命中关节后，有 `_r` 对应的 `_l` 剔除（`buildChartSets.ts`）；
    MuJoCo 膝关节 `_translation/_rotation/_beta` 自由度排除
  - LTTB 阈值 2000 点：当前场景数据（100~200 帧）不触发降采样，原样返回，保留供大数据扩展
  - 读数面板与曲线共用 buildChartSets 换算口径（同一帧 sampleFrame），与场景 JSON 原值对账；
    数值统一 1 位小数 + 单位标注（deg / N·m / N / %MVC）
  - dataZoom（inside+slider）窗口变化按原始数据重窗降采样重渲；拖动 dataZoom 不触发反向 seek
- 与设计的偏差：桌面布局为 3D 视口下方横排曲线区（非右侧面板纵向堆叠，随整体外壳布局）；
  移动端为「曲线」Tab 内展示 + 可全屏展开
