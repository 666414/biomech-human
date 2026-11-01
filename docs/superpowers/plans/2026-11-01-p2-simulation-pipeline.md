# P2 仿真预计算流水线（MuJoCo 教学场景离线仿真）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 对 5 个教学受力场景跑 MuJoCo 准静态仿真，产出前端回放所需的 `pipeline/out/scenes/<scene>.json`（关节角/力矩/GRF/肌肉激活度时序 + keyframes），单场景 < 2MB，同输入重跑逐字节一致。

**Architecture:** 纯 Python 离线流水线，延续 P1 结构：场景 YAML 加载与校验 → 轨迹求值（关键点线性插值）→ 准静态仿真核心（`mj_forward` 逐帧求解，不积分）→ float32 JSON 导出 → CLI（单场景/批量/可重复性校验）。教学驱动模式：姿态与肌肉激活度由场景轨迹设定（运动学驱动），接触力/肌肉力由 MuJoCo 求解——物理量自洽且完全确定性（无随机数）。

**Tech Stack:** Python 3.14（venv 已就绪 `.venv\Scripts\python.exe`）、mujoco 3.17.0（已装）、numpy 2.5.4、pyyaml（新增）、pytest 9.2.0。

**板块文档:** [06-simulation-pipeline.md](../../modules/06-simulation-pipeline.md)（本计划即其实现，完成后回填状态行）

---

## 已确认的模型与 API 事实（勘察实测，勿再假设/重复勘察）

**模型（`assets/MS-Human-700/MS-Human-700.xml`，勘察 1/4/5/6）**
- 全身主模型：nbody=81、nq=nv=njnt=85（13 slide + 72 hinge）、nu=na=700 全肌肉执行器（trntype=tendon、dyntype=muscle）、ctrlrange=[0,1]。总质量 60.22 kg（体重 590.8 N）。
- Locomotion 变体（`MS-Human-700-Locomotion.xml`）：nq=36、nu=100。关节名与主模型一致（下肢子集）。步态场景用此变体。
- keyframe 0（名 `init`）：全零姿态 = 直立站立，pelvis 世界 z=0.95，**此姿态脚不接触地板（ncon=0）**。
- `mj_resetDataKeyframe(m, d, 0)` 加载初始姿态；`d.qpos`/`d.act`/`d.ctrl` 均可每步直接赋值后 `mj_forward` 求解。
- **中文绝对路径无法传给 `from_xml_path`**（C++ 层打不开）→ 一律用相对路径（pytest 与 CLI 从仓库根运行）。

**接触与 GRF（勘察 3/5/6，关键）**
- floor geom（id=0, name=`floor`）contype=1/conaffinity=1（继承主 default）；骨骼 class="bone" 是 0/0；**只有 class="skin" 的胶囊体（脚底 calcn_skin_*/toes_skin_*）能与 floor 接触**。
- **`pelvis` 带 `quat="0.707107 0.707107 0 0"`（绕 x 转 90°）**：`pelvis_tz` 沿世界 -y（侧向）、`pelvis_ty` 沿世界 +z（**上下平移**）。下压接地必须用 `pelvis_ty`。
- GRF（世界系）求法：遍历 `d.ncon`，`mj_contactForce` 后经 `contact.frame.reshape(3,3).T @ f[:3]` 转世界系求和（floor 相关接触）。实测：pelvis_ty=-0.015 附近 GRF_z≈体重 591N；-0.02→1361N；-0.03→2357N（接触刚度大，毫米级下压对应数百 N）。**符号：GRF_z 向上为正**。
- `mj_forward` 单步约 0.7ms（full 模型）→ 5 场景全跑 < 10s。
- equality 约束 42 条（type=2, joint 耦合）：膝关节 translation/rotation 辅助关节自动跟随主角度，场景轨迹只写主关节。
- 确定性：固定输入 rollout 逐位一致（勘察 1 已验证）。

**关节符号约定（勘察 4 实测 range/axis）**
- `hip_flexion_r/l` 正=屈曲（range [-0.52, 2.0]）；`knee_angle_r/l` **正=屈曲**（[0, 2.4]）；`ankle_angle_r/l` 符号在教学中不断言方向（range [-0.68, 0.52]，曲线幅度小）；`subtalar_angle_r/l` **正=内翻**（[±0.34]）；`shoulder_elv_r/l` 正=外展（[0, 3.1]）；`pelvis_tilt` 正=骨盆前倾；`L5_S1_FE`/`T12_L1_FE` **负=躯干前屈**（[±0.5]）；`pelvis_ty` 正=向上（[±3.0]）。

**已验证存在的肌肉/执行器名**（场景只允许用这些）：`glmax1_r, glmax2_r, glmax3_r, bflh_r, semimem_r, addlong_r, gaslat_r, gasmed_r, soleus_r, tibant_r, DELT1_r, DELT2_r, DELT3_r, trap_cl, fdl_r, fhl_r`（Locomotion 变体含其中下肢子集：glmax1-3_r, bflh_r, semimem_r, addlong_r, gaslat_r, gasmed_r, soleus_r, tibant_r）。

**教学驱动模式（本计划核心设计，已定）**
- 每仿真步：`mj_resetDataKeyframe` 复位 → 按轨迹设 `d.qpos`（关节角，rad）、`d.ctrl`/`d.act`（激活度 0-1）、`d.xfrc_applied`（外力 N，世界系）→ `d.qvel=0`（准静态）→ `mj_forward` → 按采样步长记录。
- 垂直高度统一由 ground 机制控制（`pose_tracks` 禁写 `pelvis_ty`）：
  - `mode: auto`：二分校准 `pelvis_ty` 基准值，使初始帧 GRF_z = `target_grf` × 体重（搜索区间 [-0.15, 0]，40 次二分，确定性算法）。
  - `mode: manual`：`pelvis_ty` 基准直接取 `ground.offset`（着陆场景初始悬空用 offset=0.0）。
  - `sink_track`（可选）：相对基准的下沉量轨迹（m，正=向下）→ `qpos[pelvis_ty] = 基准 - sink(t)`。

## 文件结构

```
pipeline/
  requirements.txt          # 修改：+mujoco>=3.0、+pyyaml>=6.0
  scene_loader.py           # YAML → SceneConfig（schema + 模型引用校验）
  pose_tracks.py            # 轨迹求值：[u%, value] 关键点线性插值
  simulate_scene.py         # 准静态仿真核心 + GRF + 接地校准（06 文档指定的实现文件）
  export_scene.py           # float32 JSON 导出 + 2MB 守卫
  run_scene.py              # CLI：单场景/批量/可重复性校验
  scenes/                   # 5 个场景定义（git 跟踪）
    gait_cycle.yaml
    drop_landing.yaml
    lift_task.yaml
    shoulder_abduction.yaml
    ankle_inversion.yaml
  out/scenes/               # 产物（.gitignore 已覆盖 pipeline/out/）
  tests/
    test_pose_tracks.py
    test_scene_loader.py
    test_simulate_scene.py
    test_export_scene.py
    test_run_scene.py
    test_scenes.py           # Task 7 集成测试（5 场景全跑）
docs/modules/06-simulation-pipeline.md   # 修改：状态行回填
```

**JSON 产物结构**（前端 02/03/04 的消费契约）：

```json
{
  "scene": "gait_cycle",
  "xml": "assets/MS-Human-700/MS-Human-700-Locomotion.xml",
  "fps": 50.0,
  "duration": 1.2,
  "frames": 61,
  "joints": ["pelvis_tz", "...共 nq 个..."],
  "muscles": ["glmax1_r", "...每场景 6~10 块..."],
  "series": {
    "time":       [[s]...],
    "qpos":       [[rad]...],
    "qfrc_actuator": [[N·m]...],
    "muscle_act": [[%MVC 0-100]...],
    "grf":        [[fx, fy, fz]...]
  },
  "keyframes": [{"t": 0.0, "label": "...", "cardId": "..."}]
}
```

