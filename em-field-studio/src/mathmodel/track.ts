/**
 * 赛道几何：直线段 / 圆弧段序列，折线离散化（段长 <= 1 cm）。
 * 与 Python 版 track_model/track.py 物理一致。
 *
 * 约定：
 * - 世界坐标系：z 竖直向上，导线贴地（z = 0）。
 * - 段序列从原点 (0,0) 出发，初始航向 +y，电流沿段序列方向流动。
 * - 单位一律 SI（米、弧度）。
 *
 * 线径与尖角的正确物理：
 * - 真实电磁线（铜管/漆包线）直径 d = 0.5 mm。由安培环路定理 / 柱对称性，
 *   圆形截面导线外部的磁场与同轴无限细线电流严格相同（外部场只取决于总电流），
 *   故 0.5mm 线径是"无限细线电流"假设成立的物理依据，而非误差来源。
 * - 尖角建模：真实电磁线直角转弯处的最小弯曲半径受线径限制（~0.25mm 量级），
 *   远小于 1cm 离散粒度与 ≥2cm 探测距离，故折线顶点按理想尖点建模
 *   （探测尺度下与 0.5mm 圆角过渡的场值差异 <0.1%，自检 [5] 验证）。
 * - 附注：20 kHz 下铜的趋肤深度约 0.46mm，与线径同量级，电流在截面上略不均匀，
 *   但外部场仍只取决于总电流，上述假设稳健（仅作说明，不需建模）。
 */

export const MAX_DS = 0.01; // 离散小段最大长度 1 cm（方案 3.2）
export const WIRE_DIAMETER = 0.0005; // 真实电磁线直径 0.5 mm（仅物理说明，不影响场计算）
/**
 * 闭环吸合阈值（m）：段序列终点与起点距离 ≤ 该值时允许勾选"闭环赛道"，
 * 闭环后自动补一段终点 → 起点的吸合段形成闭合回路（数学模型.md §4）。
 */
export const CLOSE_SNAP_M = 0.02;

export interface LineSegDef {
  kind: 'line';
  length: number; // m
  /**
   * 绝对方向（rad，从 +x 起算）。给出时该段沿此方向铺设——
   * 用于鼠标连线产生的尖角转折；缺省时沿当前航向接续。
   */
  absAngle?: number;
  /**
   * 笔尖航向恢复（rad，可选）：铺设方向仍为 absAngle/当前航向，但该段铺完后
   * 笔尖航向设为此值。仅正六边形环岛末边使用——末边几何方向 ∓30°，
   * 出环航向需精确恢复为入环直线方向。
   */
  exitAngle?: number;
}

export interface ArcSegDef {
  kind: 'arc';
  radius: number; // m
  angleDeg: number; // 圆心角（度，>0）
  turn: 'left' | 'right'; // 转向
}

export type SegDef = LineSegDef | ArcSegDef;

export interface TrackDef {
  name: string;
  segments: SegDef[];
  /** 附加独立导线（如十字支线），点列 [x,y]（m），电流沿点列方向 */
  extraWires?: [number, number][][];
  /**
   * 闭环赛道（首尾相连）：终点与起点距离 ≤ CLOSE_SNAP_M 时由界面勾选；
   * 离散化时自动补一段终点 → 起点的吸合段，中线采样形成闭合回路，
   * 循迹仿真行驶弧长达单圈总长即判完赛（数学模型.md §8.5）。
   */
  closed?: boolean;
}

/** 离散化结果：扁平 xyz 数组，供毕奥-萨伐尔积分使用 */
export interface Elements {
  mids: Float64Array; // (3N) 小段中点
  dls: Float64Array; // (3N) 电流元矢量 dl
  count: number; // N
  /**
   * 直线段闭式积分（可选）：每 4 个数一段 (x0, y0, x1, y1)，z=0。
   * 存在时场计算路径对直线段用精确闭式解（wireSegB），mids/dls 只含圆弧离散元。
   */
  wires?: Float64Array;
}

/**
 * 场计算专用模型：直线段（含附加导线）走闭式积分、圆弧段保持 ≤10mm 离散。
 * 与 buildElements 的几何推进逻辑完全一致，只是直线段不再切碎。
 * （buildElements 仍用于路径采样/渲染/段数展示。）
 */
