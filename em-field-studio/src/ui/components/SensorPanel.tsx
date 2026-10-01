/**
 * 右侧电感面板：布局编辑（增删改 / JSON 导入导出）、车体位姿、实时读数、数据源、公式。
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ComposedChart,
  Line,
  Scatter,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MiniNum } from '@/components/ui/mini-num';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import PanelSection from './PanelSection';
import type { AxisPreset, SensorDef, SensorReading } from '../../model/sensor';
import { axisVector, INDUCTOR_SPEC } from '../../model/sensor';
import type { SweepResult } from '../../model/sweep';
import type { TrackingResult } from '../../model/kinematics';
import type { SourceKind } from '../../model/sources';
import type { PoseSource } from '../utils/appState';
import {
  evalFitModel,
  evalPhysModel,
  type MeasuredState,
  type PhysBaselineCtx,
} from '../../model/measured';
import SensorChart from './SensorChart';
import SensorSweepChart from './SensorSweepChart';
import TrackingSensorChart, { type TrajAxisMode } from './TrackingSensorChart';
import FloatingChart from './FloatingChart';
import { useChartZoom, ZoomResetButton, ZOOM_HINT } from './ZoomableChart';

export interface PoseState {
  /** 车参考点在赛道中线上的弧长位置（mm） */
  sMm: number;
  /** 横向偏差 e（mm，>0 右偏） */
  eMm: number;
  /** 航向角 ψ（度，>0 右偏） */
  psiDeg: number;
}

interface Props {
  sensors: SensorDef[];
  onSensorsChange: (s: SensorDef[]) => void;
  pose: PoseState;
  onPoseChange: (p: PoseState) => void;
  trackLength: number;
  /** 标定锚点 Vpp（V）：20kHz/100mA 下电感垂直贴线输出（5–7V） */
  vppAnchor: number;
  onVppAnchorChange: (v: number) => void;
  /** 由锚点反推的标定系数 k（V/T） */
  kCal: number;
  /** 赛道电流（mA）：方案B 物理基准与读数显示用 */
  currentMa: number;
  readings: SensorReading[];
  sourceKind: SourceKind;
  onSourceKindChange: (k: SourceKind) => void;
  /** 实测数据标定状态（null = 未导入） */
  measured: MeasuredState | null;
  /** 导入实测 CSV 文件（解析 + 自动拟合在 Home 完成） */
  onImportMeasured: (file: File) => void;
  onClearMeasured: () => void;
  /** 全程扫描 U(s)（null = 无数据/非仿真源） */
  sweep: SweepResult | null;
  onExportSweep: () => void;
  /** 位姿来源（程序设计说明.md §4.4）：手动位姿 / 跟随仿真轨迹 */
  poseSource: PoseSource;
  onPoseSourceChange: (s: PoseSource) => void;
  /** 跟随轨迹时的进度（s）与轨迹时长（s）；trajAvailable=false 时该来源置灰 */
  trajT: number;
  onTrajTChange: (t: number) => void;
  trajAvailable: boolean;
  trajDurationS: number;
  /** 跟随轨迹时由轨迹位姿反算的 s/e/ψ（只读展示）；手动模式与 pose 相同 */
  displayPose: PoseState;
  /** 循迹仿真结果（循迹轨迹电感值图用，程序设计说明.md §4.5；null = 未开启/无轨迹） */
  trackingResult: TrackingResult | null;
  /** 全程扫描图点击数据点（程序设计说明.md §3.6）：车移到该弧长（切手动位姿） */
  onSweepPointClick: (sMm: number) => void;
  /** 循迹类图点击数据点（程序设计说明.md §3.6）：车移到该时刻（切跟随仿真轨迹） */
  onTrajPointClick: (tSec: number) => void;
  /** 循迹控制区（TrackingPanel，程序设计说明.md §3.3 顺序：位于全程扫描之后、电感布局之前） */
  trackingSlot?: ReactNode;
}

/** 敏感轴预设：以水平面内（横向 x / 纵向 y）为主，竖直 z 保留可用，custom 任意角度扩展 */
const AXIS_LABEL: Record<AxisPreset, string> = {
  x: '横向 x（感 Bx）',
  y: '纵向 y（感 By）',
  z: '竖直 z（感 Bz）',
  custom: '自定义角度',
};

/**
 * 拟合预览图（recharts）：单通道切换，
 * 实测散点 + 方案A 拟合曲线 + 方案B（物理公式+偏差校正）曲线对比。
 */
