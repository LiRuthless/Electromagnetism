/**
 * 全程扫描折线图：U 随沿线位置 s 变化（"传感器全程曲线"）。
 *
 * - x 轴：沿线位置 s（mm），0..赛道全长，刻度按总长自适应取整档；
 * - y 轴：读数幅值 |u| = k·cosθ·B（Vpp），每个电感一条折线（按电感着色 + 名称图例）；
 * - 竖直参考线标记当前 s 滑块位置，拖动滑块时实时移动；
 * - 纯 SVG 手绘，风格与 SensorChart（剖面图）统一。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SweepResult } from '../mathmodel/sweep';
import { useChartZoom, ZoomResetButton, ZOOM_HINT } from './ZoomableChart';

interface Props {
  sweep: SweepResult;
  /** 当前 s 滑块位置（mm） */
  currentSMm: number;
  /** 点击数据点联动车位（程序设计说明.md §3.6）：参数为该点弧长 s（mm），由 Home 切手动位姿并设 s */
  onPointClick?: (sMm: number) => void;
}

/** 按电感着色（与剖面图的"按敏感轴"不同——此处多条曲线需按名称区分） */
const PALETTE = [
  '#22d3ee', // cyan
  '#fbbf24', // amber
  '#e879f9', // magenta
  '#34d399', // emerald
  '#f87171', // red
  '#a78bfa', // violet
  '#fb923c', // orange
  '#94a3b8', // slate
  '#4ade80', // green
  '#f472b6', // pink
];

const W = 326;
const H = 210;
const PAD = { l: 36, r: 8, t: 30, b: 26 };

/** 自适应 x 刻度步长（mm）：目标 ~5 个刻度 */
function tickStepMm(totalMm: number): number {
  const cands = [50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000];
  for (const c of cands) if (totalMm / c <= 6) return c;
  return 20000;
}

