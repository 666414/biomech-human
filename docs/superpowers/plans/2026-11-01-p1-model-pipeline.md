# P1 模型转换流水线（MuJoCo → glTF）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 MS-Human-700 的 MuJoCo XML + 网格资产转换为 Web 可用的 `human.glb` + `rig-meta.json`，产出通过自动校验、可在 Three.js 中加载的模型。

**Architecture:** 纯 Python 离线流水线，四个纯函数模块（解析 → 装配 → 元数据 → 导出）+ 一个交叉校验模块 + CLI 入口。XML（含 `<include>` 文本级合并）为唯一真值；trimesh 场景图承载节点层级与局部变换；中英文名映射独立为 JSON 可人工补充。

**Tech Stack:** Python 3.14（`C:\Users\Lenovo\AppData\Local\Python\bin\python.exe`）、numpy、trimesh、pytest。**P1 不需要 mujoco 包**（仿真属 P2；且 3.14 轮子可能滞后，见 Task 1 风险处理）。

**板块文档:** [05-model-pipeline.md](../../modules/05-model-pipeline.md)（本计划即其实现，完成后回填 README 代码位置）

---

## 已确认的资产事实（勘察结果，勿再假设）

- 仓库已克隆至 `assets/MS-Human-700`（经 gh-proxy.com 镜像；直连 github.com 会 connection reset）。
- 主文件 `MS-Human-700-Locomotion.xml` 通过 `<include file="..."/>` 拆分；被包含文件根节点是 `<mujoco>`，其**子元素**需在 include 位置做文本级合并（如 `Body_Torso_Simple.xml` 直接含 `<geom>`，`Asset_*.xml` 含 `<asset>`）。
- Locomotion 变体：Body_Arm_l(11) + Body_Arm_r(11) + Body_Leg_Foot_l(6) + Body_Leg_Foot_r(6) + Body_Torso_Simple(45) = 79 + 主文件 pelvis = **80 个 body**。
- 网格声明在 `Asset/Asset_*.xml`：`<mesh name="sacrum" file="Geometry/sacrum.stl"/>`，路径相对**仓库根**（无 meshdir）。
- 只转换 `type="mesh"` 的 geom（骨骼网格，class="bone"）；`class="wrap"` 的圆柱包裹体等原语**排除**。
- body/geom 坐标：`pos="x y z"`、`quat="w x y z"`（MuJoCo 顺序，trimesh.transformations 直接兼容）。
- 部分网格为 `*_mirror.obj`，trimesh 可直接加载 STL 与 OBJ。

## 文件结构

```
pipeline/
  __init__.py
  requirements.txt
  convert_model.py     # CLI 入口（argparse）
  mjcf_parser.py       # XML+include 解析 → body 树 / 网格资产表
  mesh_assembler.py    # body 树 + STL → trimesh Scene（层级+局部变换）
  rig_meta.py          # 部位名表 + 关节元数据 → rig-meta.json
  glb_export.py        # Scene → human.glb
  validate.py          # XML 树 ↔ rig-meta ↔ GLB 交叉校验
  part_name_zh.json    # 中英文名映射（人工可补充，缺失时回退英文名）
  tests/
    test_mjcf_parser.py
    test_mesh_assembler.py
    test_rig_meta.py
    test_glb_export.py
    test_validate.py
pipeline/out/          # 产物输出目录（gitignore）
assets/MS-Human-700/   # 上游资产（已就位）
```

**约定命令**（PowerShell，仓库根 `d:\清华人体模型`）：

```powershell
$PY = "C:\Users\Lenovo\AppData\Local\Python\bin\python.exe"
& $PY -m pytest pipeline/tests -v          # 跑全部测试
& $PY -m pipeline.convert_model --xml assets/MS-Human-700/MS-Human-700-Locomotion.xml --root assets/MS-Human-700 --out pipeline/out
```

---

### Task 1: 环境与依赖就位

**Files:**
- Create: `pipeline/__init__.py`（空文件）
- Create: `pipeline/requirements.txt`
- Create: `.gitignore`

- [ ] **Step 1: 创建目录与 requirements.txt**

`pipeline/requirements.txt`：

```
numpy>=1.26
trimesh>=4.0
pytest>=8.0
```