export function buildFieldElements(def: TrackDef): Elements {
  const mids: number[] = [];
  const dls: number[] = [];
  const wires: number[] = [];
  let px = 0;
  let py = 0;
  let phi = Math.PI / 2;

  for (const seg of def.segments) {
    if (seg.kind === 'line') {
      const L = Math.max(seg.length, 1e-6);
      const phiSeg = seg.absAngle ?? phi;
      const dx = Math.cos(phiSeg);
      const dy = Math.sin(phiSeg);
      wires.push(px, py, px + L * dx, py + L * dy); // 整条直线段 -> 闭式积分
      px += L * dx;
      py += L * dy;
      phi = seg.exitAngle ?? phiSeg;
    } else {
      // 圆弧：无简单闭式解，保持 ≤10mm 离散（误差已验证 <0.1%）
      const R = Math.max(seg.radius, 1e-6);
      const alpha = (Math.abs(seg.angleDeg) * Math.PI) / 180;
      const arc = R * alpha;
      const n = Math.max(1, Math.ceil(arc / MAX_DS));
      const nx = Math.sin(phi);
      const ny = -Math.cos(phi);
      const sign = seg.turn === 'right' ? 1 : -1;
      const cx = px + sign * R * nx;
      const cy = py + sign * R * ny;
      const theta0 = Math.atan2(py - cy, px - cx);
      const dTheta = (seg.turn === 'right' ? -alpha : alpha) / n;
      for (let i = 0; i < n; i++) {
        const th = theta0 + (i + 0.5) * dTheta;
        const mx = cx + R * Math.cos(th);
        const my = cy + R * Math.sin(th);
        pushElement(mids, dls, mx, my, -R * Math.sin(th) * dTheta, R * Math.cos(th) * dTheta);
      }
      const theta1 = theta0 + n * dTheta;
      px = cx + R * Math.cos(theta1);
      py = cy + R * Math.sin(theta1);
      phi = seg.turn === 'right' ? theta1 - Math.PI / 2 : theta1 + Math.PI / 2;
    }
  }

  // 闭环吸合段：终点 -> 起点（闭式积分，长度 ≤ CLOSE_SNAP_M 由界面保证）
  if (def.closed) {
    const gap = Math.hypot(px, py);
    if (gap > 1e-9) wires.push(px, py, 0, 0);
  }

  // 附加独立导线（点列折线）：每节都是直线段 -> 闭式积分
  for (const wire of def.extraWires ?? []) {
    for (let i = 0; i + 1 < wire.length; i++) {
      const [x0, y0] = wire[i];
      const [x1, y1] = wire[i + 1];
      if (Math.hypot(x1 - x0, y1 - y0) < 1e-9) continue;
      wires.push(x0, y0, x1, y1);
    }
  }

  return {
    mids: Float64Array.from(mids),
    dls: Float64Array.from(dls),
    count: dls.length / 3,
    wires: Float64Array.from(wires),
  };
}

function pushElement(
  mids: number[],
  dls: number[],
  mx: number,
  my: number,
  dlx: number,
  dly: number,
) {
  mids.push(mx, my, 0);
  dls.push(dlx, dly, 0);
}

/**
 * 由段序列生成离散电流元（航向积分法）。
 * 航向角 phi 从 +x 轴起算，初始 phi = +90°（即 +y 方向）。
 */