export default function SensorSweepChart({ sweep, currentSMm, onPointClick }: Props) {
  const [hover, setHover] = useState<{ i: number; cx: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const downFracRef = useRef<number | null>(null);

  const totalMm = sweep.sMm[sweep.sMm.length - 1] || 1;
  // 统一缩放（程序设计说明.md §3.4）：框选/滚轮放大，Shift+拖拽平移，双击/按钮复位
  const zoom = useChartZoom(0, totalMm);
  const [sMin, sMax] = zoom.domain;
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const fracOf = (clientX: number, rect: DOMRect) => {
    const px = ((clientX - rect.left) / rect.width) * W;
    return (px - PAD.l) / plotW;
  };
  useEffect(() => zoom.attachWheel(svgRef.current, fracOf), [zoom]);

  // y 量程随可见 s 区间内的采样点自适应（放大后自动拉伸）
  const uMax = useMemo(() => {
    let m = 0;
    for (const se of sweep.series) {
      for (let i = 0; i < se.values.length; i++) {
        const smm = sweep.sMm[i];
        if (smm >= sMin && smm <= sMax && se.values[i] > m) m = se.values[i];
      }
    }
    return Math.max(1e-9, m) * 1.12; // V（Vpp），顶部留白
  }, [sweep, sMin, sMax]);
  // 刻度小数位随量程自适应（远端读数可 <0.1 V）
  const uDigits = uMax < 0.15 ? 3 : uMax < 1.5 ? 2 : 1;
  const fmtU = (v: number) => v.toFixed(uDigits);

  const toX = (smm: number) => PAD.l + ((smm - sMin) / (sMax - sMin)) * plotW;
  const toY = (uT: number) => PAD.t + plotH - (uT / uMax) * plotH;

  const step = tickStepMm(sMax - sMin);
  const xticks: number[] = [];
  for (let v = Math.ceil(sMin / step) * step; v <= sMax + 1e-6; v += step) xticks.push(v);

  const lineOf = (values: Float64Array) => {
    let d = '';
    let started = false;
    for (let i = 0; i < values.length; i++) {
      const smm = sweep.sMm[i];
      if (smm < sMin - sweep.stepMm || smm > sMax + sweep.stepMm) continue; // 留一点边界余量避免断线
      d += `${started ? 'L' : 'M'}${toX(smm).toFixed(1)} ${toY(values[i]).toFixed(1)}`;
      started = true;
    }
    return d;
  };

  // 悬停：吸附到最近采样点
  const onMove = (ev: React.MouseEvent<SVGRectElement>) => {
    const rect = (ev.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
    const px = ((ev.clientX - rect.left) / rect.width) * W;
    const smm = sMin + ((px - PAD.l) / plotW) * (sMax - sMin);
    const i = Math.round(smm / sweep.stepMm);
    if (i >= 0 && i < sweep.sMm.length) setHover({ i, cx: toX(sweep.sMm[i]) });
  };

  // 缩放拖拽（左键框选 / Shift 或中键平移）
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
    // 单击（非框选）：联动车位（程序设计说明.md §3.6）——车移到该点赛道位置
    const f0 = downFracRef.current;
    downFracRef.current = null;
    if (f0 !== null && Math.abs(f - f0) < 0.02 && onPointClick) {
      const smm = sMin + f * (sMax - sMin);
      const i = Math.round(smm / sweep.stepMm);
      if (i >= 0 && i < sweep.sMm.length) onPointClick(sweep.sMm[i]);
    }
  };

  const curX = toX(Math.min(Math.max(currentSMm, 0), totalMm));
  const curVisible = currentSMm >= sMin && currentSMm <= sMax;

  return (
    <div className="relative">
      {zoom.zoomed && <ZoomResetButton onReset={zoom.reset} />}
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
      {/* y 网格线（0 / 1/2 / 满量程） */}
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
            {fmtU(uMax * f)}
          </text>
        </g>
      ))}
      {/* x 刻度 */}
      {xticks.map((v) => (
        <g key={v}>
          <line x1={toX(v)} x2={toX(v)} y1={toY(0)} y2={toY(0) + 3} stroke="#64748b" strokeWidth={0.8} />
          <text x={toX(v)} y={toY(0) + 11} textAnchor="middle" fontSize={8} fill="#64748b">
            {v >= 1000 ? `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k` : v}
          </text>
        </g>
      ))}
      <text x={PAD.l + plotW / 2} y={H - 3} textAnchor="middle" fontSize={8.5} fill="#64748b">
        沿线位置 s（mm）
      </text>
      {/* 各电感曲线 */}
      {sweep.series.map((se, j) => (
        <path
          key={se.name}
          d={lineOf(se.values)}
          fill="none"
          stroke={PALETTE[j % PALETTE.length]}
          strokeWidth={1.2}
          opacity={0.9}
        />
      ))}
      {/* 当前 s 参考线 */}
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
          {sweep.series.map((se, j) => (
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
          {/* tooltip 数值块 */}
          <g transform={`translate(${Math.min(hover.cx + 6, W - 118)}, ${PAD.t + 2})`}>
            <rect
              width={112}
              height={14 + sweep.series.length * 11}
              rx={3}
              fill="#0f172a"
              opacity={0.92}
              stroke="#334155"
              strokeWidth={0.6}
            />
            <text x={5} y={10} fontSize={8} fill="#cbd5e1">
              s = {sweep.sMm[hover.i].toFixed(0)} mm
            </text>
            {sweep.series.map((se, j) => (
              <text key={se.name} x={5} y={20 + j * 11} fontSize={8} fill={PALETTE[j % PALETTE.length]}>
                {se.name}: {se.values[hover.i].toFixed(3)}
              </text>
            ))}
          </g>
        </g>
      )}
      {/* 图例（电感名，两行自适应） */}
      <g fontSize={8}>
        {sweep.series.map((se, j) => {
          const perRow = Math.ceil(sweep.series.length / 2);
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
    <div className="text-center text-[9px] text-slate-600">点击数据点 → 车移到该赛道位置（手动位姿）</div>
    </div>
  );
}
