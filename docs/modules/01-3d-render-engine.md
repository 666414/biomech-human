# 01 3D 渲染引擎（Three.js + glTF） `[P3 已实现]`

## 核心定位

系统的核心可视化模块：在浏览器中加载转换后的人体 glTF 模型，提供旋转/缩放/部位拾取高亮等 3D 交互，是其他三个前端模块（回放控制、参数可视化、知识卡）的视觉主体。

## 设计目标

1. 正确还原 MS-Human-700 的 80 刚体层级与关节轴向（以 `rig-meta.json` 为唯一真值）。
2. 交互在桌面（鼠标）与移动端（触摸手势）体验一致。
3. 部位拾取与高亮为知识卡、参数可视化提供统一的部位选择入口。

## 实现逻辑

- **模型加载**：`GLTFLoader` + `DRACOLoader` 加载 `human.glb`；加载态显示进度条，失败显示重试。
- **层级映射**：glTF 节点树对应 MuJoCo body 层级；`rig-meta.json` 提供每个节点的：中英文名（`thigh_r → 右大腿 / Right Thigh`）、关节轴向与限位、所属分组（骨骼/肌肉/皮肤）。
- **相机控制**：`OrbitControls`；移动端单指旋转、双指捏合缩放；提供视角预设（正面/侧面/重点部位特写）。
- **拾取与高亮**：`Raycaster` 点击拾取 → 命中部位材质切换为高亮态，其余部位半透明遮罩；再次点击空白处恢复。
- **分层显示**：骨骼/肌肉/皮肤三层独立开关与透明度滑杆，适应不同教学深度。
- **姿态驱动**：暴露唯一接口 `setPose(jointAngles: Record<jointId, number>)`，由回放模块每帧调用，按关节限位 clamp 后写入节点旋转。

## 关键依赖

- 上游产物：`human.glb`（05 模型转换器）、`rig-meta.json`。
- 库：three（GLTFLoader/DRACOLoader/OrbitControls/Raycaster）。
- 被依赖方：02 回放控制（调 `setPose`）、04 知识卡（拾取事件回调）。

## 边界范围

- **包含**：模型加载、渲染、相机交互、拾取高亮、分层显示、姿态写入接口。
- **不包含**：时间轴逻辑（02 负责）、物理仿真（离线，06 负责）、力学计算（预计算数据直读）。

## 核心流程说明

```
进入场景页
  → 加载 human.glb（懒加载 + Draco 解压）
  → 建立 rig-meta 映射表（节点 ↔ 部位名 ↔ 分组）
  → 渲染初始 T-pose / 场景第 0 帧
  → [用户] 拖拽旋转/缩放视角
  → [用户] 点击部位 → Raycaster 命中
      → 高亮该部位 + 其余半透明
      → 发出 onSelectPart(partId) 事件（04 知识卡监听）
  → [回放模块] 每帧调 setPose() → 更新骨骼姿态
```

## 验收要点

- 部位点击返回正确中英文部位名（与 rig-meta 一致）。
- Draco 压缩后模型 < 8MB；低端机降质预设生效。
- 4 大浏览器 + 手机/平板/桌面真机交互正常。

## 实现对齐 `[P3 已实现]`

- 模块：`web/src/three/SceneManager.ts`（渲染器/相机/拾取高亮/分层显隐透明度/视角预设/画质档位）、
  `web/src/three/poseMap.ts`（节点映射与姿态写入）、`web/src/three/glbNodes.ts`（glb 节点巡检工具）、
  `web/src/three/fkCheck.ts`（运行时 FK 对账）、`web/src/components/Viewport.tsx`（React 桥接：
  加载进度/错误重试/拾取 click 语义/降质档判定/对外 ref 句柄）
- 关键实现决策：
  - 姿态驱动以 MuJoCo FK 对账 fixture 锁定（`web/src/tests/poseMap.test.ts`，位置误差 1e-7 m 级）；
    `?fkcheck=1` 运行时用 `public/data/fk-reference.json` 复核并打印结果
  - 关节锚点（anchor）平移补偿扩展进了 `pipeline/mjcf_parser.py` 与 `rig-meta.json`（P3 新增字段）：
    body 原点 ≠ 关节旋转轴（如膝关节 XML pos 非零）时，先平移回锚点再旋转，保证与 MuJoCo FK 一致
  - 材质加载时去共享（逐 mesh clone），高亮/分层透明度互不影响
  - 降质档位：high 档 pixelRatio ≤ 1.5，low 档关抗锯齿（上下文创建时生效）+ pixelRatio 1；
    `?quality=low|high` 显式指定，`?lite=1` 等价 low，缺省按视口宽 < 768 或 DPR > 2.5 自动判低
  - 拾取用 click 语义（pointerdown/up 位移 < 5px），避免 OrbitControls 拖拽视角误触部位选择
  - **Draco 已启用（P5）**：`GLTFLoader.setDRACOLoader()` 接模块级单例 `DRACOLoader`，
    `setDecoderPath('./draco/')`（相对路径，适配任意 `base` / 子目录部署）；解码器三件套
    （`draco_decoder.js` / `.wasm` / `draco_wasm_wrapper.js`）由构建期 `sync-assets` 复制到
    `web/public/draco/`。模型 10.0MB → 0.62MB，加载超时兜底按实测字节数（646,860）估算进度，
    `loadGltfOnce` 失败自动重试 1 次（1.5s 后）
- 与设计的偏差：场景未启用阴影贴图（光照为环境光 + 方向光，无阴影系统，「低端关阴影」缺省满足）；
  视角预设落地为正面/侧面/复位三档（复位 = 初始机位），重点部位特写由知识卡「在模型中定位」承担