export function buildElements(def: TrackDef, maxDs: number = MAX_DS): Elements {
  const mids: number[] = [];
  const dls: number[] = [];
  let px = 0;
  let py = 0;
  let phi = Math.PI / 2;

  for (const seg of def.segments) {
    if (seg.kind === 'line') {
      const L = Math.max(seg.length, 1e-6);
      const n = Math.max(1, Math.ceil(L / maxDs));
      const phiSeg = seg.absAngle ?? phi; // 鼠标连线段可带绝对方向（尖角）
      const dx = Math.cos(phiSeg);
      const dy = Math.sin(phiSeg);
      const dlx = (dx * L) / n;
      const dly = (dy * L) / n;
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        pushElement(mids, dls, px + t * L * dx, py + t * L * dy, dlx, dly);
      }
      px += L * dx;
      py += L * dy;
      phi = seg.exitAngle ?? phiSeg;
    } else {
      const R = Math.max(seg.radius, 1e-6);
      const alpha = (Math.abs(seg.angleDeg) * Math.PI) / 180;
      const arc = R * alpha;
      const n = Math.max(1, Math.ceil(arc / maxDs));
      // 右侧法向
      const nx = Math.sin(phi);
      const ny = -Math.cos(phi);
      const sign = seg.turn === 'right' ? 1 : -1;
      const cx = px + sign * R * nx;
      const cy = py + sign * R * ny;
      const theta0 = Math.atan2(py - cy, px - cx);
      const dTheta = (seg.turn === 'right' ? -alpha : alpha) / n;
      for (let i = 0; i < n; i++) {
        const th = theta0 + (i + 0.5) * dTheta;
        const mx = cx + R * Math.cos(th);
        const my = cy + R * Math.sin(th);
        // dl = R*dTheta*(-sinθ, cosθ)，方向随 dTheta 符号自动正确
        pushElement(mids, dls, mx, my, -R * Math.sin(th) * dTheta, R * Math.cos(th) * dTheta);
      }
      const theta1 = theta0 + n * dTheta;
      px = cx + R * Math.cos(theta1);
      py = cy + R * Math.sin(theta1);
      phi = seg.turn === 'right' ? theta1 - Math.PI / 2 : theta1 + Math.PI / 2;
    }
  }

  // 闭环吸合段：终点 -> 起点，同样按 <=maxDs 离散
  if (def.closed) {
    const L = Math.hypot(px, py);
    if (L > 1e-9) {
      const n = Math.max(1, Math.ceil(L / maxDs));
      const dlx = (0 - px) / n;
      const dly = (0 - py) / n;
      for (let j = 0; j < n; j++) {
        const t = (j + 0.5) / n;
        pushElement(mids, dls, px + t * (0 - px), py + t * (0 - py), dlx, dly);
      }
    }
  }

  // 附加导线（十字支线等）
  for (const wire of def.extraWires ?? []) {
    for (let i = 0; i + 1 < wire.length; i++) {
      const [x0, y0] = wire[i];
      const [x1, y1] = wire[i + 1];
      const L = Math.hypot(x1 - x0, y1 - y0);
      if (L < 1e-9) continue;
      const n = Math.max(1, Math.ceil(L / maxDs));
      const dlx = (x1 - x0) / n;
      const dly = (y1 - y0) / n;
      for (let j = 0; j < n; j++) {
        const t = (j + 0.5) / n;
        pushElement(mids, dls, x0 + t * (x1 - x0), y0 + t * (y1 - y0), dlx, dly);
      }
    }
  }

  return {
    mids: Float64Array.from(mids),
    dls: Float64Array.from(dls),
    count: dls.length / 3,
  };
}

/** 主赛道中线采样：返回点列、单位切向、累计弧长（用于车体位姿参考） */
export interface PathSample {
  pts: Float64Array; // (2N)
  tang: Float64Array; // (2N) 单位切向
  s: Float64Array; // (N) 累计弧长
  length: number; // 总弧长
}

export function samplePath(def: TrackDef, ds: number = 0.005): PathSample {
  const { mids, dls, count } = buildElements(
    { name: def.name, segments: def.segments, ...(def.closed ? { closed: true } : {}) },
    ds,
  );
  const pts = new Float64Array(count * 2);
  const tang = new Float64Array(count * 2);
  const s = new Float64Array(count);
  let acc = 0;
  for (let i = 0; i < count; i++) {
    const dlx = dls[i * 3];
    const dly = dls[i * 3 + 1];
    const L = Math.hypot(dlx, dly) || 1e-12;
    pts[i * 2] = mids[i * 3];
    pts[i * 2 + 1] = mids[i * 3 + 1];
    tang[i * 2] = dlx / L;
    tang[i * 2 + 1] = dly / L;
    s[i] = acc;
    acc += L;
  }
  return { pts, tang, s, length: acc };
}

