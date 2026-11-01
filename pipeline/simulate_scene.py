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
    """世界系地面反作用力：floor 与模型间全部接触力之和（contact frame → world）。

    方向判定：接触对中恰一侧属于 world（body 0）；力取「world 施加于模型」方向，
    即世界系 GRF（z 向上为正）。
    """
    grf = np.zeros(3)
    for ci in range(d.ncon):
        c = d.contact[ci]
        b1 = int(m.geom_bodyid[c.geom1])
        b2 = int(m.geom_bodyid[c.geom2])
        if (b1 == 0) == (b2 == 0):
            continue  # 双 world 或模型自接触：不计入地面反作用力
        f6 = np.zeros(6)
        mujoco.mj_contactForce(m, d, ci, f6)
        fw = c.frame.reshape(3, 3).T @ f6[:3]
        grf += fw if b1 == 0 else -fw
    return grf


def _set_frame(m, d, scene, joint_adr, act_adr, force_body_id, ty_base, u):
    """把模型状态设为时刻 u（0~100）对应的场景帧。"""
    mujoco.mj_resetDataKeyframe(m, d, 0)
    # 垂直高度始终由 ty_base - sink(t) 决定（keyframe 0 的 ty=0 不触地）
    sink = eval_track(scene.sink_track, u) if scene.sink_track else 0.0
    d.qpos[joint_adr["pelvis_ty"]] = ty_base - sink
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
    g = float(-m.opt.gravity[2])
    target = scene.ground_target_grf * float(m.body_mass.sum()) * g
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
    if len(act_adr) != m.nu:
        raise ValueError("执行器名称存在重复，无法建立名称索引")
    force_bodies = [f["body"] for f in scene.external_forces]
    if len(set(force_bodies)) != len(force_bodies):
        raise ValueError(f"同一 body 重复施加外力：{force_bodies}")
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
