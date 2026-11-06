// @vitest-environment node
/**
 * 蒙皮重绑回归（皮肤显示错位故障）。
 *
 * 故障链：GLTFLoader 用单位阵绑蒙皮网格 → SkinnedMesh 的 AttachedBindMode 每帧把
 * bindMatrixInverse 设为 inv(matrixWorld) → 网格世界变换在着色器里被抵消，蒙皮结果
 * 直接落到网格局部坐标。本模型 skin_mesh 挂在 pelvis（T(0,0,0.95)·Rx90）下，
 * 于是皮肤留在 pelvis 局部空间（人体在该空间是躺卧朝向），屏幕上是横躺的网格。
 *
 * 这里用最小场景复刻同一结构（骨骼带 Rx90 + 网格是骨骼子节点），断言重绑前后
 * 蒙皮世界坐标的变化，防止后续移除 rebindSkinnedMeshes 调用。
 */
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { rebindSkinnedMeshes } from '../three/skinBind'

/** 复刻模型结构：pelvis 骨骼（T(0,0,0.95)·Rx90）下挂 1 个蒙皮网格，网格局部顶点沿 +y（躺卧） */
function buildScene() {
  const root = new THREE.Group()
  const pelvis = new THREE.Bone()
  pelvis.name = 'pelvis'
  pelvis.position.set(0, 0, 0.95)
  pelvis.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2)
  root.add(pelvis)

  const geom = new THREE.BufferGeometry()
  // 局部坐标：z≈0，y 从 -0.9（脚）到 0.85（头），即 pelvis 局部空间里的躺卧人体
  geom.setAttribute('position', new THREE.Float32BufferAttribute([0, -0.9, 0, 0, 0.85, 0], 3))
  geom.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0], 4))
  geom.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0], 4))

  const mesh = new THREE.SkinnedMesh(geom, new THREE.MeshBasicMaterial())
  mesh.name = 'skin_mesh'
  pelvis.add(mesh)

  root.updateMatrixWorld(true)
  const skeleton = new THREE.Skeleton([pelvis])
  skeleton.calculateInverses()
  // 模拟 GLTFLoader：一律用单位阵绑定；渲染循环每帧调用 updateMatrixWorld，
  // AttachedBindMode 会把 bindMatrixInverse 刷成 inv(matrixWorld)
  mesh.bind(skeleton, new THREE.Matrix4())
  mesh.updateMatrixWorld(true)
  return { root, pelvis, mesh }
}

/** 蒙皮后的世界坐标（等价渲染链路：applyBoneTransform → matrixWorld） */
function skinnedWorld(mesh: THREE.SkinnedMesh, index: number): THREE.Vector3 {
  const v = new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position as THREE.BufferAttribute, index)
  mesh.applyBoneTransform(index, v)
  return v.applyMatrix4(mesh.matrixWorld)
}

describe('蒙皮网格重绑（皮肤显示错位修复）', () => {
  it('单位阵绑定 + 非单位父变换 → 顶点停在网格局部空间（复现躺卧故障）', () => {
    const { mesh } = buildScene()
    // 顶点 (0, -0.9, 0) 被当成世界坐标 → 掉在 y=−0.9、z≈0 的地面附近（躺卧）
    const p = skinnedWorld(mesh, 0)
    expect(p.y).toBeCloseTo(-0.9, 5)
    expect(p.z).toBeCloseTo(0, 5)
  })

  it('重绑后顶点回到骨骼世界坐标（直立）', () => {
    const { root, mesh } = buildScene()
    rebindSkinnedMeshes(root)
    // pelvis 世界变换 Rx90：局部 y=−0.9 → 世界 z≈0.05（脚），y=0.85 → z≈1.80（头）
    expect(skinnedWorld(mesh, 0).z).toBeCloseTo(0.05, 5)
    expect(skinnedWorld(mesh, 1).z).toBeCloseTo(1.8, 5)
    // 重绑后 bindMatrix 应等于网格世界矩阵（不再是单位阵，平移列 z=0.95）
    mesh.updateMatrixWorld(true)
    expect(mesh.bindMatrix.elements[14]).toBeCloseTo(0.95, 5)
  })

  it('重绑后皮肤继续跟随骨骼运动', () => {
    const { root, pelvis, mesh } = buildScene()
    rebindSkinnedMeshes(root)
    const before = skinnedWorld(mesh, 1).clone()
    pelvis.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.3))
    root.updateMatrixWorld(true)
    const after = skinnedWorld(mesh, 1)
    expect(after.distanceTo(before)).toBeGreaterThan(0.1)
  })
})
