/**
 * 全程扫描曲线形态自检（Node 直跑，不进 npm run selfcheck 的 28 项物理自检）。
 * 运行：npx tsx scripts/test-sweep.ts
 *
 * [A] 直道：8m 直线赛道，e=ψ=0。中段（排除端部效应区）各电感 U 应近似恒定（波动 <1%）。
 * [B] 弯道：1m 直线 + 90° 圆弧(r=0.5m) + 1m 直线。弯道区应出现特征起伏（max/min > 1.3）。
 */
import { defaultLayout } from '../src/mathmodel/sensor';
import { sweepAlongTrack } from '../src/mathmodel/sweep';
import { buildFieldElements, samplePath } from '../src/mathmodel/track';
import type { TrackDef } from '../src/mathmodel/track';

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra = '') {
  if (cond) {
    passed++;
    console.log(`PASS  ${name}${extra ? `（${extra}）` : ''}`);
  } else {
    failed++;
    console.log(`FAIL  ${name}${extra ? `（${extra}）` : ''}`);
  }
}

const sensors = defaultLayout();
const I = 0.1; // 100mA

function stats(values: Float64Array, from = 0, to = values.length - 1) {
  let min = Infinity;
  let max = -Infinity;
  let maxIdx = from;
  let sum = 0;
  let n = 0;
  for (let i = from; i <= to; i++) {
    const v = values[i];
    if (v < min) min = v;
    if (v > max) {
      max = v;
      maxIdx = i;
    }
    sum += v;
    n++;
  }
  return { min, max, mean: sum / n, maxIdx, fluct: (max - min) / ((max + min) / 2) };
}

// ---------------- [A] 直道 ----------------
console.log('[A] 直道扫描：8m 直线，e=0 ψ=0，中段 U 近似恒定');
const straight: TrackDef = { name: 'straight', segments: [{ kind: 'line', length: 8 }] };
const elA = buildFieldElements(straight);
const pathA = samplePath(straight);
const swA = sweepAlongTrack(pathA, elA, sensors, I, 0, 0, 1);
console.log(`  扫描 ${swA.sMm.length} 点 × ${swA.series.length} 电感，耗时 ${swA.elapsedMs.toFixed(1)}ms`);
check('扫描耗时 < 300ms', swA.elapsedMs < 300, `${swA.elapsedMs.toFixed(1)}ms`);

// 中段 50%（2m..6m），排除端部效应
const i0 = Math.round(2000 / swA.stepMm);
const i1 = Math.round(6000 / swA.stepMm);
for (const se of swA.series) {
  const st = stats(se.values, i0, i1);
  console.log(
    `  ${se.name}: 中段均值 ${(st.mean * 1e6).toFixed(3)} U(k=1, μT 等效)，波动 ${(st.fluct * 100).toFixed(3)}%`,
  );
  // 新默认 4 电感布局（2026-08-03）：主对 L1/R1 感 By——直导线 By≡0，读数恒 0，
  // 相对波动对近零通道无意义，改查绝对幅值；其余通道查相对波动
  if (st.mean < 1e-9) {
    check(`直道中段 ${se.name} 读数 ≈ 0（感 By，直导线无纵向分量）`, st.max < 1e-9, `max=${st.max.toExponential(2)}`);
  } else {
    check(`直道中段 ${se.name} 波动 < 1%`, st.fluct < 0.01, `${(st.fluct * 100).toFixed(3)}%`);
  }
}

// ---------------- [B] 弯道 ----------------
console.log('[B] 弯道扫描：1m 直线 + 90° 弧(r=0.5m) + 1m 直线，弯道区特征起伏');
const corner: TrackDef = {
  name: 'corner',
  segments: [
    { kind: 'line', length: 1 },
    { kind: 'arc', radius: 0.5, angleDeg: 90, turn: 'right' },
    { kind: 'line', length: 1 },
  ],
};
const elB = buildFieldElements(corner);
const pathB = samplePath(corner);
const swB = sweepAlongTrack(pathB, elB, sensors, I, 0, 0, 1);
console.log(
  `  全长 ${(pathB.length * 1000).toFixed(0)}mm，扫描 ${swB.sMm.length} 点 × ${swB.series.length} 电感，耗时 ${swB.elapsedMs.toFixed(1)}ms`,
);

let bestSwing = 0;
let bestRatio = 0;
let bestName = '';
let bestMaxS = 0;
for (const se of swB.series) {
  const st = stats(se.values);
  const ratio = st.max / Math.max(st.min, 1e-15);
  const swing = st.max - st.min;
  console.log(
    `  ${se.name}: min ${(st.min * 1e6).toFixed(3)} / max ${(st.max * 1e6).toFixed(3)} U(k=1)，摆幅 ${(swing * 1e6).toFixed(3)}，max/min=${ratio.toFixed(2)}，峰值 s=${(st.maxIdx * swB.stepMm).toFixed(0)}mm`,
  );
  if (swing > bestSwing) {
    bestSwing = swing;
    bestRatio = ratio;
    bestName = se.name;
    bestMaxS = st.maxIdx * swB.stepMm;
  }
}
check('弯道区出现特征起伏（摆幅最强曲线 max/min > 1.3）', bestRatio > 1.3, `${bestName} max/min=${bestRatio.toFixed(2)}`);
// 峰值应出现在弯道附近（弧段起点 1000mm ~ 弧段终点 1000+785=1785mm，前后放宽 300mm）
check('峰值位于弯道附近（700~2100mm）', bestMaxS >= 700 && bestMaxS <= 2100, `峰值 s=${bestMaxS.toFixed(0)}mm`);

console.log(`\n${failed === 0 ? '扫描曲线形态自检全部通过 ✓' : `有 ${failed} 项失败 ✗`}（${passed} 项通过）`);
process.exit(failed === 0 ? 0 : 1);
