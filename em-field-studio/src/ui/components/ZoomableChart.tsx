/**
 * 折线图统一缩放封装（程序设计说明.md §3.4）：
 * 鼠标框选 / 滚轮放大目标区间，Shift+拖拽或中键拖拽平移，双击 / 复位按钮回到全量程。
 *
 * 用法：zoom = useChartZoom(fullMin, fullMax)
 * - zoom.domain        当前可见 x 域（传给 XAxis domain 或自定义 SVG 映射）；
 * - zoom.zoomed        是否处于放大状态（显示"复位"按钮）；
 * - zoom.box           框选进行中的视口小数区间 [f0, f1]（画选框用）；
 * - beginBox/beginPan(frac)  鼠标按下（frac = 光标在绘图区宽度内的小数位置）；
 * - dragTo(frac) / endDrag(frac)  拖动 / 抬起；
 * - wheelAt(frac, deltaY)    滚轮缩放（以光标位置为中心）；
 * - attachWheel(el, fracOf)  绑定非被动 wheel 监听（可 preventDefault），返回清理函数；
 * - reset()                  回全量程。
 */
import { useCallback, useRef, useState } from 'react';

export interface ChartZoom {
  domain: [number, number];
  zoomed: boolean;
  box: [number, number] | null;
  beginBox: (frac: number) => void;
  beginPan: (frac: number) => void;
  dragTo: (frac: number) => void;
  endDrag: (frac: number) => void;
  wheelAt: (frac: number, deltaY: number) => void;
  reset: () => void;
  attachWheel: (
    el: HTMLElement | SVGSVGElement | null,
    fracOf: (clientX: number, rect: DOMRect) => number,
  ) => () => void;
}

/** 最小可视窗口占全量程比例（防止无限放大） */
const MIN_SPAN_FRAC = 0.02;

export function useChartZoom(fullMin: number, fullMax: number): ChartZoom {
  const [domain, setDomain] = useState<[number, number] | null>(null);
  const [box, setBox] = useState<[number, number] | null>(null);
  const dragRef = useRef<{ mode: 'box' | 'pan'; f0: number; d0: number; d1: number } | null>(
    null,
  );

  const fullSpan = Math.max(fullMax - fullMin, 1e-12);
  const cur: [number, number] = domain ?? [fullMin, fullMax];

  /** 域钳位到全量程内（保持窗口宽度），等于全量程时回 null */
  const commit = useCallback(
    (d0: number, d1: number) => {
      let span = d1 - d0;
      span = Math.min(fullSpan, Math.max(fullSpan * MIN_SPAN_FRAC, span));
      let a = d0;
      if (a < fullMin) a = fullMin;
      if (a + span > fullMax) a = fullMax - span;
      if (span >= fullSpan - 1e-12) setDomain(null);
      else setDomain([a, a + span]);
    },
    [fullMin, fullMax, fullSpan],
  );

  const beginBox = useCallback(
    (frac: number) => {
      dragRef.current = { mode: 'box', f0: frac, d0: cur[0], d1: cur[1] };
      setBox([frac, frac]);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cur[0], cur[1]],
  );

  const beginPan = useCallback(
    (frac: number) => {
      dragRef.current = { mode: 'pan', f0: frac, d0: cur[0], d1: cur[1] };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cur[0], cur[1]],
  );

  const dragTo = useCallback(
    (frac: number) => {
      const d = dragRef.current;
      if (!d) return;
      if (d.mode === 'box') {
        setBox([d.f0, frac]);
      } else {
        const span = d.d1 - d.d0;
        commit(d.d0 - (frac - d.f0) * span, d.d1 - (frac - d.f0) * span);
      }
    },
    [commit],
  );

  const endDrag = useCallback(
    (frac: number) => {
      const d = dragRef.current;
      dragRef.current = null;
      setBox(null);
      if (!d || d.mode !== 'box') return;
      const a = Math.min(d.f0, frac);
      const b = Math.max(d.f0, frac);
      if (b - a < 0.02) return; // 误触（单击）不缩放
      const span = d.d1 - d.d0;
      commit(d.d0 + a * span, d.d0 + b * span);
    },
    [commit],
  );

  const wheelAt = useCallback(
    (frac: number, deltaY: number) => {
      const span = cur[1] - cur[0];
      const center = cur[0] + Math.min(1, Math.max(0, frac)) * span;
      const factor = Math.exp(deltaY * 0.0015); // 上滚放大（span 变小）
      const half = (span / 2) * factor;
      commit(center - half, center + half);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cur[0], cur[1], commit],
  );

  const reset = useCallback(() => setDomain(null), []);

  /** 绑定非被动 wheel 监听（preventDefault 阻止面板滚动），fracOf 给出光标在绘图区内的小数位置 */
  const attachWheel = useCallback(
    (
      el: HTMLElement | SVGSVGElement | null,
      fracOf: (clientX: number, rect: DOMRect) => number,
    ) => {
      if (!el) return () => {};
      const onWheel = (e: Event) => {
        const we = e as WheelEvent;
        we.preventDefault();
        const rect = el.getBoundingClientRect();
        wheelAt(fracOf(we.clientX, rect), we.deltaY);
      };
      el.addEventListener('wheel', onWheel, { passive: false });
      return () => el.removeEventListener('wheel', onWheel);
    },
    [wheelAt],
  );

  return {
    domain: cur,
    zoomed: domain !== null,
    box,
    beginBox,
    beginPan,
    dragTo,
    endDrag,
    wheelAt,
    reset,
    attachWheel,
  };
}

/** 复位按钮（放大后显示于图右上角） */
export function ZoomResetButton({ onReset }: { onReset: () => void }) {
  return (
    <button
      className="absolute right-1 top-1 z-20 rounded border border-slate-600 bg-slate-800/95 px-1.5 py-0.5 text-[10px] text-slate-300 shadow hover:bg-slate-700"
      title="回到全量程（也可双击图面）"
      onClick={(e) => {
        e.stopPropagation();
        onReset();
      }}
    >
      ⟲ 复位
    </button>
  );
}

/** 缩放交互提示（图下方小字） */
export const ZOOM_HINT = '框选/滚轮放大 · Shift+拖拽平移 · 双击复位';
