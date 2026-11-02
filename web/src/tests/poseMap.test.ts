/**
 * poseMap 纯逻辑单测（不加载 glb，用手工 Object3D 树）。
 *
 * 期望值来源：pipeline/tools 探针在 MuJoCo 3.17 实测的 mj_kinematics 输出
 * （锚点补偿 / slide 轴旋转 / 声明顺序右乘），非同构复算。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { applyPose, buildPoseMap, collectJoints } from '../three/poseMap'
import { checkPoseMap, type FkReference } from '../three/fkCheck'
import { parseGlbNodes } from '../three/glbNodes'
import type { JointAngles, RigJoint, RigMeta } from '../types'

const EPS = 1e-5

function qdot(a: THREE.Quaternion, wxyz: [number, number, number, number]): number {
  return Math.abs(a.dot(new THREE.Quaternion(wxyz[1], wxyz[2], wxyz[3], wxyz[0])))
}

function expectPosClose(actual: THREE.Vector3, expected: [number, number, number]) {
  expect(actual.x).toBeCloseTo(expected[0], 5)
  expect(actual.y).toBeCloseTo(expected[1], 5)
  expect(actual.z).toBeCloseTo(expected[2], 5)
}

function makeRig(parts: Array<Pick<import('../types').RigPart, 'id' | 'parent' | 'joints'>>): RigMeta {
  return {
    parts: parts.map((p) => ({
      ...p,
      names: { en: p.id, zh: p.id },
      group: 'skeleton' as const,
    })),
  }
}

/** 构建带初始局部变换的节点并挂到 root */
function buildTree(defs: Array<{ id: string; pos: [number, number, number]; quatAxis?: THREE.Vector3; quatAngle?: number }>) {
  const root = new THREE.Object3D()
  for (const d of defs) {
    const n = new THREE.Object3D()
    n.name = d.id
    n.position.set(...d.pos)
    if (d.quatAxis) n.quaternion.setFromAxisAngle(d.quatAxis, d.quatAngle ?? Math.PI / 2)
    root.add(n)
  }
  return root
}

const RY90: [number, number, number, number] = [0.7071068, 0, 0.7071068, 0]
const RX90: [number, number, number, number] = [0.7071068, 0.7071068, 0, 0]

describe('collectJoints', () => {
  it('按 part 顺序展开全部关节', () => {
    const rig = makeRig([
      { id: 'a', parent: null, joints: [{ name: 'j1', type: 'hinge', axis: [0, 0, 1], range: [-1, 1] }] },
      { id: 'b', parent: 'a', joints: [] },
      { id: 'c', parent: 'a', joints: [{ name: 'j2', type: 'slide', axis: [0, 1, 0], range: [-1, 1] }] },
    ])
    expect(collectJoints(rig).map((j) => j.name)).toEqual(['j1', 'j2'])
  })
})

describe('applyPose：hinge 锚点补偿（MuJoCo 实测真值）', () => {
  // 探针 b1：rest=(0.1,0.2,0.3) q0=Ry(90)，hinge z@anchor(0.5,0,0) q=0.3
  const joint: RigJoint = { name: 'h', type: 'hinge', axis: [0, 0, 1], range: [-1, 1], anchor: [0.5, 0, 0] }
  const root = buildTree([{ id: 'b1', pos: [0.1, 0.2, 0.3], quatAxis: new THREE.Vector3(0, 1, 0) }])
  const map = buildPoseMap(root, makeRig([{ id: 'b1', parent: null, joints: [joint] }]))

  it('位置含锚点补偿、四元数右乘，与 MuJoCo xpos/xquat 一致', () => {
    applyPose(map, { h: 0.3 })
    const node = map.nodes.get('b1')!
    expectPosClose(node.position, [0.1, 0.05224, 0.277668])
    expect(qdot(node.quaternion, [0.699167, 0.105669, 0.699167, 0.105669])).toBeCloseTo(1, 5)
  })

  it('重复调用幂等（每次从静止位重算，无漂移）', () => {
    applyPose(map, { h: 0.3 })
    const p1 = map.nodes.get('b1')!.position.clone()
    applyPose(map, { h: 0.3 })
    expect(map.nodes.get('b1')!.position.distanceTo(p1)).toBeLessThan(EPS)
  })
})

