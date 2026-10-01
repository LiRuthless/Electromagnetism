/**
 * WASM 车载控制器自检（npm run selfcheck:wasm，Phase 13，specs/features/13-wasm-controller/）：
 *
 * [1] V-2 ABI 健壮性：编程构造的最小 wasm 字节（不依赖本机 clang）——
 *     无效字节 / ABI 版本不符 / 运行时 trap / 缺全部任务入口 / env 导入缺失
 *     全部拒绝或回退，进程不崩溃；另含式 (13.1) pwmToWheelCmd 映射单元检查。
 * [2] V-3 多速率入口探测：仅 ctrl_task_2ms / 仅 ctrl_task_1ms 的 wasm 均能加载并跑完
 *     （缺失入口跳过，missingEntries 报提示）。
 * [3] V-1 fixture 一致性：scripts/fixtures/pd_controller.wasm（模板 PD 示例，
 *     由 controller-template/build.bat 本机 clang 编译后提交入库）与 FormulaController
 *     同参数对照——轨迹 RMS 偏差 < 5mm（float32 容差）、status 一致、完赛时间差 < 5%。
 *     fixture 缺失时明确报错（不静默跳过）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_TRACKING, compileFormula } from '../src/mathmodel/control';
import type { TrackingParams } from '../src/mathmodel/control';
import { buildFieldElements, samplePath } from '../src/mathmodel/track';
import { defaultLayout, kFromAnchor } from '../src/mathmodel/sensor';
import { FormulaController } from '../src/mathmodel/sim/controller';
import { createSensorSampler } from '../src/mathmodel/sim/vehicle';
import { Simulator } from '../src/mathmodel/sim/simulator';
import { pwmToWheelCmd } from '../src/mathmodel/sim/controllerAbi';
import { WasmController } from '../src/mathmodel/sim/wasmController';

let failures = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) failures++;
};

// ---------------- 最小 wasm 字节构造（V-2/V-3 用，不依赖 clang） ----------------

const MAGIC = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
const F32 = 0x7d;
const I32 = 0x7f;

const lebU = (n: number): number[] => {
  const out: number[] = [];
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n) b |= 0x80;
    out.push(b);
  } while (n);
  return out;
};
const lebS = (n: number): number[] => {
  const out: number[] = [];
  for (;;) {
    let b = n & 0x7f;
    n >>= 7;
    if ((n === 0 && (b & 0x40) === 0) || (n === -1 && (b & 0x40) !== 0)) {
      out.push(b);
      return out;
    }
    b |= 0x80;
    out.push(b);
  }
};
const strB = (s: string): number[] => [...lebU(s.length), ...[...s].map((c) => c.charCodeAt(0))];
const section = (id: number, payload: number[]): number[] => [id, ...lebU(payload.length), ...payload];
const functype = (params: number[], results: number[]) => [
  0x60,
  ...lebU(params.length),
  ...params,
  ...lebU(results.length),
  ...results,
];
const codeSec = (bodies: number[][]) =>
  section(10, [...lebU(bodies.length), ...bodies.flatMap((b) => [...lebU(b.length), ...b])]);

/** 导出 ctrl_task_2ms，任务体 = unreachable（运行时 trap） */
function modTrap(): Uint8Array {
  return new Uint8Array([
    ...MAGIC,
    ...section(1, [...lebU(1), ...functype([], [])]),
    ...section(3, [...lebU(1), 0]),
    ...section(7, [...lebU(1), ...strB('ctrl_task_2ms'), 0x00, ...lebU(0)]),
    ...codeSec([[0x00, 0x00, 0x0b]]),
  ]);
}

/** 导出全局 CTRL_ABI_VERSION = 99 + 空 ctrl_task_2ms（版本不符） */
function modAbiMismatch(): Uint8Array {
  return new Uint8Array([
    ...MAGIC,
    ...section(1, [...lebU(1), ...functype([], [])]),
    ...section(3, [...lebU(1), 0]),
    ...section(6, [...lebU(1), I32, 0x00, 0x41, ...lebS(99), 0x0b]),
    ...section(7, [
      ...lebU(2),
      ...strB('CTRL_ABI_VERSION'),
      0x03,
      ...lebU(0),
      ...strB('ctrl_task_2ms'),
      0x00,
      ...lebU(0),
    ]),
    ...codeSec([[0x00, 0x0b]]),
  ]);
}

