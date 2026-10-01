/**
 * 应用工作状态持久化（localStorage）。
 *
 * - key：`em-field-studio/app-state`，与赛道库 `em-field-studio/track-library` 相互独立；
 * - 带 schema 版本号：版本不匹配 / JSON 损坏 / 结构非法时 loadAppState 返回 null，
 *   调用方回退默认值，绝不崩溃；
 * - 覆盖范围：赛道、电感布局、车体位姿、物理参数、显示开关、视图（缩放/平移）、
 *   读数面板（k、数据源）、铺设工具状态。
 *
 * localStorage 仅在函数内部惰性访问，模块可在 Node（无 localStorage）下被 import 单测。
 */
import type { EditMode, GlobalParams, LayMode, ArcPending } from '../components/TrackEditor';
import type { FieldComponent } from '../components/FieldCanvas';
import type { PoseState } from '../components/SensorPanel';
import type { SensorDef, AxisPreset } from '../mathmodel/sensor';
import type { SegDef, TrackDef } from '../mathmodel/track';
import type { SourceKind } from '../sensors/sources';
import type { ChannelFit, MeasuredState } from '../mathmodel/measured';
import { DEFAULT_TRACKING, type TrackingParams } from '../mathmodel/control';

export const APP_STATE_KEY = 'em-field-studio/app-state';
/**
 * schema 版本号：
 * v4 = 循迹参数 tracking；v5 = 赛道闭环标志 closed、位姿来源 poseSource、
 * 轨迹进度 trajT、左侧栏收起 leftCollapsed（2026-08-02）；
 * v6 = 折线图浮动状态 floatingCharts、循迹滑块自定义量程 trackingRanges（2026-08-03）。
 * 2026-08-12：tracking 内增补 motorTauMs（电机一阶滞后时间常数）——
 * 依赖 sanitizeTracking 逐字段回退默认值，旧 v6 存档可无损加载，故未升版本号。
 * 2026-10-01：增补 wasmController（Phase 13 WASM 控制器来源文件名，字节不持久化）——
 * 同 motorTauMs 先例逐字段回退 null，未升版本号。
 */
export const APP_STATE_VERSION = 6;

/** 车体位姿来源（程序设计说明.md §4.4）：手动 s/e/ψ 滑块 / 跟随循迹仿真轨迹 */
export type PoseSource = 'manual' | 'trajectory';

/** 单张折线图的浮动状态（程序设计说明.md §3.5）：是否浮出 + 浮动窗位置尺寸（中央画布坐标 px） */
export interface FloatingChartState {
  floating: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
}
/** 各浮动图表状态表（key = 图表 id，v6 新增） */
export type FloatingChartsMap = Record<string, FloatingChartState>;
/** 循迹滑块自定义量程表（key = 参数 id，v6 新增，程序设计说明.md §4.2） */
export type TrackingRangesMap = Record<string, { min: number; max: number }>;

/** 画布视图（缩放/平移），与 FieldCanvas.ViewState 同构 */
export interface AppViewState {
  cx: number;
  cy: number;
  scale: number;
}

/** 持久化的完整工作状态 */
export interface AppState {
  version: number;
  savedAt: string;
  trackDef: TrackDef;
  params: GlobalParams;
  sensors: SensorDef[];
  pose: PoseState;
  /** 标定锚点 Vpp（V）：20kHz/100mA 下电感垂直贴线输出（5–7V），k 由此反推 */
  vppAnchor: number;
  sourceKind: SourceKind;
  /** 实测数据标定状态（数据集 + 每通道方案A 拟合结果），未导入为 null */
  measured: MeasuredState | null;
  editMode: EditMode;
  layMode: LayMode;
  placing: boolean;
  showSegLengths: boolean;
  arcPending: ArcPending;
  view: AppViewState | null;
  /** 循迹闭环参数（误差公式文本、A/B/C/P、Kp/Kd、v_base/v_max、w、W、dt、初始扰动、失控阈值） */
  tracking: TrackingParams;
  /** 车体位姿来源（v5 新增，程序设计说明.md §4.4） */
  poseSource: PoseSource;
  /** 跟随仿真轨迹时的轨迹时间进度（s，v5 新增） */
  trajT: number;
  /** 左侧栏收起状态（v5 新增，程序设计说明.md §3.1） */
  leftCollapsed: boolean;
  /** 折线图浮动状态表（v6 新增，程序设计说明.md §3.5） */
  floatingCharts: FloatingChartsMap;
  /** 循迹滑块自定义量程表（v6 新增，程序设计说明.md §4.2） */
  trackingRanges: TrackingRangesMap;
  /** WASM 控制器来源（Phase 13）：只记文件名作重启提示，wasm 字节不持久化 */
  wasmController: WasmControllerState;
}

