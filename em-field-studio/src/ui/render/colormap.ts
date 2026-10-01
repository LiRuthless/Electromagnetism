/**
 * 渲染辅助：colormap（turbo 近似 / 发散蓝-深-红）、marching squares 等值线。
 */

/** turbo colormap 近似（Google 公开多项式），t ∈ [0,1] -> [r,g,b] 0~255 */
export function turbo(t: number): [number, number, number] {
  const c = Math.min(Math.max(t, 0), 1);
  const r =
    34.61 + c * (1172.33 + c * (-10793.56 + c * (33300.12 + c * (-38394.49 + c * 14825.05))));
  const g =
    23.31 + c * (557.33 + c * (1225.33 + c * (-3574.96 + c * (1073.77 + c * 707.56))));
  const b =
    27.2 + c * (3211.1 + c * (-15327.97 + c * (27814.0 + c * (-22569.18 + c * 6838.66))));
  return [
    Math.max(0, Math.min(255, Math.round(r))),
    Math.max(0, Math.min(255, Math.round(g))),
    Math.max(0, Math.min(255, Math.round(b))),
  ];
}

/** 发散色标：-1 深蓝 -> 0 近黑 -> +1 橙红 */
export function diverging(t: number): [number, number, number] {
  const c = Math.min(Math.max(t, -1), 1);
  if (c >= 0) {
    // 暗 -> 橙红
    return [
      Math.round(20 + 235 * c),
      Math.round(20 + 120 * c * c),
      Math.round(40 + 20 * c),
    ];
  }
  const m = -c;
  return [
    Math.round(20 + 30 * m),
    Math.round(20 + 110 * m * m),
    Math.round(40 + 215 * m),
  ];
}

export interface Segment {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * marching squares 提取等值线。
 * grid: 行优先 (ny 行 nx 列)；返回值域坐标（单元格索引坐标，含亚格子插值）。
 */
export function marchingSquares(
  grid: Float32Array,
  nx: number,
  ny: number,
  level: number,
): Segment[] {
  const segs: Segment[] = [];
  const at = (ix: number, iy: number) => grid[iy * nx + ix];
  // 线性插值求交点参数
  const interp = (a: number, b: number) => {
    const d = b - a;
    if (Math.abs(d) < 1e-12) return 0.5;
    return Math.min(Math.max((level - a) / d, 0), 1);
  };
  for (let iy = 0; iy + 1 < ny; iy++) {
    for (let ix = 0; ix + 1 < nx; ix++) {
      const v0 = at(ix, iy); // 左下
      const v1 = at(ix + 1, iy); // 右下
      const v2 = at(ix + 1, iy + 1); // 右上
      const v3 = at(ix, iy + 1); // 左上
      let idx = 0;
      if (v0 >= level) idx |= 1;
      if (v1 >= level) idx |= 2;
      if (v2 >= level) idx |= 4;
      if (v3 >= level) idx |= 8;
      if (idx === 0 || idx === 15) continue;
      // 各边交点（单元格坐标）
      const bottom = { x: ix + interp(v0, v1), y: iy };
      const right = { x: ix + 1, y: iy + interp(v1, v2) };
      const top = { x: ix + interp(v3, v2), y: iy + 1 };
      const left = { x: ix, y: iy + interp(v0, v3) };
      const push = (a: { x: number; y: number }, b: { x: number; y: number }) =>
        segs.push({ x0: a.x, y0: a.y, x1: b.x, y1: b.y });
      switch (idx) {
        case 1: case 14: push(left, bottom); break;
        case 2: case 13: push(bottom, right); break;
        case 3: case 12: push(left, right); break;
        case 4: case 11: push(top, right); break;
        case 5: push(left, top); push(bottom, right); break; // 鞍点
        case 6: case 9: push(bottom, top); break;
        case 7: case 8: push(left, top); break;
        case 10: push(left, bottom); push(top, right); break; // 鞍点
      }
    }
  }
  return segs;
}

/** μT 分档等值线级别（1-2-5 序列），单位 Tesla */
export function contourLevels(maxAbsT: number): number[] {
  const base = [1, 2, 5];
  const levels: number[] = [];
  for (let exp = -9; exp <= -3; exp++) {
    for (const b of base) {
      const v = b * Math.pow(10, exp);
      if (v <= maxAbsT && v * 1e6 >= 0.5) levels.push(v);
    }
  }
  return levels.slice(0, 14);
}
