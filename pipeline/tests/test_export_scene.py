import json
import os
import numpy as np
import pytest
from pipeline import export_scene
from pipeline.export_scene import export_json, _f32
from pipeline.scene_loader import SceneConfig
from pipeline.simulate_scene import simulate

XML = "assets/MS-Human-700/MS-Human-700.xml"


def mini_scene():
    return SceneConfig(
        name="mini", xml=XML, duration=0.2, sim_stride=10,
        muscles=["tibant_r"],
        pose_tracks={"hip_flexion_r": [[0, 5], [100, 15]]},
        muscle_tracks={"tibant_r": [[0, 0.1], [100, 0.3]]},
        external_forces=[],
        keyframes=[{"t": 0.1, "label": "测试", "cardId": "test_card"}],
        ground_mode="manual", ground_offset=-0.02,
    )


def test_f32_quantization():
    assert _f32(0.123456789) == float(np.float32(0.1235))
    assert _f32(-3.45678) == float(np.float32(-3.4568))


def test_export_structure(tmp_path):
    r = simulate(mini_scene())
    path = export_json(r, str(tmp_path))
    assert os.path.basename(path) == "mini.json"
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    assert data["scene"] == "mini"
    assert data["fps"] == 50.0
    assert data["frames"] == 11
    assert len(data["joints"]) == 85
    assert data["muscles"] == ["tibant_r"]
    s = data["series"]
    assert len(s["time"]) == 11
    assert len(s["qpos"]) == 11 and len(s["qpos"][0]) == 85
    assert len(s["qfrc_actuator"]) == 11 and len(s["qfrc_actuator"][0]) == 85
    assert len(s["muscle_act"]) == 11 and len(s["muscle_act"][0]) == 1
    assert len(s["grf"]) == 11 and len(s["grf"][0]) == 3
    # %MVC：act 0.3 → 30
    assert s["muscle_act"][-1][0] == pytest.approx(30.0, abs=0.01)
    assert data["keyframes"][0]["cardId"] == "test_card"


def test_export_under_2mb(tmp_path):
    r = simulate(mini_scene())
    path = export_json(r, str(tmp_path))
    assert os.path.getsize(path) < 2 * 1024 * 1024


def test_export_size_guard(tmp_path, monkeypatch):
    monkeypatch.setattr(export_scene, "MAX_JSON_BYTES", 10)
    r = simulate(mini_scene())
    with pytest.raises(RuntimeError, match="2MB"):
        export_json(r, str(tmp_path))


def test_export_nan_raises(tmp_path):
    r = simulate(mini_scene())
    r.grf[0, 0] = float("nan")
    with pytest.raises(ValueError):
        export_json(r, str(tmp_path))
