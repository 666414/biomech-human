"""MuJoCo MJCF 解析：处理 <include> 文本级合并，产出 body 树、网格资产表、
站点（site）、肌腱（tendon spatial）与执行器（actuator）映射。

MJCF 的 <default class="x"> 会为同类元素提供缺省属性（例如皮肤胶囊的
type="capsule" / group="1"），因此解析 geom 前必须先展开默认类。
"""
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
    geoms: list
    sites: list  # [{name, pos}]，pos 为 body 局部系
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


def _walk_default(elem, inherited, class_name, table):
    """递归展开 <default>：table[class] = {tag: {attr: value}}，子类继承父类。"""
    own = {tag: dict(attrs) for tag, attrs in inherited.items()}
    for child in elem:
        if child.tag == "default":
            continue
        own[child.tag] = {**own.get(child.tag, {}), **child.attrib}
    table[class_name] = own
    for child in elem:
        if child.tag == "default":
            _walk_default(child, own, child.get("class"), table)


def _collect_defaults(root):
    """返回 {class 名: {tag: {attr: value}}}；根 <default>（无 class）键为 None。"""
    table = {}
    for d in root.findall("default"):
        _walk_default(d, {}, None, table)
    return table


def _merged_attrs(defaults, class_name, tag, own_attrs):
    """合并：全局默认 → 该类默认 → 元素自身属性（后者覆盖前者）。"""
    merged = dict(defaults.get(None, {}).get(tag, {}))
    if class_name:
        merged.update(defaults.get(class_name, {}).get(tag, {}))
    merged.update(own_attrs)
    return merged


def _parse_body(el, defaults):
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
    geoms = []
    for g in el.findall("geom"):
        attrs = _merged_attrs(defaults, g.get("class"), "geom", g.attrib)
        geoms.append(
            {
                "name": g.get("name"),
                "type": attrs.get("type", "sphere"),
                # 默认类名（皮肤胶囊由 class="skin" 提供 type/group）
                "class": g.get("class"),
                "mesh": attrs.get("mesh"),
                "file": None,  # 由 meshes 表回填
                "size": _floats(attrs.get("size"), (0.0, 0.0, 0.0))
                if attrs.get("size")
                else None,
                "pos": _floats(attrs.get("pos"), (0.0, 0.0, 0.0)),
                "quat": _floats(attrs.get("quat"), (1.0, 0.0, 0.0, 0.0)),
                "group": int(attrs.get("group", 0)),
            }
        )
    sites = [
        {"name": s.get("name"), "pos": _floats(s.get("pos"), (0.0, 0.0, 0.0))}
        for s in el.findall("site")
        if s.get("name")
    ]
    return Body(
        name=el.get("name"),
        pos=_floats(el.get("pos"), (0.0, 0.0, 0.0)),
        quat=_floats(el.get("quat"), (1.0, 0.0, 0.0, 0.0)),
        joints=joints,
        geoms=geoms,
        sites=sites,
        children=[_parse_body(b, defaults) for b in el.findall("body")],
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


def _collect_sites(bodies):
    """site 名 → {body, pos}（pos 为 body 局部系）。"""
    out = {}

    def walk(b):
        for s in b.sites:
            out[s["name"]] = {"body": b.name, "pos": s["pos"]}
        for c in b.children:
            walk(c)

    for r in bodies:
        walk(r)
    return out


def _collect_tendons(root):
    """spatial 肌腱名 → [site 名]（按声明顺序；<geom> 包裹点不参与示意线）。"""
    out = {}
    for tendon in root.iter("tendon"):
        for sp in tendon.findall("spatial"):
            name = sp.get("name")
            if not name:
                continue
            pts = []
            for child in sp:
                if child.tag == "site" and child.get("site"):
                    pts.append(child.get("site"))
            if len(pts) >= 2:
                out[name] = pts
    return out


def _collect_actuators(root):
    """执行器名 → tendon 名（只保留引用肌腱的执行器；MuJoCo 的肌肉均由肌腱驱动）。"""
    out = {}
    for actuator in root.iter("actuator"):
        for el in actuator:
            name = el.get("name")
            tendon = el.get("tendon")
            if name and tendon:
                out[name] = tendon
    return out


def parse_mjcf(xml_path):
    """返回 {bodies, meshes, sites, tendons, actuators}；路径相对 XML 所在目录（上游为仓库根）。"""
    xml_path = os.path.normpath(os.path.abspath(xml_path))
    base_dir = os.path.dirname(xml_path)
    root = ET.parse(xml_path).getroot()
    _resolve_includes(root, base_dir)
    defaults = _collect_defaults(root)

    meshes = {}
    for asset in root.iter("asset"):
        for m in asset.findall("mesh"):
            if m.get("name") and m.get("file"):
                meshes[m.get("name")] = m.get("file").replace("\\", "/")

    bodies = [_parse_body(b, defaults) for b in root.find("worldbody").findall("body")]

    def fill_files(b):
        for g in b.geoms:
            g["file"] = meshes.get(g["mesh"])
        for c in b.children:
            fill_files(c)

    for r in bodies:
        fill_files(r)
    return {
        "bodies": bodies,
        "meshes": meshes,
        "sites": _collect_sites(bodies),
        "tendons": _collect_tendons(root),
        "actuators": _collect_actuators(root),
    }
