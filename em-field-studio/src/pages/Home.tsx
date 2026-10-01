/**
 * 智能车电磁赛道磁场建模工具 —— 主页面。
 * 布局：左侧参数面板（赛道编辑 + 物理参数）｜ 中央大画布 ｜ 右侧电感面板。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from 'lucide-react';
import { usePanelRef, type Layout } from 'react-resizable-panels';
import { Button } from '@/components/ui/button';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import FieldCanvas, { trackBBox } from '../components/FieldCanvas';
import SensorPanel, { type PoseState } from '../components/SensorPanel';
import TrackEditor, {
  type ArcPending,
  type EditMode,
  type GlobalParams,
  type LayMode,
} from '../components/TrackEditor';
import { Simulator } from '../mathmodel/sim/simulator';
import { FormulaController } from '../mathmodel/sim/controller';
import { WasmController } from '../mathmodel/sim/wasmController';
import { createSensorSampler, createSensorSamplerDetailed } from '../mathmodel/sim/vehicle';
import { autoTuneGrid, buildSegSpans } from '../mathmodel/sim/autotune';
import type { CarPose, SensorDef, SensorReading } from '../mathmodel/sensor';
import {
  axisVector,
  defaultLayout,
  poseFrame,
  sensorAxisWorld,
  sensorWorld,
  kFromAnchor,
  VPP_ANCHOR_DEFAULT,
} from '../mathmodel/sensor';
import {
  DEFAULT_TRACKING,
  DEFAULT_FORMULA,
  compileFormula,
  type TrackingParams,
} from '../mathmodel/control';
import { type TrackingResult } from '../mathmodel/kinematics';
import {
  buildElements,
  buildFieldElements,
  canCloseTrack,
  closureGapM,
  cornerRulers,
  hexagonSegs,
  lineSegTo,
  nearestOnPath,
  pointAtLength,
  previewSegment,
  rightAngleSeg,
  samplePath,
  segmentSummaries,
  trackTip,
  type SegDef,
  type TrackDef,
} from '../mathmodel/track';
import { useFieldGrid } from '../hooks/useFieldGrid';
import { sweepAlongTrack, sweepMeasuredAlongTrack, type SweepResult } from '../mathmodel/sweep';
import type { SourceKind } from '../sensors/sources';
import {
  evalMeasured,
  fitChannelModel,
  parseMeasuredCSV,
  signedLateralDistance,
  type MeasuredModelKind,
  type MeasuredState,
} from '../mathmodel/measured';
import {
  APP_STATE_VERSION,
  clearAppState,
  loadAppState,
  saveAppState,
  type AppViewState,
  type FloatingChartsMap,
  type FloatingChartState,
  type PoseSource,
  type TrackingRangesMap,
} from '../utils/appState';
import {
  exportCanvasPNG,
  exportGridCSV,
  exportReadingsCSV,
  exportSweepCSV,
  exportTrackJSON,
  exportTrackingCSV,
  loadLibrary,
  parseTrackJSON,
  saveLibrary,
  type SavedTrack,
} from '../utils/exporters';
import TrackingPanel from '../components/TrackingPanel';
import {
  FloatingLayerContext,
  FloatingLayerHost,
  useFloatingZOrder,
} from '../components/FloatingChart';

/** 程序版本号（与 package.json 同步；打包 exe 文件名含此版本） */
export const APP_VERSION = '0.1.0';

/**
 * 左右面板宽度布局持久化（程序设计说明.md §3.8，2026-08-15 起面板可拖拽调宽）：
 * react-resizable-panels 的 Layout（panel id → flexGrow），独立 localStorage key，
 * 与 appState 解耦——布局损坏只影响面板宽度，不丢工作状态。
 */
const PANEL_LAYOUT_KEY = 'em-field-studio/panel-layout';

function loadPanelLayout(): Layout | null {
  try {
    const raw = localStorage.getItem(PANEL_LAYOUT_KEY);
    if (!raw) return null;
    const v: unknown = JSON.parse(raw);
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
    const out: Layout = {};
    for (const [k, n] of Object.entries(v)) {
      if (typeof n === 'number' && Number.isFinite(n) && n > 0) out[k] = n;
    }
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    return null;
  }
}

