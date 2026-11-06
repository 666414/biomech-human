# 肌肉显示样式改造：实现方案与效果验证报告

日期：2026-11-06
参考样式：`9c64f63a8ce18b9c2c2510fd0d986d3b.png`（écorché 解剖风格：砖红肌腹 + 纤维纹路 + 米白肌腱/筋膜 + 湿润高光 + 深色背景轮廓光）

## 1. 结论摘要

肌肉显示已从「等半径圆柱管段」改为「纺锤形整根管 + 解剖配色 + 纤维质感 + 边缘光」，
颜色、形态、质感、层级契约四项均已落地并通过回归测试与浏览器多场景截图验证。

**但必须如实说明一点**：本工程没有解剖学肌肉网格，`muscle-meta.json` 里只有 700 块肌肉的
**折线（附着站点）**，且每个场景只渲染其中 6–8 块。因此本次是「用管状体 + 材质近似参考图的
视觉语言」，不是复原参考图的肌肉体积与肌间沟壑——参考图中的多束肌腹、肌间隙阴影、
筋膜层叠，在现有数据下无法一一对应。

## 2. 参考样式拆解 → 技术映射

| 参考特征 | 技术实现 | 代码位置 |
| --- | --- | --- |
| 肌腹粗、两端肌腱细的纺锤轮廓 | 沿弧长的半径剖面：两端 0.3R，中段 1.0R，`smoothstep` 过渡 | `web/src/three/muscleTube.ts` `muscleRadiusAt` |
| 中段砖红、两端米白 | 顶点色沿长度插值（`#ece2cd` → `#bb5540` → `#ece2cd`） | `MuscleTube` 构造中的 color attribute |
| 肌纤维纹路 | 程序化 canvas 竖向沟槽 bump 贴图（固定种子，确定性） | `web/src/three/muscleMaterial.ts` `getMuscleFiberTexture` |
| 湿润/缎面高光 | `MeshPhysicalMaterial`：`clearcoat 0.5 / clearcoatRoughness 0.35 / sheen 0.6` | `createMuscleMaterial` |
| 深色背景下的边缘轮廓光 | 材质内 Fresnel 项注入（`opaque_fragment` 前叠加 `pow(1-N·V, 3)`） | `createMuscleMaterial` `onBeforeCompile` |
| 光照层次 | 沿用场景既有 `AmbientLight 0.55 + DirectionalLight 1.6`，**不新增灯光** | `SceneManager` 构造函数 |

不新增灯光是刻意的：three 的方向光按场景全局生效，无法只作用于某一图层；新增轮廓光
会一并改变骨骼与皮肤的观感。改为材质内 Fresnel 后，骨骼/皮肤渲染结果完全不变。

## 3. 实现方案

### 3.1 几何：一整根管（`web/src/three/muscleTube.ts`，新增）

- **重采样**：折线按累计弧长均匀重采样为 `ringCount` 个环（8–17，按折线点数
  `(n-1)*4+1` 加密，保证两点肌肉也能显出纺锤形），避免折线段长短不一把剖面拉变形。
- **剖面**：`r(s) = R · (0.3 + 0.7 · bellyWeight(s))`，`bellyWeight` 在两端 12% 长度内
  `smoothstep` 过渡到 0，中段恒为 1（有一整段等宽肌腹平台）。
- **定向**：切向由中心差分求得，法向用平行传输（`Quaternion.setFromUnitVectors` 逐环推进），
  避免管子沿折线扭转导致条纹打旋。
- **封口**：两端各收一个锥尖顶点，避免空心截面。
- **UV / 顶点色**：`u` 绕周向（0–1）、`v` 沿长度（0–1），顶点色只写一次（静态），
  逐帧只重写 position + normal。
- **世界坐标**：几何直接写世界坐标，`SceneManager.updateMuscleGeometry` 每帧
  `localToWorld` 折线后调用 `tube.update()`，与既有姿态驱动链路一致（先 `updateMatrixWorld`）。

顶点量：每块肌肉 90–189 个顶点（`ringCount × (radial+1) + 2`），gait_cycle 场景 8 块肌肉
合计约 1.1k 顶点，逐帧 `computeVertexNormals` 的开销可忽略。

### 3.2 材质（`web/src/three/muscleMaterial.ts`，新增）

- `MeshPhysicalMaterial`：`roughness 0.42 / metalness 0 / clearcoat 0.5 / sheen 0.6`，
  `vertexColors: true`，`bumpMap` 为程序化纤维贴图（模块级单例，跨实例复用）。
- **边缘光**：`onBeforeCompile` 在 `#include <opaque_fragment>` 前叠加
  `uRimColor · pow(1 - saturate(dot(N, V)), 3) · uRimStrength`（暖白 0.55），
  只对肌肉材质生效。

### 3.3 激活度着色（语义保留）

解剖配色交给顶点色，材质 `color` 改为「激活度乘子」：静息 = 中性白（显示真实配色），
激活 = `rgb(1.5, 0.78, 0.66)`（更亮、更暖的红）。%MVC 仍在 `setMuscleActivations` →
`updateMuscleColors` 链路里逐帧线性插值，逐块肌肉独立染色。

