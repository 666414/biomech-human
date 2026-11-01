import pytest
import mujoco
from pipeline.scene_loader import load_scene, validate_against_model, SceneConfig

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


def write_yaml(tmp_path, text):
    p = tmp_path / "scene.yaml"
    p.write_text(text, encoding="utf-8")
    return str(p)


def test_load_mini_scene(tmp_path):
    scene = load_scene(write_yaml(tmp_path, MINI_YAML))
    assert scene.name == "mini"
    assert scene.duration == 0.2
    assert scene.sim_stride == 10
    assert scene.muscles == ["tibant_r"]
    assert scene.ground_mode == "auto"
    assert scene.ground_target_grf == 1.0
    assert scene.sink_track is None


def test_missing_field_raises(tmp_path):
    bad = MINI_YAML.replace("duration: 0.2\n", "")
    with pytest.raises(ValueError, match="duration"):
        load_scene(write_yaml(tmp_path, bad))


def test_u_out_of_range_raises(tmp_path):
    bad = MINI_YAML.replace("[100, 10]", "[110, 10]")
    with pytest.raises(ValueError, match="0,100"):
        load_scene(write_yaml(tmp_path, bad))


def test_u_not_increasing_raises(tmp_path):
    bad = MINI_YAML.replace("[100, 10]", "[50, 5], [40, 10]")
    with pytest.raises(ValueError, match="递减"):
        load_scene(write_yaml(tmp_path, bad))


def test_muscle_track_not_in_muscles_raises(tmp_path):
    bad = MINI_YAML.replace("muscles: [tibant_r]", "muscles: [gaslat_r]")
    with pytest.raises(ValueError, match="muscles"):
        load_scene(write_yaml(tmp_path, bad))


def test_too_many_muscles_raises(tmp_path):
    bad = MINI_YAML.replace(
        "muscles: [tibant_r]",
        "muscles: [a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11]",
    )
    with pytest.raises(ValueError, match="1~10"):
        load_scene(write_yaml(tmp_path, bad))


def test_keyframe_t_out_of_duration_raises(tmp_path):
    bad = MINI_YAML.replace("t: 0.1", "t: 0.5")
    with pytest.raises(ValueError, match="时长"):
        load_scene(write_yaml(tmp_path, bad))


def test_pelvis_ty_in_pose_tracks_raises(tmp_path):
    bad = MINI_YAML.replace("  hip_flexion_r: [[0, 0], [100, 10]]",
                            "  pelvis_ty: [[0, 0], [100, -0.02]]")
    with pytest.raises(ValueError, match="pelvis_ty"):
        load_scene(write_yaml(tmp_path, bad))


def test_force_track_format(tmp_path):
    yml = MINI_YAML + (
        "external_forces:\n"
        "  - body: hand_r\n"
        "    track: [[0, 0, 0, 0], [100, 0, 0, -150]]\n"
    )
    scene = load_scene(write_yaml(tmp_path, yml))
    assert scene.external_forces[0]["body"] == "hand_r"
    bad = yml.replace("[100, 0, 0, -150]", "[100, -150]")
    with pytest.raises(ValueError, match="fz"):
        load_scene(write_yaml(tmp_path, bad))


def test_validate_against_model_ok(tmp_path):
    scene = load_scene(write_yaml(tmp_path, MINI_YAML))
    m = mujoco.MjModel.from_xml_path(scene.xml)
    validate_against_model(scene, m)  # 不抛异常即通过


def test_validate_against_model_unknown_joint(tmp_path):
    bad = MINI_YAML.replace("hip_flexion_r: [[0, 0], [100, 10]]",
                            "no_such_joint: [[0, 0], [100, 10]]")
    scene = load_scene(write_yaml(tmp_path, bad))
    m = mujoco.MjModel.from_xml_path(scene.xml)
    with pytest.raises(ValueError, match="no_such_joint"):
        validate_against_model(scene, m)


def test_validate_unknown_muscle(tmp_path):
    bad = MINI_YAML.replace("tibant_r", "no_muscle")
    scene = load_scene(write_yaml(tmp_path, bad))
    m = mujoco.MjModel.from_xml_path(scene.xml)
    with pytest.raises(ValueError, match="no_muscle"):
        validate_against_model(scene, m)