**约定命令**（PowerShell 5.1，用 `;` 不用 `&&`；仓库根 `d:\清华人体模型`；相对路径供 MuJoCo 用）：

```powershell
$PY = ".venv\Scripts\python.exe"
& $PY -m pytest pipeline/tests -v                     # 全部测试
& $PY -m pipeline.run_scene --scene pipeline/scenes/gait_cycle.yaml --out pipeline/out/scenes
& $PY -m pipeline.run_scene --all pipeline/scenes --out pipeline/out/scenes
& $PY -m pipeline.run_scene --scene pipeline/scenes/gait_cycle.yaml --out pipeline/out/scenes --check-repeatability
```

---

### Task 1: 依赖就位（pyyaml）

**Files:**
- Modify: `pipeline/requirements.txt`

- [ ] **Step 1: 更新 requirements.txt**

`pipeline/requirements.txt` 全文改为：

```
numpy>=1.26
trimesh>=4.0
pytest>=8.0
mujoco>=3.0
pyyaml>=6.0
```

- [ ] **Step 2: 安装并冒烟**

```powershell
.venv\Scripts\python.exe -m pip install -r pipeline\requirements.txt
.venv\Scripts\python.exe -c "import yaml; print(yaml.safe_load('a: [1, 2]'))"
```

Expected: 输出 `{'a': [1, 2]}`（mujoco 已在 venv 中，应为 already satisfied）。

- [ ] **Step 3: Commit**

```powershell
git add pipeline/requirements.txt
git commit -m "chore(P2): 场景仿真依赖 pyyaml"
```

---

### Task 2: 轨迹求值模块（pose_tracks）

**Files:**
- Create: `pipeline/pose_tracks.py`
- Test: `pipeline/tests/test_pose_tracks.py`

- [ ] **Step 1: 写失败测试**

`pipeline/tests/test_pose_tracks.py`：

```python
from pipeline.pose_tracks import eval_track


def test_scalar_interpolation_midpoint():
    tr = [[0, 10], [100, 20]]
    assert eval_track(tr, 50) == 15.0


def test_scalar_clamps_outside_domain():
    tr = [[20, 5], [80, 9]]
    assert eval_track(tr, 0) == 5.0
    assert eval_track(tr, 100) == 9.0


def test_vector_interpolation():
    tr = [[0, [0, 0, 0]], [100, [10, -20, 30]]]
    assert eval_track(tr, 50) == [5.0, -10.0, 15.0]


def test_multiple_keyframes_piecewise():
    tr = [[0, 0], [50, 10], [100, 0]]
    assert eval_track(tr, 25) == 5.0
    assert eval_track(tr, 75) == 5.0


def test_returns_float_not_int():
    tr = [[0, 3], [100, 3]]
    assert isinstance(eval_track(tr, 40), float)
```

- [ ] **Step 2: 运行确认失败**

```powershell
.venv\Scripts\python.exe -m pytest pipeline/tests/test_pose_tracks.py -v
```

Expected: FAIL（`ModuleNotFoundError: No module named 'pipeline.pose_tracks'`）。

- [ ] **Step 3: 实现模块**

`pipeline/pose_tracks.py`：

```python
"""轨迹求值：[u%, value] 关键点线性插值。

u 为归一化时间百分比（0~100，与场景 YAML 一致）；
value 为标量（关节角 deg / 激活度 / 下沉 m）或 3 向量 [fx, fy, fz]（外力 N）。
轨迹域外取端点值（平顶钳位）。
"""


def _val(row):
    """行 [u, v] → 标量；行 [u, fx, fy, fz] → 3 向量。"""
    if len(row) == 2:
        return float(row[1])
    return [float(x) for x in row[1:4]]


def eval_track(track, u):
    """在轨迹 track 上求 u 百分比处的值。u 超界取端点；分段线性插值。"""
    if u <= track[0][0]:
        return _val(track[0])
    if u >= track[-1][0]:
        return _val(track[-1])
    for a, b in zip(track, track[1:]):
        if a[0] <= u <= b[0]:
            w = 0.0 if b[0] == a[0] else (u - a[0]) / (b[0] - a[0])
            va, vb = _val(a), _val(b)
            if isinstance(va, list):
                return [va[i] + (vb[i] - va[i]) * w for i in range(3)]
            return float(va + (vb - va) * w)
    return _val(track[-1])  # 理论不可达（u 已在域内）
```

- [ ] **Step 4: 运行确认通过**

```powershell
.venv\Scripts\python.exe -m pytest pipeline/tests/test_pose_tracks.py -v
```

Expected: 5 PASS。

- [ ] **Step 5: Commit**

```powershell
git add pipeline/pose_tracks.py pipeline/tests/test_pose_tracks.py
git commit -m "feat(P2): 轨迹求值模块（关键点线性插值，标量/3向量）"
```

---

### Task 3: 场景加载与校验（scene_loader）

**Files:**
- Create: `pipeline/scene_loader.py`
- Test: `pipeline/tests/test_scene_loader.py`

- [ ] **Step 1: 写失败测试**

`pipeline/tests/test_scene_loader.py`：

```python
import os
import pytest
import mujoco
from pipeline.scene_loader import load_scene, validate_against_model, SceneConfig

REPO = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".."))
XML = os.path.join(REPO, "assets", "MS-Human-700", "MS-Human-700.xml")

MINI_YAML = """\
name: mini
xml: {xml}
duration: 0.2
sim_stride: 10
muscles: [tibant_r]
pose_tracks:
  hip_flexion_r: [[0, 0], [100, 10]]
muscle_tracks:
  tibant_r: [[0, 0.1], [100, 0.2]]
keyframes:
  - {{t: 0.1, label: 测试, cardId: test_card}}
""".format(xml=XML.replace("\\", "/"))


def write_yaml(tmp_path, text):
    p = tmp_path / "scene.yaml"
    p.write_text(text, encoding="utf-8")
    return str(p)


def test_load_mini_scene():
    scene = load_scene(write_yaml(MINI_YAML))
    assert scene.name == "mini"
    assert scene.duration == 0.2
    assert scene.sim_stride == 10
    assert scene.muscles == ["tibant_r"]
    assert scene.ground_mode == "auto"
    assert scene.ground_target_grf == 1.0
    assert scene.sink_track is None


def test_missing_field_raises(tmp_path):
    bad = MINI_YAML.replace("duration: 0.2\n", "")
    with pytest.raises(ValueError, match="duration"):
        load_scene(write_yaml(tmp_path, bad))


def test_u_out_of_range_raises(tmp_path):
    bad = MINI_YAML.replace("[100, 10]", "[110, 10]")
    with pytest.raises(ValueError, match="0,100"):
        load_scene(write_yaml(tmp_path, bad))


def test_u_not_increasing_raises(tmp_path):
    bad = MINI_YAML.replace("[100, 10]", "[50, 10]")
    with pytest.raises(ValueError, match="递增"):
        load_scene(write_yaml(tmp_path, bad))


def test_muscle_track_not_in_muscles_raises(tmp_path):
    bad = MINI_YAML.replace("muscles: [tibant_r]", "muscles: [gaslat_r]")
    with pytest.raises(ValueError, match="muscles"):
        load_scene(write_yaml(tmp_path, bad))


def test_too_many_muscles_raises(tmp_path):
    bad = MINI_YAML.replace(
        "muscles: [tibant_r]",
        "muscles: [a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11]",
    )
    with pytest.raises(ValueError, match="1~10"):
        load_scene(write_yaml(tmp_path, bad))


def test_keyframe_t_out_of_duration_raises(tmp_path):
    bad = MINI_YAML.replace("t: 0.1", "t: 0.5")
    with pytest.raises(ValueError, match="时长"):
        load_scene(write_yaml(tmp_path, bad))


def test_pelvis_ty_in_pose_tracks_raises(tmp_path):
    bad = MINI_YAML.replace("  hip_flexion_r: [[0, 0], [100, 10]]",
                            "  pelvis_ty: [[0, 0], [100, -0.02]]")
    with pytest.raises(ValueError, match="pelvis_ty"):
        load_scene(write_yaml(tmp_path, bad))


def test_force_track_format(tmp_path):
    yml = MINI_YAML + (
        "external_forces:\n"
        "  - body: hand_r\n"
        "    track: [[0, 0, 0, 0], [100, 0, 0, -150]]\n"
    )
    scene = load_scene(write_yaml(tmp_path, yml))
    assert scene.external_forces[0]["body"] == "hand_r"
    bad = yml.replace("[100, 0, 0, -150]", "[100, -150]")
    with pytest.raises(ValueError, match="fz"):
        load_scene(write_yaml(tmp_path, bad))


def test_validate_against_model_ok(tmp_path):
    scene = load_scene(write_yaml(tmp_path, MINI_YAML))
    m = mujoco.MjModel.from_xml_path(scene.xml)
    validate_against_model(scene, m)  # 不抛异常即通过


def test_validate_against_model_unknown_joint(tmp_path):
    bad = MINI_YAML.replace("hip_flexion_r: [[0, 0], [100, 10]]",
                            "no_such_joint: [[0, 0], [100, 10]]")
    scene = load_scene(write_yaml(tmp_path, bad))
    m = mujoco.MjModel.from_xml_path(scene.xml)
    with pytest.raises(ValueError, match="no_such_joint"):
        validate_against_model(scene, m)


def test_validate_unknown_muscle(tmp_path):
    bad = MINI_YAML.replace("muscles: [tibant_r]", "muscles: [no_muscle]")
    scene = load_scene(write_yaml(tmp_path, bad))
    m = mujoco.MjModel.from_xml_path(scene.xml)
    with pytest.raises(ValueError, match="no_muscle"):
        validate_against_model(scene, m)
```

