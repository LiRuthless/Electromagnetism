/**
 * WASM 车载控制器宿主（Phase 13，specs/features/13-wasm-controller/）：
 * 用户的真实车载 C 代码编译为 wasm 后载入，作为虚拟整车的车载程序参与循迹闭环。
 *
 * - ABI = 宿主导入函数（syscall 式，见 controllerAbi.ts）+ 任务入口存在性探测
 *   （缺哪个跳过哪个，missingEntries 供 UI 提示；任务入口全缺 = 无效控制器）；
 * - create() 异步编译（浏览器主线程同步编译受 4KB 上限约束）；reset() 由已编译
 *   Module 同步重新实例化——每次重算/热替换得到全新 wasm 状态（全局变量/内存清零）；
 * - 健壮性（FR-7）：无效字节 / env 导入缺失 / ABI 版本不符 / 入口全缺 / ctrl_init
 *   失败 → create() 抛中文错误；运行时 trap → trapError 置位、实例作废（任务不再
 *   调用，指令零阶保持），调用方丢弃结果并回退内置 FormulaController，绝不崩溃；
 * - env 闭包经 ControllerHost 绑定当前 Vehicle 真值与最新读数（Simulator 构造时
 *   attach）；IMU/编码器/时间全部由运动学真值合成，本期不加噪声（非目标）。
 */
import { CTRL_ABI_VERSION, CTRL_INIT_ENTRY, CTRL_TASKS, createMathImports, pwmToWheelCmd } from './controllerAbi';
import type { CarController, ControllerHost, WheelCommand } from './controller';
import type { TrackingParams } from '../control';
import type { SimTaskEntry } from './simulator';