### 3.4 契约保持（未改动）

- 图层可见性：`muscleRoot.visible`（`applyLayerVisibility`）不变。
- 图层透明度：仍走 `setMaterialOpacity(seg.material, ...)`，`MeshPhysicalMaterial` 继承
  `MeshStandardMaterial`，无需改签名。
- 点击拾取：肌肉仍不参与 raycast（与原先一致，拾取对象是 `meshGroup` 里的骨骼/皮肤网格）。
- 调试探针：`debugState().layerMeshes.muscle` 语义由「管段数」改为「整根管数」
  （13 段 → 8 根），已同步文档。

## 4. 逐条对照原始要求

| 要求 | 结果 | 说明 |
| --- | --- | --- |
| ① 线条表现 / 光影层次 / 色彩过渡 / 视觉质感 | 部分达成 | 形态、配色、高光、边缘光已对齐参考语言；肌间沟壑与多束肌腹受数据限制无法实现（见第 1 节） |
| ② 层级 / 透明度 / 描边一致 | 达成 | 图层开关、0–1 透明度、激活染色均保留；「描边」以 Fresnel 轮廓光替代（参考图本身无描边） |
| ③ 适配现有渲染逻辑，不同视图比例/缩放正常 | 达成 | 几何为世界坐标、与相机无关；1440×900 与 420×900 两种视口截图均正常，无拉伸/错位 |
| ④ 多姿态 / 多光照一致性 | 达成（受限） | 静止帧、播放中（hip flexion 164°）、正面/侧面三种状态截图一致跟随骨骼；场景无光照调节项，光照维度只能验证单一光照下的姿态变化 |
| ⑤ 输出方案 + 验证报告 | 本文档 | — |

## 5. 验证记录

### 5.1 自动化

- `vitest run src/tests/muscleTube.test.ts`：7 项通过（剖面单调性、端点/中点半径、
  顶点与索引数量、沿长度配色、退化折线、弯曲折线法线）。
- `vitest run src/tests/modelLayers.test.ts`：4 项通过（图层契约未回归）。
- 全量 `vitest run`：13 个文件 155 项通过；`smoke.test.tsx`（jsdom）在 300s+ 的整轮
  窗口内单独跑通 1 项（整轮串行时曾因 jsdom 环境启动超时而未计入，非本改动引入）。
- `tsc -b`：0 错误；`oxlint`：0 error；`vite build`：成功。

### 5.2 浏览器多场景截图（Edge headless + 真实场景数据）

截图目录：`docs/reports/shots/`

| 文件 | 场景 | 结果 |
| --- | --- | --- |
| `01-default.png` | 三层全开，默认机位 | 肌肉透过 0.25 不透明皮肤可见，未穿出体表 |
| `02-muscle-skeleton.png` | 关皮肤 | 肌肉沿股骨/胫骨分布，无断口 |
| `03-muscle-only.png` | 仅肌肉 | 纺锤形、两端收细清晰可辨 |
| `07-closeup-front.png` | 仅肌肉，3x 像素比特写 | 中段砖红、两端米白、湿润高光与轮廓光可辨 |
| `08-closeup-with-skeleton.png` | 肌肉+骨骼特写 | 体积感与骨骼层级关系正常 |
| `04-side-muscle-only.png` / `09-closeup-side.png` | 侧面 | 侧视管体无扭转、无自交 |
| `05-front-all-layers.png` | 三层全开 | 整体观感稳定 |
| `06-playing.png` | 播放中（hip flexion 164°） | 肌肉随姿态变形连续，无拉丝/断裂 |
| `10-narrow-viewport.png` | 420×900 窄视口 | 显示正常，无比例失真 |

`data-debug` 实测：`{"modelLoaded":true,"attempts":1,"bodyCount":81,"layerMeshes":{"skeleton":132,"muscle":8,"skin":1}}`，
浏览器控制台无 error / pageerror。

## 6. 已知差距与后续建议

1. **肌腹形态**：管体是单束近似，无法表达参考图中同一肌群内的多束肌腹与肌间沟。
   根治需要解剖肌肉网格（或由折线 + 半径场生成 SDF 包裹体），属于数据管线改造。
2. **纤维纹路**：当前肌腹直径 28mm，在常规视图下纤维条纹不足 1px，只有特写可见；
   若要常态可见需改为法线贴图并加大条纹尺度（会偏「风格化」而非解剖真实）。
3. **光照维度**：场景没有光照预设/调节，第 ④ 条只能在单一光照下验证多姿态；
   如需真正的多光照验证，建议为场景增加一套教学用光照预设（key/rim/fill 三档）。
4. **性能**：逐帧重写 8 根管（约 1.1k 顶点）+ `computeVertexNormals` 在桌面端可忽略；
   若后续把 `activeMuscles` 扩到几十块，应改为「姿态未变化时跳过重算」的脏检查。