- [ ] **Step 2: 运行确认失败**

```powershell
.venv\Scripts\python.exe -m pytest pipeline/tests/test_scene_loader.py -v
```

Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现加载器**

`pipeline/scene_loader.py`：

```python
"""场景定义加载与校验：YAML → SceneConfig。

两级校验：
- load_scene：schema 校验（纯 YAML，不加载 MuJoCo）。
- validate_against_model：模型引用校验（关节/肌肉/body 名存在于模型）。
"""
from dataclasses import dataclass

import yaml


@dataclass
class SceneConfig:
    name: str
    xml: str
    duration: float
    sim_stride: int
    muscles: list
    pose_tracks: dict           # 关节名 -> [[u%, deg], ...]
    muscle_tracks: dict         # 肌肉名 -> [[u%, act 0-1], ...]
    external_forces: list       # [{"body": str, "track": [[u%, fx, fy, fz], ...]}]
    keyframes: list             # [{"t": s, "label": str, "cardId": str}]
    ground_mode: str = "auto"        # auto | manual
    ground_target_grf: float = 1.0   # auto：初始 GRF_z 目标（体重倍数）
    ground_offset: float = 0.0       # manual：pelvis_ty 基准值（m）
    sink_track: list | None = None   # 下沉轨迹 [[u%, m], ...]，正 = 向下


def _validate_track(name, track, vector=False):
    if not isinstance(track, list) or len(track) < 2:
        raise ValueError(f"轨迹 {name} 至少需要 2 个关键点")
    prev_u = -1.0
    for row in track:
        if vector:
            if not isinstance(row, list) or len(row) != 4:
                raise ValueError(f"力轨迹 {name} 每行须为 [u%, fx, fy, fz]")
            u = row[0]
        else:
            if not isinstance(row, list) or len(row) != 2:
                raise ValueError(f"轨迹 {name} 每行须为 [u%, value]")
            u = row[0]
        if not (0.0 <= float(u) <= 100.0):
            raise ValueError(f"轨迹 {name} 关键点 u={u} 超出 [0,100]")
        if float(u) < prev_u:
            raise ValueError(f"轨迹 {name} 关键点 u 须非递减")
        prev_u = float(u)


def load_scene(path):
    with open(path, "r", encoding="utf-8") as f:
        raw = yaml.safe_load(f)

    for k in ("name", "xml", "duration", "sim_stride", "muscles"):
        if k not in raw:
            raise ValueError(f"场景缺少字段 {k}")
    name = str(raw["name"])
    duration = float(raw["duration"])
    if duration <= 0:
        raise ValueError(f"场景 {name} duration 须为正")
    stride = int(raw["sim_stride"])
    if stride < 1:
        raise ValueError(f"场景 {name} sim_stride 须 >= 1")

    muscles = [str(m) for m in raw["muscles"]]
    if not (1 <= len(muscles) <= 10):
        raise ValueError(f"场景 {name} 肌肉数须在 1~10（教学重点导出）")

    pose_tracks = raw.get("pose_tracks") or {}
    if "pelvis_ty" in pose_tracks:
        raise ValueError(
            "pose_tracks 禁止包含 pelvis_ty（垂直高度由 ground/sink 机制控制）"
        )
    muscle_tracks = raw.get("muscle_tracks") or {}
    for n, tr in pose_tracks.items():
        _validate_track(f"pose:{n}", tr)
    for n, tr in muscle_tracks.items():
        _validate_track(f"muscle:{n}", tr)
        if n not in muscles:
            raise ValueError(f"muscle_tracks 中的 {n} 不在导出清单 muscles 内")

    external_forces = raw.get("external_forces") or []
    for f in external_forces:
        if "body" not in f or "track" not in f:
            raise ValueError("external_forces 每项须含 body 与 track")
        _validate_track(f"force:{f['body']}", f["track"], vector=True)

    keyframes = raw.get("keyframes") or []
    for kf in keyframes:
        if not ({"t", "label", "cardId"} <= set(kf)):
            raise ValueError("keyframes 每项须含 t/label/cardId")
        if not (0.0 <= float(kf["t"]) <= duration):
            raise ValueError(f"keyframe t={kf['t']} 超出时长 {duration}s")

    ground = raw.get("ground") or {}
    ground_mode = str(ground.get("mode", "auto"))
    if ground_mode not in ("auto", "manual"):
        raise ValueError(f"ground.mode 须为 auto|manual，得到 {ground_mode}")
    ground_target_grf = float(ground.get("target_grf", 1.0))
    if ground_mode == "auto" and ground_target_grf <= 0:
        raise ValueError("ground.target_grf 须为正（体重倍数）")

    sink_track = raw.get("sink_track") or None
    if sink_track:
        _validate_track("sink", sink_track)

    return SceneConfig(
        name=name,
        xml=str(raw["xml"]),
        duration=duration,
        sim_stride=stride,
        muscles=muscles,
        pose_tracks=pose_tracks,
        muscle_tracks=muscle_tracks,
        external_forces=external_forces,
        keyframes=keyframes,
        ground_mode=ground_mode,
        ground_target_grf=ground_target_grf,
        ground_offset=float(ground.get("offset", 0.0)),
        sink_track=sink_track,
    )


def validate_against_model(scene, model):
    """模型引用校验：轨迹中出现的关节/肌肉/外力 body 必须存在于模型。"""
    import mujoco

    for n in scene.pose_tracks:
        if mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_JOINT, n) < 0:
            raise ValueError(f"关节 {n} 不在模型中")
    for n in scene.muscle_tracks:
        if mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_ACTUATOR, n) < 0:
            raise ValueError(f"肌肉 {n} 不在模型中")
    for f in scene.external_forces:
        if mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY, f["body"]) < 0:
            raise ValueError(f"body {f['body']} 不在模型中")
```

- [ ] **Step 4: 运行确认通过**

```powershell
.venv\Scripts\python.exe -m pytest pipeline/tests/test_scene_loader.py -v
```

Expected: 12 PASS。

- [ ] **Step 5: Commit**

```powershell
git add pipeline/scene_loader.py pipeline/tests/test_scene_loader.py
git commit -m "feat(P2): 场景加载与校验（schema + 模型引用）"
```

---

### Task 4: 准静态仿真核心（simulate_scene）

