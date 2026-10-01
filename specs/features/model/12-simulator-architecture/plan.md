# Phase 12: 仿真器架构分层 — 实现计划

> 本规约为全新设计（绿地正向，2026-10-01 与用户访谈确认设计要点后起草；**同日实现落地**，复选框已勾选）。本 Phase 为**架构等价重构**：原则上不新增、不修改任何物理公式与数值行为。

## 目标

把现有"控制函数（`control.ts`）+ `simulateTracking()` 大循环（`kinematics.ts`）+ `Home.tsx` 上帝组件"的结构，重构为**严接口分层**：

$$\text{前端（可视化/交互）}\leftrightarrow\text{纯数据 I/O}\leftrightarrow\text{模型层（Simulator 门面）}$$

模型层新增 `src/mathmodel/sim/` 子层（`mathmodel` 路径不动，避免 [`specs/techstack.md`](../../../techstack.md) 目录规范漂移）：`CarController` 控制器接口 + 内置 `FormulaController` 兜底、多速率周期任务调度器（物理积分步长与控制周期分离、零阶保持）、虚拟整车 `Vehicle`（收敛读数采样策略）、`Simulator` 门面（`step` 实时逐帧 + `runToEnd` 快进双模式）、一键调 PID 网格搜索迁入模型层。本 Phase 是 Phase 13（WASM 车载控制器）的地基：控制器接口与调度器即 WASM 宿主的插桩点。

## 背景与依据

