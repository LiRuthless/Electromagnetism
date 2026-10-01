/**
 * 折线图浮动容器（程序设计说明.md §3.5）：
 * 除电感读数剖面图外的折线图均可"拖出"为中央画布上的浮动窗口。
 *
 * - 拖出：按住图表标题栏拖入中央画布区域即转为浮动窗；或点标题栏"⧉"按钮直接浮出于画布中央；
 * - 移动：浮动窗标题栏拖拽（不越出中央画布范围）；
 * - 缩放：边框/四角拖拽拉伸（最小 240×160 px，图表内容随尺寸重排）；
 * - 收回：点"收回"按钮回到原面板位置（不销毁图表数据）；
 * - z 序：后弹出/最近操作的在上；
 * - 浮动状态（是否浮出、x/y/宽/高）由 Home 持久化（appState v6 `floatingCharts`）。
 *
 * 架构：Home 在中央画布区提供 portal 宿主层与状态表（FloatingLayerContext）；
 * 浮动时图表内容经 createPortal 渲染进宿主层，原位留占位条。
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import type { FloatingChartsMap, FloatingChartState } from '../utils/appState';

/** 浮动层上下文：portal 宿主元素 + 各图表浮动状态 + z 序 */
export interface FloatingCtx {
  layerEl: HTMLElement | null;
  states: FloatingChartsMap;
  setChart: (id: string, patch: Partial<FloatingChartState>) => void;
  zOrder: string[];
  bringToFront: (id: string) => void;
}
export const FloatingLayerContext = createContext<FloatingCtx | null>(null);

export const FLOAT_MIN_W = 240;
export const FLOAT_MIN_H = 160;

interface Props {
  /** 图表唯一 id（持久化 key）：sweep / trajSensors / trkErr / trkWheels / measuredFit */
  id: string;
  title: string;
  /** 浮出时的初始尺寸（px） */
  defaultW?: number;
  defaultH?: number;
  /** 标题栏右侧附加内容（如双图切换 Tab） */
  headerExtra?: ReactNode;
  /**
   * 图表内容。inline 时 w/h 为 null（自然尺寸）；
   * 浮动时为窗口内尺寸（px），图表应随尺寸重排。
   */
  children: (w: number | null, h: number | null) => ReactNode;
}