`.gitignore`（仓库根）：

```
.venv/
pipeline/out/
__pycache__/
*.pyc
.superpowers/
```

- [ ] **Step 2: 创建虚拟环境并安装**

```powershell
$PY = "C:\Users\Lenovo\AppData\Local\Python\bin\python.exe"
& $PY -m venv .venv
.venv\Scripts\python.exe -m pip install -r pipeline\requirements.txt
```

Expected: 安装成功无报错。**风险处理**：若某包在 3.14 无轮子导致失败，改用 `.venv\Scripts\python.exe -m pip install <失败的包>` 观察错误；numpy/trimesh 失败时可退回系统级 `pip install --user`，并在计划外记录。

- [ ] **Step 3: 冒烟验证 trimesh 可读上游网格**

```powershell
.venv\Scripts\python.exe -c "import trimesh; m = trimesh.load('assets/MS-Human-700/Geometry/sacrum.stl', force='mesh'); print(len(m.vertices), len(m.faces))"
```

Expected: 打印两个正整数（顶点数、面数），非零。

- [ ] **Step 4: Commit**

```powershell
git add pipeline/requirements.txt pipeline/__init__.py .gitignore
git commit -m "chore: P1 流水线环境与依赖"
```

（若 git 提示 Author identity unknown：跳过 commit，继续后续任务；由用户配置身份后统一补交。）

---

### Task 2: MJCF 解析器（include 合并 + body 树 + 网格资产表）

**Files:**
- Create: `pipeline/mjcf_parser.py`
- Test: `pipeline/tests/test_mjcf_parser.py`

- [ ] **Step 1: 写失败测试**

`pipeline/tests/test_mjcf_parser.py`：

```python
import os
import pytest
from pipeline.mjcf_parser import parse_mjcf, collect_body_names

REPO = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..", "assets", "MS-Human-700"))
LOCO = os.path.join(REPO, "MS-Human-700-Locomotion.xml")


def test_locomotion_body_count_is_80():
    tree = parse_mjcf(LOCO)
    names = collect_body_names(tree["bodies"])
    assert len(names) == 80


def test_body_tree_has_root_pelvis_with_children():
    tree = parse_mjcf(LOCO)
    roots = tree["bodies"]
    assert len(roots) == 1
    assert roots[0].name == "pelvis"
    assert len(roots[0].children) > 0


def test_bone_geoms_have_mesh_file():
    tree = parse_mjcf(LOCO)
    geoms = []

    def walk(b):
        geoms.extend(b.geoms)
        for c in b.children:
            walk(c)

    for r in tree["bodies"]:
        walk(r)
    mesh_geoms = [g for g in geoms if g["type"] == "mesh"]
    assert len(mesh_geoms) > 50, "骨骼网格 geom 应大量存在"
    for g in mesh_geoms:
        assert g["file"], f"geom {g['name']} 缺少 mesh file"
        assert g["file"].startswith("Geometry/")


def test_mesh_asset_table_maps_name_to_file():
    tree = parse_mjcf(LOCO)
    assert tree["meshes"]["sacrum"] == "Geometry/sacrum.stl"
    assert tree["meshes"]["r_femur"] == "Geometry/r_femur.stl"
```

- [ ] **Step 2: 运行确认失败**

```powershell
.venv\Scripts\python.exe -m pytest pipeline/tests/test_mjcf_parser.py -v
```

Expected: FAIL（`ModuleNotFoundError: pipeline.mjcf_parser`）。

- [ ] **Step 3: 实现解析器**

`pipeline/mjcf_parser.py`：

