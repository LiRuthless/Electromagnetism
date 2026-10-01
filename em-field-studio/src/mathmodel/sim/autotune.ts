/**
 * 一键调 PID 网格搜索（Phase 12 从 Home.tsx 迁入模型层；算法逐行等价，
 * 数学模型.md §8.6，2026-08-03 起目标为轨迹形状贴合式 (8.11)）：
 *
 * 在 [0,kpMax]×[0,kdMax] 网格搜索（粗搜 13×11 + 最优邻域 9×9 细化），逐组跑
 * Simulator.runToEnd() 循迹仿真；目标
 *   J = RMS(|e|_直线) + 2·RMS(e_外,弯道) + RMS(max(0, e_内−e_内,max)_弯道) + 0.5·RMS(Δθ 抖动)；
 * 直线段罚横向偏差 |e|；弯道允许并鼓励内收 ≤ e_in_max 不罚、外偏 2 倍罚、
 * 罚航向抖动保证过弯圆润；逐轨迹点按 segSpans 段类型分类，局部最近点查询
 * createNearestSeeker O(窗口) 评价；选优顺序 = 先比能否完赛 → J 最小 → 完赛时间最短。
 *
 * 分块让出事件循环的职责在 UI 侧：模型层为生成器（逐候选 yield 进度，
 * 不依赖 setTimeout）；runAutoTuneSync 为同步排干包装（Node 自检用）。
 */
import { createNearestSeeker, segmentLength } from '../track';
import type { PathSample, SegDef } from '../track';
import type { TrackingParams } from '../control';
import type { Simulator } from './simulator';

/** 中线段弧长区间表（轨迹形状评价：直线段/弯道段分类；闭环吸合段按直线段处理） */
export interface SegSpan {
  endS: number;
  kind: 'line' | 'arc';
  turn?: 'left' | 'right';
}

export function buildSegSpans(segments: SegDef[], closed: boolean, pathLength: number): SegSpan[] {
  const spans: SegSpan[] = [];
  let acc = 0;
  for (const seg of segments) {
    acc += segmentLength(seg);
    spans.push({ endS: acc, kind: seg.kind, turn: seg.kind === 'arc' ? seg.turn : undefined });
  }
  if (closed) {
    acc += Math.max(0, pathLength - acc);
    spans.push({ endS: acc, kind: 'line' });
  }
  return spans;
}

/** 角度归一化到 (−π, π]（最短弧；航向抖动二阶差分用） */
export function wrapAngle(a: number): number {
  let r = a % (2 * Math.PI);
  if (r > Math.PI) r -= 2 * Math.PI;
  if (r <= -Math.PI) r += 2 * Math.PI;
  return r;
}

export interface AutoTuneOpts {
  /** 已装配 FormulaController 的仿真器（每个候选 reset({...baseParams, kp, kd}) 后 runToEnd） */
  simulator: Simulator;
  /** 除 kp/kd 外其余循迹参数 */
  baseParams: TrackingParams;
  path: PathSample;
  segSpans: SegSpan[];
  kpMax: number;
  kdMax: number;
  eInMaxMm: number;
}

interface Cand {
  kp: number;
  kd: number;
  J: number;
  timeS: number;
}

/**
 * 网格搜索生成器：逐候选评估后 yield { done, total }（末次 yield 后 return 最优组合，
 * 无可行解 return null）；UI 侧按 yield 节奏分块让出事件循环。
 */
export function* autoTuneGrid(
  opts: AutoTuneOpts,
): Generator<{ done: number; total: number }, { kp: number; kd: number } | null> {
  const { simulator, baseParams, path, segSpans, kpMax, kdMax } = opts;
  const eInMaxM = opts.eInMaxMm / 1000;

  const score = (kp: number, kd: number): Cand | null => {
    simulator.reset({ ...baseParams, kp, kd });
    const r = simulator.runToEnd();
    if (r.status !== 'finished') return null; // 失控/步数上限不可行
    const n = Math.max(1, r.finishIndex + 1);
    // 逐轨迹点按所在中线段类型分类评价（局部最近点查询，轨迹连续 O(窗口)）
    const seek = createNearestSeeker(path);
    let sumLine = 0;
    let cntLine = 0;
    let sumOut = 0;
    let sumInX = 0;
    let cntArc = 0;
    let sumJit = 0;
    for (let i = 0; i < n; i++) {
      const { s, e } = seek(r.x[i], r.y[i]);
      const span = segSpans.find((sp) => s <= sp.endS + 1e-9) ?? segSpans[segSpans.length - 1];
      if (!span || span.kind === 'line') {
        sumLine += e * e; // 直线段：罚横向偏差
        cntLine++;
      } else {
        // 弯道段：内收（弯心侧）≤ e_in_max 不罚；外偏 2 倍罚（外偏量平方见 J 组合）
        const inward = span.turn === 'right' ? e : -e; // >0 = 弯心侧
        const eOut = Math.max(0, -inward);
        const eInX = Math.max(0, inward - eInMaxM); // 内收超上限部分罚 1 倍
        sumOut += eOut * eOut;
        sumInX += eInX * eInX;
        cntArc++;
      }
      if (i >= 1 && i <= n - 2) {
        // 航向抖动：相邻步 Δθ 二阶差分（突变/振荡），按最短弧
        const j2 = wrapAngle(r.theta[i + 1] - 2 * r.theta[i] + r.theta[i - 1]);
        sumJit += j2 * j2;
      }
    }
    const rms = (s2: number, c: number) => Math.sqrt(s2 / Math.max(1, c));
    const J =
      rms(sumLine, cntLine) +
      2 * rms(sumOut, cntArc) +
      rms(sumInX, cntArc) +
      0.5 * rms(sumJit, Math.max(1, n - 2));
    return { kp, kd, J, timeS: r.t[r.finishIndex] ?? r.timeS };
  };
  const better = (a: Cand, b: Cand | null): boolean =>
    !b || a.J < b.J - 1e-9 || (Math.abs(a.J - b.J) <= 1e-9 && a.timeS < b.timeS);

  // 粗搜 13×11，局部细化 9×9
  const KP_N = 13;
  const KD_N = 11;
  const TOTAL = KP_N * KD_N + 81;
  let done = 0;
  let best: Cand | null = null;
  for (let i = 0; i < KP_N; i++) {
    const kp = (kpMax * i) / (KP_N - 1);
    for (let j = 0; j < KD_N; j++) {
      const kd = (kdMax * j) / (KD_N - 1);
      const c = score(kp, kd);
      if (c && better(c, best)) best = c;
      done++;
      yield { done, total: TOTAL };
    }
  }
  if (best) {
    const kpStep = kpMax / (KP_N - 1);
    const kdStep = kdMax / (KD_N - 1);
    const b0 = best;
    for (let i = -4; i <= 4; i++) {
      const kp = Math.max(0, b0.kp + (i * kpStep) / 4);
      for (let j = -4; j <= 4; j++) {
        const kd = Math.max(0, b0.kd + (j * kdStep) / 4);
        const c = score(kp, kd);
        if (c && better(c, best)) best = c;
        done++;
        yield { done, total: TOTAL };
      }
    }
  }
  yield { done: TOTAL, total: TOTAL };
  return best ? { kp: best.kp, kd: best.kd } : null;
}

/** 同步排干包装（Node 自检 / 非交互场景用） */
export function runAutoTuneSync(opts: AutoTuneOpts): { kp: number; kd: number } | null {
  const gen = autoTuneGrid(opts);
  let r = gen.next();
  while (!r.done) r = gen.next();
  return r.value;
}