**Files:**
- Create: `pipeline/simulate_scene.py`
- Test: `pipeline/tests/test_simulate_scene.py`

- [ ] **Step 1: 写失败测试**

`pipeline/tests/test_simulate_scene.py`：

```python
import math
import os
import mujoco
import numpy as np
from pipeline.scene_loader import SceneConfig
from pipeline.simulate_scene import simulate, ground_reaction_force

XML = os.path.normpath(os.path.join(
    os.path.dirname(__file__), "..", "..", "assets", "MS-Human-700", "MS-Human-700.xml"))
WEIGHT_N = 60.22 * 9.81


def mini_scene(**kw):
    base = dict(
        name="mini", xml=XML, duration=0.2, sim_stride=10,
        muscles=["tibant_r"],
        pose_tracks={"hip_flexion_r": [[0, 5], [100, 15]]},
        muscle_tracks={"tibant_r": [[0, 0.1], [100, 0.3]]},
        external_forces=[], keyframes=[],
        ground_mode="manual", ground_target_grf=1.0,
        ground_offset=-0.02, sink_track=None,
    )
    base.update(kw)
    return SceneConfig(**base)


def test_result_shapes():
    r = simulate(mini_scene())
    assert len(r.time) == 11            # 0.2s / 0.002s = 100 步 → 采样 11 帧
    assert r.qpos.shape == (11, 85)
    assert r.qfrc_actuator.shape == (11, 85)
    assert r.muscle_act.shape == (11, 1)
    assert r.grf.shape == (11, 3)
    assert len(r.joint_names) == 85
    assert abs(r.time[-1] - 0.2) < 1e-9
    assert r.timestep == 0.002


def test_pose_track_drives_qpos():
    r = simulate(mini_scene())
    m = mujoco.MjModel.from_xml_path(XML)
    adr = int(m.jnt_qposadr[mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_JOINT, "hip_flexion_r")])
    assert r.qpos[0, adr] == pytest.approx(math.radians(5), abs=1e-9)
    assert r.qpos[-1, adr] == pytest.approx(math.radians(15), abs=1e-9)


def test_muscle_activation_recorded():
    r = simulate(mini_scene())
    assert r.muscle_act[0, 0] == pytest.approx(0.1, abs=1e-9)
    assert r.muscle_act[-1, 0] == pytest.approx(0.3, abs=1e-9)


def test_ground_contact_produces_grf():
    r = simulate(mini_scene())  # manual offset -0.02 → 足部深压
    assert np.all(r.grf[:, 2] > 500.0)


def test_no_contact_zero_grf():
    r = simulate(mini_scene(ground_offset=0.0))  # init 姿态脚不触地
    assert np.allclose(r.grf, 0.0)


def test_auto_ground_calibration_hits_target():
    r = simulate(mini_scene(ground_mode="auto", ground_target_grf=1.0,
                            ground_offset=0.0))
    assert r.grf[0, 2] == pytest.approx(WEIGHT_N, rel=0.05)  # 初始 GRF ≈ 体重 ±5%


def test_external_force_increases_grf():
    base = simulate(mini_scene())
    forced = simulate(mini_scene(
        external_forces=[{"body": "hand_r",
                          "track": [[0, 0, 0, 0], [100, 0, 0, -100]]}]))
    diff = forced.grf[-1, 2] - base.grf[-1, 2]
    assert diff == pytest.approx(100.0, abs=50.0)  # 准静态外力近似直传 GRF


def test_determinism():
    a = simulate(mini_scene())
    b = simulate(mini_scene())
    assert np.array_equal(a.time, b.time)
    assert np.array_equal(a.qpos, b.qpos)
    assert np.array_equal(a.qfrc_actuator, b.qfrc_actuator)
    assert np.array_equal(a.muscle_act, b.muscle_act)
    assert np.array_equal(a.grf, b.grf)


def test_sink_track_lowers_pelvis():
    m = mujoco.MjModel.from_xml_path(XML)
    ty_adr = int(m.jnt_qposadr[mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_JOINT, "pelvis_ty")])
    r = simulate(mini_scene(sink_track=[[0, 0], [100, 0.01]]))
    assert r.qpos[-1, ty_adr] == pytest.approx(-0.02 - 0.01, abs=1e-9)
```

（注意 `import pytest` 需补在文件头；`test_pose_track_drives_qpos`/`test_sink_track_lowers_pelvis` 用到 `pytest.approx`。）

- [ ] **Step 2: 运行确认失败**

```powershell
.venv\Scripts\python.exe -m pytest pipeline/tests/test_simulate_scene.py -v
```

Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现仿真核心**

`pipeline/simulate_scene.py`：

```python
"""教学场景准静态仿真核心（06 模块实现）。

驱动模式（运动学准静态）：
- 姿态：每步由场景轨迹设定 d.qpos（关节角 rad），速度置零（准静态假设）。
- 肌肉：d.ctrl/d.act 由激活度轨迹设定（0-1），mj_forward 求肌肉力。
- 接地：pelvis_ty = 接地基准 - sink(t)。
  auto 模式二分校准基准值使初始帧 GRF_z = target_grf × 体重；
  manual 模式基准取 ground_offset。
- 求解：mj_forward（不积分），全程无随机数 → 同输入必得同输出。
"""
import math

import mujoco
import numpy as np

from pipeline.pose_tracks import eval_track

GROUND_SEARCH_LO = -0.15   # 接地校准搜索下界（m，相对 keyframe）
GROUND_SEARCH_HI = 0.0
GROUND_BISECT_STEPS = 40


class SimResult:
    """仿真记录容器；finalize() 时堆叠为 numpy 数组。"""

    def __init__(self, scene, joint_names, actuator_names):
        self.scene = scene
        self.joint_names = list(joint_names)      # 全部关节（前端姿态驱动）
        self.actuator_names = list(actuator_names)
        self.timestep = None
        self.time = []           # (F,) s
        self.qpos = []           # (F, nq) rad
        self.qfrc_actuator = []  # (F, nv) N·m
        self.muscle_act = []     # (F, len(muscles)) 0-1
        self.grf = []            # (F, 3) N 世界系

    def finalize(self):
        self.time = np.array(self.time, dtype=np.float64)
        self.qpos = np.array(self.qpos, dtype=np.float64)
        self.qfrc_actuator = np.array(self.qfrc_actuator, dtype=np.float64)
        self.muscle_act = np.array(self.muscle_act, dtype=np.float64)
        self.grf = np.array(self.grf, dtype=np.float64)
        return self


def ground_reaction_force(m, d):
    """世界系地面反作用力：floor 上全部接触力之和（contact frame → world）。"""
    grf = np.zeros(3)
    for ci in range(d.ncon):
        c = d.contact[ci]
        if m.geom_bodyid[c.geom1] == 0 or m.geom_bodyid[c.geom2] == 0:
            f6 = np.zeros(6)
            mujoco.mj_contactForce(m, d, ci, f6)
            grf += c.frame.reshape(3, 3).T @ f6[:3]
    return grf


def _set_frame(m, d, scene, joint_adr, act_adr, force_body_id, ty_base, u):
    """把模型状态设为时刻 u（0~100）对应的场景帧。"""
    mujoco.mj_resetDataKeyframe(m, d, 0)
    if scene.sink_track:
        d.qpos[joint_adr["pelvis_ty"]] = ty_base - eval_track(scene.sink_track, u)
    for name, track in scene.pose_tracks.items():
        d.qpos[joint_adr[name]] = math.radians(eval_track(track, u))
    d.ctrl[:] = 0.0
    d.act[:] = 0.0
    for name, track in scene.muscle_tracks.items():
        a = min(1.0, max(0.0, float(eval_track(track, u))))
        d.ctrl[act_adr[name]] = a
        d.act[act_adr[name]] = a
    for f in scene.external_forces:
        fx, fy, fz = eval_track(f["track"], u)
        d.xfrc_applied[force_body_id[f["body"]], :3] = (fx, fy, fz)
    d.qvel[:] = 0.0


def calibrate_ground(m, d, scene, joint_adr, act_adr, force_body_id):
    """二分搜索接地基准 ty0：初始帧 GRF_z = target × 体重。

    f(ty) 单调递减（ty 越小 GRF 越大）。返回区间中点；无法达标时抛错。
    """
    target = scene.ground_target_grf * float(m.body_mass.sum()) * 9.81
    a, b = GROUND_SEARCH_LO, GROUND_SEARCH_HI
    _set_frame(m, d, scene, joint_adr, act_adr, force_body_id, a, 0.0)
    mujoco.mj_forward(m, d)
    if ground_reaction_force(m, d)[2] < target:
        raise RuntimeError(
            f"接地校准失败：搜索下界 {a}m 处 GRF_z="
            f"{ground_reaction_force(m, d)[2]:.1f}N 仍低于目标 {target:.1f}N，"
            "请检查初始姿态是否能让脚接触地面"
        )
    for _ in range(GROUND_BISECT_STEPS):
        mid = 0.5 * (a + b)
        _set_frame(m, d, scene, joint_adr, act_adr, force_body_id, mid, 0.0)
        mujoco.mj_forward(m, d)
        if ground_reaction_force(m, d)[2] >= target:
            a = mid
        else:
            b = mid
    return 0.5 * (a + b)


def simulate(scene):
    m = mujoco.MjModel.from_xml_path(scene.xml)
    d = mujoco.MjData(m)

    joint_names = [mujoco.mj_id2name(m, mujoco.mjtObj.mjOBJ_JOINT, i)
                   for i in range(m.njnt)]
    actuator_names = [mujoco.mj_id2name(m, mujoco.mjtObj.mjOBJ_ACTUATOR, i)
                      for i in range(m.nu)]
    joint_adr = {n: int(m.jnt_qposadr[i]) for i, n in enumerate(joint_names)}
    act_adr = {n: i for i, n in enumerate(actuator_names)}
    force_body_id = {
        f["body"]: int(mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_BODY, f["body"]))
        for f in scene.external_forces
    }

    if scene.ground_mode == "auto":
        ty_base = calibrate_ground(m, d, scene, joint_adr, act_adr, force_body_id)
    else:
        ty_base = scene.ground_offset

    steps = max(1, int(round(scene.duration / m.opt.timestep)))
    result = SimResult(scene, joint_names, actuator_names)
    result.timestep = float(m.opt.timestep)

    for s in range(steps + 1):
        u = 100.0 * s / steps
        _set_frame(m, d, scene, joint_adr, act_adr, force_body_id, ty_base, u)
        mujoco.mj_forward(m, d)
        if s % scene.sim_stride == 0:
            result.time.append(s * m.opt.timestep)
            result.qpos.append(d.qpos.copy())
            result.qfrc_actuator.append(d.qfrc_actuator.copy())
            result.muscle_act.append(
                [float(d.act[act_adr[n]]) for n in scene.muscles])
            result.grf.append(ground_reaction_force(m, d).copy())
    return result.finalize()
```

