# -*- coding: utf-8 -*-
"""绘图函数（方案 5.3）：场分布等值线图、U(e) 响应曲线族、归一化差值曲线、特征波形。

注意：调用本模块前，入口脚本须先执行 daimon_runtime.setup_plot()（配好 Agg 后端与中文字体）。
一律 fig.savefig(..., dpi=200, bbox_inches="tight")，绝不 plt.show()。
"""
from __future__ import annotations

import numpy as np
import matplotlib.pyplot as plt

import field as fld


def contour_B(track, fname, title, extent, h=0.07, ngrid=161):
    """B 场等值线俯视图：|B|（µT）在 z=h 平面上的分布。"""
    mids, dls = track.elements()
    xs = np.linspace(extent[0], extent[1], ngrid)
    ys = np.linspace(extent[2], extent[3], ngrid)
    XX, YY = np.meshgrid(xs, ys)
    P = np.column_stack([XX.ravel(), YY.ravel(), np.full(XX.size, h)])
    Bm = np.linalg.norm(fld.biot_savart(P, mids, dls), axis=1).reshape(XX.shape) * 1e6
    fig, ax = plt.subplots(figsize=(7.2, 6.0))
    levels = np.geomspace(max(Bm.min(), 1e-2), Bm.max(), 24)
    cf = ax.contourf(XX * 100, YY * 100, Bm, levels=levels, cmap="viridis")
    ax.contour(XX * 100, YY * 100, Bm, levels=levels, colors="w", linewidths=0.3, alpha=0.5)
    pts, _, _ = track.sample_path(0.02)
    ax.plot(pts[:, 0] * 100, pts[:, 1] * 100, "r-", lw=1.6, label="赛道中线（导线）")
    ax.set_xlabel("x (cm)"); ax.set_ylabel("y (cm)")
    ax.set_xlim(extent[0] * 100, extent[1] * 100)
    ax.set_ylim(extent[2] * 100, extent[3] * 100)
    ax.set_title(title)
    ax.set_aspect("equal"); ax.legend(loc="upper right", fontsize=8)
    cb = fig.colorbar(cf, ax=ax); cb.set_label("|B| (µT)")
    fig.savefig(fname, dpi=200, bbox_inches="tight")
    plt.close(fig)


def plot_Ue(e_cm, U, fname, title):
    """U(e) 响应曲线族。U: dict name -> array"""
    fig, ax = plt.subplots(figsize=(7.2, 5.0))
    for name, u in U.items():
        ax.plot(e_cm, np.asarray(u) * 1e6, lw=1.5, label=name)
    ax.set_xlabel("横向偏差 e (cm)"); ax.set_ylabel("U (µT, k=1 任意单位)")
    ax.set_title(title); ax.grid(alpha=0.3); ax.legend(ncol=2, fontsize=9)
    fig.savefig(fname, dpi=200, bbox_inches="tight")
    plt.close(fig)


def plot_err(e_cm, errs, fname, title, lin_range=0.15):
    """归一化差值 err=(L−R)/(L+R) 曲线 + ±lin_range 线性区标注。"""
    fig, ax = plt.subplots(figsize=(7.2, 5.0))
    results = {}
    for name, err in errs.items():
        err = np.asarray(err)
        ax.plot(e_cm, err, lw=1.6, label=name)
        m = np.abs(e_cm / 100.0) <= lin_range
        a, b = np.polyfit(e_cm[m], err[m], 1)
        fit = a * e_cm[m] + b
        ss_res = ((err[m] - fit) ** 2).sum()
        ss_tot = ((err[m] - err[m].mean()) ** 2).sum()
        r2 = 1.0 - ss_res / max(ss_tot, 1e-30)
        mono = bool(np.all(np.diff(err[m]) > 0))
        results[name] = dict(slope=a, r2=r2, mono=mono,
                             max_dev=float(np.abs(err[m] - fit).max()))
        ax.plot(e_cm[m], fit, "k--", lw=0.9, alpha=0.6)
    ax.axvspan(-lin_range * 100, lin_range * 100, color="orange", alpha=0.08,
               label=f"±{int(lin_range*100)} cm 目标线性区")
    ax.axhline(0, color="gray", lw=0.6); ax.axvline(0, color="gray", lw=0.6)
    ax.set_xlabel("横向偏差 e (cm)"); ax.set_ylabel("err = (L−R)/(L+R)")
    ax.set_title(title); ax.grid(alpha=0.3); ax.legend(fontsize=9, loc="upper left")
    fig.savefig(fname, dpi=200, bbox_inches="tight")
    plt.close(fig)
    return results


