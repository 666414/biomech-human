import os
import pytest
from pipeline.run_scene import main, run_scene, check_repeatability, sha256_of

XML = "assets/MS-Human-700/MS-Human-700.xml"

MINI_YAML = """\
name: mini
xml: {xml}
duration: 0.2
sim_stride: 10
muscles: [tibant_r]
pose_tracks:
  hip_flexion_r: [[0, 0], [100, 10]]
muscle_tracks:
  tibant_r: [[0, 0.1], [100, 0.2]]
keyframes:
  - {{t: 0.1, label: 测试, cardId: test_card}}
""".format(xml=XML)


@pytest.fixture
def mini_yaml(tmp_path):
    p = tmp_path / "mini.yaml"
    p.write_text(MINI_YAML, encoding="utf-8")
    return str(p)


def test_run_scene_produces_json(mini_yaml, tmp_path):
    out = str(tmp_path / "out")
    path = run_scene(mini_yaml, out)
    assert os.path.isfile(path)
    assert os.path.getsize(path) > 1000


def test_check_repeatability_passes(mini_yaml, tmp_path):
    h = check_repeatability(mini_yaml,
                            str(tmp_path / "a"), str(tmp_path / "b"))
    assert len(h) == 64  # sha256 hex


def test_cli_single(mini_yaml, tmp_path, capsys):
    main(["--scene", mini_yaml, "--out", str(tmp_path / "cli_out")])
    assert "OK" in capsys.readouterr().out


def test_cli_repeatability_flag(mini_yaml, tmp_path, capsys):
    main(["--scene", mini_yaml, "--out", str(tmp_path / "cli_out"),
          "--check-repeatability"])
    assert "REPEATABLE" in capsys.readouterr().out


def test_cli_batch(mini_yaml, tmp_path, capsys):
    batch = tmp_path / "scenes"
    batch.mkdir()
    (batch / "mini.yaml").write_text(MINI_YAML, encoding="utf-8")
    main(["--all", str(batch), "--out", str(tmp_path / "cli_out")])
    out = capsys.readouterr().out
    assert out.count("OK") == 1
