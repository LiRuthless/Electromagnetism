# 路线图（Roadmap）

> 活文档。每完成一个阶段勾选对应复选框；阶段合并、拆分、重排都在这里记录。
> Phase 01–09 为已实现功能的回溯文档化（棕地逆向，2026-09-30 补齐规约）；Phase 10 起按"先规约后实现"正常流转。

## 阶段总览

### Phase 1: 赛道几何模型与铺设编辑 `01-track-geometry`
- [x] 段序列（直线/圆弧）参数化、离散化、闭环吸合、形状工具（直角弯/正六边形环岛）、转角刻度、鼠标铺设交互与赛道库
- 规模：medium
- 功能规约：`specs/features/01-track-geometry/`

### Phase 2: 磁场计算与网格调度 `02-magnetic-field`
- [x] 毕奥-萨伐尔分段积分 + 直线段闭式解、奇异截断、解析对照、观测面网格批算、Web Worker 分块调度（防抖/协作式取消/看门狗/主线程兜底）
- 规模：medium
- 功能规约：`specs/features/02-magnetic-field/`

### Phase 3: 电感响应模型 `03-sensor-model`
- [x] 响应公式 U=k|B·n̂|、贴线锚点标定 k、默认 4 电感布局、车体位姿与坐标变换（ψ 符号约定）、全程扫描 U(s)
- 规模：medium
- 功能规约：`specs/features/03-sensor-model/`

### Phase 4: 实测数据经验模型 `04-measured-data-model`
- [x] 实测 CSV 导入（接口①）、有符号横向距离 d、方案A 解析形状最小二乘拟合、方案B 物理公式基准 + 偏差校正、通道回退
- 规模：medium
- 功能规约：`specs/features/04-measured-data-model/`

### Phase 5: 循迹闭环控制 `05-tracking-control`
- [x] 可编辑误差公式（递归下降解析）、PD、差速轮速分配与限幅、电机一阶滞后 τ_m、两轮差速运动学、终止条件、一键调 PID（轨迹形状目标函数）、循迹结果显示与轨迹 CSV 导出（接口②）
- 规模：medium
- 功能规约：`specs/features/05-tracking-control/`

### Phase 6: 界面图表与面板体系 `06-ui-charts-panels`
- [x] 中央画布（热力图/等值线/车体叠加/视图缩放平移）、折线图统一缩放、浮动化、点击联动车位、顶栏导出菜单、面板 UI 组件化（分区卡片/拖拽调宽/数值键入/Select 溢出修复）
- 规模：medium
- 功能规约：`specs/features/06-ui-charts-panels/`

### Phase 7: 持久化与数据接口 `07-persistence-export`
- [x] appState v6 持久化（逐字段回退）、panel-layout 独立 key、赛道库、CSV/PNG/JSON 导出、实测数据接口①–④约定
- 规模：small
- 功能规约：`specs/features/07-persistence-export/`

### Phase 8: 打包发布与自检体系 `08-packaging-release`
- [x] 两阶段发布流程（预览版→确认后打 exe）、BUILD-EXE 本机离线打包、三组自检命令与 scripts/test-*、screenshot.cjs 离屏截图目检
- 规模：small
- 功能规约：`specs/features/08-packaging-release/`

### Phase 9: MATLAB/Simulink 对照移植 `09-matlab-simulink-port`
- [x] 数学模型链条（§4–§8）向 MATLAB/Simulink 逐行对齐移植：em_field_check / em_track_sim 双模型 + runAll 自检
- 规模：medium
- 功能规约：`specs/features/09-matlab-simulink-port/`

### Phase 10: 实车循迹日志对比视图 `10-vehicle-log-compare`
- [ ] 导入实车循迹日志 CSV（接口④），与仿真轨迹 Err(t)/轮速(t)/电感 U(t) 曲线叠加对照
- 规模：small
- 前置依赖：实验 9 产出的实车日志数据（见 [`specs/research/2026-08-13-experiment-modeling.md`](research/2026-08-13-experiment-modeling.md)）
- 功能规约：`specs/features/10-vehicle-log-compare/`（骨架已建，待数据到位后访谈补全）

### Phase 11: SerialSource 串口直采 `11-serial-source`
- [ ] 接 Web Serial 实车 ADC 直采（接法已写在 `src/sensors/sources.ts` 头注释）
- 规模：medium
- 功能规约：待启动时创建

## 当前状态

- 已完成：Phase 01–09（电磁场建模仿真工具 0.1.0，2026-08-15 版 exe 已发布；Simulink 移植 2026-09 落地）
- 进行中：无代码阶段——等待用户执行实验建模（[`specs/research/2026-08-13-experiment-modeling.md`](research/2026-08-13-experiment-modeling.md)，🧪 三类九项实验，按实验 1→2→3→6/7→4/5→8/9 依赖顺序）
- 下一步：Phase 10（待实验 9 数据到位）；Phase 11 仍为预留方向

## 已合并/已取消的计划

- 2026-07-31：实测方案B 由查表插值（LUT）改为物理公式基准 + 偏差校正——LUT 方案取消（外推区/稀疏采样区不如物理基准稳健）。
- 2026-08-03：默认电感布局改为预设 4 电感，默认误差公式去 F1/F2；一键调 PID 目标函数由"最快完赛"改为"轨迹形状贴合"（直线贴中线、弯道内收圆润、外偏双倍罚、罚航向抖动）。
- 2026-08-12：单一《程序设计说明.md》拆分为《数学模型.md》+《程序设计说明.md》双文档；代码层 `src/physics/` + `src/sensors/measured.ts` 合并迁建 `src/mathmodel/`。
- 2026-08-13：实验部分定位由"事后验证"调整为"实验建模"（实验是建模的有机环节，三类九项重排编号）。
- 2026-09-30：**双文档基准制度升级为 SDD 文档体系**——两份设计基准文档内容迁入 `specs/`（本路线图 + 宪章 + 功能规约），原文归档 `archive/docs/legacy/`；此后任何功能变更先改对应 feature 规约三件套，再实现。