- [ ] **Step 4: 运行确认通过**

```powershell
.venv\Scripts\python.exe -m pytest pipeline/tests/test_simulate_scene.py -v
```

Expected: 9 PASS。**风险处理**：
- `test_no_contact_zero_grf` 若失败（offset=0 仍有接触）：说明脚部 skin 初始已贴地，改断言为 `r.grf[0, 2] < 50.0` 并注明实测值。
- `test_ground_contact_produces_grf` 若失败（-0.02 无接触）：打印实际 GRF，检查 XML 是否被上游改动；-0.02 实测应约 1360N。
- `test_auto_ground_calibration_hits_target` 若偏差 >5%：打印 `r.grf[0,2]` 与目标值，确认 `m.body_mass.sum()` 是否变化。

- [ ] **Step 5: Commit**

```powershell
git add pipeline/simulate_scene.py pipeline/tests/test_simulate_scene.py
git commit -m "feat(P2): 准静态仿真核心（轨迹驱动 + GRF + 接地校准）"
```

---

### Task 5: JSON 导出（export_scene）

**Files:**
- Create: `pipeline/export_scene.py`
- Test: `pipeline/tests/test_export_scene.py`

- [ ] **Step 1: 写失败测试**

`pipeline/tests/test_export_scene.py`：

```python
import json
import os
import numpy as np
import pytest
from pipeline import export_scene
from pipeline.export_scene import export_json, _f32
from pipeline.scene_loader import SceneConfig
from pipeline.simulate_scene import simulate

XML = os.path.normpath(os.path.join(
    os.path.dirname(__file__), "..", "..", "assets", "MS-Human-700", "MS-Human-700.xml"))


def mini_scene():
    return SceneConfig(
        name="mini", xml=XML, duration=0.2, sim_stride=10,
        muscles=["tibant_r"],
        pose_tracks={"hip_flexion_r": [[0, 5], [100, 15]]},
        muscle_tracks={"tibant_r": [[0, 0.1], [100, 0.3]]},
        external_forces=[],
        keyframes=[{"t": 0.1, "label": "测试", "cardId": "test_card"}],
        ground_mode="manual", ground_offset=-0.02,
    )


def test_f32_quantization():
    assert _f32(0.123456789) == float(np.float32(0.1235))
    assert _f32(-3.45678) == float(np.float32(-3.4568))


def test_export_structure(tmp_path):
    r = simulate(mini_scene())
    path = export_json(r, str(tmp_path))
    assert os.path.basename(path) == "mini.json"
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    assert data["scene"] == "mini"
    assert data["fps"] == 50.0
    assert data["frames"] == 11
    assert len(data["joints"]) == 85
    assert data["muscles"] == ["tibant_r"]
    s = data["series"]
    assert len(s["time"]) == 11
    assert len(s["qpos"]) == 11 and len(s["qpos"][0]) == 85
    assert len(s["qfrc_actuator"]) == 11 and len(s["qfrc_actuator"][0]) == 85
    assert len(s["muscle_act"]) == 11 and len(s["muscle_act"][0]) == 1
    assert len(s["grf"]) == 11 and len(s["grf"][0]) == 3
    # %MVC：act 0.3 → 30
    assert s["muscle_act"][-1][0] == pytest.approx(30.0, abs=0.01)
    assert data["keyframes"][0]["cardId"] == "test_card"


def test_export_under_2mb(tmp_path):
    r = simulate(mini_scene())
    path = export_json(r, str(tmp_path))
    assert os.path.getsize(path) < 2 * 1024 * 1024


def test_export_size_guard(tmp_path, monkeypatch):
    monkeypatch.setattr(export_scene, "MAX_JSON_BYTES", 10)
    r = simulate(mini_scene())
    with pytest.raises(RuntimeError, match="2MB"):
        export_json(r, str(tmp_path))
```

- [ ] **Step 2: 运行确认失败**

```powershell
.venv\Scripts\python.exe -m pytest pipeline/tests/test_export_scene.py -v
```

Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现导出器**

`pipeline/export_scene.py`：

```python
"""仿真结果 → scenes/<scene>.json：float32 精度、教学契约结构、2MB 体积守卫。"""
import json
import os

import numpy as np

MAX_JSON_BYTES = 2 * 1024 * 1024


def _f32(v):
    """float32 精度序列化：先 4 位小数舍入，再经 float32 量化（设计文档要求）。"""
    return float(np.float32(round(float(v), 4)))


def export_json(result, out_dir):
    """写 out_dir/<scene>.json 并返回路径；超 2MB 抛 RuntimeError。"""
    scene = result.scene
    data = {
        "scene": scene.name,
        "xml": scene.xml,
        "fps": round(1.0 / (result.timestep * scene.sim_stride), 2),
        "duration": round(scene.duration, 4),
        "frames": len(result.time),
        "joints": result.joint_names,
        "muscles": scene.muscles,
        "series": {
            "time": [_f32(t) for t in result.time],
            "qpos": [[_f32(x) for x in row] for row in result.qpos],
            "qfrc_actuator": [[_f32(x) for x in row] for row in result.qfrc_actuator],
            "muscle_act": [[_f32(a * 100.0) for a in row] for row in result.muscle_act],
            "grf": [[_f32(x) for x in row] for row in result.grf],
        },
        "keyframes": scene.keyframes,
    }
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, f"{scene.name}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    size = os.path.getsize(path)
    if size > MAX_JSON_BYTES:
        raise RuntimeError(f"{path} 体积 {size}B 超过 2MB 上限")
    return path
```

