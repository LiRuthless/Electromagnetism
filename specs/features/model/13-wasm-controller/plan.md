# Phase 13: WASM 车载控制器 — 实现计划

> 本规约为全新设计（绿地正向，2026-10-01 依据用户访谈立项；2026-10-01 实现落地，fixture wasm 待本机 clang 生成）。与 Phase 12 [`../12-simulator-architecture/`](../12-simulator-architecture/) 同步立项，引用其 `CarController` 接口与多速率调度器（已落地，commit a9235de）。

## 目标

把用户的真实车载 C 控制代码（两份不同 MCU 的代码、算法会持续更换）编译为 WASM 后载入仿真器，作为"虚拟整车的车载程序"参与循迹闭环：宿主提供 syscall 式 env 导入函数（传感器读数 / 执行器输出 / 仿真时间 / 数学库兜底），wasm 导出多速率周期任务入口（`ctrl_task_1ms` / `ctrl_task_2ms`），由 Phase 12 的调度器按任务周期表触发。一次只加载一份 wasm，改算法后重新上传即热替换；任何加载/运行异常都明确报错并回退内置 FormulaController，**绝不崩溃**。配套提供 `controller-template/` 模板工程（头文件 + PD 示例 + 构建脚本）与 fixture 自检。

## 背景与依据

