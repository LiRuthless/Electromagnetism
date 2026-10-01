/**
 * Simulator 门面（Phase 12）：组合 Vehicle + Scheduler + CarController，
 * 对外提供 reset / step（实时逐帧）/ runToEnd（快进一次算全程）。
 *
 * 终止条件沿用式 (8.10)：行驶弧长 ≥ 赛道总长（闭环，仅一圈）/ ≥ 总长 + 0.5 m
 * （非闭环）→ finished；控制器上报 err 且 |Err| 持续超 errLimit 达 errLimitSteps
 * 步 → lost；步数硬上限 MAX_TRACKING_STEPS → maxSteps；位姿 NaN → lost。
 * 控制器不上报 err 时失控判停退化为 NaN/步数上限。
 *
 * 单任务 periodMs = dtMs 特例下，step 内"采样 → 控制 → 电机滞后 → 记录 →
 * 终止判定 → 积分"的顺序与重构前 simulateTracking() 主循环逐行对齐（V-1 等价性）。
 */
import { FINISH_TOLERANCE_M, MAX_TRACKING_STEPS } from '../kinematics';
import type { TrackingResult } from '../kinematics';
import type { TrackingParams } from '../control';
import type { SensorDef } from '../sensor';
import type { PathSample } from '../track';
import type { CarController, SensorReadings, WheelCommand } from './controller';
import { Scheduler } from './scheduler';
import { Vehicle } from './vehicle';
import type { SensorSampler } from './vehicle';

/** 任务入口类别（首期仅控制任务一类） */
export type SimTaskEntry = 'control';

/** 实时逐帧快照 */
export interface SimFrame {
  /** 已完成 tick 数（= 已记录行数） */
  step: number;
  /** 当前仿真时刻（s） */
  tS: number;
  x: number;
  y: number;
  theta: number;
  vL: number;
  vR: number;
  err: number | null;
  distM: number;
  /** 终止状态（运行中为 null） */
  status: 'finished' | 'lost' | 'maxSteps' | null;
  done: boolean;
}

export class Simulator {
  private vehicle: Vehicle;
  private controller: CarController;
  private scheduler: Scheduler;
  private params: TrackingParams;
  private path: PathSample;
  private sensors: SensorDef[];
  private closed: boolean;
  private maxSteps: number;
  private finishDist: number;

  private cmd: WheelCommand | null = null;
  private pendingReadings: SensorReadings | null = null;
  private rec: TrackingResult;
  private errRun = 0;
  private finishIdx = -1;
  private terminated = false;

  constructor(opts: {
    path: PathSample;
    sensors: SensorDef[];
    vehicle: { controller: CarController; sampler: SensorSampler; params: TrackingParams };
    tasks: { periodMs: number; entry: SimTaskEntry }[];
    closed: boolean;
    maxSteps?: number;
  }) {
    this.path = opts.path;
    this.sensors = opts.sensors;
    this.params = opts.vehicle.params;
    this.controller = opts.vehicle.controller;
    this.closed = opts.closed;
    this.maxSteps = opts.maxSteps ?? MAX_TRACKING_STEPS;
    this.finishDist = this.path.length + (this.closed ? 0 : FINISH_TOLERANCE_M);
    this.vehicle = new Vehicle(
      this.path,
      this.sensors,
      this.params,
      this.controller,
      opts.vehicle.sampler,
    );
    this.scheduler = new Scheduler(Math.max(this.params.dtMs, 0.5), [
      ...opts.tasks.map((t) => ({ periodMs: t.periodMs, entry: () => this.runTask(t.entry) })),
    ]);
    this.controller.init();
    this.rec = this.freshRec();
  }

  private runTask(entry: SimTaskEntry): void {
    if (entry === 'control' && this.pendingReadings) {
      this.cmd = this.controller.step(this.pendingReadings);
    }
  }

  private freshRec(): TrackingResult {
    return {
      status: 'maxSteps',
      t: [],
      x: [],
      y: [],
      theta: [],
      vL: [],
      vR: [],
      err: [],
      sensorU: this.sensors.map((s) => ({ name: s.name, values: [] })),
      timeS: 0,
      distM: 0,
      steps: 0,
      elapsedMs: 0,
      finishIndex: -1,
    };
  }

  /** 复位全部仿真状态（位姿/轮速/控制器/调度器时钟/记录）；params 提供时注入 */
  reset(params?: TrackingParams): void {
    if (params) this.params = params;
    this.vehicle.reset(params);
    this.scheduler.reset();
    this.cmd = null;
    this.pendingReadings = null;
    this.rec = this.freshRec();
    this.errRun = 0;
    this.finishIdx = -1;
    this.terminated = false;
  }