- [ ] **Step 4: 运行确认通过**

```powershell
.venv\Scripts\python.exe -m pytest pipeline/tests/test_export_scene.py -v
```

Expected: 4 PASS。

- [ ] **Step 5: Commit**

```powershell
git add pipeline/export_scene.py pipeline/tests/test_export_scene.py
git commit -m "feat(P2): 场景 JSON 导出（float32 + 2MB 守卫）"
```

---

### Task 6: CLI（run_scene）与可重复性校验

**Files:**
- Create: `pipeline/run_scene.py`
- Test: `pipeline/tests/test_run_scene.py`

- [ ] **Step 1: 写失败测试**

`pipeline/tests/test_run_scene.py`：

```python
import os
import pytest
from pipeline.run_scene import main, run_scene, check_repeatability, sha256_of

MINI_YAML = """\
name: mini
xml: {xml}
duration: 0.2
sim_stride: 10
muscles: [tibant_r]
pose_tracks:
  hip_flexion_r: [[0, 0], [100, 10]]
muscle_tracks:
  tibant_r: [[0, 0.1], [100, 0.2]]
keyframes:
  - {{t: 0.1, label: 测试, cardId: test_card}}
""".format(xml=os.path.normpath(os.path.join(
    os.path.dirname(__file__), "..", "..", "assets", "MS-Human-700",
    "MS-Human-700.xml")).replace("\\", "/"))


@pytest.fixture
def mini_yaml(tmp_path):
    p = tmp_path / "mini.yaml"
    p.write_text(MINI_YAML, encoding="utf-8")
    return str(p)


def test_run_scene_produces_json(mini_yaml, tmp_path):
    out = str(tmp_path / "out")
    path = run_scene(mini_yaml, out)
    assert os.path.isfile(path)
    assert os.path.getsize(path) > 1000


def test_check_repeatability_passes(mini_yaml, tmp_path):
    h = check_repeatability(mini_yaml,
                            str(tmp_path / "a"), str(tmp_path / "b"))
    assert len(h) == 64  # sha256 hex


def test_cli_single(mini_yaml, tmp_path, capsys):
    main(["--scene", mini_yaml, "--out", str(tmp_path / "cli_out")])
    assert "OK" in capsys.readouterr().out


def test_cli_repeatability_flag(mini_yaml, tmp_path, capsys):
    main(["--scene", mini_yaml, "--out", str(tmp_path / "cli_out"),
          "--check-repeatability"])
    assert "REPEATABLE" in capsys.readouterr().out


def test_cli_batch(mini_yaml, tmp_path, capsys):
    batch = tmp_path / "scenes"
    batch.mkdir()
    (batch / "mini.yaml").write_text(MINI_YAML, encoding="utf-8")
    main(["--all", str(batch), "--out", str(tmp_path / "cli_out")])
    out = capsys.readouterr().out
    assert out.count("OK") == 1
```

- [ ] **Step 2: 运行确认失败**

```powershell
.venv\Scripts\python.exe -m pytest pipeline/tests/test_run_scene.py -v
```

Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 CLI**

`pipeline/run_scene.py`：

```python
"""P2 CLI：跑教学场景 → scenes/*.json；含可重复性校验（sha256 逐字节比对）。

用法（仓库根）：
  python -m pipeline.run_scene --scene pipeline/scenes/gait_cycle.yaml --out pipeline/out/scenes
  python -m pipeline.run_scene --all pipeline/scenes --out pipeline/out/scenes
  python -m pipeline.run_scene --scene ... --out ... --check-repeatability
"""
import argparse
import glob
import hashlib
import os


def sha256_of(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        h.update(f.read())
    return h.hexdigest()


def run_scene(scene_path, out_dir):
    """加载 → 校验 → 仿真 → 导出。返回产物路径。"""
    import mujoco
    from pipeline.scene_loader import load_scene, validate_against_model
    from pipeline.simulate_scene import simulate
    from pipeline.export_scene import export_json

    scene = load_scene(scene_path)
    m = mujoco.MjModel.from_xml_path(scene.xml)
    validate_against_model(scene, m)
    result = simulate(scene)
    return export_json(result, out_dir)


def check_repeatability(scene_path, tmp_a, tmp_b):
    """同一场景跑两次，输出须逐字节一致；返回 sha256。"""
    pa = run_scene(scene_path, tmp_a)
    pb = run_scene(scene_path, tmp_b)
    ha, hb = sha256_of(pa), sha256_of(pb)
    if ha != hb:
        raise RuntimeError(f"可重复性校验失败：{ha} != {hb}")
    return ha


def main(argv=None):
    ap = argparse.ArgumentParser(description="P2 教学场景仿真预计算")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--scene", help="单个场景 YAML 路径")
    g.add_argument("--all", dest="all_dir", help="批量目录（所有 *.yaml）")
    ap.add_argument("--out", required=True, help="输出目录")
    ap.add_argument("--check-repeatability", action="store_true",
                    help="配合 --scene：跑两次并校验输出逐字节一致")
    args = ap.parse_args(argv)
    if args.scene:
        path = run_scene(args.scene, args.out)
        print(f"OK {path} ({os.path.getsize(path)} bytes)")
        if args.check_repeatability:
            h = check_repeatability(args.scene,
                                    args.out + "_rep_a", args.out + "_rep_b")
            print(f"REPEATABLE sha256={h}")
    else:
        for yml in sorted(glob.glob(os.path.join(args.all_dir, "*.yaml"))):
            path = run_scene(yml, args.out)
            print(f"OK {path} ({os.path.getsize(path)} bytes)")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: 运行确认通过 + 全量回归**

```powershell
.venv\Scripts\python.exe -m pytest pipeline/tests -v
```

Expected: 全部 PASS（P1 19 + P2 新增 ~40）。

- [ ] **Step 5: Commit**

```powershell
git add pipeline/run_scene.py pipeline/tests/test_run_scene.py
git commit -m "feat(P2): 场景仿真 CLI 与可重复性校验"
```

---

### Task 7: 5 个教学场景定义 + 集成验收 + 文档回填

**Files:**
- Create: `pipeline/scenes/gait_cycle.yaml`
- Create: `pipeline/scenes/drop_landing.yaml`
- Create: `pipeline/scenes/lift_task.yaml`
- Create: `pipeline/scenes/shoulder_abduction.yaml`
- Create: `pipeline/scenes/ankle_inversion.yaml`
- Test: `pipeline/tests/test_scenes.py`
- Modify: `docs/modules/06-simulation-pipeline.md`（状态行）

- [ ] **Step 1: 写 5 个场景 YAML**

`pipeline/scenes/gait_cycle.yaml`（Locomotion 变体，1 个步态周期 1.2s，右腿主线；角度 deg；knee 正=屈曲；激活度 0-1）：

```yaml
name: gait_cycle
xml: assets/MS-Human-700/MS-Human-700-Locomotion.xml
duration: 1.2
sim_stride: 10
ground:
  mode: auto
  target_grf: 1.0
muscles: [glmax1_r, bflh_r, semimem_r, gaslat_r, gasmed_r, soleus_r, tibant_r, addlong_r]
pose_tracks:
  hip_flexion_r: [[0, 25], [20, 5], [45, -5], [65, 15], [85, 35], [100, 25]]
  hip_flexion_l: [[0, -5], [15, 15], [35, 35], [55, 25], [75, 5], [95, -5], [100, -5]]
  knee_angle_r: [[0, 5], [15, 18], [40, 3], [60, 10], [75, 45], [90, 20], [100, 5]]
  knee_angle_l: [[0, 10], [10, 45], [25, 20], [50, 5], [65, 18], [90, 3], [100, 10]]
  ankle_angle_r: [[0, -5], [10, 0], [40, 10], [55, 0], [62, -15], [75, -10], [100, -5]]
  ankle_angle_l: [[0, -10], [12, -5], [25, 0], [50, -5], [60, 0], [90, 10], [100, -10]]
