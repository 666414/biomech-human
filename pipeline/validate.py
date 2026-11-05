"""以 XML 为唯一真值的交叉校验。返回问题列表（空列表 = 通过）。"""
import trimesh

from pipeline.mjcf_parser import collect_body_names


def validate_output(tree, meta, glb_path):
    issues = []
    xml_names = collect_body_names(tree["bodies"])

    meta_ids = [p["id"] for p in meta["parts"]]
    if meta_ids != xml_names:
        issues.append(
            f"rig-meta 与 XML body 集不一致：XML {len(xml_names)} 个, rig-meta {len(meta_ids)} 个"
        )

    meta_id_set = set(meta_ids)
    for p in meta["parts"][1:]:
        if p["parent"] not in meta_id_set:
            issues.append(f"rig-meta 节点 {p['id']} 的 parent 不存在: {p['parent']}")

    attachment_ids = [a["id"] for a in meta.get("attachments", [])]
    for a in meta.get("attachments", []):
        if a["parent"] not in meta_id_set:
            issues.append(f"attachment {a['id']} 的 parent 不存在: {a['parent']}")

    try:
        scene = trimesh.load(glb_path)
        nodes = set(scene.graph.nodes)
        missing = [n for n in xml_names if n not in nodes]
        if missing:
            issues.append(f"GLB 缺少节点: {missing[:10]}")
        missing_attachments = [n for n in attachment_ids if n not in nodes]
        if missing_attachments:
            issues.append(f"GLB 缺少图层节点: {missing_attachments[:10]}")
    except Exception as e:  # 文件不存在/损坏
        issues.append(f"GLB 无法加载: {e}")

    return issues