describe('applyPose：hinge 后 slide，slide 轴被累计旋转变换（MuJoCo 实测真值）', () => {
  // 探针 b2：hinge z q=0.5 后 slide y q=0.7
  const joints: RigJoint[] = [
    { name: 'h', type: 'hinge', axis: [0, 0, 1], range: [-1, 1] },
    { name: 's', type: 'slide', axis: [0, 1, 0], range: [-1, 1] },
  ]
  const root = buildTree([{ id: 'b2', pos: [0.1, 0.2, 0.3], quatAxis: new THREE.Vector3(0, 1, 0) }])
  const map = buildPoseMap(root, makeRig([{ id: 'b2', parent: null, joints }]))

  it('两关节顺序复合结果与 MuJoCo 一致', () => {
    applyPose(map, { h: 0.5, s: 0.7 })
    const node = map.nodes.get('b2')!
    expectPosClose(node.position, [0.1, 0.814308, 0.635598])
    expect(qdot(node.quaternion, [0.685125, 0.174941, 0.685125, 0.174941])).toBeCloseTo(1, 5)
  })
})

describe('applyPose：多 hinge 声明顺序右乘（MuJoCo 实测真值）', () => {
  // 探针 b3：hinge z 0.4 → hinge x 0.6，rest 单位四元数
  const joints: RigJoint[] = [
    { name: 'a', type: 'hinge', axis: [0, 0, 1], range: [-2, 2] },
    { name: 'b', type: 'hinge', axis: [1, 0, 0], range: [-2, 2] },
  ]
  const root = buildTree([{ id: 'b3', pos: [0.1, 0.2, 0.3] }])
  const map = buildPoseMap(root, makeRig([{ id: 'b3', parent: null, joints }]))

  it('先 z 后 x（顺序不可交换）', () => {
    applyPose(map, { a: 0.4, b: 0.6 })
    const node = map.nodes.get('b3')!
    expectPosClose(node.position, [0.1, 0.2, 0.3])
    expect(qdot(node.quaternion, [0.936293, 0.289629, 0.058711, 0.189796])).toBeCloseTo(1, 5)
  })
})

describe('applyPose：clamp 与缺失关节', () => {
  const joints: RigJoint[] = [{ name: 'h', type: 'hinge', axis: [0, 0, 1], range: [-0.5, 0.5] }]
  const root = buildTree([{ id: 'p', pos: [0, 0, 0] }])
  const map = buildPoseMap(root, makeRig([{ id: 'p', parent: null, joints }]))

  it('越界值 clamp 到 range 上限', () => {
    applyPose(map, { h: 2.0 })
    // Rz(0.5) → wxyz = [cos(0.25), 0, 0, sin(0.25)]
    expect(qdot(map.nodes.get('p')!.quaternion, [Math.cos(0.25), 0, 0, Math.sin(0.25)])).toBeCloseTo(1, 5)
  })

  it('下限同样生效', () => {
    applyPose(map, { h: -9 })
    expect(qdot(map.nodes.get('p')!.quaternion, [Math.cos(0.25), 0, 0, -Math.sin(0.25)])).toBeCloseTo(1, 5)
  })

  it('q 缺失该关节 → 节点保持静止位不动', () => {
    const before = map.nodes.get('p')!.quaternion.clone()
    applyPose(map, {})
    expect(map.nodes.get('p')!.quaternion.angleTo(before)).toBeLessThan(EPS)
  })

  it('多关节 part 部分缺失：缺失项贡献 0（静止位），存在项正常生效', () => {
    // rest q0=Ry(90)，hinge z（缺失）+ slide y 0.7：Ry90 不改变 +y 轴
    // 期望 p0 + Ry90·(0,1,0)·0.7 = (0.1, 0.9, 0.3)
    const root2 = buildTree([{ id: 'q', pos: [0.1, 0.2, 0.3], quatAxis: new THREE.Vector3(0, 1, 0) }])
    const map2 = buildPoseMap(root2, makeRig([
      {
        id: 'q',
        parent: null,
        joints: [
          { name: 'h', type: 'hinge', axis: [0, 0, 1], range: [-1, 1] },
          { name: 's', type: 'slide', axis: [0, 1, 0], range: [-1, 1] },
        ],
      },
    ]))
    applyPose(map2, { s: 0.7 })
    const node = map2.nodes.get('q')!
    expectPosClose(node.position, [0.1, 0.9, 0.3])
    expect(qdot(node.quaternion, RY90)).toBeCloseTo(1, 5)
  })
})