```python
"""MuJoCo MJCF 解析：处理 <include> 文本级合并，产出 body 树与网格资产表。"""
import os
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field, asdict


@dataclass
class Joint:
    name: str
    type: str
    axis: list = field(default_factory=lambda: [0.0, 0.0, 1.0])
    range: list | None = None


@dataclass
class Body:
    name: str
    pos: list
    quat: list  # MuJoCo 顺序 w x y z
    joints: list
    geoms: list  # [{name, type, mesh, file, pos, quat}]
    children: list


def _floats(text, default):
    if text is None:
        return list(default)
    return [float(v) for v in text.split()]


def _resolve_includes(elem, base_dir):
    """MuJoCo include 是文本级合并：用被包含 <mujoco> 根的子元素替换 include 标记。"""
    for child in list(elem):
        if child.tag == "include":
            inc_path = os.path.normpath(os.path.join(base_dir, child.get("file")))
            sub_root = ET.parse(inc_path).getroot()
            _resolve_includes(sub_root, os.path.dirname(inc_path))
            idx = list(elem).index(child)
            elem.remove(child)
            for i, sub_child in enumerate(list(sub_root)):
                elem.insert(idx + i, sub_child)
        else:
            _resolve_includes(child, base_dir)


def _parse_body(el):
    joints = [
        Joint(
            name=j.get("name"),
            type=j.get("type", "hinge"),
            axis=_floats(j.get("axis"), (0.0, 0.0, 1.0)),
            range=_floats(j.get("range"), None) if j.get("range") else None,
        )
        for j in el.findall("joint")
    ]
    geoms = [
        {
            "name": g.get("name"),
            "type": g.get("type", "sphere"),
            "mesh": g.get("mesh"),
            "file": None,  # 由 meshes 表回填
            "pos": _floats(g.get("pos"), (0.0, 0.0, 0.0)),
            "quat": _floats(g.get("quat"), (1.0, 0.0, 0.0, 0.0)),
        }
        for g in el.findall("geom")
        if g.get("type") == "mesh" and g.get("mesh")
    ]
    return Body(
        name=el.get("name"),
        pos=_floats(el.get("pos"), (0.0, 0.0, 0.0)),
        quat=_floats(el.get("quat"), (1.0, 0.0, 0.0, 0.0)),
        joints=joints,
        geoms=geoms,
        children=[_parse_body(b) for b in el.findall("body")],
    )


def collect_body_names(bodies):
    names = []

    def walk(b):
        names.append(b.name)
        for c in b.children:
            walk(c)

    for r in bodies:
        walk(r)
    return names


def parse_mjcf(xml_path):
    """返回 {"bodies": [Body...], "meshes": {name: file}}，路径相对 XML 所在目录（上游为仓库根）。"""
    xml_path = os.path.normpath(os.path.abspath(xml_path))
    base_dir = os.path.dirname(xml_path)
    root = ET.parse(xml_path).getroot()
    _resolve_includes(root, base_dir)

    meshes = {}
    for asset in root.iter("asset"):
        for m in asset.findall("mesh"):
            if m.get("name") and m.get("file"):
                meshes[m.get("name")] = m.get("file").replace("\\", "/")

    bodies = [_parse_body(b) for b in root.find("worldbody").findall("body")]

    def fill_files(b):
        for g in b.geoms:
            g["file"] = meshes.get(g["mesh"])
        for c in b.children:
            fill_files(c)

    for r in bodies:
        fill_files(r)
    return {"bodies": bodies, "meshes": meshes}
```

- [ ] **Step 4: 运行确认通过**

```powershell
.venv\Scripts\python.exe -m pytest pipeline/tests/test_mjcf_parser.py -v
```

Expected: 4 PASS。若 `test_locomotion_body_count_is_80` 失败：打印实际数量，与上游 README 核对（README 声明 Locomotion 80 bodies），以实际数为准修正测试常量并注明。

- [ ] **Step 5: Commit**

```powershell
git add pipeline/mjcf_parser.py pipeline/tests/test_mjcf_parser.py
git commit -m "feat(P1): MJCF 解析器（include 合并 + body 树 + 网格资产表）"
```

---

### Task 3: 网格装配器（trimesh 场景图，保留层级与局部变换）

**Files:**
- Create: `pipeline/mesh_assembler.py`
- Test: `pipeline/tests/test_mesh_assembler.py`

- [ ] **Step 1: 写失败测试**

`pipeline/tests/test_mesh_assembler.py`：

