# Phase 13: WASM 车载控制器 — 需求

> 本规约为全新设计（2026-10-01 立项并落地实现）：FR-1 ~ FR-11 已实现（✅）；FR-12 真实 wasm 上车实测为 🧪 待实操。PWM→轮速映射为本规约自定方案（式 [(13.1)](#eq-13-1)），已显式声明。

## 功能需求

### FR-1　WASM 控制器定位与闭环角色（✅）

用户的真实车载 C 控制代码（两份不同 MCU 的代码、算法会持续更换）编译为 WASM 后载入仿真器，作为"虚拟整车的车载程序"参与循迹闭环，替代内置公式控制器的"误差公式 + PD + 差速分配"环节。闭环信号流变为：

$$\text{位姿}(x,y,\theta)\to\text{电感读数/IMU/编码器}\to\text{wasm 周期任务}\to set\_motor\_pwm\to v_L^{cmd},v_R^{cmd}\ (\text{式13.1})\to v_L,v_R\ (\text{电机滞后，式8.6/8.7})\to\text{积分新位姿}\to\cdots$$

即 wasm 控制器接管到"轮速指令"为止，**指令 → 限幅 → 电机一阶滞后 → 运动学积分**的后半段仍走 Phase 5 既有链路（式 [(8.5)](../05-tracking-control/requirements.md#eq-8-5)–[(8.9)](../05-tracking-control/requirements.md#eq-8-9)），终止条件（式 [(8.10)](../05-tracking-control/requirements.md#eq-8-10)）不变。一次只加载一份 wasm；改算法后重新上传即热替换（FR-10）。控制器来源 = 内置 FormulaController（默认兜底）/ wasm 二选一，由 Phase 12 的调度器按任务周期表统一触发（见 [`../12-simulator-architecture/`](../12-simulator-architecture/)）。

### FR-2　wasm 导出任务入口（宿主调用，存在性探测）（✅）

| 导出名 | 签名 | 语义 |
|---|---|---|
| `ctrl_init` | `() -> void` | 加载 / 复位时调用一次 |
| `ctrl_task_1ms` | `() -> void` | 1 ms 周期任务入口（对应用户现状：传感器采集任务） |
| `ctrl_task_2ms` | `() -> void` | 2 ms 周期任务入口（控制任务） |

宿主逐个做存在性探测：**缺哪个跳过哪个并报提示**；`ctrl_task_1ms` 与 `ctrl_task_2ms` 全缺视为无效控制器，拒绝加载并回退内置（FR-7）。任务周期表在 ABI 层面可扩展，**ABI v1 内固定这两个入口**——新增周期入口须升 ABI 版本（TC-4）。

### FR-3　env 宿主导入函数表（wasm 调宿主）（✅）

全部 float32 参数与返回值，SI 单位（`set_motor_pwm` 为唯一例外，见 FR-6）：

| 导入名（module = `env`） | 签名 | 单位 / 语义 |
|---|---|---|
| `read_adc` | `(ch: i32) -> f32` | 第 ch 路电感电压（V，Vpp）；ch 0–3 按电感布局数组顺序映射（默认布局 L1=0 / R1=1 / L2=2 / R2=3）；越界通道返回 0；数据源切换（仿真/实测）同样生效——数值由宿主 Vehicle 采样器给出 |
| `read_gyro_z` | `() -> f32` | IMU z 轴角速度（rad/s），由运动学真值 ω = (v_R − v_L)/W（实际轮速，式 [(8.8)](../05-tracking-control/requirements.md#eq-8-8)）合成，本期不加噪声 |
| `read_accel_x` | `() -> f32` | 车体坐标系纵向加速度（m/s²），由相邻控制步质心速度差分 Δv/dt 合成 |
| `read_accel_y` | `() -> f32` | 车体坐标系横向（向心）加速度（m/s²），由 v·ω 合成 |
| `read_encoder_speed` | `() -> f32` | 编码器车速（m/s），由实际轮速合成 v = (v_L + v_R)/2 |
| `get_time_ms` | `() -> f32` | 仿真时间（ms） |
| `set_motor_pwm` | `(left: f32, right: f32) -> void` | 左右电机归一化指令 −1..1，映射见式 [(13.1)](#eq-13-1) |

明确**不支持**：malloc / printf / 文件 IO / 线程 / 异常。wasm 侧需要堆内存时以静态数组解决（freestanding 编译模型，见 FR-9）。

### FR-4　math 兜底导入（✅）

freestanding 编译（`-nostdlib`）时 libm 未解析符号由宿主提供，module 同为 `env`：

`sinf / cosf / tanf / asinf / acosf / atanf / atan2f / sqrtf / fabsf / powf / expf / logf / floorf / ceilf / fmodf`

全部 float32 签名（`atan2f(y,x)` / `powf(x,y)` / `fmodf(x,y)` 为双参数，其余单参数），宿主直接映射 `Math.*` 对应函数后转 float32。

### FR-5　ABI 版本管理（✅）

常量 `CTRL_ABI_VERSION = 1`（代码 `controllerAbi.ts`）。wasm 可导出同名符号（全局或函数）声明其编译所针对的 ABI 版本：版本不符时宿主拒绝加载并明确提示；未导出该符号的 wasm 按版本 1 宽容受理（模板工程生成的 wasm 均导出）。ABI 一旦发布，任何导入表 / 入口表 / 语义变更必须升版本，并同步 `controller-template/` 与自检 fixture（[`specs/techstack.md`](../../../techstack.md) 硬性约束 6）；旧 ABI 的 wasm 仍可加载或明确报版本错误，**绝不静默误跑**。

### FR-6　PWM→轮速映射（✅，本规约自定方案，显式声明）

`set_motor_pwm(left, right)` 的归一化指令（−1..1，**ABI 中唯一非 SI 例外**——对齐实车电机驱动的占空比直觉）按下式映射为指令轮速：

<a id="eq-13-1"></a>
$$v_i^{cmd}=\text{clamp}\big(\text{clamp}(pwm_i,\,-1,\,1)\cdot v_{max},\;0,\;v_{max}\big),\qquad i\in\{L,R\} \tag{13.1}$$

其中内层 clamp 把越界指令收回 [−1, 1]；pwm ∈ [0, 1] 线性映射到 [0, v_max]；**负值语义为倒车，但循迹场景沿用式 [(8.5)](../05-tracking-control/requirements.md#eq-8-5) 限幅到 [0, v_max]**——净效果为负 PWM 钳到 0（停车），倒车语义保留在映射式中以待后续支持。v_max 取循迹参数 `vMax`。映射后的 v_cmd 走电机一阶滞后精确更新（式 [(8.6)](../05-tracking-control/requirements.md#eq-8-6)[(8.7)](../05-tracking-control/requirements.md#eq-8-7)，`motorLag()`）得到实际轮速，再驱动运动学积分。

物理意义：与内置控制器的"指令轮速 → 限幅 → 滞后"链路（式 [(8.3)](../05-tracking-control/requirements.md#eq-8-3)–[(8.7)](../05-tracking-control/requirements.md#eq-8-7) 后半段）完全同构，保证 wasm 与内置控制器在同一整车模型上对照公平。

### FR-7　健壮性与回退（✅）

以下任一情形 → 明确报错提示并回退内置 FormulaController，**绝不崩溃**（呼应 [`specs/techstack.md`](../../../techstack.md) 硬性约束 3 的纪律精神）：

- 无效 wasm 字节（`WebAssembly.compile` / `instantiate` 抛错）；
- 缺全部任务入口（FR-2）；
- ABI 版本不符（FR-5）；
- 运行时 trap（除零、越界内存访问等，任务调用以 try/catch 包裹，trap 后该实例作废并回退）；
- env 导入缺失（wasm 声明了宿主未提供的导入）。

回退后循迹仿真立即可用内置控制器继续跑，来源区显示回退原因。

### FR-8　死循环防护（✅）

wasm 与宿主同进程执行（用户已明确接受，非目标见 Worker 隔离），wasm 内部死循环**无法强杀**；防护仅为调度层沿用 `MAX_TRACKING_STEPS = 100000` 步数硬上限（式 [(8.10)](../05-tracking-control/requirements.md#eq-8-10) 链路既有判停）。本限制为已知取舍，写入规约显式声明。

### FR-9　模板工程 `em-field-studio/controller-template/`（✅）

- `controller_api.h`：env 导入声明（`__attribute__((import_module("env")))`）+ 入口约定（FR-2 签名与存在性探测语义）+ 单位约定注释（SI / pwm 归一化例外 / 通道顺序）；
- `controller.c`：PD 循迹示例——`ctrl_task_1ms` 读 4 路 `read_adc` 缓存，`ctrl_task_2ms` 算差比和误差 → PD → `set_motor_pwm`，与内置默认公式式 [(8.1)](../05-tracking-control/requirements.md#eq-8-1) 同构以作 fixture 对照基准（A=B=C=1；P_GAIN=−1 为默认 4 电感布局直道负反馈标定符号，对齐 selfcheck-tracking [4] 的 P=−1 结论）；
- `build.bat`：clang freestanding 编译命令样例（`--target=wasm32 -nostdlib -Wl,--no-entry -Wl,--export=ctrl_init -Wl,--export=ctrl_task_1ms -Wl,--export=ctrl_task_2ms` 等）+ 注释说明 Emscripten 亦可但需 standalone 裁剪（去除 WASI 依赖）。

模板工程是 ABI 的用户侧唯一权威文档；ABI 变更时同步更新（TC-4）。

### FR-10　前端控制器来源区（TrackingPanel，⬜）

- 位置：循迹控制区（右侧面板，Phase 5 FR-10 的 TrackingPanel）内新增"控制器来源"子区。
- 内容：.wasm 文件选择器（上传按钮）；当前来源显示（`内置公式` / wasm 文件名 + ABI 版本）；加载失败提示与回退原因。
- 重新上传即对当前控制器 reset 热替换（调用 `CarController.reset` + 重新 instantiate），轨迹按既有防抖 ~200ms 约定同步重算。
- 重启后 wasm 字节不在（FR-11），来源区回退显示内置控制器并给"请重新上传"提示（若存档记录过文件名，则提示中带文件名）。

### FR-11　appState 持久化（✅）

appState 只记录来源文件名（重启提示用），**不持久化 wasm 字节**。实现选择（自定，显式声明）：新增顶层字段 `wasmController: { fileName: string | null }`，缺失 / 非法时逐字段回退 `null`，**APP_STATE_VERSION 保持 6 不升**——理由同 motorTauMs 先例（[`specs/techstack.md`](../../../techstack.md) 硬性约束 3）：新增字段对旧存档为未知键（旧版加载器忽略）、对旧存档缺该键时新版回退默认值，双向无损，无需升版本。`tracking` 内既有字段不受影响。

### FR-12　真实 wasm 上车对照（🧪 待实操）

用户真实车载代码编译的 wasm 上传跑全程、热替换生效、与实车行为对照——属实验环节，结论回填实验建模手册（[`specs/research/2026-08-13-experiment-modeling.md`](../../../research/2026-08-13-experiment-modeling.md)）；本规约落地时仅以模板工程 PD 示例 fixture 做自动化验证（validation.md V-1）。

## 技术约束

- **TC-1**：env 导入全部 SI 单位（V、rad/s、m/s²、m/s、ms），唯 `set_motor_pwm` 归一化 −1..1 例外（[`specs/techstack.md`](../../../techstack.md) 硬性约束 1；例外已在 FR-6 显式声明并限定范围）。
- **TC-2**：宿主实现（`src/mathmodel/sim/controllerAbi.ts`、`wasmController.ts`）为纯计算层，禁止 UI / React / DOM 依赖；`WebAssembly` API 在浏览器与 Node/tsx 均全局可用，脚本可直跑（[`specs/techstack.md`](../../../techstack.md) 硬性约束 2）。
- **TC-3**：appState 纪律——只记文件名、逐字段回退、不升 `APP_STATE_VERSION`（FR-11；硬性约束 3）。
- **TC-4**：控制器 ABI 稳定——`CTRL_ABI_VERSION = 1` 发布后变更必须升版本，并同步 `controller-template/` 与自检 fixture；旧 ABI 的 wasm 仍可加载或明确报版本错误，绝不静默误跑（硬性约束 6，本 feature 为其落地载体）。
- **TC-5**：Electron 安全——`contextIsolation` 开、`nodeIntegration` 关（`electron/main.cjs` 现状），wasm 加载只能在渲染进程用浏览器全局 `WebAssembly` API，不引入 Node 能力、不引第三方 wasm 运行时（硬性约束 7）。
- **TC-6**：性能——wasm 调用在主线程随调度同步执行（syscall 式调用开销在本仿真规模下可忽略）；任务调用必须 try/catch 包裹以捕获 trap（FR-7）。

## 接口约定

### 代码落点

| 文件 | 内容 |
|---|---|
| `src/mathmodel/sim/controllerAbi.ts` | `CTRL_ABI_VERSION = 1`、env 导入函数表类型与默认值、任务入口名表、式 [(13.1)](#eq-13-1) 映射 `pwmToWheelCmd()` |
| `src/mathmodel/sim/wasmController.ts` | `WasmController`（实现 Phase 12 `CarController{init/step/reset}`）：instantiate、入口探测、env 闭包绑定 Vehicle 采样器、trap 捕获与回退 |
| `src/mathmodel/sim/`（Phase 12 既有） | `CarController` 接口、内置 `FormulaController`、多速率调度器——见 [`../12-simulator-architecture/`](../12-simulator-architecture/) |
| `src/components/TrackingPanel.tsx` | 控制器来源区（上传 / 来源显示 / 回退提示） |
| `src/utils/appState.ts` | `wasmController.fileName` 字段持久化与逐字段回退（v6 内，不升版本） |
| `em-field-studio/controller-template/` | `controller_api.h` / `controller.c` / `build.bat` |
| `em-field-studio/scripts/selfcheck-wasm.ts` | ABI 自检（tsx 直跑，npm script `selfcheck:wasm`） |
| `em-field-studio/scripts/fixtures/pd_controller.wasm` | fixture：模板 PD 示例编译产物（用户本机跑 `build.bat` 生成后提交入库） |

### wasm 导出 / 导入速查

- 导出（宿主调用）：`ctrl_init()`、`ctrl_task_1ms()`、`ctrl_task_2ms()`——签名与探测语义见 FR-2；可选导出 `CTRL_ABI_VERSION` 声明版本（FR-5）。
- 导入（wasm 调宿主，module = `env`）：传感器/执行器/时间表见 FR-3；math 兜底表见 FR-4。
- 通道顺序：`read_adc(ch)` 的 ch 0–3 = 电感布局数组顺序（默认布局 L1 / R1 / L2 / R2）；电感数 ≠ 4 时越界通道返回 0（自定约定，显式声明）。

### UI 交互约定

- 上传 .wasm → 立即 instantiate + 探测 + （成功）reset 热替换 → 轨迹防抖 ~200ms 重算；失败 → 提示原因并回退内置。
- 来源显示：内置公式 / wasm 文件名 + ABI 版本；重启后来源为内置且（若存档有文件名）提示"请重新上传 {fileName}"。

## 非目标（Non-goals）

- WASI 支持（freestanding `-nostdlib` 编译模型，math 之外的系统调用一律不提供）。
- 多份 wasm 同时加载对比（一次一份，热替换）。
- 传感器噪声模型（`read_gyro_z` / `read_accel_*` / `read_encoder_speed` 本期全部由运动学真值合成）。
- wasm 字节持久化（appState 只记文件名，FR-11）。
- Worker 隔离执行（用户已明确同进程方案，限制见 FR-8）。
- 实车嵌入式工程本身（交叉编译链维护、烧录——[`specs/mission.md`](../../../mission.md) 范围外）。
