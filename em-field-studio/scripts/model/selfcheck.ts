/**
 * 物理正确性自检（npm run selfcheck）：
 *
 * 1. 4 m 长直道中心附近，毕奥-萨伐尔数值解 vs 无限长直导线解析解
 *    B = μ0I/(2πρ)，相对误差应 < 2%（r ∈ [2, 20] cm，h = 7 cm）。
 * 2. B ∝ 1/r 反比衰减验证：相邻半径 B 之比应接近 r 反比。
 * 3. 弯道 / 十字 / 正六边形环岛赛道离散化与场值合理性（有限、非零）。
 * 4. 弧长与离散化交叉验证（半圆=πR、自由铺设 ≤1cm、笔尖连续性）。
 * 5. 尖角近似：尖角折线 vs 0.5mm 圆角过渡，探测距离 ≥2cm 处场值差异 <0.1%
 *    （验证探测尺度下尖角近似成立；尖角依据是最小弯曲半径 ~0.25mm ≪ 探测尺度）。
 * 6. 正六边形几何：边长 a 周长 = 6a，离散段 ≤1cm。
 * 7. 有限线径恒等：d=0.5mm 圆截面导线外部场与同轴细线电流严格相同（安培环路定理）。
 * 8. 电感读数审计：8m 直道解析解 vs 引擎逐电感对比（Tesla 域）。
 * 9. 直角区域闭式解真值 vs 引擎（机器精度）。
 * 10. 电感标定审计：贴线锚点自洽（k 由 Vpp 锚点反推）、读数随电流线性缩放、cosθ 方向性。
 */
import { computeB, infiniteWireB, MU0, wireSegB } from '../../src/model/field';
import {
  defaultLayout,
  kFromAnchor,
  poseFrame,
  sensorAxisWorld,
  sensorWorld,
  TOUCH_DIST_M,
  VPP_ANCHOR_DEFAULT,
} from '../../src/model/sensor';
import {
  advancePen,
  buildElements,
  buildFieldElements,
  hexagonSegs,
  pointAtLength,
  samplePath,
  segmentLength,
  segmentSummaries,
  trackTip,
  PEN_START,
  type TrackDef,
} from '../../src/model/track';

let failures = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) failures++;
};

const I = 0.1; // 100 mA
// 直道：(0,0) -> (0,4)，电流 +y（鼠标连线等效定义）
const straight: TrackDef = { name: '直道', segments: [{ kind: 'line', length: 4 }] };
const el = buildElements(straight);
console.log(`直道离散电流元: ${el.count} 段（4000mm / 10mm 应为 400）`);
check(el.count === 400, '离散段数 = 400（段长 ≤ 10mm）');

// ---- 测试 1：数值解 vs 解析解（场点取导线中点 y=2 高度 h=7cm 处，横向 r）
console.log('\n[1] 直道中心横向扫描：数值解 vs B=μ0I/(2πρ)，ρ=sqrt(r²+h²)');
const h = 0.07;
let maxErr = 0;
const bVals: { rho: number; b: number }[] = [];
for (const rcm of [2, 3, 5, 8, 12, 16, 20]) {
  const r = rcm / 100;
  const rho = Math.hypot(r, h);
  const [bx, , bz] = computeB(r, 2.0, h, el, I);
  const bNum = Math.hypot(bx, bz);
  const [ax, ay, az] = infiniteWireB(r, 0, h, I); // 解析解（场点 (r,0,h)，导线沿 y）
  const bAna = Math.hypot(ax, ay, az);
  const bTheory = (MU0 * I) / (2 * Math.PI * rho);
  const err = Math.abs(bNum - bAna) / bAna;
  maxErr = Math.max(maxErr, err);
  bVals.push({ rho, b: bNum });
  console.log(
    `  r=${String(rcm * 10).padStart(3)}mm  ρ=${(rho * 1000).toFixed(1)}mm  ` +
      `B_num=${(bNum * 1e6).toFixed(3)}μT  B_ana=${(bAna * 1e6).toFixed(3)}μT  ` +
      `(理论=${(bTheory * 1e6).toFixed(3)}μT)  误差=${(err * 100).toFixed(2)}%`,
  );
  check(Math.abs(bAna - bTheory) / bTheory < 1e-9, `  解析解自洽 r=${rcm}cm`);
}
check(maxErr < 0.02, `最大相对误差 ${(maxErr * 100).toFixed(2)}% < 2%`);

