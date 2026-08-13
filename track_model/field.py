# -*- coding: utf-8 -*-
"""磁场计算：毕奥-萨伐尔分段积分 + 无限长直导线解析解。

准静态近似（20 kHz 波长 15 km >> cm 级探测尺度），按静磁场处理；
用电流幅值 I 计算磁场幅值，ADC 读数正比于 |B·n̂|（方案 2.2 / 3 节）。
"""
from __future__ import annotations

import numpy as np

MU0 = 4.0 * np.pi * 1e-7   # 真空磁导率 H/m
I_DEFAULT = 0.1            # 赛道电流幅值 100 mA
R_MIN = 1e-3               # 有限导线半径等效保护（1 mm），避免 r->0 奇异


def biot_savart(P, mids, dls, I: float = I_DEFAULT, chunk: int = 2000) -> np.ndarray:
    """任意场点的 B 矢量（毕奥-萨伐尔分段积分）。

    P : (N,3) 场点；mids/dls : (M,3) 离散小段中点与电流元矢量。
    返回 (N,3)，单位 Tesla。
    """
    P = np.atleast_2d(np.asarray(P, dtype=float))
    B = np.zeros_like(P)
    coef = MU0 * I / (4.0 * np.pi)
    for i0 in range(0, len(P), chunk):
        Pc = P[i0:i0 + chunk]
        diff = Pc[:, None, :] - mids[None, :, :]          # r = P - mid
        r2 = np.maximum((diff ** 2).sum(axis=-1), R_MIN ** 2)
        cross = np.cross(dls[None, :, :], diff)           # dl x r
        B[i0:i0 + chunk] = coef * (cross / r2[..., None] ** 1.5).sum(axis=1)
    return B


def infinite_wire(P, p0=(0.0, 0.0, 0.0), direction=(0.0, 1.0, 0.0),
                  I: float = I_DEFAULT) -> np.ndarray:
    """无限长直导线解析解 B = mu0 I / (2 pi r)，方向 d x r̂。

    P : (N,3) 场点；p0 导线上一点；direction 电流方向单位向量。
    """
    P = np.atleast_2d(np.asarray(P, dtype=float))
    p0 = np.asarray(p0, dtype=float)
    d = np.asarray(direction, dtype=float)
    d = d / np.linalg.norm(d)
    rel = P - p0[None, :]
    rvec = rel - (rel @ d)[:, None] * d[None, :]          # 垂直于导线的分量
    r = np.maximum(np.linalg.norm(rvec, axis=1), R_MIN)
    rhat = rvec / r[:, None]
    bdir = np.cross(d[None, :], rhat)                     # d x r̂
    return (MU0 * I / (2.0 * np.pi) / r)[:, None] * bdir


def components(B):
    """场量分解（方案 3.3）：返回 (Bz, Bx, |B|)。"""
    B = np.atleast_2d(B)
    return B[:, 2], B[:, 0], np.linalg.norm(B, axis=1)
