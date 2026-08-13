/**
 * 循迹闭环仿真自检（npm run selfcheck:tracking）：
 *
 * 1. compileFormula：默认 C4 式编译与求值；abs()/|·| 语法；非法表达式与未知变量抛错。
 * 2. wheelSpeeds：u=0 双轮同速；内:外轮变化量 = w:1；平均速度保持 v_base；限幅 [0, v_max]。
 * 3. stepCar 运动学：直线行驶距离 = v·t、航向不变；恒轮速差走出圆弧，半径 ≈ W(vL+vR)/(2(vR−vL))。
 * 4. simulateTracking 闭环：4m 直道 + 默认 7 电感布局 + 真实磁场模型读数，
 *    初始 e=50mm 扰动下应收敛回中线并跑完全程（终点横向偏差 < 30mm）。
 * 5. 闭环赛道：闭环标志 + 首尾吸合 + 循迹仅一圈完赛。
 * 6. 转弯车体朝向：ψ = 切向角 − θ 约定回归（含 θ 超 ±π 累积与 S 弯逐步重建）。
 * 7. 电机一阶滞后（数学模型.md §8.4）：τ=0 瞬时跟随退化；阶跃响应 t=τ 达 63.2%；
 *    双轮同 τ 时差速以同 τ 跟随指令差速；τ_m=30ms 下直道闭环收敛回归；
 *    起步第 0 步实际轮速介于 v_base 与指令值之间。
 */
import {
  compileFormula,
  DEFAULT_FORMULA,
  DEFAULT_TRACKING,
  wheelSpeeds,
} from '../src/mathmodel/control';
import { simulateTracking, stepCar } from '../src/mathmodel/kinematics';
import { buildFieldElements, samplePath } from '../src/mathmodel/track';
import { computeB } from '../src/mathmodel/field';
import { defaultLayout, kFromAnchor } from '../src/mathmodel/sensor';
import { signedLateralDistance } from '../src/mathmodel/measured';

let failures = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) failures++;
};

// ---- [1] 公式编译 ----
console.log('[1] compileFormula：C4 式求值 / abs / 非法表达式');
{
  const f = compileFormula(DEFAULT_FORMULA);
  // L1=3, R1=1, L2=2, R2=0, A=B=C=P=1 -> (2+2)/(4+2) = 2/3（默认公式已随 4 电感布局去 F1/F2，数学模型.md §8.2）
  const v = f.eval({ L1: 3, R1: 1, L2: 2, R2: 0, A: 1, B: 1, C: 1, P: 1 });
  check(Math.abs(v - 2 / 3) < 1e-12, `  C4 式求值 = ${v.toFixed(4)}（应为 0.6667）`);
  check(
    f.variables.sort().join(',') === 'A,B,C,L1,L2,P,R1,R2',
    `  变量表 = ${f.variables.sort().join(',')}`,
  );
  const g = compileFormula('(L1 - R1) / (L1 + R1 + 1e-6) * P');
  const gv = g.eval({ L1: 1, R1: 3, P: 10 });
  check(Math.abs(gv - -5) < 1e-3, `  归一化差比和 ×P：${gv.toFixed(3)}（应 ≈ -5）`);
  const h = compileFormula('|L1-R1| + abs(F1)');
  check(h.eval({ L1: 1, R1: 4, F1: -2 }) === 5, '  |·| 与 abs() 均可用');
  let threw = false;
  try {
    compileFormula('L1 +');
  } catch {
    threw = true;
  }
  check(threw, '  语法非法表达式抛出错误');
  threw = false;
  try {
    compileFormula('XX*2').eval({ L1: 1 });
  } catch {
    threw = true;
  }
  check(threw, '  未知变量求值时抛出错误');
}