- 关联宪章：[`specs/mission.md`](../../../mission.md) 范围内新增条目"实车嵌入式控制代码以 WASM 形式载入仿真验证：控制器 ABI 约定（宿主导入函数 + 多速率任务入口）+ 内置公式控制器兜底（见 `specs/features/model/13-wasm-controller/`）"——本 Phase 先落地宿主侧的 `CarController` 接口、多速率调度器与内置兜底控制器，ABI 本体属 Phase 13。
- 技术约束（[`specs/techstack.md`](../../../techstack.md)）：硬性约束 1（SI 单位内部计算）；约束 2（`src/mathmodel/` 纯计算层，禁 UI / React / DOM 依赖——`sim/` 子层同样遵守，模型层不依赖 `setTimeout`）；约束 3（appState schema 纪律——本 Phase 不动 schema，实时模式播放状态不入持久化）；约束 5（表达式解析禁用 `eval`，误差公式仍走 `compileFormula()`）。
- 前置条件：Phase 5 `05-tracking-control`（闭环信号流、终止条件式 [(8.10)](../05-tracking-control/requirements.md#eq-8-10)、一键整定目标函数式 [(8.11)](../05-tracking-control/requirements.md#eq-8-11)）；Phase 4 `04-measured-data-model`（实测数据源回退策略）；Phase 1 `01-track-geometry`（`createNearestSeeker()` 局部最近点查询）。
- 现状痛点（2026-10-01 核对源码）：`src/pages/Home.tsx` 中存在**三处重复**的读数注入闭包（约 575–591 行循迹重算、643–666 行实时读数、692–709 行一键调 PID，同为"仿真源 `k·|B·n̂|` / 实测源换算 d 求值 / 通道无数据回退仿真"策略）；`runAutoTune`（681–806 行）把网格搜索、目标函数评价、UI 让出三件事揉在页面组件里；`trackingTick` 防抖重算（558–594 行）只能整体重算，无实时逐帧能力。
- 重构性质：**等价搬移**——同一赛道/参数下重构前后轨迹必须逐点一致（验证 V-1），任何数值偏差都视为缺陷而非可接受的"改进"。

## 任务分组（Task Groups）

### Group 0: 回归基线 fixture（重构动刀之前）
- [x] 新增 `scripts/gen-tracking-baseline.ts`：用**重构前**的 `simulateTracking()` 在固定赛道/参数组合（直道收敛场景 + S 弯场景，均非闭环，与 selfcheck-tracking [4]/[6]b 同构）上生成轨迹基线 JSON（t/x/y/θ/vL/vR/err/sensorU 全数组 + status/steps/distM），输出 `scripts/fixtures/tracking-baseline.json` 并提交
- [x] 基线 JSON 头记录生成时的 git 提交哈希与参数快照，供追溯

### Group 1: 控制器接口与内置控制器（`src/mathmodel/sim/controller.ts`）
- [x] `CarController` 接口：`init()` / `step(readings: SensorReadings): WheelCommand` / `reset()`；`SensorReadings` / `WheelCommand` 纯数据类型定义
- [x] `FormulaController`：把现有 `compileFormula()` + `pdOutput()` + `wheelSpeeds()` 包装为内置控制器（误差回退上一步、首步 errRate = 0、限幅等语义逐行对齐 `simulateTracking()` 内联实现），作兜底与对照组

### Group 2: 多速率周期任务调度器（`src/mathmodel/sim/scheduler.ts`）
- [x] 任务表 `[{ periodMs, entry }]` 按注册序执行；物理积分步长 dtSim 与控制任务周期分离
- [x] 整数微秒时间轴（防浮点漂移）；任务到周期触发，控制指令在两个 tick 间零阶保持
- [x] 现有行为 = 单任务 `periodMs = dtMs` 的特例（等价性由 V-1/V-2 防护）

### Group 3: 虚拟整车（`src/mathmodel/sim/vehicle.ts`）
- [x] 读数采样器工厂 `createSensorSampler()`：收敛 Home.tsx 三处重复闭包为单一实现（仿真源/实测源回退 + `k·|B·n̂|`），入参为纯数据（path / elements / sensors / currentMa / k / sourceKind / measured）
- [x] `Vehicle`：按当前位姿采样电感读数、持有控制器、电机一阶滞后（复用 `motorLag()`）、运动学积分（复用 `stepCar()`）

### Group 4: Simulator 门面（`src/mathmodel/sim/simulator.ts`）与兼容薄壳
- [x] `Simulator`：`reset(params)` / `step(dtMs)`（实时逐帧，返回当帧快照）/ `runToEnd()`（快进一次算全程，返回 `TrackingResult`）
- [x] 终止条件沿用式 [(8.10)](../05-tracking-control/requirements.md#eq-8-10)：闭环一圈 / 非闭环 +0.5 m / 失控判停 / 步数上限 100000 / 位姿 NaN 判失控
- [x] `kinematics.ts` 的 `simulateTracking()` 改为 `Simulator.runToEnd()` 的兼容薄壳（**保持签名与 `TrackingResult` 结构不变**，`scripts/selfcheck-tracking.ts` 调用点不动——选择薄壳方案，理由见"风险与取舍"）

### Group 5: 一键调 PID 迁入模型层（`src/mathmodel/sim/autotune.ts`）
- [x] 网格搜索（粗搜 13×11 + 邻域 9×9）、式 [(8.11)](../05-tracking-control/requirements.md#eq-8-11) 轨迹形状贴合目标函数、`createNearestSeeker` 局部最近点评价、`segSpans` 段类型区间表构建，全部从 Home.tsx 迁入
- [x] 分块让出事件循环改为**生成器（Generator）接口**：模型层逐候选 `yield` 进度，UI 侧驱动分块；另提供同步排干包装供 Node 自检使用

### Group 6: Home.tsx 瘦身与实时模式 UI
- [x] 删除三处重复读数闭包（改调 `createSensorSampler()`）、删除 `runAutoTune`（改调 `sim/autotune.ts`）；保留状态编排与持久化
- [x] 实时模式：rAF 驱动 `simulator.step()`，循迹控制区加运行 / 暂停 / 重置 / 倍速（0.25×–4×）播放控制；播放状态为会话内 `useState`，不入 appState
- [x] 快进模式保留现有行为：参数变化防抖 ~200ms 重算 + 轨迹滑块回放

### Group 7: 自检与验证
- [x] 新增 `scripts/selfcheck-sim.ts`（`npm run selfcheck:sim`）：V-1 基线逐点比对、V-2 调度器合成测试、V-3 FormulaController 等价、V-5 一键调 PID 迁移等价
- [x] 既有三组自检（selfcheck / selfcheck:measured / selfcheck:tracking）+ `npm run build` 全过（V-4）

（实际实现日期：2026-10-01 全部落地。实现与规约的两处细节偏差已回填 requirements.md：① `Simulator.reset()` 参数为完整 `TrackingParams` 而非 `Partial`；② `autoTuneGrid` 的 opts 增补 `path` / `segSpans` 字段（评价器必需，原规约接口块遗漏）。V-1 实测逐点偏差 = 0（位精确一致），优于 < 1e-12 的通过标准。）

## 实现顺序与依赖

**Group 0 先行**（动刀前固化基线，否则 V-1 无对照）→ Group 1（控制器接口，被 Group 3 持有）→ Group 2（调度器，被 Group 4 驱动）→ Group 3（整车 = 采样器 + 控制器 + 电机滞后 + 运动学）→ Group 4（门面组合前三者 + 兼容薄壳，薄壳落地即跑 V-1/V-4 守住等价性）→ Group 5（整定依赖 `runToEnd()`）→ Group 6（UI 最后动，依赖门面与整定接口稳定）→ Group 7（收尾验证）。

## 风险与取舍

- **兼容薄壳 vs 改自检调用点**：选择"`simulateTracking()` 保留为薄壳、签名与 `TrackingResult` 不变"。理由：① `scripts/selfcheck-tracking.ts` 与 `matlab-simulink/` 对照移植的注释引用均指向该函数，薄壳方案对既有体系的扰动最小；② 薄壳本身即 V-1 等价性的活证据（旧入口 → 新内核，结果不变）；③ 外部调用方（一键调 PID、Home.tsx）迁移完成后薄壳仍留作稳定公共入口，不计划废弃。
- **等价搬移纪律**：重构不"顺手优化"任何数值路径（含浮点运算顺序）——`simulateTracking()` 内联的读数→误差→PD→轮速→滞后→记录→积分顺序在 `Simulator` 单任务特例下逐行复刻；V-1 容差定为 < 1e-12（预期实测为 0）。
- **模型层不依赖 `setTimeout`**：一键调 PID 的分块让出从"模型内 `await setTimeout(0)`"改为**生成器逐候选 `yield` 进度、UI 侧驱动分块**（同步排干包装供 Node 自检）。模型层因此保持同步纯函数本质，硬性约束 2 不被 async/定时器渗漏破坏；代价是 UI 侧多一个驱动循环，复杂度可控。
- **时间轴浮点漂移**：调度器内部一律整数微秒累加（`Math.round(ms × 1000)`），任务到期判定与推进全在整数域；仅在与外部交互（读数时间戳、记录数组 t）时换算回 float 秒/ms。长程仿真（1000 s 级）累积误差为 0，优于 float ms 累加。
- **过期周期合并**：物理 tick 晚于任务到期时，该 tick 内任务至多触发一次，到期点推进至 > 当前时刻（过期周期视为合并，不补触发）——与"控制指令零阶保持"语义一致，且避免卡顿后连发。
- **失控判停的 Err 来源**：式 [(8.10)](../05-tracking-control/requirements.md#eq-8-10) 的失控判停依赖 Err；通用控制器（未来的 WASM 控制器）不一定产出 Err。约定 `WheelCommand.err` 为可选诊断字段：控制器上报则参与失控判停与记录，不上报则失控判停退化为仅靠 NaN/步数上限。`FormulaController` 每步上报，等价性不受影响。
- **appState 不动 schema**：实时模式播放状态（播放中/倍速/当前仿真时刻）为瞬态会话状态，不入持久化；`APP_STATE_VERSION` 保持 6。
- **Worker 化明确排除**：用户已确认同进程方案（主线程同步积分毫秒级足够，见 Phase 5 既有取舍）；本 Phase 不引入 Worker 边界。
- **MATLAB 对照移植不受影响**：本 Phase 不改任何公式与数值行为，`matlab-simulink/` 无需同步改动；若 V-1 出现偏差，先怀疑重构引入的行为变化，而非 MATLAB 侧。
