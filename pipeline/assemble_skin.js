/**
 * 组装带 skinning 的 glb：读 human.glb（仅骨骼）+ skin_bind.py 的权重数据 →
 * 追加 bufferView/accessor/skin/mesh/node，并把 skin_mesh 记入 rig-meta.attachments。
 *
 * 直接用 Node.js Buffer 拼 GLB（头 12B + JSON chunk + BIN chunk），
 * 绕开 pygltflib 读 trimesh 产物失败的兼容问题。
 *
 * 前置：先跑 convert_model.py 再跑 skin_bind.py。本脚本会就地改写 human.glb，
 * 重复执行会叠加节点，因此检测到已有 skin_mesh 时直接报错退出。
 */
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const OUT = path.join(REPO, 'pipeline', 'out', 'fullbody');
const GLB_PATH = path.join(OUT, 'human.glb');
const META = JSON.parse(fs.readFileSync(path.join(OUT, 'skin_bind_meta.json'), 'utf8'));

const align4 = (x) => (x + 3) & ~3;

// === 1. 读原始 human.glb ===
const raw = fs.readFileSync(GLB_PATH);
const version = raw.readUInt32LE(4);
const jLen = raw.readUInt32LE(12);
const gltf = JSON.parse(raw.slice(20, 20 + jLen).toString('utf8'));
// BIN chunk 紧跟在 JSON chunk 之后（+8 是它自己的 chunk header）
const binaryChunk = raw.slice(20 + jLen + 8);

if ((gltf.skins || []).length || gltf.nodes.some((n) => n.name === 'skin_mesh')) {
  throw new Error('human.glb 已含 skinning，请先重跑 convert_model.py 再执行本脚本');
}
console.log(`GLB v${version}, json=${jLen}B, binary=${binaryChunk.length}B`);

// === 2. 读权重数据（均由 skin_bind.py 产出）===
const vertsBuf = fs.readFileSync(path.join(OUT, 'skin_vertices.bin')); // float32 * N * 3
const facesBuf = fs.readFileSync(path.join(OUT, 'skin_faces.bin')); // uint32  * N * 3
const jointsBuf = fs.readFileSync(path.join(OUT, 'skin_joints.bin')); // uint16  * N * 4
const weightsBuf = fs.readFileSync(path.join(OUT, 'skin_weights.bin')); // float32 * N * 4
const ibmBuf = fs.readFileSync(path.join(OUT, 'skin_ibm.bin')); // float32 * 80 * 16

const N = META.vertexCount;
const F = META.faceCount;
if (vertsBuf.length !== N * 12 || jointsBuf.length !== N * 8 || weightsBuf.length !== N * 16) {
  throw new Error('权重数据与 meta.vertexCount 不匹配，请重跑 skin_bind.py');
}

// === 3. 追加到 BIN chunk 尾部（按 4 字节对齐）===
const offsets = {};
let cursor = binaryChunk.length;
for (const [key, buf] of Object.entries({
  vertices: vertsBuf,
  faces: facesBuf,
  joints: jointsBuf,
  weights: weightsBuf,
  ibm: ibmBuf,
})) {
  offsets[key] = cursor;
  cursor += align4(buf.length);
}

const newBinary = Buffer.alloc(cursor);
binaryChunk.copy(newBinary, 0);
vertsBuf.copy(newBinary, offsets.vertices);
facesBuf.copy(newBinary, offsets.faces);
jointsBuf.copy(newBinary, offsets.joints);
weightsBuf.copy(newBinary, offsets.weights);
ibmBuf.copy(newBinary, offsets.ibm);
console.log(`binary: ${binaryChunk.length}B → ${newBinary.length}B (+${newBinary.length - binaryChunk.length}B)`);

gltf.buffers = gltf.buffers || [{ byteLength: binaryChunk.length }];
gltf.buffers[0].byteLength = newBinary.length;

// === 4. bufferViews ===
function addBufferView(offset, length, target, stride) {
  const bv = { buffer: 0, byteOffset: offset, byteLength: length };
  if (target !== undefined) bv.target = target;
  if (stride !== undefined) bv.byteStride = stride;
  gltf.bufferViews.push(bv);
  return gltf.bufferViews.length - 1;
}

const BV_VERTS = addBufferView(offsets.vertices, vertsBuf.length, 34962); // ARRAY_BUFFER
const BV_FACES = addBufferView(offsets.faces, facesBuf.length, 34963); // ELEMENT_ARRAY_BUFFER
const BV_JOINTS = addBufferView(offsets.joints, jointsBuf.length, 34962, 8);
const BV_WEIGHTS = addBufferView(offsets.weights, weightsBuf.length, 34962, 16);
const BV_IBM = addBufferView(offsets.ibm, ibmBuf.length);

