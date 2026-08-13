/**
 * 导出工具：CSV / PNG 下载；赛道库 localStorage 持久化。
 */
import { computeGridFull } from '../mathmodel/field';
import type { SensorReading, SensorDef } from '../mathmodel/sensor';
import { axisVector } from '../mathmodel/sensor';
import type { SweepResult } from '../mathmodel/sweep';
import type { TrackingResult } from '../mathmodel/kinematics';
import type { TrackingParams } from '../mathmodel/control';
import type { Elements, TrackDef } from '../mathmodel/track';

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadText(text: string, filename: string) {
  downloadBlob(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }), filename);
}

export interface ExportContext {
  currentMa: number;
  heightMm: number;
  gridStepMm: number;
  trackLengthM: number;
  trackName: string;
}

/** 导出当前磁场网格 CSV（x, y, h 单位 mm；Bx, By, Bz, |B| 单位 μT） */
export function exportGridCSV(
  elements: Elements,
  grid: { x0: number; y0: number; nx: number; ny: number; dx: number; dy: number },
  ctx: ExportContext,
) {
  const I = ctx.currentMa / 1000;
  const h = ctx.heightMm / 1000;
  const { bx, by, bz, bmag } = computeGridFull(
    elements, I, grid.x0, grid.y0, grid.nx, grid.ny, grid.dx, grid.dy, h,
  );
  const lines: string[] = [
    `# 电磁场网格数据导出`,
    `# 赛道=${ctx.trackName} 电流=${ctx.currentMa}mA 观测高度=${ctx.heightMm}mm 网格步长=${ctx.gridStepMm}mm 赛道总长=${(ctx.trackLengthM * 1000).toFixed(1)}mm`,
    `# 网格原点=(${(grid.x0 * 1000).toFixed(1)}, ${(grid.y0 * 1000).toFixed(1)})mm 分辨率=${grid.nx}x${grid.ny}`,
    `# 导出时间=${new Date().toISOString()}`,
    'x(mm),y(mm),h(mm),Bx(uT),By(uT),Bz(uT),|B|(uT)',
  ];
  for (let iy = 0; iy < grid.ny; iy++) {
    const y = grid.y0 + (iy + 0.5) * grid.dy;
    for (let ix = 0; ix < grid.nx; ix++) {
      const x = grid.x0 + (ix + 0.5) * grid.dx;
      const i = iy * grid.nx + ix;
      lines.push(
        `${(x * 1000).toFixed(2)},${(y * 1000).toFixed(2)},${(h * 1000).toFixed(2)},` +
          `${(bx[i] * 1e6).toFixed(4)},${(by[i] * 1e6).toFixed(4)},` +
          `${(bz[i] * 1e6).toFixed(4)},${(bmag[i] * 1e6).toFixed(4)}`,
      );
    }
  }
  downloadText(lines.join('\n'), `field-grid-${Date.now()}.csv`);
}

/** 导出当前车体位姿下各电感读数 CSV（位置单位 mm） */
export function exportReadingsCSV(
  sensors: SensorDef[],
  readings: SensorReading[],
  ctx: ExportContext & { eMm: number; psiDeg: number; k: number; vppAnchor: number },
) {
  const byName = new Map(readings.map((r) => [r.name, r]));
  const lines: string[] = [
    `# 电感读数导出`,
    `# 赛道=${ctx.trackName} 电流=${ctx.currentMa}mA 赛道总长=${(ctx.trackLengthM * 1000).toFixed(1)}mm`,
    `# 车体位姿: 横向偏差e=${ctx.eMm}mm 航向角psi=${ctx.psiDeg}deg 标定k=${ctx.k.toExponential(4)}V/T 锚点Vpp=${ctx.vppAnchor}V(贴线@20kHz/100mA)`,
    `# 导出时间=${new Date().toISOString()}`,
    'name,x_body(mm),y_body(mm),h(mm),axis_x,axis_y,axis_z,U(Vpp)',
  ];
  for (const s of sensors) {
    const ax = axisVector(s);
    const r = byName.get(s.name);
    lines.push(
      `${s.name},${(s.x * 1000).toFixed(1)},${(s.y * 1000).toFixed(1)},${(s.h * 1000).toFixed(1)},` +
        `${ax[0].toFixed(4)},${ax[1].toFixed(4)},${ax[2].toFixed(4)},` +
        `${r ? r.value.toFixed(4) : ''}`,
    );
  }
  downloadText(lines.join('\n'), `sensor-readings-${Date.now()}.csv`);
}

