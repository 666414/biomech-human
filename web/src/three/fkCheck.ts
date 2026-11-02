/**
 * 运行时 FK 对账：用 three.js 按 MuJoCo 导出的参考真值（fk-reference.json）
 * 驱动 glTF 节点，逐 body 比较世界位姿。
 *
 * 通过标准：位置差 < 1e-3 m、角度差 < 1e-2 rad。
 * glTF 节点局部变换 = P1 转换写入的 XML body pos/quat（float64 文本精度 ~1e-7），
 * poseMap 组合语义与 mj_kinematics 一致，理论上误差应远小于阈值。
 *
 * 重要：必须传入「静止位时构建」的 PoseMap（SceneManager 在模型加载完成时构建，
 * rest 即模型静止位）。检查前会 resetPose 清掉 RAF 回放残留的姿态——若在调用时
 * 现场新建 PoseMap，捕获到的"rest"会是已摆姿势的变换，导致关节复合两次。
 */
import * as THREE from 'three'
import type { JointAngles } from '../types'
import { applyPose, resetPose, type PoseMap } from './poseMap'

/** fk-reference.json 结构（pipeline/tools/fk_reference.py 导出） */
export interface FkReference {
  scene: string
  xml: string
  joints: string[]
  frames: Array<{
    t: number
    qpos36: number[]
    bodies: Record<string, { pos: [number, number, number]; quat: [number, number, number, number] }>
  }>
}

export const FK_POS_TOL = 1e-3
export const FK_QUAT_TOL = 1e-2

export interface FkFrameResult {
  t: number
  /** 最大位置差（m） */
  maxPosErr: number
  /** 最大四元数角差（rad） */
  maxQuatErr: number
  worstPosBody: string
  worstQuatBody: string
  /** 逐 body 误差 */
  perBody: Record<string, { posErr: number; quatErr: number }>
}

export interface FkCheckResult {
  scene: string
  frames: FkFrameResult[]
  maxPosErr: number
  maxQuatErr: number
  pass: boolean
}

/** 拉取参考真值（优先 public 数据目录） */
export async function loadFkReference(url = '/data/fk-reference.json'): Promise<FkReference> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`加载 ${url} 失败：HTTP ${res.status}`)
  return (await res.json()) as FkReference
}

const _wp = new THREE.Vector3()
const _wq = new THREE.Quaternion()

/**
 * 遍历参考帧：applyPose 后取各 body 节点世界位姿与 fixture 比较。
 * map 必须以模型静止位构建（SceneManager 加载后构建的那份）；检查前后都
 * resetPose——前者清除回放残留，后者把树还原，交还 RAF 回放循环。
 */
export function checkPoseMap(map: PoseMap, ref: FkReference): FkCheckResult {
  const frames: FkFrameResult[] = []

  for (const frame of ref.frames) {
    resetPose(map)
    const q: JointAngles = {}
    for (let i = 0; i < ref.joints.length; i++) q[ref.joints[i]] = frame.qpos36[i]
    applyPose(map, q)

    const perBody: Record<string, { posErr: number; quatErr: number }> = {}
    let maxPosErr = 0
    let maxQuatErr = 0
    let worstPosBody = ''
    let worstQuatBody = ''

    for (const [bodyId, expect] of Object.entries(frame.bodies)) {
      const node = map.nodes.get(bodyId)
      if (!node) {
        perBody[bodyId] = { posErr: Number.NaN, quatErr: Number.NaN }
        continue
      }
      node.updateWorldMatrix(true, false)
      node.getWorldPosition(_wp)
      node.getWorldQuaternion(_wq)

      const posErr = _wp.distanceTo(new THREE.Vector3(...expect.pos))
      // fixture quat 为 MuJoCo wxyz → three 构造器 xyzw；双覆盖：|dot| 接近 1 即同旋转
      const eq = new THREE.Quaternion(expect.quat[1], expect.quat[2], expect.quat[3], expect.quat[0])
      const dot = Math.min(1, Math.abs(_wq.dot(eq)))
      const quatErr = 2 * Math.acos(dot)

      perBody[bodyId] = { posErr, quatErr }
      if (posErr > maxPosErr) {
        maxPosErr = posErr
        worstPosBody = bodyId
      }
      if (quatErr > maxQuatErr) {
        maxQuatErr = quatErr
        worstQuatBody = bodyId
      }
    }
    frames.push({ t: frame.t, maxPosErr, maxQuatErr, worstPosBody, worstQuatBody, perBody })
  }

  resetPose(map) // 还原静止位，交还 RAF 回放循环

  const maxPosErr = Math.max(...frames.map((f) => f.maxPosErr))
  const maxQuatErr = Math.max(...frames.map((f) => f.maxQuatErr))
  return { scene: ref.scene, frames, maxPosErr, maxQuatErr, pass: maxPosErr < FK_POS_TOL && maxQuatErr < FK_QUAT_TOL }
}

/** 结果格式化为多行文本（开发浮层/控制台用） */
export function formatFkResult(r: FkCheckResult): string {
  const lines = [
    `FK 对账 ${r.pass ? '通过 ✓' : '未通过 ✗'}（场景 ${r.scene}）`,
    `最大位置差 ${r.maxPosErr.toExponential(3)} m（阈值 ${FK_POS_TOL}）`,
    `最大角度差 ${r.maxQuatErr.toExponential(3)} rad（阈值 ${FK_QUAT_TOL}）`,
  ]
  for (const f of r.frames) {
    lines.push(
      `t=${f.t.toFixed(2)}s pos=${f.maxPosErr.toExponential(2)}(${f.worstPosBody}) quat=${f.maxQuatErr.toExponential(2)}(${f.worstQuatBody})`,
    )
  }
  return lines.join('\n')
}