/** 仅导出 ctrl_init（任务入口全缺） */
function modNoTasks(): Uint8Array {
  return new Uint8Array([
    ...MAGIC,
    ...section(1, [...lebU(1), ...functype([], [])]),
    ...section(3, [...lebU(1), 0]),
    ...section(7, [...lebU(1), ...strB('ctrl_init'), 0x00, ...lebU(0)]),
    ...codeSec([[0x00, 0x0b]]),
  ]);
}

/** 导入宿主未提供的 env.no_such_host_fn（链接失败） */
function modMissingImport(): Uint8Array {
  return new Uint8Array([
    ...MAGIC,
    ...section(1, [...lebU(1), ...functype([], [])]),
    ...section(2, [...lebU(1), ...strB('env'), ...strB('no_such_host_fn'), 0x00, ...lebU(0)]),
    ...section(3, [...lebU(1), 0]),
    ...section(7, [...lebU(1), ...strB('ctrl_task_2ms'), 0x00, ...lebU(1)]),
    ...codeSec([[0x00, 0x10, 0x00, 0x0b]]),
  ]);
}

/** 仅 ctrl_task_2ms：set_motor_pwm(0.5, 0.5) 直行 */
function modOnly2ms(): Uint8Array {
  const f32c05 = [0x43, 0x00, 0x00, 0x00, 0x3f];
  return new Uint8Array([
    ...MAGIC,
    ...section(1, [...lebU(2), ...functype([F32, F32], []), ...functype([], [])]),
    ...section(2, [...lebU(1), ...strB('env'), ...strB('set_motor_pwm'), 0x00, ...lebU(0)]),
    ...section(3, [...lebU(1), 1]),
    ...section(7, [...lebU(1), ...strB('ctrl_task_2ms'), 0x00, ...lebU(1)]),
    ...codeSec([[0x00, ...f32c05, ...f32c05, 0x10, 0x00, 0x0b]]),
  ]);
}

/** 仅 ctrl_task_1ms（空体）：无控制输出，宿主按 v_base 直行 */
function modOnly1ms(): Uint8Array {
  return new Uint8Array([
    ...MAGIC,
    ...section(1, [...lebU(1), ...functype([], [])]),
    ...section(3, [...lebU(1), 0]),
    ...section(7, [...lebU(1), ...strB('ctrl_task_1ms'), 0x00, ...lebU(0)]),
    ...codeSec([[0x00, 0x0b]]),
  ]);
}

/** ctrl_task_2ms：read_adc(0) > 0 时 set_motor_pwm(0.5, 0.5)——验证 env 读数通道映射生效 */
function modAdcDrive(): Uint8Array {
  const f32c0 = [0x43, 0x00, 0x00, 0x00, 0x00];
  const f32c05 = [0x43, 0x00, 0x00, 0x00, 0x3f];
  const body = [
    0x00, // locals
    0x41, 0x00, // i32.const 0
    0x10, 0x00, // call read_adc
    ...f32c0,
    0x5e, // f32.gt
    0x04, 0x40, // if (void)
    ...f32c05,
    ...f32c05,
    0x10, 0x01, // call set_motor_pwm
    0x0b, // end if
    0x0b, // end func
  ];
  return new Uint8Array([
    ...MAGIC,
    ...section(1, [
      ...lebU(3),
      ...functype([I32], [F32]),
      ...functype([F32, F32], []),
      ...functype([], []),
    ]),
    ...section(2, [
      ...lebU(2),
      ...strB('env'),
      ...strB('read_adc'),
      0x00,
      ...lebU(0),
      ...strB('env'),
      ...strB('set_motor_pwm'),
      0x00,
      ...lebU(1),
    ]),
    ...section(3, [...lebU(1), 2]),
    ...section(7, [...lebU(1), ...strB('ctrl_task_2ms'), 0x00, ...lebU(2)]),
    ...codeSec([body]),
  ]);
}