/** 取弧长 s 处的点与切向（clamp 到端点） */
export function pointAtLength(path: PathSample, sTarget: number): {
  x: number;
  y: number;
  tx: number;
  ty: number;
} {
  const n = path.s.length;
  if (n === 0) return { x: 0, y: 0, tx: 0, ty: 1 };
  const st = Math.min(Math.max(sTarget, 0), path.length);
  let i = 0;
  while (i + 1 < n && path.s[i + 1] < st) i++;
  return {
    x: path.pts[i * 2],
    y: path.pts[i * 2 + 1],
    tx: path.tang[i * 2],
    ty: path.tang[i * 2 + 1],
  };
}

// ---------------------------------------------------------------- 自由铺设辅助

/** 铺线"笔尖"状态：当前终点位置与航向角（rad，从 +x 起算） */
export interface PenState {
  x: number;
  y: number;
  phi: number;
}

export const PEN_START: PenState = { x: 0, y: 0, phi: Math.PI / 2 };

/** 单段几何推进：输入段与起始笔尖，返回新笔尖（与 buildElements 同一套航向积分） */
export function advancePen(seg: SegDef, pen: PenState): PenState {
  if (seg.kind === 'line') {
    const L = Math.max(seg.length, 1e-6);
    const phiSeg = seg.absAngle ?? pen.phi;
    return {
      x: pen.x + L * Math.cos(phiSeg),
      y: pen.y + L * Math.sin(phiSeg),
      phi: seg.exitAngle ?? phiSeg,
    };
  }
  const R = Math.max(seg.radius, 1e-6);
  const alpha = (Math.abs(seg.angleDeg) * Math.PI) / 180;
  const sign = seg.turn === 'right' ? 1 : -1;
  const cx = pen.x + sign * R * Math.sin(pen.phi);
  const cy = pen.y - sign * R * Math.cos(pen.phi);
  const theta0 = Math.atan2(pen.y - cy, pen.x - cx);
  const theta1 = theta0 + (seg.turn === 'right' ? -alpha : alpha);
  return {
    x: cx + R * Math.cos(theta1),
    y: cy + R * Math.sin(theta1),
    phi: seg.turn === 'right' ? theta1 - Math.PI / 2 : theta1 + Math.PI / 2,
  };
}

/** 段序列终点笔尖状态（自由铺设的接续点） */
export function trackTip(segments: SegDef[]): PenState {
  let pen = PEN_START;
  for (const seg of segments) pen = advancePen(seg, pen);
  return pen;
}

/** 段弧长（m）：直线=长度，圆弧=R·θ */
export function segmentLength(seg: SegDef): number {
  return seg.kind === 'line'
    ? seg.length
    : seg.radius * (Math.abs(seg.angleDeg) * Math.PI) / 180;
}

/** 生成单段的预览折线（从给定笔尖出发），用于自由铺设的虚影显示 */
export function previewSegment(seg: SegDef, pen: PenState, n = 32): [number, number][] {
  const pts: [number, number][] = [];
  if (seg.kind === 'line') {
    const end = advancePen(seg, pen);
    pts.push([end.x, end.y]);
    return pts;
  }
  const R = Math.max(seg.radius, 1e-6);
  const alpha = (Math.abs(seg.angleDeg) * Math.PI) / 180;
  const sign = seg.turn === 'right' ? 1 : -1;
  const cx = pen.x + sign * R * Math.sin(pen.phi);
  const cy = pen.y - sign * R * Math.cos(pen.phi);
  const theta0 = Math.atan2(pen.y - cy, pen.x - cx);
  const sweep = seg.turn === 'right' ? -alpha : alpha;
  for (let i = 1; i <= n; i++) {
    const th = theta0 + (i / n) * sweep;
    pts.push([cx + R * Math.cos(th), cy + R * Math.sin(th)]);
  }
  return pts;
}

/** 每段摘要：弧长 + 几何中点（画布段长标注用） */
export interface SegSummary {
  index: number;
  kind: 'line' | 'arc';
  lengthM: number;
  midX: number;
  midY: number;
}