/** WASM 控制器来源持久化（Phase 13 FR-11）：fileName = 上次上传的 wasm 文件名 */
export interface WasmControllerState {
  fileName: string | null;
}

// ---------------- 校验辅助 ----------------

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isStr = (v: unknown): v is string => typeof v === 'string';
const numOr = (v: unknown, def: number): number => (isNum(v) ? v : def);
const boolOr = (v: unknown, def: boolean): boolean => (isBool(v) ? v : def);

function oneOf<T extends string>(v: unknown, allowed: readonly T[], def: T): T {
  return allowed.includes(v as T) ? (v as T) : def;
}

function sanitizeSegDef(v: unknown): SegDef | null {
  if (!isObj(v)) return null;
  if (v.kind === 'line') {
    const length = v.length;
    if (!isNum(length) || length <= 0) return null;
    const seg: SegDef = { kind: 'line', length };
    if (isNum(v.absAngle)) seg.absAngle = v.absAngle;
    if (isNum(v.exitAngle)) seg.exitAngle = v.exitAngle;
    return seg;
  }
  if (v.kind === 'arc') {
    const { radius, angleDeg, turn } = v as Record<string, unknown>;
    if (
      isNum(radius) &&
      radius > 0 &&
      isNum(angleDeg) &&
      (turn === 'left' || turn === 'right')
    ) {
      return { kind: 'arc', radius, angleDeg, turn };
    }
    return null;
  }
  return null;
}

function sanitizeTrackDef(v: unknown): TrackDef | null {
  if (!isObj(v) || !Array.isArray(v.segments)) return null;
  const segments: SegDef[] = [];
  for (const s of v.segments) {
    const seg = sanitizeSegDef(s);
    if (!seg) return null;
    segments.push(seg);
  }
  let extraWires: [number, number][][] | undefined;
  if (Array.isArray(v.extraWires)) {
    extraWires = [];
    for (const w of v.extraWires) {
      if (!Array.isArray(w)) return null;
      const wire: [number, number][] = [];
      for (const p of w) {
        if (!Array.isArray(p) || p.length !== 2 || !isNum(p[0]) || !isNum(p[1])) return null;
        wire.push([p[0], p[1]]);
      }
      extraWires.push(wire);
    }
  }
  return {
    name: isStr(v.name) ? v.name : '我的赛道',
    segments,
    ...(extraWires ? { extraWires } : {}),
    ...(v.closed === true ? { closed: true } : {}), // 闭环标志（v5）
  };
}

function sanitizeSensor(v: unknown, i: number): SensorDef | null {
  if (!isObj(v)) return null;
  if (!isNum(v.x) || !isNum(v.y) || !isNum(v.h)) return null;
  const axisPreset = oneOf<AxisPreset>(v.axisPreset, ['z', 'x', 'y', 'custom'], 'z');
  let axis: [number, number, number] = [0, 0, 1];
  if (Array.isArray(v.axis) && v.axis.length === 3 && v.axis.every(isNum)) {
    axis = [v.axis[0], v.axis[1], v.axis[2]];
  }
  return {
    id: isStr(v.id) ? v.id : `s${i}`,
    name: isStr(v.name) ? v.name : `S${i + 1}`,
    x: v.x,
    y: v.y,
    h: Math.max(0.001, v.h),
    axisPreset,
    axis,
  };
}

function sanitizeParams(v: unknown): GlobalParams | null {
  if (!isObj(v)) return null;
  return {
    currentMa: numOr(v.currentMa, 100),
    heightMm: numOr(v.heightMm, 70),
    gridStepMm: numOr(v.gridStepMm, 10),
    component: oneOf<FieldComponent>(v.component, ['bz', 'bx', 'bmag'], 'bz'),
    logScale: boolOr(v.logScale, true),
  };
}

function sanitizeView(v: unknown): AppViewState | null {
  if (v === null || v === undefined) return null;
  if (!isObj(v) || !isNum(v.cx) || !isNum(v.cy) || !isNum(v.scale) || v.scale <= 0) return null;
  return { cx: v.cx, cy: v.cy, scale: v.scale };
}

