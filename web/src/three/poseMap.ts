/**
 * 姿态驱动核心：把广义坐标（JointAngles）写入 glTF 节点局部变换。
 *
 * 组合语义与 MuJoCo mj_kinematics 严格一致（已用探针在 MuJoCo 3.17 实测确认）：
 *   - hinge：绕锚点 anchor（body 局部系）旋转，body 局部四元数按声明顺序右乘；
 *     锚点非零时同步补偿平移（p += R·c − (R⊗R_loc)·c）
 *   - slide：沿轴平移，轴向量被「此前累计旋转（含 q0）」变换（p += R·axis·q）
 *   - 多关节按 part.joints 声明顺序复合；四元数与 MuJoCo 同为 w,x,y,z。
 *
 * glb 契约（P1 转换，已实测）：节点名 = body id；节点局部变换 = XML body pos/quat
 * （pelvis 自带绕 x +90° 建模约定 quat，原样保留不纠正）。
 */
import * as THREE from 'three'
import type { JointAngles, RigJoint, RigMeta } from '../types'

/** 汇总 rig 全部关节（按 part 顺序展开） */
export function collectJoints(rig: RigMeta): RigJoint[] {
  return rig.parts.flatMap((p) => p.joints)
}

/** 单个有关节 part 的驱动条目 */
interface JointEntry {
  partId: string
  node: THREE.Object3D
  restPos: THREE.Vector3
  restQuat: THREE.Quaternion
  joints: RigJoint[]
  /** 预转换的轴/锚点向量（避免每帧分配） */
  axes: THREE.Vector3[]
  anchors: THREE.Vector3[]
}

export interface PoseMap {
  /** part id → 节点（含无关节 part，供拾取/分层/聚焦使用） */
  nodes: Map<string, THREE.Object3D>
  /** 有关节 part 的驱动条目 */
  entries: JointEntry[]
}

/**
 * 对 glTF 场景建姿态映射：按 part.id 找节点，缓存初始局部 pos/quat。
 * 节点缺失时跳过该 part（不抛错——皮肤/肌肉层可能被裁剪）。
 */
export function buildPoseMap(root: THREE.Object3D, rig: RigMeta): PoseMap {
  const nodes = new Map<string, THREE.Object3D>()
  const entries: JointEntry[] = []
  for (const part of rig.parts) {
    const node = root.getObjectByName(part.id)
    if (!node) continue
    nodes.set(part.id, node)
    if (part.joints.length === 0) continue
    entries.push({
      partId: part.id,
      node,
      restPos: node.position.clone(),
      restQuat: node.quaternion.clone(),
      joints: part.joints,
      axes: part.joints.map((j) => new THREE.Vector3(...j.axis)),
      anchors: part.joints.map((j) => new THREE.Vector3(...(j.anchor ?? [0, 0, 0]))),
    })
  }
  return { nodes, entries }
}

// 模块级暂存对象：applyPose 每帧调用，避免分配
const _p = new THREE.Vector3()
const _r = new THREE.Quaternion()
const _ql = new THREE.Quaternion()
const _rn = new THREE.Quaternion()
const _v = new THREE.Vector3()
const _c = new THREE.Vector3()

/**
 * 把全部驱动条目的节点复位到模型静止位（加载时缓存的 basePos/baseQuat）。
 * 用途：FK 对账前清除此前 applyPose 残留的姿态，保证从真静止位复算。
 */
export function resetPose(map: PoseMap): void {
  for (const e of map.entries) {
    e.node.position.copy(e.restPos)
    e.node.quaternion.copy(e.restQuat)
  }
}

function clamp(v: number, range: [number, number]): number {
  return Math.min(Math.max(v, range[0]), range[1])
}

/**
 * 把广义坐标写入节点局部变换。q 里缺失的关节跳过（贡献为 0，即静止位）；
 * 全部关节都缺失的 part 不动节点。越界值 clamp 到 range。
 */
export function applyPose(map: PoseMap, q: JointAngles): void {
  for (const e of map.entries) {
    // 快路径：该 part 所有关节都不在 q 里 → 不动
    let any = false
    for (const j of e.joints) {
      if (q[j.name] !== undefined) {
        any = true
        break
      }
    }
    if (!any) continue

    _p.copy(e.restPos)
    _r.copy(e.restQuat)
    for (let i = 0; i < e.joints.length; i++) {
      const j = e.joints[i]
      const raw = q[j.name]
      if (raw === undefined) continue
      const val = clamp(raw, j.range)
      if (j.type === 'hinge') {
        _ql.setFromAxisAngle(e.axes[i], val)
        const c = e.anchors[i]
        if (c.x !== 0 || c.y !== 0 || c.z !== 0) {
          // 锚点补偿：p += R·c − (R⊗R_loc)·c（保持锚点世界位置不动）
          _v.copy(c).applyQuaternion(_r)
          _p.add(_v)
          _rn.copy(_r).multiply(_ql)
          _c.copy(c).applyQuaternion(_rn)
          _p.sub(_c)
        }
        _r.multiply(_ql) // 局部系右乘（MuJoCo 声明顺序）
      } else {
        // slide：轴被此前累计旋转（含 q0）变换
        _v.copy(e.axes[i]).applyQuaternion(_r)
        _p.addScaledVector(_v, val)
      }
    }
    e.node.position.copy(_p)
    e.node.quaternion.copy(_r)
  }
}