export function segmentSummaries(segments: SegDef[]): SegSummary[] {
  const out: SegSummary[] = [];
  let pen = PEN_START;
  segments.forEach((seg, index) => {
    const lengthM = segmentLength(seg);
    let midX: number;
    let midY: number;
    if (seg.kind === 'line') {
      const phiSeg = seg.absAngle ?? pen.phi;
      midX = pen.x + (lengthM / 2) * Math.cos(phiSeg);
      midY = pen.y + (lengthM / 2) * Math.sin(phiSeg);
    } else {
      const R = Math.max(seg.radius, 1e-6);
      const alpha = (Math.abs(seg.angleDeg) * Math.PI) / 180;
      const sign = seg.turn === 'right' ? 1 : -1;
      const cx = pen.x + sign * R * Math.sin(pen.phi);
      const cy = pen.y - sign * R * Math.cos(pen.phi);
      const theta0 = Math.atan2(pen.y - cy, pen.x - cx);
      const thMid = theta0 + (seg.turn === 'right' ? -alpha / 2 : alpha / 2);
      midX = cx + R * Math.cos(thMid);
      midY = cy + R * Math.sin(thMid);
    }
    out.push({ index, kind: seg.kind, lengthM, midX, midY });
    pen = advancePen(seg, pen);
  });
  return out;
}

// ---------------------------------------------------------------- 形状工具
// 注意：不是"预设赛道"，而是铺设过程中的几何生成工具，生成后仍是普通段序列。

/** 直角弯（尖角）：从当前笔尖转 ±90° 铺一段直线。最小弯曲半径 ~0.25mm << 探测尺度，按尖点建模。 */
export function rightAngleSeg(tip: PenState, lengthM: number, dir: 'left' | 'right'): LineSegDef {
  const ang = tip.phi + (dir === 'left' ? Math.PI / 2 : -Math.PI / 2);
  return { kind: 'line', length: Math.max(0.01, lengthM), absAngle: ang };
}

/**
 * 正六边形（环岛形状）：当前笔尖 = 六边形的一个顶点（入环/出环共用点），
 * 当前切线 = 直线方向。第一条边相对切线偏转 30°（left=六边形在直线左侧，
 * right=右侧），之后每边依次转 60°——六条边方向为 ±30°/±90°/±150°，
 * 无一边与直线共线（六边形整体在直线一侧、仅一个角贴线），精确回到起始顶点。
 * 末边几何方向 ∓30°，通过 exitAngle 使出环航向精确恢复为入环直线方向——
 * 继续铺直线即自然形成"直线—顶点—绕环一周—顶点—直线"的真实环岛接线。
 * 周长 = 6a。
 */
export function hexagonSegs(tip: PenState, edgeM: number, dir: 'left' | 'right'): LineSegDef[] {
  const s = dir === 'left' ? 1 : -1; // 左环 +30° 起，右环 -30° 起
  const out: LineSegDef[] = [];
  for (let i = 0; i < 6; i++) {
    out.push({
      kind: 'line',
      length: Math.max(0.01, edgeM),
      absAngle: tip.phi + s * (Math.PI / 6 + (i * Math.PI) / 3),
      ...(i === 5 ? { exitAngle: tip.phi } : {}), // 末边铺完航向恢复为入环方向
    });
  }
  return out;
}

/** 鼠标连线段：从笔尖指向目标点的直线段（绝对方向，尖角接续） */
export function lineSegTo(tip: PenState, x: number, y: number): LineSegDef | null {
  const dx = x - tip.x;
  const dy = y - tip.y;
  const L = Math.hypot(dx, dy);
  if (L < 0.005) return null; // 距离不足 5mm 忽略
  return { kind: 'line', length: L, absAngle: Math.atan2(dy, dx) };
}

// ---------------------------------------------------------------- 闭环赛道（数学模型.md §4）

/** 段序列终点（笔尖）到起点 (0,0) 的距离（m） */
export function closureGapM(segments: SegDef[]): number {
  if (segments.length === 0) return Infinity;
  const tip = trackTip(segments);
  return Math.hypot(tip.x, tip.y);
}

/** 是否满足闭环条件：至少一段且终点距起点 ≤ CLOSE_SNAP_M */
export function canCloseTrack(segments: SegDef[]): boolean {
  return closureGapM(segments) <= CLOSE_SNAP_M;
}

