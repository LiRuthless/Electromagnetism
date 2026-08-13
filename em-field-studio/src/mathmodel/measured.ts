/**
 * 真实赛道采值模型：实测电感数据（横向偏差 e vs 各通道 U）的导入、拟合与查表。
 *
 * 两种可切换的经验模型（智能车社区常见做法）：
 *
 * 【方案A —— 实测拟合模型（解析标定）】
 *   以无限长直导线磁场曲线形状为基做最小二乘拟合：
 *   - 竖直电感（感 Bz）：Lorentzian 形  U(d) = k·h_eff / ((d−e0)² + h_eff²)
 *   - 横躺电感（感 Bx，如中置 M1）：|d| 形  U(d) = k·|d−e0| / ((d−e0)² + h_eff²)
 *   d 为电感到导线的有符号横向距离（mm，右正）。
 *   拟合参数：每通道 k、h_eff（等效高度，含安装残差）、e0（对中残差）。
 *   实现：h_eff × e0 二维网格搜索，内层线性最小二乘解析求 k = Σ(y·f)/Σ(f²)，取 SSE 最小者。
 *
 * 【方案B —— 物理公式 + 偏差校正（phys，2026-07-31 起替代原 LUT 插值）】
 *   以仿真物理公式为基准：U₀(d) = k·|B(d)·n̂|（长直导线解析形状，含标定 k），
 *   只拟合/插值实测与公式的偏差：δ(d) = U_实测(d) − U₀(d)，
 *   δ 在各实测点处直接取值、分段线性插值（范围外钳位端点偏差），
 *   最终 U(d) = U₀(d) + δ̂(d)（钳位 ≥0）。
 *   公式保证整体形状与物理一致，偏差项只修正实车与理想模型的差异，
 *   外推与稀疏采样区比纯插值更稳健。
 *
 * CSV 格式：首行表头，第一列横向偏差（e_cm / e_mm / e(cm) / e(mm) / 偏差 等，
 * cm 自动换算成 mm；无法识别单位时按 cm 处理并在结果中标注），其余列为通道名
 * （与电感 name 对应，如 L1/R1/M1）。支持逗号/分号/制表符分隔，兼容 UTF-8 BOM。
 */
import type { AxisPreset } from './sensor';
import { MU0 } from './field';
import type { PathSample } from './track';

/** 单个实测采样点：横向偏差 e（mm，右正）+ 各通道读数（Vpp） */
export interface MeasuredPoint {
  eMm: number;
  /** 通道名 -> 读数（缺失通道不出现） */
  values: Record<string, number>;
}

/** 实测数据集（points 按 eMm 升序） */
export interface MeasuredDataset {
  fileName: string;
  channels: string[];
  points: MeasuredPoint[];
  /** e 列单位无法识别按 cm 处理时的中文标注（正常识别时为 undefined） */
  eUnitNote?: string;
}

/** 方案A 单通道拟合结果 */
export interface ChannelFit {
  /** 幅值系数（V·mm 量级，经验量） */
  k: number;
  /** 等效高度 h_eff（mm，含安装残差） */
  hEffMm: number;
  /** 对中残差 e0（mm） */
  e0Mm: number;
  /** 拟合残差均方根（Vpp） */
  rmse: number;
  /** 决定系数 R² */
  r2: number;
}

/** 实测模型种类：fit=方案A 解析拟合，phys=方案B 物理公式+偏差校正 */
export type MeasuredModelKind = 'fit' | 'phys';

/** 方案B 物理基准所需上下文（电感安装高度、车体系敏感轴、电流、标定 k） */
export interface PhysBaselineCtx {
  /** 电感安装高度（m） */
  hM: number;
  /** 车体系敏感轴向量（无需归一化） */
  axis: [number, number, number];
  /** 赛道电流（A） */
  I: number;
  /** 标定系数 k（V/T） */
  k: number;
}

/** 持久化/传递用的实测状态（数据集 + 每通道方案A 拟合结果） */
export interface MeasuredState {
  dataset: MeasuredDataset;
  fits: Record<string, ChannelFit>;
}

// ---------------- CSV 解析 ----------------