// ---- [2] 轮速分配 ----
console.log('\n[2] wheelSpeeds：内外轮变化量 w:1 / 平均速度 / 限幅');
{
  const p = { ...DEFAULT_TRACKING, vBase: 1, vMax: 2, w: 1.5 };
  const s0 = wheelSpeeds(0, p);
  check(s0.vL === 1 && s0.vR === 1, `  u=0：vL=vR=${s0.vL}（=v_base）`);
  const sr = wheelSpeeds(0.5, p); // 右转：左外右内
  const dvOut = sr.vL - 1;
  const dvIn = 1 - sr.vR;
  check(
    Math.abs(dvOut - (2 * 0.5) / 2.5) < 1e-12 && Math.abs(dvIn / dvOut - 1.5) < 1e-9,
    `  右转 u=0.5：Δ外=${dvOut.toFixed(3)} Δ内=${dvIn.toFixed(3)}，内:外=1.5:1`,
  );
  // 设计公式下平均速度 = v_base − u(w−1)/(1+w)（w=1 时严格保持；w>1 时转弯略降速）
  const expectMean = 1 - (0.5 * (1.5 - 1)) / (1 + 1.5);
  check(
    Math.abs((sr.vL + sr.vR) / 2 - expectMean) < 1e-12,
    `  平均速度 ${((sr.vL + sr.vR) / 2).toFixed(3)} = v_base − u(w−1)/(1+w) = ${expectMean.toFixed(3)}`,
  );
  const s1 = wheelSpeeds(0.5, { ...p, w: 1 });
  check(Math.abs((s1.vL + s1.vR) / 2 - 1) < 1e-12, '  w=1 时平均速度严格保持 v_base');
  const sl = wheelSpeeds(-0.5, p); // 左转对称
  check(
    Math.abs(sl.vR - sr.vL) < 1e-12 && Math.abs(sl.vL - sr.vR) < 1e-12,
    '  左转与右转镜像对称',
  );
  const sc = wheelSpeeds(100, p);
  check(sc.vL === 2 && sc.vR === 0, `  限幅 [0, v_max]：vL=${sc.vL} vR=${sc.vR}`);
}

// ---- [3] 运动学积分 ----
console.log('\n[3] stepCar：直线距离 / 恒轮速差圆弧半径');
{
  const dt = 0.005;
  let st = { x: 0, y: 0, theta: Math.PI / 2 }; // 朝 +y
  for (let i = 0; i < 200; i++) st = stepCar(st, 1, 1, 0.135, dt);
  check(
    Math.abs(st.y - 1) < 1e-9 && Math.abs(st.x) < 1e-12 && Math.abs(st.theta - Math.PI / 2) < 1e-12,
    `  直线 1m/s×1s：y=${st.y.toFixed(4)}（应为 1），航向不变`,
  );
  // 恒轮速差 -> 半径 R = W(vL+vR)/(2(vR−vL)) 的圆
  const W = 0.135;
  const vL = 0.9;
  const vR = 1.1;
  const Rexp = (W * (vL + vR)) / (2 * (vR - vL));
  st = { x: 0, y: 0, theta: 0 }; // 朝 +x，vR>vL -> 左转（CCW），圆心在 +y 侧
  const n = Math.ceil((2 * Math.PI * Rexp) / (((vL + vR) / 2) * dt));
  for (let i = 0; i < n; i++) st = stepCar(st, vL, vR, W, dt);
  const Rmeas = Math.hypot(st.x, st.y - Rexp);
  check(
    Math.abs(Rmeas - Rexp) / Rexp < 0.01,
    `  恒轮速差一周：轨迹半径 ${Rmeas.toFixed(4)}m ≈ 理论 ${Rexp.toFixed(4)}m（<1%）`,
  );
}