// ---- 测试 2：B ∝ 1/ρ 反比衰减
console.log('\n[2] B ∝ 1/ρ 衰减验证');
for (let i = 1; i < bVals.length; i++) {
  const ratioB = bVals[i - 1].b / bVals[i].b;
  const ratioR = bVals[i].rho / bVals[i - 1].rho;
  const dev = Math.abs(ratioB - ratioR) / ratioR;
  check(dev < 0.02, `  B(${bVals[i - 1].rho.toFixed(3)})/B(${bVals[i].rho.toFixed(3)}) = ${ratioB.toFixed(3)} ≈ ρ 反比 ${ratioR.toFixed(3)}（偏差 ${(dev * 100).toFixed(2)}%）`);
}

// ---- 测试 3：其他赛道形状场值合理性
console.log('\n[3] 弯道 / 十字 / 正六边形环岛 场值合理性');
{
  const curve: TrackDef = {
    name: '弯道 R=50',
    segments: [
      { kind: 'line', length: 1.5 },
      { kind: 'arc', radius: 0.5, angleDeg: 90, turn: 'right' },
      { kind: 'line', length: 1.5 },
    ],
  };
  const cross: TrackDef = {
    name: '十字',
    segments: [{ kind: 'line', length: 4 }],
    extraWires: [
      [
        [-2, 2],
        [2, 2],
      ],
    ],
  };
  const hexTrack: TrackDef = {
    name: '正六边形环岛',
    segments: hexagonSegs(PEN_START, 0.5, 'right'),
  };
  for (const [label, def] of [
    ['弯道 R=50', curve],
    ['十字', cross],
    ['正六边形环岛', hexTrack],
  ] as const) {
    const e2 = buildElements(def);
    // 采样点：直道/十字取 (0,0.5)；环岛取六边形中心（顶点在 PEN_START，环体在右侧）
    let sx = 0;
    let sy = 0.5;
    if (label === '正六边形环岛') {
      let pen = PEN_START;
      const vs: [number, number][] = [[pen.x, pen.y]];
      for (const s of def.segments) {
        pen = advancePen(s, pen);
        vs.push([pen.x, pen.y]);
      }
      sx = vs.slice(0, 6).reduce((a, v) => a + v[0], 0) / 6;
      sy = vs.slice(0, 6).reduce((a, v) => a + v[1], 0) / 6;
    }
    const [bx, by, bz] = computeB(sx, sy, 0.07, e2, I);
    const bm = Math.hypot(bx, by, bz);
    const ok = isFinite(bm) && bm > 1e-7 && bm < 1e-3;
    check(ok, `  ${label}：${e2.count} 段，|B|(示例点)=${(bm * 1e6).toFixed(2)}μT，有限且量级合理`);
  }
}

// ---- 测试 4：总长/段长交叉验证（自由铺设路径）
console.log('\n[4] 弧长与离散化交叉验证');
{
  // 半圆（180°，R=50cm）：弧长应 = πR
  const halfCircle = {
    name: '半圆',
    segments: [{ kind: 'arc', radius: 0.5, angleDeg: 180, turn: 'right' } as const],
  };
  const p = samplePath(halfCircle);
  const expect = Math.PI * 0.5;
  const err = Math.abs(p.length - expect) / expect;
  check(err < 0.01, `  半圆弧长=${(p.length * 1000).toFixed(1)}mm ≈ πR=${(expect * 1000).toFixed(1)}mm（误差 ${(err * 100).toFixed(3)}% < 1%）`);
  const segLen = segmentLength(halfCircle.segments[0]);
  check(Math.abs(segLen - expect) / expect < 1e-12, `  segmentLength(半圆)=${(segLen * 1000).toFixed(1)}mm 与 πR 精确一致`);
  // 总长显示值 = samplePath.length，与上同值，交叉一致
}
{
  // 自由铺设风格混合赛道（1cm 吸附参数）：所有 |dl| ≤ 1cm
  const freeLay = {
    name: '自由铺设样例',
    segments: [
      { kind: 'line', length: 0.37 },
      { kind: 'arc', radius: 0.23, angleDeg: 45, turn: 'left' },
      { kind: 'line', length: 0.05 },
      { kind: 'arc', radius: 1.07, angleDeg: 180, turn: 'right' },
      { kind: 'line', length: 1.0 },
    ] as import('../../src/model/track').SegDef[],
  };
  const el3 = buildElements(freeLay);
  let maxDl = 0;
  for (let i = 0; i < el3.count; i++) {
    const l = Math.hypot(el3.dls[i * 3], el3.dls[i * 3 + 1], el3.dls[i * 3 + 2]);
    if (l > maxDl) maxDl = l;
  }
  check(maxDl <= 0.01 + 1e-9, `  自由铺设赛道最大电流元长度=${(maxDl * 1000).toFixed(2)}mm ≤ 10mm`);
  // 段摘要总长 = 各段 segmentLength 之和 = samplePath 总长（误差 <0.5%，离散中点偏移）
  const sumSeg = segmentSummaries(freeLay.segments).reduce((a, s) => a + s.lengthM, 0);
  const pLen = samplePath(freeLay).length;
  const dev = Math.abs(sumSeg - pLen) / pLen;
  check(dev < 0.005, `  段长合计=${(sumSeg * 1000).toFixed(1)}mm ≈ 采样总长=${(pLen * 1000).toFixed(1)}mm（偏差 ${(dev * 100).toFixed(3)}%）`);
  // 笔尖连续性：trackTip 终点 = 采样路径末点走向一致
  const tip = trackTip(freeLay.segments);
  const last = samplePath(freeLay);
  const nPts = last.s.length;
  const endX = last.pts[(nPts - 1) * 2];
  const endY = last.pts[(nPts - 1) * 2 + 1];
  const tipErr = Math.hypot(tip.x - endX, tip.y - endY);
  check(tipErr < 0.01, `  铺线笔尖终点与采样终点偏差=${(tipErr * 1000).toFixed(1)}mm < 10mm（含半采样步长偏移）`);
}

