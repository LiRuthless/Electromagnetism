/**
 * 实测数据模型自检（npm run selfcheck:measured）：
 *
 * 1. 生成示例 CSV（e_cm 从 -25 到 25 步进 5；L1/R1 用 h=70mm 的 Lorentzian + 5% 噪声，
 *    M1 用 |d| 形 + 5% 噪声；确定性伪随机，可复现）。
 * 2. parseMeasuredCSV：表头识别、cm->mm 换算、通道解析、点排序。
 * 3. fitChannelModel（方案A）：拟合 h_eff 应在 70mm ±15% 内，R² > 0.95。
 * 4. evalPhysModel（方案B 物理公式+偏差校正）：节点处精确回收实测值；
 *    节点间 = 物理基准 + 偏差线性插值；范围外钳位端点偏差、随基准形状外推。
 * 5. 兼容性：UTF-8 BOM、分号分隔、e(mm) 表头、非法行跳过。
 * 6. signedLateralDistance：直道中线左/右侧符号与距离。
 */
import {
  evalFitModel,
  evalPhysModel,
  fitChannelModel,
  parseMeasuredCSV,
  physBaseline,
  signedLateralDistance,
  type PhysBaselineCtx,
} from '../../src/model/measured';
import { samplePath } from '../../src/model/track';

let failures = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) failures++;
};

// 确定性伪随机（LCG），保证冒烟结果可复现
let seed = 42;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 0xffffffff;
};
/** 加 ±5% 乘性噪声 */
const noisy = (v: number) => v * (1 + 0.05 * (2 * rand() - 1));

const H_TRUE = 70; // 真实等效高度 mm
// 竖直电感（感 Bz）Lorentzian：U = k·h/(d²+h²)，峰值 k/h ≈ 5V -> k = 350
const lor = (dMm: number) => (350 * H_TRUE) / (dMm * dMm + H_TRUE * H_TRUE);
// 横躺电感（感 Bx）|d| 形：U = k·|d|/(d²+h²)，峰值 k/(2h) ≈ 5V -> k = 700
const absShape = (dMm: number) => (700 * Math.abs(dMm)) / (dMm * dMm + H_TRUE * H_TRUE);

// ---- 生成示例 CSV（e_cm 从 -25 到 25 步进 5）----
console.log('[1] 生成示例 CSV：e_cm ∈ [-25,25] 步进 5，L1/R1 Lorentzian(h=70mm)，M1 |d| 形，各加 5% 噪声');
const eCmList: number[] = [];
for (let e = -25; e <= 25; e += 5) eCmList.push(e);
const csvLines = ['e_cm,L1,R1,M1'];
for (const eCm of eCmList) {
  const dMm = eCm * 10;
  csvLines.push(`${eCm},${noisy(lor(dMm)).toFixed(4)},${noisy(lor(dMm)).toFixed(4)},${noisy(absShape(dMm)).toFixed(4)}`);
}
// 混入一个空行与一行非法行（应被跳过）
csvLines.push('');
csvLines.push('abc,1,2,3');
const csv = csvLines.join('\n');

// ---- 测试 1：解析 ----
console.log('\n[2] parseMeasuredCSV：表头识别 / cm->mm 换算 / 非法行跳过 / 排序');
const ds = parseMeasuredCSV(csv, 'smoke.csv');
check(ds.fileName === 'smoke.csv', `  文件名保留：${ds.fileName}`);
check(ds.points.length === 11, `  有效点 = ${ds.points.length}（应为 11，非法行已跳过）`);
check(
  ds.channels.join(',') === 'L1,R1,M1',
  `  通道 = ${ds.channels.join(',')}（应为 L1,R1,M1）`,
);
check(
  Math.abs(ds.points[0].eMm - -250) < 1e-9 && Math.abs(ds.points[10].eMm - 250) < 1e-9,
  `  e 范围 [${ds.points[0].eMm}, ${ds.points[10].eMm}] mm（cm 已 ×10 换算）`,
);
check(
  ds.points.every((p, i) => i === 0 || p.eMm >= ds.points[i - 1].eMm),
  '  采样点按 eMm 升序',
);
// 无单位表头按 cm 处理并标注
const dsNoUnit = parseMeasuredCSV('偏差,L1\n-10,1\n0,2\n10,1\n', 'nou nit.csv');
check(
  dsNoUnit.eUnitNote !== undefined && Math.abs(dsNoUnit.points[0].eMm - -100) < 1e-9,
  `  无单位表头"偏差"按 cm 处理并标注（eUnitNote="${dsNoUnit.eUnitNote}"）`,
);

