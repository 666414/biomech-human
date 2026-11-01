"""场景 → GLB（glTF 2.0 二进制）。Draco 压缩延后到 P5（gltf-transform，需 Node.js）。"""
import trimesh


def export_glb(scene, out_path):
    data = trimesh.exchange.gltf.export_glb(scene)
    with open(out_path, "wb") as f:
        f.write(data)
    return out_path
