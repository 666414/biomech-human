# 人体生物力学交互演示（web）

基于 MS-Human-700 肌骨骼模型的浏览器端教学演示：时间轴 `t` 单一驱动源，同时联动
3D 姿态、参数曲线与知识卡。技术栈 Vite + React 19 + TypeScript + three.js + ECharts + Zustand。

## 开发

```powershell
npm ci
npm run dev          # 本地开发（不注册 Service Worker）
```

首次开发前确认 `public/data/` 已有资源（该目录为派生目录、已 gitignore）：

```powershell
npm run sync-assets  # 校验知识库 → Draco 压缩 glb → 复制 rig-meta/scenes/知识卡 → 准备 draco 解码器
```

源数据来源：`pipeline/out/`（05/06 流水线产物）、`content/knowledge/`（07 知识卡，唯一编辑源）。

## 常用命令

| 命令 | 说明 |
|---|---|
| `npm run dev` | 开发服务器 |
| `npm run build` | 类型检查 + 生产构建 → `dist/` |
| `npm run preview` | 预览生产产物（可在 localhost 验证 Service Worker） |
| `npm run sync-assets` | 资源同步（含知识库校验门、glb Draco 压缩） |
| `npm run validate:knowledge` | 单独跑知识库一致性校验 |
| `npm run compress-glb` | 单独跑模型压缩（`--force` 强制重压） |
| `npx vitest run --pool=threads --fileParallelism=false` | 单元测试（Windows 下必须显式指定池，默认 forks 会启动超时） |
| `npm run lint` | oxlint |

## 调试参数

- `?fkcheck=1`：运行时用 `public/data/fk-reference.json` 对账 MuJoCo FK，结果打印到 console 并显示浮层
- `?quality=low|high` / `?lite=1`：显式指定画质档（缺省按视口宽 < 768 或 DPR > 2.5 自动降档）

## 部署

见 [DEPLOY.md](./DEPLOY.md)：构建前置、三通道（GitHub Pages / 静态托管 / 校内 Nginx·IIS）、
缓存与 Service Worker 说明、离线边界与验收清单。

## 文档

系统设计与各板块实现对齐见仓库 `docs/modules/`（00 总览、01 渲染、02 回放、03 图表、04 知识卡标注、
05 模型流水线、06 仿真预计算、07 知识库、08 部署与性能）。
