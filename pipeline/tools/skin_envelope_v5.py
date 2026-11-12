"""策略 C 最终版 v5：v4 双端迭代 + 手骨深缩（0.72）+ 皮肤头部位移对齐颅骨。

在 v4 基础上：
1. 手部/腕部骨骼（body 名以 hand_ / proximal_row 开头）收缩下限放宽到 0.72
   （块状手骨远大于 NIH 手型，体量小、深缩视觉不显眼）；
2. 皮肤头部区域（z ≥ 1.50，平滑过渡）沿 -x（后侧）平移 40mm——颅骨与皮肤头部
   是位置错配（见 pipeline/out/verify/ov_head.png 构建期叠图），平移比膨胀更自然；
3. 其余同 v4：穿出骨骼缩至 0.88（绕 body 原点），残余由皮肤标量膨胀场兜底（累计 20mm）。

输出：审计数字 + 叠图 + npy + bone_fit_scales.json。
"""
import importlib.util
import json

import numpy as np
import trimesh
from scipy.spatial import cKDTree
from trimesh.proximity import closest_point

spec = importlib.util.spec_from_file_location('audit', r'D:\清华人体模型\pipeline\tools\skin_fit_audit.py')
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)

FLOOR = 0.88
FLOOR_HAND = 0.72
FLOOR_SKULL = 0.72   # 颅骨包在头壳内，深缩只在半透明对比时可见（v6：v5 实测 0.88+后移+膨胀仍余 77mm）
HAND_PREFIX = ('hand_', 'proximal_row')
SKULL_NAMES = {'head_neck__skull'}
CAP = 0.020
MARGIN = 0.006
ROUNDS = 3
SAMPLE_SPACING = 0.005
HEAD_SHIFT = 0.040   # 皮肤头部后移量（-x 方向）
HEAD_BLEND = (1.50, 1.56)  # z 平滑过渡带


def load_all():
    js, bin_chunk = audit.parse_glb(audit.GLB)
    nodes = js['nodes']
    world = {}

    def walk(i, parent_m):
        n = nodes[i]
        m = parent_m @ audit.node_matrix(n)
        world[n.get('name', f'node{i}')] = m
        for c in n.get('children', []):
            walk(c, m)

    for r in js['scenes'][js['scene']]['nodes']:
        walk(r, np.eye(4))

    meshes = js['meshes']
    skin_name = next(n for n in world if 'skin' in n.lower())
    sn = nodes[[i for i, n in enumerate(nodes) if n.get('name') == skin_name][0]]
    prim = meshes[sn['mesh']]['primitives'][0]
    sv = audit.read_accessor(js, bin_chunk, prim['attributes']['POSITION'])[:, :3].astype(np.float64)
    faces = audit.read_accessor(js, bin_chunk, prim['indices']).reshape(-1, 3).astype(np.int64)
    sw = (world[skin_name] @ np.c_[sv, np.ones(len(sv))].T).T[:, :3]

    bones = []
    for i, n in enumerate(nodes):
        name = n.get('name', '')
        if name == skin_name or 'mesh' not in n:
            continue
        mesh = meshes[n['mesh']]
        if len(mesh['primitives']) != 1 or 'POSITION' not in mesh['primitives'][0]['attributes']:
            continue
        bv = audit.read_accessor(js, bin_chunk, mesh['primitives'][0]['attributes']['POSITION'])[:, :3].astype(np.float64)
        bw = (world[name] @ np.c_[bv, np.ones(len(bv))].T).T[:, :3]
        bfaces = audit.read_accessor(js, bin_chunk, mesh['primitives'][0]['indices']).reshape(-1, 3).astype(np.int64)
        body_name = name.split('__')[0]
        origin = world[body_name][:3, 3] if body_name in world else world[name][:3, 3]
        if name in SKULL_NAMES:
            floor = FLOOR_SKULL
        elif body_name.startswith(HAND_PREFIX):
            floor = FLOOR_HAND
        else:
            floor = FLOOR
        bones.append({'name': name, 'body': body_name, 'origin': origin, 'verts': bw,
                      'faces': bfaces, 'f': 1.0, 'floor': floor})
    return sw, faces, bones


def audit_bones(skin, bones):
    res = {}
    for b in bones:
        bw = b['verts']
        if len(bw) > 2000:
            bw = bw[np.linspace(0, len(bw) - 1, 2000).astype(int)]
        out_cnt, dmax = 0, 0.0
        for s in range(0, len(bw), 1000):
            chunk = bw[s:s + 1000]
            cl, dist, tid = closest_point(skin, chunk)
            sg = np.einsum('ij,ij->i', chunk - cl, skin.face_normals[tid])
            out_cnt += int((sg > 0).sum())
            if (sg > 0).any():
                dmax = max(dmax, float(sg[sg > 0].max()))
        res[b['name']] = (out_cnt, dmax)
    return res


