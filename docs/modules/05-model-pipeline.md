# 05 模型转换流水线（MuJoCo → glTF） `[P1 已实现]`

## 核心定位

开发期一次性运行的离线工具：把 MS-Human-700 的 MuJoCo XML + STL 资产转换为 Web 可用的 glTF 模型与元数据，是整个系统数据链路的源头。

## 设计目标

1. 忠实转换：80 刚体层级、关节轴向/限位、网格几何不丢失不变形。
2. 教学化命名：研究用英文缩写映射为中英双语部位名表。
3. 体积可控：Draco 压缩后模型 < 8MB。

## 实现逻辑（pipeline/convert_model.py）

- **输入**：`MS-Human-700.xml`（及 Locomotion / Manipulation 变体）+ mesh STL 资产。
- **步骤**：
  1. 解析 XML `<worldbody>` 递归结构 → glTF 节点树（父子关系即刚体层级）；
  2. STL 网格读取 → 按 XML 中 `<geom>` 的 pos/quat 变换装配到对应节点；
  3. 数据瘦身：保留骨性结构全量 + 精选 ~40 块教学重点肌肉几何，其余剔除（剔除清单可配置）；
  4. 生成 `rig-meta.json`：节点 ↔ 部位中英文名 ↔ 分组（骨骼/肌肉/皮肤）↔ 关节轴向与限位；
  5. Draco 压缩导出 `human.glb`。
- **正确性校验**（以 XML 为唯一真值）：转换后自动断言——节点数 = body 数、每个关节的轴向/限位与 XML 一致、网格包围盒与原 STL 偏差 < 阈值。
- **可重复运行**：脚本无交互、参数化输入输出路径；模型升级或场景新增时重跑即可。

## 关键依赖

- 上游：MS-Human-700 仓库资产（保留出处声明，引用 ICRA 2024 论文）。
- Python 库：mujoco（XML 解析）、numpy、trimesh（STL 处理）、draco 编码器。
- 下游：01（human.glb / rig-meta.json）、04（部位 ID 键）。

## 边界范围

- **包含**：格式转换、命名映射、几何瘦身、Draco 压缩、正确性自动校验。
- **不包含**：仿真计算（06 负责）、网格重拓扑/减面算法优化（如 Draco 后仍超标再做 LOD 减面，列为风险应对）、Web 端任何逻辑。

## 核心流程说明

```
MS-Human-700.xml + STL
  → 解析 body 树 → 构建节点树
  → 装配网格（pos/quat 变换）
  → 应用剔除清单（肌肉瘦身）
  → 生成部位名表 rig-meta.json
  → Draco 压缩 → human.glb
  → 自动校验（节点数/轴向/限位/包围盒）
  → 输出到 静态资源层
```

## 验收要点（P1）

- Three.js 加载成功、层级正确、部位点击返回正确中英文名。
- Draco 后 < 8MB；校验脚本全部通过。
- 先以 Locomotion 简化模型验证管线，再跑全身模型（风险控制策略）。

## 实现对齐 `[P1 已实现]`

- 模块：`pipeline/mjcf_parser.py`（include 合并 + body 树）、`pipeline/mesh_assembler.py`（场景图装配）、
  `pipeline/rig_meta.py`（部位名表）、`pipeline/glb_export.py`（GLB 导出）、`pipeline/validate.py`（交叉校验）
- CLI：`pipeline/convert_model.py`；用法：
  `python -m pipeline.convert_model --xml assets/MS-Human-700/MS-Human-700-Locomotion.xml --root assets/MS-Human-700 --out pipeline/out/locomotion`
- 与设计的偏差：Draco 压缩延后至 P5（需 Node.js 的 gltf-transform）；中文名映射缺失时回退英文名
- 产出记录：Locomotion（`MS-Human-700-Locomotion.xml`）bodies=80 / geoms=132，human.glb 10,049,516 字节（9.58MB），
  校验通过；排除清单为空——检查发现全部 body 均为骨性结构，8 个 phantom 附加体
  （`clavphant_*` / `scapphant_*` / `humphant_*` / `humphant1_*`，左右各 4 个）不携带任何 mesh geom，
  排除无收益，故不为凑体积剔除真实骨骼。全身模型（`MS-Human-700.xml`）bodies=80 / geoms=132，
  human.glb 10,049,520 字节（9.58MB），校验通过（与 Locomotion 共享同一套几何资产）。
  体积验收线（8MB）：P1 未压缩超 8MB，标记为 P5 Draco 后复验（Draco 预期压缩 60-80%，9.6MB → 预计 <4MB）；
  8MB 线语义为约束 Locomotion 教学模型。

