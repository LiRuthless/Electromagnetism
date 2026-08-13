/**
 * 右侧面板 · 循迹控制区（程序设计说明.md §4.2，2026-08-03 输入方式改造版）：
 * 误差公式编辑（可用变量 = 各电感名 + A/B/C/P）、差比和差加权权重、
 * Kp/Kd（支持一键整定，程序设计说明.md §4.3 目标为轨迹形状贴合）、基础/上限速度、
 * 差速权重 w、轮距 W、步长 dt、初始扰动、失控阈值。
 *
 * 输入方式（程序设计说明.md §4.2）：
 * - w / W / dt / 电机τm / 初始 e / 初始 ψ 共 6 项为数字直输（无滑块，合法范围钳位）；
 * - 其余参数为滑块，滑块两端最小/最大值可点击编辑（自定义量程随 appState v6
 *   `trackingRanges` 持久化），当前值可拖动也可直接键入。
 *
 * 任一参数修改后由 Home 防抖 ~200ms 重算轨迹并同步刷新画布。
 * Err(t)/轮速(t) 曲线：统一缩放（程序设计说明.md §3.4）、可浮出为浮动窗（程序设计说明.md §3.5）、
 * 点击数据点联动车位（程序设计说明.md §3.6，onChartPointClick(t)）。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Line, LineChart, Tooltip as ChartTooltip, XAxis, YAxis } from 'recharts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import type { TrackingParams } from '../mathmodel/control';
import type { TrackingResult } from '../mathmodel/kinematics';
import type { TrackingRangesMap } from '../utils/appState';
import FloatingChart from './FloatingChart';
import { useChartZoom, ZoomResetButton, ZOOM_HINT } from './ZoomableChart';

interface Props {
  params: TrackingParams;
  onChange: (p: TrackingParams) => void;
  /** 轨迹结果（null = 未启用 / 无赛道 / 无电感） */
  result: TrackingResult | null;
  /** 公式非法/未知变量提示（空串 = 正常） */
  formulaError: string;
  /** 当前电感名（公式可用变量提示） */
  sensorNames: string[];
  onExport: () => void;
  /**
   * 一键调 PID（程序设计说明.md §4.3）：在 [0,kpMax]×[0,kdMax] 网格搜索，目标为轨迹形状贴合
   * （直线贴中线、弯道内收 ≤eInMaxMm 不罚/外偏 2 倍罚/航向抖动罚），返回最优组合；null=无可行解
   */
  onAutoTune: (
    kpMax: number,
    kdMax: number,
    eInMaxMm: number,
    onProgress: (done: number, total: number) => void,
  ) => Promise<{ kp: number; kd: number } | null>;
  /** 滑块自定义量程（appState v6 `trackingRanges`）：key = 参数 id */
  ranges: TrackingRangesMap;
  onRangeChange: (id: string, r: { min: number; max: number } | null) => void;
  /** 循迹类折线图点击数据点联动车位（程序设计说明.md §3.6）：参数为该点时间 t（s） */
  onChartPointClick: (tSec: number) => void;
}