describe('applyPose：pelvis 型 slide（q0=Rx90 时局部 +y 轴映射为世界 +z）', () => {
  const root = buildTree([{ id: 'pelvis', pos: [0, 0, 0.95], quatAxis: new THREE.Vector3(1, 0, 0) }])
  const map = buildPoseMap(root, makeRig([
    { id: 'pelvis', parent: null, joints: [{ name: 'pelvis_ty', type: 'slide', axis: [0, 1, 0], range: [-1, 2] }] },
  ]))

  it('pelvis_ty 上下平移轴：local +y 经 q0 变换后沿 +z', () => {
    applyPose(map, { pelvis_ty: -0.0414 })
    const node = map.nodes.get('pelvis')!
    expectPosClose(node.position, [0, 0, 0.9086])
    expect(qdot(node.quaternion, RX90)).toBeCloseTo(1, 5)
  })
})

describe('buildPoseMap：节点缺失与无关节 part', () => {
  it('rig 引用不存在的节点 / 无关节 part 都不产生驱动条目', () => {
    const root = buildTree([{ id: 'exists', pos: [0, 0, 0] }])
    const map = buildPoseMap(root, makeRig([
      { id: 'exists', parent: null, joints: [] },
      { id: 'ghost', parent: null, joints: [{ name: 'x', type: 'hinge', axis: [0, 0, 1], range: [-1, 1] }] },
    ]))
    expect(map.nodes.size).toBe(1)
    expect(map.entries.length).toBe(0)
    // 对空 map applyPose 不抛错
    expect(() => applyPose(map, { x: 1 })).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// FK 对账（P3 Task 3 核心护栏）：fixture（web/public/data/fk-reference.json，
// 由 pipeline/tools/fk_reference.py 用 MuJoCo mj_forward 导出）是姿态唯一真值。
// vitest 不加载 glb 网格，而是用 rig-meta 层级 + glb JSON chunk 里的节点局部
// 变换（P1 写入的 XML body pos/quat）重建 Object3D 树，applyPose 后与真值比。
// 通过标准：位置差 < 1e-3 m、四元数角差 < 1e-2 rad。
// ---------------------------------------------------------------------------
// vitest（jsdom）下 import.meta.url 非 file 协议，用 cwd（=web/）定位资产
const ASSET = (rel: string) => readFileSync(resolve(process.cwd(), rel))
const glbBuf = ASSET('public/data/models/human.glb')
const rigReal: RigMeta = JSON.parse(ASSET('public/data/models/rig-meta.json').toString('utf8'))
const fkRef: FkReference = JSON.parse(ASSET('public/data/fk-reference.json').toString('utf8'))
const glbNodes = parseGlbNodes(glbBuf)

/** 按 rig-meta 层级 + glb 节点局部变换重建节点树（模拟 GLTFLoader 解析结果） */
function buildRealTree(): Map<string, THREE.Object3D> {
  const root = new THREE.Object3D()
  const nodes = new Map<string, THREE.Object3D>()
  for (const part of rigReal.parts) {
    const def = glbNodes.byName.get(part.id)
    if (!def) throw new Error(`glb 缺少节点 ${part.id}（P1 契约破坏）`)
    const node = new THREE.Object3D()
    node.name = part.id
    node.position.copy(def.pos)
    node.quaternion.copy(def.quat)
    nodes.set(part.id, node)
  }
  for (const part of rigReal.parts) {
    if (part.parent) nodes.get(part.parent)!.add(nodes.get(part.id)!)
    else root.add(nodes.get(part.id)!)
  }
  return nodes
}

describe('P1 契约：rig-meta 层级与 glb 节点层级一致', () => {
  it('80 个 part id 都是 glb 具名节点', () => {
    for (const part of rigReal.parts) {
      expect(glbNodes.byName.has(part.id), `glb 缺少节点 ${part.id}`).toBe(true)
    }
    expect(rigReal.parts.length).toBe(80)
  })

  it('根 part 是 glb 场景根；子 part 是 glb 父节点的具名子节点', () => {
    for (const part of rigReal.parts) {
      if (part.parent === null) {
        expect(glbNodes.rootNames, `根 part ${part.id} 应为场景根`).toContain(part.id)
      } else {
        const parentDef = glbNodes.byName.get(part.parent)
        expect(
          parentDef?.children.includes(part.id),
          `${part.parent} 的 glb 子节点应包含 ${part.id}`,
        ).toBe(true)
      }
    }
  })
})

describe('FK 对账：applyPose 驱动重建树 vs MuJoCo xpos/xquat（3 帧 x 8 body）', () => {
  const FK_POS_TOL = 1e-3
  const FK_QUAT_TOL = 1e-2

  it('checkPoseMap（生产路径）每帧位置差 < 1e-3 m 且四元数角差 < 1e-2 rad', () => {
    const nodes = buildRealTree()
    const root = nodes.get('pelvis')!.parent! // 恒等根
    const map = buildPoseMap(root, rigReal)

    const result = checkPoseMap(map, fkRef)

    console.info(
      `[FK 对账] pass=${result.pass} maxPosErr=${result.maxPosErr.toExponential(3)} m | maxQuatErr=${result.maxQuatErr.toExponential(3)} rad`,
    )
    // 所有参考 body 都必须命中（NaN = rig 缺节点）
    for (const f of result.frames) {
      for (const [bodyId, e] of Object.entries(f.perBody)) {
        expect(Number.isNaN(e.posErr), `参考 body ${bodyId} 未命中`).toBe(false)
      }
    }
    expect(result.maxPosErr).toBeLessThan(FK_POS_TOL)
    expect(result.maxQuatErr).toBeLessThan(FK_QUAT_TOL)
    expect(result.pass).toBe(true)
  })

  it('applyPose 幂等：同 qpos 重复驱动结果不变（无累积漂移）', () => {
    const nodes = buildRealTree()
    const map = buildPoseMap(nodes.get('pelvis')!.parent!, rigReal)
    const q: JointAngles = {}
    fkRef.joints.forEach((name, i) => {
      q[name] = fkRef.frames[1].qpos36[i]
    })
    applyPose(map, q)
    const first = nodes.get('hand_r')!.getWorldPosition(new THREE.Vector3()).clone()
    applyPose(map, q)
    const second = nodes.get('hand_r')!.getWorldPosition(new THREE.Vector3())
    expect(first.distanceTo(second)).toBeLessThan(EPS)
  })

  it('resetPose 后节点回到静止位（对账前后状态可复现）', () => {
    const nodes = buildRealTree()
    const map = buildPoseMap(nodes.get('pelvis')!.parent!, rigReal)
    // femur_r 锚点全 0：hinge 只改四元数；tibia_r 带 slide：位置会变
    const restPos = nodes.get('tibia_r')!.position.clone()
    const restQuat = nodes.get('femur_r')!.quaternion.clone()
    const q: JointAngles = {}
    fkRef.joints.forEach((name, i) => {
      q[name] = fkRef.frames[0].qpos36[i]
    })
    applyPose(map, q)
    expect(nodes.get('femur_r')!.quaternion.angleTo(restQuat)).toBeGreaterThan(EPS)
    expect(nodes.get('tibia_r')!.position.distanceTo(restPos)).toBeGreaterThan(EPS)
    // resetPose（checkPoseMap 内部收尾调用）应把节点还原
    checkPoseMap(map, fkRef)
    expect(nodes.get('tibia_r')!.position.distanceTo(restPos)).toBeLessThan(EPS)
    expect(nodes.get('femur_r')!.quaternion.angleTo(restQuat)).toBeLessThan(EPS)
  })
})