/**
 * 求世界点 (x,y) 在赛道中线上的最近参考点：弧长 s、参考点坐标、单位切向。
 * 采样点相邻细分插值（与 signedLateralDistance 同一套最近点逻辑），
 * 用于"跟随仿真轨迹"位姿来源下由轨迹绝对位姿 (x,y,θ) 反算 s/e/ψ 展示（程序设计说明.md §4.4）。
 */export function nearestOnPath(
  path: PathSample,
  x: number,
  y: number,
): { s: number; x: number; y: number; tx: number; ty: number } {
  const n = path.s.length;
  if (n === 0) return { s: 0, x: 0, y: 0, tx: 0, ty: 1 };
  let bestD2 = Infinity;
  let best = { s: 0, x: path.pts[0], y: path.pts[1], tx: path.tang[0], ty: path.tang[1] };
  for (let i = 0; i < n; i++) {
    const px = path.pts[i * 2];
    const py = path.pts[i * 2 + 1];
    const tx = path.tang[i * 2];
    const ty = path.tang[i * 2 + 1];
    let qx = px;
    let qy = py;
    let qs = path.s[i];
    if (i + 1 < n) {
      const ax = path.pts[(i + 1) * 2] - px;
      const ay = path.pts[(i + 1) * 2 + 1] - py;
      const len2 = ax * ax + ay * ay;
      if (len2 > 1e-18) {
        let t = ((x - px) * ax + (y - py) * ay) / len2;
        t = Math.min(1, Math.max(0, t));
        qx = px + t * ax;
        qy = py + t * ay;
        qs = path.s[i] + t * (path.s[i + 1] - path.s[i]);
      }
    }
    const dx = x - qx;
    const dy = y - qy;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = { s: qs, x: qx, y: qy, tx, ty };
    }
  }
  return best;
}

// ---------------------------------------------------------------- 转角刻度（程序设计说明.md §3.2）

/** 一处转角的刻度标尺：顶点 + 两侧标尺（单位方向指离顶点 + 长度 m）+ 转角大小 */
export interface CornerRuler {
  x: number;
  y: number;
  /** 沿相接段一（来向段）的标尺：方向指离顶点 */
  ax: number;
  ay: number;
  alen: number;
  /** 沿相接段二（去向段）的标尺 */
  bx: number;
  by: number;
  blen: number;
  /** 转角大小（度，相邻段切向夹角） */
  angleDeg: number;
}

/** 角度差归一到 [0, π]（度） */
function angleDiffDeg(a: number, b: number): number {
  let d = Math.abs(a - b) % (2 * Math.PI);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return (d * 180) / Math.PI;
}

/**
 * 赛道转角刻度（程序设计说明.md §3.2）：在每个转角顶点（相邻段切向夹角 > minAngleDeg，尖角）沿相接两段、
 * 从顶点向两端各给一条标尺（标称 rulerM=300mm；相接段长度不足时该侧按实际段长截断）。
 * 圆弧段内部不逐点标，仅在段与段的接缝顶点标；圆弧侧标尺沿顶点切线方向、长度按段弧长截断。
 * 闭环赛道含吸合处顶点（末段→吸合段、吸合段→首段两个接缝）。
 */
