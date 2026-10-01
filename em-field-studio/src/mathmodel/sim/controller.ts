/**
 * 车载控制器接口与内置公式控制器（Phase 12 仿真器架构分层）。
 *
 * CarController 是"读数进、轮速指令出"的纯数据黑盒，为 Phase 13 WASM 车载控制器
 * 的宿主插桩点；FormulaController 把 control.ts 的误差公式 + PD + 差速轮速分配
 * 包装为内置控制器，作无外部控制器时的兜底与重构等价性的对照组。
 *
 * FormulaController.step() 逐行复刻重构前 simulateTracking() 的内联控制逻辑：
 * 公式求值（分母为零 / 未知变量 / NaN 回退上一步误差）、首步 errRate = 0、
 * 之后 errRate = (err − prevErr) / Δt（Δt 取相邻两次 step 的 tMs 差，秒）、
 * pdOutput()、wheelSpeeds() 限幅 [0, v_max]。
 */
import { pdOutput, wheelSpeeds } from '../control';
import type { CompiledFormula, TrackingParams } from '../control';

/** 电感读数包（纯数据：U 为 Vpp 数值，时间为 ms） */
export interface SensorReadings {
  /** 采样时刻（仿真时钟，ms，自 reset 起算） */
  tMs: number;
  /** 各电感读数（key = 电感名，值 = U / Vpp） */
  u: Record<string, number>;
}

/** 轮速指令（纯数据，m/s） */
export interface WheelCommand {
  vLCmd: number;
  vRCmd: number;
  /** 可选诊断：控制器内部误差（供失控判停式 (8.10) 与轨迹记录；不上报则失控判停退化为 NaN/步数上限） */
  err?: number;
}

/** 车载控制器接口（Phase 13 WASM 控制器的宿主插桩点） */
export interface CarController {
  /** 载入/初始化（幂等） */
  init(): void;
  /** 控制任务周期到点触发：读数进、轮速指令出 */
  step(readings: SensorReadings): WheelCommand;
  /** 复位内部状态（微分历史等） */
  reset(): void;
}

/** 内置公式控制器：误差公式 + PD + 差速轮速分配（兜底 + 对照组） */
export class FormulaController implements CarController {
  private params: TrackingParams;
  private formula: CompiledFormula;
  private prevErr = 0;
  private prevTMs: number | null = null;

  constructor(params: TrackingParams, formula: CompiledFormula) {
    this.params = params;
    this.formula = formula;
  }

  init(): void {}

  setParams(params: TrackingParams): void {
    this.params = params;
  }

  reset(): void {
    this.prevErr = 0;
    this.prevTMs = null;
  }

  step(readings: SensorReadings): WheelCommand {
    const p = this.params;
    const vars: Record<string, number> = { A: p.A, B: p.B, C: p.C, P: p.P };
    for (const name of Object.keys(readings.u)) vars[name] = readings.u[name];
    let err: number;
    try {
      err = this.formula.eval(vars);
    } catch {
      err = this.prevErr;
    }
    if (!Number.isFinite(err)) err = this.prevErr;
    const errRate =
      this.prevTMs === null ? 0 : (err - this.prevErr) / ((readings.tMs - this.prevTMs) / 1000);
    const u = pdOutput(err, errRate, p);
    const cmd = wheelSpeeds(u, p);
    this.prevErr = err;
    this.prevTMs = readings.tMs;
    return { vLCmd: cmd.vL, vRCmd: cmd.vR, err };
  }
}
