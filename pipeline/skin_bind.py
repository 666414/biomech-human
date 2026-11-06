"""权重分配：输出顶点、权重、IBM 为 raw .bin + meta.json，供 Node.js 组装带 skinning 的 glb。

三个关键约定（都踩过坑，改动前先读注释）：

1. 朝向对齐：源体表 VH_M_skin 是 Y-up、**面朝 +z**（鼻尖、脚尖实测均在 +z 侧）、左右轴 +x；
   骨骼（pelvis 局部系）面朝 +x、左右轴 +y（humerus_l 在 +y，toes 在 calcn 的 +x 前方）。
   Rx(90°) 只是把 Y-up 立成 Z-up，绕 z 的旋转才决定「正脸朝哪」：Rx(90°) 后源 +z 落到世界 -y，
   必须再绕 z 转 **+90°** 才能让 +z → +x（面朝前）、源 +x → +y（左右手不互换）。
   曾误按「面朝 +y」写成 -90°，结果皮肤整体转 180°：后脑对着颅骨、脚跟对着脚趾、左右手互换。

2. 线段归属：线段 = 父 body 原点 → 本 body 原点，它代表「近端关节带动的那段骨头」，
   因此权重应归**近端 body**（例：humerus→ulna 线段是上臂，须归 humerus，不能归 ulna，
   否则弯肘会把上臂一起转走）。末端 body（无子 body，如 head_neck 承载头颅）例外归自己。

3. 权重衰减：按「顶点到骨骼线段距离 + d0」的幂律取 top-4。不能用「到关节原点距离 + 窄高斯」：
   体表离关节原点普遍 0.2~0.3 m，原点距离差异很小，窄高斯会把相邻顶点分给完全不同的关节集合，
   LBS 混合后整块皮肤被撕开（实测肩外展帧边被拉长 0.21 m）。

另外两处几何修正：
- A-pose 姿态归位：源体表是 A-pose（手臂外展 ~29°、双脚站距 ±0.21），骨骼是手臂自然下垂
  （±0.17）、双脚 ±0.08。按「皮肤肢体轴线与骨骼轴线在 y-z 平面的交点」为枢轴做整体旋转，
  交点法可让肢体的近端与远端同时对齐骨骼。权重在归位前计算（A-pose 下肢体与躯干分得开）。
- 手臂门控：A-pose 下手臂内缘与躯干只隔 ~3 cm，且骨骼手臂贴在体表，纯距离会把侧胸/臀部判给手臂。
  在网格表面上做多源测地距离，比较「离手臂种子近」还是「离躯干种子近」，边界自然落在腋窝/腹股沟。
  （测地图必须双向建边：去重时端点被排序成 min→max，只存单向会让大量顶点不可达、门控退化为全放行。）
"""
import json, os, struct
import numpy as np
import trimesh

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
GLB_IN = os.path.join(REPO, 'pipeline', 'out', 'fullbody', 'human.glb')
SKIN_SRC = os.path.join(REPO, 'pipeline', 'skin_full_male.glb')
OUT_DIR = os.path.join(REPO, 'pipeline', 'out', 'fullbody')

# 1. 读 human.glb 节点 + 算静止位 world matrix
with open(GLB_IN, 'rb') as f:
    data = f.read()
jlen = struct.unpack('<I', data[12:16])[0]
glb = json.loads(data[20:20+jlen].decode('utf8'))

nodes = glb['nodes']
children_map = {i: n.get('children', []) for i, n in enumerate(nodes)}

def compute_world_matrices():
    world = [None] * len(nodes)
    def walk(idx, pw):
        n = nodes[idx]
        local = np.array(n.get('matrix', [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]), dtype=np.float64)
        local = local.reshape(4, 4).T
        world[idx] = pw @ local
        for c in children_map[idx]: walk(c, world[idx])
    walk(0, np.eye(4))
    return world

world_mats = compute_world_matrices()
body_indices = [i for i, n in enumerate(nodes) if n.get('name') and '__' not in n.get('name','') and not n.get('mesh')]
body_names = [nodes[i]['name'] for i in body_indices]
body_pos = {nd: k for k, nd in enumerate(body_indices)}
body_set = set(body_indices)

body_origins = np.array([world_mats[i][:3, 3] for i in body_indices], dtype=np.float64)
inverse_bind_mats = np.array([np.linalg.inv(world_mats[i]) for i in body_indices])