/** 小型数字输入（失焦/Enter 提交；键入过程不回写，避免半成品数值打断输入） */
function MiniNum({
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
      className={`h-5 rounded border border-slate-700 bg-slate-900 px-1 text-center font-mono text-[10px] text-slate-300 outline-none focus:border-cyan-600 ${className ?? ''}`}
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

/**
 * 滑块调参行（程序设计说明.md §4.2 改造）：滑块两端最小/最大值可点击编辑（自定义量程持久化），
 * 当前值可拖动滑块或直接键入。
 */
function SliderField({
  id,
  label,
  value,
  min,
  max,
  step,
  unit,
  digits,
  onChange,
  ranges,
  onRangeChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  digits?: number;
  onChange: (v: number) => void;
  ranges: TrackingRangesMap;
  onRangeChange: (id: string, r: { min: number; max: number } | null) => void;
}) {
  const effMin = ranges[id]?.min ?? min;
  const effMax = ranges[id]?.max ?? max;
  const clamp = (v: number) => Math.min(effMax, Math.max(effMin, v));
  const show =
    digits !== undefined
      ? value.toFixed(digits)
      : step >= 1
        ? value.toFixed(0)
        : step >= 0.1
          ? value.toFixed(1)
          : value.toFixed(2);
  return (
    <div className="flex items-center gap-1">
      <Label className="w-14 shrink-0 whitespace-nowrap text-[10px] text-slate-400">{label}</Label>
      <MiniNum
        value={effMin}
        className="w-10 text-slate-500"
        title="滑块最小值（可编辑）"
        onCommit={(v) => {
          const lo = Math.min(v, effMax - step);
          onRangeChange(id, { min: lo, max: effMax });
          if (value < lo) onChange(lo);
        }}
      />
      <Slider
        className="min-w-0 flex-1"
        value={[clamp(value)]}
        min={effMin}
        max={effMax}
        step={step}
        onValueChange={([v]) => onChange(v)}
      />
      <MiniNum
        value={effMax}
        className="w-10 text-slate-500"
        title="滑块最大值（可编辑）"
        onCommit={(v) => {
          const hi = Math.max(v, effMin + step);
          onRangeChange(id, { min: effMin, max: hi });
          if (value > hi) onChange(hi);
        }}
      />
      <MiniNum
        value={Number(show)}
        digits={digits}
        className="w-14 text-slate-200"
        title={`当前值${unit ? `（${unit}）` : ''}（可直接键入）`}
        onCommit={(v) => onChange(clamp(v))}
      />
      {unit && <span className="w-7 shrink-0 text-[9px] text-slate-500">{unit}</span>}
    </div>
  );
}

/** 数字直输参数行（程序设计说明.md §4.2：w/W/dt/初始扰动 5 项，去滑块，合法范围钳位） */
function NumberField({
  label,
  value,
  min,
  max,
  unit,
  digits,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  unit?: string;
  digits?: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Label className="w-14 shrink-0 whitespace-nowrap text-[10px] text-slate-400">{label}</Label>
      <MiniNum
        value={value}
        digits={digits}
        className="w-20 text-slate-200"
        title={`直接键入（范围 ${min} ~ ${max}${unit ?? ''}）`}
        onCommit={(v) => onChange(Math.min(max, Math.max(min, v)))}
      />
      {unit && <span className="text-[9px] text-slate-500">{unit}</span>}
      <span className="ml-auto text-[9px] text-slate-600">
        {min}~{max}
      </span>
    </div>
  );
}

const STATUS_TEXT: Record<TrackingResult['status'], string> = {
  finished: '✓ 跑完全程',
  lost: '✗ 失控判停',
  maxSteps: '… 达到步数上限',
};

/**
 * 循迹曲线图（Err(t) / 轮速(t)）：recharts + 统一缩放（程序设计说明.md §3.4）。
 * 浮动窗内随窗口尺寸重排（程序设计说明.md §3.5，width/height 由 FloatingChart 传入）；
 * 点击数据点联动车位（程序设计说明.md §3.6，onPointClick(t)）。
 */
function TrackingChart({
  data,
  series,
  yLabel,
  width,
  height,
  onPointClick,
}: {
  data: { t: number; [k: string]: number }[];
  series: { key: string; color: string; name: string; unit?: string }[];
  yLabel: string;
  width?: number;
  height?: number;
  onPointClick?: (tSec: number) => void;
}) {
  const CH_W = Math.max(240, Math.round(width ?? 318));
  const CH_H = Math.max(120, Math.round(height ?? 96));
  // recharts 布局：YAxis 默认宽 60，margin.left=-22 -> 绘图区左缘 38；XAxis 默认高 30
  const PL = 38;
  const PR = 6;
  const PT = 4;
  const PB = 30;
  const plotW = CH_W - PL - PR;
  const plotH = CH_H - PT - PB;

  const tMax = data.length > 0 ? data[data.length - 1].t : 1;
  const zoom = useChartZoom(0, Math.max(tMax, 1e-6));
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const downFracRef = useRef<number | null>(null);
  const fracOf = (clientX: number, rect: DOMRect) =>
    (clientX - rect.left - PL) / plotW;
  useEffect(() => zoom.attachWheel(wrapRef.current, fracOf), [zoom]);

  const vis = useMemo(
    () => data.filter((r) => r.t >= zoom.domain[0] && r.t <= zoom.domain[1]),
    [data, zoom.domain],
  );

  const onMouseDown = (ev: React.MouseEvent<HTMLDivElement>) => {
    if (ev.button === 2) return;
    const rect = ev.currentTarget.getBoundingClientRect();
    const f = fracOf(ev.clientX, rect);
    downFracRef.current = f;
    if (ev.button === 1 || ev.shiftKey) zoom.beginPan(f);
    else zoom.beginBox(f);
    ev.preventDefault();
    const move = (e: MouseEvent) => zoom.dragTo(fracOf(e.clientX, rect));
    const up = (e: MouseEvent) => {
      zoom.endDrag(fracOf(e.clientX, rect));
      // 单击（非框选）：联动车位（程序设计说明.md §3.6）——取最近数据点时刻
      const f0 = downFracRef.current;
      downFracRef.current = null;
      if (f0 !== null && Math.abs(fracOf(e.clientX, rect) - f0) < 0.02 && onPointClick && data.length > 0) {
        const t = zoom.domain[0] + f0 * (zoom.domain[1] - zoom.domain[0]);
        let best = data[0].t;
        let bestD = Infinity;
        for (const r of data) {
          const d = Math.abs(r.t - t);
          if (d < bestD) {
            bestD = d;
            best = r.t;
          }
        }
        onPointClick(best);
      }
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  return (
    <div>
      <div className="text-[10px] text-slate-500">{yLabel}</div>
      <div
        ref={wrapRef}
        className="relative select-none"
        style={{ width: CH_W, height: CH_H, cursor: 'crosshair' }}
        onMouseDown={onMouseDown}
        onDoubleClick={zoom.reset}
      >
        {zoom.zoomed && <ZoomResetButton onReset={zoom.reset} />}
        <LineChart width={CH_W} height={CH_H} data={vis} margin={{ top: PT, right: PR, bottom: 0, left: -22 }}>
          <XAxis
            dataKey="t"
            type="number"
            domain={zoom.domain}
            tick={{ fontSize: 9, fill: '#64748b' }}
          />
          <YAxis tick={{ fontSize: 9, fill: '#64748b' }} />
          <ChartTooltip
            contentStyle={{ background: '#0f172a', border: '1px solid #334155', fontSize: 11 }}
            formatter={(v, name) => {
              const se = series.find((s) => s.key === name);
              return [
                typeof v === 'number' ? `${v.toFixed(3)}${se?.unit ? ` ${se.unit}` : ''}` : String(v),
                se?.name ?? String(name),
              ];
            }}
            labelFormatter={(v) => `t = ${v} s`}
          />
          {series.map((s) => (
            <Line
              key={s.key}
              dataKey={s.key}
              name={s.key}
              stroke={s.color}
              strokeWidth={1.4}
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
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
      <div className="text-center text-[9px] text-slate-600">{ZOOM_HINT} · 点击定位车位</div>
    </div>
  );
}

export default function TrackingPanel({
  params,
  onChange,
  result,
  formulaError,
  sensorNames,
  onExport,
  onAutoTune,
  ranges,
  onRangeChange,
  onChartPointClick,
}: Props) {
  const set = (patch: Partial<TrackingParams>) => onChange({ ...params, ...patch });

  // 一键调 PID 状态（程序设计说明.md §4.3）
  const [kpMax, setKpMax] = useState(30);
  const [kdMax, setKdMax] = useState(5);
  const [eInMaxMm, setEInMaxMm] = useState(50); // 弯道内收上限（程序设计说明.md §4.3 轨迹形状目标）
  const [tuning, setTuning] = useState<{ done: number; total: number } | null>(null);
  const [tuneMsg, setTuneMsg] = useState('');

  const runAutoTune = async () => {
    setTuning({ done: 0, total: 1 });
    setTuneMsg('');
    try {
      const best = await onAutoTune(kpMax, kdMax, eInMaxMm, (done, total) =>
        setTuning({ done, total }),
      );
      if (best) {
        set({ kp: best.kp, kd: best.kd });
        setTuneMsg(`✓ 已填入最优 Kp=${best.kp.toFixed(2)}、Kd=${best.kd.toFixed(3)}`);
      } else {
        setTuneMsg('未找到能跑完全程的 (Kp, Kd) 组合——可放宽搜索范围或降低 v_base');
      }
    } finally {
      setTuning(null);
    }
  };

  // Err(t) / 轮速(t) 曲线小图：降采样到 ≤240 点
  const chartData = useMemo(() => {
    if (!result || result.steps === 0) return [];
    const stride = Math.max(1, Math.ceil(result.steps / 240));
    const rows: { t: number; err: number; vL: number; vR: number }[] = [];
    for (let i = 0; i < result.steps; i += stride) {
      rows.push({
        t: Number(result.t[i].toFixed(2)),
        err: result.err[i],
        vL: result.vL[i],
        vR: result.vR[i],
      });
    }
    return rows;
  }, [result]);

  return (
    <div className="space-y-3 p-3 pt-0">
      <Separator className="bg-slate-700" />
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-300">循迹闭环仿真</span>
          <div className="flex items-center gap-2">
            <Label className="text-[10px] text-slate-500">{params.enabled ? '已启用' : '已关闭'}</Label>
            <Switch
              checked={params.enabled}
              onCheckedChange={(v) => set({ enabled: v })}
              aria-label="启用循迹闭环仿真"
            />
          </div>
        </div>

        {!params.enabled && (
          <div className="rounded border border-slate-700/60 px-2 py-2.5 text-[11px] leading-4 text-slate-500">
            开启后：电感读数 → 误差公式 → PD → 两轮差速轮速 → 运动学积分，
            小车轨迹实时绘制在中央画布；读数随当前数据源（仿真 / 实测模型）。
          </div>
        )}

        {params.enabled && (
          <>
            {/* 误差公式 */}
            <div>
              <div className="mb-1 flex justify-between text-[10px] text-slate-400">
                <span>误差公式（差比和差加权，可编辑）</span>
              </div>
              <Textarea
                className="h-14 resize-none bg-slate-900 font-mono text-[11px] leading-4"
                value={params.formula}
                onChange={(e) => set({ formula: e.target.value })}
                spellCheck={false}
              />
              {formulaError ? (
                <div className="mt-1 rounded border border-red-800/60 bg-red-900/20 px-1.5 py-1 text-[10px] text-red-300">
                  {formulaError}
                </div>
              ) : (
                <div className="mt-1 text-[10px] text-slate-500">
                  可用变量：{[...sensorNames, 'A', 'B', 'C', 'P'].join('、')}；支持 + − * /、括号、abs()、|·|
                </div>
              )}
            </div>

            {/* 权重与 PD（滑块，两端量程可编辑，程序设计说明.md §4.2） */}
            <div className="space-y-1.5">
              <div className="text-[10px] font-semibold text-slate-400">
                误差权重 / PD（滑块两端数值 = 可编辑量程）
              </div>
              <SliderField id="A" label="A 横向差" value={params.A} min={0} max={10} step={0.1} onChange={(v) => set({ A: v })} ranges={ranges} onRangeChange={onRangeChange} />
              <SliderField id="B" label="B 宽对差" value={params.B} min={0} max={10} step={0.1} onChange={(v) => set({ B: v })} ranges={ranges} onRangeChange={onRangeChange} />
              <SliderField id="C" label="C 分母" value={params.C} min={0} max={10} step={0.1} onChange={(v) => set({ C: v })} ranges={ranges} onRangeChange={onRangeChange} />
              <SliderField id="P" label="P 比例" value={params.P} min={0} max={20} step={0.1} onChange={(v) => set({ P: v })} ranges={ranges} onRangeChange={onRangeChange} />
              <SliderField id="kp" label="Kp" value={params.kp} min={0} max={30} step={0.05} onChange={(v) => set({ kp: v })} ranges={ranges} onRangeChange={onRangeChange} />
              <SliderField id="kd" label="Kd" value={params.kd} min={0} max={5} step={0.01} onChange={(v) => set({ kd: v })} ranges={ranges} onRangeChange={onRangeChange} />
            </div>

            {/* 一键调 PID（程序设计说明.md §4.3：目标 = 轨迹形状贴合） */}
            <div className="space-y-1.5 rounded border border-slate-700 bg-slate-800/40 p-2">
              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 flex-1 border-cyan-700/60 bg-cyan-950/40 text-[11px] text-cyan-300"
                  disabled={!result || tuning !== null}
                  onClick={runAutoTune}
                >
                  {tuning ? `整定中 ${((tuning.done / Math.max(1, tuning.total)) * 100).toFixed(0)}%…` : '⚙ 一键调 PID'}
                </Button>
                <Label className="whitespace-nowrap text-[10px] text-slate-500">Kp≤</Label>
                <Input
                  type="number"
                  min={1}
                  max={200}
                  className="h-6 w-12 bg-slate-900 px-1 text-[11px]"
                  value={kpMax}
                  onChange={(e) => setKpMax(Math.min(200, Math.max(1, Number(e.target.value) || 30)))}
                />
                <Label className="whitespace-nowrap text-[10px] text-slate-500">Kd≤</Label>
                <Input
                  type="number"
                  min={0.1}
                  max={50}
                  step={0.1}
                  className="h-6 w-12 bg-slate-900 px-1 text-[11px]"
                  value={kdMax}
                  onChange={(e) => setKdMax(Math.min(50, Math.max(0.1, Number(e.target.value) || 5)))}
                />
                <Label className="whitespace-nowrap text-[10px] text-slate-500">内收≤</Label>
                <Input
                  type="number"
                  min={0}
                  max={200}
                  step={5}
                  className="h-6 w-12 bg-slate-900 px-1 text-[11px]"
                  value={eInMaxMm}
                  onChange={(e) => setEInMaxMm(Math.min(200, Math.max(0, Number(e.target.value) || 0)))}
                />
              </div>
              <div className="text-[9px] leading-3.5 text-slate-500">
                在 Kp∈[0,{kpMax}]、Kd∈[0,{kdMax}] 网格搜索（粗搜后局部细化），逐组跑循迹仿真，
                目标 = 轨迹形状贴合：直线段贴合中线（罚 |e|），弯道允许内收 ≤{eInMaxMm}mm 不罚、
                外偏 2 倍罚、罚航向抖动保证过弯圆润；先比能否完赛，再比目标最小，最后比完赛时间。
              </div>
              {tuneMsg && <div className="text-[10px] text-emerald-300">{tuneMsg}</div>}
            </div>

            {/* 速度 / 底盘 */}
            <div className="space-y-1.5">
              <div className="text-[10px] font-semibold text-slate-400">速度 / 底盘</div>
              <SliderField id="vBase" label="v_base" value={params.vBase} min={0.1} max={3} step={0.05} unit="m/s" onChange={(v) => set({ vBase: Math.max(0.05, v) })} ranges={ranges} onRangeChange={onRangeChange} />
              <SliderField id="vMax" label="v_max" value={params.vMax} min={0.2} max={5} step={0.1} unit="m/s" onChange={(v) => set({ vMax: Math.max(0.1, v) })} ranges={ranges} onRangeChange={onRangeChange} />
              <NumberField label="w 内:外" value={params.w} min={0.01} max={99} digits={2} onChange={(v) => set({ w: v })} />
              <NumberField
                label="轮距 W"
                value={Math.round(params.wheelBase * 1000)}
                min={50}
                max={500}
                unit="mm"
                onChange={(v) => set({ wheelBase: v / 1000 })}
              />
              <NumberField label="dt" value={params.dtMs} min={0.5} max={50} unit="ms" digits={1} onChange={(v) => set({ dtMs: v })} />
              <NumberField
                label="电机τm"
                value={params.motorTauMs}
                min={0}
                max={500}
                unit="ms"
                onChange={(v) => set({ motorTauMs: v })}
              />
              <div className="text-[10px] text-slate-500">
                电机一阶滞后：实际轮速按 τ_m·dv/dt+v=v_cmd 跟随指令（0 = 瞬时跟随）
              </div>
            </div>

            {/* 初始扰动 / 判停 */}
            <div className="space-y-1.5">
              <div className="text-[10px] font-semibold text-slate-400">初始扰动 / 失控判停</div>
              <NumberField label="初始 e" value={params.initEMm} min={-500} max={500} unit="mm" onChange={(v) => set({ initEMm: v })} />
              <NumberField label="初始 ψ" value={params.initPsiDeg} min={-90} max={90} unit="°" digits={1} onChange={(v) => set({ initPsiDeg: v })} />
              <SliderField id="errLimit" label="|Err|阈值" value={params.errLimit} min={0.1} max={5} step={0.1} onChange={(v) => set({ errLimit: Math.max(0.01, v) })} ranges={ranges} onRangeChange={onRangeChange} />
              <SliderField
                id="errLimitSteps"
                label="失控步数"
                value={params.errLimitSteps}
                min={10}
                max={1000}
                step={10}
                unit="步"
                onChange={(v) => set({ errLimitSteps: Math.max(1, Math.round(v)) })}
                ranges={ranges}
                onRangeChange={onRangeChange}
              />
              <div className="text-[10px] text-slate-500">
                |Err| 持续超限 {params.errLimitSteps} 步判失控；跑过赛道总长（闭环=一圈）判完成
              </div>
            </div>

            {/* 结果状态 */}
            {result ? (
              <div className="space-y-1.5 rounded border border-slate-700 bg-slate-800/40 p-2">
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className={`text-[10px] ${
                      result.status === 'finished'
                        ? 'border-emerald-700/60 text-emerald-300'
                        : result.status === 'lost'
                          ? 'border-red-800/60 text-red-400'
                          : 'border-amber-700/60 text-amber-300'
                    }`}
                  >
                    {STATUS_TEXT[result.status]}
                  </Badge>
                  <span className="font-mono text-[10px] text-slate-400">
                    {result.steps} 步 · 用时 {result.timeS.toFixed(2)}s · 弧长{' '}
                    {(result.distM * 1000).toFixed(0)}mm · 重算 {result.elapsedMs.toFixed(0)}ms
                  </span>
                </div>
                <FloatingChart id="trkErr" title="Err(t)" defaultW={420} defaultH={200}>
                  {(w, h) => (
                    <TrackingChart
                      data={chartData}
                      yLabel="Err(t)"
                      series={[{ key: 'err', color: '#fb923c', name: 'Err' }]}
                      {...(w !== null && h !== null ? { width: w, height: h - 34 } : {})}
                      onPointClick={onChartPointClick}
                    />
                  )}
                </FloatingChart>
                <FloatingChart id="trkWheels" title="轮速 v_L / v_R (t)" defaultW={420} defaultH={200}>
                  {(w, h) => (
                    <TrackingChart
                      data={chartData}
                      yLabel="轮速 v_L / v_R (t)（m/s）"
                      series={[
                        { key: 'vL', color: '#22d3ee', name: 'v_L 左轮', unit: 'm/s' },
                        { key: 'vR', color: '#f472b6', name: 'v_R 右轮', unit: 'm/s' },
                      ]}
                      {...(w !== null && h !== null ? { width: w, height: h - 34 } : {})}
                      onPointClick={onChartPointClick}
                    />
                  )}
                </FloatingChart>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 w-full border-slate-600 bg-slate-800 text-[11px]"
                  onClick={onExport}
                >
                  导出轨迹 CSV（t, x, y, θ, v_L, v_R, Err, 各电感 U）
                </Button>
              </div>
            ) : (
              <div className="rounded border border-slate-700/60 px-2 py-2.5 text-center text-[11px] text-slate-500">
                无赛道或无电感 —— 铺设赛道并保留至少一个电感后自动开始仿真
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
