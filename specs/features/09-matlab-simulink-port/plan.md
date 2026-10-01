# Phase 9: MATLAB/Simulink 对照移植 — 实现计划

> 本规约为已实现功能的回溯文档化（棕地逆向，2026-09-30 依据归档设计文档补齐）。
> 状态：✅ 已实现（2026-09-26 落地，git 提交 `f50b547` 新增 + `c255260` 清理复验，自检复验通过）。

## 目标

将数学模型链条 §4～§8（赛道几何 → 磁场分布 → 电感响应 → 循迹控制）移植为 MATLAB/Simulink 对照实现（`matlab-simulink/`），公式与默认值与 `em-field-studio/src/mathmodel/` **逐行对齐**，公式注释的"式 (x.y)"编号与 specs/features/ 各规约保留的原编号一致。提供 `build_all` / `runAll` 一键流程、`em_field_check` / `em_track_sim` 双 Simulink 模型与演示出图，作为 JS 主实现的独立交叉验证。

## 背景与依据

- 关联宪章：`specs/mission.md` 范围内条目"MATLAB/Simulink 对照移植（公式与 JS 数学模型层逐行对齐）"；`specs/techstack.md` 语言与运行时条目"MATLAB R2025a + Simulink 基础版（`matlab-simulink/` 对照移植，无额外工具箱）"、构建与工具链条目"MATLAB 侧：`build_all`（一键建模）、`runAll`（全部自检）"、目录规范条目（公式注释式编号与 specs/features/ 保留编号一致）。
- 前置条件：Phase 01–05 已全部实现（数学模型链条与默认参数定稿，式编号保留于各 feature 规约）；§10.1 自检体系已在 JS 侧建立（见各 feature validation.md），移植自检逐项与之对照。
- 源文档：`matlab-simulink/README.md`（环境、快速开始、模型说明、目录约定）、`项目交接文档.md` §3 架构地图（JS 侧对应模块与核心物理默认值）。
- 实现日期推断：git 历史 `f50b547`（2026-09-26，`feat: 新增 matlab-simulink 电磁赛道 Simulink 仿真模型`）与 `c255260`（2026-09-26，清理废案脚本残留、收录 GUI 重存的两个模型，自检复验通过）；roadmap 记"Simulink 移植 2026-09 落地"。

## 任务分组（Task Groups）

### Group 1: 纯 MATLAB 数学模型层移植（2026-09-26）
- [x] `params.m` 唯一参数来源（默认值照抄 JS 侧，SI 单位）+ `init.m` 参数/赛道注入 base 工作区 + `em_ensure_init.m` 模型 InitFcn 兜底
- [x] `geom/` 赛道几何移植：`em_advancePen`（式 (4.1)(4.2)）、离散化（MAX_DS = 1 cm）、中线采样 5 mm 步进、闭环吸合（式 (4.3)，阈值 20 mm）
- [x] `field/` 磁场移植：闭式解 `em_wireSegB`（式 (5.2)）、离散积分 `em_computeB`（式 (5.1)）、解析对照 `em_infiniteWireB`（式 (5.5)）、网格批算 `em_computeGrid`（§5.5）
- [x] `sensor/` 电感响应移植：贴线锚点标定 `em_calibK`（式 (6.2)–(6.4)）、全程扫描 `em_sweepAlongTrack`（§6.5）、默认 4 电感布局（§6.3）
- [x] `control/` 循迹控制移植：误差（式 (8.1) 固定结构版 `em_errDefault`）、轮速分配（式 (8.3)–(8.5) `em_wheelSpeeds`）、电机滞后（式 (8.7) `em_motorLag`）、运动学（式 (8.8)/(8.9) `em_stepCar`）+ `em_simulateTracking` 纯 MATLAB 参考实现
- [x] `track_lib/` 赛道库：`seg_line` / `seg_arc` 段构造函数 + 5 条预设赛道（直道 / 直角弯 / S 弯 / 圆角矩形闭环 / 尖角方框闭环）+ `build_track_data.m` 赛道 → 场单元 + 中线采样

