/**
 * 肌肉材质（对齐参考图的 écorché 质感）。
 *
 * 解剖配色（砖红肌腹 / 米白肌腱）写在几何顶点色里（muscleTube.ts），本模块负责
 * 表面质感：纤维沟槽 bump、湿润清漆高光、绒面 sheen、以及轮廓边缘光。
 *
 * 边缘光用材质内 Fresnel 注入实现，不新增场景灯光——骨骼与皮肤的光照结果
 * 完全不受影响（three 的方向光按场景全局生效，无法只作用于某一图层）。
 */
import * as THREE from 'three'

/** 纤维贴图分辨率（u 绕周向 / v 沿肌肉长度） */
const FIBER_SIZE = 256

let fiberTexture: THREE.CanvasTexture | null = null

/** 确定性伪随机（固定种子，避免每次刷新纹理条纹跳动） */
function createRandom(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0xffffffff
  }
}

/**
 * 程序化肌纤维 bump 贴图：沿 v（肌肉长度）连续的竖向细沟槽，带轻微摆动与疏密变化。
 * 模块级单例，跨 SceneManager 实例复用（与 Draco 解码器同一策略）。
 */
export function getMuscleFiberTexture(): THREE.CanvasTexture {
  if (fiberTexture) return fiberTexture
  const canvas = document.createElement('canvas')
  canvas.width = FIBER_SIZE
  canvas.height = FIBER_SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('肌纤维贴图创建失败：无法获取 2D 画布上下文')
  ctx.fillStyle = '#808080'
  ctx.fillRect(0, 0, FIBER_SIZE, FIBER_SIZE)

  const rand = createRandom(0x5eed)
  for (let x = 0; x < FIBER_SIZE; x += 5) {
    const tone = Math.round(128 + (rand() - 0.5) * 110)
    ctx.strokeStyle = `rgb(${tone},${tone},${tone})`
    ctx.lineWidth = 1.5 + rand() * 2.6
    const wobble = 1 + rand() * 5
    const phase = rand() * Math.PI * 2
    const freq = 0.02 + rand() * 0.03
    ctx.beginPath()
    for (let y = 0; y <= FIBER_SIZE; y += 6) {
      const xx = x + Math.sin(y * freq + phase) * wobble
      if (y === 0) ctx.moveTo(xx, y)
      else ctx.lineTo(xx, y)
    }
    ctx.stroke()
  }

  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.anisotropy = 4
  fiberTexture = tex
  return tex
}

/** 肌纤维材质：每块肌肉一份（激活度逐块染色），贴图/着色器程序共享 */
export function createMuscleMaterial(): THREE.MeshPhysicalMaterial {
  const material = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, // 激活度染色乘子（updateMuscleColors 逐帧写）
    vertexColors: true,
    roughness: 0.42,
    metalness: 0,
    clearcoat: 0.5,
    clearcoatRoughness: 0.35,
    sheen: 0.6,
    sheenColor: new THREE.Color(0xffd2b8),
    sheenRoughness: 0.7,
    bumpMap: getMuscleFiberTexture(),
    bumpScale: 0.002,
  })
  material.name = 'muscle-ecorche'

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRimColor = { value: new THREE.Color(0xffd9c4) }
    shader.uniforms.uRimStrength = { value: 0.55 }
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform vec3 uRimColor;\nuniform float uRimStrength;',
      )
      .replace(
        '#include <opaque_fragment>',
        [
          'float rimFactor = pow( 1.0 - saturate( dot( normalize( normal ), normalize( vViewPosition ) ) ), 3.0 );',
          'outgoingLight += uRimColor * rimFactor * uRimStrength;',
          '#include <opaque_fragment>',
        ].join('\n'),
      )
  }
  return material
}