type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export default function FloatingChart({
  id,
  title,
  defaultW = 420,
  defaultH = 280,
  headerExtra,
  children,
}: Props) {
  const ctx = useContext(FloatingLayerContext);
  const st = ctx?.states[id];
  const floating = !!st?.floating;
  // 拖出过程中（按住内联标题栏拖向画布）的临时态
  const [dragOutHint, setDragOutHint] = useState(false);

  const layerRect = useCallback(() => ctx?.layerEl?.getBoundingClientRect() ?? null, [ctx]);

  /** 浮出于画布中央（或指定点） */
  const popOut = useCallback(
    (atClientX?: number, atClientY?: number) => {
      if (!ctx?.layerEl) return;
      const r = ctx.layerEl.getBoundingClientRect();
      const w = Math.min(defaultW, Math.max(FLOAT_MIN_W, r.width - 16));
      const h = Math.min(defaultH, Math.max(FLOAT_MIN_H, r.height - 16));
      let x = (r.width - w) / 2;
      let y = (r.height - h) / 2;
      if (atClientX !== undefined && atClientY !== undefined) {
        x = atClientX - r.left - w / 2;
        y = atClientY - r.top - 12;
      }
      x = Math.min(Math.max(0, x), Math.max(0, r.width - w));
      y = Math.min(Math.max(0, y), Math.max(0, r.height - h));
      ctx.setChart(id, { floating: true, x, y, w, h });
      ctx.bringToFront(id);
    },
    [ctx, id, defaultW, defaultH],
  );

  const dock = useCallback(() => ctx?.setChart(id, { floating: false }), [ctx, id]);

  // 内联标题栏拖拽：进入中央画布区域即转为浮动窗并继续拖动
  const onInlineTitleDown = (ev: React.PointerEvent) => {
    if (!ctx?.layerEl || ev.button !== 0) return;
    ev.preventDefault();
    let popped = false;
    const move = (e: PointerEvent) => {
      const r = layerRect();
      if (!r) return;
      const inside =
        e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      setDragOutHint(inside);
      if (inside && !popped) {
        popped = true;
        popOut(e.clientX, e.clientY);
        startMove(e);
      }
    };
    const up = () => {
      setDragOutHint(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // 浮动窗移动（标题栏拖拽，钳位在画布范围内）
  const startMove = (e: PointerEvent | React.PointerEvent) => {
    if (!ctx?.layerEl || !st) return;
    const r = ctx.layerEl.getBoundingClientRect();
    const offX = e.clientX - r.left - st.x;
    const offY = e.clientY - r.top - st.y;
    const move = (ev: PointerEvent) => {
      const x = Math.min(Math.max(0, ev.clientX - r.left - offX), Math.max(0, r.width - st.w));
      const y = Math.min(Math.max(0, ev.clientY - r.top - offY), Math.max(0, r.height - st.h));
      ctx.setChart(id, { x, y });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onFloatTitleDown = (ev: React.PointerEvent) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    ctx?.bringToFront(id);
    startMove(ev);
  };

  // 边框/四角拉伸
  const startResize = (dir: ResizeDir) => (ev: React.PointerEvent) => {
    if (!ctx?.layerEl || !st || ev.button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    ctx.bringToFront(id);
    const r = ctx.layerEl.getBoundingClientRect();
    const s0 = { x: st.x, y: st.y, w: st.w, h: st.h };
    const p0 = { x: ev.clientX, y: ev.clientY };
    const move = (e: PointerEvent) => {
      const dx = e.clientX - p0.x;
      const dy = e.clientY - p0.y;
      let { x, y, w, h } = s0;
      if (dir.includes('e')) w = s0.w + dx;
      if (dir.includes('s')) h = s0.h + dy;
      if (dir.includes('w')) {
        w = s0.w - dx;
        x = s0.x + dx;
      }
      if (dir.includes('n')) {
        h = s0.h - dy;
        y = s0.y + dy;
      }
      if (w < FLOAT_MIN_W) {
        if (dir.includes('w')) x -= FLOAT_MIN_W - w;
        w = FLOAT_MIN_W;
      }
      if (h < FLOAT_MIN_H) {
        if (dir.includes('n')) y -= FLOAT_MIN_H - h;
        h = FLOAT_MIN_H;
      }
      x = Math.min(Math.max(0, x), Math.max(0, r.width - w));
      y = Math.min(Math.max(0, y), Math.max(0, r.height - h));
      w = Math.min(w, r.width - x);
      h = Math.min(h, r.height - y);
      ctx.setChart(id, { x, y, w, h });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // 无浮动层上下文（异常兜底）：直接内联渲染
  if (!ctx) return <>{children(null, null)}</>;

  const titleBar = (floatMode: boolean) => (
    <div
      className={`flex h-6 shrink-0 items-center gap-1.5 rounded-t border-b border-slate-700 bg-slate-800/95 px-1.5 select-none ${
        dragOutHint ? 'ring-1 ring-cyan-400' : ''
      }`}
      style={{ cursor: floatMode ? 'move' : 'grab', touchAction: 'none' }}
      onPointerDown={floatMode ? onFloatTitleDown : onInlineTitleDown}
      title={floatMode ? '拖拽移动 · 边框/四角拉伸' : '按住拖入中央画布浮出，或点 ⧉'}
    >
      <span className="min-w-0 flex-1 truncate text-[10px] font-semibold text-slate-300">
        {title}
      </span>
      {headerExtra}
      {floatMode ? (
        <button
          className="rounded border border-slate-600 bg-slate-700/60 px-1.5 text-[10px] text-slate-300 hover:bg-slate-600"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={dock}
        >
          收回
        </button>
      ) : (
        <button
          className="rounded border border-slate-600 bg-slate-700/60 px-1.5 text-[10px] text-slate-300 hover:bg-slate-600"
          title="浮出到中央画布"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => popOut()}
        >
          ⧉
        </button>
      )}
    </div>
  );

  // 浮动：portal 到画布宿主层；原位留占位条
  if (floating && st && ctx.layerEl) {
    const z = 20 + ctx.zOrder.indexOf(id);
    const innerW = st.w - 2; // 边框
    const innerH = st.h - 26; // 标题栏 + 边框
    const handles: { dir: ResizeDir; style: React.CSSProperties; cursor: string }[] = [
      { dir: 'n', style: { left: 8, right: 8, top: -3, height: 7 }, cursor: 'ns-resize' },
      { dir: 's', style: { left: 8, right: 8, bottom: -3, height: 7 }, cursor: 'ns-resize' },
      { dir: 'e', style: { top: 8, bottom: 8, right: -3, width: 7 }, cursor: 'ew-resize' },
      { dir: 'w', style: { top: 8, bottom: 8, left: -3, width: 7 }, cursor: 'ew-resize' },
      { dir: 'ne', style: { right: -4, top: -4, width: 10, height: 10 }, cursor: 'nesw-resize' },
      { dir: 'nw', style: { left: -4, top: -4, width: 10, height: 10 }, cursor: 'nwse-resize' },
      { dir: 'se', style: { right: -4, bottom: -4, width: 10, height: 10 }, cursor: 'nwse-resize' },
      { dir: 'sw', style: { left: -4, bottom: -4, width: 10, height: 10 }, cursor: 'nesw-resize' },
    ];
    return (
      <>
        {/* 原位占位条 */}
        <div className="flex h-7 items-center justify-between rounded border border-dashed border-slate-600 bg-slate-800/30 px-2">
          <span className="text-[10px] text-slate-500">{title}（已浮出到画布）</span>
          <button
            className="rounded border border-slate-600 bg-slate-700/60 px-1.5 text-[10px] text-slate-300 hover:bg-slate-600"
            onClick={dock}
          >
            收回
          </button>
        </div>
        {createPortal(
          <div
            className="pointer-events-auto absolute overflow-visible rounded border border-slate-600 bg-slate-900/95 shadow-2xl"
            style={{ left: st.x, top: st.y, width: st.w, height: st.h, zIndex: z }}
            onPointerDown={() => ctx.bringToFront(id)}
          >
            {titleBar(true)}
            <div className="overflow-hidden" style={{ width: innerW, height: innerH }}>
              {children(innerW, innerH)}
            </div>
            {handles.map((hd) => (
              <div
                key={hd.dir}
                className="absolute"
                style={{ ...hd.style, cursor: hd.cursor, touchAction: 'none' }}
                onPointerDown={startResize(hd.dir)}
              />
            ))}
            {/* 右下角可视化拉伸把手 */}
            <div className="pointer-events-none absolute bottom-0.5 right-0.5 text-[9px] text-slate-500">
              ◢
            </div>
          </div>,
          ctx.layerEl,
        )}
      </>
    );
  }

  // 内联
  return (
    <div className="rounded border border-slate-700/70 bg-slate-900/40">
      {titleBar(false)}
      <div className="p-1">{children(null, null)}</div>
    </div>
  );
}

/** Home 侧：浮动层宿主 + 状态管理 hook 的 z 序辅助 */
export function useFloatingZOrder() {
  const [zOrder, setZOrder] = useState<string[]>([]);
  const bringToFront = useCallback((id: string) => {
    setZOrder((z) => [...z.filter((x) => x !== id), id]);
  }, []);
  // 首次浮出时也进入 z 序
  const ensure = useCallback((id: string) => {
    setZOrder((z) => (z.includes(id) ? z : [...z, id]));
  }, []);
  return { zOrder, bringToFront, ensure };
}

/** 浮动层宿主元素（Home 渲染于中央画布区，portal 目标） */
export function FloatingLayerHost({
  hostRef,
}: {
  hostRef: (el: HTMLElement | null) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    hostRef(ref.current);
    return () => hostRef(null);
  }, [hostRef]);
  return <div ref={ref} className="pointer-events-none absolute inset-0 z-30 overflow-hidden" />;
}