### Group 2: Simulink 双模型程序化构建（2026-09-26）
- [x] `build_em_field_check.m` → `em_field_check.slx`：Plant 开环，直导线横向扫描 U(e)（e 从 −150 mm 到 +150 mm，0.1 m/s，固定 3 s 判停），对照解析解（式 (5.5)）
- [x] `build_em_track_sim.m` → `em_track_sim.slx`：闭环循迹（Plant → 误差（式 (8.1)）→ PD（式 (8.2)）→ 轮速分配（式 (8.3)–(8.5)）→ 电机滞后（式 (8.7)）→ 差速运动学（式 (8.8)/(8.9)）→ Unit Delay 位姿反馈），完赛/失控（式 (8.10)）→ Stop Simulation
- [x] `blocks/ifc*.m` 四个算法块的 Interpreted MATLAB Function 包装脚本（ifcPlant / ifcErr / ifcAlloc / ifcLag），运行时 `evalin('base',...)` 读 P/TD
- [x] `build_all.m` 一键：init 默认参数/赛道 + 构建两个 .slx；求解器统一 Fixed-step discrete、步长 5 ms（与实车控制周期一致）

### Group 3: 自检体系（2026-09-26）
- [x] `selfcheck/sc_field.m`：磁场/电感环节自检（对照 §10.1 自检 [1][2][9][10] + em_field_check 开环模型对照）
- [x] `selfcheck/sc_tracking.m`：循迹闭环自检（电机滞后阶跃 63.2%、直道收敛、闭环一圈完赛、slx 对参考实现逐步一致）
- [x] `selfcheck/runAll.m`：全部自检入口，任一失败以 error 结束（batch 退出码非 0）
- [x] 负反馈符号约定落实：`params` 默认 Pcoef = +1 忠实式 (8.1)；闭环自检/演示一律显式置 −1

### Group 4: 演示出图（2026-09-26）
- [x] `demo/plot_field_heatmap.m`：磁场 |B| 热力图（§5.5 网格批算）
- [x] `demo/plot_sweep.m`：全程扫描 U(s)（§6.5）
- [x] `demo/plot_trajectory.m`：循迹仿真四联图（轨迹 / Err / 轮速 / 电感，§8）
- [x] 出图统一约定：离屏 figure、150 dpi PNG、存 `outputs/`

## 实现顺序与依赖

Group 1 → Group 2 → Group 3 → Group 4。纯 MATLAB 函数层先行（Simulink 模型的全部算法块只是它的包装）；模型构建依赖函数层与参数注入机制；自检依赖模型已构建（否则对应项判 FAIL 并提示先运行 `build_all`）；演示出图依赖模型与自检通过。功能上不改动 `em-field-studio/` 任何代码，仅依赖其既定公式与默认值作为对齐基准。

## 风险与取舍

- **Stateflow MATLAB Function 块环境性故障**：本机 Stateflow MATLAB Function 块 chart.Script 解析存在环境性故障，故四个算法块改用 **Interpreted MATLAB Function**（包装脚本 `blocks/ifc*.m`）。附带收益：块经 `evalin('base',...)` 读 P/TD，改参数只需重新 `init`，无需重建模型。
- **误差公式不含表达式文本解析器**：JS 侧的可编辑误差公式（递归下降解析）在 Simulink 侧移植为**固定结构 + 可调系数 A/B/C/P**（式 (8.1) 结构固定）——Simulink 中实现文本解析得不偿失，调参经系数覆盖。
- **除法用 Product 真除法而非 1/x 增益**：模型中两处除法（/dt、/W）刻意用真除法，保持与参考实现 `em_simulateTracking` 逐 bit 一致（倒数乘与除法在 IEEE 下差 1 ulp，在 S 弯弯心振荡段会被放大，见 `selfcheck/dbg_diff.m`）。
- **负反馈符号**：默认布局下车右偏（e>0）时左感升/右感降，差比和 (L−R)/(L+R)>0 与纠偏方向相反，闭环仿真必须 `P.Pcoef = -1` 才闭合负反馈（与 em-field-studio `selfcheck-tracking.ts` 的 `P:-1` 一致）。`params` 默认 +1 忠实于式 (8.1) 原文，`runAll` 与 `plot_trajectory` 内部已置 −1。
- **明确排除（未移植内容，README 有记载）**：§7 实测经验模型（需实车 CSV，见 `specs/features/04-measured-data-model/`）、§8.6 一键整定网格搜索（式 (8.11)，见 `specs/features/05-tracking-control/`）、附加独立导线（extraWires）、NaN 判停（Simulink 中无对应简洁模块）。
