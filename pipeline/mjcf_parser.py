"""MuJoCo MJCF 解析：处理 <include> 文本级合并，产出 body 树与网格资产表。"""
import os
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field


@dataclass
class Joint:
    name: str
    type: str
    axis: list = field(default_factory=lambda: [0.0, 0.0, 1.0])
    range: list | None = None
    # 关节锚点（XML pos 属性，body 局部系）。hinge 绕该点旋转；slide 运动学不使用。
    anchor: list = field(default_factory=lambda: [0.0, 0.0, 0.0])


@dataclass
class Body:
    name: str
    pos: list
    quat: list  # MuJoCo 顺序 w x y z
    joints: list
    geoms: list  # [{name, type, mesh, file, pos, quat}]
    children: list


def _floats(text, default):
    if text is None:
        return list(default)
    return [float(v) for v in text.split()]


def _resolve_includes(elem, base_dir):
    """MuJoCo include 是文本级合并：用被包含 <mujoco> 根的子元素替换 include 标记。"""
    for child in list(elem):
        if child.tag == "include":
            inc_path = os.path.normpath(os.path.join(base_dir, child.get("file")))
            sub_root = ET.parse(inc_path).getroot()
            _resolve_includes(sub_root, base_dir)  # MuJoCo 语义：include 路径相对主 XML 目录
            idx = list(elem).index(child)
            elem.remove(child)
            for i, sub_child in enumerate(list(sub_root)):
                elem.insert(idx + i, sub_child)
        else:
            _resolve_includes(child, base_dir)


def _parse_body(el):
    joints = [
        Joint(
            name=j.get("name"),
            type=j.get("type", "hinge"),
            axis=_floats(j.get("axis"), (0.0, 0.0, 1.0)),
            range=_floats(j.get("range"), None) if j.get("range") else None,
            anchor=_floats(j.get("pos"), (0.0, 0.0, 0.0)),
        )
        for j in el.findall("joint")
    ]
    geoms = [
        {
            "name": g.get("name"),
            "type": g.get("type", "sphere"),
            "mesh": g.get("mesh"),
            "file": None,  # 由 meshes 表回填
            "pos": _floats(g.get("pos"), (0.0, 0.0, 0.0)),
            "quat": _floats(g.get("quat"), (1.0, 0.0, 0.0, 0.0)),
        }
        for g in el.findall("geom")
        if g.get("type") == "mesh" and g.get("mesh")
    ]
    return Body(
        name=el.get("name"),
        pos=_floats(el.get("pos"), (0.0, 0.0, 0.0)),
        quat=_floats(el.get("quat"), (1.0, 0.0, 0.0, 0.0)),
        joints=joints,
        geoms=geoms,
        children=[_parse_body(b) for b in el.findall("body")],
    )


def collect_body_names(bodies):
    names = []

    def walk(b):
        names.append(b.name)
        for c in b.children:
            walk(c)

    for r in bodies:
        walk(r)
    return names


def parse_mjcf(xml_path):
    """返回 {"bodies": [Body...], "meshes": {name: file}}，路径相对 XML 所在目录（上游为仓库根）。"""
    xml_path = os.path.normpath(os.path.abspath(xml_path))
    base_dir = os.path.dirname(xml_path)
    root = ET.parse(xml_path).getroot()
    _resolve_includes(root, base_dir)

    meshes = {}
    for asset in root.iter("asset"):
        for m in asset.findall("mesh"):
            if m.get("name") and m.get("file"):
                meshes[m.get("name")] = m.get("file").replace("\\", "/")

    bodies = [_parse_body(b) for b in root.find("worldbody").findall("body")]

    def fill_files(b):
        for g in b.geoms:
            g["file"] = meshes.get(g["mesh"])
        for c in b.children:
            fill_files(c)

    for r in bodies:
        fill_files(r)
    return {"bodies": bodies, "meshes": meshes}
