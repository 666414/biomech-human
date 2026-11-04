# 人体生物力学交互演示系统 — 板块文档索引

> 项目：基于开源肌骨骼模型 MS-Human-700（MuJoCo XML，700 肌肉执行器 / 85 关节 / 80 刚体）的 Web 端生物力学教学演示系统。
> 面向：医学/康复方向教学；纯静态部署；全设备自适应。
>
> **对齐约定**：所有板块文档与实际实现严格对齐。设计阶段文档标注 `[状态: 设计已批准]`；实现落地后每个板块文档必须随代码同步更新，并附实际入口文件路径。

## 文档清单

| 编号 | 板块 | 文档 | 对应代码位置（实现后回填） |
|---|---|---|---|
| 00 | 系统总览与架构 | [00-overview.md](00-overview.md) | — |
| 01 | 3D 渲染引擎 | [01-3d-render-engine.md](01-3d-render-engine.md) | `web/src/three/`、`web/src/components/Viewport.tsx` |
| 02 | 回放与交互控制 | [02-playback-interaction.md](02-playback-interaction.md) | `web/src/player/`、`web/src/store.ts`、`web/src/components/Timeline.tsx`、`web/src/App.tsx` |
| 03 | 生物力学参数可视化 | [03-param-visualization.md](03-param-visualization.md) | `web/src/charts/`、`web/src/components/ReadoutPanel.tsx` |
| 04 | 知识点标注与讲解 | [04-knowledge-annotation.md](04-knowledge-annotation.md) | `web/src/knowledge/`、`web/src/data.ts`、`web/src/store.ts` |
| 05 | 模型转换流水线 | [05-model-pipeline.md](05-model-pipeline.md) | `pipeline/` |
| 06 | 仿真预计算流水线 | [06-simulation-pipeline.md](06-simulation-pipeline.md) | `pipeline/simulate_scene.py` |
| 07 | 知识库内容管理 | [07-knowledge-base.md](07-knowledge-base.md) | `content/knowledge/ + web/scripts/validate-knowledge.mjs` |
| 08 | 部署与性能优化 | [08-deployment-performance.md](08-deployment-performance.md) | 部署配置 / Service Worker |

## 审查用法

- **合规性/合理性校验**：直接读对应板块文档的「边界范围」与「核心流程说明」，无需回溯代码。
- **迭代重构**：先读板块文档建立认知，再进代码；重构完成后必须回写文档。
- **一致性检查点**：每次实现变更后，核对文档「实现逻辑」与代码是否一致，不一致即视为缺陷。
