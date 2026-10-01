/**
 * 磁场俯视图画布：热力图 + 等值线 + 赛道线 + 车体/电感叠加 + 悬停探针
 * + 滚轮缩放（zoom to cursor）/ 平移 / CAD 风格动态输入（长度、角度，Tab 切换）。
 * UI 长度单位一律 mm（内部计算仍为 SI 米）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Elements, PathSample } from '../../model/track';
import type { CornerRuler } from '../../model/track';
import { computeB } from '../../model/field';
import type { CarPose, SensorDef } from '../../model/sensor';
import { poseFrame, sensorWorld, INDUCTOR_RADIUS_M } from '../../model/sensor';
import { contourLevels, diverging, marchingSquares, turbo } from '../render/colormap';
import type { GridResult } from '../workers/fieldWorker';

export type FieldComponent = 'bz' | 'bx' | 'bmag';

export interface ProbeInfo {
  x: number;
  y: number;
  bx: number;
  by: number;
  bz: number;
  bmag: number;
  /** 鼠标是否悬停在赛道线上（<10mm），用于提示真实线径 */
  nearTrack?: boolean;
}

interface Props {
  elements: Elements;
  path: PathSample;
  extraWires?: [number, number][][];
  grid: GridResult | null;
  component: FieldComponent;
  logScale: boolean;
  pose: CarPose | null;
  sensors: SensorDef[];
  current_mA: number;
  heightMm: number;
  /** 赛道总长（m），常驻显示 */
  totalLengthM: number;
  /** 场计算中状态（角标 spinner） */
  computing?: boolean;
  computePct?: number;
  /** 段长标注（开启时绘制） */
  segLabels?: { x: number; y: number; text: string }[];
  /** 赛道转角刻度（程序设计说明.md §3.2）：各转角顶点两侧的 300mm 标尺（短段按实际段长） */
  cornerRulers?: CornerRuler[];
  /** 循迹闭环轨迹叠加（null = 不绘制）：轨迹线 + 起终点标记 + 终点车框 */
  tracking?: {
    x: number[];
    y: number[];
    endTheta: number;
    status: 'finished' | 'lost' | 'maxSteps';
  } | null;
  /** 自由铺设交互状态（鼠标连线为主，圆弧辅助） */
  freeLay?: {
    active: boolean;
    mode: 'line' | 'arc';
    /** 直线连线会话是否进行中（双击/Esc 结束后为 false） */
    placing: boolean;
    tipX: number;
    tipY: number;
    tipPhi: number;
    /** 圆弧模式：待定段虚影与圆心角（动态输入框绑定） */
    arcPreview: [number, number][];
    arcAngleDeg: number;
    onArcAngle: (deg: number) => void;
    /** 落点（世界坐标；自由模式已吸附 10mm，锁定模式为精确计算值） */
    onVertex: (x: number, y: number) => void;
    /** 圆弧模式：铺设当前待定圆弧 */
    onCommitArc: () => void;
    /** 双击 / Esc 结束当前铺设 */
    onEnd: () => void;
  };
  /** 注册 canvas 元素（PNG 导出用） */
  registerCanvas?: (el: HTMLCanvasElement | null) => void;
  /** 挂载时恢复的视图（缩放/平移）；视为用户已手动调整，不再自动 fit */
  initialView?: ViewState | null;
  /** 用户缩放/平移/复位视图后回调（持久化用） */
  onViewChange?: (v: ViewState) => void;
}