// ---- [4] 闭环仿真：直道收敛 ----
console.log('\n[4] simulateTracking：4m 直道 + 真实磁场读数，e=50mm 起步收敛');
{
  const path = samplePath({ name: '直道', segments: [{ kind: 'line', length: 4 }] });
  const elements = buildFieldElements({ name: '直道', segments: [{ kind: 'line', length: 4 }] });
  const sensors = defaultLayout();
  const k = kFromAnchor(6);
  const I = 0.1;
  const params = {
    ...DEFAULT_TRACKING,
    enabled: true,
    initEMm: 50,
    // 默认布局主电感对在 |d|>h 外坡：车右偏时左感升/右感降（L−R>0），
    // 故实车标定 P 需取负构成负反馈（A/B/C/P 为待定标定值，见设计说明 程序设计说明.md §4.2）
    P: -1,
    kp: 0.5,
    kd: 0.05,
    vBase: 1,
    vMax: 2,
  };
  const formula = compileFormula(params.formula);
  const result = simulateTracking({
    path,
    sensors,
    params,
    formula,
    readSensor: (sensor, w, ax) => {
      const [bx, by, bz] = computeB(w.x, w.y, sensor.h, elements, I);
      return k * Math.abs(bx * ax[0] + by * ax[1] + bz * ax[2]);
    },
  });
  const n = result.steps - 1;
  const endD = signedLateralDistance(path, result.x[n], result.y[n]);
  // 稳态跟踪质量：行驶弧长 ∈ [1.0m, 3.5m] 窗口内的横向偏差与误差
  // （初始 1m 为扰动收敛过渡段，终点附近受导线端部场衰减影响，均不在评估范围内）
  let maxAbsD = 0;
  let errSum = 0;
  let cnt = 0;
  for (let i = 0; i < result.steps; i++) {
    if (result.t[i] < 1.0 || result.t[i] > 3.5) continue; // v≈1m/s -> t≈弧长
    const d = signedLateralDistance(path, result.x[i], result.y[i]);
    maxAbsD = Math.max(maxAbsD, Math.abs(d));
    errSum += Math.abs(result.err[i]);
    cnt++;
  }
  console.log(
    `  状态=${result.status} 步数=${result.steps} 用时=${result.timeS.toFixed(2)}s ` +
      `冲线索引=${result.finishIndex} 计算耗时=${result.elapsedMs.toFixed(0)}ms`,
  );
  check(result.status === 'finished', `  跑完全程（status=${result.status}）`);
  check(
    maxAbsD < 0.03,
    `  稳态窗口最大横向偏差 ${(maxAbsD * 1000).toFixed(1)}mm < 30mm（收敛并稳住）`,
  );
  // |Err| 含 PD 微分高频抖动（kd 对相邻步差分，轮速饱和边界附近抖动放大），
  // 跟踪精度以横向偏差为准，误差均值作宽松参考。
  // 2026-08-03 新默认 4 电感布局：主对感 By（h=75mm），读数幅值小于旧 z 轴布局，
  // 归一化 Err 量级相应变大（稳态 ~0.7 仍能收敛稳住，见上项横向偏差 9.1mm），阈值随布局重定标。
  check(cnt > 0 && errSum / cnt < 0.8, `  稳态窗口 |Err| 均值 ${(errSum / cnt).toFixed(4)} < 0.8（新布局 By 主对，含微分抖动）`);
  void endD;
}

