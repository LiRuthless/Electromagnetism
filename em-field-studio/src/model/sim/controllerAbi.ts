/**
 * 车载控制器 WASM ABI v1（specs/features/model/13-wasm-controller/，techstack 硬性约束 6）。
 *
 * ABI 风格 = 宿主导入函数（syscall 式，module = "env"），不传内存结构体：
 * 多 MCU / 算法频繁更换时不与线性内存布局耦合。全部 float32 参数与返回值、
 * SI 单位，唯 set_motor_pwm 归一化 −1..1 例外（对齐实车电机占空比直觉，式 (13.1)）。
 *
 * 任务入口（wasm 导出，宿主存在性探测，缺哪个跳过哪个并报提示，全缺 = 无效控制器）：
 *   ctrl_init()      载入/复位时调用一次；
 *   ctrl_task_1ms()  1ms 周期任务（传感器采集）；
 *   ctrl_task_2ms()  2ms 周期任务（控制）。
 *
 * ABI 一经发布不得静默变更：任何导入表/入口表/语义修改必须升 CTRL_ABI_VERSION，
 * 并同步 controller-template/ 与自检 fixture；旧 ABI 的 wasm 仍可加载或明确报版本错误。
 */

/** ABI 版本号：wasm 可导出同名符号（全局或函数）声明版本，不匹配拒绝加载；未导出按 v1 宽容受理 */
export const CTRL_ABI_VERSION = 1;

/** 载入/复位入口（可选） */
export const CTRL_INIT_ENTRY = 'ctrl_init';

/** 周期任务入口表（ABI v1 固定两个；周期表可扩展，新增入口须升 ABI 版本） */
export const CTRL_TASKS = [
  { name: 'ctrl_task_1ms', periodMs: 1 },
  { name: 'ctrl_task_2ms', periodMs: 2 },
] as const;

/** math 兜底导入表（freestanding -nostdlib 编译时 libm 未解析符号由宿主提供） */
export const MATH_IMPORTS = [
  'sinf',
  'cosf',
  'tanf',
  'asinf',
  'acosf',
  'atanf',
  'atan2f',
  'sqrtf',
  'fabsf',
  'powf',
  'expf',
  'logf',
  'floorf',
  'ceilf',
  'fmodf',
] as const;

/** math 兜底导入实现（float32 签名由 wasm 边界自动收窄，直接映射 Math.*） */
export function createMathImports(): Record<string, (...args: number[]) => number> {
  return {
    sinf: Math.sin,
    cosf: Math.cos,
    tanf: Math.tan,
    asinf: Math.asin,
    acosf: Math.acos,
    atanf: Math.atan,
    atan2f: Math.atan2,
    sqrtf: Math.sqrt,
    fabsf: Math.abs,
    powf: Math.pow,
    expf: Math.exp,
    logf: Math.log,
    floorf: Math.floor,
    ceilf: Math.ceil,
    fmodf: (x, y) => x % y,
  };
}

/**
 * 式 (13.1)：归一化电机指令 → 指令轮速（m/s）。
 * 内层 clamp 收回 [−1,1]（负值 = 倒车语义）；pwm∈[0,1] 线性映射到 [0,vMax]；
 * 循迹场景沿用式 (8.5) 限幅 [0, vMax]——负 PWM 净效果为钳到 0（停车）。
 */
export function pwmToWheelCmd(pwm: number, vMax: number): number {
  const c = Math.min(1, Math.max(-1, pwm));
  return Math.min(vMax, Math.max(0, c * vMax));
}
