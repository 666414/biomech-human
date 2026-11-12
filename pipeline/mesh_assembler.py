"""把 body 树装配进 trimesh 场景图：节点=body（保层级与局部 TRS）。

几何：XML 的 type="mesh" 网格（节点名 `<body>__<mesh>`）。

皮肤不在本模块生成：早期用 `class="skin"` 胶囊拼出的下肢占位几何已被完整体表
（NIH 3D Human Atlas `VH_M_skin`）取代，由 `skin_bind.py` + `assemble_skin.js`
生成带蒙皮的 `skin_mesh` 节点挂到 pelvis 下。
"""
import os

import numpy as np
import trimesh


def mu_to_matrix(pos, quat):
    """MuJoCo (pos, quat wxyz) → 4x4 齐次矩阵。trimesh.transformations 接受 [w, x, y, z]。"""
    T = trimesh.transformations.quaternion_matrix(list(quat))
    T[:3, 3] = list(pos)
    return T


def assemble(tree, repo_root, exclude_prefixes=(), bone_fit=None):
    """返回 (trimesh.Scene, node_bodies)。

    节点归属（骨骼/皮肤/肌肉）由各产物自行声明，本模块只产出骨骼网格。
    bone_fit: {`<body>__<mesh>`: f} —— 骨骼网格绕 body 原点的收缩系数
    （skin_envelope_v5 离线配准产出，见 pipeline/bone_fit.json；只改网格顶点位置，
    不动 body 节点层级与关节语义，FK 对账不受影响）。
    """
    scene = trimesh.Scene()
    node_bodies = []
    mesh_cache = {}
    bone_fit = bone_fit or {}

    def load_mesh(fname):
        if fname not in mesh_cache:
            mesh_cache[fname] = trimesh.load(
                os.path.join(repo_root, fname), force="mesh", process=False
            )
        return mesh_cache[fname]

    def walk(body, parent_frame):
        node_bodies.append(body)
        scene.graph.update(
            frame_from=parent_frame, frame_to=body.name,
            matrix=mu_to_matrix(body.pos, body.quat),
        )
        excluded = any(body.name.startswith(p) for p in exclude_prefixes)
        for g in body.geoms:
            if excluded:
                continue
            if not g["file"]:
                continue
            geom = load_mesh(g["file"])
            key = f"{body.name}__{g['mesh']}"
            if key in scene.geometry:
                continue
            T = mu_to_matrix(g["pos"], g["quat"])
            f = bone_fit.get(key)
            if f and f != 1.0:
                # 绕 body 原点收缩：world_geom' = world_body @ S @ T_geom（体坐标系内缩放）
                S = np.diag([f, f, f, 1.0])
                T = S @ T
            scene.add_geometry(
                geom, geom_name=key, node_name=key,
                parent_node_name=body.name,
                transform=T,
            )
        for c in body.children:
            walk(c, body.name)

    for root_body in tree["bodies"]:
        walk(root_body, "world")
    return scene, node_bodies