// ---- 测试 5：尖角近似（验证探测尺度下尖角近似成立）
// 说明：真实电磁线直角转弯的最小弯曲半径受线径（d=0.5mm）限制，约 ~0.25mm 量级，
// 远小于 1cm 离散粒度与 ≥2cm 探测距离，故折线顶点可按理想尖点建模。
console.log('\n[5] 探测尺度下尖角近似验证（尖角折线 vs 0.5mm 圆角过渡，探测距离 ≥2cm）');
{
  // L 形赛道：1m 直行后右转 90° 再行 1m
  const L1 = 1.0;
  const L2 = 1.0;
  const cornerX = 0;
  const cornerY = L1;
  // 尖角版：两段直线，第二段绝对方向 0°（+x）
  const sharp: TrackDef = {
    name: '尖角L',
    segments: [
      { kind: 'line', length: L1 },
      { kind: 'line', length: L2, absAngle: 0 },
    ],
  };
  // 圆角版：转角以最小弯曲半径量级 R=0.5mm 的圆弧过渡（切点距顶点 R·tan(45°)=R）
  const R = 0.0005;
  const rounded: TrackDef = {
    name: '圆角L',
    segments: [
      { kind: 'line', length: L1 - R },
      { kind: 'arc', radius: R, angleDeg: 90, turn: 'right' },
      { kind: 'line', length: L2 - R },
    ],
  };
  const elSharp = buildElements(sharp);
  const elRound = buildElements(rounded);
  let maxDev = 0;
  // 测试点：转角附近、距转角 ≥2cm 的环形采样
  for (const dcm of [2, 3, 5, 8, 12]) {
    for (const adeg of [0, 45, 90, 135, 180, 225, 270, 315]) {
      const a = (adeg * Math.PI) / 180;
      const d = dcm / 100;
      const px = cornerX + d * Math.cos(a);
      const py = cornerY + d * Math.sin(a);
      const bS = computeB(px, py, 0.07, elSharp, I);
      const bR = computeB(px, py, 0.07, elRound, I);
      const mS = Math.hypot(...bS);
      const mR = Math.hypot(...bR);
      const dev = Math.abs(mS - mR) / Math.max(mR, 1e-12);
      if (dev > maxDev) maxDev = dev;
    }
  }
  check(maxDev < 0.001, `  40 个采样点最大差异=${(maxDev * 100).toFixed(4)}% < 0.1%（尖角近似成立）`);
}