function MeasuredFitChart({
  measured,
  sensors,
  physBase,
  width,
  height,
}: {
  measured: MeasuredState;
  sensors: SensorDef[];
  /** 方案B 物理基准上下文（不含电感高度/轴向，按通道补齐） */
  physBase: { I: number; k: number };
  /** 浮动窗内尺寸（程序设计说明.md §3.5；缺省为面板内自然尺寸） */
  width?: number;
  height?: number;
}) {
  const { dataset, fits } = measured;
  const [chSel, setChSel] = useState('');
  const ch = dataset.channels.includes(chSel) ? chSel : dataset.channels[0];

  // 通道对应的电感（决定拟合形状与方案B 基准的高度/轴向）：匹配电感名，未知按 z 兜底
  const sensor = sensors.find((s) => s.name === ch);
  const axisPreset: AxisPreset = sensor?.axisPreset ?? 'z';
  const fit = fits[ch];
  const physCtx: PhysBaselineCtx = {
    hM: sensor?.h ?? 0.07,
    axis: sensor ? axisVector(sensor) : [0, 0, 1],
    I: physBase.I,
    k: physBase.k,
  };

  const chartData = useMemo(() => {
    const eMin = dataset.points[0]?.eMm ?? 0;
    const eMax = dataset.points[dataset.points.length - 1]?.eMm ?? 0;
    const N = 120;
    const rows: { eMm: number; fit?: number; phys?: number }[] = [];
    for (let i = 0; i <= N; i++) {
      const eMm = eMin + ((eMax - eMin) * i) / N;
      rows.push({
        eMm: Number(eMm.toFixed(2)),
        ...(fit ? { fit: evalFitModel(fit, axisPreset, eMm) } : {}),
        phys: evalPhysModel(dataset.points, ch, eMm, physCtx) ?? undefined,
      });
    }
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataset, ch, fit, axisPreset, physBase.I, physBase.k, sensor?.h, sensor?.axisPreset, sensor?.axis]);

  const scatterData = useMemo(
    () =>
      dataset.points
        .filter((p) => Number.isFinite(p.values[ch]))
        .map((p) => ({ eMm: p.eMm, u: p.values[ch] })),
    [dataset, ch],
  );

  // 统一缩放（程序设计说明.md §3.4）：框选/滚轮放大，Shift+拖拽平移，双击/按钮复位
  const eFullMin = dataset.points[0]?.eMm ?? 0;
  const eFullMax = dataset.points[dataset.points.length - 1]?.eMm ?? 1;
  const zoom = useChartZoom(eFullMin, Math.max(eFullMax, eFullMin + 1e-6));
  const CH_W = Math.max(240, Math.round(width ?? 322));
  const CH_H = Math.max(150, Math.round(height ?? 190));
  // recharts 布局：YAxis 默认宽 60，margin.left=-18 -> 绘图区左缘 42；XAxis 默认高 30
  const PL = 42;
  const PR = 8;
  const PT = 8;
  const plotW = CH_W - PL - PR;
  const plotH = CH_H - PT - 30;
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const fracOf = (clientX: number, rect: DOMRect) => (clientX - rect.left - PL) / plotW;
  useEffect(() => zoom.attachWheel(wrapRef.current, fracOf), [zoom]);

  const visChartData = useMemo(
    () => chartData.filter((r) => r.eMm >= zoom.domain[0] && r.eMm <= zoom.domain[1]),
    [chartData, zoom.domain],
  );
  const visScatterData = useMemo(
    () => scatterData.filter((r) => r.eMm >= zoom.domain[0] && r.eMm <= zoom.domain[1]),
    [scatterData, zoom.domain],
  );

  const onChartMouseDown = (ev: React.MouseEvent<HTMLDivElement>) => {
    if (ev.button === 2) return;
    const rect = ev.currentTarget.getBoundingClientRect();
    const f = fracOf(ev.clientX, rect);
    if (ev.button === 1 || ev.shiftKey) zoom.beginPan(f);
    else zoom.beginBox(f);
    ev.preventDefault();
    const move = (e: MouseEvent) => zoom.dragTo(fracOf(e.clientX, rect));
    const up = (e: MouseEvent) => {
      zoom.endDrag(fracOf(e.clientX, rect));
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5">
        <Label className="text-[10px] text-slate-400">预览通道</Label>
        <Select value={ch} onValueChange={setChSel}>
          <SelectTrigger className="h-6 w-24 bg-slate-900 text-[11px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {dataset.channels.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-[10px] text-slate-500">
          {fit ? `拟合形状：${axisPreset === 'x' ? '|d| 形（感 Bx）' : 'Lorentzian（感 Bz）'}` : '该通道无拟合结果'}
        </span>
      </div>
      <div
        ref={wrapRef}
        className="relative select-none"
        style={{ width: CH_W, height: CH_H, cursor: 'crosshair' }}
        onMouseDown={onChartMouseDown}
        onDoubleClick={zoom.reset}
      >
        {zoom.zoomed && <ZoomResetButton onReset={zoom.reset} />}
        <ComposedChart width={CH_W} height={CH_H} data={visChartData} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
          <XAxis
            dataKey="eMm"
            type="number"
            domain={zoom.domain}
            tick={{ fontSize: 9, fill: '#64748b' }}
            tickFormatter={(v: number) => `${v}`}
            label={{ value: 'e (mm)', position: 'insideBottomRight', offset: -2, fontSize: 9, fill: '#64748b' }}
          />
          <YAxis tick={{ fontSize: 9, fill: '#64748b' }} />
          <ChartTooltip
            contentStyle={{ background: '#0f172a', border: '1px solid #334155', fontSize: 11 }}
            labelStyle={{ color: '#94a3b8' }}
            formatter={(value, name) => [
              typeof value === 'number' ? `${value.toFixed(3)} V` : String(value),
              name === 'fit' ? '方案A 拟合' : name === 'phys' ? '方案B 物理+偏差' : '实测',
            ]}
            labelFormatter={(v) => `e = ${v} mm`}
          />
          <Line dataKey="fit" name="fit" stroke="#22d3ee" strokeWidth={1.6} dot={false} isAnimationActive={false} />
          <Line dataKey="phys" name="phys" stroke="#fbbf24" strokeWidth={1.2} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
          <Scatter data={visScatterData} dataKey="u" name="u" fill="#f8fafc" isAnimationActive={false} />
        </ComposedChart>
        {/* 框选选区 */}
        {zoom.box && (
          <div
            className="pointer-events-none absolute border border-dashed border-sky-400 bg-sky-400/15"
            style={{
              left: PL + Math.min(zoom.box[0], zoom.box[1]) * plotW,
              width: Math.abs(zoom.box[1] - zoom.box[0]) * plotW,
              top: PT,
              height: plotH,
            }}
          />
        )}
      </div>
      <div className="mt-0.5 flex gap-3 text-[10px] text-slate-500">
        <span><span className="text-slate-200">●</span> 实测散点</span>
        <span><span className="text-cyan-400">—</span> 方案A 拟合曲线</span>
        <span><span className="text-amber-400">┅</span> 方案B 物理公式+偏差校正</span>
        <span className="ml-auto text-[9px] text-slate-600">{ZOOM_HINT}</span>
      </div>
    </div>
  );
}

export default function SensorPanel(props: Props) {
  const { sensors, onSensorsChange, pose, onPoseChange, readings, vppAnchor, kCal, measured } = props;
  const fileRef = useRef<HTMLInputElement>(null);
  const measuredFileRef = useRef<HTMLInputElement>(null);
  const [ioMsg, setIoMsg] = useState('');
  // 全程扫描区双图切换（程序设计说明.md §3.3）：①全程扫描 ②循迹轨迹；循迹图横轴 t/弧长
  const [sweepTab, setSweepTab] = useState<'sweep' | 'traj'>('sweep');
  const [trajAxis, setTrajAxis] = useState<TrajAxisMode>('t');

  const isMeasuredSource = props.sourceKind === 'measured-fit' || props.sourceKind === 'measured-phys';
  // 通道匹配情况：哪些电感有实测数据 / 哪些缺失
  const matchedChannels = measured ? sensors.filter((s) => measured.dataset.channels.includes(s.name)) : [];
  const missingChannels = measured ? sensors.filter((s) => !measured.dataset.channels.includes(s.name)) : [];

  const setSensor = (id: string, patch: Partial<SensorDef>) => {
    onSensorsChange(sensors.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };
  const delSensor = (id: string) => onSensorsChange(sensors.filter((s) => s.id !== id));
  const addSensor = () => {
    onSensorsChange([
      ...sensors,
      {
        id: `s${Date.now().toString(36)}`,
        name: `S${sensors.length + 1}`,
        x: 0,
        y: 0.05,
        h: 0.07,
        axisPreset: 'z',
        axis: [0, 0, 1],
      },
    ]);
  };

  const exportJson = () => {
    const data = sensors.map(({ id: _id, ...rest }) => rest);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sensor-layout.json';
    a.click();
    URL.revokeObjectURL(url);
    setIoMsg('布局已导出 JSON');
  };

  const importJson = async (file: File) => {
    try {
      const arr = JSON.parse(await file.text()) as Omit<SensorDef, 'id'>[];
      if (!Array.isArray(arr)) throw new Error('格式错误');
      onSensorsChange(
        arr.map((s, i) => ({
          id: `imp${Date.now().toString(36)}_${i}`,
          name: String(s.name ?? `S${i + 1}`),
          x: Number(s.x) || 0,
          y: Number(s.y) || 0,
          h: Number(s.h) || 0.07,
          axisPreset: (['z', 'x', 'y', 'custom'].includes(s.axisPreset) ? s.axisPreset : 'z') as AxisPreset,
          axis: Array.isArray(s.axis) && s.axis.length === 3 ? s.axis : [0, 0, 1],
        })),
      );
      setIoMsg(`已导入 ${arr.length} 个电感`);
    } catch (err) {
      setIoMsg(`导入失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="space-y-2.5 p-2.5">
      {/* 数据源（程序设计说明.md §3.8：可折叠分区卡片） */}
      <PanelSection title="采集数据源">
        <div className="pt-1">
        <Select
          value={props.sourceKind}
          onValueChange={(v) => props.onSourceKindChange(v as SourceKind)}
        >
          <SelectTrigger className="h-8 w-full bg-slate-950/60 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="simulation">仿真模型</SelectItem>
            <SelectItem value="measured-fit" title="实测拟合模型（方案A 解析标定）">
              实测拟合 · 方案A
            </SelectItem>
            <SelectItem value="measured-phys" title="实测物理公式+偏差校正（方案B）">
              实测物理+偏差 · 方案B
            </SelectItem>
            <SelectItem value="serial" title="串口实车 ADC（预留接口，待接入）">
              串口实车 ADC（预留）
            </SelectItem>
            <SelectItem value="file" title="标定 Excel/CSV 导入（见下方实测数据标定区）">
              标定 CSV 导入（见下方）
            </SelectItem>
          </SelectContent>
        </Select>
        {isMeasuredSource && !measured && (
          <div className="mt-1.5 rounded border border-amber-700/50 bg-amber-900/20 px-2 py-1.5 text-[11px] text-amber-300">
            请先导入实测数据 CSV（下方"实测数据标定"区）。
          </div>
        )}
        {(props.sourceKind === 'serial' || props.sourceKind === 'file') && (
          <div className="mt-1.5 rounded border border-amber-700/50 bg-amber-900/20 px-2 py-1.5 text-[11px] text-amber-300">
            {props.sourceKind === 'serial'
              ? '预留接口，待接入 —— 接法见 src/model/sources.ts 头注释（SensorDataSource 接口）。'
              : '文件导入已实现：请直接使用下方"实测数据标定"区导入 CSV。'}
          </div>
        )}
        </div>
      </PanelSection>

      {/* 实测数据标定（选中实测源或已导入数据时默认展开） */}
      <PanelSection
        title="实测数据标定"
        defaultOpen={isMeasuredSource || !!measured}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              className="h-6 border-slate-600 bg-slate-800 px-2 text-[11px]"
              onClick={() => measuredFileRef.current?.click()}
            >
              导入 CSV
            </Button>
            {measured && (
              <Button
                variant="outline"
                size="sm"
                className="h-6 border-red-800/60 bg-slate-800 px-2 text-[11px] text-red-400"
                onClick={props.onClearMeasured}
              >
                清除实测数据
              </Button>
            )}
            <input
              ref={measuredFileRef}
              type="file"
              accept=".csv,.txt"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) props.onImportMeasured(f);
                e.target.value = '';
              }}
            />
          </>
        }
      >
        <div className="pt-1">
        <div className="mb-1.5 text-[10px] leading-4 text-slate-500">
          格式：表头 <span className="font-mono">e_cm,L1,R1,M1,...</span>，首列横向偏差
          （e_cm/e_mm/e(cm)/e(mm)/偏差 均可，cm 自动换算 mm），其余列通道名需与电感名一致；
          支持逗号/分号/制表符分隔。导入后自动完成方案A 拟合，方案B 直接按物理公式+偏差表求值。
        </div>
        {measured ? (
          <div className="space-y-2 rounded border border-slate-700 bg-slate-800/40 p-2">
            {/* 数据集概况 */}
            <div className="text-[11px] leading-4 text-slate-300">
              <div>
                文件：<span className="font-mono text-slate-200">{measured.dataset.fileName}</span>
              </div>
              <div>
                采样点 {measured.dataset.points.length} 个，e 范围 [
                {measured.dataset.points[0].eMm.toFixed(0)},{' '}
                {measured.dataset.points[measured.dataset.points.length - 1].eMm.toFixed(0)}] mm
              </div>
              <div className="flex flex-wrap items-center gap-1">
                通道匹配：
                {matchedChannels.length > 0 ? (
                  <Badge variant="outline" className="border-emerald-700/60 text-[10px] text-emerald-300">
                    有数据：{matchedChannels.map((s) => s.name).join('、')}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="border-red-800/60 text-[10px] text-red-400">
                    无匹配通道
                  </Badge>
                )}
                {missingChannels.length > 0 && (
                  <Badge variant="outline" className="border-amber-700/60 text-[10px] text-amber-300">
                    缺失：{missingChannels.map((s) => s.name).join('、')}（回退仿真，读数加 *）
                  </Badge>
                )}
              </div>
              {measured.dataset.eUnitNote && (
                <div className="text-amber-300">{measured.dataset.eUnitNote}</div>
              )}
            </div>
            {/* 方案A 拟合结果表 */}
            {Object.keys(measured.fits).length > 0 && (
              <div>
                <div className="mb-0.5 text-[10px] font-semibold text-slate-400">
                  方案A 拟合结果（U = k·f(d−e0, h_eff)）
                </div>
                <table className="w-full text-[10px] text-slate-300">
                  <thead>
                    <tr className="text-slate-500">
                      <th className="text-left font-normal">通道</th>
                      <th className="text-right font-normal">k</th>
                      <th className="text-right font-normal">h_eff(mm)</th>
                      <th className="text-right font-normal">e0(mm)</th>
                      <th className="text-right font-normal">RMSE</th>
                      <th className="text-right font-normal">R²</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono">
                    {Object.entries(measured.fits).map(([name, f]) => (
                      <tr key={name} className="border-t border-slate-700/60">
                        <td>{name}</td>
                        <td className="text-right">{f.k.toPrecision(3)}</td>
                        <td className="text-right">{f.hEffMm.toFixed(1)}</td>
                        <td className="text-right">{f.e0Mm.toFixed(1)}</td>
                        <td className="text-right">{f.rmse.toFixed(3)}</td>
                        <td className={`text-right ${f.r2 >= 0.95 ? 'text-emerald-300' : 'text-amber-300'}`}>
                          {f.r2.toFixed(3)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {/* 方案B 偏差节点数 */}
            <div className="text-[10px] text-slate-500">
              方案B（物理公式+偏差校正）：{measured.dataset.channels
                .map(
                  (c) =>
                    `${c} ${measured.dataset.points.filter((p) => Number.isFinite(p.values[c])).length} 偏差节点`,
                )
                .join('，')}
              ，分段线性插值、范围外钳位端点偏差
            </div>
            {/* 拟合预览图（程序设计说明.md §3.5 可浮出为浮动窗） */}
            <FloatingChart id="measuredFit" title="实测标定对比预览" defaultW={460} defaultH={300}>
              {(w, h) => (
                <MeasuredFitChart
                  measured={measured}
                  sensors={sensors}
                  physBase={{ I: props.currentMa / 1000, k: kCal }}
                  {...(w !== null && h !== null ? { width: w, height: h - 24 } : {})}
                />
              )}
            </FloatingChart>
          </div>
        ) : (
          <div className="rounded border border-slate-700/60 px-2 py-3 text-center text-[11px] text-slate-500">
            未导入实测数据 —— 导入后此处显示拟合结果与预览图
          </div>
        )}
        </div>
      </PanelSection>

      {/* 车体位姿（程序设计说明.md §3.3；当前值可直接键入，程序设计说明.md §3.8） */}
      <PanelSection title="车体位姿">
        <div className="space-y-3 pt-1">
        {/* 位姿来源切换（程序设计说明.md §4.4）：手动位姿 / 跟随仿真轨迹 */}
        <div className="flex gap-1.5">
          <Button
            variant={props.poseSource === 'manual' ? 'default' : 'outline'}
            size="sm"
            className={`h-6 flex-1 text-[11px] ${props.poseSource === 'manual' ? '' : 'border-slate-600 bg-slate-800'}`}
            onClick={() => props.onPoseSourceChange('manual')}
          >
            手动位姿
          </Button>
          <Button
            variant={props.poseSource === 'trajectory' ? 'default' : 'outline'}
            size="sm"
            className={`h-6 flex-1 text-[11px] ${props.poseSource === 'trajectory' ? '' : 'border-slate-600 bg-slate-800'}`}
            disabled={!props.trajAvailable}
            title={props.trajAvailable ? '位姿由循迹闭环轨迹驱动' : '需先开启循迹闭环仿真且有有效轨迹'}
            onClick={() => props.onPoseSourceChange('trajectory')}
          >
            跟随仿真轨迹
          </Button>
        </div>
        {props.poseSource === 'trajectory' && !props.trajAvailable && (
          <div className="rounded border border-amber-700/50 bg-amber-900/20 px-2 py-1.5 text-[11px] text-amber-300">
            循迹仿真未开启或无有效轨迹——请先在下方"循迹闭环仿真"开启。
          </div>
        )}
        {props.poseSource === 'trajectory' && props.trajAvailable ? (
          <>
            {/* 轨迹进度滑块：位姿取轨迹对应记录的 (x, y, θ) */}
            <div>
              <div className="mb-1 flex justify-between text-xs text-slate-400">
                <span>轨迹进度 t</span>
                <span className="font-mono text-slate-200">
                  {props.trajT.toFixed(2)} s / {props.trajDurationS.toFixed(2)} s
                </span>
              </div>
              <Slider
                value={[props.trajT]}
                min={0}
                max={Math.max(props.trajDurationS, 0.01)}
                step={Math.max(props.trajDurationS / 1000, 0.005)}
                onValueChange={([v]) => props.onTrajTChange(v)}
              />
            </div>
            {/* s/e/ψ 由轨迹位姿反算，只读展示 */}
            <div className="space-y-1 rounded border border-slate-700/60 bg-slate-900/40 px-2 py-1.5 font-mono text-[11px] text-slate-300">
              <div className="flex justify-between">
                <span className="text-slate-500">沿线位置 s（只读）</span>
                <span>{props.displayPose.sMm.toFixed(0)} mm</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">横向偏差 e（只读，右 +）</span>
                <span>{props.displayPose.eMm.toFixed(1)} mm</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">航向角 ψ（只读，右 +）</span>
                <span>{props.displayPose.psiDeg.toFixed(1)}°</span>
              </div>
            </div>
          </>
        ) : (
          <>
            <div>
              <div className="mb-1 flex items-center justify-between text-xs text-slate-400">
                <span>沿线位置 s</span>
                <span className="flex items-center gap-1">
                  <MiniNum
                    value={pose.sMm}
                    digits={0}
                    className="h-[22px] w-16 text-[11px] text-slate-200"
                    title="当前值（可直接键入，范围 0 ~ 赛道总长）"
                    onCommit={(v) =>
                      onPoseChange({
                        ...pose,
                        sMm: Math.min(Math.max(props.trackLength * 1000, 10), Math.max(0, v)),
                      })
                    }
                  />
                  <span className="text-[9px] text-slate-500">mm</span>
                </span>
              </div>
              <Slider
                value={[pose.sMm]}
                min={0}
                max={Math.max(props.trackLength * 1000, 10)}
                step={10}
                onValueChange={([v]) => onPoseChange({ ...pose, sMm: v })}
              />
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between text-xs text-slate-400">
                <span>横向偏差 e（右 +）</span>
                <span className="flex items-center gap-1">
                  <MiniNum
                    value={pose.eMm}
                    digits={0}
                    className="h-[22px] w-16 text-[11px] text-slate-200"
                    title="当前值（可直接键入，范围 −250 ~ 250）"
                    onCommit={(v) =>
                      onPoseChange({ ...pose, eMm: Math.min(250, Math.max(-250, Math.round(v))) })
                    }
                  />
                  <span className="text-[9px] text-slate-500">mm</span>
                </span>
              </div>
              <Slider
                value={[pose.eMm]}
                min={-250}
                max={250}
                step={5}
                onValueChange={([v]) => onPoseChange({ ...pose, eMm: v })}
              />
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between text-xs text-slate-400">
                <span>航向角 ψ（右 +）</span>
                <span className="flex items-center gap-1">
                  <MiniNum
                    value={pose.psiDeg}
                    digits={1}
                    className="h-[22px] w-16 text-[11px] text-slate-200"
                    title="当前值（可直接键入，范围 −30 ~ 30）"
                    onCommit={(v) =>
                      onPoseChange({ ...pose, psiDeg: Math.min(30, Math.max(-30, v)) })
                    }
                  />
                  <span className="text-[9px] text-slate-500">°</span>
                </span>
              </div>
              <Slider
                value={[pose.psiDeg]}
                min={-30}
                max={30}
                step={1}
                onValueChange={([v]) => onPoseChange({ ...pose, psiDeg: v })}
              />
            </div>
          </>
        )}
        <div>
          <div className="mb-1 flex items-center justify-between text-xs text-slate-400">
            <span>标定 Vpp（贴线 @20kHz/100mA）</span>
            <span className="flex items-center gap-1">
              <MiniNum
                value={vppAnchor}
                digits={1}
                className="h-[22px] w-16 text-[11px] text-slate-200"
                title="当前值（可直接键入，范围 5 ~ 7 V）"
                onCommit={(v) => props.onVppAnchorChange(Math.min(7, Math.max(5, v)))}
              />
              <span className="text-[9px] text-slate-500">V</span>
            </span>
          </div>
          <Slider
            value={[vppAnchor]}
            min={5}
            max={7}
            step={0.1}
            onValueChange={([v]) => props.onVppAnchorChange(v)}
          />
          <div className="mt-0.5 text-[10px] text-slate-500">
            反推 k = {kCal.toExponential(3)} V/T（B_touch = μ₀I/2π·3.25mm ≈ 6.154μT）
          </div>
        </div>
        </div>
      </PanelSection>

      {/* 实时读数：折线剖面图 */}
      <PanelSection title="电感读数剖面" hint="|u| = k·cosθ·B（Vpp）">
        <div className="pt-1">
          <SensorChart sensors={sensors} readings={readings} />
        </div>
      </PanelSection>

      {/* 全程扫描 / 循迹轨迹电感值：双图切换（程序设计说明.md §3.3），各自独立缩放、均可浮出（程序设计说明.md §3.5） */}
      <PanelSection title="全程扫描 / 循迹轨迹图">
        <div className="pt-1">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-1">
            {(['sweep', 'traj'] as const).map((tab) => (
              <button
                key={tab}
                className={`rounded border px-2 py-0.5 text-[11px] ${
                  sweepTab === tab
                    ? 'border-cyan-600 bg-cyan-950/50 font-semibold text-cyan-300'
                    : 'border-slate-700 bg-slate-800 text-slate-400 hover:bg-slate-700'
                }`}
                onClick={() => setSweepTab(tab)}
              >
                {tab === 'sweep' ? '全程扫描 U(s)' : '循迹轨迹电感值'}
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-6 border-slate-600 bg-slate-800 px-2 text-[11px]"
            disabled={!props.sweep}
            onClick={props.onExportSweep}
          >
            导出扫描 CSV
          </Button>
        </div>
        {/* 两图保持挂载（hidden 切换），各自保留缩放状态（程序设计说明.md §3.3/程序设计说明.md §3.4） */}
        <div className={sweepTab === 'sweep' ? '' : 'hidden'}>
          <FloatingChart id="sweep" title="全程扫描 U(s)（Vpp）" defaultW={430} defaultH={300}>
            {() =>
              props.sweep ? (
                <SensorSweepChart
                  sweep={props.sweep}
                  currentSMm={props.displayPose.sMm}
                  onPointClick={props.onSweepPointClick}
                />
              ) : (
                <div className="py-6 text-center text-xs text-slate-500">
                  {sensors.length === 0 ? '无电感' : '无赛道或当前数据源不支持扫描'}
                </div>
              )
            }
          </FloatingChart>
        </div>
        <div className={sweepTab === 'traj' ? '' : 'hidden'}>
          <FloatingChart id="trajSensors" title="循迹轨迹电感值（Vpp）" defaultW={430} defaultH={320}>
            {() =>
              props.trackingResult && props.trackingResult.steps > 0 ? (
                <TrackingSensorChart
                  result={props.trackingResult}
                  axisMode={trajAxis}
                  onAxisModeChange={setTrajAxis}
                  currentT={props.trajT}
                  onPointClick={props.onTrajPointClick}
                />
              ) : (
                <div className="py-6 text-center text-xs text-slate-500">
                  请先开启循迹仿真（下方"循迹闭环仿真"区）——开启后此处显示车体在轨迹实际位姿上的各电感读数
                </div>
              )
            }
          </FloatingChart>
        </div>
        </div>
      </PanelSection>

      {/* 循迹控制区（程序设计说明.md §3.3：上移到电感布局编辑之前） */}
      {props.trackingSlot}

      {/* 电感布局（程序设计说明.md §3.8：操作按钮移入分区标题栏） */}
      <PanelSection
        title="电感布局"
        hint={`${sensors.length} 个`}
        actions={
          <>
            <Button variant="outline" size="sm" className="h-6 border-slate-600 bg-slate-800 px-2 text-[11px]" onClick={addSensor}>
              +添加
            </Button>
            <Button variant="outline" size="sm" className="h-6 border-slate-600 bg-slate-800 px-2 text-[11px]" onClick={exportJson}>
              导出
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-6 border-slate-600 bg-slate-800 px-2 text-[11px]"
              onClick={() => fileRef.current?.click()}
            >
              导入
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importJson(f);
                e.target.value = '';
              }}
            />
          </>
        }
      >
        <div className="pt-1">
        <div className="mb-1.5 text-[10px] text-slate-500">
          规格：{INDUCTOR_SPEC}，加电容小板；6mm 直径 ≪ 探测距离，按点探头（几何中心）采样
        </div>
        {ioMsg && <div className="mb-1 text-[10px] text-slate-500">{ioMsg}</div>}
        <div className="space-y-1.5">
          {sensors.map((s) => (
            <div key={s.id} className="rounded border border-slate-700 bg-slate-800/60 px-2 py-1.5">
              <div className="flex items-center gap-1.5">
                <Input
                  className="h-6 w-12 bg-slate-900 px-1 text-[11px]"
                  value={s.name}
                  onChange={(e) => setSensor(s.id, { name: e.target.value })}
                />
                <Label className="text-[10px] text-slate-400">x</Label>
                <Input
                  type="number"
                  step={5}
                  className="h-6 w-14 bg-slate-900 px-1 text-[11px]"
                  value={Math.round(s.x * 1000)}
                  onChange={(e) => setSensor(s.id, { x: (Number(e.target.value) || 0) / 1000 })}
                />
                <Label className="text-[10px] text-slate-400">y</Label>
                <Input
                  type="number"
                  step={5}
                  className="h-6 w-14 bg-slate-900 px-1 text-[11px]"
                  value={Math.round(s.y * 1000)}
                  onChange={(e) => setSensor(s.id, { y: (Number(e.target.value) || 0) / 1000 })}
                />
                <Label className="text-[10px] text-slate-400">h</Label>
                <Input
                  type="number"
                  step={5}
                  className="h-6 w-14 bg-slate-900 px-1 text-[11px]"
                  value={Math.round(s.h * 1000)}
                  onChange={(e) => setSensor(s.id, { h: Math.max(0.01, (Number(e.target.value) || 10) / 1000) })}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto h-5 px-1.5 text-[11px] text-red-400"
                  onClick={() => delSensor(s.id)}
                >
                  删
                </Button>
              </div>
              <div className="mt-1 flex items-center gap-1.5">
                <Select
                  value={s.axisPreset}
                  onValueChange={(v) => setSensor(s.id, { axisPreset: v as AxisPreset })}
                >
                  <SelectTrigger
                    className="h-6 min-w-0 flex-1 bg-slate-950/60 px-2 text-[11px]"
                    title="电感敏感轴方向"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="x">{AXIS_LABEL.x}</SelectItem>
                    <SelectItem value="y">{AXIS_LABEL.y}</SelectItem>
                    <SelectItem value="z">{AXIS_LABEL.z}</SelectItem>
                    <SelectItem value="custom">{AXIS_LABEL.custom}</SelectItem>
                  </SelectContent>
                </Select>
                {s.axisPreset === 'custom' && (
                  <div className="flex items-center gap-1">
                    {[0, 1, 2].map((i) => (
                      <Input
                        key={i}
                        type="number"
                        step={0.1}
                        className="h-6 w-12 bg-slate-900 px-1 text-[11px]"
                        value={s.axis[i]}
                        onChange={(e) => {
                          const axis = [...s.axis] as [number, number, number];
                          axis[i] = Number(e.target.value) || 0;
                          setSensor(s.id, { axis });
                        }}
                      />
                    ))}
                  </div>
                )}
                <Badge variant="outline" className="ml-auto shrink-0 border-slate-600 text-[10px] text-slate-400">
                  单位 mm
                </Badge>
              </div>
            </div>
          ))}
        </div>
        </div>
      </PanelSection>

      {/* 物理公式与模型假设（参考信息，默认折叠） */}
      <PanelSection title="物理公式与模型假设" defaultOpen={false}>
        <div className="space-y-1 pt-1 font-mono text-[11px] leading-5 text-slate-300">
          <div>无限长直导线：B = μ₀I / (2πr)</div>
          <div>毕奥-萨伐尔：dB⃗ = (μ₀I/4π)·dl⃗×r⃗/r³</div>
          <div>电感响应：|u(t)| = k·cosθ·B（Vpp，θ = 敏感轴与 B⃗ 夹角）</div>
          <div>归一化偏差：err = (U_L − U_R)/(U_L + U_R)</div>
          <div className="text-slate-500">
            k 标定：20kHz/100mA 贴线（3.25mm，B≈6.154μT）输出 Vpp {vppAnchor.toFixed(1)}V → k = Vpp/B_touch；电流变化时读数随 B 线性缩放
          </div>
          <div className="text-slate-500">μ₀ = 4π×10⁻⁷ H/m，准静态近似（20 kHz ≪ cm 尺度）；ADC 幅值检测取 |cosθ|</div>
          <div className="text-slate-500">
            圆截面导线外部磁场与同轴细线电流严格相同（安培环路定理），线径 0.5mm 不影响外部场
          </div>
          <div className="text-slate-500">
            点探头近似：{INDUCTOR_SPEC}，6mm 直径 ≪ 探测距离，按几何中心采样
          </div>
          <div className="text-slate-500">
            尖角近似：最小弯曲半径（~0.25mm）≪ 探测尺度；环岛按正六边形建模（顶点接直线，绕环回到入环点直行出环）
          </div>
          <div className="text-slate-500">
            实测方案A（解析标定）：竖直电感 U(d) = k·h_eff/((d−e0)²+h_eff²)（Lorentzian）；
            横躺电感 U(d) = k·|d−e0|/((d−e0)²+h_eff²)；h_eff/e0 网格搜索 + 线性最小二乘求 k
          </div>
          <div className="text-slate-500">
            实测方案B（物理公式+偏差校正）：基准 U₀(d) = k·|B(d)·n̂|（长直导线解析形状，含标定 k），
            偏差 δ(d) = U_实测 − U₀ 分段线性插值（范围外钳位端点偏差），U(d) = U₀(d) + δ̂(d)；
            两种模型的 d 均为电感到赛道中线的有符号横向距离（右正）
          </div>
          <div className="text-slate-500">
            循迹闭环（数学模型.md §8）：Err = [A·(L1−R1)+B·(L2−R2)] / [A·(L1+R1)+C·|L2−R2|] · P（默认公式，
            主对 L1/R1 + 宽对 L2/R2，可编辑）；
            u = Kp·Err + Kd·dErr/dt；内轮变化量:外轮 = w:1（Δv_外 = 2u/(1+w)，Δv_内 = 2u·w/(1+w)），
            限幅 [0, v_max]
          </div>
          <div className="text-slate-500">
            两轮差速运动学：v = (v_R+v_L)/2，ω = (v_R−v_L)/W；θ += ω·dt，x += v·cosθ·dt，y += v·sinθ·dt
          </div>
        </div>
      </PanelSection>
    </div>
  );
}
