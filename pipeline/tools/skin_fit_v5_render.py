"""v5 结果可视化：皮肤(v5 npy) vs 收缩后骨骼，侧视+正视。"""
import importlib.util
import json

import matplotlib

matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
import trimesh

spec = importlib.util.spec_from_file_location('v5', r'D:\清华人体模型\pipeline\tools\skin_envelope_v5.py')
v5 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v5)

sw, faces, bones = v5.load_all()
verts = np.load(r'D:\清华人体模型\pipeline\out\fullbody\skin_vertices_enveloped.npy')
scales = json.load(open(r'D:\清华人体模型\pipeline\out\fullbody\bone_fit_scales.json', encoding='utf8'))
for b in bones:
    f = scales.get(b['name'], 1.0)
    if f != 1.0:
        b['verts'] = b['origin'] + f * (b['verts'] - b['origin'])

skin_pts, _ = trimesh.sample.sample_surface(trimesh.Trimesh(vertices=verts, faces=faces, process=False), 40000)

fig, axes = plt.subplots(1, 2, figsize=(14, 9))
for ax, (a, b), title in [(axes[0], (1, 2), 'side y-z'), (axes[1], (0, 2), 'front x-z')]:
    ax.scatter(skin_pts[:, a], skin_pts[:, b], s=0.3, c='#caa472', alpha=0.35, label='skin v5')
    allb = np.vstack([bb['verts'] for bb in bones])
    if len(allb) > 60000:
        allb = allb[np.linspace(0, len(allb) - 1, 60000).astype(int)]
    ax.scatter(allb[:, a], allb[:, b], s=0.3, c='red', alpha=0.5, label='bones scaled')
    ax.set_aspect('equal')
    ax.set_title(title)
    ax.legend(markerscale=20, loc='lower left')
plt.tight_layout()
plt.savefig(r'D:\清华人体模型\pipeline\out\verify\skin_fit_v5_overlay.png', dpi=130)
print('saved')