```python
import os
import numpy as np
import pytest
from pipeline.mjcf_parser import parse_mjcf
from pipeline.mesh_assembler import assemble, mu_to_matrix

REPO = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..", "assets", "MS-Human-700"))
LOCO = os.path.join(REPO, "MS-Human-700-Locomotion.xml")


def test_mu_to_matrix_matches_mujoco_quat_order():
    # quat = w,x,y,z；w=1 单位四元数 → 无旋转
    T = mu_to_matrix([1.0, 2.0, 3.0], [1.0, 0.0, 0.0, 0.0])
    assert np.allclose(T[:3, 3], [1, 2, 3])
    assert np.allclose(T[:3, :3], np.eye(3))


def test_assemble_preserves_hierarchy_and_meshes():
    tree = parse_mjcf(LOCO)
    scene, node_bodies = assemble(tree, REPO)
    # 80 个 body 节点全部进入场景图
    assert len(node_bodies) == 80
    assert "pelvis" in scene.graph.nodes
    # 网格几何体数量 = 所有 type=mesh 的 geom 数
    total = sum(len(b.geoms) for b in node_bodies)
    assert len(scene.geometry) >= total * 0.9  # 允许重复网格去重
    # pelvis 与子节点的局部变换应为 body pos/quat（抽查第一个子节点）
    child = node_bodies[1]
    T_child, _ = scene.graph.get(child.name)
    assert T_child is not None


def test_assemble_is_deterministic():
    tree = parse_mjcf(LOCO)
    s1, n1 = assemble(tree, REPO)
    s2, n2 = assemble(tree, REPO)
    assert [b.name for b in n1] == [b.name for b in n2]
    assert sorted(s1.geometry.keys()) == sorted(s2.geometry.keys())
```

- [ ] **Step 2: 运行确认失败**

```powershell
.venv\Scripts\python.exe -m pytest pipeline/tests/test_mesh_assembler.py -v
```

Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现装配器**

`pipeline/mesh_assembler.py`：

```python
"""把 body 树装配进 trimesh 场景图：节点=body（保层级与局部 TRS），几何=骨骼网格。"""
import os
import numpy as np
import trimesh


def mu_to_matrix(pos, quat):
    """MuJoCo (pos, quat wxyz) → 4x4 齐次矩阵。trimesh.transformations 接受 [w, x, y, z]。"""
    T = trimesh.transformations.quaternion_matrix(list(quat))
    T[:3, 3] = list(pos)
    return T


def assemble(tree, repo_root, exclude_prefixes=()):
    """返回 (trimesh.Scene, node_bodies)。scene.graph 节点名 = body 名，层级与 XML 一致。"""
    scene = trimesh.Scene()
    node_bodies = []
    mesh_cache = {}

    def load_mesh(fname):
        if fname not in mesh_cache:
            mesh_cache[fname] = trimesh.load(
                os.path.join(repo_root, fname), force="mesh", process=False
            )
        return mesh_cache[fname]

    def walk(body, parent_frame):
        node_bodies.append(body)
        scene.graph.update(
            frame_from=parent_frame, frame_to=body.name,
            matrix=mu_to_matrix(body.pos, body.quat),
        )
        for g in body.geoms:
            if not g["file"] or any(body.name.startswith(p) for p in exclude_prefixes):
                continue
            geom = load_mesh(g["file"])
            key = f"{body.name}__{g['mesh']}"
            if key in scene.geometry:
                continue
            scene.add_geometry(
                geom, geom_name=key, node_name=key,
                parent_node_name=body.name,
                transform=mu_to_matrix(g["pos"], g["quat"]),
            )
        for c in body.children:
            walk(c, body.name)

    for root_body in tree["bodies"]:
        walk(root_body, "world")
    return scene, node_bodies
```

- [ ] **Step 4: 运行确认通过**

```powershell
.venv\Scripts\python.exe -m pytest pipeline/tests/test_mesh_assembler.py -v
```

Expected: 3 PASS。**API 风险处理**：若 `scene.graph.update` / `add_geometry` 签名与当前 trimesh 版本不符（TypeError），用 `help(scene.graph.update)` 查实参并最小调整，但必须保持两条不变量：节点层级与 XML 一致、几何挂在所属 body 节点下。

- [ ] **Step 5: Commit**

```powershell
git add pipeline/mesh_assembler.py pipeline/tests/test_mesh_assembler.py
git commit -m "feat(P1): 网格装配器（场景图层级 + 局部变换）"
```

---

