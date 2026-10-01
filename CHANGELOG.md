# Changelog

本文档在每次功能分支合并到主分支时更新。历史条目由两份设计基准文档（已归档 `archive/docs/legacy/`）的修改记录与 git 历史整理而来。

## [Unreleased]

### Added
- **Phase 13 WASM 车载控制器（2026-10-01，`specs/features/13-wasm-controller/`）**：真实车载 C 代码编译为 wasm 后载入仿真闭环——`src/mathmodel/sim/controllerAbi.ts`（ABI v1：`CTRL_ABI_VERSION = 1`、syscall 式 env 导入表 + math 兜底、任务入口表、式 (13.1) pwm→轮速映射）+ `wasmController.ts`（`WasmController` 实现 `CarController`：异步编译实例化、入口存在性探测（缺哪个跳过哪个并报提示）、env 闭包经 `ControllerHost` 绑定 Vehicle 真值（ADC 通道 = 电感布局数组顺序；IMU/编码器/时间由运动学真值合成，本期无噪声）、五类故障（无效字节/入口全缺/ABI 不符/运行时 trap/env 导入缺失）明确报错回退内置 FormulaController 绝不崩溃、reset = 重新实例化热替换）。Simulator 任务入口类别扩为 `control / task1ms / task2ms`（FormulaController 路径行为不变，selfcheck:sim V-1 基线逐点一致保持）。TrackingPanel 新增控制器来源区（上传 .wasm / 来源显示 / 失败回退提示 / 热替换后防抖重算）；appState 新增 `wasmController.fileName`（只记文件名提示重启后重新上传，逐字段回退 null，未升版本）。新增 `controller-template/` 模板工程（controller_api.h / PD 示例 controller.c / clang freestanding build.bat）与 `npm run selfcheck:wasm`（编程构造最小 wasm 字节覆盖 V-2/V-3；V-1 fixture 一致性待本机 clang 生成 `scripts/fixtures/pd_controller.wasm` 后验证）。
- **Phase 12 仿真器架构分层（2026-10-01，`specs/features/12-simulator-architecture/`）**：`src/mathmodel/sim/` 子层——`CarController` 控制器接口 + 内置 `FormulaController`（公式 + PD + 差速轮速兜底/对照组）、多速率周期任务调度器（整数 µs 时间轴防漂移、过期周期合并、控制指令零阶保持）、虚拟整车 `Vehicle`（收敛 Home.tsx 三处重复读数闭包为 `createSensorSampler` 单一实现）、`Simulator` 门面（`reset` / `step` 实时逐帧 / `runToEnd` 快进）；一键调 PID 网格搜索迁入模型层（生成器逐候选 yield 进度，setTimeout 让出留 UI 侧）；循迹控制区新增快进/实时模式切换与运行/暂停/重置/倍速（0.25–4×）播放控制（会话内状态，appState 不动）。`simulateTracking()` 保持签名与 `TrackingResult` 不变，改为兼容薄壳；回归基线 fixture 逐点比对偏差 = 0（V-1）。新增 `npm run selfcheck:sim`（调度器合成测试 / FormulaController 等价 / 整定迁移等价）。
- MATLAB/Simulink 对照移植（`matlab-simulink/`：em_field_check / em_track_sim 双模型 + runAll 自检，与 JS 数学模型层逐行对齐）。
- **SDD 文档体系**（2026-09-30）：`specs/`（mission / techstack / roadmap + 功能规约 10 套 + research 实验建模记录）、`AGENTS.md`、本文档；原《数学模型.md》《程序设计说明.md》内容全部迁入 specs/，原文归档 `archive/docs/legacy/`。

### Changed
- **宪章变更（2026-10-01，`charter/vehicle-code-in-scope`）**：实车嵌入式控制代码由"范围外"调整为"以 WASM 形式载入仿真验证"（mission.md）；techstack.md 新增硬性约束"控制器 ABI 稳定"（原 Electron 安全 / Git 约定顺延为 7/8）；roadmap.md 立项 Phase 12（仿真器架构分层）与 Phase 13（WASM 车载控制器）。
- 设计基准制度由"双文档"改为 SDD 规约体系；此后设计变更先改对应 feature 规约（见 `AGENTS.md` 工作规则）。
- **工作区整理**（2026-10-01）：文献资料统一收编 `archive/`（docs/ + presets/ + references/ + scripts/extract_papers.py + papers/（仅本地））；删除 `backup/` 旧版 exe、`release/` 重复 exe、`matlab-simulink/outputs/` 调试残留与 `slprj/` 缓存；发布渠道改为上传 GitHub Releases（BUILD-EXE.md 与 08 规约三件套同步），本地不再保留旧版备份；`BUILD-EXE.md` 头部旧约定（每次改代码直接重打包）修正为两阶段发布表述。
- **《项目交接文档.md》完成使命删除**（2026-10-01）：独有内容已并入正式体系——代码架构地图（文件↔规约对照）与本机 Electron 用户数据路径 → `specs/techstack.md`；协作画像（口述变更、公式截图、文档滞后核对源码）→ `AGENTS.md` 工作规则；时间线叙事由本文档与 git 历史承接。