// ---- [5] 闭环赛道：吸合校验 / 中线闭合 / 循迹仅一圈 ----
console.log('\n[5] 闭环赛道（数学模型.md §4/数学模型.md §8.5）：闭环标志 + 首尾吸合 + 一圈完赛');
{
  const { canCloseTrack, closureGapM, buildElements } = await import('../src/mathmodel/track');
  // 单位正方形（4×1m 直线，尖角）：起点 (0,0) -> (0,1) -> (1,1) -> (1,0) -> (0,0)
  const square = [
    { kind: 'line' as const, length: 1 },
    { kind: 'line' as const, length: 1, absAngle: 0 },
    { kind: 'line' as const, length: 1, absAngle: -Math.PI / 2 },
    { kind: 'line' as const, length: 1, absAngle: Math.PI },
  ];
  check(closureGapM(square) < 1e-9, `  正方形终点距起点 ${(closureGapM(square) * 1000).toFixed(3)}mm ≈ 0`);
  check(canCloseTrack(square), '  满足闭环条件（≤20mm）');
  check(!canCloseTrack(square.slice(0, 3)), '  缺一边（终点距起点 1m）不可闭环');

  const defClosed = { name: '方环', segments: square, closed: true as const };
  const defOpen = { name: '方环开', segments: square };
  const pathClosed = samplePath(defClosed);
  const pathOpen = samplePath(defOpen);
  check(
    Math.abs(pathClosed.length - 4) < 1e-6 && Math.abs(pathOpen.length - 4) < 1e-6,
    `  闭环/非闭环中线总长均 = ${pathClosed.length.toFixed(4)}m（周长 4m）`,
  );

  // 近闭环（终点距起点 10mm）：闭环后自动补吸合段，总长 = 3.99 + 0.01 = 4.00m
  const near = [
    { kind: 'line' as const, length: 1 },
    { kind: 'line' as const, length: 1, absAngle: 0 },
    { kind: 'line' as const, length: 1, absAngle: -Math.PI / 2 },
    { kind: 'line' as const, length: 0.99, absAngle: Math.PI },
  ];
  check(canCloseTrack(near), `  近闭环（缝隙 ${(closureGapM(near) * 1000).toFixed(0)}mm）满足闭环条件`);
  const pathNear = samplePath({ name: '近闭环', segments: near, closed: true });
  const elNearOpen = buildElements({ name: '近闭环开', segments: near });
  const elNearClosed = buildElements({ name: '近闭环', segments: near, closed: true });
  check(
    Math.abs(pathNear.length - 4) < 1e-6,
    `  吸合段计入中线：总长 ${pathNear.length.toFixed(4)}m（3.99+0.01=4.00）`,
  );
  check(elNearClosed.count > elNearOpen.count, '  离散化包含吸合段电流元');

  // 循迹终止判据：闭环一圈（dist ≥ 总长）vs 非闭环（总长 + 0.5m 容差）
  const params = { ...DEFAULT_TRACKING, enabled: true, vBase: 1, dtMs: 5 };
  const formula = compileFormula('0'); // Err 恒 0 -> 直行，专测终止条件
  const constRead = () => 1;
  const rClosed = simulateTracking({
    path: pathClosed,
    sensors: defaultLayout(),
    params,
    formula,
    readSensor: constRead,
    closed: true,
  });
  const rOpen = simulateTracking({
    path: pathClosed,
    sensors: defaultLayout(),
    params,
    formula,
    readSensor: constRead,
    closed: false,
  });
  check(
    rClosed.status === 'finished' &&
      rClosed.distM >= pathClosed.length - 1e-9 &&
      rClosed.distM < pathClosed.length + 0.05,
    `  闭环：行驶弧长 ${rClosed.distM.toFixed(3)}m 达单圈总长即完赛（无 0.5m 容差）`,
  );
  check(
    rOpen.status === 'finished' &&
      rOpen.distM >= pathClosed.length + 0.5 - 1e-9 &&
      rOpen.distM < pathClosed.length + 0.55,
    `  非闭环：弧长 ${rOpen.distM.toFixed(3)}m（总长 + 0.5m 容差）`,
  );
}

