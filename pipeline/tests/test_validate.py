import os
import tempfile
import pytest
from pipeline.mjcf_parser import parse_mjcf, collect_body_names
from pipeline.mesh_assembler import assemble
from pipeline.rig_meta import build_rig_meta
from pipeline.glb_export import export_glb
from pipeline.validate import validate_output

REPO = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..", "assets", "MS-Human-700"))
LOCO = os.path.join(REPO, "MS-Human-700-Locomotion.xml")


@pytest.fixture(scope="module")
def valid_outputs(tmp_path_factory):
    tree = parse_mjcf(LOCO)
    scene, _ = assemble(tree, REPO)
    out_dir = tmp_path_factory.mktemp("out")
    glb = export_glb(scene, os.path.join(out_dir, "human.glb"))
    meta = build_rig_meta(tree, zh_map={})
    return tree, meta, glb


def test_valid_output_passes(valid_outputs):
    tree, meta, glb = valid_outputs
    issues = validate_output(tree, meta, glb)
    assert issues == []


def test_tampered_meta_fails(valid_outputs):
    tree, meta, glb = valid_outputs
    meta["parts"][5]["id"] = "hacked"
    issues = validate_output(tree, meta, glb)
    assert any("rig-meta" in i for i in issues)


def test_missing_glb_fails(valid_outputs):
    tree, meta, _ = valid_outputs
    issues = validate_output(tree, meta, "Z:/no/such.glb")
    assert len(issues) > 0
