"""P2 集成验收：5 场景全跑 → 体积 / GRF 量级 / keyframes / 可重复性。"""
import glob
import json
import os
import pytest
from pipeline.run_scene import run_scene, check_repeatability, sha256_of

SCENES_DIR = os.path.normpath(os.path.join(
    os.path.dirname(__file__), "..", "scenes"))
OUT_DIR = os.path.normpath(os.path.join(
    os.path.dirname(__file__), "..", "out", "scenes", "test"))

EXPECTED = {
    "gait_cycle": {"frames": 61, "grf_min_max": 100.0},
    "drop_landing": {"frames": 51, "grf_min_max": 800.0},
    "lift_task": {"frames": 101, "grf_min_max": 200.0},
    "shoulder_abduction": {"frames": 76, "grf_min_max": 200.0},
    "ankle_inversion": {"frames": 41, "grf_min_max": 200.0},
}


@pytest.fixture(scope="module", autouse=True)
def run_all(tmp_path_factory):
    out = str(tmp_path_factory.mktemp("scenes_out"))
    for yml in sorted(glob.glob(os.path.join(SCENES_DIR, "*.yaml"))):
        run_scene(yml, out)
    yield out


def test_all_five_jsons_exist(run_all):
    for name in EXPECTED:
        assert os.path.isfile(os.path.join(run_all, f"{name}.json")), name


def test_frames_and_size(run_all):
    for name, exp in EXPECTED.items():
        with open(os.path.join(run_all, f"{name}.json"), "r", encoding="utf-8") as f:
            data = json.load(f)
        assert data["frames"] == exp["frames"], name
        assert os.path.getsize(os.path.join(run_all, f"{name}.json")) < 2 * 1024 * 1024


def test_grf_magnitude(run_all):
    for name, exp in EXPECTED.items():
        with open(os.path.join(run_all, f"{name}.json"), "r", encoding="utf-8") as f:
            data = json.load(f)
        grf_z_max = max(row[2] for row in data["series"]["grf"])
        assert grf_z_max > exp["grf_min_max"], (name, grf_z_max)
        assert grf_z_max < 8000.0, (name, grf_z_max)  # 量级守卫（< 14 体重）


def test_keyframes_present(run_all):
    for name in EXPECTED:
        with open(os.path.join(run_all, f"{name}.json"), "r", encoding="utf-8") as f:
            data = json.load(f)
        assert len(data["keyframes"]) >= 2, name
        for kf in data["keyframes"]:
            assert 0.0 <= kf["t"] <= data["duration"]


def test_gait_repeatable():
    yml = os.path.join(SCENES_DIR, "gait_cycle.yaml")
    h = check_repeatability(yml,
                            os.path.join(OUT_DIR, "_rep_a"),
                            os.path.join(OUT_DIR, "_rep_b"))
    assert len(h) == 64
