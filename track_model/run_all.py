# -*- coding: utf-8 -*-
"""一键运行全部仿真场景并出图（方案 5.2 / 5.3）。

用法： python run_all.py
输出： ../outputs/*.png ，并在 stdout 打印各场景关键定量结论（JSON）。
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(sys.executable).parent.parent.parent))
from daimon_runtime import setup_plot
setup_plot()

import json

sys.path.insert(0, str(Path(__file__).parent))

import track as trk
import plots
import scenarios as sc

OUTDIR = Path(__file__).parent.parent / "outputs"
OUTDIR.mkdir(exist_ok=True)


def main():
    summary = {}

    # 5.3-1 B 场等值线俯视图（直道 + 弯道）
    plots.contour_B(trk.straight_track(half=1.5), OUTDIR / "01a_B场等值线_直道.png",
                    "直道 B 场等值线俯视图（|B|，z=7 cm 平面）",
                    extent=(-0.5, 0.5, -1.2, 1.2))
    plots.contour_B(trk.curve_track(0.5), OUTDIR / "01b_B场等值线_弯道R50.png",
                    "弯道 R=50 cm B 场等值线俯视图（|B|，z=7 cm 平面）",
                    extent=(-0.6, 1.2, -0.8, 1.0))
    summary["B场等值线"] = "01a/01b 已生成"

    # P0
    summary["P0_横向扫描"] = sc.p0_lateral(OUTDIR)
    summary["P0_高度衰减"] = sc.p0_height(OUTDIR)

    # P1
    summary["P1_弯道M1波形"] = sc.p1_curve(OUTDIR)
    summary["P1_前瞻对比"] = sc.p1_foresee(OUTDIR)

    # P2
    summary["P2_十字"] = sc.p2_cross(OUTDIR)
    summary["P2_环岛"] = sc.p2_roundabout(OUTDIR)

    print(json.dumps(summary, ensure_ascii=False, indent=2, default=float))


if __name__ == "__main__":
    main()
