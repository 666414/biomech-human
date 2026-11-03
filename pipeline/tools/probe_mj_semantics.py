# 一次性探针：确定 MuJoCo 多关节组合语义（hinge 锚点 / slide 轴旋转 / 顺序）
# 运行：.venv\Scripts\python.exe pipeline/tools/probe_mj_semantics.py  (cwd=仓库根)
import mujoco
import numpy as np

XML = """
<mujoco>
  <worldbody>
    <body name="b1" pos="0.1 0.2 0.3" quat="0.70710678 0 0.70710678 0">
      <joint name="h1" type="hinge" pos="0.5 0 0" axis="0 0 1"/>
      <geom size="0.01"/>
    </body>
    <body name="b2" pos="0.1 0.2 0.3" quat="0.70710678 0 0.70710678 0">
      <joint name="h2" type="hinge" pos="0 0 0" axis="0 0 1"/>
      <joint name="s2" type="slide" pos="0 0 0" axis="0 1 0"/>
      <geom size="0.01"/>
    </body>
    <body name="b3" pos="0.1 0.2 0.3" quat="1 0 0 0">
      <joint name="h3a" type="hinge" pos="0 0 0" axis="0 0 1"/>
      <joint name="h3b" type="hinge" pos="0 0 0" axis="1 0 0"/>
      <geom size="0.01"/>
    </body>
  </worldbody>
</mujoco>
"""

m = mujoco.MjModel.from_xml_string(XML)
d = mujoco.MjData(m)


def setq(**kw):
    mujoco.mj_resetData(m, d)
    for name, v in kw.items():
        jid = mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_JOINT, name)
        qadr = m.jnt_qposadr[jid]
        d.qpos[qadr] = v
    mujoco.mj_forward(m, d)
    return d


def quat_str(q):
    return np.array2string(np.asarray(q), precision=6)


# --- 探针1：hinge 带锚点 pos=(0.5,0,0)，axis z，q=0.3 ---
d = setq(h1=0.3)
xpos, xquat = d.xpos[1].copy(), d.xquat[1].copy()
print("b1 xpos:", quat_str(xpos), " xquat:", quat_str(xquat))

q0 = np.array([0.70710678, 0, 0.70710678, 0])  # Ry(90)
c = np.array([0.5, 0, 0])
# 假设A：绕原点转（无锚点补偿）→ pos 不变
print("A 假设 pos 应为 [0.1 0.2 0.3]")
# 假设B：绕锚点 c 转：pos = p0 + R0*(c - Rz(q)*c)


def quat_mul(a, b):
    w1, x1, y1, z1 = a
    w2, x2, y2, z2 = b
    return np.array([
        w1*w2 - x1*x2 - y1*y2 - z1*z2,
        w1*x2 + x1*w2 + y1*z2 - z1*y2,
        w1*y2 - x1*z2 + y1*w2 + z1*x2,
        w1*z2 + x1*y2 - y1*x2 + z1*w2,
    ])


def quat_rot(q, v):
    qv = np.array([0, v[0], v[1], v[2]])
    qc = np.array([q[0], -q[1], -q[2], -q[3]])
    out = quat_mul(quat_mul(q, qv), qc)
    return out[1:]


def axis_angle(axis, ang):
    axis = np.asarray(axis, float)
    axis = axis / np.linalg.norm(axis)
    s = np.sin(ang / 2)
    return np.array([np.cos(ang / 2), axis[0]*s, axis[1]*s, axis[2]*s])


rz = axis_angle([0, 0, 1], 0.3)
rc = quat_mul(q0, rz)  # 世界系下的 body 朝向（两种假设 quat 相同）
posB = np.array([0.1, 0.2, 0.3]) + quat_rot(q0, c) - quat_rot(rc, c)
print("B 假设 pos 应为", quat_str(posB))
print("B 假设 quat 应为", quat_str(rc))

# --- 探针2：hinge 后 slide：slide 轴是否被 hinge 旋转？---
d = setq(h2=0.5, s2=0.7)
print("b2 xpos:", quat_str(d.xpos[2]), " xquat:", quat_str(d.xquat[2]))
q_h = quat_mul(q0, axis_angle([0, 0, 1], 0.5))
slide_rotated = np.array([0.1, 0.2, 0.3]) + quat_rot(q_h, [0, 1, 0]) * 0.7
slide_raw = np.array([0.1, 0.2, 0.3]) + np.array([0, 1, 0]) * 0.7
print("slide 轴被旋转 →", quat_str(slide_rotated))
print("slide 轴未旋转   →", quat_str(slide_raw))

# --- 探针3：两个 hinge 的复合顺序（h3a: Rz(a) 先, h3b: Rx(b) 后，右乘）---
d = setq(h3a=0.4, h3b=0.6)
print("b3 xpos:", quat_str(d.xpos[3]), " xquat:", quat_str(d.xquat[3]))
q_seq = quat_mul(quat_mul(np.array([1, 0, 0, 0]), axis_angle([0, 0, 1], 0.4)), axis_angle([1, 0, 0], 0.6))
print("顺序右乘 q0⊗Rz(0.4)⊗Rx(0.6) →", quat_str(q_seq))
q_rev = quat_mul(quat_mul(np.array([1, 0, 0, 0]), axis_angle([1, 0, 0], 0.6)), axis_angle([0, 0, 1], 0.4))
print("反序右乘 q0⊗Rx(0.6)⊗Rz(0.4) →", quat_str(q_rev))
