"""轨迹求值：[u%, value] 关键点线性插值。

u 为归一化时间百分比（0~100，与场景 YAML 一致）；
value 为标量（关节角 deg / 激活度 / 下沉 m）或 3 向量 [fx, fy, fz]（外力 N）。
轨迹域外取端点值（平顶钳位）。
行类型须一致（2 元标量行或 4 元向量行），u 须按升序排列。
"""


def _val(row):
    """行 [u, v] → 标量；行 [u, fx, fy, fz] → 3 向量。"""
    if len(row) == 2:
        return float(row[1])
    return [float(x) for x in row[1:4]]


def eval_track(track, u):
    """在轨迹 track 上求 u 百分比处的值。u 超界取端点；分段线性插值。"""
    if u <= track[0][0]:
        return _val(track[0])
    if u >= track[-1][0]:
        return _val(track[-1])
    for a, b in zip(track, track[1:]):
        if a[0] <= u <= b[0]:
            if u == b[0]:
                return _val(b)
            w = (u - a[0]) / (b[0] - a[0])
            va, vb = _val(a), _val(b)
            if isinstance(va, list):
                return [va[i] + (vb[i] - va[i]) * w for i in range(3)]
            return float(va + (vb - va) * w)
    return _val(track[-1])  # 理论不可达（u 已在域内）