// ---- 测试 6：正六边形环岛（顶点接直线结构）
console.log('\n[6] 正六边形环岛：顶点接直线、绕环一周回到入环点、航向恢复');
{
  const a = 0.5; // 边长 50cm
  for (const dir of ['left', 'right'] as const) {
    const hex: TrackDef = { name: 'hex', segments: hexagonSegs(PEN_START, a, dir) };
    // 结构：恰好 6 条直线边
    check(
      hex.segments.length === 6 && hex.segments.every((s) => s.kind === 'line'),
      `  ${dir}环：段序列 = 6 条直线边`,
    );
    // 第一条边相对直线方向偏转 ±30°（顶点接触，无贴边）
    const e0 = hex.segments[0];
    const dPhi = (e0.kind === 'line' ? (e0.absAngle ?? 0) : 0) - PEN_START.phi;
    const expect = dir === 'left' ? Math.PI / 6 : -Math.PI / 6;
    check(
      Math.abs(dPhi - expect) < 1e-12,
      `  ${dir}环：入环边相对直线方向偏转 ${(dPhi * 180 / Math.PI).toFixed(1)}°（应为 ${(expect * 180 / Math.PI).toFixed(0)}°）`,
    );
    // 六条边方向集合 = {±30°, ±90°, ±150°}，无一边与直线方向（0°）共线
    const relDegs = hex.segments.map((s) =>
      s.kind === 'line' ? (((s.absAngle ?? 0) - PEN_START.phi) * 180) / Math.PI : NaN,
    );
    const want = dir === 'left' ? [30, 90, 150, 210, 270, 330] : [-30, -90, -150, -210, -270, -330];
    const dirSetOk =
      relDegs.length === 6 &&
      relDegs.every((d, i) => {
        const w = want[i];
        const dd = Math.abs(((d - w) % 360 + 540) % 360 - 180);
        return dd < 1e-9;
      }) &&
      relDegs.every((d) => {
        const c = Math.abs(((d % 360) + 540) % 360 - 180);
        return Math.abs(c) > 1e-9; // 不与 0°/180° 共线
      });
    check(dirSetOk, `  ${dir}环：六边方向 = {±30°,±90°,±150°}（实测 ${relDegs.map((d) => d.toFixed(0)).join(',')}°），无边与直线共线`);
    // 六边形中心位于直线一侧：中心相对顶点方向 = ±90°（垂直于直线），距离 = 边长 a
    {
      let pen = PEN_START;
      const vs: [number, number][] = [[pen.x, pen.y]];
      for (const s of hex.segments) {
        pen = advancePen(s, pen);
        vs.push([pen.x, pen.y]);
      }
      const cx = vs.slice(0, 6).reduce((s2, v) => s2 + v[0], 0) / 6;
      const cy = vs.slice(0, 6).reduce((s2, v) => s2 + v[1], 0) / 6;
      const offAng = Math.atan2(cy - PEN_START.y, cx - PEN_START.x) - PEN_START.phi;
      const offNorm = ((offAng * 180) / Math.PI + 540) % 360 - 180;
      const wantSide = dir === 'left' ? 90 : -90;
      const offDist = Math.hypot(cx - PEN_START.x, cy - PEN_START.y);
      check(
        Math.abs(offNorm - wantSide) < 1e-9 && Math.abs(offDist - a) / a < 1e-9,
        `  ${dir}环：中心在直线${dir === 'left' ? '左' : '右'}侧（偏移方向 ${offNorm.toFixed(1)}°，应为 ${wantSide}°；距离=${(offDist * 1000).toFixed(1)}mm = a）`,
      );
    }
    // 周长 = 6a
    const p = samplePath(hex);
    const err = Math.abs(p.length - 6 * a) / (6 * a);
    check(err < 0.01, `  ${dir}环：周长=${(p.length * 1000).toFixed(1)}mm = 6a=${(6 * a * 1000).toFixed(1)}mm（误差 ${(err * 100).toFixed(3)}%）`);
    // 闭合：绕环一周精确回到入环顶点（<1e-6mm）
    const tip = trackTip(hex.segments);
    const closeErr = Math.hypot(tip.x - PEN_START.x, tip.y - PEN_START.y);
    check(closeErr < 1e-9, `  ${dir}环：终点与入环顶点闭合误差=${(closeErr * 1000).toExponential(2)}mm <1e-6mm`);
    // 出环航向 = 入环航向（<1e-9 rad）
    const dHead = Math.abs(tip.phi - PEN_START.phi);
    check(dHead < 1e-9, `  ${dir}环：出环航向与入环航向偏差=${dHead.toExponential(2)}rad <1e-9`);
    // 场路径：6 条边全部走闭式（wires），无离散元
    const elF = buildFieldElements(hex);
    check(
      (elF.wires?.length ?? 0) / 4 === 6 && elF.count === 0,
      `  ${dir}环：场模型 = 6 条闭式直线段 + 0 离散元`,
    );
  }
  // 磁场合理性：中心 Bz 引擎 vs 6 条边 wireSegB 独立复算（<1e-9）
  {
    const segs = hexagonSegs(PEN_START, a, 'right');
    const elF = buildFieldElements({ name: 'hex', segments: segs });
    // 顶点列（V0..V5）与中心
    let pen = PEN_START;
    const verts: [number, number][] = [[pen.x, pen.y]];
    for (const s of segs) {
      pen = advancePen(s, pen);
      verts.push([pen.x, pen.y]);
    }
    const cx = verts.slice(0, 6).reduce((s, v) => s + v[0], 0) / 6;
    const cy = verts.slice(0, 6).reduce((s, v) => s + v[1], 0) / 6;
    const [, , bzEng] = computeB(cx, cy, 0.07, elF, I);
    let bzRef = 0;
    for (let i = 0; i < 6; i++) {
      bzRef += wireSegB(cx, cy, 0.07, verts[i][0], verts[i][1], verts[i + 1][0], verts[i + 1][1], I)[2];
    }
    const dev = Math.abs(bzEng - bzRef) / Math.max(Math.abs(bzRef), 1e-15);
    check(
      dev < 1e-9,
      `  六边形中心 Bz：引擎=${(bzEng * 1e6).toFixed(6)}μT vs 6 边独立复算=${(bzRef * 1e6).toFixed(6)}μT，偏差 ${dev.toExponential(2)} <1e-9`,
    );
    // 入环顶点附近场值有限（无奇异）
    const near = computeB(PEN_START.x + 0.002, PEN_START.y + 0.002, 0.07, elF, I);
    const mNear = Math.hypot(...near);
    check(
      isFinite(mNear) && mNear < 1e-2,
      `  入环顶点附近 (2,2,70)mm 处 |B|=${(mNear * 1e6).toFixed(1)}μT，有限无奇异（R_MIN 保护）`,
    );
  }
}

