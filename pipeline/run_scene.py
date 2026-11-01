"""P2 CLI：跑教学场景 → scenes/*.json；含可重复性校验（sha256 逐字节比对）。

用法（仓库根）：
  python -m pipeline.run_scene --scene pipeline/scenes/gait_cycle.yaml --out pipeline/out/scenes
  python -m pipeline.run_scene --all pipeline/scenes --out pipeline/out/scenes
  python -m pipeline.run_scene --scene ... --out ... --check-repeatability
"""
import argparse
import glob
import hashlib
import os
import shutil


def sha256_of(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        h.update(f.read())
    return h.hexdigest()


def run_scene(scene_path, out_dir):
    """加载 → 校验 → 仿真 → 导出。返回产物路径。"""
    import mujoco
    from pipeline.scene_loader import load_scene, validate_against_model
    from pipeline.simulate_scene import simulate
    from pipeline.export_scene import export_json

    scene = load_scene(scene_path)
    m = mujoco.MjModel.from_xml_path(scene.xml)
    validate_against_model(scene, m)
    result = simulate(scene)
    return export_json(result, out_dir)


def check_repeatability(scene_path, tmp_a, tmp_b):
    """同一场景跑两次，输出须逐字节一致；返回 sha256。"""
    pa = run_scene(scene_path, tmp_a)
    pb = run_scene(scene_path, tmp_b)
    ha, hb = sha256_of(pa), sha256_of(pb)
    if ha != hb:
        raise RuntimeError(f"可重复性校验失败：{ha} != {hb}")
    return ha


def main(argv=None):
    ap = argparse.ArgumentParser(description="P2 教学场景仿真预计算")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--scene", help="单个场景 YAML 路径")
    g.add_argument("--all", dest="all_dir", help="批量目录（所有 *.yaml）")
    ap.add_argument("--out", required=True, help="输出目录")
    ap.add_argument("--check-repeatability", action="store_true",
                    help="配合 --scene：跑两次并校验输出逐字节一致")
    args = ap.parse_args(argv)
    if args.scene:
        path = run_scene(args.scene, args.out)
        print(f"OK {path} ({os.path.getsize(path)} bytes)")
        if args.check_repeatability:
            out_norm = os.path.normpath(args.out)
            tmp_a, tmp_b = out_norm + "_rep_a", out_norm + "_rep_b"
            h = check_repeatability(args.scene, tmp_a, tmp_b)
            shutil.rmtree(tmp_a)
            shutil.rmtree(tmp_b)
            print(f"REPEATABLE sha256={h}")
    else:
        yamls = sorted(glob.glob(os.path.join(args.all_dir, "*.yaml")))
        if not yamls:
            ap.error(f"目录 {args.all_dir} 中未找到 *.yaml")
        for yml in yamls:
            path = run_scene(yml, args.out)
            print(f"OK {path} ({os.path.getsize(path)} bytes)")


if __name__ == "__main__":
    main()
