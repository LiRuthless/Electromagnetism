/**
 * 电感读数折线图（"传感器剖面"视图，智能车调试常见）。
 *
 * - x 轴：电感在车体系的横向位置 x（按 x 升序连线）；
 * - y 轴：读数幅值 |u| = k·cosθ·B（Vpp，k 由贴线锚点标定）；
 * - 各电感连成折线 + 数据点标记，随位姿/赛道/参数实时刷新；
 * - 不同敏感轴用不同颜色/点形区分（z 圆点 / x 方块 / 自定义菱形），附小图例；
 * - 点上标注电感名与数值，悬停显示完整信息（名称/位置/敏感轴/U）；
 * - 保留 y=0 参考线。纯 SVG 手绘，无图表库依赖。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AxisPreset, SensorDef, SensorReading } from '../mathmodel/sensor';
import { useChartZoom, ZoomResetButton, ZOOM_HINT } from './ZoomableChart';

interface Props {
  sensors: SensorDef[];
  readings: SensorReading[];
}

interface Pt {
  sensor: SensorDef;
  /** 读数幅值 U（V，Vpp） */
  u: number;
  /** 该电感处 B 三分量（μT，仿真源时有值） */
  bx?: number;
  by?: number;
  bz?: number;
}

const AXIS_STYLE: Record<AxisPreset, { color: string; label: string }> = {
  z: { color: '#22d3ee', label: '竖直 z' },
  x: { color: '#fbbf24', label: '横向 x' },
  y: { color: '#34d399', label: '纵向 y' },
  custom: { color: '#e879f9', label: '自定义' },
};

const W = 326;
const H = 196;
const PAD = { l: 34, r: 10, t: 26, b: 34 };

function Marker({ x, y, axis, color }: { x: number; y: number; axis: AxisPreset; color: string }) {
  if (axis === 'x') {
    return <rect x={x - 3.2} y={y - 3.2} width={6.4} height={6.4} fill={color} stroke="#0f172a" strokeWidth={1} />;
  }
  if (axis === 'y') {
    return (
      <path
        d={`M ${x} ${y - 4} L ${x + 3.8} ${y + 3} L ${x - 3.8} ${y + 3} Z`}
        fill={color}
        stroke="#0f172a"
        strokeWidth={1}
      />
    );
  }
  if (axis === 'custom') {
    return (
      <path
        d={`M ${x} ${y - 4} L ${x + 4} ${y} L ${x} ${y + 4} L ${x - 4} ${y} Z`}
        fill={color}
        stroke="#0f172a"
        strokeWidth={1}
      />
    );
  }
  return <circle cx={x} cy={y} r={3.4} fill={color} stroke="#0f172a" strokeWidth={1} />;
}

