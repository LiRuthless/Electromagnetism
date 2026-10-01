/**
 * 虚拟整车与读数采样器（Phase 12）。
 *
 * createSensorSampler：收敛 Home.tsx 原三处重复读数闭包（循迹重算 / 实时读数 /
 * 一键调 PID）为单一实现——实测源（fit/phys）先换算有符号横向距离 d 经
 * evalMeasured() 求值，通道无数据回退仿真公式 k·|B·n̂|；仿真源直接 computeB 投影。
 * createSensorSamplerDetailed 为同一实现的带分量变体（UI 显示需要 B 三分量与
 * 回退标注），二者共享一份求值路径，不存在第二份策略实现。
 *
 * Vehicle：持有当前位姿 / 实际轮速状态 / 控制器 / 采样器，每物理 tick：
 * 采样读数 →（调度器触发控制任务，指令零阶保持）→ 电机一阶滞后 motorLag
 * 精确更新（式 (8.6)/(8.7)）→ stepCar 半隐式欧拉积分（式 (8.8)/(8.9)）。
 * 单任务 periodMs = dtMs 特例下与重构前 simulateTracking() 内联逻辑逐行对齐。
 */
import { computeB } from '../field';
import { evalMeasured, signedLateralDistance } from '../measured';
import type { MeasuredModelKind, MeasuredState } from '../measured';
import { motorLag } from '../control';
import type { TrackingParams } from '../control';
import { axisVector } from '../sensor';
import type { SensorDef } from '../sensor';
import { carFrame, stepCar } from '../kinematics';
import type { CarState } from '../kinematics';
import { pointAtLength } from '../track';
import type { Elements, PathSample } from '../track';
import type { SourceKind } from '../sources';
import type { CarController, SensorReadings, WheelCommand } from './controller';

/** 读数采样器：与重构前 simulateTracking() 的 readSensor 回调同签名 */
export type SensorSampler = (
  sensor: SensorDef,
  world: { x: number; y: number },
  axisWorld: [number, number, number],
) => number;

/** 采样明细：UI 显示需要的 B 三分量（Tesla）与实测回退标注 */
export interface SampleDetail {
  value: number;
  /** true = 实测通道无数据，回退仿真公式（UI 名称加 * 标注） */
  fallback: boolean;
  bx?: number;
  by?: number;
  bz?: number;
}

export interface SamplerDeps {
  path: PathSample;
  elements: Elements;
  currentMa: number;
  /** 标定系数 k（V/T），贴线锚点反推 */
  k: number;
  sourceKind: SourceKind;
  measured: MeasuredState | null;
}

export function createSensorSamplerDetailed(
  opts: SamplerDeps,
): (sensor: SensorDef, world: { x: number; y: number }, axisWorld: [number, number, number]) => SampleDetail {
  const I = opts.currentMa / 1000;
  const modelKind: MeasuredModelKind | null =
    opts.sourceKind === 'measured-fit' ? 'fit' : opts.sourceKind === 'measured-phys' ? 'phys' : null;
  const sim = (
    sensor: SensorDef,
    world: { x: number; y: number },
    axisWorld: [number, number, number],
  ) => {
    const [bx, by, bz] = computeB(world.x, world.y, sensor.h, opts.elements, I);
    return {
      value: opts.k * Math.abs(bx * axisWorld[0] + by * axisWorld[1] + bz * axisWorld[2]),
      bx,
      by,
      bz,
    };
  };
  return (sensor, world, axisWorld) => {
    if (modelKind && opts.measured) {
      const dMm = signedLateralDistance(opts.path, world.x, world.y) * 1000;
      const v = evalMeasured(
        opts.measured.dataset,
        opts.measured.fits,
        modelKind,
        sensor.name,
        sensor.axisPreset,
        dMm,
        { hM: sensor.h, axis: axisVector(sensor), I, k: opts.k },
      );
      if (v !== null) return { value: v, fallback: false };
      const s = sim(sensor, world, axisWorld);
      return { value: s.value, fallback: true, bx: s.bx, by: s.by, bz: s.bz };
    }
    const s = sim(sensor, world, axisWorld);
    return { value: s.value, fallback: false, bx: s.bx, by: s.by, bz: s.bz };
  };
}

