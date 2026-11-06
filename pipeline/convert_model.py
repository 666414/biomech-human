"""CLI：python -m pipeline.convert_model --xml <主XML> --root <仓库根> --out <输出目录>"""
import argparse
import json
import os


def main():
    ap = argparse.ArgumentParser(description="MS-Human-700 → glTF 转换器")
    ap.add_argument("--xml", required=True, help="主 MuJoCo XML 路径")
    ap.add_argument("--root", required=True, help="网格路径基准目录（上游为仓库根）")
    ap.add_argument("--out", required=True, help="输出目录")
    ap.add_argument("--exclude-prefix", default=[], nargs="*", help="按前缀排除 body（肌肉瘦身用）")
    args = ap.parse_args()

    from pipeline.mjcf_parser import parse_mjcf
    from pipeline.mesh_assembler import assemble
    from pipeline.muscle_meta import build_muscle_meta
    from pipeline.rig_meta import build_rig_meta
    from pipeline.glb_export import export_glb
    from pipeline.validate import validate_output

    os.makedirs(args.out, exist_ok=True)
    tree = parse_mjcf(args.xml)
    scene, node_bodies = assemble(tree, args.root, exclude_prefixes=args.exclude_prefix)
    with open(os.path.join(os.path.dirname(__file__), "part_name_zh.json"), encoding="utf-8") as f:
        zh_map = json.load(f)
    meta = build_rig_meta(tree, zh_map)
    muscle_meta = build_muscle_meta(tree)

    glb_path = os.path.join(args.out, "human.glb")
    meta_path = os.path.join(args.out, "rig-meta.json")
    muscle_path = os.path.join(args.out, "muscle-meta.json")
    export_glb(scene, glb_path)
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    with open(muscle_path, "w", encoding="utf-8") as f:
        json.dump(muscle_meta, f, ensure_ascii=False, separators=(",", ":"))

    issues = validate_output(tree, meta, glb_path)
    size_mb = os.path.getsize(glb_path) / 1024 / 1024
    print(
        f"bodies={len(node_bodies)} geoms={len(scene.geometry)} "
        f"muscles={len(muscle_meta['muscles'])} glb={size_mb:.1f}MB"
    )
    if issues:
        print("校验失败:")
        for i in issues:
            print(" -", i)
        raise SystemExit(1)
    print("校验通过 ✓")
    print(f"产出: {glb_path} / {meta_path} / {muscle_path}")


if __name__ == "__main__":
    main()
