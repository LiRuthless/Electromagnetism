/**
 * 循迹轨迹电感值曲线（程序设计说明.md §3.3 / §4.5）：
 * 直接取循迹仿真结果 TrackingResult.sensorU（车体在轨迹实际位姿上读到的各电感 U），
 * 横轴可选 时间 t（s）/ 轨迹弧长 s（mm，各步位移累加）。
 *
 * - 数据只取到冲线点 finishIndex（与画布轨迹一致）；
 * - 竖线标记当前轨迹进度 trajT；
 * - 统一缩放（程序设计说明.md §3.4）；点击数据点联动车位（程序设计说明.md §3.6）：onPointClick(t) 由 Home 切换
 *   位姿来源到"跟随仿真轨迹"并定位 trajT；
 * - 纯 SVG 手绘，风格与 SensorSweepChart 统一。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { TrackingResult } from '../mathmodel/kinematics';
import { useChartZoom, ZoomResetButton, ZOOM_HINT } from './ZoomableChart';

export type TrajAxisMode = 't' | 's';

interface Props {
  result: TrackingResult;
  axisMode: TrajAxisMode;
  onAxisModeChange: (m: TrajAxisMode) => void;
  /** 当前轨迹进度（s），画竖线标记 */
  currentT: number;
  /** 点击数据点联动车位（程序设计说明.md §3.6）：参数为该点时间 t（s） */
  onPointClick?: (tSec: number) => void;
}

const PALETTE = [
  '#22d3ee',
  '#fbbf24',
  '#e879f9',
  '#34d399',
  '#f87171',
  '#a78bfa',
  '#fb923c',
  '#94a3b8',
  '#4ade80',
  '#f472b6',
];

const W = 326;
const H = 210;
const PAD = { l: 36, r: 8, t: 30, b: 26 };