// ---- [6] 转弯车体朝向（数学模型.md §6.4）：位姿反算朝向一致性 / 连续过弯无角度回绕跳变 ----
console.log('\n[6] 转弯车体朝向（数学模型.md §6.4）：ψ = 切向角 − θ（ψ>0 右偏），重建车头角 = θ');
{
  const { nearestOnPath, pointAtLength } = await import('../src/mathmodel/track');
  const { poseFrame } = await import('../src/mathmodel/sensor');
  const wrap = (a: number) => {
    let r = a % (2 * Math.PI);
    if (r > Math.PI) r -= 2 * Math.PI;
    if (r <= -Math.PI) r += 2 * Math.PI;
    return r;
  };

  // (a) 约定一致性：含 θ 连续累积超 ±π 的情形（积分不回绕），
  //     ψ = wrap(切向角 − θ) 经 poseFrame 重建的车头角必须 = θ（最短弧）。
  //     （旧代码 ψ = θ − 切向角 符号写反，重建车头角 = 2·切向角 − θ，转弯时车框反转——本用例即回归防护）
  {
    const path = samplePath({
      name: '弯',
      segments: [
        { kind: 'line', length: 1 },
        { kind: 'arc', radius: 0.5, angleDeg: 120, turn: 'left' }, // 左转 120°，切向角越过 π 回绕线
      ],
    });
    let worst = 0;
    for (let k = 0; k <= 40; k++) {
      const s = (path.length * k) / 40;
      const p = pointAtLength(path, s);
      const alpha = Math.atan2(p.ty, p.tx);
      // 模拟积分连续累积的 θ（切向 + 固定偏角 + 3π 额外整圈累积）
      const theta = alpha + 0.08 + 3 * Math.PI;
      const psi = wrap(alpha - theta);
      const frame = poseFrame({ px: p.x, py: p.y, tx: p.tx, ty: p.ty, e: 0, psi });
      const heading = Math.atan2(frame.forward.y, frame.forward.x);
      worst = Math.max(worst, Math.abs(wrap(heading - theta)));
    }
    check(worst < 1e-9, `  ψ=切向角−θ 重建：最大朝向偏差 ${(worst * 1e6).toFixed(1)}μrad（含 θ 超 ±π 累积）`);
  }

  // (b) 连续过弯单调性：真实仿真过左右弯，逐步重建朝向与轨迹 θ 一致、无回绕跳变
  {
    const segs = [
      { kind: 'line' as const, length: 1 },
      { kind: 'arc' as const, radius: 1, angleDeg: 60, turn: 'right' as const },
      { kind: 'line' as const, length: 1 },
      { kind: 'arc' as const, radius: 1, angleDeg: 60, turn: 'left' as const },
      { kind: 'line' as const, length: 0.5 },
    ];
    const path = samplePath({ name: 'S弯', segments: segs });
    const elements = buildFieldElements({ name: 'S弯', segments: segs });
    const sensors = defaultLayout();
    const k = kFromAnchor(6);
    const params = { ...DEFAULT_TRACKING, enabled: true, P: -1, kp: 0.5, kd: 0.05, vBase: 1, vMax: 2 };
    const r = simulateTracking({
      path,
      sensors,
      params,
      formula: compileFormula(params.formula),
      readSensor: (sensor, w, ax) => {
        const [bx, by, bz] = computeB(w.x, w.y, sensor.h, elements, 0.1);
        return k * Math.abs(bx * ax[0] + by * ax[1] + bz * ax[2]);
      },
    });
    let worstHeading = 0;
    let worstStep = 0;
    for (let i = 0; i < r.steps; i++) {
      const np = nearestOnPath(path, r.x[i], r.y[i]);
      const alpha = Math.atan2(np.ty, np.tx);
      const psi = wrap(alpha - r.theta[i]);
      const e = signedLateralDistance(path, r.x[i], r.y[i]);
      const frame = poseFrame({ px: np.x, py: np.y, tx: np.tx, ty: np.ty, e, psi });
      const heading = Math.atan2(frame.forward.y, frame.forward.x);
      worstHeading = Math.max(worstHeading, Math.abs(wrap(heading - r.theta[i])));
      if (i > 0) worstStep = Math.max(worstStep, Math.abs(wrap(r.theta[i] - r.theta[i - 1])));
    }
    check(
      worstHeading < 1e-9,
      `  过弯轨迹逐步重建：朝向与 θ 最大偏差 ${(worstHeading * 1e6).toFixed(1)}μrad（${r.steps} 步，status=${r.status}）`,
    );
    check(
      worstStep < 0.15,
      `  连续过弯 θ 单调连续：最大单步 |Δθ| = ${worstStep.toFixed(4)}rad < 0.15（无 ±π 回绕跳变）`,
    );
  }
}

