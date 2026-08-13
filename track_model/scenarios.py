# -*- coding: utf-8 -*-
"""仿真场景（方案 5.2）：

P0  直道横向扫描 e∈[−25,+25]cm 步长 1cm；高度衰减 h∈[2,12]cm
P1  弯道 R=50/80/120cm（驱动全程竖直电感波形 + 弯顶扫 e/ψ）；前瞻电感 d∈[20,40]cm 对比
P2  十字交叉全过程；环岛入环点
（P3 坡道可选做：等效为 h 变化，P0 高度扫描已覆盖其一阶效应）

每个函数返回关键定量结论 dict，并保存 PNG 到 outputs/。
"""
from __future__ import annotations

import numpy as np

import field as fld
import sensor as sns
import track as trk
import plots

I = fld.I_DEFAULT


def _field_fn(track):
    mids, dls = track.elements()
    return lambda P: fld.biot_savart(P, mids, dls, I)


def _drive(track, sensors, s0, s1_, e=0.0, psi=0.0, ds=0.005):
    """沿赛道中线 [s0, s1_] 弧长区间驱动，逐点读取全部电感。

    返回 (s_rel[N] 相对 s0 起点的弧长, dict name -> array)。
    """
    pts, tang, s = trk.Track.sample_path(track, ds)
    mask = (s >= s0) & (s <= s1_)
    pts, tang, s = pts[mask], tang[mask], s[mask]
    fn = _field_fn(track)
    out = {sn.name: [] for sn in sensors}
    for p, t in zip(pts, tang):
        o, f, r = sns.pose_from_tangent(p, t, e, psi)
        u = sns.read_sensors(fn, o, f, r, sensors)
        for k_, v in u.items():
            out[k_].append(v)
    return s - s0, {k_: np.asarray(v) for k_, v in out.items()}


def _err(U, L, R):
    den = U[L] + U[R]
    return (U[L] - U[R]) / np.maximum(den, 1e-30)


# ------------------------------------------------------------- P0 直道

def p0_lateral(outdir, h=0.07, layout_kw=None):
    """P0a：直道横向扫描 e∈[−25,+25] cm，步长 1 cm。"""
    kw = dict(h=h); kw.update(layout_kw or {})
    sensors = sns.default_layout(**kw)
    e = np.arange(-0.25, 0.2501, 0.01)
    U = {}
    for sn in sensors:  # 直道用无限长解析解；ψ=0 时敏感轴方向不变
        b = fld.infinite_wire(np.column_stack(
            [e + sn.pos[0], np.zeros_like(e), np.full_like(e, sn.pos[2])]), I=I)
        U[sn.name] = np.abs(b @ sn.axis)
    plots.plot_Ue(e * 100, U, outdir / "02_Ue响应曲线族_直道.png",
                  "P0 直道：各电感 U(e) 响应曲线族（h=%.0f cm）" % (h * 100))
    errs = {"err(L1,R1)": _err(U, "L1", "R1"), "err(L2,R2)": _err(U, "L2", "R2")}
    res = plots.plot_err(e * 100, errs, outdir / "03_归一化差值err_线性区.png",
                         "P0 直道：归一化差值 err(e) 与 ±15 cm 线性区")
    return {"h_cm": h * 100, "s1_cm": kw.get("s1", 0.22) * 100,
            "s2_cm": kw.get("s2", 0.30) * 100, "err_fit": res}


def p0_height(outdir, h_range=(0.02, 0.12), nh=21, e0=0.0, layout_kw=None):
    """P0b：高度衰减 h∈[2,12] cm（车居中 e=0）。"""
    hs = np.linspace(h_range[0], h_range[1], nh)
    U = {"L1": [], "R1": [], "M1": [], "F1": []}
    kw = dict(layout_kw or {})
    for h in hs:
        sensors = sns.default_layout(h=h, **kw)
        for sn in sensors:
            if sn.name not in U:
                continue
            b = fld.infinite_wire(np.array([[e0 + sn.pos[0], 0.0, sn.pos[2]]]), I=I)
            U[sn.name].append(abs(b[0] @ sn.axis))
    U = {k_: np.asarray(v) for k_, v in U.items()}
    plots.plot_height(hs * 100, U, outdir / "04_高度衰减_Uh.png",
                      "P0 直道：安装高度衰减（e=0 居中）")
    return {"衰减比_h12/h2": {k_: float(v[-1] / v[0]) for k_, v in U.items()}}


# ------------------------------------------------------------- P1 弯道