// ---- 测试 2：方案A 拟合 ----
console.log('\n[3] fitChannelModel：h_eff 应在 70mm ±15% 内，R² > 0.95');
const fitDefs = [
  { ch: 'L1', axis: 'z' as const },
  { ch: 'R1', axis: 'z' as const },
  { ch: 'M1', axis: 'x' as const },
];
for (const { ch, axis } of fitDefs) {
  const fit = fitChannelModel(ds.points, ch, axis);
  const hOk = Math.abs(fit.hEffMm - H_TRUE) / H_TRUE <= 0.15;
  console.log(
    `  ${ch}（${axis} 轴）：k=${fit.k.toPrecision(4)}  h_eff=${fit.hEffMm.toFixed(1)}mm  ` +
      `e0=${fit.e0Mm.toFixed(1)}mm  RMSE=${fit.rmse.toFixed(4)}V  R²=${fit.r2.toFixed(4)}`,
  );
  check(hOk, `  ${ch}：h_eff=${fit.hEffMm.toFixed(1)}mm 在 70mm ±15% 内`);
  check(fit.r2 > 0.95, `  ${ch}：R²=${fit.r2.toFixed(4)} > 0.95`);
  check(Math.abs(fit.e0Mm) < 3, `  ${ch}：e0=${fit.e0Mm.toFixed(2)}mm ≈ 0（无对中残差）`);
}
// 拟合曲线在 d=0 处应接近峰值 5V（L1/R1）
const fitL1 = fitChannelModel(ds.points, 'L1', 'z');
const peak = evalFitModel(fitL1, 'z', 0);
check(Math.abs(peak - 5) / 5 < 0.1, `  L1 拟合峰值 U(0)=${peak.toFixed(3)}V ≈ 5V（偏差 <10%）`);

// ---- 测试 3：方案B 物理公式 + 偏差校正 ----
console.log('\n[4] evalPhysModel：节点回收实测值 / 节点间基准+偏差插值 / 范围外钳位偏差');
{
  // 横向 x 轴电感的物理基准 U₀(d) = k·μ₀I·h/(2π(d²+h²))，恰为 Lorentzian 形状
  const ctx: PhysBaselineCtx = { hM: 0.07, axis: [1, 0, 0], I: 0.1, k: 1.75e7 };
  const p0 = ds.points.find((p) => p.eMm === 0)!;
  const p50 = ds.points.find((p) => p.eMm === 50)!;
  const p250 = ds.points[ds.points.length - 1];

  // 节点处：δ̂ 精确等于该点偏差 -> 回收实测值
  check(
    evalPhysModel(ds.points, 'L1', 0, ctx) === p0.values.L1 &&
      evalPhysModel(ds.points, 'L1', 50, ctx) === p50.values.L1,
    '  节点处精确回收实测值（U = U₀ + δ_i = y_i）',
  );
  // 节点中点：U = U₀(mid) + 两侧偏差均值
  const d0 = p0.values.L1 - physBaseline(0, ctx);
  const d50 = p50.values.L1 - physBaseline(50, ctx);
  const expectMid = physBaseline(25, ctx) + (d0 + d50) / 2;
  const mid = evalPhysModel(ds.points, 'L1', 25, ctx);
  check(
    mid !== null && Math.abs(mid - expectMid) < 1e-9,
    `  中点 U(25mm)=${mid?.toFixed(4)} = 物理基准+偏差均值 ${expectMid.toFixed(4)}`,
  );
  // 范围外：钳位端点偏差，仍随基准物理形状外推（远端趋于 U₀ + δ_end，而非钳位 U 值）
  const dEnd = p250.values.L1 - physBaseline(250, ctx);
  const outFar = evalPhysModel(ds.points, 'L1', 1000, ctx);
  const expectFar = physBaseline(1000, ctx) + dEnd;
  check(
    outFar !== null && Math.abs(outFar - expectFar) < 1e-9,
    `  范围外 U(1000mm)=${outFar?.toFixed(4)} = 基准外推+端点偏差 ${expectFar.toFixed(4)}`,
  );
  check(evalPhysModel(ds.points, 'NO_SUCH', 0, ctx) === null, '  无数据通道返回 null');
}

// ---- 测试 4：兼容性（BOM / 分号 / e(mm) 表头）----
console.log('\n[5] CSV 兼容性：UTF-8 BOM / 分号分隔 / e(mm) 表头');
{
  const semi = '﻿e(mm);L1\n-50;1.5\n0;5.0\n50;1.5\n';
  const ds2 = parseMeasuredCSV(semi, 'semi.csv');
  check(
    ds2.points.length === 3 && Math.abs(ds2.points[0].eMm - -50) < 1e-9,
    `  BOM + 分号 + e(mm)：${ds2.points.length} 点，e 保持 mm 不换算`,
  );
  // 有效点不足 3 个应抛中文错误
  let threw = false;
  try {
    parseMeasuredCSV('e_cm,L1\n0,1\n5,2\n', 'few.csv');
  } catch (err) {
    threw = err instanceof Error && err.message.includes('有效采样点不足');
  }
  check(threw, '  少于 3 个有效点抛出中文错误');
}

// ---- 测试 5：有符号横向距离 ----
console.log('\n[6] signedLateralDistance：4m 直道（沿 +y），右侧为正');
{
  const path = samplePath({ name: '直道', segments: [{ kind: 'line', length: 4 }] });
  const dRight = signedLateralDistance(path, 0.1, 2.0); // 直道沿 +y，右侧 = +x
  const dLeft = signedLateralDistance(path, -0.1, 2.0);
  check(
    Math.abs(dRight - 0.1) < 0.006,
    `  (100,2000)mm：d=${(dRight * 1000).toFixed(1)}mm ≈ +100mm（右正）`,
  );
  check(
    Math.abs(dLeft + 0.1) < 0.006,
    `  (-100,2000)mm：d=${(dLeft * 1000).toFixed(1)}mm ≈ -100mm（左负）`,
  );
}

console.log(failures === 0 ? '\n实测模型自检全部通过 ✓' : `\n${failures} 项失败 ✗`);
process.exit(failures === 0 ? 0 : 1);