/** 循迹闭环参数校验：逐字段回退默认值，绝不崩溃 */
function sanitizeTracking(v: unknown): TrackingParams {
  const t = isObj(v) ? v : {};
  const D = DEFAULT_TRACKING;
  return {
    enabled: boolOr(t.enabled, D.enabled),
    formula: isStr(t.formula) && t.formula.trim() ? t.formula : D.formula,
    A: numOr(t.A, D.A),
    B: numOr(t.B, D.B),
    C: numOr(t.C, D.C),
    P: numOr(t.P, D.P),
    kp: numOr(t.kp, D.kp),
    kd: numOr(t.kd, D.kd),
    vBase: numOr(t.vBase, D.vBase),
    vMax: Math.max(0.1, numOr(t.vMax, D.vMax)),
    w: Math.max(0.01, numOr(t.w, D.w)),
    wheelBase: Math.max(0.01, numOr(t.wheelBase, D.wheelBase)),
    dtMs: Math.min(50, Math.max(0.5, numOr(t.dtMs, D.dtMs))),
    motorTauMs: Math.min(500, Math.max(0, numOr(t.motorTauMs, D.motorTauMs))),
    initEMm: numOr(t.initEMm, D.initEMm),
    initPsiDeg: numOr(t.initPsiDeg, D.initPsiDeg),
    errLimit: Math.max(0.01, numOr(t.errLimit, D.errLimit)),
    errLimitSteps: Math.max(1, Math.round(numOr(t.errLimitSteps, D.errLimitSteps))),
  };
}

/** 浮动图表状态表校验（v6）：逐条校验，非法条目丢弃（非关键字段） */
function sanitizeFloatingCharts(v: unknown): FloatingChartsMap {
  const out: FloatingChartsMap = {};
  if (!isObj(v)) return out;
  for (const [k, s] of Object.entries(v)) {
    if (!isObj(s)) continue;
    if (!isBool(s.floating) || !isNum(s.x) || !isNum(s.y) || !isNum(s.w) || !isNum(s.h)) continue;
    out[k] = {
      floating: s.floating,
      x: Math.max(0, s.x),
      y: Math.max(0, s.y),
      w: Math.max(240, s.w),
      h: Math.max(160, s.h),
    };
  }
  return out;
}

/** 循迹滑块自定义量程表校验（v6）：要求 min < max，非法条目丢弃 */
function sanitizeTrackingRanges(v: unknown): TrackingRangesMap {
  const out: TrackingRangesMap = {};
  if (!isObj(v)) return out;
  for (const [k, r] of Object.entries(v)) {
    if (!isObj(r) || !isNum(r.min) || !isNum(r.max) || r.min >= r.max) continue;
    out[k] = { min: r.min, max: r.max };
  }
  return out;
}

/** WASM 控制器来源校验（Phase 13）：缺失/非法逐字段回退 null，不升版本 */
function sanitizeWasmController(v: unknown): WasmControllerState {
  const o = isObj(v) ? v : {};
  return { fileName: isStr(o.fileName) && o.fileName ? o.fileName : null };
}

/** 单通道方案A 拟合结果校验（非法返回 null） */
function sanitizeChannelFit(v: unknown): ChannelFit | null {
  if (!isObj(v)) return null;
  if (!isNum(v.k) || !isNum(v.hEffMm) || !isNum(v.e0Mm) || !isNum(v.rmse) || !isNum(v.r2))
    return null;
  if (v.hEffMm <= 0) return null;
  return { k: v.k, hEffMm: v.hEffMm, e0Mm: v.e0Mm, rmse: v.rmse, r2: v.r2 };
}