  /** 实时记录（数组随 step 增长；字段 steps/timeS/distM/finishIndex 由 runToEnd 收尾） */
  get result(): Readonly<TrackingResult> {
    return this.rec;
  }

  get done(): boolean {
    return this.terminated;
  }

  /** 物理步长（ms，实时模式 rAF 累加器用） */
  get stepMs(): number {
    return this.scheduler.stepUs / 1000;
  }

  /** 行驶弧长（m，实时可读） */
  get distM(): number {
    return this.vehicle.dist;
  }

  /**
   * 推进一个物理 tick，返回当帧快照。
   * dtMs 提供且与当前步长不同时重配物理步长（时钟保持）。
   */
  step(dtMs?: number): SimFrame {
    if (dtMs !== undefined) {
      const us = Math.max(1, Math.round(Math.max(dtMs, 0.5) * 1000));
      if (us !== this.scheduler.stepUs) {
        this.scheduler.setStepMs(dtMs);
        this.vehicle.setDtMs(dtMs);
      }
    }
    if (this.terminated || this.rec.t.length >= this.maxSteps) {
      if (!this.terminated) {
        this.rec.status = 'maxSteps';
        this.terminated = true;
      }
      return this.frame();
    }

    const tMs = this.scheduler.nowMs;
    const { readings, values } = this.vehicle.sample(tMs);
    this.pendingReadings = readings;
    this.scheduler.runDue();
    // 首触发前（正常不会发生：首 tick due=0）以 v_base 直行
    const cmd = this.cmd ?? { vLCmd: this.params.vBase, vRCmd: this.params.vBase };
    this.vehicle.applyCommand(cmd);
    const err = cmd.err ?? null;

    // 记录（轮速为电机滞后后的实际值，与 simulateTracking 逐行对齐）
    const r = this.rec;
    for (let j = 0; j < this.sensors.length; j++) r.sensorU[j].values.push(values[j]);
    r.t.push(r.t.length * this.vehicle.dt);
    r.x.push(this.vehicle.state.x);
    r.y.push(this.vehicle.state.y);
    r.theta.push(this.vehicle.state.theta);
    r.vL.push(this.vehicle.vLAct);
    r.vR.push(this.vehicle.vRAct);
    r.err.push(err ?? 0);

    // 终止条件（式 (8.10)）
    if (this.finishIdx < 0 && this.vehicle.dist >= this.path.length) this.finishIdx = r.t.length - 1;
    if (err !== null && Math.abs(err) > this.params.errLimit) {
      this.errRun++;
      if (this.errRun >= this.params.errLimitSteps) {
        r.status = 'lost';
        this.terminated = true;
        return this.frame();
      }
    } else {
      this.errRun = 0;
    }
    if (this.vehicle.dist >= this.finishDist) {
      r.status = 'finished';
      this.terminated = true;
      return this.frame();
    }

    this.vehicle.integrate();
    if (!Number.isFinite(this.vehicle.state.x) || !Number.isFinite(this.vehicle.state.y)) {
      r.status = 'lost';
      this.terminated = true;
      return this.frame();
    }
    this.scheduler.advance();
    return this.frame();
  }

  private frame(): SimFrame {
    const r = this.rec;
    const n = r.t.length - 1;
    return {
      step: r.t.length,
      tS: n >= 0 ? r.t[n] : 0,
      x: this.vehicle.state.x,
      y: this.vehicle.state.y,
      theta: this.vehicle.state.theta,
      vL: this.vehicle.vLAct,
      vR: this.vehicle.vRAct,
      err: n >= 0 ? (r.err[n] ?? null) : null,
      distM: this.vehicle.dist,
      status: this.terminated ? r.status : null,
      done: this.terminated,
    };
  }

  /** 快进：一次算全程至终止，返回 TrackingResult（等价 simulateTracking 行为） */
  runToEnd(): TrackingResult {
    const t0 = performance.now();
    while (!this.terminated) this.step();
    const r = this.rec;
    r.steps = r.t.length;
    r.timeS = r.steps * this.vehicle.dt;
    r.distM = this.vehicle.dist;
    r.elapsedMs = performance.now() - t0;
    r.finishIndex = this.finishIdx >= 0 ? this.finishIdx : r.steps - 1;
    return r;
  }
}
