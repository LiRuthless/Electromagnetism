/**
 * 两轮差速运动学 + 循迹闭环轨迹仿真（数学模型.md §8）。
 *
 * 运动学（固定步长 dt 积分）：
 *   v = (v_R + v_L) / 2；ω = (v_R − v_L) / W（W = 轮距）；
 *   θ += ω·dt；x += v·cosθ·dt；y += v·sinθ·dt（半隐式欧拉，先转后移）。
 *
 * 闭环信号流：
 *   位姿(x,y,θ) → 电感世界坐标 → 各电感读数 U（数据源由调用方注入）
 *   → Err（control.ts 公式）→ PD → 指令轮速 v_L/v_R → 电机一阶滞后（实际轮速状态）
 *   → 积分新位姿 → 循环，
 *   直到跑完全程（行驶弧长 > 赛道总长 + 容差）/ 失控判停 / 步数上限。
 *
 * 电机一阶滞后（数学模型.md §8.4）：实际轮速 v_L/v_R 为仿真状态量，
 * 按 τ_m·dv/dt + v = v_cmd 跟随指令轮速（τ_m=0 时瞬时跟随）；
 * 运动学积分、行驶弧长与轨迹记录的轮速均为实际值。
 *
 * 初始位姿：赛道起点中线处、航向取起点切向，加初始 e/ψ 扰动。
 * 整条轨迹在主线程同步积分（数百~数千步 × 每步电感数个单点场计算，毫秒级）。
 */
import { pointAtLength } from './track';
import type { PathSample } from './track';
import { axisVector } from './sensor';
import type { SensorDef } from './sensor';
import { pdOutput, wheelSpeeds, motorLag } from './control';
import type { CompiledFormula, TrackingParams } from './control';

/** 平面刚体位姿（世界系，θ 从 +x 起算） */
export interface CarState {
  x: number;
  y: number;
  theta: number;
}

/** 单步积分（半隐式欧拉：先更新 θ 再平移） */
export function stepCar(st: CarState, vL: number, vR: number, W: number, dt: number): CarState {
  const v = (vL + vR) / 2;
  const omega = (vR - vL) / Math.max(W, 1e-4);
  const theta = st.theta + omega * dt;
  return {
    x: st.x + v * Math.cos(theta) * dt,
    y: st.y + v * Math.sin(theta) * dt,
    theta,
  };
}

/** 由平面位姿求电感世界坐标与敏感轴世界向量（z 分量不变） */
export function carFrame(st: CarState) {
  const forward = { x: Math.cos(st.theta), y: Math.sin(st.theta) };
  const right = { x: Math.sin(st.theta), y: -Math.cos(st.theta) };
  return { origin: { x: st.x, y: st.y }, forward, right };
}

export interface TrackingResult {
  status: 'finished' | 'lost' | 'maxSteps';
  /** 各时间步记录（长度 = 步数） */
  t: number[];
  x: number[];
  y: number[];
  theta: number[];
  vL: number[];
  vR: number[];
  err: number[];
  /** 每个电感一条 U(t) 曲线（名称可能带 * 回退标注，由 readSensor 决定数值） */
  sensorU: { name: string; values: number[] }[];
  /** 仿真用时（s）、行驶弧长（m）、步数、实际计算耗时（ms） */
  timeS: number;
  distM: number;
  steps: number;
  elapsedMs: number;
  /** 首次跑满赛道总长（行驶弧长 ≥ 总长）的记录索引；未跑满时为最后一步 */
  finishIndex: number;
}

/** 赛道总长之外的行驶容差（m）：超过总长 + 容差判定跑完全程 */
export const FINISH_TOLERANCE_M = 0.5;
/** 步数硬上限（防止参数极端时死循环） */
export const MAX_TRACKING_STEPS = 100000;

/**
 * 循迹闭环仿真主循环。
 *
 * readSensor(sensor, world, axisWorld) -> U(Vpp)：
 *   由调用方按当前数据源注入——仿真源用 k·|B·n̂|；实测源换算横向距离 d 后求值
 *   （通道无数据时调用方内部回退仿真公式）。
 */
