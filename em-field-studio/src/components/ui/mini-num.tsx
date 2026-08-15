/**
 * 小型数字输入（失焦/Enter 提交；键入过程不回写，避免半成品数值打断输入）。
 * 由 TrackingPanel 提取为共享组件（2026-08-15 UI 改造），供滑块当前值/量程、
 * 车体位姿读数等"可直接键入精确值"的场景复用。
 */
import { useState } from 'react';

export function MiniNum({
  value,
  onCommit,
  className,
  title,
  digits,
}: {
  value: number;
  onCommit: (v: number) => void;
  className?: string;
  title?: string;
  digits?: number;
}) {
  const [s, setS] = useState<string | null>(null);
  const fmt = (v: number) => {
    const r = digits !== undefined ? v.toFixed(digits) : String(Math.round(v * 1000) / 1000);
    return r;
  };
  const commit = () => {
    if (s !== null) {
      const v = parseFloat(s);
      if (Number.isFinite(v)) onCommit(v);
      setS(null);
    }
  };
  return (
    <input
      className={`h-5 rounded border border-slate-700 bg-slate-900 px-1 text-center font-mono text-[10px] text-slate-300 outline-none transition-colors hover:border-slate-500 focus:border-cyan-600 ${className ?? ''}`}
      value={s ?? fmt(value)}
      title={title}
      onChange={(e) => setS(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        e.stopPropagation();
      }}
    />
  );
}