// === 5. accessors ===
function addAccessor(bufferView, type, componentType, count, min, max) {
  const a = { bufferView, componentType, count, type };
  if (min !== undefined) a.min = min;
  if (max !== undefined) a.max = max;
  gltf.accessors.push(a);
  return gltf.accessors.length - 1;
}

// POSITION 的 min/max 是 glTF 必填项，从顶点数据算
const posMin = [Infinity, Infinity, Infinity];
const posMax = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < N; i++) {
  for (let c = 0; c < 3; c++) {
    const v = vertsBuf.readFloatLE(i * 12 + c * 4);
    if (v < posMin[c]) posMin[c] = v;
    if (v > posMax[c]) posMax[c] = v;
  }
}

const AC_VERTS = addAccessor(BV_VERTS, 'VEC3', 5126, N, posMin, posMax);
const AC_FACES = addAccessor(BV_FACES, 'SCALAR', 5125, F * 3); // UNSIGNED_INT
const AC_JOINTS = addAccessor(BV_JOINTS, 'VEC4', 5123, N); // UNSIGNED_SHORT
const AC_WEIGHTS = addAccessor(BV_WEIGHTS, 'VEC4', 5126, N); // FLOAT
const AC_IBM = addAccessor(BV_IBM, 'MAT4', 5126, META.jointCount);

// === 6. skin ===
gltf.skins = gltf.skins || [];
gltf.skins.push({
  joints: META.jointIndices, // body 节点在 gltf.nodes 里的 index
  inverseBindMatrices: AC_IBM,
  skeleton: 0, // pelvis 是根关节
});
const skinIdx = gltf.skins.length - 1;

// === 7. material + mesh ===
gltf.materials = gltf.materials || [];
gltf.materials.push({
  name: 'skin_material',
  pbrMetallicRoughness: {
    baseColorFactor: [0.85, 0.7, 0.55, 0.35],
    roughnessFactor: 0.95,
    metallicFactor: 0.0,
  },
  doubleSided: true,
  alphaMode: 'BLEND',
});

gltf.meshes = gltf.meshes || [];
gltf.meshes.push({
  name: 'skin_mesh',
  primitives: [
    {
      attributes: { POSITION: AC_VERTS, JOINTS_0: AC_JOINTS, WEIGHTS_0: AC_WEIGHTS },
      indices: AC_FACES,
      material: gltf.materials.length - 1,
      mode: 4, // TRIANGLES
    },
  ],
});
const meshIdx = gltf.meshes.length - 1;

// === 8. node：skin_mesh 挂到 pelvis 下（顶点已换算到 pelvis local 空间）===
if (gltf.nodes[0].name !== 'pelvis') throw new Error(`根节点应为 pelvis，实际 ${gltf.nodes[0].name}`);
const nodeIdx = gltf.nodes.length;
gltf.nodes.push({ name: 'skin_mesh', mesh: meshIdx, skin: skinIdx });
gltf.nodes[0].children = gltf.nodes[0].children || [];
gltf.nodes[0].children.push(nodeIdx);
console.log(`skin=${skinIdx} mesh=${meshIdx} node=${nodeIdx}（parent=pelvis）, joints=${META.jointCount}`);

// === 9. rig-meta 记入附件（前端分层控件据此把该网格归到 skin 图层）===
const RIG_PATH = path.join(OUT, 'rig-meta.json');
const rig = JSON.parse(fs.readFileSync(RIG_PATH, 'utf8'));
rig.attachments = [
  { id: 'skin_mesh', parent: 'pelvis', group: 'skin', names: { en: 'full skin', zh: '完整体表' } },
];
fs.writeFileSync(RIG_PATH, JSON.stringify(rig, null, 1));

// === 10. 写 GLB ===
const jBuf = Buffer.from(JSON.stringify(gltf), 'utf8');
const jPad = Buffer.alloc(align4(jBuf.length) - jBuf.length, 0x20); // JSON chunk 用空格填充
const jsonChunkLen = jBuf.length + jPad.length;

const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0); // magic "glTF"
header.writeUInt32LE(2, 4); // version
header.writeUInt32LE(20 + jsonChunkLen + 8 + newBinary.length, 8);

const jHeader = Buffer.alloc(8);
jHeader.writeUInt32LE(jsonChunkLen, 0);
jHeader.writeUInt32LE(0x4e4f534a, 4); // "JSON"

const bHeader = Buffer.alloc(8);
bHeader.writeUInt32LE(newBinary.length, 0);
bHeader.writeUInt32LE(0x004e4942, 4); // "BIN\0"

const out = Buffer.concat([header, jHeader, jBuf, jPad, bHeader, newBinary]);
fs.writeFileSync(GLB_PATH, out);
console.log(`输出 ${GLB_PATH}: ${out.length}B`);