export function cornerRulers(
  segments: SegDef[],
  closed?: boolean,
  rulerM = 0.3,
  minAngleDeg = 5,
): CornerRuler[] {
  const out: CornerRuler[] = [];
  if (segments.length === 0) return out;

  // 各段几何：起点、起点切向（几何方向）、终点、终点切向、段长
  interface SegGeom {
    endX: number;
    endY: number;
    startDir: number;
    endDir: number;
    len: number;
  }
  const geoms: SegGeom[] = [];
  let pen = PEN_START;
  for (const seg of segments) {
    const startDir = seg.kind === 'line' ? (seg.absAngle ?? pen.phi) : pen.phi;
    const next = advancePen(seg, pen);
    // 终点切向：直线 = 铺设方向（exitAngle 只影响下一段起点切向，不改本段几何方向）；
    // 圆弧 = advancePen 航向（该值即本段几何出段方向）
    const endDir = seg.kind === 'line' ? startDir : next.phi;
    geoms.push({ endX: next.x, endY: next.y, startDir, endDir, len: segmentLength(seg) });
    pen = next;
  }

  const push = (
    x: number,
    y: number,
    dirBack: number,
    lenBack: number,
    dirFwd: number,
    lenFwd: number,
  ) => {
    out.push({
      x,
      y,
      ax: Math.cos(dirBack),
      ay: Math.sin(dirBack),
      alen: Math.min(rulerM, lenBack),
      bx: Math.cos(dirFwd),
      by: Math.sin(dirFwd),
      blen: Math.min(rulerM, lenFwd),
      angleDeg: angleDiffDeg(dirBack + Math.PI, dirFwd),
    });
  };

  // 段间接缝顶点
  for (let i = 0; i + 1 < segments.length; i++) {
    const g0 = geoms[i];
    const g1 = geoms[i + 1];
    if (angleDiffDeg(g0.endDir, g1.startDir) <= minAngleDeg) continue;
    push(g0.endX, g0.endY, g0.endDir + Math.PI, g0.len, g1.startDir, g1.len);
  }

  // 闭环吸合处：末段 -> 吸合段（终点→原点）-> 首段
  if (closed) {
    const gLast = geoms[geoms.length - 1];
    const gFirst = geoms[0];
    const gap = Math.hypot(gLast.endX, gLast.endY);
    if (gap > 1e-9) {
      const snapDir = Math.atan2(-gLast.endY, -gLast.endX);
      // 顶点 1：末段终点（与吸合段相接）
      if (angleDiffDeg(gLast.endDir, snapDir) > minAngleDeg) {
        push(gLast.endX, gLast.endY, gLast.endDir + Math.PI, gLast.len, snapDir, gap);
      }
      // 顶点 2：原点（吸合段与首段相接）
      if (angleDiffDeg(snapDir, gFirst.startDir) > minAngleDeg) {
        push(0, 0, snapDir + Math.PI, gap, gFirst.startDir, gFirst.len);
      }
    } else if (angleDiffDeg(gLast.endDir, gFirst.startDir) > minAngleDeg) {
      // 完美闭合（终点≈原点）：末段与首段直接接缝
      push(0, 0, gLast.endDir + Math.PI, gLast.len, gFirst.startDir, gFirst.len);
    }
  }

  return out;
}

/**
 * 连续轨迹的局部最近点查询器（数学模型.md §8.6 一键调 PID 轨迹形状评价用）：
 * 轨迹点随时间连续推进，从上一次命中索引 ±window 范围内局部搜索（O(window)），
 * 命中距离超过 farM 时回退全局搜索（发散/跳变保护）。
 * 返回弧长 s 与有符号横向偏差 e（右正，右侧法向 (ty,−tx)，与 signedLateralDistance 同约定）。
 */
export function createNearestSeeker(path: PathSample, window = 300, farM = 0.3) {
  let hint = 0;
  return (x: number, y: number): { s: number; e: number; idx: number } => {
    const n = path.s.length;
    if (n === 0) return { s: 0, e: 0, idx: 0 };
    let best = hint;
    let bestD2 = Infinity;
    const lo = Math.max(0, hint - window);
    const hi = Math.min(n - 1, hint + window);
    for (let i = lo; i <= hi; i++) {
      const dx = x - path.pts[i * 2];
      const dy = y - path.pts[i * 2 + 1];
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = i;
      }
    }
    if (bestD2 > farM * farM) {
      for (let i = 0; i < n; i++) {
        const dx = x - path.pts[i * 2];
        const dy = y - path.pts[i * 2 + 1];
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) {
          bestD2 = d2;
          best = i;
        }
      }
    }
    hint = best;
    const tx = path.tang[best * 2];
    const ty = path.tang[best * 2 + 1];
    const dx = x - path.pts[best * 2];
    const dy = y - path.pts[best * 2 + 1];
    const sign = dx * ty - dy * tx >= 0 ? 1 : -1;
    return { s: path.s[best], e: sign * Math.sqrt(bestD2), idx: best };
  };
}