export default function TrackingSensorChart({
  result,
  axisMode,
  onAxisModeChange,
  currentT,
  onPointClick,
}: Props) {
  const [hover, setHover] = useState<{ i: number; cx: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const downFracRef = useRef<number | null>(null);

  // 数据点（0..finishIndex）与两套横轴
  const { xs, ts, series, xUnit, xMax } = useMemo(() => {
    const n = Math.max(1, result.finishIndex + 1);
    const ts: number[] = [];
    const arc: number[] = [];
    let acc = 0;
    for (let i = 0; i < n; i++) {
      ts.push(result.t[i]);
      if (i > 0) acc += Math.hypot(result.x[i] - result.x[i - 1], result.y[i] - result.y[i - 1]);
      arc.push(acc * 1000); // mm
    }
    const xs = axisMode === 't' ? ts : arc;
    const series = result.sensorU.map((su) => ({ name: su.name, values: su.values.slice(0, n) }));
    return {
      xs,
      ts,
      series,
      xUnit: axisMode === 't' ? 's' : 'mm',
      xMax: xs[xs.length - 1] || 1,
    };
  }, [result, axisMode]);

  const zoom = useChartZoom(0, xMax);
  const [xMin, xMaxD] = zoom.domain;
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const fracOf = (clientX: number, rect: DOMRect) => {
    const px = ((clientX - rect.left) / rect.width) * W;
    return (px - PAD.l) / plotW;
  };
  useEffect(() => zoom.attachWheel(svgRef.current, fracOf), [zoom]);

  const uMax = useMemo(() => {
    let m = 0;
    for (const se of series) {
      for (let i = 0; i < se.values.length; i++) {
        const x = xs[i];
        if (x >= xMin && x <= xMaxD && se.values[i] > m) m = se.values[i];
      }
    }
    return Math.max(1e-9, m) * 1.12;
  }, [series, xs, xMin, xMaxD]);
  const uDigits = uMax < 0.15 ? 3 : uMax < 1.5 ? 2 : 1;

  const toX = (x: number) => PAD.l + ((x - xMin) / (xMaxD - xMin)) * plotW;
  const toY = (u: number) => PAD.t + plotH - (u / uMax) * plotH;

  // x 刻度（~5 个）
  const xticks: number[] = [];
  {
    const span = xMaxD - xMin;
    const raw = span / 5;
    const mag = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-9))));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= 6) ?? 10 * mag;
    for (let v = Math.ceil(xMin / step) * step; v <= xMaxD + 1e-9; v += step) xticks.push(v);
  }

  const xStep = xs.length > 1 ? xs[1] - xs[0] : 1;
  const lineOf = (values: number[]) => {
    let d = '';
    let started = false;
    for (let i = 0; i < values.length; i++) {
      const x = xs[i];
      if (x < xMin - xStep || x > xMaxD + xStep) continue;
      d += `${started ? 'L' : 'M'}${toX(x).toFixed(1)} ${toY(values[i]).toFixed(1)}`;
      started = true;
    }
    return d;
  };

  /** 由视口小数位置找最近数据点索引 */
  const indexAtFrac = (f: number) => {
    const x = xMin + f * (xMaxD - xMin);
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < xs.length; i++) {
      const d = Math.abs(xs[i] - x);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  };

  const onMove = (ev: React.MouseEvent<SVGRectElement>) => {
    const rect = (ev.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
    const i = indexAtFrac(fracOf(ev.clientX, rect));
    if (i >= 0 && i < xs.length) setHover({ i, cx: toX(xs[i]) });
  };

  const onSvgMouseDown = (ev: React.MouseEvent<SVGSVGElement>) => {
    if (ev.button === 2) return;
    const rect = ev.currentTarget.getBoundingClientRect();
    const f = fracOf(ev.clientX, rect);
    downFracRef.current = f;
    if (ev.button === 1 || ev.shiftKey) zoom.beginPan(f);
    else zoom.beginBox(f);
    ev.preventDefault();
  };
  const onSvgMouseMove = (ev: React.MouseEvent<SVGSVGElement>) => {
    const rect = ev.currentTarget.getBoundingClientRect();
    zoom.dragTo(fracOf(ev.clientX, rect));
  };
  const onSvgMouseUp = (ev: React.MouseEvent<SVGSVGElement>) => {
    const rect = ev.currentTarget.getBoundingClientRect();
    const f = fracOf(ev.clientX, rect);
    zoom.endDrag(f);
    // 单击（非框选）：联动车位（程序设计说明.md §3.6）
    const f0 = downFracRef.current;
    downFracRef.current = null;
    if (f0 !== null && Math.abs(f - f0) < 0.02 && onPointClick) {
      onPointClick(ts[indexAtFrac(f)]);
    }
  };

  // 当前轨迹进度竖线（t -> 当前横轴坐标）
  const curIdx = useMemo(() => {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < ts.length; i++) {
      const d = Math.abs(ts[i] - currentT);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }, [ts, currentT]);
  const curX = toX(xs[curIdx]);
  const curVisible = xs[curIdx] >= xMin && xs[curIdx] <= xMaxD;

  const fmtX = (v: number) =>
    axisMode === 't' ? `${v.toFixed(v < 10 ? 1 : 0)}` : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${v.toFixed(0)}`;

  return (
    <div className="relative">
      {zoom.zoomed && <ZoomResetButton onReset={zoom.reset} />}
      {/* 横轴切换 */}
      <div className="mb-1 flex items-center gap-1 text-[10px] text-slate-500">
        <span>横轴：</span>
        {(['t', 's'] as const).map((m) => (
          <button
            key={m}
            className={`rounded border px-1.5 py-0.5 ${
              axisMode === m
                ? 'border-cyan-600 bg-cyan-950/50 text-cyan-300'
                : 'border-slate-700 bg-slate-800 text-slate-400 hover:bg-slate-700'
            }`}
            onClick={() => onAxisModeChange(m)}
          >
            {m === 't' ? '时间 t' : '轨迹弧长 s'}
          </button>
        ))}
        <span className="ml-auto text-slate-600">点击数据点 → 车移到该时刻</span>
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full select-none"
        style={{ cursor: 'crosshair' }}
        onMouseDown={onSvgMouseDown}
        onMouseMove={onSvgMouseMove}
        onMouseUp={onSvgMouseUp}
        onDoubleClick={zoom.reset}
      >
        {/* y 网格线 */}
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line
              x1={PAD.l}
              x2={W - PAD.r}
              y1={toY(uMax * f)}
              y2={toY(uMax * f)}
              stroke={f === 0 ? '#64748b' : '#334155'}
              strokeDasharray={f === 0 ? undefined : '3 3'}
              strokeWidth={f === 0 ? 1 : 0.6}
            />
            <text x={PAD.l - 4} y={toY(uMax * f) + 3} textAnchor="end" fontSize={8} fill="#64748b">
              {(uMax * f).toFixed(uDigits)}
            </text>
          </g>
        ))}
        {/* x 刻度 */}
        {xticks.map((v) => (
          <g key={v}>
            <line x1={toX(v)} x2={toX(v)} y1={toY(0)} y2={toY(0) + 3} stroke="#64748b" strokeWidth={0.8} />
            <text x={toX(v)} y={toY(0) + 11} textAnchor="middle" fontSize={8} fill="#64748b">
              {fmtX(v)}
            </text>
          </g>
        ))}
        <text x={PAD.l + plotW / 2} y={H - 3} textAnchor="middle" fontSize={8.5} fill="#64748b">
          {axisMode === 't' ? '时间 t（s）' : '轨迹弧长 s（mm）'}
        </text>
        {/* 各电感曲线 */}
        {series.map((se, j) => (
          <path
            key={se.name}
            d={lineOf(se.values)}
            fill="none"
            stroke={PALETTE[j % PALETTE.length]}
            strokeWidth={1.2}
            opacity={0.9}
          />
        ))}
        {/* 当前轨迹进度参考线 */}
        {curVisible && (
          <>
            <line x1={curX} x2={curX} y1={PAD.t - 4} y2={toY(0)} stroke="#f8fafc" strokeWidth={1} strokeDasharray="4 2" opacity={0.85} />
            <text x={curX} y={PAD.t - 7} textAnchor="middle" fontSize={8} fill="#f8fafc">
              当前
            </text>
          </>
        )}
        {/* 悬停吸附点 */}
        {hover && (
          <g>
            <line x1={hover.cx} x2={hover.cx} y1={PAD.t} y2={toY(0)} stroke="#475569" strokeWidth={0.6} />
            {series.map((se, j) => (
              <circle
                key={se.name}
                cx={hover.cx}
                cy={toY(se.values[hover.i])}
                r={2.6}
                fill={PALETTE[j % PALETTE.length]}
                stroke="#0f172a"
                strokeWidth={0.8}
              />
            ))}
            <g transform={`translate(${Math.min(hover.cx + 6, W - 118)}, ${PAD.t + 2})`}>
              <rect
                width={112}
                height={14 + series.length * 11}
                rx={3}
                fill="#0f172a"
                opacity={0.92}
                stroke="#334155"
                strokeWidth={0.6}
              />
              <text x={5} y={10} fontSize={8} fill="#cbd5e1">
                t = {ts[hover.i].toFixed(2)} s{axisMode === 's' ? ` · s = ${xs[hover.i].toFixed(0)} mm` : ''}
              </text>
              {series.map((se, j) => (
                <text key={se.name} x={5} y={20 + j * 11} fontSize={8} fill={PALETTE[j % PALETTE.length]}>
                  {se.name}: {se.values[hover.i].toFixed(3)}
                </text>
              ))}
            </g>
          </g>
        )}
        {/* 图例 */}
        <g fontSize={8}>
          {series.map((se, j) => {
            const perRow = Math.ceil(series.length / 2);
            const col = j % perRow;
            const row = Math.floor(j / perRow);
            return (
              <g key={se.name} transform={`translate(${PAD.l + col * 44}, ${8 + row * 11})`}>
                <line x1={0} x2={10} y1={0} y2={0} stroke={PALETTE[j % PALETTE.length]} strokeWidth={1.6} />
                <text x={13} y={3} fill="#94a3b8">
                  {se.name}
                </text>
              </g>
            );
          })}
        </g>
        {/* 悬停热区 */}
        <rect
          x={PAD.l}
          y={PAD.t}
          width={plotW}
          height={plotH}
          fill="transparent"
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
          style={{ cursor: 'crosshair' }}
        />
        {/* 框选选区 */}
        {zoom.box && (
          <rect
            x={PAD.l + Math.min(zoom.box[0], zoom.box[1]) * plotW}
            y={PAD.t}
            width={Math.abs(zoom.box[1] - zoom.box[0]) * plotW}
            height={plotH}
            fill="rgba(56,189,248,0.15)"
            stroke="#38bdf8"
            strokeWidth={0.8}
            strokeDasharray="3 2"
          />
        )}
      </svg>
      <div className="mt-0.5 text-center text-[9px] text-slate-600">{ZOOM_HINT}</div>
      <div className="text-center text-[9px] text-slate-600">横轴单位：{xUnit} · 数据到冲线点（{ts.length} 步）</div>
    </div>
  );
}
