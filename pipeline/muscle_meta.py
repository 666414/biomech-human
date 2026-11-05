"""生成 muscle-meta.json：肌肉示意线数据（执行器 → 肌腱 → 站点路径）。

MuJoCo 的肌肉没有可视几何，只有执行器与肌腱。这里把每个执行器引用的
spatial 肌腱按站点顺序展开为折线，站点坐标记录为「所属 body + body 局部坐标」。
前端据此在 body 节点之间生成肌肉管，随骨骼运动实时更新。

输出契约：
  {"muscles": {"<执行器名>": {"tendon": "<肌腱名>", "points": [{"body": str, "pos": [x,y,z]}]}}}
"""


def build_muscle_meta(tree):
    sites = tree["sites"]
    tendons = tree["tendons"]
    muscles = {}
    for muscle, tendon in tree["actuators"].items():
        refs = tendons.get(tendon)
        if not refs:
            continue
        points = []
        for site_name in refs:
            site = sites.get(site_name)
            if not site:
                continue
            points.append({"body": site["body"], "pos": site["pos"]})
        # 两端不足两条的肌腱无法成线（单点/缺失），跳过
        if len(points) < 2:
            continue
        muscles[muscle] = {"tendon": tendon, "points": points}
    return {"muscles": muscles}