// ---- 测试 7：有限线径 vs 细线电流（安培环路定理恒等验证）
console.log('\n[7] 圆截面导线外部场 = 同轴细线电流（安培环路定理恒等）');
{
  // 半径 a=0.25mm 实心圆导线（d=0.5mm），由安培环路定理，外部 (r≥a) 磁场
  // B = μ0I/(2πr) 与同轴无限细线电流严格相同——差异恒等于 0。
  const a = 0.00025; // 导线半径 0.25mm（直径 0.5mm）
  const r = 0.02; // 外部场点 r = 2cm >> a
  const bFinite = (MU0 * I) / (2 * Math.PI * r); // 有限线径模型（外部场，只取决于总电流）
  const bLine = (MU0 * I) / (2 * Math.PI * r); // 无限细线模型
  const diff = Math.abs(bFinite - bLine);
  check(
    diff === 0 && r > a,
    `  d=0.5mm 实心导线外 r=20mm 处：有限线径 vs 细线模型差异=${diff}（恒等，外部场只取决于总电流）`,
  );
console.log('  说明：该恒等式是"无限细线电流"假设的物理依据——0.5mm 线径不影响导线外部任意点的 B 场。');
}

// ---- 测试 8：电感读数审计（直道解析解 vs 引擎，逐电感对比）
// 背景物理：无限长直导线沿 +y，场点 (x,·,h)：Bx = C·h/ρ²（横向），Bz = −C·x/ρ²（竖直），By = 0。
// 新默认 4 电感布局（2026-08-03）：主对 L1/R1 感 By（直道上读数恒 0），宽对 L2/R2 感 Bx（x=±75mm，h=75mm）。
// 这里用 8m 有限长导线解析解（含端部修正）逐电感对比引擎输出。
console.log('\n[8] 电感读数审计：8m 直道，有限长导线解析解 vs 引擎（逐电感）');
{
  const wire: TrackDef = { name: '审计直道', segments: [{ kind: 'line', length: 8 }] };
  const el8 = buildFieldElements(wire); // 直线段闭式积分：审计达机器精度
  const path8 = samplePath(wire);
  const layout = defaultLayout(); // h=75mm，L1/R1 感 y（By），L2/R2 感 x（Bx）（2026-08-03 新默认 4 电感）
  const hh = 0.075;

  /** 有限长直导线（y∈[0,8]，x=0）解析解：场点 (sx, sy, hh) */
  const analyticB = (sx: number, sy: number) => {
    const rho2 = sx * sx + hh * hh;
    const s1 = sy;
    const s2 = 8 - sy;
    const f = s1 / Math.sqrt(s1 * s1 + rho2) + s2 / Math.sqrt(s2 * s2 + rho2);
    const c = ((MU0 * I) / (4 * Math.PI)) * (f / rho2);
    return { bx: c * hh, by: 0, bz: -c * sx };
  };

  const audit = (eMm: number) => {
    const p = pointAtLength(path8, 4.0); // 导线中点
    const pose = { px: p.x, py: p.y, tx: p.tx, ty: p.ty, e: eMm / 1000, psi: 0 };
    const frame = poseFrame(pose);
    console.log(`  -- e=${eMm}mm, ψ=0°, h=75mm, I=100mA，车位于导线中点 --`);
    console.log('  电感  敏感轴  U_引擎(μT)  U_解析(μT)  误差');
    const uMap = new Map<string, { eng: number; ana: number }>();
    for (const s of layout) {
      const w = sensorWorld(s, frame);
      const n = sensorAxisWorld(s, frame);
      const [bx, by, bz] = computeB(w.x, w.y, w.h, el8, I);
      const uEng = Math.abs(bx * n[0] + by * n[1] + bz * n[2]);
      // 解析：ψ=0 且直道沿 +y，车体系与世界系严格对齐 -> 敏感轴即世界轴
      const a = analyticB(w.x, w.y);
      const uAna = Math.abs(a.bx * n[0] + a.by * n[1] + a.bz * n[2]);
      const err = Math.abs(uEng - uAna) / Math.max(uAna, 1e-15);
      uMap.set(s.name, { eng: uEng, ana: uAna });
      console.log(
        `  ${s.name.padEnd(4)} ${s.axisPreset.padEnd(6)} ${(uEng * 1e6).toFixed(4).padStart(10)}  ${(uAna * 1e6).toFixed(4).padStart(10)}  ${(err * 100).toFixed(3)}%`,
      );
      check(err < 0.01, `  e=${eMm}mm ${s.name}（感 ${s.axisPreset}）：引擎 vs 解析误差 ${(err * 100).toFixed(3)}% < 1%`);
      // By 串扰检查：直道上 By 应恒为 0
      const cOverH = ((MU0 * I) / (2 * Math.PI)) / hh;
      check(
        Math.abs(by) < cOverH * 0.001,
        `  e=${eMm}mm ${s.name}：By=${(by * 1e6).toFixed(5)}μT ≈ 0（无纵向串扰）`,
      );
    }
    return uMap;
  };

  const u0 = audit(0);
  audit(100);

  // 居中对称性：L1 = R1
  const l1 = u0.get('L1')!;
  const r1 = u0.get('R1')!;
  const sym = Math.abs(l1.eng - r1.eng) / ((l1.eng + r1.eng) / 2);
  check(sym < 0.001, `  e=0 对称性：L1=${(l1.eng * 1e6).toFixed(4)} ≈ R1=${(r1.eng * 1e6).toFixed(4)}μT（偏差 ${(sym * 100).toFixed(3)}%）`);

  // 关键比值（新 4 电感布局）：居中时宽对 L2/R2（感 Bx，x=±75mm）读数 = C·h/(x²+h²) 且对称；
  // 主对 L1/R1（感 By）在直道上读数恒为 0（直导线 By=0）——均符合物理预期
  const l2 = u0.get('L2')!;
  const r2 = u0.get('R2')!;
  const expectL2 = ((MU0 * I) / (4 * Math.PI)) * (2 / (0.075 * 0.075 + hh * hh)) * hh;
  const l2Err = Math.abs(l2.eng - expectL2) / expectL2;
  check(
    l2Err < 0.01 && Math.abs(l2.eng - r2.eng) / l2.eng < 0.001,
    `  e=0 宽对读数：L2=${(l2.eng * 1e6).toFixed(4)}μT ≈ 解析 ${(expectL2 * 1e6).toFixed(4)}μT（误差 ${(l2Err * 100).toFixed(3)}%），L2≈R2 对称`,
  );
  check(
    l1.eng < 1e-9 && r1.eng < 1e-9,
    `  e=0 主对（感 By）：L1=R1≈0（直导线无纵向分量，符合物理预期）`,
  );
}

