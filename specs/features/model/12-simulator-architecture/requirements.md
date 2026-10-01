# Phase 12: 仿真器架构分层 — 需求

> 本 Phase 为架构等价重构，原则上不新增物理公式；引用既有公式按 05 规约锚点链接（式 [(8.10)](../05-tracking-control/requirements.md#eq-8-10) / [(8.11)](../05-tracking-control/requirements.md#eq-8-11)）。2026-10-01 实现落地，全部需求 ✅。

## 功能需求

### FR-1　控制器接口 `CarController` 与内置 `FormulaController`（✅）

模型层定义控制器抽象（`src/model/sim/controller.ts`），控制器是"读数进、轮速指令出"的纯数据黑盒：

```ts
/** 电感读数包（纯数据，SI 单位：U 为 Vpp 数值，时间为 ms） */
export interface SensorReadings {
  /** 采样时刻（仿真时钟，ms，自 reset 起算） */
  tMs: number;
  /** 各电感读数（key = 电感名，值 = U / Vpp） */
  u: Record<string, number>;
}

/** 轮速指令（纯数据，m/s） */
export interface WheelCommand {
  vLCmd: number;
  vRCmd: number;
  /** 可选诊断：控制器内部误差（FormulaController 每步上报；供失控判停式 (8.10) 与轨迹记录） */
  err?: number;
}

/** 车载控制器接口（Phase 13 WASM 控制器的宿主插桩点） */
export interface CarController {
  /** 载入/初始化（参数注入；幂等） */
  init(): void;
  /** 控制任务周期到点触发：读数进、轮速指令出 */
  step(readings: SensorReadings): WheelCommand;
  /** 复位内部状态（微分历史、积分器等） */
  reset(): void;
}
```

`FormulaController` 为内置实现：构造参数 = `TrackingParams` + 编译后的 `CompiledFormula`；`step()` 内部逐行复刻现有 `simulateTracking()` 内联逻辑——公式求值（分母为零/未知变量/NaN 回退上一步误差）、首步 `errRate = 0`、之后 `errRate = (err − prevErr) / Δt`（Δt 取相邻两次 `step()` 的 `tMs` 差，秒）、`pdOutput()`、`wheelSpeeds()` 限幅。用途：无外部控制器时的兜底 + 重构等价性的对照组（V-3）。

### FR-2　多速率周期任务调度器（✅，`src/model/sim/scheduler.ts`）

- 任务表 `[{ periodMs, entry }]`，按注册顺序执行；**物理积分步长 dtSim 与控制任务周期分离**——控制周期不再必然等于积分步长。
- **整数微秒时间轴**：构造时将 `dtSimMs` 与各 `periodMs` 经 `Math.round(x × 1000)` 转整数 µs；调度器内部时钟、到期判定、到期点推进全部整数运算，防长程浮点漂移。仅在对外（`SensorReadings.tMs`、记录数组 t）时换算回 float。
- 触发语义：每个物理 tick 时钟推进 `dtSimUs`；任务到期（`now ≥ due`）即触发一次，随后 `due += periodUs` 循环推进至 `due > now`（**过期周期合并**：单个 tick 内同一任务至多触发一次，不补触发）。**控制指令在两个 tick 之间零阶保持**（ZOH）——未到期的 tick 沿用上次指令。
- 现有行为 = 单任务 `periodMs = dtMs` 特例：此时每 tick 恰好触发一次，语义与 `simulateTracking()` 内联循环完全一致（V-1/V-2 防护）。

### FR-3　虚拟整车 `Vehicle` 与读数采样器（✅，`src/model/sim/vehicle.ts`）

- **读数采样器工厂** `createSensorSampler(opts)`：收敛 `Home.tsx` 现三处重复闭包（约 575–591 / 643–666 / 692–709 行）为单一实现。入参为纯数据：

```ts
createSensorSampler(opts: {
  path: PathSample;
  elements: FieldElement[];   // buildFieldElements 产物
  sensors: SensorDef[];
  currentMa: number;
  k: number;                  // 标定系数 kCal
  sourceKind: SourceKind;     // 'simulation' | 'measured-fit' | 'measured-phys'
  measured: MeasuredState | null;
}): (sensor: SensorDef, world: { x: number; y: number }, axisWorld: [number, number, number]) => number;
```

  策略与现状逐行一致：实测源（fit/phys）先换算有符号横向距离 d（mm）经 `evalMeasured()` 求值，通道无数据（返回 null）回退仿真公式 `k·|B·n̂|`；仿真源直接 `computeB()` 投影。
- `Vehicle` 持有：当前位姿 `CarState`、实际轮速状态（vL/vR，初始 = v_base）、控制器实例、采样器。每物理 tick 行为（单任务特例下与 `simulateTracking()` 逐行对齐）：按当前位姿经 `carFrame()` 求各电感世界坐标/敏感轴 → 采样得读数包 → 到期任务触发 `controller.step()` 得指令（未到期零阶保持）→ `motorLag()` 按 dtSim 精确更新实际轮速（式 [(8.6)](../05-tracking-control/requirements.md#eq-8-6)[(8.7)](../05-tracking-control/requirements.md#eq-8-7)）→ `stepCar()` 半隐式欧拉积分新位姿（式 [(8.8)](../05-tracking-control/requirements.md#eq-8-8)[(8.9)](../05-tracking-control/requirements.md#eq-8-9)）。
- 初始位姿规则不变：起点中线 + 切向航向 + initE/initPsi 扰动；滞后状态初始 v_L = v_R = v_base。

### FR-4　Simulator 门面（✅，`src/model/sim/simulator.ts`）

```ts
export class Simulator {
  constructor(opts: {
    path: PathSample;
    sensors: SensorDef[];
    vehicle: { controller: CarController; sampler: SensorSampler; params: TrackingParams };
    tasks: { periodMs: number; entry: 'control' }[]; // 首期仅控制任务一类入口
    closed: boolean;
    maxSteps?: number;
  });
  /** 复位全部仿真状态（位姿/轮速/控制器/调度器时钟/记录）并注入新参数（完整 TrackingParams，实现口径） */
  reset(params?: TrackingParams): void;
  /** 实时逐帧：推进一个物理 tick，返回当帧快照（位姿/轮速/err/读数/是否终止） */
  step(dtMs?: number): SimFrame;
  /** 快进：一次算全程至终止，返回 TrackingResult（等价现有 simulateTracking 行为） */
  runToEnd(): TrackingResult;
}
```

- 终止条件沿用式 [(8.10)](../05-tracking-control/requirements.md#eq-8-10)：行驶弧长 ≥ 赛道总长（闭环，仅一圈）/ ≥ 总长 + 0.5 m（非闭环）→ finished；控制器上报 err 且 |Err| 持续超 `errLimit` 达 `errLimitSteps` 步 → lost；步数硬上限 100000（`MAX_TRACKING_STEPS`）→ maxSteps；位姿 NaN → lost。控制器不上报 err 时失控判停退化为 NaN/步数上限。
- `runToEnd()` 记录语义与现状一致：逐 tick 记录 t/x/y/θ/vL/vR/err/sensorU（vL/vR 为电机滞后后的**实际**轮速）、`finishIndex`（首次跑满赛道总长的记录索引）、`timeS`/`distM`/`steps`/`elapsedMs`。

### FR-5　一键调 PID 迁入模型层（✅，`src/model/sim/autotune.ts`）

- 现有 `Home.tsx runAutoTune()`（681–806 行）整体迁入：网格搜索 (Kp, Kd)（粗搜 13×11 + 最优邻域 9×9 细化）、式 [(8.11)](../05-tracking-control/requirements.md#eq-8-11) 轨迹形状贴合目标函数（直线贴中线 / 弯道内收 ≤ e_in_max 不罚 / 外偏双倍罚 / 航向抖动罚）、逐轨迹点按 `segSpans` 段类型分类 + `createNearestSeeker` 局部最近点 O(窗口) 评价、选优顺序（先完赛 → J 最小 → 完赛时间最短）均保持逐行等价。
- `segSpans` 段弧长区间表构建（现 Home.tsx 870–883 行，闭环吸合段按直线段处理）随评价逻辑一并迁入，导出 `buildSegSpans(segments, closed, pathLength)`。
- **分块让出的职责划分**：模型层不依赖 `setTimeout`（硬性约束 2）。接口为**生成器**：

```ts
/** 逐候选评估后 yield 进度；return 最优组合（无可行解为 null） */
export function autoTuneGrid(opts: {
  simulator: Simulator;          // 已装配 FormulaController 的仿真器
  baseParams: TrackingParams;    // 除 kp/kd 外其余参数
  path: PathSample;              // 评价器局部最近点查询用（实现时增补，原接口块遗漏）
  segSpans: SegSpan[];           // 段类型区间表（buildSegSpans 产物，实现时增补）
  kpMax: number; kdMax: number; eInMaxMm: number;
}): Generator<{ done: number; total: number }, { kp: number; kd: number } | null>;

/** 同步排干包装（Node 自检 / 非交互场景用） */
export function runAutoTuneSync(opts: AutoTuneOpts): { kp: number; kd: number } | null;
```

  UI 侧驱动：每取 8 个候选（沿现状粒度）`await setTimeout(0)` 让出事件循环并刷新进度百分比。

### FR-6　`simulateTracking()` 兼容薄壳（✅，`src/model/kinematics.ts`）

- `simulateTracking()` 改为 `Simulator.runToEnd()` 的**兼容薄壳**：签名（`{ path, sensors, params, formula, readSensor, maxSteps?, closed? }`）与返回结构 `TrackingResult` 完全不变；内部装配"单任务 `periodMs = dtMs` + `FormulaController` + 透传 `readSensor` 的采样器适配"后调 `runToEnd()`。
- **选择薄壳而非改调用点**（2026-10-01 确认）：`scripts/model/selfcheck-tracking.ts`、`matlab-simulink/` 对照注释、既有导出链路均指向该函数，薄壳扰动最小且本身即等价性活证据；薄壳留作稳定公共入口，不计划废弃。
- `kinematics.ts` 继续导出 `CarState` / `stepCar()` / `carFrame()` / `TrackingResult` / `FINISH_TOLERANCE_M` / `MAX_TRACKING_STEPS`（`Vehicle` 复用 `stepCar()` / `carFrame()`，不复制实现）。

### FR-7　Home.tsx 瘦身（✅）

- 删除三处重复读数闭包（约 575–591、643–666、692–709 行），统一改调 `createSensorSampler()`；删除 `runAutoTune`（约 681–806 行）改调 `sim/autotune.ts` 生成器 + UI 驱动循环；删除 `segSpans` 本地构建改调 `buildSegSpans()`。
- Home.tsx 保留职责：状态编排（appState 读写、防抖 `trackingTick`、位姿来源切换、数据源切换）、UI 组件装配、导出。页面内不再出现场计算/实测求值/网格搜索细节。

### FR-8　实时模式与播放控制（✅）

- 循迹控制区（TrackingPanel 结果区）新增模式切换：**快进**（现有行为）/ **实时**。
- 实时模式：rAF 循环驱动 `simulator.step()`，画布逐帧叠加轨迹与车框；播放控制 = 运行 / 暂停 / 重置 / 倍速（0.25× / 0.5× / 1× / 2× / 4×）。倍速经整数 µs 累加器折算每帧推进的 tick 数，不引入浮点时间漂移。
- 播放状态（模式/播放中/倍速/当前仿真时刻）为会话内 `useState`，**不入 appState**（schema 不动，见 TC-3）。
- 终止（finished/lost/maxSteps）后自动停在末帧并显示结果摘要；重置回初始位姿。

### FR-9　快进模式行为保留（✅）

快进模式维持现状：任一循迹参数（含公式）修改后防抖 ~200ms 经 `trackingTick` 重算全程（`runToEnd()`），轨迹线/Err(t)/轮速(t)/电感值图/结果摘要同步刷新；轨迹进度滑块回放、位姿来源"跟随仿真轨迹"、CSV 导出（接口②）行为不变（见 [`specs/features/model/05-tracking-control/requirements.md`](../05-tracking-control/requirements.md) FR-13/FR-14/FR-15）。

### FR-10　appState schema 不动（✅）

本 Phase 不新增/不修改 appState 字段，`APP_STATE_VERSION` 保持 6；循迹参数 `tracking` 与量程 `trackingRanges` 持久化语义不变（[`specs/features/ui/07-persistence-export/requirements.md`](../../ui/07-persistence-export/requirements.md)）。

## 技术约束

- **TC-1**：SI 单位内部计算（m、rad、s、m/s、Vpp 数值）；ms 仅出现在调度器对外接口与 UI 层，内部时间轴为整数 µs（[`specs/techstack.md`](../../../techstack.md) 硬性约束 1）。
- **TC-2**：`src/model/sim/` 与 `src/model/` 全体同为纯计算层：禁止 UI / React / DOM / `setTimeout` / `performance.now` 之外的计时依赖（`elapsedMs` 统计除外）；读数策略经纯数据入参注入，模型层不感知 React 状态（[`specs/techstack.md`](../../../techstack.md) 硬性约束 2）。
- **TC-3**：appState schema 纪律——本 Phase 不动 schema、不升版本；实时播放状态一律会话内 `useState`（[`specs/techstack.md`](../../../techstack.md) 硬性约束 3）。
- **TC-4**：误差公式解析仍走 `compileFormula()` 递归下降，禁 `eval`（[`specs/techstack.md`](../../../techstack.md) 硬性约束 5）；`FormulaController` 不新增表达式能力。
- **TC-5**：等价搬移——同一赛道/参数下 `Simulator.runToEnd()` 轨迹与重构前 `simulateTracking()` 基线逐点一致（容差 < 1e-12，预期 0）；浮点运算顺序不得在重构中"顺手优化"。
- **TC-6**：数值稳健沿用 Phase 5：dt 下限 0.5 ms、轮距下限 1e-4 m、`motorLag()` 精确更新、公式求值回退、NaN 判失控（见 [`05-tracking-control` TC-6](../05-tracking-control/requirements.md)）。
- **TC-7**：性能不退化——快进全程仍主线程毫秒级；一键调 PID 评价仍 `createNearestSeeker` O(窗口)；实时模式单帧开销 ≤ 快进单步开销（同一份 step 实现）。

## 接口约定

### 代码落点

| 文件 | 内容 |
|---|---|
| `src/model/sim/controller.ts` | `SensorReadings`、`WheelCommand`、`CarController` 接口、`FormulaController`（内置兜底/对照组） |
| `src/model/sim/scheduler.ts` | 多速率周期任务调度器（任务表、整数 µs 时间轴、ZOH、过期周期合并） |
| `src/model/sim/vehicle.ts` | `createSensorSampler()`（收敛三处读数策略）、`Vehicle`（位姿/实际轮速/控制器持有/电机滞后/运动学积分） |
| `src/model/sim/simulator.ts` | `Simulator` 门面（`reset` / `step` / `runToEnd`）、`SimFrame` 快照、终止条件式 [(8.10)](../05-tracking-control/requirements.md#eq-8-10) |
| `src/model/sim/autotune.ts` | `autoTuneGrid()` 生成器 + `runAutoTuneSync()`、`buildSegSpans()`、式 [(8.11)](../05-tracking-control/requirements.md#eq-8-11) 评价 |
| `src/model/kinematics.ts` | `simulateTracking()` 兼容薄壳（签名/`TrackingResult` 不变）；`stepCar()`/`carFrame()` 等保持导出 |
| `src/ui/pages/Home.tsx` | 瘦身：删三处读数闭包/`runAutoTune`/`segSpans`，保留状态编排与持久化；实时模式 rAF 驱动 |
| `src/ui/components/TrackingPanel.tsx` | 模式切换（快进/实时）+ 播放控制（运行/暂停/重置/倍速） |
| `scripts/model/gen-tracking-baseline.ts` | 基线 fixture 生成（重构前一次性运行并提交产物） |
| `scripts/model/fixtures/tracking-baseline.json` | V-1 回归基线（轨迹全数组 + 参数快照 + 生成提交哈希） |
| `scripts/model/selfcheck-sim.ts` | 新增自检 `npm run selfcheck:sim`（V-1/V-2/V-3/V-5） |
| `src/ui/utils/appState.ts` | **不动**（`APP_STATE_VERSION` 保持 6） |

### 调度器参数与语义

| 项 | 约定 |
|---|---|
| 物理积分步长 dtSim | 由 `params.dtMs` 来（下限 0.5 ms），内部转整数 µs |
| 任务表 | `[{ periodMs, entry }]`，注册序执行；首期 `entry` 仅 `'control'` 一类 |
| 触发判定 | `now ≥ due` 触发一次，`due += periodUs` 推进至 `due > now`（过期合并） |
| 零阶保持 | 任务未触发的 tick 沿用上次 `WheelCommand`（初值 = 首触发前以 v_base 直行指令） |
| 时间精度 | 内部整数 µs；对外 `tMs`/`t` 为 float（由整数换算，无累积误差） |

### `TrackingResult` 结构

与 Phase 5 完全一致（见 [`05-tracking-control/requirements.md`](../05-tracking-control/requirements.md#接口约定)），本 Phase 不增删字段。

## 非目标（Non-goals）

- WASM 控制器加载与宿主导入函数 ABI（属 Phase 13 `13-wasm-controller`，本 Phase 只交付 `CarController` 接口与调度器这两个插桩点）。
- 传感器噪声 / IMU 合成等读数链路细化（读数策略仅收敛搬家，不增强）。
- 仿真 Worker 化 / 多线程（用户已明确同进程方案；主线程毫秒级足够）。
- 新增物理公式或调整任何默认参数（等价重构）。
- `matlab-simulink/` 对照移植同步改动（公式与数值行为不变，无需同步）。
- 控制周期 ≠ 积分步长的 UI 暴露（多速率能力本 Phase 交付在模型层接口与自检，UI 配置入口待 Phase 13 随 WASM 任务表一并开放）。
- 实时模式的轨迹记录 CSV 导出增强（沿用现有接口② 导出快进结果即可）。