def main():
    sw, faces, bones = load_all()

    # 皮肤头部后移（平滑过渡），对齐偏后的颅骨
    z = sw[:, 2]
    lo, hi = HEAD_BLEND
    w = np.clip((z - lo) / (hi - lo), 0.0, 1.0)
    w = w * w * (3 - 2 * w)  # smoothstep
    verts = sw.copy()
    verts[:, 0] -= HEAD_SHIFT * w
    print(f'头部后移 {HEAD_SHIFT * 1000:.0f} mm（过渡带 z {lo}~{hi}，受影响顶点 {int((w > 0).sum())}）')

    skin = trimesh.Trimesh(vertices=verts, faces=faces, process=False)
    e = np.vstack([faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]])
    vnormals = skin.vertex_normals.copy()

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

    inflated_total = np.zeros(len(sw))

    for rnd in range(ROUNDS):
        cur_skin = trimesh.Trimesh(vertices=verts, faces=faces, process=False)

        # 骨骼收缩
        stats = audit_bones(cur_skin, bones)
        scaled_any = 0
        for b in bones:
            out_cnt, _ = stats[b['name']]
            if out_cnt == 0 or b['f'] <= b['floor'] + 1e-6:
                continue
            o = b['origin']
            rel = b['verts'] - o

            def outside_at(f, o=o, rel=rel):
                pv = o + f * rel
                if len(pv) > 1500:
                    pv = pv[np.linspace(0, len(pv) - 1, 1500).astype(int)]
                cnt = 0
                for s in range(0, len(pv), 1000):
                    chunk = pv[s:s + 1000]
                    cl, dist, tid = closest_point(cur_skin, chunk)
                    sg = np.einsum('ij,ij->i', chunk - cl, cur_skin.face_normals[tid])
                    cnt += int((sg > 0).sum())
                return cnt

            cnt_shrunk = outside_at(b['floor'])
            if cnt_shrunk < out_cnt:
                b['f'] = b['floor']
                b['verts'] = o + b['floor'] * rel
                scaled_any += 1
        print(f'round {rnd}: 收缩骨骼 {scaled_any} 块')

        # 皮肤膨胀（残余）
        cur_skin = trimesh.Trimesh(vertices=verts, faces=faces, process=False)
        obs = []
        for b in bones:
            bm = trimesh.Trimesh(vertices=b['verts'], faces=b['faces'], process=False)
            n_samples = max(int(bm.area / (SAMPLE_SPACING ** 2)), 64)
            pts, _ = trimesh.sample.sample_surface(bm, n_samples)
            obs.append(pts)
        obs_pts = np.vstack(obs)

        closest, dist, tri_id = closest_point(cur_skin, obs_pts)
        sign = np.einsum('ij,ij->i', obs_pts - closest, cur_skin.face_normals[tri_id])
        outside_mask = sign > 0
        if outside_mask.any():
            src_pos = closest[outside_mask]
            src_mag = np.minimum(dist[outside_mask] + MARGIN, CAP + 0.05)
            tree = cKDTree(src_pos)
            infl = np.zeros(len(verts))
            for s in range(0, len(verts), 8000):
                chunk = verts[s:s + 8000]
                dd, ii = tree.query(chunk, k=8, distance_upper_bound=0.15, workers=-1)
                valid = ~np.isinf(dd)
                ii_safe = np.where(valid, ii, 0)
                contrib = src_mag[ii_safe] * np.exp(-((dd / 0.045) ** 2) / 2)
                contrib[~valid] = 0.0
                infl[s:s + 8000] = contrib.max(axis=1)
            infl = smooth_scalar(infl, iters=8)
            room = np.maximum(CAP - inflated_total, 0.0)
            infl = np.minimum(infl, room)
            inflated_total += infl
            verts = verts + vnormals * infl[:, None]
            print(f'round {rnd}: 穿出样本 {int(outside_mask.sum())}，膨胀 max={infl.max() * 1000:.1f} mm')
        else:
            print(f'round {rnd}: 无穿出样本')

    # 最终审计
    final_skin = trimesh.Trimesh(vertices=verts, faces=faces, process=False)
    stats = audit_bones(final_skin, bones)
    total_out = sum(c for c, _ in stats.values())
    worst = sorted(((n, c, d) for n, (c, d) in stats.items() if c), key=lambda w: -w[2])
    disp = np.linalg.norm(verts - sw, axis=1)
    print(f'\n=== v5 最终结果 ===')
    print(f'位移统计: mean={disp.mean() * 1000:.1f} mm  p95={np.percentile(disp, 95) * 1000:.1f} mm  max={disp.max() * 1000:.1f} mm')
    print(f'残余穿出顶点总数: {total_out}')
    for name, c, dmax in worst[:12]:
        print(f'  {name:32s} out={c:5d} max={dmax * 1000:.1f} mm')

    scales = {b['name']: round(b['f'], 4) for b in bones if b['f'] < 1}
    with open(r'D:\清华人体模型\pipeline\out\fullbody\bone_fit_scales.json', 'w', encoding='utf8') as f:
        json.dump(scales, f, ensure_ascii=False, indent=1)
    np.save(r'D:\清华人体模型\pipeline\out\fullbody\skin_vertices_enveloped.npy', verts)
    n_hand = sum(1 for b in bones if b['floor'] == FLOOR_HAND and b['f'] < 1)
    print(f'\n骨骼缩放 {len(scales)} 块（其中手部 {n_hand} 块 @≤0.72）')
    print('已保存 npy + bone_fit_scales.json')


if __name__ == '__main__':
    main()