export function createSensorSampler(opts: SamplerDeps): SensorSampler {
  const detail = createSensorSamplerDetailed(opts);
  return (sensor, world, axisWorld) => detail(sensor, world, axisWorld).value;
}

/** 虚拟整车：位姿 + 实际轮速 + 控制器 + 采样器 + 电机滞后 + 运动学积分 */
export class Vehicle {
  state: CarState = { x: 0, y: 0, theta: 0 };
  /** 电机滞后后的实际轮速（m/s） */
  vLAct = 0;
  vRAct = 0;
  /** 行驶弧长（m） */
  dist = 0;
  private path: PathSample;
  private sensors: SensorDef[];
  private controller: CarController;
  private sampler: SensorSampler;
  private params: TrackingParams;
  private tauS = 0;
  private dtS = 0.005;

  constructor(
    path: PathSample,
    sensors: SensorDef[],
    params: TrackingParams,
    controller: CarController,
    sampler: SensorSampler,
  ) {
    this.path = path;
    this.sensors = sensors;
    this.params = params;
    this.controller = controller;
    this.sampler = sampler;
    this.resetState();
  }

  /** 物理步长（s，dtMs 下限 0.5ms） */
  get dt(): number {
    return this.dtS;
  }

  /** 运行中改物理步长（仅更新 dt，不动位姿/轮速/弧长） */
  setDtMs(dtMs: number): void {
    this.params = { ...this.params, dtMs };
    this.dtS = Math.max(dtMs, 0.5) / 1000;
  }

  /** 复位全部状态；params 提供时注入（含控制器侧） */
  reset(params?: TrackingParams): void {
    if (params) {
      this.params = params;
      const c = this.controller as Partial<{ setParams(p: TrackingParams): void }>;
      c.setParams?.(params);
    }
    this.resetState();
    this.controller.reset();
  }

  private resetState(): void {
    const p0 = pointAtLength(this.path, 0);
    const e0 = this.params.initEMm / 1000;
    const psi0 = (this.params.initPsiDeg * Math.PI) / 180;
    this.state = {
      x: p0.x + e0 * p0.ty,
      y: p0.y - e0 * p0.tx,
      theta: Math.atan2(p0.ty, p0.tx) + psi0,
    };
    this.tauS = Math.max(this.params.motorTauMs, 0) / 1000;
    this.dtS = Math.max(this.params.dtMs, 0.5) / 1000;
    // 滞后状态初始 v_L = v_R = v_base（起步以基础速度直行）
    this.vLAct = this.params.vBase;
    this.vRAct = this.params.vBase;
    this.dist = 0;
  }

  /** 按当前位姿采样各电感读数（世界坐标/敏感轴换算与重构前内联实现逐行一致） */
  sample(tMs: number): { readings: SensorReadings; values: number[] } {
    const { origin, forward, right } = carFrame(this.state);
    const u: Record<string, number> = {};
    const values: number[] = [];
    for (const s of this.sensors) {
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
      const v = this.sampler(s, w, axisWorld);
      u[s.name] = v;
      values.push(v);
    }
    return { readings: { tMs, u }, values };
  }

  /** 电机一阶滞后精确更新（式 (8.7)，指令零阶保持——未触发控制的 tick 沿用上次指令） */
  applyCommand(cmd: WheelCommand): void {
    this.vLAct = motorLag(this.vLAct, cmd.vLCmd, this.tauS, this.dtS);
    this.vRAct = motorLag(this.vRAct, cmd.vRCmd, this.tauS, this.dtS);
  }

  /** 运动学积分（式 (8.8)/(8.9)，实际轮速驱动）并累计行驶弧长 */
  integrate(): void {
    this.state = stepCar(this.state, this.vLAct, this.vRAct, this.params.wheelBase, this.dtS);
    this.dist += ((this.vLAct + this.vRAct) / 2) * this.dtS;
  }
}