muscle_tracks:
  glmax1_r: [[0, 0.20], [45, 0.10], [60, 0.40], [80, 0.30], [100, 0.20]]
  bflh_r: [[0, 0.25], [30, 0.05], [60, 0.10], [85, 0.35], [100, 0.25]]
  semimem_r: [[0, 0.20], [30, 0.05], [60, 0.08], [85, 0.30], [100, 0.20]]
  gaslat_r: [[0, 0.10], [30, 0.20], [55, 0.50], [65, 0.60], [80, 0.10], [100, 0.10]]
  gasmed_r: [[0, 0.10], [30, 0.20], [55, 0.50], [65, 0.60], [80, 0.10], [100, 0.10]]
  soleus_r: [[0, 0.15], [30, 0.30], [55, 0.55], [68, 0.60], [85, 0.10], [100, 0.15]]
  tibant_r: [[0, 0.40], [20, 0.15], [45, 0.10], [60, 0.30], [85, 0.35], [100, 0.40]]
  addlong_r: [[0, 0.15], [50, 0.10], [70, 0.20], [100, 0.15]]
keyframes:
  - {t: 0.0, label: 右足跟着地（双支撑相开始）, cardId: r_heel_strike}
  - {t: 0.6, label: 右足趾离地（摆动相开始）, cardId: r_toe_off}
```

`pipeline/scenes/drop_landing.yaml`（跳跃着陆 1.0s：初始腾空 GRF=0 → 冲击 → 缓冲）：

```yaml
name: drop_landing
xml: assets/MS-Human-700/MS-Human-700.xml
duration: 1.0
sim_stride: 10
ground:
  mode: manual
  offset: 0.0
sink_track: [[0, 0], [25, 0.015], [40, 0.26], [70, 0.32], [100, 0.24]]
muscles: [glmax1_r, bflh_r, gaslat_r, gasmed_r, soleus_r, tibant_r]
pose_tracks:
  hip_flexion_r: [[0, 10], [25, 20], [40, 70], [70, 80], [100, 65]]
  hip_flexion_l: [[0, 10], [25, 20], [40, 70], [70, 80], [100, 65]]
  knee_angle_r: [[0, 10], [25, 25], [40, 75], [70, 85], [100, 60]]
  knee_angle_l: [[0, 10], [25, 25], [40, 75], [70, 85], [100, 60]]
  ankle_angle_r: [[0, 0], [25, 8], [40, 18], [70, 22], [100, 14]]
  ankle_angle_l: [[0, 0], [25, 8], [40, 18], [70, 22], [100, 14]]
muscle_tracks:
  glmax1_r: [[0, 0.20], [40, 0.60], [70, 0.50], [100, 0.40]]
  bflh_r: [[0, 0.20], [40, 0.45], [100, 0.35]]
  gaslat_r: [[0, 0.20], [35, 0.50], [70, 0.55], [100, 0.45]]
  gasmed_r: [[0, 0.20], [35, 0.50], [70, 0.55], [100, 0.45]]
  soleus_r: [[0, 0.15], [40, 0.50], [100, 0.40]]
  tibant_r: [[0, 0.30], [40, 0.20], [100, 0.20]]
keyframes:
  - {t: 0.28, label: 着陆冲击（GRF 峰值，ACL 风险时刻）, cardId: landing_impact}
  - {t: 0.6, label: 深蹲缓冲（下肢肌群离心制动）, cardId: landing_buffer}
```

`pipeline/scenes/lift_task.yaml`（弯腰提重物 2.0s：躯干前屈 + 双手 -150N 载荷；L5_S1_FE/T12_L1_FE 负=前屈）：

```yaml
name: lift_task
xml: assets/MS-Human-700/MS-Human-700.xml
duration: 2.0
sim_stride: 10
ground:
  mode: auto
  target_grf: 1.0
external_forces:
  - body: hand_r
    track: [[0, 0, 0, 0], [30, 0, 0, 0], [55, 0, 0, -150], [70, 0, 0, -150], [95, 0, 0, 0], [100, 0, 0, 0]]
muscles: [glmax1_r, glmax2_r, bflh_r, semimem_r, addlong_r, gasmed_r]
pose_tracks:
  pelvis_tilt: [[0, 0], [30, 0], [55, 0.9], [70, 0.9], [100, 0]]
  hip_flexion_r: [[0, 5], [30, 5], [55, 75], [70, 75], [100, 5]]
  hip_flexion_l: [[0, 5], [30, 5], [55, 75], [70, 75], [100, 5]]
  knee_angle_r: [[0, 10], [30, 10], [55, 25], [70, 25], [100, 10]]
  knee_angle_l: [[0, 10], [30, 10], [55, 25], [70, 25], [100, 10]]
  L5_S1_FE: [[0, 0], [30, 0], [55, -0.45], [70, -0.45], [100, 0]]
  T12_L1_FE: [[0, 0], [30, 0], [55, -0.35], [70, -0.35], [100, 0]]
muscle_tracks:
  glmax1_r: [[0, 0.10], [30, 0.15], [55, 0.70], [70, 0.75], [90, 0.30], [100, 0.10]]
  glmax2_r: [[0, 0.10], [30, 0.15], [55, 0.65], [70, 0.70], [90, 0.30], [100, 0.10]]
  bflh_r: [[0, 0.10], [30, 0.10], [55, 0.50], [70, 0.55], [90, 0.25], [100, 0.10]]
  semimem_r: [[0, 0.08], [30, 0.10], [55, 0.45], [70, 0.50], [90, 0.20], [100, 0.08]]
  addlong_r: [[0, 0.10], [30, 0.10], [55, 0.35], [70, 0.35], [90, 0.15], [100, 0.10]]
  gasmed_r: [[0, 0.10], [30, 0.10], [55, 0.30], [70, 0.30], [90, 0.15], [100, 0.10]]
keyframes:
  - {t: 0.8, label: 弯腰抓握（L5-S1 高压缩/剪切负荷）, cardId: lift_bent}
  - {t: 1.3, label: 起身提举（伸髋肌群主导发力）, cardId: lift_up}
```

`pipeline/scenes/shoulder_abduction.yaml`（肩外展 1.5s：0→90°→保持→放下）：

```yaml
name: shoulder_abduction
xml: assets/MS-Human-700/MS-Human-700.xml
duration: 1.5
sim_stride: 10
ground:
  mode: auto
  target_grf: 1.0
muscles: [DELT1_r, DELT2_r, DELT3_r, trap_cl, gasmed_r, tibant_r]
pose_tracks:
  shoulder_elv_r: [[0, 0], [40, 1.57], [70, 1.57], [100, 0]]
muscle_tracks:
  DELT1_r: [[0, 0.05], [40, 0.55], [70, 0.60], [100, 0.05]]
  DELT2_r: [[0, 0.05], [40, 0.70], [70, 0.75], [100, 0.05]]
  DELT3_r: [[0, 0.05], [40, 0.50], [70, 0.50], [100, 0.05]]
  trap_cl: [[0, 0.05], [40, 0.40], [70, 0.45], [100, 0.05]]
  gasmed_r: [[0, 0.15], [40, 0.20], [70, 0.20], [100, 0.15]]
  tibant_r: [[0, 0.10], [40, 0.15], [70, 0.15], [100, 0.10]]
keyframes:
  - {t: 0.6, label: 肩外展 90°（三角肌中束主导）, cardId: sh_90}
  - {t: 1.05, label: 静力保持（肌力矩平衡重力矩）, cardId: sh_hold}