// ---------------- 公共仿真装配（4m 直道 + 默认 4 电感布局 + 仿真源） ----------------

const track = { name: '直道', segments: [{ kind: 'line' as const, length: 4 }] };
const path = samplePath(track);
const elements = buildFieldElements(track);
const sensors = defaultLayout();
const params: TrackingParams = { ...DEFAULT_TRACKING, enabled: true, dtMs: 1 };
const sampler = createSensorSampler({
  path,
  elements,
  currentMa: 100,
  k: kFromAnchor(6),
  sourceKind: 'simulation',
  measured: null,
});

function simWithWasm(ctrl: WasmController, p: TrackingParams = params) {
  const sim = new Simulator({
    path,
    sensors,
    vehicle: { controller: ctrl, sampler, params: p },
    tasks: ctrl.taskEntries(),
    closed: false,
  });
  sim.reset(p); // wasm 重新实例化（全新状态，宿主已 attach）
  return sim;
}

const CREATE_OPTS = () => ({
  fileName: 'test.wasm',
  sensorNames: sensors.map((s) => s.name),
  vMax: params.vMax,
});

// ---- [1] V-2 ABI 健壮性 ----
console.log('[1] V-2 ABI 健壮性：五类故障全部拒绝/回退，不崩溃');

check(pwmToWheelCmd(0.5, 2) === 1 && pwmToWheelCmd(1, 2) === 2, '  式(13.1)：pwm 0.5/1.0 → 1.0/2.0 m/s');
check(pwmToWheelCmd(-0.5, 2) === 0, '  式(13.1)：负 pwm（倒车语义）循迹限幅钳到 0');
check(pwmToWheelCmd(2, 2) === 2 && pwmToWheelCmd(-3, 2) === 0, '  式(13.1)：越界指令收回 [−1,1] 后限幅');

try {
  await WasmController.create(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), CREATE_OPTS());
  check(false, '  无效字节：应拒绝');
} catch (e) {
  check(String(e).includes('编译失败'), `  无效字节 → 拒绝（${e}）`);
}

try {
  await WasmController.create(modAbiMismatch(), CREATE_OPTS());
  check(false, '  ABI v99：应拒绝');
} catch (e) {
  check(String(e).includes('ABI 版本不符'), `  ABI 版本不符 → 拒绝（${e}）`);
}

try {
  await WasmController.create(modNoTasks(), CREATE_OPTS());
  check(false, '  缺全部任务入口：应拒绝');
} catch (e) {
  check(String(e).includes('缺少全部任务入口'), `  缺全部任务入口 → 拒绝（${e}）`);
}

try {
  await WasmController.create(modMissingImport(), CREATE_OPTS());
  check(false, '  env 导入缺失：应拒绝');
} catch (e) {
  check(String(e).includes('实例化失败'), `  env 导入缺失 → 拒绝（${e}）`);
}

{
  const trap = await WasmController.create(modTrap(), CREATE_OPTS());
  check(
    trap.missingEntries.join(',') === 'ctrl_init,ctrl_task_1ms',
    `  trap 模块加载成功，缺失入口提示 = [${trap.missingEntries.join('、')}]`,
  );
  const r = simWithWasm(trap).runToEnd();
  check(trap.trapError !== null, `  运行时 trap → trapError 置位（${trap.trapError}）`);
  check(
    r.status === 'finished',
    `  trap 后指令零阶保持（v_base 直行）跑完直道，进程不崩溃（status=${r.status}）`,
  );
}

// ---- [2] V-3 多速率入口探测 ----
console.log('\n[2] V-3 多速率入口探测：单一任务入口的 wasm 也能跑');

