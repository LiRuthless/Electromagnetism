# 路线图（Roadmap）

> 活文档。每完成一个阶段勾选对应复选框；阶段合并、拆分、重排都在这里记录。
> Phase 01–09 为已实现功能的回溯文档化（棕地逆向，2026-09-30 补齐规约）；Phase 10 起按"先规约后实现"正常流转。
> 功能规约按两层分域存放（2026-10-01 起）：**模型层** `specs/features/model/`（可脱离浏览器运行 / 与实车共享）与**前端层** `specs/features/ui/`（可视化 / UI / 桌面壳基建）；`NN` 序号仍与本文件阶段编号一一对应，跨域不改号。

## 阶段总览

### Phase 1: 赛道几何模型与铺设编辑 `01-track-geometry`
- [x] 段序列（直线/圆弧）参数化、离散化、闭环吸合、形状工具（直角弯/正六边形环岛）、转角刻度、鼠标铺设交互与赛道库
- 规模：medium
- 功能规约：`specs/features/model/01-track-geometry/`

### Phase 2: 磁场计算与网格调度 `02-magnetic-field`
- [x] 毕奥-萨伐尔分段积分 + 直线段闭式解、奇异截断、解析对照、观测面网格批算、Web Worker 分块调度（防抖/协作式取消/看门狗/主线程兜底）
- 规模：medium
- 功能规约：`specs/features/model/02-magnetic-field/`

### Phase 3: 电感响应模型 `03-sensor-model`
- [x] 响应公式 U=k|B·n̂|、贴线锚点标定 k、默认 4 电感布局、车体位姿与坐标变换（ψ 符号约定）、全程扫描 U(s)
- 规模：medium
- 功能规约：`specs/features/model/03-sensor-model/`

### Phase 4: 实测数据经验模型 `04-measured-data-model`
- [x] 实测 CSV 导入（接口①）、有符号横向距离 d、方案A 解析形状最小二乘拟合、方案B 物理公式基准 + 偏差校正、通道回退
- 规模：medium
- 功能规约：`specs/features/model/04-measured-data-model/`

### Phase 5: 循迹闭环控制 `05-tracking-control`
- [x] 可编辑误差公式（递归下降解析）、PD、差速轮速分配与限幅、电机一阶滞后 τ_m、两轮差速运动学、终止条件、一键调 PID（轨迹形状目标函数）、循迹结果显示与轨迹 CSV 导出（接口②）
- 规模：medium
- 功能规约：`specs/features/model/05-tracking-control/`

### Phase 6: 界面图表与面板体系 `06-ui-charts-panels`
- [x] 中央画布（热力图/等值线/车体叠加/视图缩放平移）、折线图统一缩放、浮动化、点击联动车位、顶栏导出菜单、面板 UI 组件化（分区卡片/拖拽调宽/数值键入/Select 溢出修复）
- 规模：medium
- 功能规约：`specs/features/ui/06-ui-charts-panels/`

### Phase 7: 持久化与数据接口 `07-persistence-export`
- [x] appState v6 持久化（逐字段回退）、panel-layout 独立 key、赛道库、CSV/PNG/JSON 导出、实测数据接口①–④约定
- 规模：small
- 功能规约：`specs/features/ui/07-persistence-export/`

### Phase 8: 打包发布与自检体系 `08-packaging-release`
- [x] 两阶段发布流程（预览版→确认后打 exe）、BUILD-EXE 本机离线打包、三组自检命令与 scripts/test-*、screenshot.cjs 离屏截图目检
- 规模：small
- 功能规约：`specs/features/ui/08-packaging-release/`

### Phase 9: MATLAB/Simulink 对照移植 `09-matlab-simulink-port`
- [x] 数学模型链条（§4–§8）向 MATLAB/Simulink 逐行对齐移植：em_field_check / em_track_sim 双模型 + runAll 自检
- 规模：medium
- 功能规约：`specs/features/model/09-matlab-simulink-port/`

### Phase 10: 实车循迹日志对比视图 `10-vehicle-log-compare`
- [ ] 导入实车循迹日志 CSV（接口④），与仿真轨迹 Err(t)/轮速(t)/电感 U(t) 曲线叠加对照
- 规模：small
- 前置依赖：实验 9 产出的实车日志数据（见 [`specs/research/2026-08-13-experiment-modeling.md`](research/2026-08-13-experiment-modeling.md)）
- 功能规约：`specs/features/ui/10-vehicle-log-compare/`（骨架已建，待数据到位后访谈补全）

### Phase 11: SerialSource 串口直采 `11-serial-source`
- [ ] 接 Web Serial 实车 ADC 直采（接法已写在 `src/sensors/sources.ts` 头注释）
- 规模：medium
- 功能规约：待启动时创建（建于 `specs/features/model/` 下——实车数据入口，归模型层）

