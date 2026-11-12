"""皮肤-骨骼包络配准（P5 修复：块状骨骼与 NIH 体表局部几何不匹配）。

背景：MS-Human-700 的块状骨骼网格（胸椎/肋骨/手/颅骨）相对 NIH 真实体表
系统性穿出 30~95 mm（2026-11-12 线上实测 + 逐 body 量化审计）。
策略「各退一半」由 pipeline/tools/skin_envelope_v5.py 离线迭代得出：

- **骨骼侧**：逐 mesh 绕 body 原点收缩（躯干/四肢 0.88、手部 0.72），
  缩放表为 `pipeline/bone_fit.json`，由 `mesh_assembler.assemble` 在几何
  transform 上前乘体坐标系缩放阵实现——**不动 body 节点层级与关节语义**，
  FK 对账（?fkcheck=1）只比较节点世界位姿，不受网格顶点变化影响；
- **皮肤侧**（本模块，在 skin_bind.py 的 A-pose 归位之后调用）：
  1. 头部区域（z ≥ 1.50，smoothstep 过渡）沿 -x 后移 40mm——颅骨与皮肤头部
     是位置错配（构建期叠图 ov_head.png 即可见），平移比膨胀自然；
  2. 标量膨胀场兜底残余穿出：对仍在皮肤外的骨骼表面采样点，在其皮肤最近点
     生成外推需求（幅度=穿透深度+margin），高斯 max 场摊到周围顶点，
     沿各自原始法向外推，单顶点累计封顶 20mm。

调用方式：`apply_skin_fit(verts_world, faces, GLB_IN)`——world 系进、world 系出。
"""
import json
import struct

import numpy as np
import trimesh
from scipy.spatial import cKDTree
from trimesh.proximity import closest_point

HEAD_SHIFT = 0.040
HEAD_BLEND = (1.50, 1.56)
CAP = 0.020
MARGIN = 0.006
ROUNDS = 3
SAMPLE_SPACING = 0.005
SIGMA = 0.045


def _parse_glb(path):
    with open(path, 'rb') as f:
        data = f.read()
    assert data[:4] == b'glTF'
    off = 12
    js = None
    bin_chunk = b''
    while off < len(data):
        clen, ctype = struct.unpack_from('<I4s', data, off)
        off += 8
        chunk = data[off:off + clen]
        if ctype == b'JSON':
            js = json.loads(chunk)
        elif ctype == b'BIN\x00':
            bin_chunk = chunk
        off += clen
    return js, bin_chunk


def _read_accessor(js, bin_chunk, idx):
    acc = js['accessors'][idx]
    bv = js['bufferViews'][acc['bufferView']]
    comp = {5120: 'i1', 5121: 'u1', 5122: 'i2', 5123: 'u2', 5125: 'u4', 5126: 'f4'}[acc['componentType']]
    ncomp = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[acc['type']]
    arr = np.frombuffer(
        bin_chunk, dtype=np.dtype(comp), count=acc['count'] * ncomp,
        offset=bv.get('byteOffset', 0) + acc.get('byteOffset', 0),
    )
    return arr.reshape(acc['count'], ncomp)


def _node_matrix(node):
    if 'matrix' in node:
        return np.array(node['matrix'], dtype=np.float64).reshape(4, 4).T
    m = np.eye(4)
    if 'translation' in node:
        m[:3, 3] = node['translation']
    if 'rotation' in node:
        x, y, z, w = node['rotation']
        m = m @ trimesh.transformations.quaternion_matrix([w, x, y, z])
    if 'scale' in node:
        s = np.eye(4)
        s[:3, :3] = np.diag(node['scale'])
        m = m @ s
    return m