{
  const c2 = await WasmController.create(modOnly2ms(), CREATE_OPTS());
  check(
    c2.missingEntries.includes('ctrl_task_1ms') && !c2.missingEntries.includes('ctrl_task_2ms'),
    `  仅 ctrl_task_2ms：加载成功，跳过缺失入口 [${c2.missingEntries.join('、')}]`,
  );
  check(
    c2.taskEntries().length === 1 && c2.taskEntries()[0].periodMs === 2,
    '  任务周期表仅含 2ms 入口',
  );
  const r = simWithWasm(c2).runToEnd();
  check(
    r.status === 'finished' && c2.trapError === null,
    `  pwm(0.5,0.5) 直行完赛（status=${r.status}，弧长 ${r.distM.toFixed(2)}m）`,
  );
}

{
  const c1 = await WasmController.create(modOnly1ms(), CREATE_OPTS());
  check(
    c1.missingEntries.includes('ctrl_task_2ms') && c1.taskEntries().length === 1,
    `  仅 ctrl_task_1ms：加载成功，跳过缺失入口 [${c1.missingEntries.join('、')}]`,
  );
  const r = simWithWasm(c1).runToEnd();
  check(
    r.status === 'finished' && c1.trapError === null,
    `  无控制输出 → 宿主 v_base 兜底直行完赛（status=${r.status}）`,
  );
}

{
  const adc = await WasmController.create(modAdcDrive(), CREATE_OPTS());
  const r = simWithWasm(adc).runToEnd();
  check(
    r.status === 'finished' && adc.trapError === null,
    `  read_adc(0)>0 驱动 pwm(0.5,0.5) 完赛（status=${r.status}）——env 读数通道映射生效（通道失效则停车触顶 maxSteps）`,
  );
}

// ---- [3] V-1 fixture 一致性 ----
console.log('\n[3] V-1 fixture 一致性：pd_controller.wasm vs FormulaController（同参数对照）');
{
  const fixturePath = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'pd_controller.wasm');
  if (!existsSync(fixturePath)) {
    check(
      false,
      '  fixture 缺失：scripts/fixtures/pd_controller.wasm 不存在——' +
        '请本机安装 clang 后在 controller-template/ 跑 build.bat 生成并复制入库（见 validation.md fixture 生成流程）',
    );
  } else {
    const bytes = readFileSync(fixturePath);
    const wasm = await WasmController.create(bytes, CREATE_OPTS());
    check(
      wasm.missingEntries.length === 0,
      `  fixture 加载成功（入口齐全${wasm.missingEntries.length ? `，缺失 ${wasm.missingEntries}` : ''}）`,
    );
    // 同参数对照：P=−1（默认布局负反馈，与 controller.c 的 P_GAIN 一致），控制周期 2ms 对齐
    const p: TrackingParams = { ...params, initEMm: 50, P: -1 };
    const formulaSim = new Simulator({
      path,
      sensors,
      vehicle: {
        controller: new FormulaController(p, compileFormula(p.formula)),
        sampler,
        params: p,
      },
      tasks: [{ periodMs: 2, entry: 'control' }],
      closed: false,
    });
    const rf = formulaSim.runToEnd();
    const rw = simWithWasm(wasm, p).runToEnd();
    check(rw.status === rf.status, `  status 一致（wasm=${rw.status} / 内置=${rf.status}）`);
    const n = Math.min(rw.steps, rf.steps);
    let sum = 0;
    for (let i = 0; i < n; i++) sum += (rw.x[i] - rf.x[i]) ** 2 + (rw.y[i] - rf.y[i]) ** 2;
    const rms = Math.sqrt(sum / Math.max(1, n));
    check(rms < 5e-3, `  轨迹 (x,y) RMS 偏差 ${(rms * 1000).toFixed(3)}mm < 5mm（float32 容差，${n} 步）`);
    if (rf.status === 'finished') {
      const dt = Math.abs(rw.timeS - rf.timeS) / rf.timeS;
      check(dt < 0.05, `  完赛时间相对差 ${(dt * 100).toFixed(2)}% < 5%`);
    }
  }
}

console.log(failures === 0 ? '\nWASM 车载控制器自检全部通过 ✓' : `\n${failures} 项失败 ✗`);
process.exit(failures === 0 ? 0 : 1);
