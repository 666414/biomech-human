/**
 * 蒙皮网格重绑：修正「皮肤留在网格局部空间」的显示错位。
 *
 * 故障链（已用 three r187 实测复现）：
 * 1. GLTFLoader 一律用**单位阵**绑定蒙皮网格（GLTFLoader.js `mesh.bind(skeleton, _identityMatrix)`）；
 * 2. SkinnedMesh 默认 AttachedBindMode，每帧把 bindMatrixInverse 设为 inv(mesh.matrixWorld)；
 * 3. 着色器 out = bindMatrixInverse · Σ w(boneWorld · IBM) · bindMatrix · p，两项互相抵消后
 *    蒙皮结果直接落在「网格局部坐标」——只有当网格累计世界变换是单位阵时它才等于世界坐标。
 *
 * 本模型的完整体表节点 skin_mesh 挂在 pelvis 下（局部变换含 T(0,0,0.95)·Rx(90°)），
 * 抵消后顶点被直接当成世界坐标使用，而 pelvis 局部空间里人体是躺卧朝向 →
 * 屏幕上是横躺/拉伸的半透明网格，与直立的骨骼完全不对位。
 *
 * 修复：按网格世界矩阵重绑一次（bindMatrix = matrixWorld），让网格变换参与蒙皮链路。
 * 必须在姿态写入之前调用（此时骨骼仍处于模型静止位），否则 bind 基准会带上当前姿态。
 */
import type * as THREE from 'three'

export function rebindSkinnedMeshes(root: THREE.Object3D): number {
  // bind 需要 matrixWorld 已是最新（GLTFLoader 解析完只保证局部变换已写入）
  root.updateMatrixWorld(true)
  let count = 0
  root.traverse((obj) => {
    const mesh = obj as THREE.SkinnedMesh
    if (!mesh.isSkinnedMesh) return
    mesh.bind(mesh.skeleton, mesh.matrixWorld)
    count += 1
  })
  return count
}