def plot_height(h_cm, U, fname, title):
    """U(h) 高度衰减曲线（左：绝对值；右：相对 h=2cm 归一化）。"""
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(11, 4.4))
    for name, u in U.items():
        u = np.asarray(u)
        ax1.plot(h_cm, u * 1e6, lw=1.5, marker="o", ms=3, label=name)
        ax2.plot(h_cm, u / u[0], lw=1.5, marker="o", ms=3, label=name)
    ax1.set_ylabel("U (µT, k=1)"); ax1.set_title("绝对信号")
    ax2.set_ylabel("U(h) / U(2 cm)"); ax2.set_title("相对衰减")
    for ax in (ax1, ax2):
        ax.set_xlabel("安装高度 h (cm)"); ax.grid(alpha=0.3); ax.legend(fontsize=8)
    fig.suptitle(title)
    fig.savefig(fname, dpi=200, bbox_inches="tight")
    plt.close(fig)


def plot_wave(x, signals, fname, title, xlabel, vspan=None, vlines=None,
             panel2=None, panel2_ylabel="err"):
    """特征波形图。signals: dict name -> array；panel2: 归一化量（如 err）画在下方子图。"""
    if panel2 is None:
        fig, axes = plt.subplots(1, 1, figsize=(7.6, 5.0))
        axes = [axes]
    else:
        fig, axes = plt.subplots(2, 1, figsize=(7.6, 7.2), sharex=True,
                                 gridspec_kw=dict(height_ratios=[3, 2]))
    ax = axes[0]
    for name, s in signals.items():
        ax.plot(x, np.asarray(s), lw=1.5, label=name)
    ax.set_title(title); ax.grid(alpha=0.3); ax.legend(fontsize=8, ncol=2)
    ax.set_ylabel("U (µT, k=1)")
    if panel2 is not None:
        ax2 = axes[1]
        for name, s in panel2.items():
            ax2.plot(x, np.asarray(s), lw=1.5, label=name)
        ax2.axhline(0, color="gray", lw=0.6)
        ax2.set_ylabel(panel2_ylabel); ax2.grid(alpha=0.3); ax2.legend(fontsize=8, ncol=2)
    for a in axes:
        if vspan is not None:
            a.axvspan(vspan[0], vspan[1], color="orange", alpha=0.10)
        if vlines:
            for xv, lab in vlines:
                a.axvline(xv, color="gray", ls="--", lw=0.8)
    if vspan is not None:
        axes[0].text(0.02, 0.04, vspan[2], transform=axes[0].transAxes,
                     fontsize=8, color="darkorange")
    if vlines:
        for xv, lab in vlines:
            axes[0].text(xv, axes[0].get_ylim()[1], lab, fontsize=8, rotation=90, va="top")
    axes[-1].set_xlabel(xlabel)
    fig.savefig(fname, dpi=200, bbox_inches="tight")
    plt.close(fig)


def plot_multir(x, curves, fname, title, xlabel, ylabel, vspan=None):
    """多参数对比曲线（如不同 R、不同前瞻距离）。curves: dict label -> array"""
    fig, ax = plt.subplots(figsize=(7.6, 5.0))
    for lab, y in curves.items():
        ax.plot(x, np.asarray(y), lw=1.6, label=lab)
    if vspan is not None:
        ax.axvspan(vspan[0], vspan[1], color="orange", alpha=0.10, label=vspan[2])
    ax.set_xlabel(xlabel); ax.set_ylabel(ylabel)
    ax.set_title(title); ax.grid(alpha=0.3); ax.legend(fontsize=9)
    fig.savefig(fname, dpi=200, bbox_inches="tight")
    plt.close(fig)
