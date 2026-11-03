# 一次性：列出模型全部非零 joint 锚点
import mujoco
import numpy as np

m = mujoco.MjModel.from_xml_path("assets/MS-Human-700/MS-Human-700.xml")
n = 0
for j in range(m.njnt):
    pos = m.jnt_pos[j]
    if np.abs(pos).max() > 1e-12:
        name = mujoco.mj_id2name(m, mujoco.mjtObj.mjOBJ_JOINT, j)
        bid = m.jnt_bodyid[j]
        bname = mujoco.mj_id2name(m, mujoco.mjtObj.mjOBJ_BODY, bid)
        print(f"{name}\tbody={bname}\tpos={np.array2string(pos, precision=9)}\ttype={m.jnt_type[j]}")
        n += 1
print(f"total joints={m.njnt}, nonzero anchor={n}")
# 顺带打印 qpos0 非零项
for i in range(m.nq):
    if abs(m.qpos0[i]) > 1e-12:
        print(f"qpos0[{i}]={m.qpos0[i]:.6g}")
# joint->qposadr 映射验证：hinge/slide 都是 1 dof
print("nq =", m.nq, "nv =", m.nv, "njnt =", m.njnt)
