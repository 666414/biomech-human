import os
from pipeline.mjcf_parser import parse_mjcf, collect_body_names

REPO = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..", "assets", "MS-Human-700"))
LOCO = os.path.join(REPO, "MS-Human-700-Locomotion.xml")


def test_locomotion_body_count_is_80():
    tree = parse_mjcf(LOCO)
    names = collect_body_names(tree["bodies"])
    assert len(names) == 80


def test_body_tree_has_root_pelvis_with_children():
    tree = parse_mjcf(LOCO)
    roots = tree["bodies"]
    assert len(roots) == 1
    assert roots[0].name == "pelvis"
    assert len(roots[0].children) > 0


def test_bone_geoms_have_mesh_file():
    tree = parse_mjcf(LOCO)
    geoms = []

    def walk(b):
        geoms.extend(b.geoms)
        for c in b.children:
            walk(c)

    for r in tree["bodies"]:
        walk(r)
    mesh_geoms = [g for g in geoms if g["type"] == "mesh"]
    assert len(mesh_geoms) > 50, "骨骼网格 geom 应大量存在"
    for g in mesh_geoms:
        assert g["file"], f"geom {g['name']} 缺少 mesh file"
        assert g["file"].startswith("Geometry/")


def test_mesh_asset_table_maps_name_to_file():
    tree = parse_mjcf(LOCO)
    assert tree["meshes"]["sacrum"] == "Geometry/sacrum.stl"
    assert tree["meshes"]["r_femur"] == "Geometry/r_femur.stl"


def test_fullbody_model_parses():
    # 全身模型与 Locomotion 共享同一套 include/asset 结构，加回归保护（Task 7 Step 3 实测覆盖）
    tree = parse_mjcf(os.path.join(REPO, "MS-Human-700.xml"))
    names = collect_body_names(tree["bodies"])
    assert len(names) == 80
    assert names[0] == "pelvis"
