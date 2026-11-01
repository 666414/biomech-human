"""生成 rig-meta.json：部位名表（中英）+ 分组 + 关节元数据。"""
from dataclasses import asdict


def _group_of(body_name):
    name = body_name.lower()
    if "muscle" in name or "tendon" in name:
        return "muscle"
    if "skin" in name:
        return "skin"
    return "skeleton"


def build_rig_meta(tree, zh_map):
    parts = []

    def walk(body, parent):
        parts.append({
            "id": body.name,
            "parent": parent,
            "names": {"en": body.name, "zh": zh_map.get(body.name, body.name)},
            "group": _group_of(body.name),
            "joints": [asdict(j) for j in body.joints],
        })
        for c in body.children:
            walk(c, body.name)

    for r in tree["bodies"]:
        walk(r, None)
    return {"parts": parts}
