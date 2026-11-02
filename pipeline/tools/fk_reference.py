"""MuJoCo 正向运动学参考真值导出（P3 Task 3 FK 对账 fixture）。

用途：
    对指定场景取若干采样帧，用 MuJoCo 计算 8 个代表性 body 的世界位姿
    （xpos/xquat），导出为 web 端 FK 对账 fixture（fk-reference.json）。
    浏览器端 ?fkcheck=1 用 three.js 按同一 qpos 驱动 glTF 节点后，
    与本 fixture 逐 body 比较，要求位置差 < 1e-3 m、角度差 < 1e-2 rad。

组合语义（已用 pipeline/tools 探针实测确认，与 mj_kinematics 一致）：
    body 局部变换 = T(p0 + Σ R_prev·axis·q) · (q0 ⊗ Π R(axis_i, q_i))
    hinge 绕 anchor 旋转（带位置补偿），slide 轴被此前累计旋转（含 q0）变换。

重跑命令（cwd = 仓库根）：
    .venv\\Scripts\\python.exe pipeline/tools/fk_reference.py
    可选参数：--scene gait_cycle --out web/public/data/fk-reference.json

注意：MuJoCo 3.17 Windows 无法打开中文绝对路径，XML/场景一律用相对路径。
"""
import argparse
import json
import os

import mujoco
import numpy as np

# 8 个代表性 body：覆盖骨盆→脊柱、骨盆→腿→足、锁骨→上臂→手 三条链
# （任务书里的 thigh_r/shank_r/foot_r/torso 在本模型中的真实 id 为
#   femur_r / tibia_r / calcn_r / sacrum，以 rig-meta 实际 id 为准）
REFERENCE_BODIES = [
    "pelvis",
    "sacrum",
    "femur_r",
    "tibia_r",
    "calcn_r",
    "clavicle_r",
    "humerus_r",
    "hand_r",
]


def sample_qpos(scene: dict, t: float) -> list:
    """与 web/src/interp.ts sampleSeries 一致的逐帧线性插值。"""
    time = scene["series"]["time"]
    rows = scene["series"]["qpos"]
    n = len(time)
    if t <= time[0]:
        return list(rows[0])
    if t >= time[n - 1]:
        return list(rows[n - 1])
    lo, hi = 0, n - 1
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if time[mid] <= t:
            lo = mid
        else:
            hi = mid
    f = (t - time[lo]) / (time[hi] - time[lo])
    a, b = rows[lo], rows[hi]
    return [a[j] + (b[j] - a[j]) * f for j in range(len(a))]


def compute_frame(model, data, scene: dict, t: float) -> dict:
    """给定时刻：keyframe 复位 → 覆盖场景 36 关节 → mj_forward → 读 body 位姿。"""
    qpos_row = sample_qpos(scene, t)
    mujoco.mj_resetDataKeyframe(model, data, 0)  # keyframe 0 = init 姿态（85 维）
    for col, name in enumerate(scene["joints"]):
        jid = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_JOINT, name)
        if jid < 0:
            raise SystemExit(f"场景关节 {name} 在模型中不存在")
        qadr = model.jnt_qposadr[jid]
        data.qpos[qadr] = qpos_row[col]
    mujoco.mj_forward(model, data)

    bodies = {}
    for name in REFERENCE_BODIES:
        bid = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY, name)
        if bid < 0:
            raise SystemExit(f"参考 body {name} 在模型中不存在")
        bodies[name] = {
            "pos": [round(float(v), 9) for v in data.xpos[bid]],
            # MuJoCo xquat 顺序 w,x,y,z，与 three.js 一致
            "quat": [round(float(v), 9) for v in data.xquat[bid]],
        }
    return {"t": round(float(t), 6), "qpos36": [round(float(v), 9) for v in qpos_row], "bodies": bodies}


def main():
    ap = argparse.ArgumentParser(description="MuJoCo FK 参考真值导出")
    ap.add_argument("--xml", default="", help="默认取场景 json 的 xml 字段（与 P2 仿真同源）")
    ap.add_argument("--scene", default="web/public/data/scenes/gait_cycle.json")
    ap.add_argument("--out", default="web/public/data/fk-reference.json")
    args = ap.parse_args()

    scene_name = os.path.splitext(os.path.basename(args.scene))[0]
    with open(args.scene, encoding="utf-8") as f:
        scene = json.load(f)

    xml_path = args.xml or scene.get("xml") or "assets/MS-Human-700/MS-Human-700.xml"
    model = mujoco.MjModel.from_xml_path(xml_path)
    data = mujoco.MjData(model)

    # 采样帧：t=0、膝屈峰附近（30% 周期）、周期中点
    duration = scene["duration"]
    frames = [compute_frame(model, data, scene, t) for t in (0.0, round(duration * 0.3, 6), round(duration * 0.5, 6))]

    out = {"scene": scene_name, "xml": xml_path, "joints": scene["joints"], "frames": frames}
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)

    size_kb = os.path.getsize(args.out) / 1024
    print(f"导出 {args.out}（{size_kb:.1f} KB）：{len(frames)} 帧 x {len(REFERENCE_BODIES)} body")
    for fr in frames:
        p = fr["bodies"]["pelvis"]["pos"]
        print(f"  t={fr['t']:.2f}s pelvis.pos={np.array2string(np.array(p), precision=4)}")


if __name__ == "__main__":
    main()
