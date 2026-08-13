# -*- coding: utf-8 -*-
"""电感（传感器）模型：布局表 + 响应公式 + 车体坐标变换。

方案 4.1：U_i = k · |B(P_i) · n̂_i|   （ADC 幅值检测，只感知幅值）
方案 4.2 布局：L1/R1 水平对称（感 Bz），L2/R2 更宽，M1 竖直居中（感 Bx），
              F1/F2 八字前瞻（感 Bz）。间距/高度/前瞻距离全部参数化。
车体坐标系：x 向右，y 向前（车头），z 向上。
"""
from __future__ import annotations

from dataclasses import dataclass, field as _dc_field

import numpy as np

K_DEFAULT = 1.0   # 综合系数 k（匝数/面积/增益，标定确定；仿真设 1，输出任意单位）


@dataclass
class Sensor:
    name: str
    pos: np.ndarray    # 车体坐标 (x 右, y 前, z 上)，单位 m
    axis: np.ndarray   # 敏感轴单位向量（车体坐标）

    def __post_init__(self):
        self.pos = np.asarray(self.pos, dtype=float)
        self.axis = np.asarray(self.axis, dtype=float)
        self.axis = self.axis / np.linalg.norm(self.axis)


def default_layout(h: float = 0.07, d: float = 0.30,
                   s1: float = 0.22, s2: float = 0.30, sf: float = 0.12,
                   yf: float = 0.05):
    """典型布局（方案 4.2）。参数均可调：

    h  安装高度（距赛道平面）；d 前瞻距离；s1/s2 主/宽对半间距；
    sf 前瞻电感半间距；yf 前排电感在车体上的纵向位置。
    """
    z = np.array([0.0, 0.0, 1.0])
    x = np.array([1.0, 0.0, 0.0])
    return [
        Sensor("L1", (-s1, yf, h), z), Sensor("R1", (s1, yf, h), z),
        Sensor("L2", (-s2, yf, h), z), Sensor("R2", (s2, yf, h), z),
        Sensor("M1", (0.0, yf, h), x),
        Sensor("F1", (-sf, d, h), z), Sensor("F2", (sf, d, h), z),
    ]


def pose_from_tangent(pt, tangent, e: float = 0.0, psi: float = 0.0):
    """由赛道切向构造车体位姿（方案 4.3）。

    pt      : 赛道中线上参考点 (3,)
    tangent : 赛道切向单位向量 (3,)
    e       : 横向偏差（>0 向行进方向右侧偏移），m
    psi     : 航向角（车头方向与赛道切向夹角，>0 向右偏），rad
    返回 (origin, forward, right) 三个世界系 3 矢量。
    """
    pt = np.asarray(pt, dtype=float)
    t = np.asarray(tangent, dtype=float)
    t = t / np.linalg.norm(t)
    right_t = np.array([t[1], -t[0], 0.0])           # 切向右侧法向
    origin = pt + e * right_t
    forward = np.cos(psi) * t + np.sin(psi) * right_t
    right = np.cos(psi) * right_t - np.sin(psi) * t
    return origin, forward, right


def read_sensors(field_fn, origin, forward, right, sensors, k: float = K_DEFAULT):
    """计算一组电感的 ADC 读数 U_i = k·|B(P_i)·n̂_i|。

    field_fn(P) : 输入 (N,3) 世界坐标，返回 (N,3) B 矢量。
    返回 dict {name: U}（k=1 时数值等于 |B·n̂|，单位 Tesla）。
    """
    origin = np.asarray(origin, dtype=float)
    forward = np.asarray(forward, dtype=float)
    right = np.asarray(right, dtype=float)
    up = np.array([0.0, 0.0, 1.0])
    P, axes = [], []
    for sn in sensors:
        P.append(origin + sn.pos[0] * right + sn.pos[1] * forward + sn.pos[2] * up)
        axes.append(sn.axis[0] * right + sn.axis[1] * forward + sn.axis[2] * up)
    B = field_fn(np.asarray(P))
    U = np.abs(k * np.einsum("ij,ij->i", B, np.asarray(axes)))
    return {sn.name: float(u) for sn, u in zip(sensors, U)}