# 骨骼线段：父 body 原点 → 本 body 原点。根 body（pelvis）退化为点。
node_parent = {}
for i, ch in children_map.items():
    for c in ch:
        node_parent[c] = i

def nearest_body_parent(node_idx):
    p = node_parent.get(node_idx)
    while p is not None and p not in body_set:
        p = node_parent.get(p)
    return p

seg_a = np.array(
    [world_mats[nearest_body_parent(i)][:3, 3] if nearest_body_parent(i) is not None else world_mats[i][:3, 3]
     for i in body_indices],
    dtype=np.float64,
)
seg_b = body_origins.copy()
seg_ab = seg_b - seg_a
seg_len2 = (seg_ab ** 2).sum(axis=1)

# 线段归属：近端 body（末端 body 归自己，见文件头约定 2）
def has_child_body(node_idx):
    return any(c in body_set for c in children_map.get(node_idx, []))

seg_joint = np.array([
    body_pos[nearest_body_parent(i)] if (nearest_body_parent(i) is not None and has_child_body(i)) else body_pos[i]
    for i in body_indices
], dtype=np.int32)

print(f'body joints: {len(body_indices)} ({body_names[:5]}...)')

# 2. 皮肤对齐：Y-up 立起来 → 缩放到身高 → 落地 → 绕 z 转 -90° 与骨骼同朝向 → pelvis local
src = trimesh.load(SKIN_SRC, force='scene', process=False)
skin = src.geometry['VH_M_skin'].copy()
skin.apply_transform(trimesh.transformations.rotation_matrix(np.pi/2, [1,0,0]))
skin.apply_scale(1.75 / skin.extents[2])
c = skin.centroid
skin.apply_transform(trimesh.transformations.translation_matrix(np.array([-c[0], -c[1], 0.95 - c[2]])))
# 面朝 +z / 左右 +x（源）→ 面朝 +x / 左右 +y（与骨骼一致）：绕 z 转 +90°
skin.apply_transform(trimesh.transformations.rotation_matrix(np.pi/2, [0,0,1]))
verts_world = np.asarray(skin.vertices, dtype=np.float64)
# 足底贴到骨骼足部底面（glb 世界包围盒 zmin = 0.013）
verts_world[:, 2] += 0.013 - verts_world[:, 2].min()

faces = skin.faces.astype(np.uint32)
print(f'skin verts: {len(verts_world)}, faces: {len(faces)}  bbox={np.round(verts_world.min(0),3)}..{np.round(verts_world.max(0),3)}')

# 3. 权重：顶点 → 骨骼线段距离 → 幂律衰减 → top-4（先按线段，再折叠到关节）
TOP_K = 4
DIST_FLOOR = 0.04
POWER = 3

dists = np.empty((len(verts_world), len(body_indices)), dtype=np.float64)
CHUNK = 8192
for s in range(0, len(verts_world), CHUNK):
    e = min(s + CHUNK, len(verts_world))
    p = verts_world[s:e][:, np.newaxis, :] - seg_a[np.newaxis, :, :]
    t = np.einsum('nkj,kj->nk', p, seg_ab)
    t = np.divide(t, seg_len2, out=np.zeros_like(t), where=seg_len2 > 1e-12)
    t = np.clip(t, 0.0, 1.0)
    closest = seg_a[np.newaxis, :, :] + t[:, :, np.newaxis] * seg_ab[np.newaxis, :, :]
    dists[s:e] = np.linalg.norm(verts_world[s:e][:, np.newaxis, :] - closest, axis=2)

def subtree(root_name):
    nd = body_indices[body_names.index(root_name)]
    out, stack = [], [nd]
    while stack:
        i = stack.pop()
        if i in body_set:
            out.append(body_pos[i])
        stack.extend(children_map.get(i, []))
    return np.array(sorted(out))

arm_L = subtree('humerus_l')
arm_R = subtree('humerus_r')