function savePanelLayout(layout: Layout): void {
  try {
    localStorage.setItem(PANEL_LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    /* 忽略写入失败 */
  }
}

function arcPendingToSeg(p: ArcPending): SegDef {
  return {
    kind: 'arc',
    radius: Math.max(0.01, Math.round(p.radiusMm / 10) / 100),
    angleDeg: p.angleDeg,
    turn: p.turn,
  };
}

/** 角度归一化到 (−π, π]（最短弧，数学模型.md §6.4 朝向修复用） */
function wrapAngle(a: number): number {
  let r = a % (2 * Math.PI);
  if (r > Math.PI) r -= 2 * Math.PI;
  if (r <= -Math.PI) r += 2 * Math.PI;
  return r;
}

export default function Home() {
  // 启动时恢复上次工作状态（版本/结构非法时 loadAppState 返回 null -> 全默认）
  const [restored] = useState(() => loadAppState());
  const [trackDef, setTrackDef] = useState<TrackDef>(
    restored?.trackDef ?? { name: '我的赛道', segments: [] },
  );
  const [params, setParams] = useState<GlobalParams>(
    restored?.params ?? {
      currentMa: 100,
      heightMm: 70,
      gridStepMm: 10,
      component: 'bz',
      logScale: true,
    },
  );
  const [sensors, setSensors] = useState<SensorDef[]>(restored?.sensors ?? defaultLayout());
  const [poseState, setPoseState] = useState<PoseState>(
    restored?.pose ?? { sMm: 0, eMm: 0, psiDeg: 0 },
  );
  const [vppAnchor, setVppAnchor] = useState(restored?.vppAnchor ?? VPP_ANCHOR_DEFAULT);
  const [sourceKind, setSourceKind] = useState<SourceKind>(restored?.sourceKind ?? 'simulation');
  // 实测数据标定状态（数据集 + 每通道方案A 拟合结果），未导入为 null
  const [measured, setMeasured] = useState<MeasuredState | null>(restored?.measured ?? null);
  // 循迹闭环参数（公式文本/A/B/C/P/Kp/Kd/轮速/轮距/dt/初始扰动）
  const [tracking, setTracking] = useState<TrackingParams>(restored?.tracking ?? DEFAULT_TRACKING);
  // 位姿来源（程序设计说明.md §4.4）：手动位姿 / 跟随仿真轨迹；轨迹进度（s）
  const [poseSource, setPoseSource] = useState<PoseSource>(restored?.poseSource ?? 'manual');
  const [trajT, setTrajT] = useState(restored?.trajT ?? 0);
  // 左侧栏收起状态（程序设计说明.md §3.1）
  const [leftCollapsed, setLeftCollapsed] = useState(restored?.leftCollapsed ?? false);
  // 右侧栏收起状态（2026-08-15 新增，会话内内存状态不持久化）
  const [rightCollapsed, setRightCollapsed] = useState(false);
  // 面板宽度布局（可拖拽调宽，localStorage 持久化，仅首次挂载读取）
  const [savedPanelLayout] = useState<Layout | null>(() => loadPanelLayout());
  const leftPanelRef = usePanelRef();
  const rightPanelRef = usePanelRef();
  const layoutSaveTimer = useRef<number | null>(null);
  // 面板尺寸变化 -> 防抖 300ms 保存布局
  const handlePanelLayoutChange = useCallback((layout: Layout) => {
    if (layoutSaveTimer.current !== null) window.clearTimeout(layoutSaveTimer.current);
    layoutSaveTimer.current = window.setTimeout(() => savePanelLayout(layout), 300);
  }, []);
  // 收起/展开按钮 -> 面板 imperative API；拖到最小宽度以下自动收起时由 onResize 回同步状态
  useEffect(() => {
    const p = leftPanelRef.current;
    if (!p) return;
    if (leftCollapsed && !p.isCollapsed()) p.collapse();
    else if (!leftCollapsed && p.isCollapsed()) p.expand();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leftCollapsed]);
  useEffect(() => {
    const p = rightPanelRef.current;
    if (!p) return;
    if (rightCollapsed && !p.isCollapsed()) p.collapse();
    else if (!rightCollapsed && p.isCollapsed()) p.expand();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rightCollapsed]);
  const handleLeftPanelResize = useCallback(
    (size: { asPercentage: number; inPixels: number }) => {
      const c = size.inPixels <= 40;
      setLeftCollapsed((prev) => (prev === c ? prev : c));
    },
    [],
  );
  const handleRightPanelResize = useCallback(
    (size: { asPercentage: number; inPixels: number }) => {
      const c = size.inPixels <= 40;
      setRightCollapsed((prev) => (prev === c ? prev : c));
    },
    [],
  );
  // 折线图浮动状态（程序设计说明.md §3.5，appState v6）与循迹滑块自定义量程（程序设计说明.md §4.2，appState v6）
  const [floatingCharts, setFloatingCharts] = useState<FloatingChartsMap>(
    restored?.floatingCharts ?? {},
  );
  const [trackingRanges, setTrackingRanges] = useState<TrackingRangesMap>(
    restored?.trackingRanges ?? {},
  );
  // WASM 车载控制器（Phase 13）：控制器实例会话内持有（字节不持久化）；
  // appState 只记文件名作重启"请重新上传"提示
  const [wasmCtrl, setWasmCtrl] = useState<WasmController | null>(null);
  const [wasmFileName, setWasmFileName] = useState<string | null>(
    restored?.wasmController.fileName ?? null,
  );
  const [wasmError, setWasmError] = useState('');
  // 重算 memo 内检测到的 trap 信息（setState 移到 effect，避免渲染期副作用）
  const wasmTrapRef = useRef<string | null>(null);
  // 浮动层：portal 宿主元素 + z 序
  const [floatLayerEl, setFloatLayerEl] = useState<HTMLElement | null>(null);
  const { zOrder, bringToFront, ensure } = useFloatingZOrder();
  const setFloatingChart = useCallback(
    (id: string, patch: Partial<FloatingChartState>) => {
      setFloatingCharts((m) => {
        const cur: FloatingChartState = m[id] ?? { floating: false, x: 0, y: 0, w: 420, h: 280 };
        return { ...m, [id]: { ...cur, ...patch } };
      });
      if (patch.floating) ensure(id);
    },
    [ensure],
  );
  const floatingCtx = useMemo(
    () => ({
      layerEl: floatLayerEl,
      states: floatingCharts,
      setChart: setFloatingChart,
      zOrder,
      bringToFront,
    }),
    [floatLayerEl, floatingCharts, setFloatingChart, zOrder, bringToFront],
  );
  const handleRangeChange = useCallback((id: string, r: { min: number; max: number } | null) => {
    setTrackingRanges((m) => {
      const next = { ...m };
      if (r) next[id] = r;
      else delete next[id];
      return next;
    });
  }, []);
  // 铺设状态
  const [editMode, setEditMode] = useState<EditMode>(restored?.editMode ?? 'lay');
  const [layMode, setLayMode] = useState<LayMode>(restored?.layMode ?? 'line');
  const [placing, setPlacing] = useState(restored?.placing ?? true);
  const [showSegLengths, setShowSegLengths] = useState(restored?.showSegLengths ?? false);
  const [arcPending, setArcPending] = useState<ArcPending>(
    restored?.arcPending ?? {
      radiusMm: 500,
      angleDeg: 90,
      turn: 'right',
    },
  );
  // 画布视图（缩放/平移），挂载时传给 FieldCanvas 恢复
  const [view, setView] = useState<AppViewState | null>(restored?.view ?? null);
  // "恢复默认设置"时 +1，强制 FieldCanvas 重挂载（回到自动 fit）
  const [resetCounter, setResetCounter] = useState(0);
  const [library, setLibrary] = useState<SavedTrack[]>(() => loadLibrary());
  const [exportMsg, setExportMsg] = useState('');
  const canvasElRef = useRef<HTMLCanvasElement | null>(null);

  const handleViewChange = useCallback((v: AppViewState) => setView(v), []);

  // 任何工作状态变化 -> 防抖 300ms 自动持久化（赛道库另有独立 key，不在此处）
  useEffect(() => {
    const t = window.setTimeout(() => {
      saveAppState({
        version: APP_STATE_VERSION,
        savedAt: new Date().toISOString(),
        trackDef,
        params,
        sensors,
        pose: poseState,
        vppAnchor,
        sourceKind,
        measured,
        editMode,
        layMode,
        placing,
        showSegLengths,
        arcPending,
        view,
        tracking,
        poseSource,
        trajT,
        leftCollapsed,
        floatingCharts,
        trackingRanges,
        wasmController: { fileName: wasmFileName },
      });
    }, 300);
    return () => window.clearTimeout(t);
  }, [
    trackDef,
    params,
    sensors,
    poseState,
    vppAnchor,
    sourceKind,
    measured,
    editMode,
    layMode,
    placing,
    showSegLengths,
    arcPending,
    view,
    tracking,
    poseSource,
    trajT,
    leftCollapsed,
    floatingCharts,
    trackingRanges,
    wasmFileName,
  ]);

  // 恢复默认设置：仅清除工作状态 key，赛道库保持不变
  const resetDefaults = useCallback(() => {
    if (!window.confirm('恢复默认设置？\n将重置当前赛道、电感布局、位姿与全部参数（赛道库不受影响）。'))
      return;
    clearAppState();
    setTrackDef({ name: '我的赛道', segments: [] });
    setParams({ currentMa: 100, heightMm: 70, gridStepMm: 10, component: 'bz', logScale: true });
    setSensors(defaultLayout());
    setPoseState({ sMm: 0, eMm: 0, psiDeg: 0 });
    setVppAnchor(VPP_ANCHOR_DEFAULT);
    setSourceKind('simulation');
    setMeasured(null); // 实测标定数据一并清空
    setEditMode('lay');
    setLayMode('line');
    setPlacing(true);
    setShowSegLengths(false);
    setArcPending({ radiusMm: 500, angleDeg: 90, turn: 'right' });
    setTracking(DEFAULT_TRACKING);
    setPoseSource('manual');
    setTrajT(0);
    setLeftCollapsed(false);
    setFloatingCharts({});
    setTrackingRanges({});
    setWasmCtrl(null);
    setWasmFileName(null);
    setWasmError('');
    setView(null);
    setResetCounter((c) => c + 1); // 重挂载画布 -> 回到自动 fit
    flash('已恢复默认设置');
  }, []);

  // 赛道离散化（<=1cm 小段，渲染/采样/段数展示用）
  const elements = useMemo(() => buildElements(trackDef), [trackDef]);
  // 场计算模型：直线段走闭式积分（精确），仅圆弧段离散（<=1cm）
  const fieldElements = useMemo(() => buildFieldElements(trackDef), [trackDef]);
  const path = useMemo(() => samplePath(trackDef), [trackDef]);

  // 网格参数：包围盒 + 边距，按步长求分辨率；硬上限 400×400=160k 单元，超出自动降档
  const GRID_CELL_CAP = 160000;
  const gridParams = useMemo(() => {
    const bb = trackBBox(path, trackDef.extraWires, 0.35);
    const w = bb.x1 - bb.x0;
    const hh = bb.y1 - bb.y0;
    let step = params.gridStepMm / 1000;
    let nx = Math.round(w / step);
    let ny = Math.round(hh / step);
    let effStepMm = params.gridStepMm;
    if (nx * ny > GRID_CELL_CAP) {
      const f = Math.sqrt((nx * ny) / GRID_CELL_CAP);
      effStepMm = Math.ceil((params.gridStepMm * f) / 5) * 5; // 向上取整到 5mm 档
      step = effStepMm / 1000;
      nx = Math.round(w / step);
      ny = Math.round(hh / step);
    }
    return {
      x0: bb.x0,
      y0: bb.y0,
      nx: Math.max(8, nx),
      ny: Math.max(8, ny),
      dx: w / Math.max(8, nx),
      dy: hh / Math.max(8, ny),
      effStepMm,
      degraded: effStepMm > params.gridStepMm,
    };
  }, [path, trackDef.extraWires, params.gridStepMm]);

  const { grid, computing, progress, runningMs, elapsedMs } = useFieldGrid(
    fieldElements,
    params.currentMa / 1000,
    params.heightMm / 1000,
    gridParams,
  );

  // 闭环赛道（数学模型.md §4）：终点距起点距离；勾选后段被改导致超阈值时自动取消闭环
  const closureGapMm = closureGapM(trackDef.segments) * 1000;
  const trackClosed = !!trackDef.closed && canCloseTrack(trackDef.segments);
  useEffect(() => {
    if (trackDef.closed && !canCloseTrack(trackDef.segments)) {
      setTrackDef((t) => {
        const rest = { ...t };
        delete rest.closed;
        return rest;
      });
    }
  }, [trackDef]);
  const handleClosedChange = useCallback((closed: boolean) => {
    setTrackDef((t) => {
      if (closed) {
        if (!canCloseTrack(t.segments)) return t; // 超阈值不可闭环
        return { ...t, closed: true };
      }
      const rest = { ...t };
      delete rest.closed;
      return rest;
    });
  }, []);

  // 手动车体位姿（沿线位置 s + 横向偏差 e + 航向角 ψ）——位姿来源为"手动位姿"时使用，
  // "跟随仿真轨迹"时在下方由循迹轨迹记录反算（程序设计说明.md §4.4）
  const manualPose: CarPose | null = useMemo(() => {
    if (path.s.length === 0) return null;
    const p = pointAtLength(path, poseState.sMm / 1000);
    return {
      px: p.x,
      py: p.y,
      tx: p.tx,
      ty: p.ty,
      e: poseState.eMm / 1000,
      psi: (poseState.psiDeg * Math.PI) / 180,
    };
  }, [path, poseState]);

  // 标定系数 k（V/T）：由贴线 Vpp 锚点反推，电流变化时 k 不变、读数随 B 线性缩放
  const kCal = useMemo(() => kFromAnchor(vppAnchor), [vppAnchor]);

  // （电感实时读数在循迹仿真之后计算——"跟随仿真轨迹"位姿来源依赖循迹结果，见下方）

  // ---------------- 全程扫描 U(s) ----------------
  // 扫描依赖（赛道/e/ψ/电感布局/电流/标定）变化时防抖 250ms 重算；拖 s 滑块不触发
  const [sweepTick, setSweepTick] = useState(0);
  const sweepDepsRef = useRef({ path, elements: fieldElements, sensors, currentMa: params.currentMa, eMm: poseState.eMm, psiDeg: poseState.psiDeg, k: kCal, sourceKind, measured });
  sweepDepsRef.current = { path, elements: fieldElements, sensors, currentMa: params.currentMa, eMm: poseState.eMm, psiDeg: poseState.psiDeg, k: kCal, sourceKind, measured };
  useEffect(() => {
    const t = window.setTimeout(() => setSweepTick((c) => c + 1), 250);
    return () => window.clearTimeout(t);
  }, [path, fieldElements, sensors, params.currentMa, poseState.eMm, poseState.psiDeg, kCal, sourceKind, measured]);

  const sweep: SweepResult | null = useMemo(() => {
    const d = sweepDepsRef.current;
    if (d.path.s.length === 0 || d.sensors.length === 0) return null;
    if (d.sourceKind === 'simulation') {
      return sweepAlongTrack(
        d.path,
        d.elements,
        d.sensors,
        d.currentMa / 1000,
        d.eMm / 1000,
        (d.psiDeg * Math.PI) / 180,
        d.k,
      );
    }
    // 实测模型扫描：通道无数据时回退仿真值（名称加 * 标注）
    if (
      (d.sourceKind === 'measured-fit' || d.sourceKind === 'measured-phys') &&
      d.measured
    ) {
      const m = d.measured;
      const modelKind: MeasuredModelKind = d.sourceKind === 'measured-fit' ? 'fit' : 'phys';
      const I = d.currentMa / 1000;
      return sweepMeasuredAlongTrack(
        d.path,
        d.sensors,
        d.eMm / 1000,
        (d.psiDeg * Math.PI) / 180,
        (sensor, dMm) =>
          evalMeasured(m.dataset, m.fits, modelKind, sensor.name, sensor.axisPreset, dMm, {
            hM: sensor.h,
            axis: axisVector(sensor),
            I,
            k: d.k,
          }),
        10,
        { elements: d.elements, I, k: d.k },
      );
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sweepTick]);

  // ---------------- 循迹闭环仿真（数学模型.md §8） ----------------
  // 公式编译：表达式非法 / 引用未知变量（非电感名、非 A/B/C/P）时回退默认 C4 式并给出提示
  const { trackFormula, formulaError } = useMemo(() => {
    try {
      const f = compileFormula(tracking.formula);
      const valid = new Set([...sensors.map((s) => s.name), 'A', 'B', 'C', 'P']);
      const unknown = f.variables.filter((v) => !valid.has(v));
      if (unknown.length > 0) {
        return {
          trackFormula: compileFormula(DEFAULT_FORMULA),
          formulaError: `未知变量：${unknown.join('、')}（可用 = 电感名 + A/B/C/P），已回退默认公式`,
        };
      }
      return { trackFormula: f, formulaError: '' };
    } catch (err) {
      return {
        trackFormula: compileFormula(DEFAULT_FORMULA),
        formulaError: `公式非法：${err instanceof Error ? err.message : String(err)}，已回退默认公式`,
      };
    }
  }, [tracking.formula, sensors]);

  // 循迹读数注入：仿真源用 k·|B·n̂|；实测源换算横向距离 d 求值（无数据回退仿真）
  // 任一参数（含公式本身）修改后防抖 ~200ms 重算，轨迹同步刷新
  const [trackingTick, setTrackingTick] = useState(0);
  const trackingDepsRef = useRef({
    path,
    elements: fieldElements,
    sensors,
    currentMa: params.currentMa,
    k: kCal,
    sourceKind,
    measured,
    tracking,
    formula: trackFormula,
  });
  trackingDepsRef.current = {
    path,
    elements: fieldElements,
    sensors,
    currentMa: params.currentMa,
    k: kCal,
    sourceKind,
    measured,
    tracking,
    formula: trackFormula,
  };
  useEffect(() => {
    const t = window.setTimeout(() => setTrackingTick((c) => c + 1), 200);
    return () => window.clearTimeout(t);
  }, [path, fieldElements, sensors, params.currentMa, kCal, sourceKind, measured, tracking, trackFormula]);

  // ---------------- WASM 车载控制器（Phase 13）：上传 / 热替换 / 回退内置 ----------------
  const handleWasmUpload = useCallback(
    async (file: File) => {
      try {
        const bytes = await file.arrayBuffer();
        const ctrl = await WasmController.create(bytes, {
          fileName: file.name,
          sensorNames: sensors.map((s) => s.name),
          vMax: tracking.vMax,
        });
        setWasmCtrl(ctrl);
        setWasmFileName(file.name);
        setWasmError('');
      } catch (e) {
        // FR-7：加载失败（无效字节/导入缺失/ABI 不符/入口全缺/init trap）→ 回退内置控制器
        setWasmCtrl(null);
        setWasmError(`「${file.name}」加载失败，已回退内置控制器：${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [sensors, tracking.vMax],
  );
  const handleWasmClear = useCallback(() => {
    setWasmCtrl(null);
    setWasmFileName(null);
    setWasmError('');
  }, []);

  const trackingResult: TrackingResult | null = useMemo(() => {
    const d = trackingDepsRef.current;
    if (!d.tracking.enabled || d.path.s.length === 0 || d.sensors.length === 0) return null;
    const sampler = createSensorSampler({
      path: d.path,
      elements: d.elements,
      currentMa: d.currentMa,
      k: d.k,
      sourceKind: d.sourceKind,
      measured: d.measured,
    });
    const buildFormulaSim = () =>
      new Simulator({
        path: d.path,
        sensors: d.sensors,
        vehicle: {
          controller: new FormulaController(d.tracking, d.formula),
          sampler,
          params: d.tracking,
        },
        tasks: [{ periodMs: d.tracking.dtMs, entry: 'control' as const }],
        closed: trackClosed, // 闭环赛道：行驶弧长达单圈总长即完赛（数学模型.md §4/数学模型.md §8.5）
      });
    if (wasmCtrl) {
      // wasm 车载程序接管：任务周期表 1ms/2ms（存在的入口）；reset = 重新实例化全新状态
      wasmCtrl.setSensorNames(d.sensors.map((s) => s.name));
      const sim = new Simulator({
        path: d.path,
        sensors: d.sensors,
        vehicle: { controller: wasmCtrl, sampler, params: d.tracking },
        tasks: wasmCtrl.taskEntries(),
        closed: trackClosed,
      });
      sim.reset(d.tracking);
      try {
        const r = sim.runToEnd();
        wasmTrapRef.current = wasmCtrl.trapError;
        if (!wasmCtrl.trapError) return r;
      } catch {
        wasmTrapRef.current = wasmCtrl.trapError ?? 'wasm 控制器执行异常';
      }
      // FR-7：trap 后丢弃 wasm 轨迹，内置控制器重跑兜底
      return buildFormulaSim().runToEnd();
    }
    wasmTrapRef.current = null;
    return buildFormulaSim().runToEnd();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackingTick, wasmCtrl]);

  // wasm 运行时 trap → 提示回退（setState 移出渲染期 memo）
  useEffect(() => {
    if (wasmTrapRef.current) setWasmError(`wasm 运行时 trap，已回退内置控制器：${wasmTrapRef.current}`);
  }, [trackingResult]);

  // ---------------- 位姿来源（程序设计说明.md §4.4）：手动位姿 / 跟随仿真轨迹 ----------------
  const trajAvailable = tracking.enabled && trackingResult !== null && trackingResult.steps > 0;
  const trajDtS = Math.max(tracking.dtMs, 0.5) / 1000;
  // 轨迹进度上限取冲线点（闭环=一圈），未跑满取最后一步
  const trajDurationS = trajAvailable
    ? Math.max(trackingResult.finishIndex, 0) * trajDtS
    : 0;

  // 跟随轨迹位姿：轨迹绝对位姿 (x,y,θ) 反算中线参考点/横向偏差/航向角（只读展示用）
  const trajPoseInfo = useMemo(() => {
    if (!trajAvailable || !trackingResult) return null;
    const idx = Math.min(
      Math.max(Math.round(trajT / trajDtS), 0),
      trackingResult.finishIndex,
    );
    const x = trackingResult.x[idx];
    const y = trackingResult.y[idx];
    const theta = trackingResult.theta[idx];
    const np = nearestOnPath(path, x, y);
    const e = signedLateralDistance(path, x, y);
    // 数学模型.md §6.4 修复：poseFrame 约定车头角 = 切向角 − ψ（ψ>0 右偏，顺时针），
    // 故 ψ = 切向角 − θ（旧代码符号写反为 θ − 切向角，导致车头角 = 2·切向角 − θ，
    // 转弯时车框朝反方向转）；ψ 归一到 (−π,π] 最短弧（不影响 poseFrame，仅展示整洁）
    const psi = wrapAngle(Math.atan2(np.ty, np.tx) - theta);
    return {
      pose: { px: np.x, py: np.y, tx: np.tx, ty: np.ty, e, psi } satisfies CarPose,
      display: {
        sMm: np.s * 1000,
        eMm: e * 1000,
        psiDeg: (psi * 180) / Math.PI,
      } satisfies PoseState,
    };
  }, [trajAvailable, trackingResult, trajT, trajDtS, path]);

  const followTraj = poseSource === 'trajectory' && trajPoseInfo !== null;
  const carPose: CarPose | null = followTraj ? trajPoseInfo.pose : manualPose;
  const displayPose: PoseState = followTraj ? trajPoseInfo.display : poseState;

  // 电感实时读数（采样策略已收敛至 sim/vehicle.ts createSensorSamplerDetailed，与循迹/整定共用一份实现）：
  // - 仿真源：|u(t)| = k·cosθ·B = k·|B(P_i)·n̂_i|（Vpp）
  // - 实测源（方案A 拟合 / 方案B 物理公式+偏差校正）：电感世界坐标 -> 有符号横向距离 d -> 实测模型求值；
  //   通道无实测数据时回退仿真公式，name 加 * 标注（保持面板可用）
  const readings: SensorReading[] = useMemo(() => {
    if (!carPose) return [];
    const frame = poseFrame(carPose);
    if (sourceKind === 'measured-fit' || sourceKind === 'measured-phys') {
      if (!measured || path.s.length === 0) return [];
      const detail = createSensorSamplerDetailed({
        path,
        elements: fieldElements,
        currentMa: params.currentMa,
        k: kCal,
        sourceKind,
        measured,
      });
      return sensors.map((s) => {
        const w = sensorWorld(s, frame);
        const d = detail(s, w, sensorAxisWorld(s, frame));
        if (!d.fallback) return { name: s.name, value: d.value, x: w.x, y: w.y };
        return { name: `${s.name}*`, value: d.value, x: w.x, y: w.y, bx: d.bx, by: d.by, bz: d.bz };
      });
    }
    if (sourceKind !== 'simulation') return [];
    const detail = createSensorSamplerDetailed({
      path,
      elements: fieldElements,
      currentMa: params.currentMa,
      k: kCal,
      sourceKind,
      measured,
    });
    return sensors.map((s) => {
      const w = sensorWorld(s, frame);
      const d = detail(s, w, sensorAxisWorld(s, frame));
      return { name: s.name, value: d.value, x: w.x, y: w.y, bx: d.bx, by: d.by, bz: d.bz };
    });
  }, [carPose, sensors, fieldElements, params.currentMa, kCal, sourceKind, measured, path]);

  // ---------------- 一键调 PID（数学模型.md §8.6；算法已迁入 sim/autotune.ts，此处仅装配与驱动） ----------------
  const runAutoTune = async (
    kpMax: number,
    kdMax: number,
    eInMaxMm: number,
    onProgress: (done: number, total: number) => void,
  ): Promise<{ kp: number; kd: number } | null> => {
    if (!tracking.enabled || path.s.length === 0 || sensors.length === 0) return null;
    const sampler = createSensorSampler({
      path,
      elements: fieldElements,
      currentMa: params.currentMa,
      k: kCal,
      sourceKind,
      measured,
    });
    const sim = new Simulator({
      path,
      sensors,
      vehicle: {
        controller: new FormulaController(tracking, trackFormula),
        sampler,
        params: tracking,
      },
      tasks: [{ periodMs: tracking.dtMs, entry: 'control' }],
      closed: trackClosed,
    });
    // 网格搜索与轨迹形状评价已迁入 sim/autotune.ts（生成器逐候选 yield 进度）；
    // 分块让出事件循环留在 UI 侧：每 8 个候选 setTimeout(0) 一次
    const gen = autoTuneGrid({
      simulator: sim,
      baseParams: tracking,
      path,
      segSpans,
      kpMax,
      kdMax,
      eInMaxMm,
    });
    let r = gen.next();
    while (!r.done) {
      onProgress(r.value.done, r.value.total);
      if (r.value.done % 8 === 0) await new Promise((res) => window.setTimeout(res, 0));
      r = gen.next();
    }
    return r.value;
  };

  // ---------------- 实时模式（Phase 12 FR-8）：rAF 驱动 simulator.step()，播放状态为会话内 useState（不入 appState） ----------------
  const [simMode, setSimMode] = useState<'fast' | 'realtime'>('fast');
  const [rtPlaying, setRtPlaying] = useState(false);
  const [rtSpeed, setRtSpeed] = useState(1);
  const [rtVersion, setRtVersion] = useState(0);

  const rtSim = useMemo(() => {
    if (simMode !== 'realtime') return null;
    const d = trackingDepsRef.current;
    if (!d.tracking.enabled || d.path.s.length === 0 || d.sensors.length === 0) return null;
    const sampler = createSensorSampler({
      path: d.path,
      elements: d.elements,
      currentMa: d.currentMa,
      k: d.k,
      sourceKind: d.sourceKind,
      measured: d.measured,
    });
    if (wasmCtrl) {
      wasmCtrl.setSensorNames(d.sensors.map((s) => s.name));
      const sim = new Simulator({
        path: d.path,
        sensors: d.sensors,
        vehicle: { controller: wasmCtrl, sampler, params: d.tracking },
        tasks: wasmCtrl.taskEntries(),
        closed: trackClosed,
      });
      sim.reset(d.tracking); // wasm 全新实例
      return sim;
    }
    return new Simulator({
      path: d.path,
      sensors: d.sensors,
      vehicle: {
        controller: new FormulaController(d.tracking, d.formula),
        sampler,
        params: d.tracking,
      },
      tasks: [{ periodMs: d.tracking.dtMs, entry: 'control' }],
      closed: trackClosed,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackingTick, simMode, wasmCtrl]);

  // 参数/赛道变化（rtSim 重建）或切模式时停止播放
  useEffect(() => {
    setRtPlaying(false);
  }, [rtSim]);

  // rAF 驱动：墙钟 × 倍速经整数 µs 累加器折算 tick 数（不引入浮点时间漂移），单帧封顶防卡顿螺旋
  useEffect(() => {
    if (!rtPlaying || !rtSim) return;
    let raf = 0;
    let last = performance.now();
    let accUs = 0;
    const dtUs = Math.max(1, Math.round(rtSim.stepMs * 1000));
    const tick = (now: number) => {
      accUs += (now - last) * 1000 * rtSpeed;
      last = now;
      let n = Math.floor(accUs / dtUs);
      accUs -= n * dtUs;
      n = Math.min(n, 5000);
      let done = false;
      for (let i = 0; i < n; i++) {
        if (rtSim.step().done) {
          done = true;
          break;
        }
      }
      setRtVersion((v) => v + 1);
      // Phase 13 FR-7：wasm 运行时 trap → 提示并回退内置控制器（rtSim 随 wasmCtrl 置空重建）
      if (wasmCtrl?.trapError) {
        setWasmError(`wasm 运行时 trap，已回退内置控制器：${wasmCtrl.trapError}`);
        setWasmCtrl(null);
        setRtPlaying(false);
        return;
      }
      if (done) setRtPlaying(false);
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [rtPlaying, rtSim, rtSpeed, wasmCtrl]);

  // 实时模式的活体结果包装（数组引用共享 Simulator 记录，随 rtVersion 重渲染）
  const rtResult: TrackingResult | null = useMemo(() => {
    if (!rtSim) return null;
    void rtVersion;
    const r = rtSim.result;
    const steps = r.t.length;
    return {
      ...r,
      steps,
      timeS: (steps * rtSim.stepMs) / 1000,
      distM: rtSim.distM,
      finishIndex: steps - 1,
    };
  }, [rtSim, rtVersion]);

  const panelResult = simMode === 'realtime' ? rtResult : trackingResult;

  // ---------------- 自由铺设 ----------------
  const tip = useMemo(() => trackTip(trackDef.segments), [trackDef.segments]);
  const arcSeg = useMemo(() => arcPendingToSeg(arcPending), [arcPending]);
  const arcPreview = useMemo(() => previewSegment(arcSeg, tip), [arcSeg, tip]);

  // 单击落点：笔尖 -> 目标点的直线段（尖角，1cm 吸附）
  const addVertex = useCallback(
    (x: number, y: number) => {
      setPlacing(true);
      setTrackDef((t) => {
        const curTip = trackTip(t.segments);
        const seg = lineSegTo(curTip, x, y);
        if (!seg) return t;
        return { ...t, segments: [...t.segments, seg] };
      });
    },
    [],
  );
  const commitArc = useCallback(() => {
    setTrackDef((t) => ({ ...t, segments: [...t.segments, arcPendingToSeg(arcPending)] }));
  }, [arcPending]);
  const undoSeg = useCallback(() => {
    setTrackDef((t) => ({ ...t, segments: t.segments.slice(0, -1) }));
  }, []);
  const clearTrack = useCallback(() => {
    setTrackDef({ name: '我的赛道', segments: [] });
    setPlacing(true);
  }, []);
  const endPlacing = useCallback(() => setPlacing(false), []);

  // 形状工具：直角弯（尖角）/ 正六边形环岛
  const addRightAngle = useCallback((lenMm: number, dir: 'left' | 'right') => {
    setTrackDef((t) => {
      const curTip = trackTip(t.segments);
      return { ...t, segments: [...t.segments, rightAngleSeg(curTip, lenMm / 1000, dir)] };
    });
  }, []);
  const addHexagon = useCallback((edgeMm: number, dir: 'left' | 'right') => {
    setTrackDef((t) => {
      const curTip = trackTip(t.segments);
      return { ...t, segments: [...t.segments, ...hexagonSegs(curTip, edgeMm / 1000, dir)] };
    });
  }, []);


  // 段长标注
  const segLabels = useMemo(() => {
    if (!showSegLengths) return undefined;
    return segmentSummaries(trackDef.segments).map((s) => ({
      x: s.midX,
      y: s.midY,
      text: `${(s.lengthM * 1000).toFixed(0)}mm`,
    }));
  }, [showSegLengths, trackDef.segments]);

  // 转角刻度（程序设计说明.md §3.2）：各转角顶点两侧 300mm 标尺（闭环含吸合处顶点）
  const rulers = useMemo(
    () => cornerRulers(trackDef.segments, trackClosed),
    [trackDef.segments, trackClosed],
  );

  // 各段弧长区间与类型（数学模型.md §8.6 一键调 PID 轨迹形状评价：构建已迁入 sim/autotune.ts）
  const segSpans = useMemo(
    () => buildSegSpans(trackDef.segments, trackClosed, path.length),
    [trackDef.segments, trackClosed, path.length],
  );

  // ---------------- 折线图点击联动车位（程序设计说明.md §3.6） ----------------
  // 全程扫描图：切手动位姿并设 s（e/ψ 保持当前值）
  const handleSweepPointClick = useCallback((sMm: number) => {
    setPoseSource('manual');
    setPoseState((p) => ({ ...p, sMm }));
  }, []);
  // 循迹类图（循迹轨迹电感图 / Err(t) / 轮速(t)）：切跟随仿真轨迹并定位 trajT
  const handleTrajPointClick = useCallback(
    (tSec: number) => {
      if (!trajAvailable) {
        flash('循迹无有效轨迹——请先开启循迹仿真');
        return;
      }
      setPoseSource('trajectory');
      setTrajT(Math.min(Math.max(0, tSec), trajDurationS));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trajAvailable, trajDurationS],
  );

  // ---------------- 赛道库 ----------------
  const persistLibrary = useCallback((lib: SavedTrack[]) => {
    setLibrary(lib);
    saveLibrary(lib);
  }, []);
  const handleSaveTrack = useCallback(
    (name: string) => {
      setTrackDef((t) => ({ ...t, name }));
      const lib = loadLibrary().filter((x) => x.name !== name);
      lib.push({ name, def: { ...trackDef, name }, savedAt: new Date().toISOString() });
      persistLibrary(lib);
    },
    [trackDef, persistLibrary],
  );
  const handleLoadTrack = useCallback((name: string) => {
    const t = loadLibrary().find((x) => x.name === name);
    if (t) {
      setTrackDef(t.def);
      setPoseState((p) => ({ ...p, sMm: 0 }));
    }
  }, []);
  const handleRenameTrack = useCallback(
    (oldName: string, newName: string) => {
      const lib = loadLibrary().map((x) =>
        x.name === oldName
          ? { ...x, name: newName, def: { ...x.def, name: newName } }
          : x,
      );
      persistLibrary(lib);
    },
    [persistLibrary],
  );
  const handleDeleteTrack = useCallback(
    (name: string) => {
      persistLibrary(loadLibrary().filter((x) => x.name !== name));
    },
    [persistLibrary],
  );
  const handleImportTrackJSON = useCallback(async (file: File) => {
    try {
      const def = parseTrackJSON(await file.text());
      setTrackDef(def);
      setPoseState((p) => ({ ...p, sMm: 0 }));
    } catch (err) {
      alert(`赛道导入失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  // ---------------- 实测数据标定 ----------------
  // 导入实测 CSV：解析 -> 对每个能匹配当前电感 name 的通道做方案A 拟合（导入即自动分析）
  const handleImportMeasured = useCallback(
    async (file: File) => {
      try {
        const dataset = parseMeasuredCSV(await file.text(), file.name);
        const fits: MeasuredState['fits'] = {};
        const matched: string[] = [];
        const failed: string[] = [];
        for (const s of sensors) {
          if (!dataset.channels.includes(s.name)) continue;
          try {
            fits[s.name] = fitChannelModel(dataset.points, s.name, s.axisPreset);
            matched.push(s.name);
          } catch {
            failed.push(s.name);
          }
        }
        setMeasured({ dataset, fits });
        if (matched.length === 0) {
          alert(
            `实测数据已导入（${dataset.points.length} 点），但没有通道与当前电感名匹配。\n` +
              `CSV 通道：${dataset.channels.join('、')}\n` +
              `当前电感：${sensors.map((s) => s.name).join('、')}\n` +
              `请在"电感布局"中把电感名改为与 CSV 通道一致。`,
          );
        } else if (failed.length > 0) {
          alert(`部分通道拟合失败：${failed.join('、')}（有效点不足或拟合无有效组合）`);
        }
      } catch (err) {
        alert(`实测数据导入失败：${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [sensors],
  );
  const handleClearMeasured = useCallback(() => {
    setMeasured(null);
    flash('已清除实测数据');
  }, []);

  // ---------------- 导出 ----------------
  const exportCtx = {
    currentMa: params.currentMa,
    heightMm: params.heightMm,
    gridStepMm: params.gridStepMm,
    trackLengthM: path.length,
    trackName: trackDef.name,
  };
  const flash = (msg: string) => {
    setExportMsg(msg);
    window.setTimeout(() => setExportMsg(''), 3000);
  };
  const doExportGrid = () => {
    exportGridCSV(fieldElements, gridParams, exportCtx);
    flash(`已导出磁场网格 CSV（${(gridParams.nx * gridParams.ny).toLocaleString()} 行）`);
  };
  const doExportReadings = () => {
    exportReadingsCSV(sensors, readings, {
      ...exportCtx,
      eMm: poseState.eMm,
      psiDeg: poseState.psiDeg,
      k: kCal,
      vppAnchor,
    });
    flash('已导出电感读数 CSV');
  };
  const doExportPNG = () => {
    if (canvasElRef.current) {
      exportCanvasPNG(canvasElRef.current);
      flash('已导出画布 PNG');
    }
  };
  const doExportSweep = () => {
    if (!sweep) return;
    exportSweepCSV(sweep, {
      ...exportCtx,
      eMm: poseState.eMm,
      psiDeg: poseState.psiDeg,
      k: kCal,
      vppAnchor,
    });
    flash(`已导出全程扫描 CSV（${sweep.sMm.length} 点 × ${sweep.series.length} 电感）`);
  };
  const doExportTracking = () => {
    if (!trackingResult) return;
    const sourceName =
      sourceKind === 'simulation'
        ? '仿真模型'
        : sourceKind === 'measured-fit'
          ? '实测拟合(方案A)'
          : sourceKind === 'measured-phys'
            ? '实测物理+偏差(方案B)'
            : sourceKind;
    exportTrackingCSV(trackingResult, tracking, { ...exportCtx, sourceName });
    flash(`已导出循迹轨迹 CSV（${trackingResult.steps} 步）`);
  };

  return (
    <div className="flex h-screen flex-col bg-slate-950 text-slate-100">
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-slate-800 px-4">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold">智能车电磁赛道磁场建模工具</span>
          <span className="rounded border border-slate-700 bg-slate-800/60 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
            v{APP_VERSION}
          </span>
          <span className="text-[11px] text-slate-500">
            毕奥-萨伐尔分段积分 · 总长 {(path.length * 1000).toFixed(0)} mm
            {trackClosed && <span className="ml-1 text-emerald-400">· 闭环赛道（一圈）</span>}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {exportMsg && <span className="text-[11px] text-green-400">{exportMsg}</span>}
          <span className="font-mono text-[11px] text-slate-500">
            {computing ? (
              <span className="text-cyan-300">
                ⏳ 场计算中 {(progress * 100).toFixed(0)}% · {(runningMs / 1000).toFixed(1)}s
              </span>
            ) : grid ? (
              `✓ 网格 ${grid.nx}×${grid.ny} · ${elapsedMs.toFixed(0)} ms`
            ) : (
              ''
            )}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 border-slate-600 bg-slate-800 text-xs">
                导出 ▾
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="border-slate-700 bg-slate-900 text-slate-200">
              <DropdownMenuLabel className="text-xs text-slate-400">导出仿真结果</DropdownMenuLabel>
              <DropdownMenuSeparator className="bg-slate-700" />
              <DropdownMenuItem className="text-xs" onClick={doExportGrid}>
                磁场网格数据 CSV（x, y, h, Bx, By, Bz, |B|）
              </DropdownMenuItem>
              <DropdownMenuItem className="text-xs" onClick={doExportReadings}>
                电感读数 CSV（当前位姿）
              </DropdownMenuItem>
              <DropdownMenuItem className="text-xs" onClick={doExportPNG}>
                画布视图 PNG
              </DropdownMenuItem>
              <DropdownMenuItem className="text-xs" onClick={doExportSweep} disabled={!sweep}>
                全程扫描 CSV（U(s)）
              </DropdownMenuItem>
              <DropdownMenuItem className="text-xs" onClick={doExportTracking} disabled={!trackingResult}>
                循迹轨迹 CSV（t, x, y, θ, v_L, v_R, Err, U）
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-slate-700" />
              <DropdownMenuItem className="text-xs" onClick={() => exportTrackJSON(trackDef)}>
                赛道定义 JSON
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="outline"
            size="sm"
            className="h-7 border-slate-600 bg-slate-800 text-xs text-slate-300"
            title="清除自动保存的工作状态并重置（赛道库不受影响）"
            onClick={resetDefaults}
          >
            恢复默认
          </Button>
        </div>
      </header>
      <FloatingLayerContext.Provider value={floatingCtx}>
      {/* 左右面板可拖拽调宽（程序设计说明.md §3.8），宽度布局持久化于独立 key */}
      <ResizablePanelGroup
        orientation="horizontal"
        className="min-h-0 flex-1"
        defaultLayout={savedPanelLayout ?? undefined}
        onLayoutChange={handlePanelLayoutChange}
      >
        {/* 左侧：赛道编辑 + 参数（可收起为窄条，状态随 appState 持久化） */}
        <ResizablePanel
          id="left"
          panelRef={leftPanelRef}
          collapsible
          collapsedSize="32px"
          minSize="240px"
          defaultSize="330px"
          maxSize="45%"
          onResize={handleLeftPanelResize}
          className="h-full"
        >
        <aside className="h-full overflow-hidden border-r border-slate-800 bg-slate-900/60">
          {leftCollapsed ? (
            <div className="flex flex-col items-center pt-2">
              <button
                className="flex h-6 w-6 items-center justify-center rounded border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"
                title="展开赛道编辑面板"
                onClick={() => setLeftCollapsed(false)}
              >
                <PanelLeftOpen size={14} />
              </button>
            </div>
          ) : (
            <div className="h-full overflow-y-auto">
              <div className="sticky top-0 z-10 flex h-8 items-center justify-between border-b border-slate-800/80 bg-slate-900/95 px-3 backdrop-blur">
                <span className="text-[11px] font-semibold tracking-wide text-slate-400">
                  赛道编辑
                </span>
                <button
                  className="flex h-5 w-5 items-center justify-center rounded text-slate-500 hover:bg-slate-800 hover:text-slate-300"
                  title="收起面板（拖动边缘可调宽）"
                  onClick={() => setLeftCollapsed(true)}
                >
                  <PanelLeftClose size={13} />
                </button>
              </div>
              <TrackEditor
                trackDef={trackDef}
                params={params}
                onParamsChange={setParams}
                elementCount={elements.count}
                gridCells={gridParams.nx * gridParams.ny}
                effStepMm={gridParams.effStepMm}
                gridDegraded={gridParams.degraded}
                elapsedMs={elapsedMs}
                computing={computing}
                totalLengthM={path.length}
                editMode={editMode}
                onEditModeChange={setEditMode}
                showSegLengths={showSegLengths}
                onShowSegLengthsChange={setShowSegLengths}
                layMode={layMode}
                onLayModeChange={(m) => {
                  setLayMode(m);
                  if (m === 'line') setPlacing(true);
                }}
                placing={placing}
                onResumePlacing={() => setPlacing(true)}
                onEndPlacing={endPlacing}
                arcPending={arcPending}
                onArcPendingChange={setArcPending}
                onCommitArc={commitArc}
                onUndoSeg={undoSeg}
                onClearTrack={clearTrack}
                onRightAngle={addRightAngle}
                onHexagon={addHexagon}
                onClosedChange={handleClosedChange}
                closureGapMm={closureGapMm}
                library={library}
                onSaveTrack={handleSaveTrack}
                onLoadTrack={handleLoadTrack}
                onRenameTrack={handleRenameTrack}
                onDeleteTrack={handleDeleteTrack}
                onExportTrackJSON={() => exportTrackJSON(trackDef)}
                onImportTrackJSON={handleImportTrackJSON}
              />
            </div>
          )}
        </aside>
        </ResizablePanel>
        <ResizableHandle className="w-[3px] bg-transparent transition-colors hover:bg-cyan-700/60" />
        {/* 中央：磁场俯视图（relative 供折线图浮动层定位，程序设计说明.md §3.5） */}
        <ResizablePanel id="canvas" minSize="30%" className="h-full">
        <main className="relative h-full min-w-0">
          <FieldCanvas
            key={resetCounter}
            elements={fieldElements}
            path={path}
            extraWires={trackDef.extraWires}
            grid={grid}
            component={params.component}
            logScale={params.logScale}
            pose={carPose}
            sensors={sensors}
            current_mA={params.currentMa}
            heightMm={params.heightMm}
            totalLengthM={path.length}
            computing={computing}
            computePct={progress}
            segLabels={segLabels}
            tracking={
              panelResult
                ? {
                    // 轨迹画到冲线点（首次跑满全长）；容差段为失控保护，不展示
                    // 实时模式：finishIndex 随仿真推进（= 当前步），逐帧生长
                    x: panelResult.x.slice(0, panelResult.finishIndex + 1),
                    y: panelResult.y.slice(0, panelResult.finishIndex + 1),
                    endTheta: panelResult.theta[panelResult.finishIndex] ?? 0,
                    status: panelResult.status,
                  }
                : null
            }
            initialView={view}
            onViewChange={handleViewChange}
            freeLay={{
              active: editMode === 'lay',
              mode: layMode,
              placing,
              tipX: tip.x,
              tipY: tip.y,
              tipPhi: tip.phi,
              arcPreview,
              arcAngleDeg: arcPending.angleDeg,
              onArcAngle: (deg) => setArcPending((p) => ({ ...p, angleDeg: Math.min(360, Math.max(1, Math.round(deg))) })),
              onVertex: addVertex,
              onCommitArc: commitArc,
              onEnd: endPlacing,
            }}
            registerCanvas={(el) => {
              canvasElRef.current = el;
            }}
            cornerRulers={rulers}
          />
          {/* 折线图浮动层（程序设计说明.md §3.5 portal 宿主） */}
          <FloatingLayerHost hostRef={setFloatLayerEl} />
        </main>
        </ResizablePanel>
        <ResizableHandle className="w-[3px] bg-transparent transition-colors hover:bg-cyan-700/60" />
        {/* 右侧：电感面板（含循迹控制区，程序设计说明.md §3.3 顺序；可拖拽调宽/收起，§3.8） */}
        <ResizablePanel
          id="right"
          panelRef={rightPanelRef}
          collapsible
          collapsedSize="32px"
          minSize="300px"
          defaultSize="350px"
          maxSize="55%"
          onResize={handleRightPanelResize}
          className="h-full"
        >
        <aside className="h-full overflow-hidden border-l border-slate-800 bg-slate-900/60">
          {rightCollapsed ? (
            <div className="flex flex-col items-center pt-2">
              <button
                className="flex h-6 w-6 items-center justify-center rounded border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"
                title="展开电感与仿真面板"
                onClick={() => setRightCollapsed(false)}
              >
                <PanelRightOpen size={14} />
              </button>
            </div>
          ) : (
            <div className="h-full overflow-y-auto">
              <div className="sticky top-0 z-10 flex h-8 items-center justify-between border-b border-slate-800/80 bg-slate-900/95 px-3 backdrop-blur">
                <span className="text-[11px] font-semibold tracking-wide text-slate-400">
                  电感与仿真
                </span>
                <button
                  className="flex h-5 w-5 items-center justify-center rounded text-slate-500 hover:bg-slate-800 hover:text-slate-300"
                  title="收起面板（拖动边缘可调宽）"
                  onClick={() => setRightCollapsed(true)}
                >
                  <PanelRightClose size={13} />
                </button>
              </div>
              <SensorPanel
            sensors={sensors}
            onSensorsChange={setSensors}
            pose={poseState}
            onPoseChange={setPoseState}
            trackLength={path.length}
            vppAnchor={vppAnchor}
            onVppAnchorChange={setVppAnchor}
            kCal={kCal}
            currentMa={params.currentMa}
            readings={readings}
            sourceKind={sourceKind}
            onSourceKindChange={setSourceKind}
            measured={measured}
            onImportMeasured={handleImportMeasured}
            onClearMeasured={handleClearMeasured}
            sweep={sweep}
            onExportSweep={doExportSweep}
            poseSource={poseSource}
            onPoseSourceChange={setPoseSource}
            trajT={trajT}
            onTrajTChange={setTrajT}
            trajAvailable={trajAvailable}
            trajDurationS={trajDurationS}
            displayPose={displayPose}
            trackingResult={trackingResult}
            onSweepPointClick={handleSweepPointClick}
            onTrajPointClick={handleTrajPointClick}
            trackingSlot={
              <TrackingPanel
                params={tracking}
                onChange={setTracking}
                result={panelResult}
                formulaError={formulaError}
                sensorNames={sensors.map((s) => s.name)}
                onExport={doExportTracking}
                onAutoTune={runAutoTune}
                ranges={trackingRanges}
                onRangeChange={handleRangeChange}
                onChartPointClick={handleTrajPointClick}
                controllerSource={{
                  kind: wasmCtrl ? 'wasm' : 'builtin',
                  fileName: wasmCtrl?.fileName ?? null,
                  abiVersion: wasmCtrl?.abiVersion ?? null,
                  missingEntries: wasmCtrl?.missingEntries ?? [],
                  error: wasmError,
                  lastFileName: wasmFileName,
                  onUpload: (f) => void handleWasmUpload(f),
                  onClear: handleWasmClear,
                }}
                playback={{
                  mode: simMode,
                  onModeChange: setSimMode,
                  playing: rtPlaying,
                  speed: rtSpeed,
                  done: rtSim?.done ?? false,
                  available: rtSim !== null,
                  onPlayPause: () => setRtPlaying((p) => !p),
                  onReset: () => {
                    rtSim?.reset();
                    setRtPlaying(false);
                    setRtVersion((v) => v + 1);
                  },
                  onSpeedChange: setRtSpeed,
                }}
              />
            }
          />
            </div>
          )}
        </aside>
        </ResizablePanel>
      </ResizablePanelGroup>
      </FloatingLayerContext.Provider>
    </div>
  );
}