type TaskFn = () => void;

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export class WasmController implements CarController {
  readonly fileName: string;
  readonly abiVersion = CTRL_ABI_VERSION;
  /** 探测缺失而被跳过的入口名（UI 提示用） */
  readonly missingEntries: string[] = [];
  /** 运行时 trap 信息（非 null = 实例已作废，调用方回退内置控制器） */
  trapError: string | null = null;

  private module: WebAssembly.Module;
  private fnInit: TaskFn | null = null;
  private fnTask1ms: TaskFn | null = null;
  private fnTask2ms: TaskFn | null = null;
  private host: ControllerHost | null = null;
  private sensorNames: string[];
  private vMax: number;
  /** 本任务周期内 set_motor_pwm 写入的指令（任务间消费，未写则零阶保持） */
  private cmd: WheelCommand | null = null;
  /** read_accel_x 差分状态（相邻两次调用的质心速度差 / Δt） */
  private prevV: number | null = null;
  private prevTMs = 0;

  private constructor(
    module: WebAssembly.Module,
    opts: { fileName: string; sensorNames: string[]; vMax: number },
  ) {
    this.module = module;
    this.fileName = opts.fileName;
    this.sensorNames = opts.sensorNames;
    this.vMax = opts.vMax;
  }

  /**
   * 编译并实例化 wasm 控制器。无效字节 / env 导入缺失 / ABI 版本不符 /
   * 任务入口全缺 / ctrl_init trap → 抛中文错误（调用方提示并回退内置控制器）。
   */
  static async create(
    bytes: BufferSource,
    opts: { fileName: string; sensorNames: string[]; vMax: number },
  ): Promise<WasmController> {
    let module: WebAssembly.Module;
    try {
      module = await WebAssembly.compile(bytes);
    } catch (e) {
      throw new Error(`wasm 编译失败：${errMsg(e)}`);
    }
    const c = new WasmController(module, opts);
    c.instantiateFresh();
    return c;
  }

  /** Simulator 构造时注入宿主（最新读数 + 整车真值） */
  attach(host: ControllerHost): void {
    this.host = host;
  }

  /** read_adc 通道顺序 = 电感布局数组顺序（ch 0–3，越界返回 0） */
  setSensorNames(names: string[]): void {
    this.sensorNames = names;
  }

  /** vMax 跟随循迹参数（式 (13.1) 映射上限；Vehicle.reset 注入） */
  setParams(params: TrackingParams): void {
    this.vMax = params.vMax;
  }

  /** CarController.init：幂等空操作——实例在 create()/reset() 时已初始化并调过 ctrl_init */
  init(): void {}

  /** 复位 = 由已编译 Module 重新实例化（全新全局/内存）+ 调 ctrl_init */
  reset(): void {
    this.instantiateFresh();
  }

  /** 调度器任务入口表（仅含探测存在的入口；entry 供 Simulator 分发） */
  taskEntries(): { periodMs: number; entry: SimTaskEntry }[] {
    const out: { periodMs: number; entry: SimTaskEntry }[] = [];
    if (this.fnTask1ms) out.push({ periodMs: CTRL_TASKS[0].periodMs, entry: 'task1ms' });
    if (this.fnTask2ms) out.push({ periodMs: CTRL_TASKS[1].periodMs, entry: 'task2ms' });
    return out;
  }

  runTask1ms(): WheelCommand | null {
    return this.runEntry(this.fnTask1ms);
  }

  runTask2ms(): WheelCommand | null {
    return this.runEntry(this.fnTask2ms);
  }

  /** CarController.step 合规实现（wasm 不注册 control 任务；应急时两入口按序各跑一次） */
  step(): WheelCommand {
    const a = this.runEntry(this.fnTask1ms);
    const b = this.runEntry(this.fnTask2ms);
    return b ?? a ?? { vLCmd: 0, vRCmd: 0 };
  }

  /** 任务调用（trap 捕获：置 trapError、实例作废、返回 null = 指令零阶保持）；指令消费即清 */
  private runEntry(fn: TaskFn | null): WheelCommand | null {
    if (!fn || this.trapError) return null;
    try {
      fn();
    } catch (e) {
      this.trapError = `wasm 运行时 trap：${errMsg(e)}`;
      return null;
    }
    const cmd = this.cmd;
    this.cmd = null;
    return cmd;
  }

  /** 重新实例化 + 入口探测 + ABI 版本校验 + ctrl_init；失败抛中文错误 */
  private instantiateFresh(): void {
    let instance: WebAssembly.Instance;
    try {
      instance = new WebAssembly.Instance(this.module, { env: this.buildEnv() });
    } catch (e) {
      throw new Error(`wasm 实例化失败（含 env 导入缺失）：${errMsg(e)}`);
    }
    const ex = instance.exports as Record<string, unknown>;
    const ver = ex.CTRL_ABI_VERSION;
    let declared: number | null = null;
    if (ver instanceof WebAssembly.Global) declared = Number(ver.value);
    else if (typeof ver === 'function') declared = Number((ver as () => number)());
    if (declared !== null && declared !== CTRL_ABI_VERSION) {
      throw new Error(`控制器 ABI 版本不符：wasm 声明 v${declared}，宿主 v${CTRL_ABI_VERSION}`);
    }
    this.fnInit = typeof ex[CTRL_INIT_ENTRY] === 'function' ? (ex[CTRL_INIT_ENTRY] as TaskFn) : null;
    this.fnTask1ms =
      typeof ex[CTRL_TASKS[0].name] === 'function' ? (ex[CTRL_TASKS[0].name] as TaskFn) : null;
    this.fnTask2ms =
      typeof ex[CTRL_TASKS[1].name] === 'function' ? (ex[CTRL_TASKS[1].name] as TaskFn) : null;
    this.missingEntries.length = 0;
    if (!this.fnInit) this.missingEntries.push(CTRL_INIT_ENTRY);
    if (!this.fnTask1ms) this.missingEntries.push(CTRL_TASKS[0].name);
    if (!this.fnTask2ms) this.missingEntries.push(CTRL_TASKS[1].name);
    if (!this.fnTask1ms && !this.fnTask2ms) {
      throw new Error(
        `缺少全部任务入口（${CTRL_TASKS[0].name} / ${CTRL_TASKS[1].name}），不是有效的车载控制器`,
      );
    }
    this.cmd = null;
    this.prevV = null;
    this.trapError = null;
    if (this.fnInit) {
      try {
        this.fnInit();
      } catch (e) {
        throw new Error(`ctrl_init 执行失败：${errMsg(e)}`);
      }
    }
  }

  private dynamics(): { vL: number; vR: number; wheelBase: number; tMs: number } {
    return this.host?.getDynamics() ?? { vL: 0, vR: 0, wheelBase: 0.135, tMs: 0 };
  }

  /** env 导入函数表（syscall 式；SI 单位，set_motor_pwm 归一化例外）；每次实例化重建闭包 */
  private buildEnv(): Record<string, (...args: number[]) => number | void> {
    return {
      ...createMathImports(),
      read_adc: (ch: number) => {
        const r = this.host?.getReadings();
        const name = this.sensorNames[ch | 0];
        if (!r || !name) return 0;
        return r.u[name] ?? 0;
      },
      read_gyro_z: () => {
        const d = this.dynamics();
        return (d.vR - d.vL) / Math.max(d.wheelBase, 1e-4);
      },
      read_accel_x: () => {
        const d = this.dynamics();
        const v = (d.vL + d.vR) / 2;
        if (this.prevV === null) {
          this.prevV = v;
          this.prevTMs = d.tMs;
          return 0;
        }
        const dt = (d.tMs - this.prevTMs) / 1000;
        const a = dt > 0 ? (v - this.prevV) / dt : 0;
        this.prevV = v;
        this.prevTMs = d.tMs;
        return a;
      },
      read_accel_y: () => {
        const d = this.dynamics();
        const v = (d.vL + d.vR) / 2;
        const w = (d.vR - d.vL) / Math.max(d.wheelBase, 1e-4);
        return v * w;
      },
      read_encoder_speed: () => {
        const d = this.dynamics();
        return (d.vL + d.vR) / 2;
      },
      get_time_ms: () => this.dynamics().tMs,
      set_motor_pwm: (left: number, right: number) => {
        this.cmd = {
          vLCmd: pwmToWheelCmd(left, this.vMax),
          vRCmd: pwmToWheelCmd(right, this.vMax),
        };
      },
    };
  }
}
