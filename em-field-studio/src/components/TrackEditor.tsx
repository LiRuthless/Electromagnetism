/**
 * 左侧面板：鼠标连线铺设（主）、圆弧辅助工具、形状工具（直角弯/正六边形环岛）、
 * 只读段列表、赛道库（保存/载入/重命名/删除/导入导出）、全局物理参数。
 *
 * 铺设约定（见 track.ts 头注释）：线径 0.5mm，折线顶点按尖角建模；
 * 环岛一律为正六边形（形状工具生成），不用圆形。
 */
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { segmentLength, CLOSE_SNAP_M, type SegDef, type TrackDef } from '../mathmodel/track';
import type { SavedTrack } from '../utils/exporters';
import type { FieldComponent } from './FieldCanvas';

export type EditMode = 'lay' | 'list';
/** 铺设子模式：直线连线（鼠标逐点）/ 圆弧段（参数化，沿切线接续） */
export type LayMode = 'line' | 'arc';

export interface GlobalParams {
  currentMa: number;
  heightMm: number;
  gridStepMm: number;
  component: FieldComponent;
  logScale: boolean;
}

/** 圆弧辅助工具的待定参数（半径 10mm 步进吸附） */
export interface ArcPending {
  radiusMm: number;
  angleDeg: number;
  turn: 'left' | 'right';
}

export const ARC_ANGLES = [30, 45, 60, 90, 120, 180];

interface Props {
  trackDef: TrackDef;
  params: GlobalParams;
  onParamsChange: (p: GlobalParams) => void;
  elementCount: number;
  gridCells: number;
  /** 实际生效网格步长（自动降档后） */
  effStepMm?: number;
  /** 是否因 400×400 上限自动降档 */
  gridDegraded?: boolean;
  elapsedMs: number;
  computing: boolean;
  totalLengthM: number;
  // 编辑模式与段长标注
  editMode: EditMode;
  onEditModeChange: (m: EditMode) => void;
  showSegLengths: boolean;
  onShowSegLengthsChange: (v: boolean) => void;
  // 鼠标铺设
  layMode: LayMode;
  onLayModeChange: (m: LayMode) => void;
  placing: boolean;
  onResumePlacing: () => void;
  onEndPlacing: () => void;
  arcPending: ArcPending;
  onArcPendingChange: (p: ArcPending) => void;
  onCommitArc: () => void;
  onUndoSeg: () => void;
  onClearTrack: () => void;
  // 形状工具
  onRightAngle: (lenMm: number, dir: 'left' | 'right') => void;
  onHexagon: (edgeMm: number, dir: 'left' | 'right') => void;
  // 闭环赛道（数学模型.md §4）：终点距起点 ≤ CLOSE_SNAP_M 时可勾选
  onClosedChange: (closed: boolean) => void;
  /** 当前笔尖（段序列终点）到起点的距离（mm） */
  closureGapMm: number;
  // 赛道库
  library: SavedTrack[];
  onSaveTrack: (name: string) => void;
  onLoadTrack: (name: string) => void;
  onRenameTrack: (oldName: string, newName: string) => void;
  onDeleteTrack: (name: string) => void;
  onExportTrackJSON: () => void;
  onImportTrackJSON: (file: File) => void;
}

/** 只读段列表行 */
function segText(seg: SegDef, index: number): string {
  if (seg.kind === 'line') {
    const ang = seg.absAngle !== undefined ? ` ∠${((seg.absAngle * 180) / Math.PI).toFixed(0)}°` : '';
    return `#${index + 1} 直线 ${(seg.length * 1000).toFixed(0)}mm${ang}`;
  }
  return `#${index + 1} 圆弧 R${(seg.radius * 1000).toFixed(0)}mm ${seg.angleDeg}°${seg.turn === 'left' ? '左' : '右'} 弧长${(segmentLength(seg) * 1000).toFixed(0)}mm`;
}