```

`pipeline/scenes/ankle_inversion.yaml`（踝内翻落地 0.8s：subtalar 正=内翻）：

```yaml
name: ankle_inversion
xml: assets/MS-Human-700/MS-Human-700.xml
duration: 0.8
sim_stride: 10
ground:
  mode: auto
  target_grf: 1.0
muscles: [tibant_r, soleus_r, gaslat_r, gasmed_r, fdl_r, fhl_r]
pose_tracks:
  subtalar_angle_r: [[0, 0], [30, 0.25], [60, 0.25], [100, 0.05]]
  hip_flexion_r: [[0, 5], [60, 15], [100, 8]]
  knee_angle_r: [[0, 8], [60, 18], [100, 10]]
  ankle_angle_r: [[0, 0], [60, -10], [100, -5]]
  hip_flexion_l: [[0, 0], [100, 5]]
  knee_angle_l: [[0, 5], [100, 8]]
muscle_tracks:
  tibant_r: [[0, 0.25], [30, 0.35], [60, 0.30], [100, 0.25]]
  soleus_r: [[0, 0.20], [30, 0.30], [60, 0.35], [100, 0.25]]
  gaslat_r: [[0, 0.15], [30, 0.30], [60, 0.35], [100, 0.20]]
  gasmed_r: [[0, 0.15], [30, 0.25], [60, 0.30], [100, 0.20]]
  fdl_r: [[0, 0.10], [30, 0.20], [60, 0.25], [100, 0.15]]
  fhl_r: [[0, 0.10], [30, 0.20], [60, 0.25], [100, 0.15]]
keyframes:
  - {t: 0.24, label: 内翻落地瞬间（足外侧缘承重）, cardId: inv_impact}
  - {t: 0.45, label: 踝外侧韧带高风险时刻（距腓前韧带）, cardId: inv_risk}
```

- [ ] **Step 2: 写集成测试**

`pipeline/tests/test_scenes.py`：

```python
"""P2 集成验收：5 场景全跑 → 体积 / GRF 量级 / keyframes / 可重复性。"""
import glob
import json
import os
import pytest
from pipeline.run_scene import run_scene, check_repeatability, sha256_of

SCENES_DIR = os.path.normpath(os.path.join(
    os.path.dirname(__file__), "..", "scenes"))
OUT_DIR = os.path.normpath(os.path.join(
    os.path.dirname(__file__), "..", "out", "scenes", "test"))

EXPECTED = {
    "gait_cycle": {"frames": 61, "grf_min_max": 100.0},
    "drop_landing": {"frames": 51, "grf_min_max": 800.0},
    "lift_task": {"frames": 101, "grf_min_max": 200.0},
    "shoulder_abduction": {"frames": 76, "grf_min_max": 200.0},
    "ankle_inversion": {"frames": 41, "grf_min_max": 200.0},
}


@pytest.fixture(scope="module", autouse=True)
def run_all(tmp_path_factory):
    out = str(tmp_path_factory.mktemp("scenes_out"))
    for yml in sorted(glob.glob(os.path.join(SCENES_DIR, "*.yaml"))):
        run_scene(yml, out)
    yield out


def test_all_five_jsons_exist(run_all):
    for name in EXPECTED:
        assert os.path.isfile(os.path.join(run_all, f"{name}.json")), name


def test_frames_and_size(run_all):
    for name, exp in EXPECTED.items():
        with open(os.path.join(run_all, f"{name}.json"), "r", encoding="utf-8") as f:
            data = json.load(f)
        assert data["frames"] == exp["frames"], name
        assert os.path.getsize(os.path.join(run_all, f"{name}.json")) < 2 * 1024 * 1024


def test_grf_magnitude(run_all):
    for name, exp in EXPECTED.items():
        with open(os.path.join(run_all, f"{name}.json"), "r", encoding="utf-8") as f:
            data = json.load(f)
        grf_z_max = max(row[2] for row in data["series"]["grf"])
        assert grf_z_max > exp["grf_min_max"], (name, grf_z_max)
        assert grf_z_max < 8000.0, (name, grf_z_max)  # 量级守卫（< 14 体重）


def test_keyframes_present(run_all):
    for name in EXPECTED:
        with open(os.path.join(run_all, f"{name}.json"), "r", encoding="utf-8") as f:
            data = json.load(f)
        assert len(data["keyframes"]) >= 2, name
        for kf in data["keyframes"]:
            assert 0.0 <= kf["t"] <= data["duration"]


def test_gait_repeatable():
    yml = os.path.join(SCENES_DIR, "gait_cycle.yaml")
    h = check_repeatability(yml,
                            os.path.join(OUT_DIR, "_rep_a"),
                            os.path.join(OUT_DIR, "_rep_b"))
    assert len(h) == 64
```

- [ ] **Step 3: 运行集成测试，按需校准场景参数**

```powershell
.venv\Scripts\python.exe -m pytest pipeline/tests/test_scenes.py -v
```

Expected: 5 PASS。**校准指引**（实测后调整 YAML，属于本任务预期工作）：
- `drop_landing` GRF 峰 < 800N：加深 `sink_track` 峰值（0.26 → 0.30）或减小着陆膝屈曲角（75 → 65，足部压得更深）。
- 某场景 GRF 恒 0：初始姿态脚悬空 → `ground.offset` 改为 -0.005 起步逐级负移（auto 模式报错时同理检查 `pose_tracks` 是否含禁用的 `pelvis_ty`）。
- 校准失败（`接地校准失败`）：确认初始姿态腿是伸直向下的；必要时减小屈髋/屈膝初始角。

- [ ] **Step 4: 全量测试回归**

```powershell
.venv\Scripts\python.exe -m pytest pipeline/tests -v
```

Expected: 全部 PASS。

- [ ] **Step 5: CLI 全量产出 + 可重复性验收**

```powershell
.venv\Scripts\python.exe -m pipeline.run_scene --all pipeline/scenes --out pipeline/out/scenes
.venv\Scripts\python.exe -m pipeline.run_scene --scene pipeline/scenes/gait_cycle.yaml --out pipeline/out/scenes --check-repeatability
```

Expected: 5 行 `OK ...`；`REPEATABLE sha256=...`（两次运行文件逐字节一致）。

- [ ] **Step 6: 文档回填**

`docs/modules/06-simulation-pipeline.md` 首行标题的 `[状态: 设计已批准]` 改为 `[状态: P2 已实现]`，并在「核心流程说明」代码块后追加一行：

```
实现：pipeline/（scene_loader / pose_tracks / simulate_scene / export_scene / run_scene + scenes/*.yaml）
```

- [ ] **Step 7: Commit**

```powershell
git add pipeline/scenes pipeline/tests/test_scenes.py docs/modules/06-simulation-pipeline.md
git commit -m "feat(P2): 5 个教学场景定义与集成验收（体积/量级/可重复性）"
```

---

## 自查记录（计划完成时已核对）

- 规格覆盖：06 文档的场景定义（Task 3/7）、MuJoCo 仿真（Task 4）、数据导出 float32+重采样 50Hz（Task 5，stride=10×0.002s）、关键帧人工标注（Task 7 YAML `keyframes`）、可重复校验（Task 4 determinism 测试 + Task 6/7 sha256）、单场景 <2MB（Task 5 守卫 + Task 7 验收）、5 场景（Task 7）。
- 类型一致性：`SceneConfig` 字段（ground_mode/ground_target_grf/ground_offset/sink_track）在 Task 3 定义、Task 4 使用、Task 5/6 消费一致；`eval_track` 的标量/向量返回在 Task 4 `_set_frame` 中分别消费；`SimResult.timestep` 由 Task 4 赋值、Task 5 使用。
- 已知取舍：步态场景不设 `sink_track`（重心恒定）——准静态接触刚度大（毫米级下压对应数百 N），真实重心起伏会剧烈放大 GRF；GRF 双峰由双腿支撑转换驱动。肌肉激活度为开环教学曲线（ctrl 直写 act），非闭环求解——教学曲线可控性与可解释性优先，%MVC 量级经 Task 7 量级守卫与后续教师抽查把关。
