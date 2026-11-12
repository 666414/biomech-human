"""针对性穿出探针（临时诊断）：对指定 body 输出穿出顶点簇坐标 + 局部叠图。

用法：python pipeline/tools/skin_fit_probe.py rib3_L [rib3_R tibia_r ...]
基于 pipeline/tools/skin_fit_audit.py 的解析逻辑，区别：
- 不抽样，逐顶点精确判定（body 网格都很小）；
- 打印穿出顶点簇的世界坐标 bbox 与质心，判断假阳性（凹区法向定号）还是真实穿出；
- 渲染该 body 局部放大叠图（皮肤点云 vs 骨骼，穿出顶点标黄）到 pipeline/out/verify/probe_<body>.png。
"""
import sys

import matplotlib

matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
import trimesh
from trimesh.proximity import closest_point, signed_distance

import importlib.util

spec = importlib.util.spec_from_file_location('audit', r'D:\清华人体模型\pipeline\tools\skin_fit_audit.py')
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


def signed_outside(skin_mesh, pts):
    out = np.zeros(len(pts), dtype=bool)
    sd = np.zeros(len(pts))
    for s in range(0, len(pts), 1000):
        chunk = pts[s:s + 1000]
        cl, dist, tid = closest_point(skin_mesh, chunk)
        sg = np.einsum('ij,ij->i', chunk - cl, skin_mesh.face_normals[tid])
        out[s:s + 1000] = sg > 0
        sd[s:s + 1000] = np.where(sg > 0, dist, -dist)
    return out, sd


def main():
    names = sys.argv[1:]
    if not names:
        print('usage: skin_fit_probe.py <body-substr> [...]')
        return 2

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
    fm = world[skin_name][:3, :3]
    skin_mesh = trimesh.Trimesh(vertices=sw, faces=faces if np.linalg.det(fm) > 0 else faces[:, ::-1], process=False)
    print(f'skin watertight={skin_mesh.is_watertight} winding={skin_mesh.is_winding_consistent} '
          f'euler={skin_mesh.euler_number}')
    # 边界边：只被 1 个面引用的边（= 网格有开口）
    edges = np.vstack([faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]])
    edges_sorted = np.unique(np.sort(edges, axis=1), axis=0)
    import collections
    cnt = collections.Counter(map(tuple, edges))
    boundary = np.array([e for e, c in cnt.items() if c == 1], dtype=np.int64)
    print(f'boundary edges: {len(boundary)}')
    if len(boundary):
        bp = sw[np.unique(boundary)]
        print(f'boundary verts bbox min={np.round(bp.min(0), 3)} max={np.round(bp.max(0), 3)}')

    # 皮肤点云抽样供叠图
    skin_pts, _ = trimesh.sample.sample_surface(skin_mesh, 30000)

    for target in names:
        matches = [n for n in world if 'mesh' in nodes[[i for i, x in enumerate(nodes) if x.get('name') == n][0]] and target.lower() in n.lower()]
        if not matches:
            print(f'{target}: no match')
            continue
        for name in matches:
            idx = [i for i, x in enumerate(nodes) if x.get('name') == name][0]
            mesh = meshes[nodes[idx]['mesh']]
            p = mesh['primitives'][0]
            bv = audit.read_accessor(js, bin_chunk, p['attributes']['POSITION'])[:, :3].astype(np.float64)
            bw = (world[name] @ np.c_[bv, np.ones(len(bv))].T).T[:, :3]
            out, sd = signed_outside(skin_mesh, bw)
            # 射线法复核（trimesh 约定：正=壳内、负=壳外）
            sd_ray = signed_distance(skin_mesh, bw)
            ray_out = sd_ray < 0
            n_ray = int(ray_out.sum())
            n_out = int(out.sum())
            print(f'\n=== {name}  verts={len(bw)}  法向法 outside={n_out} ({n_out / len(bw):.1%})  '
                  f'射线法 outside={n_ray} ({n_ray / len(bw):.1%}) ===')
            if n_ray:
                cluster = bw[ray_out]
                print(f'  射线法真穿出 max={(-sd_ray[ray_out]).max() * 1000:.1f} mm  '
                      f'p95={np.percentile(-sd_ray[ray_out], 95) * 1000:.1f} mm')
                print(f'  真穿出簇 bbox min={np.round(cluster.min(0), 3)} max={np.round(cluster.max(0), 3)}')
                print(f'  真穿出簇质心  = {np.round(cluster.mean(0), 3)}')
            if n_out:
                cluster = bw[out]
                print(f'  穿出簇 bbox min={np.round(cluster.min(0), 3)} max={np.round(cluster.max(0), 3)}')
                print(f'  穿出簇质心  = {np.round(cluster.mean(0), 3)}  （世界系：x前 y左 z上）')
                print(f'  max={sd[out].max() * 1000:.1f} mm  p95={np.percentile(sd[out], 95) * 1000:.1f} mm')
                # 穿出顶点在骨骼网格里的分布：是不是整块板的边缘
                print(f'  穿出顶点 z 范围 {cluster[:, 2].min():.3f}~{cluster[:, 2].max():.3f}')
                # 最近皮肤点在哪：判断是否被远处的面「吸走」（= 局部开口/空洞的证据）
                sample = cluster[np.linspace(0, n_out - 1, min(8, n_out)).astype(int)]
                cl, dist, _ = closest_point(skin_mesh, sample)
                for p, c, d in zip(sample, cl, dist):
                    print(f'    bone {np.round(p, 3)} -> skin {np.round(c, 3)}  d={d * 1000:.1f}mm')

            # 局部叠图：以骨骼 bbox 为窗
            lo, hi = bw.min(0) - 0.03, bw.max(0) + 0.03
            fig, axes = plt.subplots(1, 2, figsize=(14, 9))
            for ax, (a, b), title in [(axes[0], (1, 2), 'side y-z'), (axes[1], (0, 2), 'front x-z')]:
                m = np.all((skin_pts >= lo[[a, b] if False else slice(None)]) & (skin_pts <= hi[slice(None)]), axis=1)
                win = skin_pts[(skin_pts[:, a] >= lo[a]) & (skin_pts[:, a] <= hi[a]) &
                               (skin_pts[:, b] >= lo[b]) & (skin_pts[:, b] <= hi[b])]
                ax.scatter(win[:, a], win[:, b], s=0.5, c='#caa472', alpha=0.35, label='skin')
                ax.scatter(bw[:, a], bw[:, b], s=1.2, c='red', alpha=0.6, label='bone')
                if n_out:
                    ax.scatter(cluster[:, a], cluster[:, b], s=4, c='yellow', label='outside')
                ax.set_aspect('equal')
                ax.set_title(f'{name} {title}')
                ax.legend(markerscale=8, loc='lower left')
            out_path = rf'D:\清华人体模型\pipeline\out\verify\probe_{name}.png'
            plt.tight_layout()
            plt.savefig(out_path, dpi=130)
            plt.close(fig)
            print(f'  saved {out_path}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
