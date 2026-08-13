/**
 * 全程扫描：固定横向偏差 e 与航向角 ψ，车沿赛道从 s=0 扫到全长，
 * 逐点计算每个电感的 U(s) = k·|B(P_i(s))·n̂_i(s)|。
 *
 * 计算量：全长 5m、10mm 步进 = 500 点 × 电感数 × 单点毕奥-萨伐尔，毫秒级，
 * 主线程同步批量算即可（实测耗时装在 result.elapsedMs，供需要时判断是否要防抖/缓存）。
 */
import { computeB } from './field';
import { poseFrame, sensorAxisWorld, sensorWorld } from './sensor';
import type { AxisPreset, CarPose, SensorDef } from './sensor';
import { pointAtLength } from './track';
import type { Elements, PathSample } from './track';
import { signedLateralDistance } from './measured';

export interface SweepSeries {
  name: string;
  axisPreset: AxisPreset;
  /** U(s) = k·|B·n̂|（V，Vpp；k 由贴线锚点标定，单位 V/T），与 sMm 一一对应 */
  values: Float64Array;
}

export interface SweepResult {
  /** 采样点沿线位置（mm），0..总长，步进 stepMm */
  sMm: number[];
  series: SweepSeries[];
  /** 本次扫描耗时（ms） */
  elapsedMs: number;
  stepMm: number;
}

export function sweepAlongTrack(
  path: PathSample,
  elements: Elements,
  sensors: SensorDef[],
  I: number,
  /** 横向偏差 e（m） */
  e: number,
  /** 航向角 ψ（rad） */
  psi: number,
  k: number,
  stepMm = 10,
): SweepResult {
  const t0 = performance.now();
  const totalMm = path.length * 1000;
  const n = Math.max(2, Math.floor(totalMm / stepMm) + 1);
  const sMm: number[] = new Array(n);
  const series: SweepSeries[] = sensors.map((s) => ({
    name: s.name,
    axisPreset: s.axisPreset,
    values: new Float64Array(n),
  }));

  for (let i = 0; i < n; i++) {
    const smm = Math.min(i * stepMm, totalMm); // 末点精确落在终点
    sMm[i] = smm;
    const p = pointAtLength(path, smm / 1000);
    const pose: CarPose = { px: p.x, py: p.y, tx: p.tx, ty: p.ty, e, psi };
    const frame = poseFrame(pose);
    for (let j = 0; j < sensors.length; j++) {
      const s = sensors[j];
      const w = sensorWorld(s, frame);
      const ax = sensorAxisWorld(s, frame);
      const [bx, by, bz] = computeB(w.x, w.y, w.h, elements, I);
      series[j].values[i] = k * Math.abs(bx * ax[0] + by * ax[1] + bz * ax[2]);
    }
  }

  return { sMm, series, elapsedMs: performance.now() - t0, stepMm };
}

/**
 * 实测模型全程扫描：固定横向偏差 e 与航向角 ψ，车沿赛道从 s=0 扫到全长，
 * 逐点把每个电感的世界坐标换算成有符号横向距离 d，交给实测模型回调求值。
 *
 * - modelEval(sensor, dMm)：实测模型统一求值（方案A 拟合 / 方案B LUT），
 *   通道无数据时返回 null；
 * - fallback 给出时，null 通道回退仿真公式 U = k·|B·n̂|（保持曲线可用），
 *   发生过回退的通道名加 * 标注；
 * - 返回结构与 sweepAlongTrack 相同，复用 SweepResult / SensorSweepChart。
 */
export function sweepMeasuredAlongTrack(
  path: PathSample,
  sensors: SensorDef[],
  /** 横向偏差 e（m） */
  e: number,
  /** 航向角 ψ（rad） */
  psi: number,
  /** 实测模型求值回调：(电感, 有符号横向距离 mm) -> U(Vpp) 或 null */
  modelEval: (sensor: SensorDef, dMm: number) => number | null,
  stepMm = 10,
  /** 可选仿真回退：无实测数据的通道用仿真公式补值 */
  fallback?: { elements: Elements; I: number; k: number },
): SweepResult {
  const t0 = performance.now();
  const totalMm = path.length * 1000;
  const n = Math.max(2, Math.floor(totalMm / stepMm) + 1);
  const sMm: number[] = new Array(n);
  const series: SweepSeries[] = sensors.map((s) => ({
    name: s.name,
    axisPreset: s.axisPreset,
    values: new Float64Array(n),
  }));
  const fellBack = new Array<boolean>(sensors.length).fill(false);

  for (let i = 0; i < n; i++) {
    const smm = Math.min(i * stepMm, totalMm); // 末点精确落在终点
    sMm[i] = smm;
    const p = pointAtLength(path, smm / 1000);
    const pose: CarPose = { px: p.x, py: p.y, tx: p.tx, ty: p.ty, e, psi };
    const frame = poseFrame(pose);
    for (let j = 0; j < sensors.length; j++) {
      const s = sensors[j];
      const w = sensorWorld(s, frame);
      const dMm = signedLateralDistance(path, w.x, w.y) * 1000;
      const v = modelEval(s, dMm);
      if (v !== null) {
        series[j].values[i] = v;
      } else if (fallback) {
        const ax = sensorAxisWorld(s, frame);
        const [bx, by, bz] = computeB(w.x, w.y, w.h, fallback.elements, fallback.I);
        series[j].values[i] = fallback.k * Math.abs(bx * ax[0] + by * ax[1] + bz * ax[2]);
        fellBack[j] = true;
      } else {
        series[j].values[i] = 0;
      }
    }
  }
  for (let j = 0; j < sensors.length; j++) {
    if (fellBack[j]) series[j].name = `${series[j].name}*`; // 回退仿真通道标注
  }

  return { sMm, series, elapsedMs: performance.now() - t0, stepMm };
}
