import json
import os
from pipeline.mjcf_parser import parse_mjcf, collect_body_names
from pipeline.rig_meta import build_rig_meta, _group_of

REPO = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..", "assets", "MS-Human-700"))
LOCO = os.path.join(REPO, "MS-Human-700-Locomotion.xml")


def test_rig_meta_covers_all_bodies_with_parent_links():
    tree = parse_mjcf(LOCO)
    meta = build_rig_meta(tree, zh_map={})
    ids = [p["id"] for p in meta["parts"]]
    assert len(ids) == 80
    assert ids[0] == "pelvis"
    # 跨模块契约：parts 顺序必须与 XML DFS 先序一致（Task 6 validate 依赖）
    assert ids == collect_body_names(tree["bodies"])
    pelvis = meta["parts"][0]
    assert pelvis["parent"] is None
    # 每个非根节点的 parent 必须存在于 ids 中
    id_set = set(ids)
    for p in meta["parts"][1:]:
        assert p["parent"] in id_set


def test_zh_name_fallback_and_mapping():
    tree = parse_mjcf(LOCO)
    meta = build_rig_meta(tree, zh_map={"pelvis": "骨盆"})
    pelvis = meta["parts"][0]
    assert pelvis["names"]["zh"] == "骨盆"
    unknown = next(p for p in meta["parts"] if p["id"] != "pelvis")
    assert unknown["names"]["zh"] == unknown["names"]["en"]  # 回退英文名


def test_group_assignment():
    tree = parse_mjcf(LOCO)
    meta = build_rig_meta(tree, zh_map={})
    groups = {p["group"] for p in meta["parts"]}
    assert groups <= {"skeleton", "muscle", "skin"}
    assert "skeleton" in groups


def test_joint_metadata_from_xml():
    tree = parse_mjcf(LOCO)
    meta = build_rig_meta(tree, zh_map={})
    with_joint = [p for p in meta["parts"] if p["joints"]]
    assert len(with_joint) > 10  # Locomotion 有 36 个受控关节
    j = with_joint[0]["joints"][0]
    assert {"name", "type", "axis", "range"} <= set(j.keys())


def test_group_of_branches():
    # muscle/skin 分支不被 Locomotion 数据触发，直接单测锁定
    assert _group_of("muscle_thing") == "muscle"
    assert _group_of("tendon_x") == "muscle"
    assert _group_of("skin_patch") == "skin"
    assert _group_of("femur_r") == "skeleton"


def test_part_name_zh_keys_all_exist():
    # 守卫：part_name_zh.json 的键必须都是真实 body 名（防人工扩充时拼写错误静默回退）
    with open(os.path.join(os.path.dirname(__file__), "..", "part_name_zh.json"), encoding="utf-8") as f:
        zh_map = json.load(f)
    tree = parse_mjcf(LOCO)
    names = set(collect_body_names(tree["bodies"]))
    unknown = [k for k in zh_map if k not in names]
    assert unknown == [], f"part_name_zh.json 含不存在的 body 名: {unknown}"