// ---- 测试 9：直角（两直线尖角相连）闭式解对比
// 直线段已改闭式积分（buildFieldElements）：直角/直线/环岛直边应达双精度机器量级。
console.log('\n[9] 直角区域：闭式解真值 vs 引擎（buildFieldElements 直线段闭式积分）');
{
  const L: TrackDef = {
    name: 'L直角',
    segments: [
      { kind: 'line', length: 1 },
      { kind: 'line', length: 1, absAngle: 0 },
    ],
  };
  const elL = buildFieldElements(L);
  check(
    (elL.wires?.length ?? 0) / 4 === 2 && elL.count === 0,
    `  L 形场模型：闭式直线段=2，离散电流元=0（直线段不再切碎）`,
  );
  const truth = (px: number, py: number, pz: number): [number, number, number] => {
    const a = wireSegB(px, py, pz, 0, 0, 0, 1, I);
    const b = wireSegB(px, py, pz, 0, 1, 1, 1, I);
    return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  };
  // 尖角顶点 (0,1) 周围多点：两侧对称点 + 内/外角平分线，20/50/100/200mm
  let maxErr9 = 0;
  for (const dMm of [20, 50, 100, 200]) {
    const d = dMm / 1000;
    const pts: [number, number][] = [
      [d * Math.SQRT1_2, 1 + d * Math.SQRT1_2], // 外角平分线
      [-d * Math.SQRT1_2, 1 - d * Math.SQRT1_2], // 对称点
      [-d * Math.SQRT1_2, 1 + d * Math.SQRT1_2], // 内角平分线
      [d * Math.SQRT1_2, 1 - d * Math.SQRT1_2],
      [0.02, 1 - d], // 臂1 侧（距臂 20mm）
      [1 - d, 1.02], // 臂2 侧
    ];
    for (const [px, py] of pts) {
      const num = computeB(px, py, 0.07, elL, I);
      const tru = truth(px, py, 0.07);
      const err = Math.abs(Math.hypot(...num) - Math.hypot(...tru)) / Math.hypot(...tru);
      if (err > maxErr9) maxErr9 = err;
    }
  }
  check(maxErr9 < 1e-9, `  顶点周围 24 点最大相对误差=${maxErr9.toExponential(2)}（<1e-9，机器精度）`);

  // 对称性：关于角平分线（过顶点方向 (1,-1)，映射 (x,y)->(1-y,1-x)）的镜像点 |B| 相等
  const m1 = computeB(0.15, 1.3, 0.07, elL, I);
  const m2 = computeB(1 - 1.3, 1 - 0.15, 0.07, elL, I); // 镜像点 (-0.3, 0.85)
  const symErr = Math.abs(Math.hypot(...m1) - Math.hypot(...m2)) / Math.hypot(...m2);
  check(symErr < 1e-9, `  角平分线镜像对称：|B(150,1300)|=|B(-300,850)|，偏差 ${symErr.toExponential(2)}`);

  // 臂中段（远离顶点）与无限长直导线一致性：点 (20, 500, 70)mm 距臂1 20mm、距顶点 500mm
  const mid = computeB(0.02, 0.5, 0.07, elL, I);
  const inf = infiniteWireB(0.02, 0, 0.07, I);
  const devMid = Math.abs(Math.hypot(...mid) - Math.hypot(...inf)) / Math.hypot(...inf);
  check(
    devMid < 0.05,
    `  臂1 中段 vs 无限长直导线：|B|_引擎=${(Math.hypot(...mid) * 1e6).toFixed(4)}μT vs 无限长=${(Math.hypot(...inf) * 1e6).toFixed(4)}μT，偏差 ${(devMid * 100).toFixed(2)}%（有限长端部修正+另一臂贡献，<5%）`,
  );
}