### Phase 12: 仿真器架构分层 `12-simulator-architecture`
- [x] 前端/模型层严接口分层：Simulator 门面（runToEnd 快进 + step 实时双模式）、多速率周期任务调度（物理积分 dt 与控制周期分离、零阶保持）、CarController 接口 + 内置 FormulaController、Vehicle 读数策略收敛、一键调 PID 迁入模型层、Home.tsx 瘦身（2026-10-01 落地，V-1 回归基线逐点位精确一致）
- 规模：large
- 功能规约：`specs/features/model/12-simulator-architecture/`

### Phase 13: WASM 车载控制器 `13-wasm-controller`
- [ ] 真实 C 控制代码编译为 WASM 载入仿真：宿主导入函数 ABI（传感器/执行器/时间/数学库）、多速率任务入口、上传与热替换 UI、异常回退内置控制器、controller-template 模板工程与自检 fixture
- 规模：large
- 前置依赖：Phase 12 的 CarController 接口与调度器
- 功能规约：`specs/features/model/13-wasm-controller/`
- 进度（2026-10-01）：代码与模板工程已实现（selfcheck:wasm 的 V-2/V-3 全过、既有自检与 build 回归全过）；**fixture `scripts/fixtures/pd_controller.wasm` 待本机 clang 跑 controller-template/build.bat 生成入库后补验 V-1**，故本阶段保持未勾

## 功能域视图

> 阶段总览按时间序（NN 编号）排列；本节按维护归属分组，同一批规约的两个视图。

### 模型层 `specs/features/model/`
可脱离浏览器运行 / 与实车共享：数学模型链条、仿真器、车载控制器、MATLAB 移植。

- `01-track-geometry` — 赛道几何模型与铺设编辑
- `02-magnetic-field` — 磁场计算与网格调度
- `03-sensor-model` — 电感响应模型
- `04-measured-data-model` — 实测数据经验模型
- `05-tracking-control` — 循迹闭环控制
- `09-matlab-simulink-port` — MATLAB/Simulink 对照移植
- `12-simulator-architecture` — 仿真器架构分层
- `13-wasm-controller` — WASM 车载控制器
- （预留）`11-serial-source` — 串口实车直采，启动时建于此域

### 前端层 `specs/features/ui/`
可视化与人机交互、桌面壳与持久化等基建。

- `06-ui-charts-panels` — 界面图表与面板体系
- `07-persistence-export` — 持久化与数据接口
- `08-packaging-release` — 打包发布与自检体系
- `10-vehicle-log-compare` — 实车循迹日志对比视图

## 当前状态

- 已完成：Phase 01–09（电磁场建模仿真工具 0.1.0，2026-08-15 版 exe 已发布；Simulink 移植 2026-09 落地）；Phase 12（2026-10-01 仿真器架构分层落地，等价重构零偏差）；Phase 13 代码部分（2026-10-01 WASM 车载控制器落地，selfcheck:wasm V-2/V-3 全过）
- 进行中：无代码阶段——等待用户执行实验建模（[`specs/research/2026-08-13-experiment-modeling.md`](research/2026-08-13-experiment-modeling.md)，🧪 三类九项实验，按实验 1→2→3→6/7→4/5→8/9 依赖顺序）
- 下一步：Phase 13 收尾（本机 clang 生成 `scripts/fixtures/pd_controller.wasm` 补验 V-1 后勾选）；Phase 10（待实验 9 数据到位）；Phase 11 仍为预留方向

## 已合并/已取消的计划

- 2026-07-31：实测方案B 由查表插值（LUT）改为物理公式基准 + 偏差校正——LUT 方案取消（外推区/稀疏采样区不如物理基准稳健）。
- 2026-08-03：默认电感布局改为预设 4 电感，默认误差公式去 F1/F2；一键调 PID 目标函数由"最快完赛"改为"轨迹形状贴合"（直线贴中线、弯道内收圆润、外偏双倍罚、罚航向抖动）。
- 2026-08-12：单一《程序设计说明.md》拆分为《数学模型.md》+《程序设计说明.md》双文档；代码层 `src/physics/` + `src/sensors/measured.ts` 合并迁建 `src/mathmodel/`。
- 2026-08-13：实验部分定位由"事后验证"调整为"实验建模"（实验是建模的有机环节，三类九项重排编号）。
- 2026-09-30：**双文档基准制度升级为 SDD 文档体系**——两份设计基准文档内容迁入 `specs/`（本路线图 + 宪章 + 功能规约），原文归档 `archive/docs/legacy/`；此后任何功能变更先改对应 feature 规约三件套，再实现。
- 2026-10-01：**文档体系与代码按模型层/前端层两分维护**——功能规约迁入 `features/model/`（01–05、09、12、13）与 `features/ui/`（06、07、08、10），NN 编号不变；判定规则"能否脱离浏览器运行 / 是否与实车共享"。代码侧同步迁移（`src/mathmodel/`→`src/model/`、新建 `src/ui/`），见 CHANGELOG。
