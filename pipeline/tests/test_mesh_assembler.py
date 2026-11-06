import os
import numpy as np
from pipeline.mjcf_parser import parse_mjcf
from pipeline.mesh_assembler import assemble, mu_to_matrix

REPO = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..", "assets", "MS-Human-700"))
LOCO = os.path.join(REPO, "MS-Human-700-Locomotion.xml")


def test_mu_to_matrix_matches_mujoco_quat_order():
    # quat = w,x,y,z；w=1 单位四元数 → 无旋转
    T = mu_to_matrix([1.0, 2.0, 3.0], [1.0, 0.0, 0.0, 0.0])
    assert np.allclose(T[:3, 3], [1, 2, 3])
    assert np.allclose(T[:3, :3], np.eye(3))
    # 非单位四元数：[0,0,0,1] = 绕 z 轴 180°
    T2 = mu_to_matrix([0.0, 0.0, 0.0], [0.0, 0.0, 0.0, 1.0])
    assert np.allclose(T2[:3, :3], np.diag([-1.0, -1.0, 1.0]))


def test_assemble_preserves_hierarchy_and_meshes():
    tree = parse_mjcf(LOCO)
    scene, node_bodies = assemble(tree, REPO)
    # 80 个 body 节点全部进入场景图
    assert len(node_bodies) == 80
    assert "pelvis" in scene.graph.nodes
    # 网格几何体数量 = 带 file 的 geom 数（class="skin" 的胶囊不再导出）
    total = sum(1 for b in node_bodies for g in b.geoms if g["file"])
    assert len(scene.geometry) == total
    # 变换值校验：graph.get 返回相对 world 的累计变换。
    # pelvis 为根 body，累计 == 局部；node_bodies[1] 是 pelvis 的第一个子节点，
    # 其累计变换应等于 pelvis 矩阵复合其局部 pos/quat（可捕获 quat 顺序回归）。
    T_pelvis, _ = scene.graph.get("pelvis")
    assert np.allclose(T_pelvis, mu_to_matrix(node_bodies[0].pos, node_bodies[0].quat), atol=1e-6)
    child = node_bodies[1]
    T_child, _ = scene.graph.get(child.name)
    assert np.allclose(T_child, T_pelvis @ mu_to_matrix(child.pos, child.quat), atol=1e-6)


def test_exclude_prefixes_skip_geoms_but_keep_nodes():
    tree = parse_mjcf(LOCO)
    scene, node_bodies = assemble(tree, REPO, exclude_prefixes=("pelvis",))
    # 被排除 body 仍进入 node_bodies 与场景图（骨架层级不缺失）
    assert len(node_bodies) == 80
    assert "pelvis" in scene.graph.nodes
    # 但其几何被剔除
    assert not any(k.startswith("pelvis__") for k in scene.geometry)
    assert len(scene.geometry) == sum(
        1
        for b in node_bodies
        if not b.name.startswith("pelvis")
        for g in b.geoms
        if g["file"]
    )


def test_assemble_is_deterministic():
    tree = parse_mjcf(LOCO)
    s1, n1 = assemble(tree, REPO)
    s2, n2 = assemble(tree, REPO)
    assert [b.name for b in n1] == [b.name for b in n2]
    assert sorted(s1.geometry.keys()) == sorted(s2.geometry.keys())