def load_bone_meshes(glb_path):
    """读 human.glb，返回 [(geom 节点名, verts_world, faces)]（rest 位世界系）。"""
    js, bin_chunk = _parse_glb(glb_path)
    nodes = js['nodes']
    world = {}

    def walk(i, parent_m):
        n = nodes[i]
        m = parent_m @ _node_matrix(n)
        world[i] = m
        for c in n.get('children', []):
            walk(c, m)

    for r in js['scenes'][js['scene']]['nodes']:
        walk(r, np.eye(4))

    out = []
    for i, n in enumerate(nodes):
        if 'mesh' not in n:
            continue
        mesh = js['meshes'][n['mesh']]
        if len(mesh['primitives']) != 1 or 'POSITION' not in mesh['primitives'][0]['attributes']:
            continue
        prim = mesh['primitives'][0]
        bv = _read_accessor(js, bin_chunk, prim['attributes']['POSITION'])[:, :3].astype(np.float64)
        bw = (world[i] @ np.c_[bv, np.ones(len(bv))].T).T[:, :3]
        faces = _read_accessor(js, bin_chunk, prim['indices']).reshape(-1, 3).astype(np.int64)
        out.append((n.get('name', f'node{i}'), bw, faces))
    return out


def apply_skin_fit(verts_world, faces, bone_meshes):
    """皮肤侧包络配准：头部后移 + 残余穿出标量膨胀场。world 系进出。"""
    verts = verts_world.copy()

    # 1. 头部后移（对齐偏后的颅骨；smoothstep 过渡避免领口接缝）
    z = verts[:, 2]
    lo, hi = HEAD_BLEND
    w = np.clip((z - lo) / (hi - lo), 0.0, 1.0)
    w = w * w * (3 - 2 * w)
    verts[:, 0] -= HEAD_SHIFT * w

    skin0 = trimesh.Trimesh(vertices=verts, faces=faces, process=False)
    vnormals = skin0.vertex_normals.copy()
    e = np.vstack([faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]])

    def smooth_scalar(x, iters):
        for _ in range(iters):
            acc = np.zeros_like(x)
            cnt = np.zeros(len(x))
            np.add.at(acc, e[:, 0], x[e[:, 1]])
            np.add.at(acc, e[:, 1], x[e[:, 0]])
            np.add.at(cnt, e[:, 0], 1)
            np.add.at(cnt, e[:, 1], 1)
            x = x + 0.6 * (acc / np.maximum(cnt, 1) - x)
        return x

    inflated_total = np.zeros(len(verts))
    for rnd in range(ROUNDS):
        cur = trimesh.Trimesh(vertices=verts, faces=faces, process=False)
        obs = []
        for _, bw, bfaces in bone_meshes:
            bm = trimesh.Trimesh(vertices=bw, faces=bfaces, process=False)
            n_samples = max(int(bm.area / (SAMPLE_SPACING ** 2)), 64)
            pts, _ = trimesh.sample.sample_surface(bm, n_samples)
            obs.append(pts)
        obs_pts = np.vstack(obs)

        closest, dist, tri_id = closest_point(cur, obs_pts)
        sign = np.einsum('ij,ij->i', obs_pts - closest, cur.face_normals[tri_id])
        outside_mask = sign > 0
        if not outside_mask.any():
            print(f'  envelope round {rnd}: 无穿出，收敛')
            break
        src_pos = closest[outside_mask]
        src_mag = np.minimum(dist[outside_mask] + MARGIN, CAP + 0.05)
        tree = cKDTree(src_pos)
        infl = np.zeros(len(verts))
        for s in range(0, len(verts), 8000):
            chunk = verts[s:s + 8000]
            dd, ii = tree.query(chunk, k=8, distance_upper_bound=0.15, workers=-1)
            valid = ~np.isinf(dd)
            ii_safe = np.where(valid, ii, 0)
            contrib = src_mag[ii_safe] * np.exp(-((dd / SIGMA) ** 2) / 2)
            contrib[~valid] = 0.0
            infl[s:s + 8000] = contrib.max(axis=1)
        infl = smooth_scalar(infl, iters=8)
        room = np.maximum(CAP - inflated_total, 0.0)
        infl = np.minimum(infl, room)
        inflated_total += infl
        verts = verts + vnormals * infl[:, None]
        print(f'  envelope round {rnd}: 穿出样本 {int(outside_mask.sum())}，膨胀 max={infl.max() * 1000:.1f} mm')

    disp = np.linalg.norm(verts - verts_world, axis=1)
    print(f'  envelope 位移: mean={disp.mean() * 1000:.1f} mm  max={disp.max() * 1000:.1f} mm')
    return verts