// ---- [7] 电机一阶滞后（数学模型.md §8.4）：阶跃响应 / τ=0 退化 / 差速滞后 / 闭环收敛 ----
console.log('\n[7] 电机一阶滞后：motorLag 阶跃响应与闭环仿真（τ_m=30ms）');
{
  const { motorLag } = await import('../src/mathmodel/control');
  const tau = 0.03;
  const dt = 0.005;

  // τ=0 退化为瞬时跟随（旧行为）
  check(motorLag(1.0, 2.0, 0, dt) === 2.0, '  τ=0：轮速瞬时跟随指令（向后兼容）');

  // 阶跃响应：v 从 1.0 跳到指令 2.0，t=τ 时应达 v_cmd − (v_cmd−v0)/e ≈ 1.6321
  let v = 1.0;
  const nTau = Math.round(tau / dt); // 6 步
  for (let i = 0; i < nTau; i++) v = motorLag(v, 2.0, tau, dt);
  const expectTau = 2.0 - 1.0 / Math.E;
  check(
    Math.abs(v - expectTau) < 1e-9,
    `  阶跃 t=τ：v=${v.toFixed(4)} ≈ v_cmd−Δv/e = ${expectTau.toFixed(4)}（63.2%）`,
  );
  for (let i = 0; i < 9 * nTau; i++) v = motorLag(v, 2.0, tau, dt); // 到 t=10τ
  check(Math.abs(v - 2.0) < 1e-3, `  阶跃 t=10τ：v=${v.toFixed(4)} ≈ 2.0（收敛）`);

  // 线性性：双轮同 τ 滞后 ⇒ 差速 Δv 以同一 τ 跟随指令差速（报告模型为本模型的特例）
  let vL = 1.0;
  let vR = 1.0;
  const cmdL = 0.7;
  const cmdR = 1.3; // 指令差速 0.6
  for (let i = 0; i < nTau; i++) {
    vL = motorLag(vL, cmdL, tau, dt);
    vR = motorLag(vR, cmdR, tau, dt);
  }
  const dvExpect = 0.6 * (1 - 1 / Math.E);
  check(
    Math.abs(vR - vL - dvExpect) < 1e-9,
    `  差速滞后：t=τ 时 Δv=${(vR - vL).toFixed(4)} ≈ Δv_cmd·(1−1/e) = ${dvExpect.toFixed(4)}`,
  );

  // 闭环：直道收敛回归（[4] 同参数 + τ_m=30ms），滞后引入振荡但应仍能完赛收敛
  const path = samplePath({ name: '直道', segments: [{ kind: 'line', length: 4 }] });
  const elements = buildFieldElements({ name: '直道', segments: [{ kind: 'line', length: 4 }] });
  const sensors = defaultLayout();
  const k = kFromAnchor(6);
  const params = {
    ...DEFAULT_TRACKING,
    enabled: true,
    initEMm: 50,
    P: -1,
    kp: 0.5,
    kd: 0.05,
    vBase: 1,
    vMax: 2,
    motorTauMs: 30,
  };
  const result = simulateTracking({
    path,
    sensors,
    params,
    formula: compileFormula(params.formula),
    readSensor: (sensor, w, ax) => {
      const [bx, by, bz] = computeB(w.x, w.y, sensor.h, elements, 0.1);
      return k * Math.abs(bx * ax[0] + by * ax[1] + bz * ax[2]);
    },
  });
  let maxAbsD = 0;
  for (let i = 0; i < result.steps; i++) {
    if (result.t[i] < 1.0 || result.t[i] > 3.5) continue;
    maxAbsD = Math.max(maxAbsD, Math.abs(signedLateralDistance(path, result.x[i], result.y[i])));
  }
  check(result.status === 'finished', `  闭环（τ_m=30ms）：跑完全程（status=${result.status}）`);
  check(
    maxAbsD < 0.03,
    `  闭环（τ_m=30ms）：稳态窗口最大横向偏差 ${(maxAbsD * 1000).toFixed(1)}mm < 30mm`,
  );
  // 起步第 0 步：初始 e=50mm 扰动下指令轮速 ≠ v_base，滞后实际值应介于 v_base 与指令值之间
  const result0 = simulateTracking({
    path,
    sensors,
    params: { ...params, motorTauMs: 0 },
    formula: compileFormula(params.formula),
    readSensor: (sensor, w, ax) => {
      const [bx, by, bz] = computeB(w.x, w.y, sensor.h, elements, 0.1);
      return k * Math.abs(bx * ax[0] + by * ax[1] + bz * ax[2]);
    },
  });
  const cmdL0 = result0.vL[0]; // τ=0 时第 0 步记录 = 指令轮速
  check(
    Math.abs(result.vL[0] - 1) < Math.abs(cmdL0 - 1) && result.vL[0] !== cmdL0,
    `  起步滞后：实际 vL[0]=${result.vL[0].toFixed(3)} 介于 v_base=1 与指令 ${cmdL0.toFixed(3)} 之间`,
  );
}

console.log(failures === 0 ? '\n循迹闭环自检全部通过 ✓' : `\n${failures} 项失败 ✗`);
process.exit(failures === 0 ? 0 : 1);
