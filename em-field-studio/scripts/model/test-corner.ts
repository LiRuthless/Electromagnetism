/**
 * 直角区域离散误差量化（L 形赛道：两段 1000mm 直线尖角相连）。
 * 运行：npx tsx scripts/test-corner.ts
 *
 * 真值：两段有限长直导线的闭式解叠加（wireSegB）。
 * 对比：当前离散引擎（直线段离散成 ≤10mm 电流元求和）。
 *
 * 输出：闭式解自洽性（vs 无限长解析解）+ 尖角周围多点误差表 + 空间分布统计。
 */
import { computeB, infiniteWireB, wireSegB } from '../../src/model/field';
import { buildElements, buildFieldElements, type TrackDef } from '../../src/model/track';

const I = 0.1;
const H = 0.07;

// ---- 闭式解自洽：20m 长直导线中段 vs 无限长解析解 ----
{
  const a = wireSegB(0.1, 0, H, 0, -10, 0, 10, I);
  const b = infiniteWireB(0.1, 0, H, I);
  const rel = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) / Math.hypot(...b);
  console.log(`[0] 闭式解自洽：20m 导线中段 vs 无限长解析解，相对差 ${(rel * 100).toFixed(4)}%（端部修正预期 ~0.05%）`);
}

// ---- L 形赛道：段1 (0,0)->(0,1) 沿+y，段2 (0,1)->(1,1) 沿+x，尖角顶点 C=(0,1) ----
const L: TrackDef = {
  name: 'L直角',
  segments: [
    { kind: 'line', length: 1 },
    { kind: 'line', length: 1, absAngle: 0 },
  ],
};
const el = buildElements(L); // 旧：全离散引擎
const elF = buildFieldElements(L); // 新：直线段闭式 + 圆弧离散
console.log(`\nL 形赛道：旧离散 ${el.count} 段；新场模型 闭式直线段=${(elF.wires?.length ?? 0) / 4} + 圆弧离散=${elF.count} 段`);

/** 真值：两段闭式叠加 */
function truthB(px: number, py: number, pz: number): [number, number, number] {
  const a = wireSegB(px, py, pz, 0, 0, 0, 1, I);
  const b = wireSegB(px, py, pz, 0, 1, 1, 1, I);
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

interface Row { label: string; dMm: number; errPct: number; }
const rows: Row[] = [];
const rowsNew: Row[] = [];

function probe(label: string, px: number, py: number) {
  const tru = truthB(px, py, H);
  const tMag = Math.hypot(...tru);
  const num = computeB(px, py, H, el, I);
  const numF = computeB(px, py, H, elF, I);
  const err = Math.abs(Math.hypot(...num) - tMag) / Math.max(tMag, 1e-15);
  const errF = Math.abs(Math.hypot(...numF) - tMag) / Math.max(tMag, 1e-15);
  const dMm = Math.hypot(px - 0, py - 1) * 1000;
  rows.push({ label, dMm, errPct: err * 100 });
  rowsNew.push({ label, dMm, errPct: errF * 100 });
  console.log(
    `  ${label.padEnd(18)} 距顶点 ${dMm.toFixed(0).padStart(3)}mm  |B|_真值=${(tMag * 1e6).toFixed(4)}μT  旧离散误差=${(err * 100).toFixed(3)}%  新闭式误差=${(errF * 100).toExponential(1)}`,
  );
}

console.log('\n[1] 尖角两侧对称点（关于角平分线对称，真值 |B| 应相等）');
for (const dMm of [20, 50, 100, 200]) {
  const d = dMm / 1000;
  // 角平分线方向 (1,1)/√2，对称点对取平分线 ±45° 方向
  probe(`臂1侧 d=${dMm}`, 0 + d * Math.SQRT1_2, 1 + d * Math.SQRT1_2); // 顶点沿 (1,1) 外侧
  probe(`臂2侧 d=${dMm}`, 0 - d * Math.SQRT1_2, 1 - d * Math.SQRT1_2); // 镜像点
}

console.log('\n[2] 角平分线上的点（内角平分线方向 (-1,1)/√2 与外延 (1,1)/√2）');
for (const dMm of [20, 50, 100, 200]) {
  const d = dMm / 1000;
  probe(`内平分线 d=${dMm}`, 0 - d * Math.SQRT1_2, 1 + d * Math.SQRT1_2);
  probe(`外平分线 d=${dMm}`, 0 + d * Math.SQRT1_2, 1 - d * Math.SQRT1_2);
}

console.log('\n[3] 贴臂近点（距臂 20mm，沿臂不同位置，考察臂中段的离散误差）');
for (const offMm of [100, 300, 500, 800]) {
  const o = offMm / 1000;
  probe(`臂1近点 y=${offMm}`, 0.02, o);
  probe(`臂2近点 x=${offMm}`, o, 1.02);
}

// ---- 汇总 ----
const max = rows.reduce((a, r) => (r.errPct > a.errPct ? r : a), rows[0]);
const maxN = rowsNew.reduce((a, r) => (r.errPct > a.errPct ? r : a), rowsNew[0]);
const by20 = rows.filter((r) => r.dMm <= 25).map((r) => r.errPct);
const by200 = rows.filter((r) => r.dMm >= 150).map((r) => r.errPct);
const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
console.log('\n========== 汇总 ==========');
console.log(`旧离散引擎：最大误差 ${max.errPct.toFixed(3)}%（${max.label}，距顶点 ${max.dMm.toFixed(0)}mm）`);
console.log(`旧离散引擎：近顶点区（≤25mm）平均 ${avg(by20).toFixed(3)}%，远顶点区（≥150mm）平均 ${avg(by200).toFixed(3)}%`);
console.log(`新闭式引擎：最大误差 ${maxN.errPct.toExponential(2)}%（${maxN.label}）——应为双精度机器量级`);