export function simulateTracking(opts: {
  path: PathSample;
  sensors: SensorDef[];
  params: TrackingParams;
  formula: CompiledFormula;
  readSensor: (
    sensor: SensorDef,
    world: { x: number; y: number },
    axisWorld: [number, number, number],
  ) => number;
  maxSteps?: number;
  /**
   * 闭环赛道：仅生成一圈轨迹——行驶弧长达单圈总长即判完赛（数学模型.md §4/数学模型.md §8.5）；
   * 非闭环保持原判据：总长 + FINISH_TOLERANCE_M 容差。
   */
  closed?: boolean;
}): TrackingResult {
  const t0 = performance.now();
  const { path, sensors, params, formula, readSensor } = opts;
  const maxSteps = opts.maxSteps ?? MAX_TRACKING_STEPS;
  const dt = Math.max(params.dtMs, 0.5) / 1000;

  // 初始位姿：起点中线 + e/ψ 扰动（e>0 右偏，ψ>0 右偏，与 poseFrame 约定一致）
  const p0 = pointAtLength(path, 0);
  const e0 = params.initEMm / 1000;
  const psi0 = (params.initPsiDeg * Math.PI) / 180;
  let st: CarState = {
    x: p0.x + e0 * p0.ty,
    y: p0.y - e0 * p0.tx,
    theta: Math.atan2(p0.ty, p0.tx) + psi0,
  };

  const result: TrackingResult = {
    status: 'maxSteps',
    t: [],
    x: [],
    y: [],
    theta: [],
    vL: [],
    vR: [],
    err: [],
    sensorU: sensors.map((s) => ({ name: s.name, values: [] })),
    timeS: 0,
    distM: 0,
    steps: 0,
    elapsedMs: 0,
    finishIndex: -1,
  };

  let prevErr = 0;
  let errRun = 0; // |Err| 持续超限计数
  let dist = 0;
  let step = 0;
  let finishIndex = -1;
  // 电机一阶滞后状态（实际轮速，数学模型.md §8.4）：起步时车以 v_base 直行
  const tauS = Math.max(params.motorTauMs, 0) / 1000;
  let vLAct = params.vBase;
  let vRAct = params.vBase;
  // 闭环赛道：行驶弧长达单圈总长即完赛；非闭环：总长 + 0.5m 容差
  const finishDist = path.length + (opts.closed ? 0 : FINISH_TOLERANCE_M);

  for (; step < maxSteps; step++) {
    const frame = carFrame(st);
    const { origin, forward, right } = frame;

    // 各电感读数
    const vars: Record<string, number> = { A: params.A, B: params.B, C: params.C, P: params.P };
    for (let j = 0; j < sensors.length; j++) {
      const s = sensors[j];
      const w = {
        x: origin.x + s.x * right.x + s.y * forward.x,
        y: origin.y + s.x * right.y + s.y * forward.y,
      };
      const [ax, ay, az] = axisVector(s);
      const axisWorld: [number, number, number] = [
        ax * right.x + ay * forward.x,
        ax * right.y + ay * forward.y,
        az,
      ];
      const u = readSensor(s, w, axisWorld);
      vars[s.name] = u;
      result.sensorU[j].values.push(u);
    }

    // 误差（公式求值；分母为零等非法结果回退上一步误差，避免轨迹发散出 NaN）
    let err: number;
    try {
      err = formula.eval(vars);
    } catch {
      err = prevErr;
    }
    if (!Number.isFinite(err)) err = prevErr;

    // PD + 指令轮速 + 电机一阶滞后（实际轮速）
    const errRate = step === 0 ? 0 : (err - prevErr) / dt;
    const u = pdOutput(err, errRate, params);
    const cmd = wheelSpeeds(u, params);
    vLAct = motorLag(vLAct, cmd.vL, tauS, dt);
    vRAct = motorLag(vRAct, cmd.vR, tauS, dt);

    // 记录（轮速为电机滞后后的实际值）
    result.t.push(step * dt);
    result.x.push(st.x);
    result.y.push(st.y);
    result.theta.push(st.theta);
    result.vL.push(vLAct);
    result.vR.push(vRAct);
    result.err.push(err);

    // 终止条件
    if (finishIndex < 0 && dist >= path.length) finishIndex = result.t.length - 1; // 冲线点
    if (Math.abs(err) > params.errLimit) {
      errRun++;
      if (errRun >= params.errLimitSteps) {
        result.status = 'lost';
        break;
      }
    } else {
      errRun = 0;
    }
    if (dist >= finishDist) {
      result.status = 'finished';
      break;
    }

    // 积分（实际轮速驱动运动学）
    prevErr = err;
    st = stepCar(st, vLAct, vRAct, params.wheelBase, dt);
    dist += ((vLAct + vRAct) / 2) * dt;
    if (!Number.isFinite(st.x) || !Number.isFinite(st.y)) {
      result.status = 'lost';
      break;
    }
  }

  result.steps = result.t.length;
  result.timeS = result.steps * dt;
  result.distM = dist;
  result.elapsedMs = performance.now() - t0;
  result.finishIndex = finishIndex >= 0 ? finishIndex : result.steps - 1;
  return result;
}