/** 实测数据标定状态校验：结构非法时整体回退 null，绝不崩溃 */
function sanitizeMeasured(v: unknown): MeasuredState | null {
  if (v === null || v === undefined) return null;
  if (!isObj(v) || !isObj(v.dataset) || !isObj(v.fits)) return null;
  const d = v.dataset;
  if (!isStr(d.fileName) || !Array.isArray(d.channels) || !Array.isArray(d.points)) return null;
  const channels: string[] = [];
  for (const c of d.channels) {
    if (!isStr(c)) return null;
    channels.push(c);
  }
  const points: MeasuredState['dataset']['points'] = [];
  for (const p of d.points) {
    if (!isObj(p) || !isNum(p.eMm) || !isObj(p.values)) return null;
    const values: Record<string, number> = {};
    for (const [k2, val] of Object.entries(p.values)) {
      if (!isNum(val)) return null;
      values[k2] = val;
    }
    points.push({ eMm: p.eMm, values });
  }
  if (points.length < 3) return null;
  points.sort((a, b) => a.eMm - b.eMm);
  const fits: Record<string, ChannelFit> = {};
  for (const [name, f] of Object.entries(v.fits)) {
    const fit = sanitizeChannelFit(f);
    if (fit) fits[name] = fit; // 单通道拟合非法只丢该通道
  }
  return {
    dataset: {
      fileName: d.fileName,
      channels,
      points,
      ...(isStr(d.eUnitNote) ? { eUnitNote: d.eUnitNote } : {}),
    },
    fits,
  };
}

// ---------------- 对外 API ----------------

/**
 * 读取并校验持久化状态。版本不匹配 / JSON 损坏 / 关键结构非法时返回 null。
 * 非关键字段（数值、布尔、枚举）非法时回退该字段默认值而不是整体失败。
 */
export function loadAppState(): AppState | null {
  try {
    const raw = localStorage.getItem(APP_STATE_KEY);
    if (!raw) return null;
    const v: unknown = JSON.parse(raw);
    if (!isObj(v) || v.version !== APP_STATE_VERSION) return null;

    const trackDef = sanitizeTrackDef(v.trackDef);
    const params = sanitizeParams(v.params);
    if (!trackDef || !params || !Array.isArray(v.sensors)) return null;
    const sensors: SensorDef[] = [];
    for (let i = 0; i < v.sensors.length; i++) {
      const s = sanitizeSensor(v.sensors[i], i);
      if (!s) return null;
      sensors.push(s);
    }
    const poseRaw = isObj(v.pose) ? v.pose : {};
    const arcRaw = isObj(v.arcPending) ? v.arcPending : {};

    return {
      version: APP_STATE_VERSION,
      savedAt: isStr(v.savedAt) ? v.savedAt : '',
      trackDef,
      params,
      sensors,
      pose: {
        sMm: numOr(poseRaw.sMm, 0),
        eMm: numOr(poseRaw.eMm, 0),
        psiDeg: numOr(poseRaw.psiDeg, 0),
      },
      vppAnchor: isNum(v.vppAnchor) && v.vppAnchor > 0 && v.vppAnchor <= 20 ? v.vppAnchor : 6,
      sourceKind: oneOf<SourceKind>(
        v.sourceKind,
        ['simulation', 'serial', 'file', 'measured-fit', 'measured-phys'],
        'simulation',
      ),
      measured: sanitizeMeasured(v.measured),
      editMode: oneOf<EditMode>(v.editMode, ['lay', 'list'], 'lay'),
      layMode: oneOf<LayMode>(v.layMode, ['line', 'arc'], 'line'),
      placing: boolOr(v.placing, true),
      showSegLengths: boolOr(v.showSegLengths, false),
      arcPending: {
        radiusMm: numOr(arcRaw.radiusMm, 500),
        angleDeg: numOr(arcRaw.angleDeg, 90),
        turn: oneOf(arcRaw.turn, ['left', 'right'] as const, 'right'),
      },
      view: sanitizeView(v.view),
      tracking: sanitizeTracking(v.tracking),
      poseSource: oneOf<PoseSource>(v.poseSource, ['manual', 'trajectory'], 'manual'),
      trajT: Math.max(0, numOr(v.trajT, 0)),
      leftCollapsed: boolOr(v.leftCollapsed, false),
      floatingCharts: sanitizeFloatingCharts(v.floatingCharts),
      trackingRanges: sanitizeTrackingRanges(v.trackingRanges),
      wasmController: sanitizeWasmController(v.wasmController),
    };
  } catch {
    return null; // JSON 损坏 / localStorage 不可用等，一律回退默认
  }
}

/** 写入持久化状态（调用方负责防抖）。写入失败（配额/隐私模式）静默忽略。 */
export function saveAppState(state: AppState): void {
  try {
    localStorage.setItem(APP_STATE_KEY, JSON.stringify(state));
  } catch {
    /* 忽略写入失败 */
  }
}

/** 清除持久化状态（"恢复默认设置"），不影响赛道库等其他 key。 */
export function clearAppState(): void {
  try {
    localStorage.removeItem(APP_STATE_KEY);
  } catch {
    /* 忽略 */
  }
}