def p1_curve(outdir, Rs=(0.50, 0.80, 1.20), h=0.07):
    """P1a：弯道驱动全程波形（竖直电感 M1 + 前瞻不对称度 F_err）；
    P1b：弯顶扫 e 和 ψ。"""
    summary = {}
    m1_curves, s_axis = {}, None
    for R in Rs:
        track = trk.curve_track(R)
        sensors = sns.default_layout(h=h)
        entry = track.segments[0].length()
        arc = track.segments[1].length()
        s, U = _drive(track, sensors, entry - 0.50, entry + arc + 0.30)
        x = (s - 0.50) * 100  # 相对入弯点弧长，cm
        m1_curves[f"R={R*100:.0f}cm"] = U["M1"] * 1e6
        if s_axis is None or len(x) > len(s_axis):
            s_axis = x
        summary[f"R={R*100:.0f}cm"] = dict(
            入弯前M1_µT=float(U["M1"][0]) * 1e6,
            弯中M1最小_µT=float(U["M1"].min()) * 1e6,
            出弯后M1_µT=float(U["M1"][-1]) * 1e6)
    n = min(len(v) for v in m1_curves.values())
    m1_curves = {k_: v[:n] for k_, v in m1_curves.items()}
    plots.plot_multir(s_axis[:n], m1_curves, outdir / "05_弯道_竖直电感M1波形.png",
                      "P1 弯道：竖直电感 M1 波形（右转 90°，e=0 居中行驶）",
                      "相对入弯点弧长 (cm)", "M1 (µT, k=1)",
                      vspan=(0, 0.5 * np.pi / 2 * 100, "弯段（R=50 弧长）"))

    # P1a 补充：R=80 cm，带横向偏差 ±5 cm 时 M1 波形 + 前瞻 F_err
    R = 0.80
    track = trk.curve_track(R)
    sensors = sns.default_layout(h=h)
    entry = track.segments[0].length()
    arc = track.segments[1].length()
    top, x0 = {}, None
    for e in (-0.05, 0.0, 0.05):
        s, U = _drive(track, sensors, entry - 0.50, entry + arc + 0.30, e=e)
        x0 = (s - 0.50) * 100
        top[f"M1 (e={int(e*100):+d}cm)"] = U["M1"] * 1e6
        if abs(e) < 1e-9:
            ferr = (U["F2"] - U["F1"]) / np.maximum(U["F1"] + U["F2"], 1e-30)
    plots.plot_wave(x0, top, outdir / "05b_弯道特征_R80_带偏差.png",
                     "P1 弯道 R=80 cm：M1 波形与前瞻 F_err（入弯判据）",
                     "相对入弯点弧长 (cm)",
                     vspan=(0, arc * 100, "弯段"),
                     panel2={"F_err=(F2−F1)/(F2+F1)": ferr}, panel2_ylabel="F_err")
    i_bend = (x0 >= 0) & (x0 <= arc * 100)
    summary["R=80cm_特征"] = dict(
        弯中M1变化_e0=float((top["M1 (e=+0cm)"].max() - top["M1 (e=+0cm)"].min())
                          / top["M1 (e=+0cm)"].mean()),
        弯中M1变化_e5=float(max((top["M1 (e=-5cm)"].max() - top["M1 (e=-5cm)"].min())
                                / top["M1 (e=-5cm)"].mean(),
                                (top["M1 (e=+5cm)"].max() - top["M1 (e=+5cm)"].min())
                                / top["M1 (e=+5cm)"].mean())),
        弯中Ferr最大=float(np.abs(ferr[i_bend]).max()))

    # P1b：弯顶 e/ψ 扫描
    psi_list = [0.0, np.radians(10), np.radians(20)]
    for R in Rs:
        track = trk.curve_track(R)
        sensors = sns.default_layout(h=h)
        fn = _field_fn(track)
        pts, tang, s = trk.Track.sample_path(track, 0.005)
        entry = track.segments[0].length()
        idx = int(np.argmin(np.abs(s - (entry + track.segments[1].length() / 2))))
        es = np.arange(-0.25, 0.2501, 0.01)
        curves = {}
        for psi in psi_list:
            m1 = []
            for e in es:
                o, f, r = sns.pose_from_tangent(pts[idx], tang[idx], e, psi)
                m1.append(sns.read_sensors(fn, o, f, r, sensors)["M1"])
            curves[f"ψ={int(np.degrees(psi))}°"] = np.asarray(m1) * 1e6
        plots.plot_multir(es * 100, curves, outdir / f"06_弯顶M1_e_psi扫描_R{int(R*100)}cm.png",
                          f"P1 弯顶（R={R*100:.0f} cm）：M1 随 e、ψ 变化",
                          "横向偏差 e (cm)", "M1 (µT, k=1)")
    return summary