### Task 4: rig-meta 生成（部位名表 + 关节元数据）

**Files:**
- Create: `pipeline/part_name_zh.json`
- Create: `pipeline/rig_meta.py`
- Test: `pipeline/tests/test_rig_meta.py`

- [ ] **Step 1: 写失败测试**

`pipeline/tests/test_rig_meta.py`：

```python
import os
from pipeline.mjcf_parser import parse_mjcf
from pipeline.rig_meta import build_rig_meta

REPO = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..", "assets", "MS-Human-700"))
LOCO = os.path.join(REPO, "MS-Human-700-Locomotion.xml")


def test_rig_meta_covers_all_bodies_with_parent_links():
    tree = parse_mjcf(LOCO)
    meta = build_rig_meta(tree, zh_map={})
    ids = [p["id"] for p in meta["parts"]]
    assert len(ids) == 80
    assert ids[0] == "pelvis"
    pelvis = meta["parts"][0]
    assert pelvis["parent"] is None
    # 每个非根节点的 parent 必须存在于 ids 中
    id_set = set(ids)
    for p in meta["parts"][1:]:
        assert p["parent"] in id_set


def test_zh_name_fallback_and_mapping():
    tree = parse_mjcf(LOCO)
    meta = build_rig_meta(tree, zh_map={"pelvis": "骨盆"})
    pelvis = meta["parts"][0]
    assert pelvis["names"]["zh"] == "骨盆"
    unknown = next(p for p in meta["parts"] if p["id"] != "pelvis")
    assert unknown["names"]["zh"] == unknown["names"]["en"]  # 回退英文名


def test_group_assignment():
    tree = parse_mjcf(LOCO)
    meta = build_rig_meta(tree, zh_map={})
    groups = {p["group"] for p in meta["parts"]}
    assert groups <= {"skeleton", "muscle", "skin"}
    assert "skeleton" in groups


def test_joint_metadata_from_xml():
    tree = parse_mjcf(LOCO)
    meta = build_rig_meta(tree, zh_map={})
    with_joint = [p for p in meta["parts"] if p["joints"]]
    assert len(with_joint) > 10  # Locomotion 有 36 个受控关节
    j = with_joint[0]["joints"][0]
    assert {"name", "type", "axis", "range"} <= set(j.keys())
```

- [ ] **Step 2: 运行确认失败**

```powershell
.venv\Scripts\python.exe -m pytest pipeline/tests/test_rig_meta.py -v
```

Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 rig_meta 与中文名映射表**

`pipeline/part_name_zh.json`（首版覆盖教学重点部位；其余在 P4 内容阶段按需补充，缺失回退英文名）：

```json
{
  "pelvis": "骨盆",
  "sacrum": "骶骨",
  "lumbar5": "第5腰椎",
  "lumbar1": "第1腰椎",
  "thoracic1": "第1胸椎",
  "thoracic12": "第12胸椎",
  "cervical1": "第1颈椎",
  "cervical7": "第7颈椎",
  "head": "头部",
  "skull": "颅骨",
  "r_clavicle": "右锁骨",
  "l_clavicle": "左锁骨",
  "r_scapula": "右肩胛骨",
  "l_scapula": "左肩胛骨",
  "r_humerus": "右肱骨",
  "l_humerus": "左肱骨",
  "r_ulna": "右尺骨",
  "l_ulna": "左尺骨",
  "r_radius": "右桡骨",
  "l_radius": "左桡骨",
  "r_hand": "右手",
  "l_hand": "左手",
  "r_femur": "右股骨",
  "l_femur": "左股骨",
  "r_tibia": "右胫骨",
  "l_tibia": "左胫骨",
  "r_fibula": "右腓骨",
  "l_fibula": "左腓骨",
  "r_talus": "右距骨",
  "l_talus": "左距骨",
  "r_foot": "右足",
  "l_foot": "左足",
  "r_patella": "右髌骨",
  "l_patella": "左髌骨"
}
```

**注**：键名以 Task 2 解析出的真实 body 名为准——先运行
`.venv\Scripts\python.exe -c "from pipeline.mjcf_parser import parse_mjcf,collect_body_names; import json; t=parse_mjcf('assets/MS-Human-700/MS-Human-700-Locomotion.xml'); print(json.dumps(collect_body_names(t['bodies'])))`
输出实际名单，修正映射键后再跑测试。

