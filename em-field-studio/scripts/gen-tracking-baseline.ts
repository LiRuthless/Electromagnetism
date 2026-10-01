/**
 * Phase 12 Group 0：循迹轨迹回归基线生成（仅供重构动刀前运行一次）。
 *
 * 用重构前的 simulateTracking() 在固定场景上生成轨迹基线 + 一键调 PID 参考结果，
 * 输出 scripts/fixtures/tracking-baseline.json 并提交入库；重构后 selfcheck-sim.ts
 * 的 V-1（逐点一致）/ V-5（整定等价）以此为准。**重构开始后不得重跑本脚本**
 * （重跑会失去"重构前基线"语义；后续合法数值行为变更须同步重生成并记 CHANGELOG）。
 *
 * 场景与 selfcheck-tracking.ts [4]/[6]b 同构：4m 直道收敛 + S 弯。
 */
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileFormula, DEFAULT_TRACKING } from '../src/mathmodel/control';
import type { TrackingParams } from '../src/mathmodel/control';
import { simulateTracking } from '../src/mathmodel/kinematics';
import type { TrackingResult } from '../src/mathmodel/kinematics';
import { buildFieldElements, createNearestSeeker, samplePath, segmentLength } from '../src/mathmodel/track';
import type { SegDef, TrackDef } from '../src/mathmodel/track';
import { computeB } from '../src/mathmodel/field';
import { defaultLayout, kFromAnchor } from '../src/mathmodel/sensor';
import type { SensorDef } from '../src/mathmodel/sensor';

interface Scenario {
  name: string;
  track: TrackDef;
  closed: boolean;
  currentMa: number;
  vppAnchor: number;
  params: TrackingParams;
  result: TrackingResult;
}

const gitCommit = (() => {
  try {
    return execSync('git rev-parse HEAD').toString().trim();
  } catch {
    return 'unknown';
  }
})();

function runScenario(
  name: string,
  track: TrackDef,
  closed: boolean,
  params: TrackingParams,
): Scenario {
  const path = samplePath(track);
  const elements = buildFieldElements(track);
  const sensors = defaultLayout();
  const k = kFromAnchor(6);
  const I = 0.1;
  const result = simulateTracking({
    path,
    sensors,
    params,
    formula: compileFormula(params.formula),
    closed,
    readSensor: (sensor, w, ax) => {
      const [bx, by, bz] = computeB(w.x, w.y, sensor.h, elements, I);
      return k * Math.abs(bx * ax[0] + by * ax[1] + bz * ax[2]);
    },
  });
  console.log(
    `  [${name}] status=${result.status} steps=${result.steps} dist=${result.distM.toFixed(3)}m ` +
      `elapsed=${result.elapsedMs.toFixed(0)}ms finishIndex=${result.finishIndex}`,
  );
  return { name, track, closed, currentMa: 100, vppAnchor: 6, params, result };
}

// 场景A：4m 直道收敛（selfcheck-tracking [4] 同参数）
const scenarioA = runScenario(
  'straight-4m',
  { name: '直道', segments: [{ kind: 'line', length: 4 }] },
  false,
  { ...DEFAULT_TRACKING, enabled: true, initEMm: 50, P: -1, kp: 0.5, kd: 0.05, vBase: 1, vMax: 2 },
);

// 场景B：S 弯（selfcheck-tracking [6]b 同参数）
const sCurveSegs: SegDef[] = [
  { kind: 'line', length: 1 },
  { kind: 'arc', radius: 1, angleDeg: 60, turn: 'right' },
  { kind: 'line', length: 1 },
  { kind: 'arc', radius: 1, angleDeg: 60, turn: 'left' },
  { kind: 'line', length: 0.5 },
];
const scenarioB = runScenario(
  's-curve',
  { name: 'S弯', segments: sCurveSegs },
  false,
  { ...DEFAULT_TRACKING, enabled: true, P: -1, kp: 0.5, kd: 0.05, vBase: 1, vMax: 2 },
);

