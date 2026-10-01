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
 *
 * Phase 12：闭环主循环已迁入 sim/ 子层（Simulator 门面 + Vehicle + Scheduler +
 * FormulaController）；本文件的 simulateTracking() 为兼容薄壳（见函数注释），
 * stepCar()/carFrame() 由 sim/vehicle.ts 复用。
 */
import type { PathSample } from './track';
import type { SensorDef } from './sensor';
import { FormulaController } from './sim/controller';
import { Simulator } from './sim/simulator';
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
 * 循迹闭环仿真主循环——Phase 12 起为 Simulator.runToEnd() 的兼容薄壳：
 * 签名与 TrackingResult 结构不变（selfcheck-tracking、matlab-simulink 对照注释、
 * CSV 导出链路均以此为锚）；内部装配"单任务 periodMs = dtMs + FormulaController"
 * 的 Simulator，数值行为与重构前内联实现逐点一致（V-1 回归防护）。
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
  const sim = new Simulator({
    path: opts.path,
    sensors: opts.sensors,
    vehicle: {
      controller: new FormulaController(opts.params, opts.formula),
      sampler: opts.readSensor,
      params: opts.params,
    },
    tasks: [{ periodMs: opts.params.dtMs, entry: 'control' }],
    closed: opts.closed ?? false,
    maxSteps: opts.maxSteps,
  });
  return sim.runToEnd();
}