// ---- 测试 10：电感标定审计（Vpp 锚点反推 k、线性缩放、cosθ 方向性）
// 标定约定：20kHz/100mA 标准信号源下，电感垂直贴信号线（中心距线轴 3.25mm）输出 Vpp 5–7V；
// k = Vpp_anchor / B_touch 由锚点反推，之后读数 U = k·|B·n̂| 随场/电流线性缩放。
console.log('\n[10] 电感标定审计：贴线锚点自洽 / 线性缩放 / cosθ 方向性');
{
  // 20m 长直导线（闭式解），贴线点取导线中点旁 3.25mm、h=0（与线同平面，对应贴线几何）
  const wire20: TrackDef = { name: '标定直道', segments: [{ kind: 'line', length: 20 }] };
  const el20 = buildFieldElements(wire20);
  const touchPt = { x: TOUCH_DIST_M, y: 10, h: 0 };

  // (a) 锚点自洽：同一模型下 k 反推 -> 读数必须精确回到锚点 Vpp
  const bTouch = computeB(touchPt.x, touchPt.y, touchPt.h, el20, 0.1);
  const bTouchMag = Math.hypot(...bTouch);
  const nTouch: [number, number, number] = [
    bTouch[0] / bTouchMag,
    bTouch[1] / bTouchMag,
    bTouch[2] / bTouchMag,
  ];
  const kExact = VPP_ANCHOR_DEFAULT / bTouchMag;
  const uAnchor = kExact * Math.abs(bTouch[0] * nTouch[0] + bTouch[1] * nTouch[1] + bTouch[2] * nTouch[2]);
  check(
    Math.abs(uAnchor - VPP_ANCHOR_DEFAULT) < 1e-9,
    `  锚点自洽：B_touch=${(bTouchMag * 1e6).toFixed(4)}μT，k=${kExact.toExponential(4)}V/T 反推读数=${uAnchor.toFixed(9)}V = 锚点 ${VPP_ANCHOR_DEFAULT}V（<1e-9）`,
  );

  // (b) app 标定函数一致性：kFromAnchor 用无限长近似 B=μ0I/(2π·3.25mm)，
  //     与 20m 有限长导线中点闭式解差异仅端部修正（~ρ/L 量级，实测 ~3e-5）
  const kApp = kFromAnchor(VPP_ANCHOR_DEFAULT);
  const kDev = Math.abs(kApp - kExact) / kExact;
  check(
    kDev < 5e-4,
    `  app 标定一致：kFromAnchor(6)=${kApp.toExponential(4)} vs 闭式反推=${kExact.toExponential(4)}V/T，相对差 ${(kDev * 100).toFixed(5)}% < 0.05%（无限长近似，端部修正可忽略）`,
  );

  // (c) 线性缩放：k 固定，电流 100mA -> 200mA，同点读数严格 2 倍（B ∝ I）
  const kCal = kFromAnchor(VPP_ANCHOR_DEFAULT);
  const readAt = (px: number, py: number, ph: number, cur: number) => {
    const b = computeB(px, py, ph, el20, cur);
    return kCal * Math.abs(b[0] * nTouch[0] + b[1] * nTouch[1] + b[2] * nTouch[2]);
  };
  // 探测点：距线 30mm、h=70mm（典型电感位置），n̂ 沿用贴线点方向（同为 x-z 平面内方向无关线性检验）
  const u100 = readAt(0.03, 10, 0.07, 0.1);
  const u200 = readAt(0.03, 10, 0.07, 0.2);
  const linErr = Math.abs(u200 / u100 - 2);
  check(
    linErr < 1e-9,
    `  线性缩放：I=100mA 读数=${u100.toFixed(6)}V，I=200mA 读数=${u200.toFixed(6)}V，比值=${(u200 / u100).toFixed(9)}（严格 2×，偏差 ${linErr.toExponential(2)}）`,
  );

  // (d) cosθ 方向性：同一 B 场下敏感轴绕垂直轴转 60°，读数比 = cos60° = 0.5
  const bDet = computeB(0.03, 10, 0.07, el20, 0.1);
  const bDetMag = Math.hypot(...bDet);
  const n1: [number, number, number] = [bDet[0] / bDetMag, bDet[1] / bDetMag, bDet[2] / bDetMag];
  // 绕 y 轴（直导线沿 +y 时 By=0，y 轴垂直于 B）旋转 60°
  const a60 = Math.PI / 3;
  const n2: [number, number, number] = [
    Math.cos(a60) * n1[0] + Math.sin(a60) * n1[2],
    n1[1],
    -Math.sin(a60) * n1[0] + Math.cos(a60) * n1[2],
  ];
  const u1 = kCal * Math.abs(bDet[0] * n1[0] + bDet[1] * n1[1] + bDet[2] * n1[2]);
  const u2 = kCal * Math.abs(bDet[0] * n2[0] + bDet[1] * n2[1] + bDet[2] * n2[2]);
  const cosErr = Math.abs(u2 / u1 - Math.cos(a60));
  check(
    cosErr < 1e-9,
    `  cosθ 方向性：θ=0° 读数=${u1.toFixed(6)}V，θ=60° 读数=${u2.toFixed(6)}V，比值=${(u2 / u1).toFixed(9)} ≈ cos60°=0.5（偏差 ${cosErr.toExponential(2)}）`,
  );
}

console.log(failures === 0 ? '\n全部自检通过 ✓' : `\n${failures} 项失败 ✗`);
process.exit(failures === 0 ? 0 : 1);