/** 首列（横向偏差列）可识别的表头名（小写、去空格/括号后匹配） */
const E_HEADER_PATTERNS: { re: RegExp; unit: 'cm' | 'mm' }[] = [
  { re: /^(e|偏差|横向偏差)\s*\(?(mm|毫米)\)?$/, unit: 'mm' },
  { re: /^(e|偏差|横向偏差)\s*\(?(cm|厘米)\)?$/, unit: 'cm' },
  { re: /^e_mm$/, unit: 'mm' },
  { re: /^e_cm$/, unit: 'cm' },
  { re: /^emm$/, unit: 'mm' },
  { re: /^ecm$/, unit: 'cm' },
];

function detectDelimiter(headerLine: string): string {
  const candidates = ['\t', ';', ','];
  let best = ',';
  let bestCount = 0;
  for (const c of candidates) {
    const n = headerLine.split(c).length - 1;
    if (n > bestCount) {
      best = c;
      bestCount = n;
    }
  }
  return best;
}

const parseNum = (s: string): number => {
  const v = Number(s.trim());
  return Number.isFinite(v) ? v : NaN;
};

/**
 * 解析实测 CSV：首行表头，第一列横向偏差（cm 自动换算 mm），其余列为通道名。
 * 空行/非法行跳过；有效点少于 3 个抛中文错误。
 */
export function parseMeasuredCSV(text: string, fileName: string): MeasuredDataset {
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // UTF-8 BOM
  const lines = clean.split(/\r\n|\r|\n/);
  const headerIdx = lines.findIndex((l) => l.trim().length > 0);
  if (headerIdx < 0) throw new Error('CSV 为空：未找到表头行');

  const delim = detectDelimiter(lines[headerIdx]);
  const header = lines[headerIdx].split(delim).map((s) => s.trim());
  if (header.length < 2) throw new Error('表头至少需要两列：横向偏差 e + 至少一个通道（如 e_cm,L1,R1）');

  // 识别 e 列单位；无法识别时按 cm 处理并标注（社区数据多为 cm）
  const eHeader = header[0].toLowerCase().replace(/\s+/g, '');
  let eScale = 10; // cm -> mm
  let eUnitNote: string | undefined;
  const matched = E_HEADER_PATTERNS.find((p) => p.re.test(eHeader));
  if (matched) {
    eScale = matched.unit === 'mm' ? 1 : 10;
  } else {
    eUnitNote = `e 列表头"${header[0]}"未识别单位，已按 cm 处理（×10 换算 mm）`;
  }

  const channels = header.slice(1).map((s, i) => s || `CH${i + 1}`);
  const points: MeasuredPoint[] = [];
  let skipped = 0;
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cells = line.split(delim);
    const e = parseNum(cells[0] ?? '');
    if (!Number.isFinite(e)) {
      skipped++;
      continue; // 非法行跳过
    }
    const values: Record<string, number> = {};
    let anyVal = false;
    for (let c = 0; c < channels.length; c++) {
      const v = parseNum(cells[c + 1] ?? '');
      if (Number.isFinite(v)) {
        values[channels[c]] = v;
        anyVal = true;
      }
    }
    if (!anyVal) {
      skipped++;
      continue;
    }
    points.push({ eMm: e * eScale, values });
  }

  if (points.length < 3) {
    throw new Error(
      `有效采样点不足：仅解析出 ${points.length} 个（跳过 ${skipped} 行），至少需要 3 个`,
    );
  }
  points.sort((a, b) => a.eMm - b.eMm);

  // 只保留确实出现过数据的通道
  const usedChannels = channels.filter((ch) => points.some((p) => ch in p.values));
  if (usedChannels.length === 0) throw new Error('未解析出任何通道数据列');
  return { fileName, channels: usedChannels, points, ...(eUnitNote ? { eUnitNote } : {}) };
}

// ---------------- 方案A：解析形状拟合 ----------------

/** 拟合形状函数 f(d)：z/兜底 -> Lorentzian；x -> |d| 形（均为归一形状，幅值由 k 承载） */
function fitShape(axisPreset: AxisPreset, dMm: number, hMm: number, e0Mm: number): number {
  const x = dMm - e0Mm;
  const denom = x * x + hMm * hMm;
  if (axisPreset === 'x') return Math.abs(x) / denom;
  return hMm / denom; // 'z'、'y'、'custom' 及未知一律 Lorentzian 兜底
}

