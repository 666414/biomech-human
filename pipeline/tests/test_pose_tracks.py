from pipeline.pose_tracks import eval_track


def test_scalar_interpolation_midpoint():
    tr = [[0, 10], [100, 20]]
    assert eval_track(tr, 50) == 15.0


def test_scalar_clamps_outside_domain():
    tr = [[20, 5], [80, 9]]
    assert eval_track(tr, 0) == 5.0
    assert eval_track(tr, 100) == 9.0


def test_vector_interpolation():
    tr = [[0, 0, 0, 0], [100, 10, -20, 30]]
    assert eval_track(tr, 50) == [5.0, -10.0, 15.0]


def test_multiple_keyframes_piecewise():
    tr = [[0, 0], [50, 10], [100, 0]]
    assert eval_track(tr, 25) == 5.0
    assert eval_track(tr, 75) == 5.0


def test_returns_float_not_int():
    tr = [[0, 3], [100, 3]]
    assert isinstance(eval_track(tr, 40), float)
