import os
import tempfile
import trimesh
from pipeline.mjcf_parser import parse_mjcf
from pipeline.mesh_assembler import assemble
from pipeline.glb_export import export_glb

REPO = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..", "assets", "MS-Human-700"))
LOCO = os.path.join(REPO, "MS-Human-700-Locomotion.xml")


def test_export_and_roundtrip():
    tree = parse_mjcf(LOCO)
    scene, node_bodies = assemble(tree, REPO)
    with tempfile.TemporaryDirectory() as tmp:
        out = os.path.join(tmp, "human.glb")
        export_glb(scene, out)
        assert os.path.getsize(out) > 0
        reloaded = trimesh.load(out)
        nodes = set(reloaded.graph.nodes)
        assert "pelvis" in nodes
        assert len(node_bodies) == 80
