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


def _num(value, what):
    """数值校验：非数值时抛带定位信息的 ValueError。"""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{what} 须为数值，得到 {value!r}")
    return float(value)


def _int(value, what):
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"{what} 须为整数，得到 {value!r}")
    return value


def _validate_track(name, track, vector=False):
    if not isinstance(track, list) or len(track) < 2:
        raise ValueError(f"轨迹 {name} 至少需要 2 个关键点")
    prev_u = -1.0
    for row in track:
        if vector:
            if not isinstance(row, list) or len(row) != 4:
                raise ValueError(f"力轨迹 {name} 每行须为 [u%, fx, fy, fz]")
        else:
            if not isinstance(row, list) or len(row) != 2:
                raise ValueError(f"轨迹 {name} 每行须为 [u%, value]")
        u = _num(row[0], f"轨迹 {name} 关键点 u")
        if not (0.0 <= u <= 100.0):
            raise ValueError(f"轨迹 {name} 关键点 u={row[0]} 超出 [0,100]")
        if u < prev_u:
            raise ValueError(f"轨迹 {name} 关键点 u 须非递减")
        prev_u = u


def load_scene(path):
    with open(path, "r", encoding="utf-8") as f:
        raw = yaml.safe_load(f)

    if not isinstance(raw, dict):
        raise ValueError("场景 YAML 须为映射（检查文件是否为空）")

    for k in ("name", "xml", "duration", "sim_stride", "muscles"):
        if k not in raw:
            raise ValueError(f"场景缺少字段 {k}")
    name = str(raw["name"])
    duration = _num(raw["duration"], "duration")
    if duration <= 0:
        raise ValueError(f"场景 {name} duration 须为正")
    stride = _int(raw["sim_stride"], "sim_stride")
    if stride < 1:
        raise ValueError(f"场景 {name} sim_stride 须 >= 1")

    if not isinstance(raw["muscles"], list):
        raise ValueError("muscles 须为列表")
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
        t = _num(kf["t"], "keyframe t")
        if not (0.0 <= t <= duration):
            raise ValueError(f"keyframe t={t} 超出时长 {duration}s")

    ground = raw.get("ground") or {}
    ground_mode = str(ground.get("mode", "auto"))
    if ground_mode not in ("auto", "manual"):
        raise ValueError(f"ground.mode 须为 auto|manual，得到 {ground_mode}")
    ground_target_grf = _num(ground.get("target_grf", 1.0), "ground.target_grf")
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
        ground_offset=_num(ground.get("offset", 0.0), "ground.offset"),
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