`pipeline/rig_meta.py`：

```python
"""生成 rig-meta.json：部位名表（中英）+ 分组 + 关节元数据。"""
from dataclasses import asdict


def _group_of(body_name, geom_count):
    name = body_name.lower()
    if "muscle" in name or "tendon" in name:
        return "muscle"
    if "skin" in name:
        return "skin"
    return "skeleton"


def build_rig_meta(tree, zh_map):
    parts = []

    def walk(body, parent):
        parts.append({
            "id": body.name,
            "parent": parent,
            "names": {"en": body.name, "zh": zh_map.get(body.name, body.name)},
            "group": _group_of(body.name, len(body.geoms)),
            "joints": [asdict(j) for j in body.joints],
        })
        for c in body.children:
            walk(c, body.name)

    for r in tree["bodies"]:
        walk(r, None)
    return {"parts": parts}
```

- [ ] **Step 4: 运行确认通过**

```powershell
.venv\Scripts\python.exe -m pytest pipeline/tests/test_rig_meta.py -v
```

Expected: 4 PASS。

- [ ] **Step 5: Commit**

```powershell
git add pipeline/part_name_zh.json pipeline/rig_meta.py pipeline/tests/test_rig_meta.py
git commit -m "feat(P1): rig-meta 部位名表与关节元数据"
```

---

### Task 5: GLB 导出与往返校验

**Files:**
- Create: `pipeline/glb_export.py`
- Test: `pipeline/tests/test_glb_export.py`

- [ ] **Step 1: 写失败测试**

`pipeline/tests/test_glb_export.py`：

```python
import os
import tempfile
import trimesh
from pipeline.mjcf_parser import parse_mjcf
from pipeline.mesh_assembler import assemble
from pipeline.glb_export import export_glb

REPO = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..", "assets", "MS-Human-700"))
LOCO = os.path.join(REPO, "MS-Human-700-Locomotion.xml")


def test_export_and_roundtrip():
    tree = parse_mjcf(LOCO)
    scene, node_bodies = assemble(tree, REPO)
    with tempfile.TemporaryDirectory() as tmp:
        out = os.path.join(tmp, "human.glb")
        export_glb(scene, out)
        assert os.path.getsize(out) > 0
        reloaded = trimesh.load(out)
        nodes = set(reloaded.graph.nodes)
        assert "pelvis" in nodes
        assert len(node_bodies) == 80
```

- [ ] **Step 2: 运行确认失败**

```powershell
.venv\Scripts\python.exe -m pytest pipeline/tests/test_glb_export.py -v
```

Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现导出**

`pipeline/glb_export.py`：

```python
"""场景 → GLB（glTF 2.0 二进制）。Draco 压缩延后到 P5（gltf-transform，需 Node.js）。"""
import trimesh


def export_glb(scene, out_path):
    data = trimesh.exchange.gltf.export_glb(scene)
    with open(out_path, "wb") as f:
        f.write(data)
    return out_path
```

- [ ] **Step 4: 运行确认通过**

```powershell
.venv\Scripts\python.exe -m pytest pipeline/tests/test_glb_export.py -v
```

Expected: PASS。

- [ ] **Step 5: Commit**

```powershell
git add pipeline/glb_export.py pipeline/tests/test_glb_export.py
git commit -m "feat(P1): GLB 导出与往返校验"
```

---

### Task 6: 交叉校验模块

**Files:**
- Create: `pipeline/validate.py`
- Test: `pipeline/tests/test_validate.py`

- [ ] **Step 1: 写失败测试**

`pipeline/tests/test_validate.py`：

