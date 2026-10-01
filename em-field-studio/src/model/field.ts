/**
 * 磁场计算：毕奥-萨伐尔分段积分 + 无限长直导线解析解。
 * 与 Python 版 track_model/field.py 物理一致。
 *
 * 准静态近似（20 kHz 波长 15 km >> cm 级探测尺度），按静磁场处理；
 * 用电流幅值 I 计算磁场幅值，ADC 读数正比于 |B·n̂|（方案 2.2 / 3 节）。
 */
import type { Elements } from './track';

export const MU0 = 4 * Math.PI * 1e-7; // 真空磁导率 H/m
export const I_DEFAULT = 0.1; // 赛道电流幅值 100 mA
export const R_MIN = 1e-3; // 有限导线半径等效保护（1 mm），避免 r->0 奇异

/**
 * 有限长直线段闭式解（精确，非离散）：电流元 a=(x0,y0,0) -> b=(x1,y1,0)。
 *
 * 矢量形式：B = μ₀I/(4π) · (t̂×r₁)/|ρ|² · (r₁·t̂/|r₁| − r₂·t̂/|r₂|)
 * 其中 t̂ 为线段方向，r₁=P−a，r₂=P−b，ρ 为 P 到直线的垂直矢量。
 * 等价于常见的 B = μ₀I/(4πd)(cosθ₁ − cosθ₂)，方向由叉积给出。
 * 场点在导线延长线上（|ρ|→0）时按 R_MIN 截断（与离散路径同一保护）。
 */
export function wireSegB(
  px: number,
  py: number,
  pz: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  I: number = I_DEFAULT,
): [number, number, number] {
  const lx = x1 - x0;
  const ly = y1 - y0;
  const L = Math.hypot(lx, ly);
  if (L < 1e-12) return [0, 0, 0];
  const tx = lx / L;
  const ty = ly / L;
  const r1x = px - x0;
  const r1y = py - y0;
  const r1z = pz;
  const r2x = px - x1;
  const r2y = py - y1;
  const r2z = pz;
  const u1 = r1x * tx + r1y * ty; // r1·t̂
  const u2 = r2x * tx + r2y * ty; // r2·t̂
  const n1 = Math.max(Math.hypot(r1x, r1y, r1z), R_MIN);
  const n2 = Math.max(Math.hypot(r2x, r2y, r2z), R_MIN);
  // 垂直距离平方 |ρ|² = |r1|² − u1²
  let d2 = r1x * r1x + r1y * r1y + r1z * r1z - u1 * u1;
  if (d2 < R_MIN * R_MIN) d2 = R_MIN * R_MIN;
  const factor = u1 / n1 - u2 / n2;
  // t̂ × r₁（= t̂ × ρ），t̂ 的 z 分量为 0
  const cx = ty * r1z; // (t̂×r₁)x = t_y·r1z − 0·r1y
  const cy = -tx * r1z; // (t̂×r₁)y = 0·r1x − t_x·r1z
  const cz = tx * r1y - ty * r1x; // (t̂×r₁)z
  const coef = ((MU0 * I) / (4 * Math.PI)) * (factor / d2);
  return [cx * coef, cy * coef, cz * coef];
}

/** 单点 B 矢量（毕奥-萨伐尔分段积分），返回 [Bx, By, Bz]，单位 Tesla */
export function computeB(
  px: number,
  py: number,
  pz: number,
  el: Elements,
  I: number = I_DEFAULT,
): [number, number, number] {
  const coef = (MU0 * I) / (4 * Math.PI);
  const { mids, dls, count } = el;
  const rMin2 = R_MIN * R_MIN;
  let bx = 0;
  let by = 0;
  let bz = 0;
  for (let i = 0; i < count; i++) {
    const rx = px - mids[i * 3];
    const ry = py - mids[i * 3 + 1];
    const rz = pz - mids[i * 3 + 2];
    const dlx = dls[i * 3];
    const dly = dls[i * 3 + 1];
    const dlz = dls[i * 3 + 2];
    let r2 = rx * rx + ry * ry + rz * rz;
    if (r2 < rMin2) r2 = rMin2;
    const w = coef / (r2 * Math.sqrt(r2));
    // dl x r
    bx += (dly * rz - dlz * ry) * w;
    by += (dlz * rx - dlx * rz) * w;
    bz += (dlx * ry - dly * rx) * w;
  }
  // 直线段闭式积分（精确）
  const wires = el.wires;
  if (wires) {
    for (let i = 0; i + 3 < wires.length; i += 4) {
      const [wx, wy, wz] = wireSegB(px, py, pz, wires[i], wires[i + 1], wires[i + 2], wires[i + 3], I);
      bx += wx;
      by += wy;
      bz += wz;
    }
  }
  return [bx, by, bz];
}

/**
 * 网格批算：观测平面 z = h 上 nx*ny 个场点的 B。
 * 输出三个扁平数组（行优先，iy 外层、ix 内层），单位 Tesla。
 * 在 Web Worker 中调用。
 */