/** 由赛道采样求包围盒（含附加导线），加边距 */
export function trackBBox(
  path: PathSample,
  extraWires: [number, number][][] | undefined,
  margin: number,
): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < path.s.length; i++) {
    const x = path.pts[i * 2];
    const y = path.pts[i * 2 + 1];
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  for (const w of extraWires ?? []) {
    for (const [x, y] of w) {
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  if (!isFinite(x0)) {
    x0 = -1;
    y0 = -1;
    x1 = 1;
    y1 = 1;
  }
  return { x0: x0 - margin, y0: y0 - margin, x1: x1 + margin, y1: y1 + margin };
}

interface ViewState {
  cx: number;
  cy: number;
  scale: number; // px / m
}
export type { ViewState };

/** 角度归一化到 (-180, 180]（度） */
function normDeg(a: number): number {
  let r = a % 360;
  if (r > 180) r -= 360;
  if (r <= -180) r += 360;
  return r;
}

const SCALE_BAR_MM = [5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];

export default function FieldCanvas(props: Props) {
  const { elements, path, grid, component, logScale, pose, sensors, current_mA } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offRef = useRef<HTMLCanvasElement | null>(null);
  const [probe, setProbe] = useState<ProbeInfo | null>(null);
  const [viewSize, setViewSize] = useState({ w: 800, h: 600 });
  /** 直线连线模式下的悬停点（世界坐标，吸附 10mm） */
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  /** 转角刻度叠加开关（程序设计说明.md §3.2，默认开） */
  const [showRulers, setShowRulers] = useState(true);
  // 视图（缩放/平移）；有恢复视图时视为用户已手动调整（不再跟随包围盒自动 fit）
  const [view, setView] = useState<ViewState | null>(props.initialView ?? null);
  const viewDirtyRef = useRef(!!props.initialView);
  const panRef = useRef<{ sx: number; sy: number; cx: number; cy: number } | null>(null);
  const spaceRef = useRef(false);
  // CAD 动态输入
  const [lenStr, setLenStr] = useState('');
  const [angStr, setAngStr] = useState('');
  const [focusBox, setFocusBox] = useState<'len' | 'ang'>('len');

  // 注册 canvas 供 PNG 导出
  useEffect(() => {
    props.registerCanvas?.(canvasRef.current);
    return () => props.registerCanvas?.(null);
  }, [props.registerCanvas]);

  const bbox = useMemo(
    () => trackBBox(path, props.extraWires, 0.35),
    [path, props.extraWires],
  );

  const fitView = useCallback((): ViewState => {
    const wx = Math.max(bbox.x1 - bbox.x0, 1e-6);
    const wy = Math.max(bbox.y1 - bbox.y0, 1e-6);
    return {
      cx: (bbox.x0 + bbox.x1) / 2,
      cy: (bbox.y0 + bbox.y1) / 2,
      scale: Math.min(viewSize.w / wx, viewSize.h / wy) * 0.96,
    };
  }, [bbox, viewSize]);

  // 未手动缩放/平移过时，跟随包围盒自适应
  useEffect(() => {
    if (!viewDirtyRef.current) setView(fitView());
  }, [fitView]);

  const resetView = useCallback(() => {
    viewDirtyRef.current = false;
    const fv = fitView();
    setView(fv);
    props.onViewChange?.(fv);
  }, [fitView, props.onViewChange]);

  // 用户调整视图后上报（持久化）；仅在手动调整过时上报，避免自动 fit 反复触发
  const onViewChangeRef = useRef(props.onViewChange);
  onViewChangeRef.current = props.onViewChange;
  useEffect(() => {
    if (viewDirtyRef.current && view) onViewChangeRef.current?.(view);
  }, [view]);

  const effView = view ?? fitView();
  const fitScale = fitView().scale;

  // 世界 -> 画布映射
  const transform = useMemo(
    () => ({
      toX: (x: number) => (x - effView.cx) * effView.scale + viewSize.w / 2,
      toY: (y: number) => viewSize.h / 2 - (y - effView.cy) * effView.scale, // y 向上
      fromX: (cx: number) => effView.cx + (cx - viewSize.w / 2) / effView.scale,
      fromY: (cy: number) => effView.cy + (viewSize.h / 2 - cy) / effView.scale,
      scale: effView.scale,
    }),
    [effView, viewSize],
  );

  // 监听容器尺寸
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ro = new ResizeObserver(() => {
      const r = cv.parentElement?.getBoundingClientRect();
      if (r) setViewSize({ w: Math.max(200, r.width), h: Math.max(200, r.height) });
    });
    if (cv.parentElement) ro.observe(cv.parentElement);
    return () => ro.disconnect();
  }, []);

  // 滚轮缩放（zoom to cursor，0.1x ~ 20x），需非被动监听以 preventDefault
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      viewDirtyRef.current = true;
      const rect = cv.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      setView((v) => {
        const cur = v ?? fitView();
        const factor = Math.exp(-e.deltaY * 0.0015);
        const scale = Math.min(fitScale * 20, Math.max(fitScale * 0.1, cur.scale * factor));
        // 保持鼠标下的世界点不动
        const wx = cur.cx + (px - viewSize.w / 2) / cur.scale;
        const wy = cur.cy + (viewSize.h / 2 - py) / cur.scale;
        return {
          cx: wx - (px - viewSize.w / 2) / scale,
          cy: wy - (viewSize.h / 2 - py) / scale,
          scale,
        };
      });
    };
    cv.addEventListener('wheel', onWheel, { passive: false });
    return () => cv.removeEventListener('wheel', onWheel);
  }, [fitView, fitScale, viewSize]);

  // 空格键状态（空格+左键平移）
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement)) {
        spaceRef.current = true;
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceRef.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  // 平移（中键或空格+左键拖拽）
  const onMouseDown = useCallback(
    (ev: React.MouseEvent<HTMLCanvasElement>) => {
      const isPan = ev.button === 1 || (ev.button === 0 && spaceRef.current);
      if (!isPan) return;
      ev.preventDefault();
      viewDirtyRef.current = true;
      panRef.current = { sx: ev.clientX, sy: ev.clientY, cx: effView.cx, cy: effView.cy };
      const move = (e: MouseEvent) => {
        const p = panRef.current;
        if (!p) return;
        setView((v) => {
          const cur = v ?? fitView();
          return {
            ...cur,
            cx: p.cx - (e.clientX - p.sx) / cur.scale,
            cy: p.cy + (e.clientY - p.sy) / cur.scale,
          };
        });
      };
      const up = () => {
        panRef.current = null;
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    },
    [effView.cx, effView.cy, fitView],
  );

  // ---------------- CAD 动态输入：长度 / 角度锁定 ----------------
  const fl = props.freeLay;
  const laying = !!(fl?.active && fl.mode === 'line' && fl.placing);

  const mouseLenMm = fl && hover ? Math.hypot(hover.x - fl.tipX, hover.y - fl.tipY) * 1000 : 0;
  const mouseAngDeg =
    fl && hover
      ? normDeg((Math.atan2(hover.y - fl.tipY, hover.x - fl.tipX) - fl.tipPhi) * (180 / Math.PI))
      : 0;
  // 锁定值：长度四舍五入到 10mm，角度取整度数
  const lenLockedMm = lenStr !== '' && isFinite(parseFloat(lenStr))
    ? Math.max(0, Math.round(parseFloat(lenStr) / 10) * 10)
    : null;
  const angLockedDeg = angStr !== '' && isFinite(parseFloat(angStr))
    ? Math.round(parseFloat(angStr))
    : null;
  const effLenMm = lenLockedMm ?? mouseLenMm;
  const effAngDeg = angLockedDeg ?? mouseAngDeg;
  const effPt = useMemo(() => {
    if (!fl) return null;
    const ang = fl.tipPhi + (effAngDeg * Math.PI) / 180;
    const L = effLenMm / 1000;
    return { x: fl.tipX + L * Math.cos(ang), y: fl.tipY + L * Math.sin(ang) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fl?.tipX, fl?.tipY, fl?.tipPhi, effLenMm, effAngDeg]);

  const clearInputs = useCallback(() => {
    setLenStr('');
    setAngStr('');
  }, []);

  const commitVertex = useCallback(() => {
    if (!fl || !effPt) return;
    if (effLenMm >= 5) fl.onVertex(effPt.x, effPt.y);
    clearInputs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fl, effPt, effLenMm, clearInputs]);

  // 键盘：数字进入聚焦框，Tab 切换，Esc 清空/结束，Enter 落点
  useEffect(() => {
    if (!fl?.active) return;
    const onKey = (e: KeyboardEvent) => {
      // 面板输入框打字时不拦截
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (fl.mode === 'arc') {
        // 圆弧模式：数字键编辑圆心角，Enter 铺设
        if (/^[0-9]$/.test(e.key)) {
          const next = Number(`${fl.arcAngleDeg}${e.key}`);
          fl.onArcAngle(Math.min(360, next));
          e.preventDefault();
        } else if (e.key === 'Backspace') {
          fl.onArcAngle(Math.max(1, Math.floor(fl.arcAngleDeg / 10) || 1));
          e.preventDefault();
        } else if (e.key === 'Enter') {
          fl.onCommitArc();
          e.preventDefault();
        } else if (e.key === 'Escape') {
          fl.onEnd();
        }
        return;
      }
      if (!laying) {
        if (e.key === 'Escape') fl.onEnd();
        return;
      }
      if (/^[0-9.]$/.test(e.key)) {
        if (e.key === '.' && (focusBox === 'len' ? lenStr : angStr).includes('.')) return;
        if (focusBox === 'len') setLenStr((s) => s + e.key);
        else setAngStr((s) => s + e.key);
        e.preventDefault();
      } else if (e.key === '-' && focusBox === 'ang' && angStr === '') {
        setAngStr('-');
        e.preventDefault();
      } else if (e.key === 'Backspace') {
        if (focusBox === 'len') setLenStr((s) => s.slice(0, -1));
        else setAngStr((s) => s.slice(0, -1));
        e.preventDefault();
      } else if (e.key === 'Tab') {
        setFocusBox((f) => (f === 'len' ? 'ang' : 'len'));
        e.preventDefault();
      } else if (e.key === 'Escape') {
        if (lenStr !== '' || angStr !== '') clearInputs();
        else fl.onEnd();
        e.preventDefault();
      } else if (e.key === 'Enter') {
        commitVertex();
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fl, laying, focusBox, lenStr, angStr, clearInputs, commitVertex]);

  // 热力图离屏渲染
  useEffect(() => {
    if (!grid) return;
    const data =
      component === 'bz' ? grid.bz : component === 'bx' ? grid.bx : grid.bmag;
    const off = offRef.current ?? document.createElement('canvas');
    offRef.current = off;
    off.width = grid.nx;
    off.height = grid.ny;
    const ctx = off.getContext('2d')!;
    const img = ctx.createImageData(grid.nx, grid.ny);
    let maxAbs = 0;
    let minV = Infinity;
    let maxV = 0;
    for (let i = 0; i < data.length; i++) {
      const v = data[i];
      const a = Math.abs(v);
      if (a > maxAbs) maxAbs = a;
      if (v > 1e-12) {
        if (v < minV) minV = v;
        if (v > maxV) maxV = v;
      }
    }
    const useLog = logScale && component === 'bmag';
    const logMin = useLog ? Math.log10(Math.max(minV, 1e-8)) : 0;
    const logMax = useLog ? Math.log10(Math.max(maxV, 1e-7)) : 1;
    for (let iy = 0; iy < grid.ny; iy++) {
      for (let ix = 0; ix < grid.nx; ix++) {
        const v = data[iy * grid.nx + ix];
        let rgb: [number, number, number];
        if (component === 'bmag') {
          const t = useLog
            ? (Math.log10(Math.max(v, 1e-8)) - logMin) / Math.max(logMax - logMin, 1e-9)
            : v / Math.max(maxV, 1e-12);
          rgb = turbo(t);
        } else {
          rgb = diverging(maxAbs > 0 ? v / maxAbs : 0);
        }
        // ImageData 行序从上到下，网格行序从下到上 -> 翻转
        const p = ((grid.ny - 1 - iy) * grid.nx + ix) * 4;
        img.data[p] = rgb[0];
        img.data[p + 1] = rgb[1];
        img.data[p + 2] = rgb[2];
        img.data[p + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [grid, component, logScale]);

  // 主绘制
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(viewSize.w * dpr);
    cv.height = Math.round(viewSize.h * dpr);
    const ctx = cv.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#0b0f17';
    ctx.fillRect(0, 0, viewSize.w, viewSize.h);

    const { toX, toY } = transform;

    // 热力图（网格矩形 -> 世界矩形）
    if (grid && offRef.current) {
      const gx0 = toX(grid.x0);
      const gy0 = toY(grid.y0);
      const gx1 = toX(grid.x0 + grid.nx * grid.dx);
      const gy1 = toY(grid.y0 + grid.ny * grid.dy);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(offRef.current, gx0, gy0, gx1 - gx0, gy1 - gy0);
    }

    // 等值线
    if (grid) {
      const data =
        component === 'bz' ? grid.bz : component === 'bx' ? grid.bx : grid.bmag;
      let maxAbs = 0;
      for (let i = 0; i < data.length; i++) {
        const a = Math.abs(data[i]);
        if (a > maxAbs) maxAbs = a;
      }
      const levels = contourLevels(maxAbs);
      const signed = component !== 'bmag';
      ctx.lineWidth = 1;
      const drawLevel = (lv: number, dash: boolean) => {
        const segs = marchingSquares(data, grid.nx, grid.ny, lv);
        if (segs.length === 0) return;
        ctx.strokeStyle = dash
          ? 'rgba(140,180,255,0.55)'
          : 'rgba(255,255,255,0.55)';
        ctx.setLineDash(dash ? [4, 3] : []);
        ctx.beginPath();
        for (const s of segs) {
          ctx.moveTo(toX(grid.x0 + s.x0 * grid.dx), toY(grid.y0 + s.y0 * grid.dy));
          ctx.lineTo(toX(grid.x0 + s.x1 * grid.dx), toY(grid.y0 + s.y1 * grid.dy));
        }
        ctx.stroke();
      };
      for (const lv of levels) {
        drawLevel(lv, false);
        if (signed) drawLevel(-lv, true);
      }
      ctx.setLineDash([]);
    }

    // 赛道中线（线宽按真实线径 0.5mm × 缩放换算，<1px 时按 1px 最细渲染；放大后自然加粗）
    ctx.strokeStyle = 'rgba(250,220,80,0.95)';
    ctx.lineWidth = Math.max(1, 0.0005 * transform.scale);
    ctx.beginPath();
    for (let i = 0; i < path.s.length; i++) {
      const x = toX(path.pts[i * 2]);
      const y = toY(path.pts[i * 2 + 1]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    for (const w of props.extraWires ?? []) {
      ctx.beginPath();
      w.forEach(([x, y], i) => {
        if (i === 0) ctx.moveTo(toX(x), toY(y));
        else ctx.lineTo(toX(x), toY(y));
      });
      ctx.stroke();
    }

    // 循迹闭环轨迹：轨迹线 + 起点/终点标记 + 终点车框
    const trk = props.tracking;
    if (trk && trk.x.length > 0) {
      const statusColor =
        trk.status === 'finished' ? '#34d399' : trk.status === 'lost' ? '#f87171' : '#fbbf24';
      // 轨迹线
      ctx.strokeStyle = 'rgba(251,146,60,0.95)';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      for (let i = 0; i < trk.x.length; i++) {
        const x = toX(trk.x[i]);
        const y = toY(trk.y[i]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      // 起点标记（绿点）
      ctx.fillStyle = '#34d399';
      ctx.beginPath();
      ctx.arc(toX(trk.x[0]), toY(trk.y[0]), 4, 0, Math.PI * 2);
      ctx.fill();
      // 终点车框（颜色随结果状态）+ 车头线
      const n = trk.x.length - 1;
      const ex = trk.x[n];
      const ey = trk.y[n];
      const fwd = { x: Math.cos(trk.endTheta), y: Math.sin(trk.endTheta) };
      const rgt = { x: Math.sin(trk.endTheta), y: -Math.cos(trk.endTheta) };
      const hw = 0.1;
      const hl = 0.15;
      const corner = (sx: number, sy: number) => ({
        x: ex + sx * hw * rgt.x + sy * hl * fwd.x,
        y: ey + sx * hw * rgt.y + sy * hl * fwd.y,
      });
      const cs = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
      ctx.strokeStyle = statusColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      cs.forEach((c, i) => (i === 0 ? ctx.moveTo(toX(c.x), toY(c.y)) : ctx.lineTo(toX(c.x), toY(c.y))));
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(toX(ex), toY(ey));
      ctx.lineTo(toX(ex + 0.2 * fwd.x), toY(ey + 0.2 * fwd.y));
      ctx.stroke();
      // 终点标记文字
      ctx.font = '10px sans-serif';
      ctx.fillStyle = statusColor;
      ctx.fillText(
        trk.status === 'finished' ? '终点✓' : trk.status === 'lost' ? '失控✗' : '步数上限',
        toX(ex) + 8,
        toY(ey) - 8,
      );
    }

    // 车体 + 电感
    if (pose) {
      const frame = poseFrame(pose);
      const { origin, forward, right } = frame;
      // 车体轮廓 200mm 宽 x 300mm 长
      const hw = 0.1;
      const hl = 0.15;
      const corner = (sx: number, sy: number) => ({
        x: origin.x + sx * hw * right.x + sy * hl * forward.x,
        y: origin.y + sx * hw * right.y + sy * hl * forward.y,
      });
      const cs = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
      ctx.strokeStyle = 'rgba(120,230,160,0.9)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      cs.forEach((c, i) => (i === 0 ? ctx.moveTo(toX(c.x), toY(c.y)) : ctx.lineTo(toX(c.x), toY(c.y))));
      ctx.closePath();
      ctx.stroke();
      // 车头方向线
      ctx.beginPath();
      ctx.moveTo(toX(origin.x), toY(origin.y));
      ctx.lineTo(toX(origin.x + 0.2 * forward.x), toY(origin.y + 0.2 * forward.y));
      ctx.stroke();
      // 电感（6×8 工字电感按真实 Ø6mm 俯视圆绘制，缩放过小时保底 1.5px；中心点标示探头位置）
      ctx.font = '10px sans-serif';
      const indR = Math.max(1.5, INDUCTOR_RADIUS_M * transform.scale);
      for (const s of sensors) {
        const w = sensorWorld(s, frame);
        const cx = toX(w.x);
        const cy = toY(w.y);
        ctx.strokeStyle = '#5ee0ff';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(cx, cy, indR, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#5ee0ff';
        ctx.beginPath();
        ctx.arc(cx, cy, 1.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.fillText(s.name, cx + indR + 3, cy - 4);
      }
    }

    // 段长标注（文字大小屏幕像素恒定，不随缩放变化）
    if (props.segLabels && props.segLabels.length > 0) {
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      for (const lb of props.segLabels) {
        const lx = toX(lb.x);
        const ly = toY(lb.y);
        ctx.strokeStyle = 'rgba(0,0,0,0.8)';
        ctx.lineWidth = 3;
        ctx.strokeText(lb.text, lx, ly - 4);
        ctx.fillStyle = 'rgba(255,235,150,0.95)';
        ctx.fillText(lb.text, lx, ly - 4);
      }
      ctx.textAlign = 'left';
    }

    // 转角刻度（程序设计说明.md §3.2）：转角顶点两侧 300mm 标尺（短段按实际段长），100mm 分度 + 端点标注
    if (showRulers && props.cornerRulers) {
      for (const r of props.cornerRulers) {
        const drawSide = (dx: number, dy: number, len: number) => {
          if (len < 0.02) return; // 太短不画
          const vx = toX(r.x);
          const vy = toY(r.y);
          const ex = toX(r.x + dx * len);
          const ey = toY(r.y + dy * len);
          ctx.strokeStyle = 'rgba(148,197,255,0.75)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(vx, vy);
          ctx.lineTo(ex, ey);
          ctx.stroke();
          // 100mm 分度 tick（垂直于标尺方向）
          const nx = -dy;
          const ny = dx;
          const tickPx = 3;
          for (let d = 0.1; d <= len + 1e-9; d += 0.1) {
            const px = toX(r.x + dx * d);
            const py = toY(r.y + dy * d);
            ctx.beginPath();
            ctx.moveTo(px - nx * tickPx, py - ny * tickPx);
            ctx.lineTo(px + nx * tickPx, py + ny * tickPx);
            ctx.stroke();
          }
          // 端点标注（实际标尺长度 mm）
          ctx.font = '9px sans-serif';
          ctx.textAlign = 'center';
          ctx.strokeStyle = 'rgba(0,0,0,0.8)';
          ctx.lineWidth = 2.5;
          const label = `${Math.round(len * 1000)}`;
          const lx = ex + nx * 9;
          const ly = ey + ny * 9;
          ctx.strokeText(label, lx, ly);
          ctx.fillStyle = 'rgba(148,197,255,0.9)';
          ctx.fillText(label, lx, ly);
          ctx.textAlign = 'left';
        };
        drawSide(r.ax, r.ay, r.alen);
        drawSide(r.bx, r.by, r.blen);
        // 顶点标记
        ctx.fillStyle = 'rgba(148,197,255,0.9)';
        ctx.beginPath();
        ctx.arc(toX(r.x), toY(r.y), 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 自由铺设：笔尖 + 虚影
    if (fl?.active) {
      if (fl.mode === 'line') {
        // 直线连线：笔尖 -> 有效落点（含长度/角度锁定）虚影 + 长度标注
        if (fl.placing && hover && effPt) {
          ctx.strokeStyle = 'rgba(90,220,255,0.9)';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([6, 4]);
          ctx.beginPath();
          ctx.moveTo(toX(fl.tipX), toY(fl.tipY));
          ctx.lineTo(toX(effPt.x), toY(effPt.y));
          ctx.stroke();
          ctx.setLineDash([]);
          // 长度标签
          const mx = (toX(fl.tipX) + toX(effPt.x)) / 2;
          const my = (toY(fl.tipY) + toY(effPt.y)) / 2;
          ctx.font = '11px sans-serif';
          ctx.textAlign = 'center';
          ctx.strokeStyle = 'rgba(0,0,0,0.85)';
          ctx.lineWidth = 3;
          const lockMark = lenLockedMm !== null ? ' 🔒' : '';
          const label = `${effLenMm.toFixed(0)} mm${lockMark}`;
          ctx.strokeText(label, mx, my - 6);
          ctx.fillStyle = '#7de3ff';
          ctx.fillText(label, mx, my - 6);
          ctx.textAlign = 'left';
          // 落点标记
          ctx.fillStyle = 'rgba(125,227,255,0.8)';
          ctx.beginPath();
          ctx.arc(toX(effPt.x), toY(effPt.y), 3, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (fl.arcPreview.length > 0) {
        // 圆弧模式：待定圆弧虚影
        ctx.strokeStyle = 'rgba(90,220,255,0.9)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(toX(fl.tipX), toY(fl.tipY));
        for (const [x, y] of fl.arcPreview) ctx.lineTo(toX(x), toY(y));
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // 笔尖标记 + 切向箭头
      const tx = toX(fl.tipX);
      const ty = toY(fl.tipY);
      ctx.fillStyle = fl.mode === 'line' && !fl.placing ? 'rgba(94,224,255,0.45)' : '#5ee0ff';
      ctx.beginPath();
      ctx.arc(tx, ty, 5, 0, Math.PI * 2);
      ctx.fill();
      const ax = fl.tipX + 0.12 * Math.cos(fl.tipPhi);
      const ay = fl.tipY + 0.12 * Math.sin(fl.tipPhi);
      ctx.strokeStyle = 'rgba(90,220,255,0.9)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(toX(ax), toY(ay));
      ctx.stroke();
    }

    // 探针十字线
    if (probe) {
      const px = toX(probe.x);
      const py = toY(probe.y);
      ctx.strokeStyle = 'rgba(255,120,200,0.8)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px - 8, py);
      ctx.lineTo(px + 8, py);
      ctx.moveTo(px, py - 8);
      ctx.lineTo(px, py + 8);
      ctx.stroke();
    }

    // 动态比例尺（随缩放选档，文字像素恒定）
    let barMm = SCALE_BAR_MM[0];
    for (const c of SCALE_BAR_MM) {
      if ((c / 1000) * transform.scale <= 140) barMm = c;
    }
    const barPx = (barMm / 1000) * transform.scale;
    const bx0 = 16;
    const by0 = viewSize.h - 16;
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(bx0, by0);
    ctx.lineTo(bx0 + barPx, by0);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '10px sans-serif';
    ctx.fillText(`${barMm} mm`, bx0, by0 - 5);
  }, [grid, component, logScale, path, pose, sensors, probe, hover, effPt, effLenMm, lenLockedMm, transform, viewSize, showRulers, props.extraWires, props.segLabels, props.cornerRulers, props.tracking, props.freeLay, fl]);

  // 悬停：直线连线模式下更新吸附落点虚影；否则为磁场探针
  const onMove = useCallback(
    (ev: React.MouseEvent<HTMLCanvasElement>) => {
      if (panRef.current) return; // 平移中不更新
      const rect = ev.currentTarget.getBoundingClientRect();
      const wx = transform.fromX(ev.clientX - rect.left);
      const wy = transform.fromY(ev.clientY - rect.top);
      if (fl?.active && fl.mode === 'line') {
        // 吸附 10mm 网格
        setHover({ x: Math.round(wx * 100) / 100, y: Math.round(wy * 100) / 100 });
        return;
      }
      if (fl?.active) return; // 圆弧模式下悬停不触发探针
      const hM = props.heightMm / 1000;
      const [bx, by, bz] = computeB(wx, wy, hM, elements, current_mA / 1000);
      // 距赛道 <10mm 时标记，用于提示真实线径
      let minD2 = Infinity;
      for (let i = 0; i < path.s.length; i++) {
        const ddx = wx - path.pts[i * 2];
        const ddy = wy - path.pts[i * 2 + 1];
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 < minD2) minD2 = d2;
      }
      setProbe({
        x: wx,
        y: wy,
        bx,
        by,
        bz,
        bmag: Math.hypot(bx, by, bz),
        nearTrack: minD2 < 0.0001,
      });
    },
    [transform, elements, current_mA, props.heightMm, fl, path],
  );

  // 单击落点（含锁定值）/ 双击结束（双击的第二击 detail=2，只结束不加点）
  const onClick = useCallback(
    (ev: React.MouseEvent<HTMLCanvasElement>) => {
      if (!fl?.active) return;
      if (fl.mode === 'arc') {
        fl.onCommitArc();
        return;
      }
      if (ev.detail === 2) {
        fl.onEnd();
        clearInputs();
        return;
      }
      if (!fl.placing) {
        // 会话已结束：单击恢复铺设（不立即落点）
        return;
      }
      commitVertex();
    },
    [fl, commitVertex, clearInputs],
  );

  const fmt = (t: number) => (t * 1e6).toFixed(2);
  const tipScreen = fl ? { x: transform.toX(fl.tipX), y: transform.toY(fl.tipY) } : null;

  return (
    <div className="relative h-full w-full">
      <canvas
        ref={canvasRef}
        style={{
          width: viewSize.w,
          height: viewSize.h,
          cursor: fl?.active ? 'crosshair' : 'default',
        }}
        onMouseMove={onMove}
        onMouseDown={onMouseDown}
        onClick={onClick}
        onMouseLeave={() => {
          setProbe(null);
          setHover(null);
        }}
      />
      {/* 赛道总长常驻显示 */}
      <div className="pointer-events-none absolute left-3 top-3 rounded-md border border-slate-700 bg-slate-900/90 px-3 py-1.5 font-mono text-[11px] text-slate-200 shadow-lg">
        赛道总长 <span className="text-amber-300">{(props.totalLengthM * 1000).toFixed(0)} mm</span>
      </div>

      {/* 场计算中角标 */}
      {props.computing && (
        <div className="pointer-events-none absolute left-3 top-14 flex items-center gap-2 rounded-md border border-cyan-700/60 bg-slate-900/90 px-3 py-1.5 font-mono text-[11px] text-cyan-300 shadow-lg">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
          场计算中 {((props.computePct ?? 0) * 100).toFixed(0)}%
        </div>
      )}

      {/* CAD 动态输入框（跟随笔尖） */}
      {fl?.active && tipScreen && (
        <div
          className="pointer-events-none absolute z-10 space-y-1"
          style={{ left: tipScreen.x + 14, top: tipScreen.y + 10 }}
        >
          {fl.mode === 'line' && fl.placing && (
            <>
              <div
                className={`rounded border px-2 py-0.5 font-mono text-[11px] shadow ${
                  focusBox === 'len' ? 'border-cyan-400 bg-slate-900/95' : 'border-slate-600 bg-slate-900/80'
                }`}
              >
                <span className="text-slate-400">长度 </span>
                <span className={lenStr !== '' ? 'text-amber-300' : 'text-slate-300'}>
                  {lenStr !== '' ? lenStr : hover ? mouseLenMm.toFixed(0) : '—'}
                </span>
                <span className="text-slate-500"> mm{lenLockedMm !== null ? ' 🔒' : ''}</span>
              </div>
              <div
                className={`rounded border px-2 py-0.5 font-mono text-[11px] shadow ${
                  focusBox === 'ang' ? 'border-cyan-400 bg-slate-900/95' : 'border-slate-600 bg-slate-900/80'
                }`}
              >
                <span className="text-slate-400">角度 </span>
                <span className={angStr !== '' ? 'text-amber-300' : 'text-slate-300'}>
                  {angStr !== '' ? angStr : hover ? mouseAngDeg.toFixed(0) : '—'}
                </span>
                <span className="text-slate-500"> °（切线0° 左+右−）{angLockedDeg !== null ? '🔒' : ''}</span>
              </div>
              <div className="rounded bg-slate-900/70 px-1.5 py-0.5 text-[9px] text-slate-500">
                键入数字锁定 · Tab 切换 · Esc 清空 · Enter 落点
              </div>
            </>
          )}
          {fl.mode === 'arc' && (
            <div className="rounded border border-cyan-400 bg-slate-900/95 px-2 py-0.5 font-mono text-[11px] shadow">
              <span className="text-slate-400">圆心角 </span>
              <span className="text-amber-300">{fl.arcAngleDeg}</span>
              <span className="text-slate-500"> °（键入数字修改，Enter 铺设）</span>
            </div>
          )}
        </div>
      )}

      {/* 视图操作提示 + 复位 */}
      <div className="absolute bottom-2 right-2 flex items-center gap-2">
        {props.cornerRulers && props.cornerRulers.length > 0 && (
          <button
            className={`rounded border px-2 py-1 text-[10px] ${
              showRulers
                ? 'border-sky-700 bg-sky-950/60 text-sky-300'
                : 'border-slate-600 bg-slate-800 text-slate-400 hover:bg-slate-700'
            }`}
            title="转角顶点两侧 300mm 刻度标尺（短段按实际段长）"
            onClick={() => setShowRulers((v) => !v)}
          >
            转角刻度
          </button>
        )}
        <span className="pointer-events-none rounded bg-slate-900/70 px-2 py-1 text-[10px] text-slate-500">
          滚轮缩放 · 中键/空格+拖拽平移
        </span>
        <button
          className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-[10px] text-slate-300 hover:bg-slate-700"
          onClick={resetView}
        >
          复位视图
        </button>
      </div>

      {probe && (
        <div className="pointer-events-none absolute right-3 top-3 rounded-md border border-slate-700 bg-slate-900/90 px-3 py-2 font-mono text-[11px] leading-5 text-slate-200 shadow-lg">
          <div className="mb-1 text-slate-400">探针</div>
          <div>x = {(probe.x * 1000).toFixed(0)} mm　y = {(probe.y * 1000).toFixed(0)} mm</div>
          <div>Bx = {fmt(probe.bx)} μT　By = {fmt(probe.by)} μT</div>
          <div>Bz = {fmt(probe.bz)} μT　|B| = {fmt(probe.bmag)} μT</div>
          {probe.nearTrack && (
            <div className="mt-1 border-t border-slate-700 pt-1 text-amber-300">
              赛道线：线径 0.5mm（线宽为真实比例）
            </div>
          )}
        </div>
      )}
    </div>
  );
}