/**
 * 方案A 最小二乘拟合：h_eff ∈ [15,200]mm × e0 ∈ [−40,40]mm 网格搜索（各约 60 档），
 * 内层线性最小二乘解析求 k = Σ(y·f)/Σ(f²)，取 SSE 最小者。
 * 有效点少于 3 个抛中文错误。
 */
export function fitChannelModel(
  points: MeasuredPoint[],
  channel: string,
  axisPreset: AxisPreset,
): ChannelFit {
  const data: { d: number; y: number }[] = [];
  for (const p of points) {
    const y = p.values[channel];
    if (Number.isFinite(y)) data.push({ d: p.eMm, y });
  }
  if (data.length < 3) {
    throw new Error(`通道 ${channel} 有效数据点不足（${data.length} < 3），无法拟合`);
  }

  const H_MIN = 15;
  const H_MAX = 200;
  const H_STEPS = 60;
  const E0_MIN = -40;
  const E0_MAX = 40;
  const E0_STEPS = 60;

  let best: { k: number; h: number; e0: number; sse: number } | null = null;
  for (let ih = 0; ih < H_STEPS; ih++) {
    const h = H_MIN + ((H_MAX - H_MIN) * ih) / (H_STEPS - 1);
    for (let ie = 0; ie < E0_STEPS; ie++) {
      const e0 = E0_MIN + ((E0_MAX - E0_MIN) * ie) / (E0_STEPS - 1);
      let sYF = 0;
      let sFF = 0;
      const fs = new Array<number>(data.length);
      for (let i = 0; i < data.length; i++) {
        const f = fitShape(axisPreset, data[i].d, h, e0);
        fs[i] = f;
        sYF += data[i].y * f;
        sFF += f * f;
      }
      if (sFF <= 1e-18) continue;
      const k = sYF / sFF;
      let sse = 0;
      for (let i = 0; i < data.length; i++) {
        const r = data[i].y - k * fs[i];
        sse += r * r;
      }
      if (!best || sse < best.sse) best = { k, h, e0, sse };
    }
  }
  if (!best) throw new Error(`通道 ${channel} 拟合失败：网格搜索无有效组合`);

  const n = data.length;
  const rmse = Math.sqrt(best.sse / n);
  const yMean = data.reduce((a, p) => a + p.y, 0) / n;
  let sst = 0;
  for (const p of data) sst += (p.y - yMean) * (p.y - yMean);
  const r2 = sst > 1e-18 ? 1 - best.sse / sst : 1;
  return { k: best.k, hEffMm: best.h, e0Mm: best.e0, rmse, r2 };
}

/** 方案A 求值：U(d) = k·f(d)（d 单位 mm，右正） */
export function evalFitModel(fit: ChannelFit, axisPreset: AxisPreset, dMm: number): number {
  return fit.k * fitShape(axisPreset, dMm, fit.hEffMm, fit.e0Mm);
}

// ---------------- 方案B：物理公式基准 + 偏差校正 ----------------

/**
 * 方案B 物理基准 U₀(d)：长直导线解析解（实测标定在直道上采集）。
 * 导线沿车头方向（+y），电感相对导线的位置为（横向 d，高度 h）：
 *   B = μ₀I/(2π(d²+h²)) · (h, 0, −d)    （ŷ×r，r = d·x̂ + h·ẑ）
 * U₀(d) = k·|B·n̂|，n̂ 为车体系敏感轴（无限长直导线下 By = 0）。
 */
export function physBaseline(dMm: number, ctx: PhysBaselineCtx): number {
  const d = dMm / 1000;
  const h = Math.max(ctx.hM, 1e-4);
  const rho2 = d * d + h * h;
  const c = (MU0 * ctx.I) / (2 * Math.PI * rho2);
  const bx = c * h;
  const bz = -c * d;
  const n = Math.hypot(ctx.axis[0], ctx.axis[1], ctx.axis[2]) || 1;
  return ctx.k * Math.abs((ctx.axis[0] * bx + ctx.axis[2] * bz) / n);
}

