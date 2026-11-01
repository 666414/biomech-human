"""把 body 树装配进 trimesh 场景图：节点=body（保层级与局部 TRS），几何=骨骼网格。"""
import os
import trimesh


def mu_to_matrix(pos, quat):
    """MuJoCo (pos, quat wxyz) → 4x4 齐次矩阵。trimesh.transformations 接受 [w, x, y, z]。"""
    T = trimesh.transformations.quaternion_matrix(list(quat))
    T[:3, 3] = list(pos)
    return T


def assemble(tree, repo_root, exclude_prefixes=()):
    """返回 (trimesh.Scene, node_bodies)。scene.graph 节点名 = body 名，层级与 XML 一致。"""
    scene = trimesh.Scene()
    node_bodies = []
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
        for g in body.geoms:
            if not g["file"] or any(body.name.startswith(p) for p in exclude_prefixes):
                continue
            geom = load_mesh(g["file"])
            key = f"{body.name}__{g['mesh']}"
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
    return scene, node_bodies
