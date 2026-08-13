# -*- coding: utf-8 -*-
"""赛道几何：直线段/圆弧段定义，折线离散化（段长 <= 1 cm），赛道构造函数。

约定：
- 世界坐标系：z 竖直向上，导线贴地（z=0）。
- 直道沿 +y 方向铺设，电流沿路径方向流动。
- 离散后每个小段给出中点 mids 与矢量 dl，供毕奥-萨伐尔积分使用。
"""
from __future__ import annotations

import numpy as np

MAX_DS = 0.01  # 离散小段最大长度 1 cm（方案 3.2）


class LineSeg:
    """直线段：起点 p0 -> 终点 p1，电流方向与之一致。"""

    def __init__(self, p0, p1):
        self.p0 = np.asarray(p0, dtype=float)
        self.p1 = np.asarray(p1, dtype=float)

    def length(self) -> float:
        return float(np.linalg.norm(self.p1 - self.p0))

    def elements(self, max_ds: float = MAX_DS):
        n = max(1, int(np.ceil(self.length() / max_ds)))
        ts = (np.arange(n) + 0.5) / n
        mids = self.p0[None, :] + ts[:, None] * (self.p1 - self.p0)[None, :]
        dl = np.repeat(((self.p1 - self.p0) / n)[None, :], n, axis=0)
        return mids, dl


class ArcSeg:
    """圆弧段：圆心 center（取 xy），半径 radius，theta0 -> theta1（弧度，逆时针为正）。"""

    def __init__(self, center, radius, theta0, theta1):
        self.center = np.asarray(center, dtype=float)[:2]
        self.radius = float(radius)
        self.theta0 = float(theta0)
        self.theta1 = float(theta1)

    def length(self) -> float:
        return abs(self.theta1 - self.theta0) * self.radius

    def elements(self, max_ds: float = MAX_DS):
        n = max(1, int(np.ceil(self.length() / max_ds)))
        th = self.theta0 + (np.arange(n) + 0.5) / n * (self.theta1 - self.theta0)
        c, s = np.cos(th), np.sin(th)
        mids = np.column_stack([self.center[0] + self.radius * c,
                                self.center[1] + self.radius * s,
                                np.zeros(n)])
        dth = (self.theta1 - self.theta0) / n
        dl = np.column_stack([-self.radius * s * dth,
                               self.radius * c * dth,
                               np.zeros(n)])
        return mids, dl


class Track:
    """赛道 = 基本段序列（电流沿段序列方向流动）。"""

    def __init__(self, segments):
        self.segments = list(segments)

    def elements(self, max_ds: float = MAX_DS):
        mids, dls = [], []
        for seg in self.segments:
            m, d = seg.elements(max_ds)
            mids.append(m)
            dls.append(d)
        return np.vstack(mids), np.vstack(dls)

    def sample_path(self, ds: float = 0.005):
        """沿赛道中线采样，返回 (pts[N,3], tang[N,3] 单位切向, s[N] 累计弧长)。"""
        mids, dls = self.elements(ds)
        leng = np.linalg.norm(dls, axis=1)
        tang = dls / leng[:, None]
        s = np.concatenate([[0.0], np.cumsum(leng)])[:-1]
        return mids, tang, s


# ---------------------------------------------------------------- 赛道构造

def straight_track(half: float = 2.0) -> Track:
    """直道：沿 y 轴，电流 +y。"""
    return Track([LineSeg((0.0, -half, 0.0), (0.0, half, 0.0))])


def curve_track(R: float, entry: float = 1.5, exit_len: float = 1.5,
                turn_deg: float = 90.0) -> Track:
    """右转弯道：入口直道 -> 90°(可调) 圆弧 -> 出口直道。

    圆弧圆心 (R, 0)，起点 (0,0) 切向 +y，顺时针（右转）。
    """
    th = np.radians(turn_deg)
    th1 = np.pi - th
    end = np.array([R + R * np.cos(th1), R * np.sin(th1), 0.0])
    tang = np.array([np.sin(th1), -np.cos(th1), 0.0])  # 已是单位向量
    segs = [LineSeg((0.0, -entry, 0.0), (0.0, 0.0, 0.0)),
            ArcSeg((R, 0.0), R, np.pi, th1),
            LineSeg(end, end + tang * exit_len)]
    return Track(segs)


def cross_track(half: float = 2.0) -> Track:
    """十字交叉：主线沿 y，支线沿 x，两线电流幅值相同（同一导线自交）。"""
    return Track([LineSeg((0.0, -half, 0.0), (0.0, half, 0.0)),
                  LineSeg((-half, 0.0, 0.0), (half, 0.0, 0.0))])


def roundabout_track(R: float = 0.5, entry: float = 1.5, exit_len: float = 1.0) -> Track:
    """环岛：入口直道 -> 整圆（顺时针，圆心 (R,0)，入环点 (0,0)）-> 出口直道。"""
    return Track([LineSeg((0.0, -entry, 0.0), (0.0, 0.0, 0.0)),
                  ArcSeg((R, 0.0), R, np.pi, np.pi - 2.0 * np.pi),
                  LineSeg((0.0, 0.0, 0.0), (0.0, exit_len, 0.0))])