# 手臂门控（网格测地距离）：A-pose 下手臂内缘与躯干仅隔 ~3 cm，且骨骼手臂贴在体表，
# 纯欧氏距离会把侧胸、臀部判给手臂骨（实测 17% 躯干顶点被手臂主导）。改在网格表面
# 上比较多源测地距离「到手臂种子近」还是「到躯干种子近」，边界自然落在腋窝/腹股沟。
def build_mesh_graph():
    e = np.vstack([faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]]).astype(np.int64)
    e = np.unique(np.sort(e, axis=1), axis=0)
    # 去重后端点已被排序（min→max），必须补上反向边，否则图是单向的：
    # Dijkstra 只能沿顶点索引增大的方向传播，低索引区域从种子不可达 → 距离 inf。
    e = np.vstack([e, e[:, ::-1]])
    lengths = np.linalg.norm(verts_world[e[:, 0]] - verts_world[e[:, 1]], axis=1)
    order = np.argsort(e[:, 0], kind='stable')
    e, lengths = e[order], lengths[order]
    indptr = np.zeros(len(verts_world) + 1, dtype=np.int64)
    np.add.at(indptr, e[:, 0] + 1, 1)
    indptr = np.cumsum(indptr)
    return indptr, e[:, 1].copy(), lengths

graph_indptr, graph_indices, graph_lengths = build_mesh_graph()

def geodesic_from(seeds):
    dist = np.full(len(verts_world), np.inf)
    heap = []
    for s in seeds:
        dist[s] = 0.0
        heap.append((0.0, int(s)))
    import heapq
    heapq.heapify(heap)
    while heap:
        d, u = heapq.heappop(heap)
        if d > dist[u]:
            continue
        for k in range(graph_indptr[u], graph_indptr[u + 1]):
            v = graph_indices[k]
            nd = d + graph_lengths[k]
            if nd < dist[v]:
                dist[v] = nd
                heapq.heappush(heap, (nd, int(v)))
    return dist

y, z = verts_world[:, 1], verts_world[:, 2]
d_torso = geodesic_from(np.where((np.abs(y) < 0.13) & (z > 0.85) & (z < 1.50))[0])
d_arm_L = geodesic_from(np.where((y > 0.33) & (z > 0.85))[0])
d_arm_R = geodesic_from(np.where((y < -0.33) & (z > 0.85))[0])

def soft_gate(d_arm):
    g = 0.5 * (1.0 + np.tanh((d_torso - d_arm) / 0.06))
    return np.where(np.isnan(g), 1.0, g)

gate_L, gate_R = soft_gate(d_arm_L), soft_gate(d_arm_R)
print(f'arm gate: L>0.5 {np.mean(gate_L > 0.5):.1%}, R>0.5 {np.mean(gate_R > 0.5):.1%}')

# 折叠到关节（同一关节的多条线段取最近），再进幂律
joint_d = np.full((len(verts_world), len(body_indices)), np.inf)
for j in range(len(body_indices)):
    segs = np.where(seg_joint == j)[0]
    if len(segs):
        joint_d[:, j] = dists[:, segs].min(axis=1)
inv = 1.0 / (joint_d + DIST_FLOOR) ** POWER
# 门控作用在权重上（不是距离上）：<1 即压低手臂骨对躯干顶点的吸附
inv[:, arm_L] *= gate_L[:, np.newaxis]
inv[:, arm_R] *= gate_R[:, np.newaxis]
topk_idx = np.argsort(inv, axis=1)[:, -TOP_K:][:, ::-1]
topk_w = np.take_along_axis(inv, topk_idx, axis=1)
weights = topk_w / topk_w.sum(axis=1, keepdims=True)

print(f'weight stats: top1={weights[:,0].mean():.3f}, top2={weights[:,1].mean():.3f}, '
      f'top4={weights[:,3].mean():.3f}')

# 4. 姿态归位（A-pose → 骨骼静止位）：手臂、腿各绕 y-z 平面交点旋转
def chain_weight(chain):
    return np.where(np.isin(topk_idx, chain), weights, 0.0).sum(axis=1)