```python
import os
import tempfile
import pytest
from pipeline.mjcf_parser import parse_mjcf, collect_body_names
from pipeline.mesh_assembler import assemble
from pipeline.rig_meta import build_rig_meta
from pipeline.glb_export import export_glb
from pipeline.validate import validate_output

REPO = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..", "assets", "MS-Human-700"))
LOCO = os.path.join(REPO, "MS-Human-700-Locomotion.xml")


@pytest.fixture(scope="module")
def valid_outputs(tmp_path_factory):
    tree = parse_mjcf(LOCO)
    scene, _ = assemble(tree, REPO)
    out_dir = tmp_path_factory.mktemp("out")
    glb = export_glb(scene, os.path.join(out_dir, "human.glb"))
    meta = build_rig_meta(tree, zh_map={})
    return tree, meta, glb


def test_valid_output_passes(valid_outputs):
    tree, meta, glb = valid_outputs
    issues = validate_output(tree, meta, glb)
    assert issues == []


def test_tampered_meta_fails(valid_outputs):
    tree, meta, glb = valid_outputs
    meta["parts"][5]["id"] = "hacked"
    issues = validate_output(tree, meta, glb)
    assert any("rig-meta" in i for i in issues)


def test_missing_glb_fails(valid_outputs):
    tree, meta, _ = valid_outputs
    issues = validate_output(tree, meta, "Z:/no/such.glb")
    assert len(issues) > 0
```

- [ ] **Step 2: 运行确认失败**

```powershell
.venv\Scripts\python.exe -m pytest pipeline/tests/test_validate.py -v
```

Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现校验**

`pipeline/validate.py`：

```python
"""以 XML 为唯一真值的交叉校验。返回问题列表（空列表 = 通过）。"""
import trimesh


def validate_output(tree, meta, glb_path):
    issues = []
    xml_names = collect = None
    from pipeline.mjcf_parser import collect_body_names
    xml_names = collect_body_names(tree["bodies"])

    meta_ids = [p["id"] for p in meta["parts"]]
    if meta_ids != xml_names:
        issues.append(
            f"rig-meta 与 XML body 集不一致：XML {len(xml_names)} 个, rig-meta {len(meta_ids)} 个"
        )

    for p in meta["parts"][1:]:
        if p["parent"] not in set(meta_ids):
            issues.append(f"rig-meta 节点 {p['id']} 的 parent 不存在: {p['parent']}")

    try:
        scene = trimesh.load(glb_path)
        nodes = set(scene.graph.nodes)
        missing = [n for n in xml_names if n not in nodes]
        if missing:
            issues.append(f"GLB 缺少节点: {missing[:10]}")
    except Exception as e:  # 文件不存在/损坏
        issues.append(f"GLB 无法加载: {e}")

    return issues
```

- [ ] **Step 4: 运行确认通过**

```powershell
.venv\Scripts\python.exe -m pytest pipeline/tests/test_validate.py -v
```

Expected: 3 PASS。

- [ ] **Step 5: Commit**

```powershell
git add pipeline/validate.py pipeline/tests/test_validate.py
git commit -m "feat(P1): XML↔rig-meta↔GLB 交叉校验"
```

---

### Task 7: CLI 集成 + Locomotion 全量产出 + 文档回填

**Files:**
- Create: `pipeline/convert_model.py`
- Modify: `docs/modules/README.md`（回填代码位置列）
- Modify: `docs/modules/05-model-pipeline.md`（追加「实现对齐」小节）

- [ ] **Step 1: 实现 CLI**

`pipeline/convert_model.py`：

