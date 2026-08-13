# -*- coding: utf-8 -*-
"""标定拟合框架（方案 6 节）。

用法：
    python calib.py [标定数据文件.xlsx/.csv]

- 有实测数据（Excel/CSV，列：e_cm, L1, R1, M1, ...，单位任意 ADC 计数）时：
  以仿真 U(e) 曲线形状为基，最小二乘拟合综合系数 k、高度残差 dh、M1 倾角残差。
- 无实测数据时：用仿真加噪生成"伪实测"数据自测拟合流程（验证框架可运行）。

拟合参数将写回 sensor.py 的 K_DEFAULT / 布局参数（当前仅打印建议值，不自动改文件）。
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import numpy as np

import field as fld
import sensor as sns

CHANNELS = ["L1", "R1", "M1"]


def sim_curve(e, h, s1, tilt_deg=0.0):
    """直道（无限长解析解）各通道 |B·n̂| 曲线形状（k=1）。

    tilt_deg: M1 敏感轴绕 y 轴的安装倾角残差（理想为纯 x 方向）。
    """
    e = np.asarray(e, dtype=float)
    out = {}
    for name, xoff in [("L1", -s1), ("R1", s1), ("M1", 0.0)]:
        B = fld.infinite_wire(np.column_stack([e + xoff, np.zeros_like(e),
                                               np.full_like(e, h)]))
        if name == "M1":
            a = np.array([np.cos(np.radians(tilt_deg)), 0.0,
                          np.sin(np.radians(tilt_deg))])
            out[name] = np.abs(B @ a)
        else:
            out[name] = np.abs(B[:, 2])
    return out


def fit(meas):
    """最小二乘拟合 k、高度残差 dh、M1 倾角残差。meas: dict 含 e 与各通道实测值。"""
    e = np.asarray(meas["e"], dtype=float)
    s1 = 0.22
    best = None
    # 高度残差 / 倾角残差网格搜索 + 内层线性最小二乘求 k
    for dh in np.linspace(-0.02, 0.02, 41):
        for tilt in np.linspace(-10, 10, 41):
            sim = sim_curve(e, 0.07 + dh, s1, tilt)
            sse, ks = 0.0, {}
            for ch in CHANNELS:
                y = np.asarray(meas[ch], dtype=float)
                k = float((y @ sim[ch]) / (sim[ch] @ sim[ch]))
                ks[ch] = k
                sse += float(((y - k * sim[ch]) ** 2).sum())
            if best is None or sse < best[0]:
                best = (sse, dh, tilt, ks)
    sse, dh, tilt, ks = best
    return dict(k=ks, dh_m=dh, tilt_deg=tilt, sse=sse)


def load_table(path):
    import pandas as pd
    path = Path(path)
    df = pd.read_excel(path) if path.suffix.lower() in (".xlsx", ".xls") else pd.read_csv(path)
    meas = {"e": df["e_cm"].to_numpy() / 100.0}
    for ch in CHANNELS:
        meas[ch] = df[ch].to_numpy(dtype=float)
    return meas


def self_test():
    """无实测数据：仿真生成伪实测（k_true、高度/倾角残差 + 3% 噪声）自测流程。"""
    rng = np.random.default_rng(42)
    e = np.arange(-0.20, 0.2001, 0.05)
    k_true, dh_true, tilt_true = 4.2e6, 0.006, 4.0   # k 使输出量级类似 ADC 计数
    sim = sim_curve(e, 0.07 + dh_true, 0.22, tilt_true)
    meas = {"e": e}
    for ch in CHANNELS:
        meas[ch] = k_true * sim[ch] * (1 + 0.03 * rng.standard_normal(len(e)))
    res = fit(meas)
    print("== 标定框架自测（仿真伪实测数据）==")
    print(f"真值: k={k_true:.3g}, dh={dh_true*100:.1f} cm, tilt={tilt_true:.1f}°")
    print(f"拟合: k={ {c: round(v, 3) for c, v in res['k'].items()} }, "
          f"dh={res['dh_m']*100:.2f} cm, tilt={res['tilt_deg']:.1f}°, SSE={res['sse']:.4g}")
    rel = abs(np.mean(list(res['k'].values())) - k_true) / k_true
    print(f"k 相对误差: {rel*100:.1f}%  ->  {'自测通过' if rel < 0.10 else '自测失败'}")
    return rel < 0.10


def main():
    if len(sys.argv) > 1 and Path(sys.argv[1]).exists():
        res = fit(load_table(sys.argv[1]))
        print("== 实测数据拟合结果 ==")
        print(f"k = {res['k']}")
        print(f"高度残差 dh = {res['dh_m']*100:.2f} cm, M1 倾角残差 = {res['tilt_deg']:.1f}°")
        print("建议：将 K_DEFAULT 与布局参数按上表写回 sensor.py 后重跑 run_all.py")
    else:
        print("未提供实测数据文件，运行自测流程。")
        ok = self_test()
        sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
