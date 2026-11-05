"""把 body 树装配进 trimesh 场景图：节点=body（保层级与局部 TRS）。

几何有两类：
- 骨骼：XML 的 type="mesh" 网格（节点名 `<body>__<mesh>`）；
- 皮肤：XML 的 class="skin" 胶囊（节点名 `<body>__<geom>`，由 trimesh 生成）。

皮肤节点是 body 的子节点，随骨骼运动；分层显示按节点名区分分组，
因此不会与骨骼网格混在一起。
"""
import os

import trimesh


def mu_to_matrix(pos, quat):
    """MuJoCo (pos, quat wxyz) → 4x4 齐次矩阵。trimesh.transformations 接受 [w, x, y, z]。"""
    T = trimesh.transformations.quaternion_matrix(list(quat))
    T[:3, 3] = list(pos)
    return T


def _capsule_mesh(size):
    """MuJoCo capsule size=[radius, half_length] → trimesh 胶囊（轴沿 +Z，与 MuJoCo 一致）。"""
    radius, half_length = float(size[0]), float(size[1])
    return trimesh.creation.capsule(height=2 * half_length, radius=radius, count=[16, 16])


def assemble(tree, repo_root, exclude_prefixes=()):
    """返回 (trimesh.Scene, node_bodies, skin_attachments)。

    skin_attachments: [{id, parent, group:'skin', names:{en, zh}}]，
    供 rig-meta 记录「非骨骼图层」的节点归属。
    """
    scene = trimesh.Scene()
    node_bodies = []
    skin_attachments = []
    mesh_cache = {}

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
            if g["file"]:
                geom = load_mesh(g["file"])
                key = f"{body.name}__{g['mesh']}"
            elif g["class"] == "skin" and g["type"] == "capsule" and g["size"]:
                geom = _capsule_mesh(g["size"])
                key = f"{body.name}__{g['name']}"
                skin_attachments.append(
                    {
                        "id": key,
                        "parent": body.name,
                        "group": "skin",
                        "names": {"en": g["name"], "zh": g["name"]},
                    }
                )
            else:
                continue
            if key in scene.geometry:
                continue
            scene.add_geometry(
                geom, geom_name=key, node_name=key,
                parent_node_name=body.name,
                transform=mu_to_matrix(g["pos"], g["quat"]),
            )
        for c in body.children:
            walk(c, body.name)

    for root_body in tree["bodies"]:
        walk(root_body, "world")
    return scene, node_bodies, skin_attachments
