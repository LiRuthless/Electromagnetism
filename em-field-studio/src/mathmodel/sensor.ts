/**
 * 电感（传感器）模型：布局表 + 响应公式 + 车体坐标变换。
 * 与 Python 版 track_model/sensor.py 一致。
 *
 * 响应公式（图片给定）：|u(t)| = k·cosθ·B，θ = 敏感轴与 B 方向夹角；
 * ADC 幅值检测取绝对值：U = k·|B·n̂|（Vpp，检波后等效峰峰值）。
 * k 由标定锚点反推：20kHz/100mA 标准信号源下电感垂直贴信号线输出 Vpp（5–7V），
 * 贴线几何 = 线半径 0.25mm + 电感半径 3mm = 3.25mm，B_touch = μ₀I/(2π·3.25mm)。
 *
 * 电感规格：6×8 工字电感 + 电容小板（Ø6mm × 高 10mm，不含脚）。
 * 点探头近似：6mm 直径 ≪ 典型探测距离（≥20mm），按几何中心点采样成立。
 * 车体坐标系：x 向右，y 向前（车头），z 向上。
 */
import { MU0 } from './field';

/** 电感规格（展示用） */
export const INDUCTOR_SPEC = '6×8 工字电感（Ø6mm × 10mm）';
/** 电感半径（m）：Ø6mm -> 3mm；画布标记按真实尺寸绘制 */
export const INDUCTOR_RADIUS_M = 0.003;
/** 标定贴线距离（m）：线半径 0.25mm + 电感半径 3mm = 3.25mm */
export const TOUCH_DIST_M = 0.00025 + INDUCTOR_RADIUS_M;
/** 标定锚点默认 Vpp（V）：20kHz/100mA 下垂直贴线输出 5–7V */
export const VPP_ANCHOR_DEFAULT = 6;

/** 贴线处磁场幅值（T）：B = μ₀I/(2π·3.25mm)，默认 I=100mA ≈ 6.154μT */
export function touchField(I = 0.1): number {
  return (MU0 * I) / (2 * Math.PI * TOUCH_DIST_M);
}

/** 由标定锚点反推 k（V/T）：k = Vpp_anchor / B_touch；电流变化时 k 不变、读数随 B 线性缩放 */
export function kFromAnchor(vppAnchor: number = VPP_ANCHOR_DEFAULT, I = 0.1): number {
  return vppAnchor / touchField(I);
}

/** 敏感轴预设：z=竖直（感 Bz）、x=水平横向（感 Bx）、y=水平纵向即车头方向（感 By）、custom=自定义 */
export type AxisPreset = 'z' | 'x' | 'y' | 'custom';

export interface SensorDef {
  id: string;
  name: string;
  /** 车体系坐标（m）：x 右、y 前 */
  x: number;
  y: number;
  /** 安装高度 h（m，距赛道平面） */
  h: number;
  axisPreset: AxisPreset;
  /** 自定义敏感轴（车体系，无需归一化），axisPreset = 'custom' 时生效 */
  axis: [number, number, number];
}

export function axisVector(s: SensorDef): [number, number, number] {
  const v: [number, number, number] =
    s.axisPreset === 'z'
      ? [0, 0, 1]
      : s.axisPreset === 'x'
        ? [1, 0, 0]
        : s.axisPreset === 'y'
          ? [0, 1, 0]
          : s.axis;
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
}

let uid = 0;
function nextId() {
  return `s${Date.now().toString(36)}_${uid++}`;
}

/**
 * 默认布局（2026-08-03 设计变更）：与工作区预设 `presets/sensor-layout.json` 等价的 4 电感。
 * 前排/主对/宽对同在 y=80mm 纵排，安装高度 h=75mm：
 *   L1(−50mm, 主对·左, 纵向感 By) / R1(+50mm, 主对·右, 纵向感 By)
 *   L2(−75mm, 宽对·左, 横向感 Bx) / R2(+75mm, 宽对·右, 横向感 Bx)
 * 仅影响初始状态与"恢复默认"；已有 localStorage 布局不受影响。
 */
export function defaultLayout(): SensorDef[] {
  const mk = (
    name: string,
    x: number,
    axisPreset: AxisPreset,
  ): SensorDef => ({ id: nextId(), name, x, y: 0.08, h: 0.075, axisPreset, axis: [0, 0, 1] });
  return [
    mk('L1', -0.05, 'y'),
    mk('R1', 0.05, 'y'),
    mk('L2', -0.075, 'x'),
    mk('R2', 0.075, 'x'),
  ];
}

/** 车体位姿（方案 4.3） */
export interface CarPose {
  /** 赛道中线参考点（世界系） */
  px: number;
  py: number;
  /** 赛道切向单位向量 */
  tx: number;
  ty: number;
  /** 横向偏差 e（m，>0 向行进方向右侧偏移） */
  e: number;
  /** 航向角 ψ（rad，>0 向右偏） */
  psi: number;
}

/** 由位姿求车体三轴（世界系）：origin / forward / right */
export function poseFrame(pose: CarPose) {
  const { px, py, tx, ty, e, psi } = pose;
  const n = Math.hypot(tx, ty) || 1;
  const tX = tx / n;
  const tY = ty / n;
  const rTx = tY; // 切向右侧法向
  const rTy = -tX;
  const origin = { x: px + e * rTx, y: py + e * rTy };
  const c = Math.cos(psi);
  const s = Math.sin(psi);
  const forward = { x: c * tX + s * rTx, y: c * tY + s * rTy };
  const right = { x: c * rTx - s * tX, y: c * rTy - s * tY };
  return { origin, forward, right };
}

/** 电感世界坐标（返回平面 xy 与高度 h） */
export function sensorWorld(
  s: SensorDef,
  frame: ReturnType<typeof poseFrame>,
): { x: number; y: number; h: number } {
  const { origin, forward, right } = frame;
  return {
    x: origin.x + s.x * right.x + s.y * forward.x,
    y: origin.y + s.x * right.y + s.y * forward.y,
    h: s.h,
  };
}

/** 电感敏感轴世界向量（xy 平面分量 + z） */
export function sensorAxisWorld(
  s: SensorDef,
  frame: ReturnType<typeof poseFrame>,
): [number, number, number] {
  const [ax, ay, az] = axisVector(s);
  const { forward, right } = frame;
  return [
    ax * right.x + ay * forward.x,
    ax * right.y + ay * forward.y,
    az,
  ];
}

export interface SensorReading {
  name: string;
  value: number; // U = k·|B·n̂|（V，检波后等效峰峰值 Vpp；k 由贴线标定锚点反推）
  /** 世界坐标（供画布叠加显示） */
  x: number;
  y: number;
  /** 该电感处 B 三分量（Tesla，可选；tooltip 自查物理用） */
  bx?: number;
  by?: number;
  bz?: number;
}
