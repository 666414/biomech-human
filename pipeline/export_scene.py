"""仿真结果 → scenes/<scene>.json：float32 精度、教学契约结构、2MB 体积守卫。
超限抛错时，已写盘的残留文件会被删除。"""
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
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    size = os.path.getsize(path)
    if size > MAX_JSON_BYTES:
        os.remove(path)
        raise RuntimeError(f"{path} 体积 {size}B 超过 2MB 上限")
    return path
