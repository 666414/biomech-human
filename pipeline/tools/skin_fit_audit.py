"""量化皮肤-骨骼穿出（临时诊断脚本）。

解析 pipeline/out/fullbody/human.glb（未压缩、rest 位）：
- skin_mesh 顶点（世界系）→ trimesh 点云壳
- 每个 body 的 mesh 顶点 → 到皮肤表面的有符号距离（trimesh.proximity，正=在壳内）
- 输出逐 body：顶点总数、壳外顶点数/占比、最大穿出距离、P95 穿出距离
- 另输出骨架与皮肤的世界包围盒（核对身高对齐）
"""
import json
import struct
import sys

import numpy as np
import trimesh
from trimesh.proximity import closest_point, signed_distance

GLB = r'D:\清华人体模型\pipeline\out\fullbody\human.glb'


def parse_glb(path):
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


def read_accessor(js, bin_chunk, idx):
    acc = js['accessors'][idx]
    bv = js['bufferViews'][acc['bufferView']]
    comp_type = {5120: 'i1', 5121: 'u1', 5122: 'i2', 5123: 'u2', 5125: 'u4', 5126: 'f4'}[acc['componentType']]
    ncomp = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[acc['type']]
    arr = np.frombuffer(bin_chunk, dtype=np.dtype(comp_type), count=acc['count'] * ncomp, offset=bv.get('byteOffset', 0) + acc.get('byteOffset', 0))
    return arr.reshape(acc['count'], ncomp)


def node_matrix(node):
    if 'matrix' in node:
        return np.array(node['matrix'], dtype=np.float64).reshape(4, 4).T
    m = np.eye(4)
    if 'T' in ('translation',) or 'translation' in node:
        m[:3, 3] = node['translation']
    if 'rotation' in node:
        x, y, z, w = node['rotation']
        r = trimesh.transformations.quaternion_matrix([w, x, y, z])
        m = m @ r
    if 'scale' in node:
        s = np.eye(4)
        s[:3, :3] = np.diag(node['scale'])
        m = m @ s
    return m


def main():
    js, bin_chunk = parse_glb(GLB)
    nodes = js['nodes']
    scene_root = js['scenes'][js['scene']]['nodes']

    # 名字 → 世界矩阵（rest 位：直接累乘局部变换）
    world = {}

    def walk(i, parent_m):
        n = nodes[i]
        m = parent_m @ node_matrix(n)
        name = n.get('name', f'node{i}')
        world[name] = m
        for c in n.get('children', []):
            walk(c, m)

    for r in scene_root:
        walk(r, np.eye(4))

    meshes = js['meshes']
    skin_name = next(n for n in world if 'skin' in n.lower())
    skin_node = nodes[[i for i, n in enumerate(nodes) if n.get('name') == skin_name][0]]
    prim = meshes[skin_node['mesh']]['primitives'][0]
    sv = read_accessor(js, bin_chunk, prim['attributes']['POSITION'])[:, :3].astype(np.float64)
    sw = (world[skin_name] @ np.c_[sv, np.ones(len(sv))].T).T[:, :3]
    print(f'skin: {skin_name}  verts={len(sw)}')
    print(f'skin bbox min={np.round(sw.min(0), 3)} max={np.round(sw.max(0), 3)}  height={sw[:, 2].max() - sw[:, 2].min():.3f}')

    # 皮肤壳（闭面体网格才能做 signed distance；glb 里的 skin 是闭合面片）
    faces = read_accessor(js, bin_chunk, prim['indices']).reshape(-1, 3).astype(np.int64)
    fm = (world[skin_name][:3, :3] @ np.eye(3))
    det = np.linalg.det(fm)
    skin_mesh = trimesh.Trimesh(vertices=sw, faces=faces if det > 0 else faces[:, ::-1], process=False)

    # 逐 body 网格
    report = []
    all_bone = []
    for i, n in enumerate(nodes):
        name = n.get('name', '')
        if name == skin_name or 'mesh' not in n:
            continue
        mesh = meshes[n['mesh']]
        if len(mesh['primitives']) != 1:
            continue
        prim = mesh['primitives'][0]
        if 'POSITION' not in prim['attributes']:
            continue
        bv_local = read_accessor(js, bin_chunk, prim['attributes']['POSITION'])[:, :3].astype(np.float64)
        bw = (world[name] @ np.c_[bv_local, np.ones(len(bv_local))].T).T[:, :3]
        all_bone.append(bw)
        if len(bw) == 0:
            continue
        # 大网格抽样（内存/耗时友好），统计意义足够
        if len(bw) > 2000:
            bw = bw[np.linspace(0, len(bw) - 1, 2000).astype(int)]
        # 快速有符号判定：最近点距离 + 最近面法向定号（法向朝外，点在法向同侧=壳外）
        sd_parts = []
        for s in range(0, len(bw), 1000):
            chunk = bw[s:s + 1000]
            closest, dist, tri_id = closest_point(skin_mesh, chunk)
            normal_sign = np.einsum('ij,ij->i', chunk - closest, skin_mesh.face_normals[tri_id])
            sd_parts.append(np.where(normal_sign >= 0, dist, -dist))
        sd = np.concatenate(sd_parts)  # 正=壳外（本脚本口径：正=穿出）
        outside = sd > 0
        if outside.any():
            dists = sd[outside]
            report.append((name, len(bw), int(outside.sum()), float(dists.max()), float(np.percentile(dists, 95))))

    ab = np.vstack(all_bone)
    print(f'skeleton bbox min={np.round(ab.min(0), 3)} max={np.round(ab.max(0), 3)}  height={ab[:, 2].max() - ab[:, 2].min():.3f}')
    print(f'\n穿出皮肤的 body（按最大穿出距离排序）：')
    print(f'{"body":28s} {"verts":>7s} {"outside":>8s} {"ratio":>7s} {"max_mm":>8s} {"p95_mm":>8s}')
    for name, nv, no, dmax, dp95 in sorted(report, key=lambda r: -r[3]):
        print(f'{name:28s} {nv:7d} {no:8d} {no / nv:7.1%} {dmax * 1000:8.1f} {dp95 * 1000:8.1f}')


if __name__ == '__main__':
    sys.exit(main())
