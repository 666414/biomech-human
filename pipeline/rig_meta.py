"""生成 rig-meta.json：部位名表（中英）+ 分组 + 关节元数据 + 非骨骼图层节点。

- parts：MuJoCo body 层级（骨骼），节点名 = body id，带关节定义；
- attachments：挂在 body 下的非骨骼可视节点（皮肤胶囊），节点名 = glb 节点名，
  分组为 skin/muscle，前端分层控件据此定位节点与材质。
"""
from dataclasses import asdict


def _group_of(body_name):
    name = body_name.lower()
    if "muscle" in name or "tendon" in name:
        return "muscle"
    if "skin" in name:
        return "skin"
    return "skeleton"


def build_rig_meta(tree, zh_map, attachments=()):
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

    meta = {"parts": parts}
    if attachments:
        meta["attachments"] = [
            {
                "id": a["id"],
                "parent": a["parent"],
                "group": a["group"],
                # 皮肤名由所属部位中文名派生：右股骨 → 右股骨皮肤
                "names": {"en": a["names"]["en"], "zh": f"{zh_map.get(a['parent'], a['parent'])}皮肤"},
            }
            for a in attachments
        ]
    return meta