export default function TrackEditor(props: Props) {
  const { trackDef, params, onParamsChange, arcPending, onArcPendingChange } = props;
  const [saveName, setSaveName] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState('');
  const [raLenMm, setRaLenMm] = useState(300); // 直角弯边长 mm
  const [hexEdgeMm, setHexEdgeMm] = useState(500); // 六边形边长 mm
  const [hexDir, setHexDir] = useState<'left' | 'right'>('right');
  const importRef = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-4 p-3">
      {/* 编辑方式 */}
      <Tabs value={props.editMode} onValueChange={(v) => props.onEditModeChange(v as EditMode)}>
        <TabsList className="grid w-full grid-cols-2 bg-slate-800">
          <TabsTrigger value="lay" className="text-xs">鼠标铺设</TabsTrigger>
          <TabsTrigger value="list" className="text-xs">段列表查看</TabsTrigger>
        </TabsList>
      </Tabs>

      {props.editMode === 'lay' ? (
        /* ---------------- 鼠标铺设 ---------------- */
        <section className="space-y-3 rounded border border-cyan-800/60 bg-cyan-950/20 p-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-cyan-300">自由铺设（10mm 吸附）</span>
            <span className="font-mono text-[10px] text-slate-400">
              已铺 {trackDef.segments.length} 段
            </span>
          </div>

          <div className="flex gap-1.5">
            <Button
              variant={props.layMode === 'line' ? 'default' : 'outline'}
              size="sm"
              className={`h-7 flex-1 text-[11px] ${props.layMode === 'line' ? '' : 'border-slate-600 bg-slate-800'}`}
              onClick={() => props.onLayModeChange('line')}
            >
              直线连线
            </Button>
            <Button
              variant={props.layMode === 'arc' ? 'default' : 'outline'}
              size="sm"
              className={`h-7 flex-1 text-[11px] ${props.layMode === 'arc' ? '' : 'border-slate-600 bg-slate-800'}`}
              onClick={() => props.onLayModeChange('arc')}
            >
              圆弧段
            </Button>
          </div>

          {props.layMode === 'line' ? (
            <div className="space-y-1.5">
              <div className="rounded border border-slate-700 bg-slate-900/60 px-2 py-1.5 text-[11px] leading-4 text-slate-300">
                在画布上<span className="text-cyan-300">单击 / Enter</span> 逐点连线（顶点吸附 10mm）；
                键入数字锁定长度/角度，<span className="text-cyan-300">Tab</span> 切换输入框；
                <span className="text-cyan-300">双击 / Esc</span> 结束；滚轮缩放、中键或空格+拖拽平移。
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <span className={props.placing ? 'text-green-400' : 'text-slate-500'}>
                  {props.placing ? '● 铺设中' : '○ 已结束（单击画布继续）'}
                </span>
                {props.placing ? (
                  <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[11px] text-slate-400" onClick={props.onEndPlacing}>
                    结束
                  </Button>
                ) : (
                  <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[11px] text-cyan-400" onClick={props.onResumePlacing}>
                    继续铺设
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div>
                <div className="mb-1 flex justify-between text-xs text-slate-400">
                  <span>半径（10mm 步进）</span>
                  <span className="font-mono text-slate-200">{arcPending.radiusMm.toFixed(0)} mm</span>
                </div>
                <Slider
                  value={[arcPending.radiusMm]}
                  min={50}
                  max={2000}
                  step={10}
                  onValueChange={([v]) => onArcPendingChange({ ...arcPending, radiusMm: v })}
                />
              </div>
              <div>
                <div className="mb-1 text-xs text-slate-400">圆心角</div>
                <div className="grid grid-cols-6 gap-1">
                  {ARC_ANGLES.map((a) => (
                    <Button
                      key={a}
                      variant={arcPending.angleDeg === a ? 'default' : 'outline'}
                      size="sm"
                      className={`h-6 px-0 text-[10px] ${arcPending.angleDeg === a ? '' : 'border-slate-600 bg-slate-800'}`}
                      onClick={() => onArcPendingChange({ ...arcPending, angleDeg: a })}
                    >
                      {a}°
                    </Button>
                  ))}
                </div>
                <Input
                  type="number"
                  step={5}
                  min={1}
                  max={360}
                  className="mt-1.5 h-7 bg-slate-900 text-xs"
                  value={arcPending.angleDeg}
                  onChange={(e) =>
                    onArcPendingChange({ ...arcPending, angleDeg: Math.min(360, Math.max(1, Number(e.target.value) || 1)) })
                  }
                />
              </div>
              <div className="flex gap-1.5">
                <Button
                  variant={arcPending.turn === 'left' ? 'default' : 'outline'}
                  size="sm"
                  className={`h-7 flex-1 text-[11px] ${arcPending.turn === 'left' ? '' : 'border-slate-600 bg-slate-800'}`}
                  onClick={() => onArcPendingChange({ ...arcPending, turn: 'left' })}
                >
                  左转
                </Button>
                <Button
                  variant={arcPending.turn === 'right' ? 'default' : 'outline'}
                  size="sm"
                  className={`h-7 flex-1 text-[11px] ${arcPending.turn === 'right' ? '' : 'border-slate-600 bg-slate-800'}`}
                  onClick={() => onArcPendingChange({ ...arcPending, turn: 'right' })}
                >
                  右转
                </Button>
              </div>
              <Button size="sm" className="h-7 w-full bg-cyan-600 text-[11px] hover:bg-cyan-500" onClick={props.onCommitArc}>
                铺设该圆弧（沿当前切线接续）
              </Button>
            </div>
          )}

          {/* 形状工具 */}
          <div className="space-y-2 rounded border border-slate-700 bg-slate-900/50 p-2">
            <div className="text-[11px] font-semibold text-slate-300">形状工具（从笔尖接续）</div>
            <div className="flex items-center gap-1.5">
              <span className="w-16 shrink-0 text-[10px] text-slate-400">直角弯(尖角)</span>
              <Input
                type="number" step={1} min={1}
                className="h-6 w-14 bg-slate-900 px-1 text-[11px]"
                value={raLenMm}
                onChange={(e) => setRaLenMm(Math.max(10, Math.round((Number(e.target.value) || 10) / 10) * 10))}
              />
              <span className="text-[10px] text-slate-500">mm</span>
              <Button variant="outline" size="sm" className="h-6 flex-1 border-slate-600 bg-slate-800 px-1 text-[10px]" onClick={() => props.onRightAngle(raLenMm, 'left')}>
                左转90°
              </Button>
              <Button variant="outline" size="sm" className="h-6 flex-1 border-slate-600 bg-slate-800 px-1 text-[10px]" onClick={() => props.onRightAngle(raLenMm, 'right')}>
                右转90°
              </Button>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-16 shrink-0 text-[10px] text-slate-400">正六边形</span>
              <Input
                type="number" step={10} min={20}
                className="h-6 w-14 bg-slate-900 px-1 text-[11px]"
                value={hexEdgeMm}
                onChange={(e) => setHexEdgeMm(Math.max(20, Math.round((Number(e.target.value) || 20) / 10) * 10))}
              />
              <span className="text-[10px] text-slate-500">mm边长</span>
              <Select value={hexDir} onValueChange={(v) => setHexDir(v as 'left' | 'right')}>
                <SelectTrigger className="h-6 w-14 bg-slate-900 text-[10px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="left">左环</SelectItem>
                  <SelectItem value="right">右环</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" className="h-6 flex-1 border-slate-600 bg-slate-800 px-1 text-[10px]" onClick={() => props.onHexagon(hexEdgeMm, hexDir)}>
                生成环岛
              </Button>
            </div>
            <div className="text-[9px] leading-3.5 text-slate-500">
              环岛按正六边形建模：顶点接直线（入环边偏转 30°，无贴边），绕环一周回到入环点后继续直行（左/右环 = 六边形在直线左/右侧）；直角弯按尖角建模（最小弯曲半径 ~0.25mm ≪ 1cm 粒度）。
            </div>
          </div>

          <div className="flex gap-1.5">
            <Button variant="outline" size="sm" className="h-7 flex-1 border-slate-600 bg-slate-800 text-[11px]" onClick={props.onUndoSeg}>
              撤销一段
            </Button>
            <Button variant="outline" size="sm" className="h-7 flex-1 border-red-800 bg-red-950/40 text-[11px] text-red-300" onClick={props.onClearTrack}>
              清空重铺
            </Button>
          </div>

          {/* 闭环赛道（数学模型.md §4）：终点距起点 ≤ 20mm 时可勾选，自动吸合为闭合回路 */}
          {(() => {
            const gapMm = props.closureGapMm;
            const hasSegs = trackDef.segments.length > 0;
            const canClose = hasSegs && gapMm <= CLOSE_SNAP_M * 1000;
            const checked = !!trackDef.closed && canClose;
            return (
              <div className="space-y-1 rounded border border-slate-700 bg-slate-900/50 p-2">
                <div className="flex items-center justify-between">
                  <Label
                    className={`text-[11px] ${canClose ? 'text-slate-300' : 'text-slate-500'}`}
                    title={canClose ? '首尾吸合为闭合回路；循迹仿真仅跑一圈' : '终点距起点超过 20mm，无法闭环'}
                  >
                    闭环赛道（首尾相连）
                  </Label>
                  <Switch
                    checked={checked}
                    disabled={!canClose}
                    onCheckedChange={props.onClosedChange}
                    aria-label="闭环赛道"
                  />
                </div>
                <div className={`text-[9px] leading-3.5 ${canClose ? 'text-slate-500' : 'text-amber-400/80'}`}>
                  {hasSegs
                    ? canClose
                      ? `终点距起点 ${gapMm.toFixed(0)} mm ≤ 20mm，闭环后自动吸合；循迹仿真仅生成一圈轨迹`
                      : `终点距起点 ${gapMm.toFixed(0)} mm > 20mm，无法闭环——继续铺设使终点靠近起点`
                    : '先铺设赛道段；终点距起点 ≤20mm 时可勾选闭环'}
                </div>
              </div>
            );
          })()}
        </section>
      ) : (
        /* ---------------- 段列表（只读） ---------------- */
        <section>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-300">段序列（{trackDef.name}，只读）</span>
            <span className="font-mono text-[10px] text-slate-500">{trackDef.segments.length} 段</span>
          </div>
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {trackDef.segments.map((s, i) => (
              <div key={i} className="rounded border border-slate-700/60 bg-slate-800/40 px-2 py-1 font-mono text-[11px] text-slate-300">
                {segText(s, i)}
              </div>
            ))}
            {trackDef.segments.length === 0 && (
              <div className="text-xs text-slate-500">空序列——切换到"鼠标铺设"开始铺线，或从赛道库/JSON 载入。</div>
            )}
          </div>
          {trackDef.extraWires && trackDef.extraWires.length > 0 && (
            <div className="mt-1 text-[10px] text-slate-500">
              含 {trackDef.extraWires.length} 条附加导线（随旧格式 JSON 载入）。
            </div>
          )}
          <div className="mt-1.5 text-[10px] text-slate-500">
            修改请用"鼠标铺设"模式的撤销/清空，或导入 JSON。
          </div>
        </section>
      )}

      {/* 段长标注开关 */}
      <div className="flex items-center justify-between">
        <Label className="text-xs text-slate-400">显示每段长度标注</Label>
        <Switch checked={props.showSegLengths} onCheckedChange={props.onShowSegLengthsChange} />
      </div>

      <Separator className="bg-slate-700" />

      {/* 赛道库 */}
      <section className="space-y-2">
        <div className="text-xs font-semibold text-slate-300">赛道库（本地保存）</div>
        <div className="flex gap-1.5">
          <Input
            className="h-7 bg-slate-900 text-xs"
            placeholder="赛道名称"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
          />
          <Button
            variant="outline"
            size="sm"
            className="h-7 shrink-0 border-slate-600 bg-slate-800 text-[11px]"
            onClick={() => {
              const n = saveName.trim() || trackDef.name || '未命名赛道';
              props.onSaveTrack(n);
              setSaveName('');
            }}
          >
            保存当前
          </Button>
        </div>
        <div className="space-y-1">
          {props.library.map((t) => (
            <div key={t.name} className="flex items-center gap-1 rounded border border-slate-700 bg-slate-800/60 px-2 py-1">
              {renaming === t.name ? (
                <>
                  <Input
                    className="h-6 flex-1 bg-slate-900 px-1 text-[11px]"
                    value={renameVal}
                    onChange={(e) => setRenameVal(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && renameVal.trim()) {
                        props.onRenameTrack(t.name, renameVal.trim());
                        setRenaming(null);
                      }
                    }}
                  />
                  <Button
                    variant="ghost" size="sm" className="h-5 px-1.5 text-[11px] text-green-400"
                    onClick={() => {
                      if (renameVal.trim()) props.onRenameTrack(t.name, renameVal.trim());
                      setRenaming(null);
                    }}
                  >
                    ✓
                  </Button>
                </>
              ) : (
                <>
                  <span className="flex-1 truncate text-[11px] text-slate-200">{t.name}</span>
                  <span className="font-mono text-[9px] text-slate-500">
                    {(t.def.segments.reduce((a, s) => a + segmentLength(s), 0) * 1000).toFixed(0)}mm · {t.savedAt.slice(0, 10)}
                  </span>
                  <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[11px] text-cyan-400" onClick={() => props.onLoadTrack(t.name)}>
                    载入
                  </Button>
                  <Button
                    variant="ghost" size="sm" className="h-5 px-1.5 text-[11px] text-slate-400"
                    onClick={() => { setRenaming(t.name); setRenameVal(t.name); }}
                  >
                    改名
                  </Button>
                  <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[11px] text-red-400" onClick={() => props.onDeleteTrack(t.name)}>
                    删
                  </Button>
                </>
              )}
            </div>
          ))}
          {props.library.length === 0 && <div className="text-[11px] text-slate-500">暂无已保存赛道。</div>}
        </div>
        <div className="flex gap-1.5">
          <Button variant="outline" size="sm" className="h-6 flex-1 border-slate-600 bg-slate-800 text-[11px]" onClick={props.onExportTrackJSON}>
            导出赛道 JSON
          </Button>
          <Button variant="outline" size="sm" className="h-6 flex-1 border-slate-600 bg-slate-800 text-[11px]" onClick={() => importRef.current?.click()}>
            导入赛道 JSON
          </Button>
          <input
            ref={importRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) props.onImportTrackJSON(f);
              e.target.value = '';
            }}
          />
        </div>
      </section>

      <Separator className="bg-slate-700" />

      {/* 全局参数 */}
      <section className="space-y-3">
        <div className="text-xs font-semibold text-slate-300">物理参数</div>
        <div>
          <div className="mb-1 flex justify-between text-xs text-slate-400">
            <span>赛道电流 I</span>
            <span className="font-mono text-slate-200">{params.currentMa} mA</span>
          </div>
          <Slider
            value={[params.currentMa]}
            min={20}
            max={200}
            step={5}
            onValueChange={([v]) => onParamsChange({ ...params, currentMa: v })}
          />
        </div>
        <div>
          <div className="mb-1 flex justify-between text-xs text-slate-400">
            <span>观测平面高度 h</span>
            <span className="font-mono text-slate-200">{params.heightMm} mm</span>
          </div>
          <Slider
            value={[params.heightMm]}
            min={20}
            max={120}
            step={5}
            onValueChange={([v]) => onParamsChange({ ...params, heightMm: v })}
          />
        </div>
        <div className="rounded border border-slate-700 bg-slate-900/50 px-2 py-1.5">
          <div className="flex justify-between text-xs text-slate-400">
            <span>电磁线直径 d（仅物理说明）</span>
            <span className="font-mono text-slate-200">0.5 mm</span>
          </div>
          <div className="mt-0.5 text-[10px] leading-3.5 text-slate-500">
            由安培环路定理，圆截面导线外部磁场与同轴无限细线电流严格相同，
            故线径不影响场计算（外部场只取决于总电流）。
          </div>
        </div>
        <div className="flex items-center justify-between">
          <Label className="text-xs text-slate-400">网格步长</Label>
          <Select
            value={String(params.gridStepMm)}
            onValueChange={(v) => onParamsChange({ ...params, gridStepMm: Number(v) })}
          >
            <SelectTrigger className="h-7 w-24 bg-slate-900 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="5">5 mm</SelectItem>
              <SelectItem value="10">10 mm</SelectItem>
              <SelectItem value="20">20 mm</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between">
          <Label className="text-xs text-slate-400">显示分量</Label>
          <Select
            value={params.component}
            onValueChange={(v) => onParamsChange({ ...params, component: v as FieldComponent })}
          >
            <SelectTrigger className="h-7 w-24 bg-slate-900 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="bz">Bz（竖直）</SelectItem>
              <SelectItem value="bx">Bx（横向）</SelectItem>
              <SelectItem value="bmag">|B|（幅值）</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {params.component === 'bmag' && (
          <div className="flex items-center justify-between">
            <Label className="text-xs text-slate-400">对数色标</Label>
            <Switch
              checked={params.logScale}
              onCheckedChange={(v) => onParamsChange({ ...params, logScale: v })}
            />
          </div>
        )}
      </section>

      <Separator className="bg-slate-700" />

      {/* 计算状态 */}
      <section className="space-y-1 font-mono text-[11px] text-slate-500">
        <div>离散电流元：{props.elementCount} 段</div>
        <div>
          网格：{props.gridCells.toLocaleString()} 单元（上限 160k）
          {props.gridDegraded && props.effStepMm !== undefined && (
            <span className="ml-1 text-amber-400">已自动降档至 {props.effStepMm}mm</span>
          )}
        </div>
        <div>赛道总长：{(props.totalLengthM * 1000).toFixed(0)} mm</div>
        <div>
          {props.computing ? '计算中…' : `上次重算 ${props.elapsedMs.toFixed(0)} ms`}
        </div>
      </section>
    </div>
  );
}