def p1_foresee(outdir, R=0.80, ds_front=(0.20, 0.30, 0.40), h=0.07, thr=0.10):
    """P1c：前瞻电感对比 d∈[20,40]cm —— 入弯信号提前量（F_err 越过阈值）。"""
    track = trk.curve_track(R)
    entry = track.segments[0].length()
    fn = _field_fn(track)
    pts, tang, s = trk.Track.sample_path(track, 0.005)
    mask = (s >= entry - 0.80) & (s <= entry + 0.30)
    pts, tang, s = pts[mask], tang[mask], s[mask]
    dist = (s - entry) * 100  # 距入弯点 (cm)，负=未到
    curves, advance = {}, {}
    for d in (0.05,) + tuple(ds_front):
        sensors = sns.default_layout(h=h, d=d)
        ferr = []
        for p, t in zip(pts, tang):
            o, f, r = sns.pose_from_tangent(p, t, 0.0, 0.0)
            u = sns.read_sensors(fn, o, f, r, sensors)
            ferr.append((u["F2"] - u["F1"]) / max(u["F1"] + u["F2"], 1e-30))
        ferr = np.asarray(ferr)
        lab = f"d={int(d*100)}cm" + ("（前排参考）" if d < 0.10 else "")
        curves[lab] = ferr
        pre = np.where((dist < 0) & (ferr >= thr))[0]
        advance[lab] = float(-dist[pre[0]]) if len(pre) else 0.0
    plots.plot_multir(dist, curves, outdir / "07_前瞻电感对比.png",
                      f"P1 入弯预判：前瞻不对称度 F_err（R={R*100:.0f} cm，阈值 {thr}）",
                      "距入弯点距离 (cm)", "F_err = (F2−F1)/(F1+F2)",
                      vspan=(0, 30, "弯段入口"))
    return {"Ferr阈值": thr, "提前量_cm(距入弯点)": advance}


# ------------------------------------------------------------- P2 十字 / 环岛

def p2_cross(outdir, h=0.07):
    """P2a：十字交叉全过程（沿主线通过十字，e=0）。"""
    track = trk.cross_track(half=2.0)
    sensors = sns.default_layout(h=h)
    s, U = _drive(track, sensors, 1.40, 2.60, ds=0.005)  # 中线总长 4 m，十字在 s=2 m
    y = (s - (2.0 - 1.40)) * 100  # 相对十字中心，cm
    sig = {"L1": U["L1"] * 1e6, "R1": U["R1"] * 1e6, "M1": U["M1"] * 1e6,
           "F1": U["F1"] * 1e6, "F2": U["F2"] * 1e6}
    err = _err(U, "L1", "R1")
    bsum = (U["L1"] + U["R1"]) * 1e6
    plots.plot_wave(y, sig, outdir / "08_十字交叉_特征波形.png",
                   "P2 十字交叉：过十字全过程特征波形（e=0）",
                   "距十字中心 (cm)", vlines=[(0, "十字中心")],
                   panel2={"err(L1,R1)": err, "L1+R1 (µT)": bsum},
                   panel2_ylabel="err / 信号和")
    i0 = int(np.argmin(np.abs(y)))
    i_far = int(np.argmin(np.abs(y + 60)))
    return {"远端_err": float(err[i_far]),
            "十字中心_err": float(err[i0]),
            "err最大扰动": float(np.abs(err).max()),
            "中心信号和/远端": float(bsum[i0] / bsum[i_far])}


def p2_roundabout(outdir, R=0.50, h=0.07):
    """P2b：环岛入环点（沿入口直道驶向切点，环岛在右侧）。"""
    track = trk.roundabout_track(R)
    sensors = sns.default_layout(h=h)
    entry_len = track.segments[0].length()
    s, U = _drive(track, sensors, entry_len - 0.80, entry_len + 0.20, ds=0.005)
    y = (s - 0.80) * 100  # 距入环切点，cm
    sig = {"L1": U["L1"] * 1e6, "R1": U["R1"] * 1e6, "M1": U["M1"] * 1e6,
           "F1": U["F1"] * 1e6, "F2": U["F2"] * 1e6}
    err = _err(U, "L1", "R1")
    ferr = (U["F2"] - U["F1"]) / np.maximum(U["F1"] + U["F2"], 1e-30)
    plots.plot_wave(y, sig, outdir / "09_环岛入环_特征波形.png",
                   f"P2 环岛入环点特征波形（R={R*100:.0f} cm，环岛在右侧）",
                   "距入环切点 (cm)", vlines=[(0, "入环切点")],
                   panel2={"err(L1,R1)": err, "F_err": ferr},
                   panel2_ylabel="err / F_err")
    def at(ycm):
        return int(np.argmin(np.abs(y - ycm)))
    return {"err@−60cm": float(err[at(-60)]), "err@−30cm": float(err[at(-30)]),
            "err@切点": float(err[at(0)]),
            "Ferr@−60cm": float(ferr[at(-60)]), "Ferr@−30cm": float(ferr[at(-30)]),
            "切点_R1/L1": float(U["R1"][at(0)] / max(U["L1"][at(0)], 1e-30))}