export function computeGrid(
  el: Elements,
  I: number,
  x0: number,
  y0: number,
  nx: number,
  ny: number,
  dx: number,
  dy: number,
  h: number,
): { bx: Float32Array; bz: Float32Array; bmag: Float32Array } {
  const bx = new Float32Array(nx * ny);
  const bz = new Float32Array(nx * ny);
  const bmag = new Float32Array(nx * ny);
  const coef = (MU0 * I) / (4 * Math.PI);
  const { mids, dls, count } = el;
  const wires = el.wires;
  const rMin2 = R_MIN * R_MIN;
  for (let iy = 0; iy < ny; iy++) {
    const py = y0 + (iy + 0.5) * dy;
    const rz0 = h;
    for (let ix = 0; ix < nx; ix++) {
      const px = x0 + (ix + 0.5) * dx;
      let sx = 0;
      let sy = 0;
      let sz = 0;
      for (let i = 0; i < count; i++) {
        const rx = px - mids[i * 3];
        const ry = py - mids[i * 3 + 1];
        const rz = rz0 - mids[i * 3 + 2];
        const dlx = dls[i * 3];
        const dly = dls[i * 3 + 1];
        const dlz = dls[i * 3 + 2];
        let r2 = rx * rx + ry * ry + rz * rz;
        if (r2 < rMin2) r2 = rMin2;
        const w = coef / (r2 * Math.sqrt(r2));
        sx += (dly * rz - dlz * ry) * w;
        sy += (dlz * rx - dlx * rz) * w;
        sz += (dlx * ry - dly * rx) * w;
      }
      // 直线段闭式积分（精确）
      if (wires) {
        for (let i = 0; i + 3 < wires.length; i += 4) {
          const [wx, wy, wz] = wireSegB(px, py, rz0, wires[i], wires[i + 1], wires[i + 2], wires[i + 3], I);
          sx += wx;
          sy += wy;
          sz += wz;
        }
      }
      const idx = iy * nx + ix;
      bx[idx] = sx;
      bz[idx] = sz;
      bmag[idx] = Math.sqrt(sx * sx + sy * sy + sz * sz);
    }
  }
  return { bx, bz, bmag };
}

/**
 * 网格批算（含 By 全矢量输出），用于 CSV 导出。
 * 与 computeGrid 同一积分核，额外返回 by 数组。
 */
export function computeGridFull(
  el: Elements,
  I: number,
  x0: number,
  y0: number,
  nx: number,
  ny: number,
  dx: number,
  dy: number,
  h: number,
): { bx: Float32Array; by: Float32Array; bz: Float32Array; bmag: Float32Array } {
  const bx = new Float32Array(nx * ny);
  const by = new Float32Array(nx * ny);
  const bz = new Float32Array(nx * ny);
  const bmag = new Float32Array(nx * ny);
  const coef = (MU0 * I) / (4 * Math.PI);
  const { mids, dls, count } = el;
  const wires = el.wires;
  const rMin2 = R_MIN * R_MIN;
  for (let iy = 0; iy < ny; iy++) {
    const py = y0 + (iy + 0.5) * dy;
    for (let ix = 0; ix < nx; ix++) {
      const px = x0 + (ix + 0.5) * dx;
      let sx = 0;
      let sy = 0;
      let sz = 0;
      for (let i = 0; i < count; i++) {
        const rx = px - mids[i * 3];
        const ry = py - mids[i * 3 + 1];
        const rz = h - mids[i * 3 + 2];
        const dlx = dls[i * 3];
        const dly = dls[i * 3 + 1];
        const dlz = dls[i * 3 + 2];
        let r2 = rx * rx + ry * ry + rz * rz;
        if (r2 < rMin2) r2 = rMin2;
        const w = coef / (r2 * Math.sqrt(r2));
        sx += (dly * rz - dlz * ry) * w;
        sy += (dlz * rx - dlx * rz) * w;
        sz += (dlx * ry - dly * rx) * w;
      }
      // 直线段闭式积分（精确）
      if (wires) {
        for (let i = 0; i + 3 < wires.length; i += 4) {
          const [wx, wy, wz] = wireSegB(px, py, h, wires[i], wires[i + 1], wires[i + 2], wires[i + 3], I);
          sx += wx;
          sy += wy;
          sz += wz;
        }
      }
      const idx = iy * nx + ix;
      bx[idx] = sx;
      by[idx] = sy;
      bz[idx] = sz;
      bmag[idx] = Math.sqrt(sx * sx + sy * sy + sz * sz);
    }
  }
  return { bx, by, bz, bmag };
}

/**
 * 无限长直导线解析解：B = μ0 I / (2πρ)，ρ 为到导线的垂直距离。
 * 导线沿 +y 轴、过原点，电流 +y。返回 [Bx, By, Bz]。
 * （用于物理自检：长直道中心附近应趋近该解。）
 */
export function infiniteWireB(
  px: number,
  _py: number,
  pz: number,
  I: number = I_DEFAULT,
): [number, number, number] {
  // 垂直于导线（y 轴）的分量
  const rx = px;
  const rz = pz;
  const rho = Math.max(Math.hypot(rx, rz), R_MIN);
  const rhatx = rx / rho;
  const rhatz = rz / rho;
  // B 方向 = d x r̂，d = (0,1,0) -> (rhatz*1? ) 计算: d×r̂ = (1*rhatz - 0, 0 - 0, 0 - rhatx)
  const bmag = (MU0 * I) / (2 * Math.PI * rho);
  return [bmag * rhatz, 0, bmag * -rhatx];
}