/**
 * 方案B 求值：U(d) = U₀(d) + δ̂(d)。
 * 各实测点偏差 δ_i = U_实测(d_i) − U₀(d_i)，分段线性插值；
 * 采样范围外钳位端点偏差（仍随 U₀ 物理形状外推）。结果钳位 ≥0（Vpp 非负）。
 * 通道无数据返回 null（调用方回退仿真公式）。
 */
export function evalPhysModel(
  points: MeasuredPoint[],
  channel: string,
  dMm: number,
  ctx: PhysBaselineCtx,
): number | null {
  const data: { d: number; delta: number }[] = [];
  for (const p of points) {
    const y = p.values[channel];
    if (Number.isFinite(y)) data.push({ d: p.eMm, delta: y - physBaseline(p.eMm, ctx) });
  }
  if (data.length === 0) return null;
  data.sort((a, b) => a.d - b.d);
  let delta: number;
  if (data.length === 1 || dMm <= data[0].d) {
    delta = data[0].delta;
  } else if (dMm >= data[data.length - 1].d) {
    delta = data[data.length - 1].delta;
  } else {
    delta = data[data.length - 1].delta;
    for (let i = 0; i + 1 < data.length; i++) {
      const a = data[i];
      const b = data[i + 1];
      if (dMm >= a.d && dMm <= b.d) {
        const w = b.d - a.d;
        delta = w < 1e-12 ? a.delta : a.delta + ((dMm - a.d) / w) * (b.delta - a.delta);
        break;
      }
    }
  }
  return Math.max(0, physBaseline(dMm, ctx) + delta);
}

// ---------------- 统一接口 ----------------

/**
 * 实测模型统一求值。通道无数据或（fit 模式下）无拟合结果时返回 null，
 * 调用方应回退其他数据源（如仿真公式）。
 * phys 模式必须提供 physCtx（电感高度/敏感轴/电流/标定 k）。
 */
export function evalMeasured(
  dataset: MeasuredDataset,
  fits: Record<string, ChannelFit>,
  modelKind: MeasuredModelKind,
  channel: string,
  axisPreset: AxisPreset,
  dMm: number,
  physCtx?: PhysBaselineCtx,
): number | null {
  if (!dataset.channels.includes(channel)) return null;
  if (modelKind === 'phys') {
    if (!physCtx) return null;
    return evalPhysModel(dataset.points, channel, dMm, physCtx);
  }
  const fit = fits[channel];
  if (!fit) return null;
  return evalFitModel(fit, axisPreset, dMm);
}

// ---------------- 有符号横向距离 ----------------

/**
 * 电感世界坐标 (x, y)（m）到赛道中线的最近有符号横向距离（m）。
 * 在 PathSample 采样点上做相邻点细分插值取最近点；
 * 符号按切向右手侧为正（right = (ty, −tx)），与 poseFrame 中 e > 0 右偏一致。
 */
export function signedLateralDistance(path: PathSample, x: number, y: number): number {
  const n = path.s.length;
  if (n === 0) return 0;
  let bestD2 = Infinity;
  let bestSign = 1;
  for (let i = 0; i < n; i++) {
    const px = path.pts[i * 2];
    const py = path.pts[i * 2 + 1];
    let qx = px;
    let qy = py;
    const tx = path.tang[i * 2];
    const ty = path.tang[i * 2 + 1];
    if (i + 1 < n) {
      // 线段细分插值：投影参数 t ∈ [0,1]
      const ax = path.pts[(i + 1) * 2] - px;
      const ay = path.pts[(i + 1) * 2 + 1] - py;
      const len2 = ax * ax + ay * ay;
      if (len2 > 1e-18) {
        let t = ((x - px) * ax + (y - py) * ay) / len2;
        t = Math.min(1, Math.max(0, t));
        qx = px + t * ax;
        qy = py + t * ay;
      }
    }
    const dx = x - qx;
    const dy = y - qy;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestD2 = d2;
      // 右侧法向 right = (ty, −tx)，投影符号即右偏方向
      const side = dx * ty - dy * tx;
      bestSign = side >= 0 ? 1 : -1;
    }
  }
  return Math.sqrt(bestD2) * bestSign;
}