export default function SensorChart({ sensors, readings }: Props) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // 读数按传感器顺序一一对应（readings 由 sensors.map 生成）；按车体系 x 排序
  const pts: Pt[] = useMemo(() => {
    const arr = sensors.map((s, i) => {
      const r = readings[i];
      return {
        sensor: s,
        u: r ? r.value : 0, // V（Vpp），readings 语义即电压
        bx: r?.bx !== undefined ? r.bx * 1e6 : undefined,
        by: r?.by !== undefined ? r.by * 1e6 : undefined,
        bz: r?.bz !== undefined ? r.bz * 1e6 : undefined,
      };
    });
    arr.sort((a, b) => a.sensor.x - b.sensor.x);
    return arr;
  }, [sensors, readings]);

  // 全量程 x 域（mm，含 8% 边距）
  const fullDomain = useMemo((): [number, number] => {
    if (pts.length === 0) return [-1, 1];
    const xs = pts.map((p) => p.sensor.x * 1000);
    let xMin = Math.min(...xs);
    let xMax = Math.max(...xs);
    if (xMax - xMin < 1e-6) {
      xMin -= 50;
      xMax += 50;
    } else {
      const padX = (xMax - xMin) * 0.08;
      xMin -= padX;
      xMax += padX;
    }
    return [xMin, xMax];
  }, [pts]);

  // 统一缩放（程序设计说明.md §3.4）：框选/滚轮放大，Shift+拖拽平移，双击/按钮复位
  const zoom = useChartZoom(fullDomain[0], fullDomain[1]);
  const [xMin, xMax] = zoom.domain;
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const fracOf = (clientX: number, rect: DOMRect) => {
    const px = ((clientX - rect.left) / rect.width) * W;
    return (px - PAD.l) / plotW;
  };
  useEffect(() => zoom.attachWheel(svgRef.current, fracOf), [zoom]);

  if (pts.length === 0) {
    return <div className="py-6 text-center text-xs text-slate-500">无电感</div>;
  }

  // 可见域内的点；y 量程随可见点自适应（放大后自动拉伸）
  const visPts = pts.filter((p) => p.sensor.x * 1000 >= xMin && p.sensor.x * 1000 <= xMax);
  const us = (visPts.length > 0 ? visPts : pts).map((p) => p.u);
  const uMax = Math.max(1e-6, ...us) * 1.15;
  // 电压读数量级差异大（贴线数 V、远端可 <0.1 V），刻度小数位自适应
  const uDigits = uMax < 0.15 ? 3 : uMax < 1.5 ? 2 : 1;
  const fmtU = (v: number) => v.toFixed(uDigits);

  const toX = (xmm: number) => PAD.l + ((xmm - xMin) / (xMax - xMin)) * plotW;
  const toY = (u: number) => PAD.t + plotH - (u / uMax) * plotH; // u>=0，y=0 在底部

  const linePath = visPts
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(p.sensor.x * 1000).toFixed(1)} ${toY(p.u).toFixed(1)}`)
    .join(' ');

  const hovered = hoverIdx !== null ? visPts[hoverIdx] : null;

  // 缩放交互（svg 像素 -> 绘图区小数位置）
  const onSvgMouseDown = (ev: React.MouseEvent<SVGSVGElement>) => {
    if (ev.button === 2) return;
    const rect = ev.currentTarget.getBoundingClientRect();
    const f = fracOf(ev.clientX, rect);
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
    zoom.endDrag(fracOf(ev.clientX, rect));
  };

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
        {/* 横向网格线（1/2、满量程） */}
        {[0.5, 1].map((f) => (
          <g key={f}>
            <line
              x1={PAD.l}
              x2={W - PAD.r}
              y1={toY(uMax * f)}
              y2={toY(uMax * f)}
              stroke="#334155"
              strokeDasharray="3 3"
              strokeWidth={0.6}
            />
            <text x={PAD.l - 4} y={toY(uMax * f) + 3} textAnchor="end" fontSize={8} fill="#64748b">
              {fmtU(uMax * f)}
            </text>
          </g>
        ))}
        {/* y=0 参考线 */}
        <line x1={PAD.l} x2={W - PAD.r} y1={toY(0)} y2={toY(0)} stroke="#64748b" strokeWidth={1} />
        <text x={PAD.l - 4} y={toY(0) + 3} textAnchor="end" fontSize={8} fill="#64748b">
          0
        </text>
        {/* x 轴标题 */}
        <text x={PAD.l + plotW / 2} y={H - 4} textAnchor="middle" fontSize={8.5} fill="#64748b">
          电感横向位置 x（mm，车体系）
        </text>
        {/* 折线 */}
        {visPts.length > 1 && (
          <path d={linePath} fill="none" stroke="#38bdf8" strokeWidth={1.4} opacity={0.75} />
        )}
        {/* 数据点 + 标注 */}
        {visPts.map((p, i) => {
          const px = toX(p.sensor.x * 1000);
          const py = toY(p.u);
          const st = AXIS_STYLE[p.sensor.axisPreset];
          return (
            <g
              key={p.sensor.id}
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => setHoverIdx(null)}
              style={{ cursor: 'crosshair' }}
            >
              {/* 扩大热区 */}
              <circle cx={px} cy={py} r={9} fill="transparent" />
              <Marker x={px} y={py} axis={p.sensor.axisPreset} color={st.color} />
              <text x={px} y={py - 8} textAnchor="middle" fontSize={8.5} fill="#cbd5e1" fontWeight={600}>
                {p.sensor.name}
              </text>
              <text x={px} y={toY(0) + 10} textAnchor="middle" fontSize={8} fill={st.color}>
                {fmtU(p.u)}
              </text>
              <text x={px} y={toY(0) + 20} textAnchor="middle" fontSize={7.5} fill="#475569">
                {(p.sensor.x * 1000).toFixed(0)}
              </text>
            </g>
          );
        })}
        {/* 图例 */}
        <g fontSize={8}>
          {(Object.keys(AXIS_STYLE) as AxisPreset[]).map((a, i) => {
            const st = AXIS_STYLE[a];
            const lx = W - PAD.r - 158 + i * 40;
            return (
              <g key={a} transform={`translate(${lx}, 10)`}>
                <Marker x={0} y={-3} axis={a} color={st.color} />
                <text x={7} y={0} fill="#94a3b8">
                  {st.label.replace('竖直 ', '').replace('横向 ', '').replace('纵向 ', '')}
                </text>
              </g>
            );
          })}
        </g>
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
      {/* 悬停 tooltip */}
      {hovered && (
        <div className="pointer-events-none absolute left-1/2 top-0 z-10 -translate-x-1/2 rounded border border-slate-600 bg-slate-900/95 px-2 py-1.5 text-[10px] leading-4 text-slate-200 shadow-lg">
          <div className="font-semibold text-slate-100">{hovered.sensor.name}</div>
          <div>
            位置 x={Math.round(hovered.sensor.x * 1000)} y={Math.round(hovered.sensor.y * 1000)} h=
            {Math.round(hovered.sensor.h * 1000)} mm
          </div>
          <div>敏感轴：{AXIS_STYLE[hovered.sensor.axisPreset].label}</div>
          {hovered.bx !== undefined && (
            <div className="font-mono">
              Bx={hovered.bx.toFixed(3)} By={(hovered.by ?? 0).toFixed(3)} Bz=
              {(hovered.bz ?? 0).toFixed(3)} μT
            </div>
          )}
          <div>
            Vpp = <span className="font-mono text-cyan-300">{hovered.u.toFixed(3)}</span> V
          </div>
        </div>
      )}
      {readings.length === 0 && (
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-[11px] text-slate-500">
          当前数据源无实时读数（显示为 0）
        </div>
      )}
    </div>
  );
}