- 关联宪章：[`specs/mission.md`](../../../mission.md) 范围内条目"实车嵌入式控制代码以 WASM 形式载入仿真验证：控制器 ABI 约定（宿主导入函数 + 多速率任务入口）+ 内置公式控制器兜底"；范围外条目"实车嵌入式工程本身（交叉编译链、烧录、车队仓库维护）"——本项目只提供 ABI 约定与 WASM 仿真宿主。
- 技术约束（[`specs/techstack.md`](../../../techstack.md)）：硬性约束 1（SI 单位内部计算——env 导入全部 SI，唯 `set_motor_pwm` 归一化 −1..1 为例外）；约束 2（`src/model/` 纯计算层——`WebAssembly` API 在浏览器与 Node/tsx 均为全局可用，不引入 DOM 依赖，宿主实现可留在模型层并被脚本直跑）；约束 3（appState schema 纪律——只记来源文件名，逐字段回退，不升版本，见 requirements.md TC-3）；约束 6（**控制器 ABI 稳定**——本 feature 即该约束的落地载体：`CTRL_ABI_VERSION = 1` 发布后，变更必须升版本并同步模板工程与 fixture）。
- 前置条件：Phase 12 [`../12-simulator-architecture/`](../12-simulator-architecture/)（`CarController{init/step/reset}` 接口、内置 FormulaController、按任务周期表触发控制器任务的多速率调度器、物理积分 dt 与控制周期分离）；Phase 5 [`../05-tracking-control/`](../05-tracking-control/)（式 [(8.3)](../05-tracking-control/requirements.md#eq-8-3)–[(8.7)](../05-tracking-control/requirements.md#eq-8-7) 的"轮速指令 → 限幅 → 电机一阶滞后"链路后半段、`MAX_TRACKING_STEPS = 100000` 步数硬上限、TrackingPanel 循迹控制区）；Phase 3 [`../03-sensor-model/`](../03-sensor-model/)（4 电感布局与读数注入）。
- 运行环境：`electron/main.cjs` 已确认 `contextIsolation: true`、`nodeIntegration: false`——渲染进程无 Node API，wasm 加载只能走浏览器全局 `WebAssembly` API（`WebAssembly.instantiate(bytes, {env})`），不引第三方 wasm 运行时。
- ABI 风格决策（用户访谈确认）：**宿主导入函数（syscall 式），不传内存结构体**——对多 MCU / 算法频繁更换的场景最稳，避免线性内存结构体布局与宿主耦合；代价是每次读数一次跨边界调用，仿真规模（数千步 × 每步数次调用）下开销可忽略。

## 任务分组（Task Groups）

### Group 1: 控制器 ABI 定义（`src/model/sim/controllerAbi.ts`）
- [x] 常量 `CTRL_ABI_VERSION = 1`；wasm 可导出同名全局/函数声明版本，不匹配时拒绝加载并提示
- [x] wasm 导出入口表：`ctrl_init()` / `ctrl_task_1ms()` / `ctrl_task_2ms()`（存在性探测，缺哪个跳过哪个并报提示；两个任务入口全缺视为无效控制器）
- [x] env 导入函数表（全部 float32 参数与返回值、SI 单位）：`read_adc(ch)` / `read_gyro_z()` / `read_accel_x()` / `read_accel_y()` / `read_encoder_speed()` / `get_time_ms()` / `set_motor_pwm(left, right)`
- [x] math 兜底导入表：`sinf/cosf/tanf/asinf/acosf/atanf/atan2f/sqrtf/fabsf/powf/expf/logf/floorf/ceilf/fmodf`
- [x] PWM→轮速映射式 [(13.1)](requirements.md#eq-13-1)（归一化 → vMax 线性映射 → 循迹限幅 [0, vMax] → 电机一阶滞后）

### Group 2: WasmController 宿主（`src/model/sim/wasmController.ts`）
- [x] `WasmController` 实现 Phase 12 `CarController` 接口：`WebAssembly.instantiate(bytes, {env})`、任务入口存在性探测、env 函数闭包绑定当前 Vehicle 采样器（`ControllerHost`，Simulator 构造时 attach）
- [x] 健壮性：无效 wasm 字节 / 缺全部任务入口 / ABI 版本不符 / 运行时 trap → 明确报错并回退内置 FormulaController，绝不崩溃
- [x] 死循环防护：沿用 100000 步硬上限（同进程无法强杀 wasm，限制写入规约 FR-8）

### Group 3: 模板工程（`em-field-studio/controller-template/`）
- [x] `controller_api.h`：env 导入声明（`__attribute__((import_module("env")))`）+ 入口约定注释 + 单位约定
- [x] `controller.c`：PD 循迹示例（读 4 路 ADC → 差比和误差 → PD → `set_motor_pwm`；P_GAIN=−1 对齐默认布局负反馈标定）
- [x] `build.bat`：clang freestanding 编译命令样例（`--target=wasm32 -nostdlib -Wl,--no-entry -Wl,--export=ctrl_init` 等）+ Emscripten standalone 裁剪说明注释

### Group 4: 前端上传与热替换（`TrackingPanel.tsx`）
- [x] 循迹控制区新增控制器来源区：.wasm 文件选择器、当前来源显示（内置公式 / wasm 文件名 + ABI 版本）
- [x] 重新上传即 reset 热替换；加载失败提示并回退内置；重启后回退内置并显示"请重新上传"

### Group 5: 持久化与自检 fixture
- [x] appState：新增字段只记来源文件名（提示用），逐字段回退默认值，**未升 APP_STATE_VERSION**（见 requirements.md TC-3 理由）
- [x] `scripts/model/selfcheck-wasm.ts`（tsx 直跑，npm script `selfcheck:wasm`）：fixture 一致性 / ABI 健壮性 / 多速率入口探测（V-2/V-3 用编程构造的最小 wasm 字节，不依赖 clang）
- [ ] fixture 流程：用户本机跑 `controller-template/build.bat` 生成 `scripts/model/fixtures/pd_controller.wasm` 后提交入库——**待用户执行（本机无 clang），V-1 在此之前明确报错**

（实际实现日期：2026-10-01，Group 1–5 除 fixture 生成外全部落地）

## 实现顺序与依赖

Phase 12（CarController 接口 + 调度器 + Vehicle 采样器收敛）先行 → Group 1（ABI 定义被其余各组引用）→ Group 2（宿主依赖 ABI 与 CarController）→ Group 3（模板工程依赖 ABI 表，可与 Group 2 并行）→ Group 4（UI 依赖宿主）→ Group 5（自检依赖 Group 2/3，fixture 由模板工程产出）。

## 风险与取舍

- **syscall 式 ABI vs 内存结构体**：选定前者——多 MCU / 算法频繁更换时结构体布局耦合是最脆弱的接口形式；逐函数调用开销在本仿真规模下可忽略。该选择写入硬性约束 6 的保护范围，一经发布不得在无版本升级的情况下变更。
- **同进程执行 wasm（无 Worker 隔离）**：用户已明确接受同进程方案——wasm 死循环会卡死主线程，无法强杀；防护仅为调度层 100000 步硬上限与 trap 捕获，限制在 requirements.md FR-8 显式声明。
- **float32 语义差异**：wasm 侧 float32 与宿主 JS float64 的累积精度差使 fixture 轨迹对照必须给容差阈值（validation.md V-1），不能逐位比对。
- **不持久化 wasm 字节**：字节量大且源码在车队仓库演进，localStorage 只记文件名作提示；重启回退内置控制器是刻意行为而非降级。
- **明确不支持 WASI / malloc / printf / 文件 IO / 线程 / 异常**：freestanding `-nostdlib` 编译模型，未解析符号仅由 math 兜底导入覆盖；需要堆内存的算法由 wasm 侧静态数组解决。
- **传感器读数无噪声**：`read_gyro_z` / `read_accel_*` / `read_encoder_speed` 本期全部由运动学真值合成，不加噪声模型（非目标）；实车对照结论待 🧪 实验回填。