// ---- 一键调 PID 参考结果（Home.tsx runAutoTune 重构前算法逐行复刻，S 弯场景） ----
console.log('  [autotune] 网格搜索 13×11 + 9×9（S 弯场景，Kp≤30 / Kd≤5 / 内收≤50mm）…');
function wrapAngle(a: number): number {
  let r = a % (2 * Math.PI);
  if (r > Math.PI) r -= 2 * Math.PI;
  if (r <= -Math.PI) r += 2 * Math.PI;
  return r;
}
function autotuneReference(): { kp: number; kd: number } | null {
  const track = scenarioB.track;
  const base = scenarioB.params;
  const path = samplePath(track);
  const elements = buildFieldElements(track);
  const sensors: SensorDef[] = defaultLayout();
  const k = kFromAnchor(6);
  const I = 0.1;
  const formula = compileFormula(base.formula);
  const eInMaxM = 50 / 1000;
  const kpMax = 30;
  const kdMax = 5;
  const spans: { endS: number; kind: 'line' | 'arc'; turn?: 'left' | 'right' }[] = [];
  let acc = 0;
  for (const seg of track.segments) {
    acc += segmentLength(seg);
    spans.push({ endS: acc, kind: seg.kind, turn: seg.kind === 'arc' ? seg.turn : undefined });
  }
  interface Cand {
    kp: number;
    kd: number;
    J: number;
    timeS: number;
  }
  const score = (kp: number, kd: number): Cand | null => {
    const r = simulateTracking({
      path,
      sensors,
      params: { ...base, kp, kd },
      formula,
      closed: false,
      readSensor: (sensor, w, ax) => {
        const [bx, by, bz] = computeB(w.x, w.y, sensor.h, elements, I);
        return k * Math.abs(bx * ax[0] + by * ax[1] + bz * ax[2]);
      },
    });
    if (r.status !== 'finished') return null;
    const n = Math.max(1, r.finishIndex + 1);
    const seek = createNearestSeeker(path);
    let sumLine = 0;
    let cntLine = 0;
    let sumOut = 0;
    let sumInX = 0;
    let cntArc = 0;
    let sumJit = 0;
    for (let i = 0; i < n; i++) {
      const { s, e } = seek(r.x[i], r.y[i]);
      const span = spans.find((sp) => s <= sp.endS + 1e-9) ?? spans[spans.length - 1];
      if (!span || span.kind === 'line') {
        sumLine += e * e;
        cntLine++;
      } else {
        const inward = span.turn === 'right' ? e : -e;
        const eOut = Math.max(0, -inward);
        const eInX = Math.max(0, inward - eInMaxM);
        sumOut += eOut * eOut;
        sumInX += eInX * eInX;
        cntArc++;
      }
      if (i >= 1 && i <= n - 2) {
        const j2 = wrapAngle(r.theta[i + 1] - 2 * r.theta[i] + r.theta[i - 1]);
        sumJit += j2 * j2;
      }
    }
    const rms = (s2: number, c: number) => Math.sqrt(s2 / Math.max(1, c));
    const J = rms(sumLine, cntLine) + 2 * rms(sumOut, cntArc) + rms(sumInX, cntArc) + 0.5 * rms(sumJit, Math.max(1, n - 2));
    return { kp, kd, J, timeS: r.t[r.finishIndex] ?? r.timeS };
  };
  const better = (a: Cand, b: Cand | null): boolean =>
    !b || a.J < b.J - 1e-9 || (Math.abs(a.J - b.J) <= 1e-9 && a.timeS < b.timeS);
  const KP_N = 13;
  const KD_N = 11;
  let best: Cand | null = null;
  for (let i = 0; i < KP_N; i++) {
    const kp = (kpMax * i) / (KP_N - 1);
    for (let j = 0; j < KD_N; j++) {
      const kd = (kdMax * j) / (KD_N - 1);
      const c = score(kp, kd);
      if (c && better(c, best)) best = c;
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
      }
    }
  }
  return best ? { kp: best.kp, kd: best.kd } : null;
}
const autotuneBest = autotuneReference();
console.log(`  [autotune] 最优 Kp=${autotuneBest?.kp} Kd=${autotuneBest?.kd}`);

const fixture = {
  note: 'Phase 12 回归基线：重构前 simulateTracking/runAutoTune 生成；V-1 逐点比对（<1e-12）、V-5 整定等价以此为锚。重构开始后不得重跑生成脚本。',
  generatedAt: new Date().toISOString(),
  gitCommit,
  scenarios: [scenarioA, scenarioB],
  autotune: {
    scenario: 's-curve',
    kpMax: 30,
    kdMax: 5,
    eInMaxMm: 50,
    total: 13 * 11 + 81,
    best: autotuneBest,
  },
};
const out = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'tracking-baseline.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(fixture), 'utf8');
console.log(`基线已写入 ${out}（commit ${gitCommit.slice(0, 8)}）`);