def limb_correction(root_name, distal_name, zmin=None):
    chain = subtree(root_name)
    s = chain_weight(chain)
    sel = s > 0.5
    if zmin is not None:
        sel &= verts_world[:, 2] > zmin
    cloud = verts_world[sel]
    zs = cloud[:, 2]
    hi = cloud[zs >= np.percentile(zs, 98)].mean(axis=0)   # 近端（上）
    lo = cloud[zs <= np.percentile(zs, 2)].mean(axis=0)    # 远端（下）
    up = np.array([lo[1] - hi[1], lo[2] - hi[2]])
    up = up / np.linalg.norm(up)
    root_o = body_origins[body_pos[body_indices[body_names.index(root_name)]]]
    distal_o = body_origins[body_pos[body_indices[body_names.index(distal_name)]]]
    down = np.array([distal_o[1] - root_o[1], distal_o[2] - root_o[2]])
    down = down / np.linalg.norm(down)
    # y-z 平面两条直线交点作为枢轴（近端/远端同时对齐）
    (y1, z1), (y2, z2) = (hi[1], hi[2]), (lo[1], lo[2])
    (y3, z3), (y4, z4) = (root_o[1], root_o[2]), (distal_o[1], distal_o[2])
    den = (y1 - y2) * (z3 - z4) - (z1 - z2) * (y3 - y4)
    if abs(den) < 1e-9:
        py, pz = float(hi[1]), float(hi[2])
    else:
        tt = ((y1 - y3) * (z3 - z4) - (z1 - z3) * (y3 - y4)) / den
        py, pz = y1 + tt * (y2 - y1), z1 + tt * (z2 - z1)
    theta = np.arctan2(up[0] * down[1] - up[1] * down[0], up[0] * down[0] + up[1] * down[1])
    cos, sin = np.cos(theta), np.sin(theta)
    R = np.array([[1.0, 0.0, 0.0], [0.0, cos, -sin], [0.0, sin, cos]])
    t = np.array([0.0, py, pz])
    moved = (R @ verts_world.T).T + (t - R @ t)
    print(f'  pose-fix {root_name}: n={sel.sum()} pivot_yz=({py:.3f},{pz:.3f}) theta={np.degrees(theta):.1f}deg')
    return verts_world + s[:, np.newaxis] * (moved - verts_world)

print('pose correction (A-pose → 骨骼静止位):')
verts_world = limb_correction('humerus_l', 'hand_l')
verts_world = limb_correction('humerus_r', 'hand_r')
verts_world = limb_correction('femur_l', 'calcn_l', zmin=0.25)
verts_world = limb_correction('femur_r', 'calcn_r', zmin=0.25)
print(f'  after: bbox={np.round(verts_world.min(0),3)}..{np.round(verts_world.max(0),3)}')

# 5. 世界 → pelvis local（skin_mesh 节点挂在 pelvis 下）
R_p = trimesh.transformations.rotation_matrix(np.pi/2, [1,0,0])
T_p = trimesh.transformations.translation_matrix([0, 0, 0.95])
M_pelvis = T_p @ R_p
verts_local = (np.linalg.inv(M_pelvis) @ np.hstack([verts_world, np.ones((len(verts_world), 1))]).T).T[:, :3]
verts_local = verts_local.astype(np.float32)

joints_u16 = topk_idx.astype(np.uint16)
weights_f32 = weights.astype(np.float32)

# 6. 写 raw 文件 + meta.json
os.makedirs(OUT_DIR, exist_ok=True)
def w(path, arr):
    with open(path, 'wb') as f: f.write(arr.tobytes())
w(os.path.join(OUT_DIR, 'skin_vertices.bin'), verts_local)
w(os.path.join(OUT_DIR, 'skin_faces.bin'), faces)
w(os.path.join(OUT_DIR, 'skin_joints.bin'), joints_u16)
w(os.path.join(OUT_DIR, 'skin_weights.bin'), weights_f32)
# glTF 的 MAT4 是列主序：numpy 默认按行主序落地，必须转置后再写，
# 否则 three.js 读到的是 IBM 的转置，蒙皮会整体错位（实测偏差达 1.8m）
w(
    os.path.join(OUT_DIR, 'skin_ibm.bin'),
    inverse_bind_mats.transpose(0, 2, 1).flatten().astype(np.float32),
)

meta = {
    'vertexCount': len(verts_local),
    'faceCount': len(faces),
    'jointCount': len(body_indices),
    'topK': TOP_K,
    'jointIndices': [int(x) for x in body_indices],  # 关节在 human.glb 里的节点 index
    'jointNames': body_names,
    'vertexBytes': verts_local.nbytes,
    'faceBytes': faces.nbytes,
    'jointsBytes': joints_u16.nbytes,
    'weightsBytes': weights_f32.nbytes,
    'ibmBytes': inverse_bind_mats.nbytes,
}
with open(os.path.join(OUT_DIR, 'skin_bind_meta.json'), 'w', encoding='utf-8') as f:
    json.dump(meta, f, indent=2)

total = meta['vertexBytes'] + meta['faceBytes'] + meta['jointsBytes'] + meta['weightsBytes'] + meta['ibmBytes']
print(f'\n权重数据已导出: 总计 {total/1024:.0f} KB')
print('  skin_vertices.bin / skin_faces.bin / skin_joints.bin / skin_weights.bin / skin_ibm.bin')
print('  skin_bind_meta.json')