/** 导出全程扫描 CSV：s(mm) + 各电感 U(s)，表头附 e/ψ/电流/高度等参数 */
export function exportSweepCSV(
  sweep: SweepResult,
  ctx: ExportContext & { eMm: number; psiDeg: number; k: number; vppAnchor: number },
) {
  const header = ['s(mm)', ...sweep.series.map((se) => `${se.name}_U(Vpp)`)];
  const lines: string[] = [
    `# 电感全程扫描导出 U(s)`,
    `# 赛道=${ctx.trackName} 电流=${ctx.currentMa}mA 观测高度=${ctx.heightMm}mm 赛道总长=${(ctx.trackLengthM * 1000).toFixed(1)}mm`,
    `# 固定位姿参数: 横向偏差e=${ctx.eMm}mm 航向角psi=${ctx.psiDeg}deg 标定k=${ctx.k.toExponential(4)}V/T 锚点Vpp=${ctx.vppAnchor}V 扫描步长=${sweep.stepMm}mm`,
    `# 导出时间=${new Date().toISOString()}`,
    header.join(','),
  ];
  for (let i = 0; i < sweep.sMm.length; i++) {
    lines.push(
      `${sweep.sMm[i].toFixed(0)},` +
        sweep.series.map((se) => se.values[i].toFixed(4)).join(','),
    );
  }
  downloadText(lines.join('\n'), `sensor-sweep-${Date.now()}.csv`);
}

/** 导出循迹闭环轨迹 CSV：逐时间步一行（t, x, y, θ, v_L, v_R, Err, 各电感 U） */
export function exportTrackingCSV(
  tr: TrackingResult,
  tp: TrackingParams,
  ctx: ExportContext & { sourceName: string },
) {
  const statusText =
    tr.status === 'finished' ? '跑完全程' : tr.status === 'lost' ? '失控判停' : '达到步数上限';
  const header = [
    't(s)',
    'x(m)',
    'y(m)',
    'theta(rad)',
    'v_L(m/s)',
    'v_R(m/s)',
    'Err',
    ...tr.sensorU.map((s) => `${s.name}_U(Vpp)`),
  ];
  const lines: string[] = [
    `# 循迹闭环轨迹导出`,
    `# 赛道=${ctx.trackName} 电流=${ctx.currentMa}mA 数据源=${ctx.sourceName} 赛道总长=${(ctx.trackLengthM * 1000).toFixed(1)}mm`,
    `# 结果=${statusText} 步数=${tr.steps} 用时=${tr.timeS.toFixed(2)}s 行驶弧长=${(tr.distM * 1000).toFixed(0)}mm`,
    `# 公式=${tp.formula}`,
    `# A=${tp.A} B=${tp.B} C=${tp.C} P=${tp.P} Kp=${tp.kp} Kd=${tp.kd} v_base=${tp.vBase}m/s v_max=${tp.vMax}m/s w=${tp.w} W=${(tp.wheelBase * 1000).toFixed(0)}mm dt=${tp.dtMs}ms 初始e=${tp.initEMm}mm 初始psi=${tp.initPsiDeg}deg`,
    `# 导出时间=${new Date().toISOString()}`,
    header.join(','),
  ];
  for (let i = 0; i < tr.steps; i++) {
    lines.push(
      `${tr.t[i].toFixed(3)},${tr.x[i].toFixed(4)},${tr.y[i].toFixed(4)},` +
        `${tr.theta[i].toFixed(5)},${tr.vL[i].toFixed(4)},${tr.vR[i].toFixed(4)},` +
        `${tr.err[i].toFixed(5)},` +
        tr.sensorU.map((s) => s.values[i].toFixed(4)).join(','),
    );
  }
  downloadText(lines.join('\n'), `tracking-trajectory-${Date.now()}.csv`);
}

/** 导出画布 PNG */
export function exportCanvasPNG(canvas: HTMLCanvasElement) {
  canvas.toBlob((blob) => {
    if (blob) downloadBlob(blob, `field-view-${Date.now()}.png`);
  }, 'image/png');
}

// ---------------------------------------------------------------- 赛道库

const LIB_KEY = 'em-field-studio/track-library';

export interface SavedTrack {
  name: string;
  def: TrackDef;
  savedAt: string;
}

export function loadLibrary(): SavedTrack[] {
  try {
    const raw = localStorage.getItem(LIB_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function saveLibrary(tracks: SavedTrack[]) {
  localStorage.setItem(LIB_KEY, JSON.stringify(tracks));
}

/** 赛道导出 / 导入 JSON 文件（与电感布局风格一致） */
export function exportTrackJSON(def: TrackDef) {
  const blob = new Blob([JSON.stringify(def, null, 2)], { type: 'application/json' });
  downloadBlob(blob, `track-${def.name || 'unnamed'}.json`);
}

export function parseTrackJSON(text: string): TrackDef {
  const obj = JSON.parse(text) as TrackDef;
  if (!obj || !Array.isArray(obj.segments)) throw new Error('赛道 JSON 格式错误：缺少 segments');
  for (const s of obj.segments) {
    if (s.kind !== 'line' && s.kind !== 'arc') throw new Error('未知段类型');
  }
  return {
    name: String(obj.name ?? '导入赛道'),
    segments: obj.segments,
    extraWires: Array.isArray(obj.extraWires) ? obj.extraWires : undefined,
    ...(obj.closed === true ? { closed: true } : {}), // 闭环标志（数学模型.md §4）
  };
}
