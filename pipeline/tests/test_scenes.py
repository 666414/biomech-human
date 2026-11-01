"""P2 集成验收：5 场景全跑 → 体积 / GRF 量级 / keyframes / 可重复性。"""
import glob
import json
import os
import pytest
from pipeline.run_scene import run_scene, check_repeatability, sha256_of

SCENES_DIR = os.path.normpath(os.path.join(
    os.path.dirname(__file__), "..", "scenes"))

# grf_peak_min：全场景 GRF_z 峰值下限（N）；量级上限统一 8000N。
EXPECTED = {
    "gait_cycle": {"frames": 61, "grf_peak_min": 2000.0},
    "drop_landing": {"frames": 51, "grf_peak_min": 800.0},
    "lift_task": {"frames": 101, "grf_peak_min": 200.0},
    "shoulder_abduction": {"frames": 76, "grf_peak_min": 200.0},
    "ankle_inversion": {"frames": 41, "grf_peak_min": 200.0},
}
# 接触连续性：站立类场景全帧不得失接触；drop_landing 起始腾空窗口上限（帧）。
STANDING_SCENES = ("gait_cycle", "lift_task", "shoulder_abduction", "ankle_inversion")
DROP_AIRBORNE_MAX_FRAMES = 15


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
        assert grf_z_max > exp["grf_peak_min"], (name, grf_z_max)
        assert grf_z_max < 8000.0, (name, grf_z_max)  # 量级守卫（< 14 体重）


def test_contact_continuity(run_all):
    """接触连续性验收：站立场景全帧 GRF_z > 0；drop_landing 仅允许起始腾空，
    首次触地后不得再失接触（接触丢失 = 骨盆相对足底悬空，教学数据不可用）。"""
    for name in EXPECTED:
        with open(os.path.join(run_all, f"{name}.json"), "r", encoding="utf-8") as f:
            data = json.load(f)
        grf_z = [row[2] for row in data["series"]["grf"]]
        zero_frames = [i for i, z in enumerate(grf_z) if z <= 0.0]
        if name in STANDING_SCENES:
            assert not zero_frames, (name, zero_frames)
        else:  # drop_landing：起始腾空窗口 + 触地后连续接触
            first = min(i for i, z in enumerate(grf_z) if z > 0.0)
            assert first <= DROP_AIRBORNE_MAX_FRAMES, (name, first)
            assert not zero_frames[first:], (name, zero_frames[first:])


def test_keyframes_present(run_all):
    for name in EXPECTED:
        with open(os.path.join(run_all, f"{name}.json"), "r", encoding="utf-8") as f:
            data = json.load(f)
        assert len(data["keyframes"]) >= 2, name
        for kf in data["keyframes"]:
            assert 0.0 <= kf["t"] <= data["duration"]


def test_gait_repeatable(tmp_path):
    yml = os.path.join(SCENES_DIR, "gait_cycle.yaml")
    h = check_repeatability(yml,
                            str(tmp_path / "_rep_a"),
                            str(tmp_path / "_rep_b"))
    assert len(h) == 64
