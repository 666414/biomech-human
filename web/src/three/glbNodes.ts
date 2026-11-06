/**
 * GLB 字节级解析工具：读取 JSON chunk 的节点局部变换（不依赖 GLTFLoader/WebGL）。
 *
 * 用途：vitest（Node 环境）无法运行 GLTFLoader，FK 对账测试由此读取 P1 导出的
 * 节点变换，按 rig-meta 层级重建 Object3D 树后与 MuJoCo xpos/xquat 真值对比。
 *
 * glb 契约（Step 0 实测）：body 节点名 = XML body id；局部变换写为 glTF 列主序
 * `matrix`（= XML body pos/quat，pelvis 的 Rx(90°) 建模约定 quat 原样保留）；
 * mesh 子节点（<bodyId>__<geom>）无变换字段（几何已在 body 局部系）。
 */
import { Matrix4, Quaternion, Vector3 } from 'three'

const GLB_MAGIC = 0x46546c67 // 'glTF'
const CHUNK_JSON = 0x4e4f534a // 'JSON'

/** glTF node 定义的原始字段（只取解析所需） */
interface GlbNodeDef {
  name?: string
  translation?: [number, number, number]
  /** glTF 四元数为 x,y,z,w（与 three 一致） */
  rotation?: [number, number, number, number]
  scale?: [number, number, number]
  /** 列主序 4x4（P1 导出使用该字段） */
  matrix?: number[]
  children?: number[]
  mesh?: number
  skin?: number
}

/** 单个具名节点的局部变换（three 语义：Quaternion 为 x,y,z,w） */
export interface GlbNodeLocal {
  name: string
  pos: Vector3
  quat: Quaternion
  /** 具名子节点名（含 mesh 子节点，供契约校验过滤） */
  children: string[]
  /** 该节点引用的 mesh 索引（无网格时不填） */
  mesh?: number
  /** 该节点引用的 skin 索引（蒙皮网格才有，供图层契约校验） */
  skin?: number
}

export interface GlbNodes {
  /** 按文件出现顺序的具名节点 */
  locals: GlbNodeLocal[]
  byName: Map<string, GlbNodeLocal>
  /** glTF 场景根节点的名字 */
  rootNames: string[]
}

/** 解析 GLB buffer 的 JSON chunk，提取每个具名节点的局部变换与层级 */
export function parseGlbNodes(data: ArrayBuffer | Uint8Array): GlbNodes {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.byteLength < 20 || view.getUint32(0, true) !== GLB_MAGIC) {
    throw new Error('不是 GLB 文件（magic 不符）')
  }

  let json: { nodes?: GlbNodeDef[]; scenes?: Array<{ nodes?: number[] }> } | null = null
  let off = 12
  while (off + 8 <= bytes.byteLength) {
    const len = view.getUint32(off, true)
    const type = view.getUint32(off + 4, true)
    if (type === CHUNK_JSON) {
      const text = new TextDecoder('utf8').decode(bytes.subarray(off + 8, off + 8 + len))
      json = JSON.parse(text) as { nodes?: GlbNodeDef[]; scenes?: Array<{ nodes?: number[] }> }
      break
    }
    off += 8 + len
  }
  if (!json?.nodes) throw new Error('GLB 缺少 JSON chunk 或 nodes 定义')

  const defs = json.nodes
  const locals: GlbNodeLocal[] = []
  const byName = new Map<string, GlbNodeLocal>()

  for (const def of defs) {
    if (def.name === undefined) continue
    const local = decompose(def)
    if (def.mesh !== undefined) local.mesh = def.mesh
    if (def.skin !== undefined) local.skin = def.skin
    byName.set(local.name, local)
    locals.push(local)
    def.children?.forEach((childIdx) => {
      const childName = defs[childIdx]?.name
      if (childName !== undefined) local.children.push(childName)
    })
  }

  const rootNames = (json.scenes?.[0]?.nodes ?? [])
    .map((i) => defs[i]?.name)
    .filter((n): n is string => n !== undefined)

  return { locals, byName, rootNames }
}

/** 把 glTF 节点定义归一化为 pos + quat（matrix 与 TRS 两种写法都支持） */
function decompose(def: GlbNodeDef): GlbNodeLocal {
  const pos = new Vector3()
  const quat = new Quaternion()
  if (def.matrix) {
    // glTF 与 three 的 Matrix4 均为列主序，可直接 fromArray
    const m = new Matrix4().fromArray(def.matrix)
    const scale = new Vector3()
    m.decompose(pos, quat, scale)
  } else {
    if (def.translation) pos.fromArray(def.translation)
    if (def.rotation) quat.fromArray(def.rotation)
  }
  return { name: def.name ?? '', pos, quat, children: [] }
}