## [0.1.0] - 2026-08-02（维护至 2026-08-15）

### Added
- 车体位姿来源切换：手动位姿 / 跟随仿真轨迹（轨迹进度滑块取点，s/e/ψ 反算只读）。
- 赛道闭环：首尾相连（吸合阈值 20 mm），闭环赛道循迹仅一圈。
- 循迹参数滑块化 + ⚙ 一键调 PID（粗搜 13×11 + 邻域 9×9 细化；目标函数为轨迹形状贴合：直线贴中线、弯道内收 ≤50 mm 不罚、外偏双倍罚、罚航向抖动）。
- 全部折线图统一缩放（框选/滚轮/平移/复位，`ZoomableChart`）；折线图浮动化（拖出/移动/八向拉伸，`FloatingChart`）；图表点击数据点联动车位。
- 左侧栏可收起并持久化；右侧面板循迹控制区上移。
- 赛道转角 300 mm 刻度叠加（`cornerRulers()`，短段按实际段长截断）。
- 循迹轨迹电感值图（`TrackingSensorChart`，全程扫描区双图切换，横轴 t / 弧长可切）。
- 循迹轨迹 CSV 导出（接口②，实车日志对照基准）。
- 电机一阶滞后模型（2026-08-12）：τ_m（`motorTauMs`，默认 30 ms、0 = 无滞后），实际轮速按精确更新跟随指令轮速。
- 实验建模章节与实测数据接口约定（2026-08-13）：三类九项实验手册 + 接口①–④（①②程序内已实现，③④线下处理约定）。
- 面板 UI 组件化改造（2026-08-15）：PanelSection 可折叠分区卡片、左右面板拖拽调宽（react-resizable-panels，独立 key `panel-layout`）、位姿与标定 Vpp 数值可直接键入（共享 `ui/mini-num.tsx`）、深色细滚动条与粘性面板标题栏、`scripts/screenshot.cjs` 离屏截图目检工具。
- appState v5 → v6：`floatingCharts`（折线图浮动状态）、`trackingRanges`（滑块自定义量程）。

### Changed
- 默认电感布局改为预设 4 电感（L1/R1 纵向感 By 主对 ±50 mm、L2/R2 横向感 Bx 宽对 ±75 mm，h = 75 mm、y = 80 mm）；默认误差公式同步去 F1/F2。
- 实测方案B 由查表插值改为物理公式基准 + 偏差校正（2026-07-31 设计，本周期内沿用）。
- 循迹参数输入改造：w / W / dt / τ_m / 初始扰动共 6 项数字直输，其余滑块量程可编辑。
- 电感敏感轴以水平面内方向为主（x 横向 / y 纵向 / z 竖直保留可用）。
- 更新发布流程：先出预览版（build/dev）交用户确认，再按 BUILD-EXE.md 打 exe。
- 文档拆分（2026-08-12）：《数学模型.md》（学位论文范式）与《程序设计说明.md》（人机交互）分立；代码层迁建 `src/mathmodel/`。

### Fixed
- 转弯时车体朝向反向转一圈缺陷（根因：ψ 反算符号写反，正确约定 ψ = 切向角 − θ）。
- Select 组件文字溢出选项框（选中值槽位 `min-w-0 + truncate` 根因修复 + 五处宽度与文案收敛）。

## [0.0.0] - 2026-07-30

### Added
- Electron 桌面工具初版（`em-field-studio`，取代 Python 版 `track_model/`）：鼠标铺设赛道（直线连线/圆弧段/形状工具）、毕奥-萨伐尔磁场计算与热力图、电感读数剖面与全程扫描、实测数据标定（CSV 导入）、Windows 便携版 exe 打包。
- 循迹闭环仿真（2026-07-31 设计并落地）：可编辑误差公式（C4 结构）、PD 控制、两轮差速轮速分配（内外轮 1.5:1）、参数修改轨迹同步重算。
- Python 仿真探索阶段存档（`track_model/` 与 `archive/docs/仿真结果小结.md`）：直道线性区结论（err=(L1−R1)/(L1+R1) 在 ±15 cm 内线性，R²>0.997）、布局建议（主对半间距 ≥ e_max + h，h = 6–8 cm，前瞻 d≈30 cm）等。