### Draco 复验（P5 已完成）

- 管线：`web/scripts/compress-glb.mjs`（`@gltf-transform/cli` 的 `draco` 子命令，**不做 optimize**，
  避免 flatten/join 破坏节点层级）；`npm run sync-assets` 内联调用，产物落 `web/public/data/models/human.glb`，
  原始未压缩 glb 保留在 `pipeline/out/fullbody/` 不动。
- 实测：**10,049,520 B → 646,860 B（-93.6%，0.62MB）**，8MB 线通过且余量 12 倍。
- 不变性验证：压缩前后 glb JSON chunk 的节点数（212）、节点名（= rig-meta id）、层级与 TRS 变换完全一致
  （matrix→TRS 等价改写最大误差 2.2e-16）；`?fkcheck=1` 在压缩产物上仍为 1e-7 m 级误差。
- 幂等与守卫：源 glb 的 sha256 与产物 stamp 存 `node_modules/.cache/`，源未变则跳过；`--force` 强制重压；
  产物内置 GLB magic 校验 + 8MB 超限直接 exit 1（构建期兜底）。
- 解码器：three r187 的 `draco_decoder.js` / `draco_decoder.wasm` / `draco_wasm_wrapper.js` 由
  `ensureDracoDecoders()` 复制到 `web/public/draco/`，运行时按相对路径 `./draco/` 加载。

### 图层几何导出（P5 修复：肌肉/皮肤滑杆生效）

**故障现象**：顶栏「肌肉」「皮肤」滑杆无任何视觉变化。

**根因**：glb 只有骨骼网格、rig-meta 只有 `skeleton` 分组 → `setLayerVisible/setLayerOpacity`
的过滤循环体永不执行（无对象可改）。上游两处成因：

1. `mjcf_parser._parse_body` 只保留 `type="mesh"` 的 geom，而源模型的皮肤是
   `class="skin"` 提供的 `type="capsule"`（默认类属性），解析阶段即被丢弃；
2. MuJoCo 模型里肌肉**没有可视几何**（`Muscle/*.xml` 只有 `<general class="muscle" tendon=...>` 执行器），
   肌肉的解剖路径在 `Tendon/*.xml` 的 `<spatial>` 站点中；
3. `rig_meta._group_of` 仅按 body 名判组，80 个 body 全是骨骼名，永远得不到 muscle/skin。

**修复内容**：

- `mjcf_parser.py`：新增 `<default class="x">` 展开（全局默认 → 类默认 → 元素属性），
  解析 geom 的 `type/size/group/class`；额外产出 `sites`（site 名 → body + 局部坐标）、
  `tendons`（spatial 肌腱名 → site 引用顺序）、`actuators`（执行器名 → 肌腱名）。
- `mesh_assembler.py`：皮肤胶囊（`class="skin"` + `type="capsule"` + `size=[r, half_len]`）
  用 `trimesh.creation.capsule(height=2*half_len)` 生成节点 `<body>__<geom>`（如
  `femur_r__femur_skin_r`），挂在对应 body 下并随骨骼运动。
- `rig_meta.py`：`parts` 仍为 80 个 body（骨骼，保持 `parts.length === 80` 的既有契约），
  新增顶层 `attachments: [{id, parent, group:'skin', names:{en, zh}}]`（14 条，zh 由父部位名派生）。
- `muscle_meta.py`（新）：执行器 → 肌腱 → 站点折线，输出
  `muscle-meta.json`：`{"muscles": {"<执行器名>": {"tendon", "points":[{"body","pos"}]}}}`，
  覆盖 700 个执行器；前端只渲染当前场景 `muscles` 名单（6–8 块）。
- `validate.py`：新增附件节点存在性与 parent 有效性校验。

**复核命令与实测**：

```
python -m pipeline.convert_model --xml assets/MS-Human-700/MS-Human-700.xml \
  --root assets/MS-Human-700 --out pipeline/out/fullbody
```

`bodies=80 geoms=146 skin_nodes=14 muscles=700`，human.glb 10,085,300 B →
Draco 后 **671,448 B**；glb 节点数 226（212 骨骼 + 14 皮肤），`rig-meta.json` 64KB、
`muscle-meta.json` 178KB（gzip 后约 25KB）。

**已知边界**：Primary 模型只有下肢/足部皮肤几何（`Body_Primary/Body_Leg_Foot_{r,l}.xml`
各 7 个胶囊），躯干与上肢在源模型中不含皮肤；肌肉为肌腱站点折线示意管（非解剖肌肉网格），
且只取 `<site>` 参考点、跳过 `<geom>` 包裹点。