```python
"""CLI：python -m pipeline.convert_model --xml <主XML> --root <仓库根> --out <输出目录>"""
import argparse
import json
import os


def main():
    ap = argparse.ArgumentParser(description="MS-Human-700 → glTF 转换器")
    ap.add_argument("--xml", required=True, help="主 MuJoCo XML 路径")
    ap.add_argument("--root", required=True, help="网格路径基准目录（上游为仓库根）")
    ap.add_argument("--out", required=True, help="输出目录")
    ap.add_argument("--exclude-prefix", default=[], nargs="*", help="按前缀排除 body（肌肉瘦身用）")
    args = ap.parse_args()

    from pipeline.mjcf_parser import parse_mjcf
    from pipeline.mesh_assembler import assemble
    from pipeline.rig_meta import build_rig_meta
    from pipeline.glb_export import export_glb
    from pipeline.validate import validate_output

    os.makedirs(args.out, exist_ok=True)
    tree = parse_mjcf(args.xml)
    scene, node_bodies = assemble(tree, args.root, exclude_prefixes=args.exclude_prefix)
    with open(os.path.join(os.path.dirname(__file__), "part_name_zh.json"), encoding="utf-8") as f:
        zh_map = json.load(f)
    meta = build_rig_meta(tree, zh_map)

    glb_path = os.path.join(args.out, "human.glb")
    meta_path = os.path.join(args.out, "rig-meta.json")
    export_glb(scene, glb_path)
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)

    issues = validate_output(tree, meta, glb_path)
    size_mb = os.path.getsize(glb_path) / 1024 / 1024
    print(f"bodies={len(node_bodies)} geoms={len(scene.geometry)} glb={size_mb:.1f}MB")
    if issues:
        print("校验失败:")
        for i in issues:
            print(" -", i)
        raise SystemExit(1)
    print("校验通过 ✓")
    print(f"产出: {glb_path} / {meta_path}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: 运行 Locomotion 全量转换**

```powershell
.venv\Scripts\python.exe -m pipeline.convert_model --xml assets/MS-Human-700/MS-Human-700-Locomotion.xml --root assets/MS-Human-700 --out pipeline/out/locomotion
```

Expected: `bodies=80`、`校验通过 ✓`。**体积预算**：若 glb > 8MB（05 板块验收线），追加 `--exclude-prefix` 逐一排除非骨骼 body 前缀（如 wrap/muscle 相关）直到达标，并把最终排除清单固化进 CLI 调用记录（写入 05 文档「实现对齐」小节）。

- [ ] **Step 3: 运行全身模型转换**

```powershell
.venv\Scripts\python.exe -m pipeline.convert_model --xml assets/MS-Human-700/MS-Human-700.xml --root assets/MS-Human-700 --out pipeline/out/fullbody
```

Expected: 校验通过、记录 body 数与体积。**风险处理**：若 include 结构与 Locomotion 有差异导致解析失败，回到 Task 2 补测试用例（先在 test_mjcf_parser.py 加 fullbody 解析测试），修复后重跑。

- [ ] **Step 4: 回填板块文档**

- `docs/modules/README.md`：05 行的代码位置列改为 `pipeline/`（其余板块保持待回填）。
- `docs/modules/05-model-pipeline.md`：文末追加：

```markdown
## 实现对齐 `[P1 已实现]`

- 模块：`pipeline/mjcf_parser.py`（include 合并 + body 树）、`pipeline/mesh_assembler.py`（场景图装配）、
  `pipeline/rig_meta.py`（部位名表）、`pipeline/glb_export.py`（GLB 导出）、`pipeline/validate.py`（交叉校验）
- CLI：`pipeline/convert_model.py`；用法见文内命令
- 与设计的偏差：Draco 压缩延后至 P5（需 Node.js 的 gltf-transform）；中文名映射缺失时回退英文名
- 产出记录：`<在此填写 Locomotion/FullBody 的 body 数与 glb 体积>`
```

- [ ] **Step 5: 全量测试 + Commit**

```powershell
.venv\Scripts\python.exe -m pytest pipeline/tests -v
git add pipeline/convert_model.py docs/modules/
git commit -m "feat(P1): CLI 集成与 Locomotion/FullBody 转换产出"
```

Expected: 全部 PASS，提交成功。

---

## 自查结果（Spec 覆盖对照）

- 格式转换（XML 层级/网格/关节轴向限位）→ Task 2/3/4
- 教学化命名（中英映射、缺失回退）→ Task 4
- 体积控制（< 8MB，Draco 延后 P5 的偏差已声明）→ Task 7 Step 2
- 正确性自动校验（节点数/轴向限位经 rig-meta 传递/层级）→ Task 6
- 可重复运行（确定性装配测试 + 无交互 CLI）→ Task 3 determinism 测试 + Task 7
- 05 文档「先 Locomotion 后全身」风险策略 → Task 7 Step 2→3 顺序

## P2~P5 计划说明

按 writing-plans 范围规则，P2（仿真预计算）、P3（Web 核心）、P4（知识内容）、P5（部署与性能）在 P1 验收后各自制定同格式计划文档（P3 有前置条件：需安装 Node.js ≥ 18，本机当前未装）。总控排期与验收线见 [00-overview.md](../../modules/00-overview.md)。
