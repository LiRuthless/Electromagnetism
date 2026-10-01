# Phase 9: MATLAB/Simulink 对照移植 — 需求

> ✅ 已实现（2026-09-26）。关联 [`plan.md`](plan.md)；公式编号引用 specs/features/01~05 各规约保留的原"式 (x.y)"编号（即归档《数学模型.md》编号，禁止重编号）。

## 功能需求

- FR-1: 赛道几何移植（对应 `specs/features/model/01-track-geometry/`）：段序列（直线/圆弧）参数化递推（式 [(4.1)](../01-track-geometry/requirements.md#eq-4-1)[(4.2)](../01-track-geometry/requirements.md#eq-4-2)）、场计算离散化（直线段不切碎走闭式解，圆弧 ≤ MAX_DS = 1 cm 离散，§4.2）、中线采样 5 mm 步进、闭环吸合阈值 g₀ = 20 mm（式 [(4.3)](../01-track-geometry/requirements.md#eq-4-3)）。
- FR-2: 磁场计算移植（对应 `specs/features/model/02-magnetic-field/`）：毕奥-萨伐尔离散积分（式 [(5.1)](../02-magnetic-field/requirements.md#eq-5-1)）、有限长直线段闭式解（式 [(5.2)](../02-magnetic-field/requirements.md#eq-5-2)，精确）、奇异截断 R_MIN = 1 mm（式 [(5.4)](../02-magnetic-field/requirements.md#eq-5-4)）、无限长直导线解析对照（式 [(5.5)](../02-magnetic-field/requirements.md#eq-5-5)）、观测面网格批算（§5.5）。
- FR-3: 电感响应移植（对应 `specs/features/model/03-sensor-model/`）：响应公式 U = k|B·n̂|（式 [(6.1)](../03-sensor-model/requirements.md#eq-6-1)）、贴线锚点标定 k（式 [(6.2)](../03-sensor-model/requirements.md#eq-6-2)–[(6.4)](../03-sensor-model/requirements.md#eq-6-4)，Vpp_anchor = 6 V 先验值，默认参数下 k ≈ 9.75×10⁵ V/T）、默认 4 电感布局（§6.3 表：L1/R1 主对纵向感 By @ ±50 mm，L2/R2 宽对横向感 Bx @ ±75 mm，h = 75 mm、y = 80 mm）、车体位姿与坐标变换（式 [(6.5)](../03-sensor-model/requirements.md#eq-6-5)–[(6.8)](../03-sensor-model/requirements.md#eq-6-8)）、全程扫描 U(s)（§6.5）。
- FR-4: 循迹控制移植（对应 `specs/features/model/05-tracking-control/`）：闭环信号流 §8.1 全链路。误差公式移植为**固定结构 + 可调系数 A/B/C/P** 的式 [(8.1)](../05-tracking-control/requirements.md#eq-8-1)：

  $$Err=\frac{A\,(L1-R1)+B\,(L2-R2)}{A\,(L1+R1)+C\,|L2-R2|}\cdot P \tag{8.1}$$

  其中，L1、R1 为左右主电感对读数（Vpp），L2、R2 为左右宽对辅助电感读数；A、B、C 为加权系数；P 为比例系数。非法结果（分母为零等）回退上一步误差，避免 NaN 发散。PD 控制（式 [(8.2)](../05-tracking-control/requirements.md#eq-8-2)）、差速轮速分配与限幅（式 [(8.3)](../05-tracking-control/requirements.md#eq-8-3)–[(8.5)](../05-tracking-control/requirements.md#eq-8-5)）、电机一阶滞后按控制步内指令恒定的闭式解精确更新：

  $$v_i \leftarrow v_i^{cmd} + \big(v_i - v_i^{cmd}\big)\,e^{-dt/\tau_m} \tag{8.7}$$

  其中，dt 为控制步长；τ_m = 0 时退化为瞬时跟随。两轮差速运动学（式 [(8.8)](../05-tracking-control/requirements.md#eq-8-8)/[(8.9)](../05-tracking-control/requirements.md#eq-8-9)，半隐式欧拉先转后移）、终止条件：

  $$\text{finished：行驶弧长}\ge\begin{cases}L_{track} & \text{闭环赛道（仅一圈）}\\ L_{track}+0.5\ \text{m} & \text{非闭环}\end{cases} \tag{8.10}$$

  此外 |Err| 持续超 errLimit 达 errLimitSteps 步判 lost。
- FR-5: `params.m` 为**唯一参数来源**，默认值与 JS 侧（`em-field-studio/src/model/`）一致，单位一律 SI（m、rad、T、A、V、s）；参数表见接口约定。
- FR-6: `init(trackName, P)` 将参数结构体 P 与赛道数据结构 TD 注入 base 工作区（`assignin`），供 Simulink 模型运行时经 `evalin('base',...)` 读取；改参数/换赛道只需重新 `init`，无需重建模型。
- FR-7: 双 Simulink 模型由脚本程序化构建（`build_all` 一键 = `init` + `build_em_field_check` + `build_em_track_sim`）：
  - `em_field_check.slx`：Plant 开环验证——直导线横向扫描 U(e)（e 自 −150 mm 以 0.1 m/s 扫至 +150 mm，y = 2.0 m 处、θ = π/2），固定 3 s 判停，供对照解析解（式 [(5.5)](../02-magnetic-field/requirements.md#eq-5-5)）；
  - `em_track_sim.slx`：闭环循迹——Plant → 误差（式 [(8.1)](../05-tracking-control/requirements.md#eq-8-1)）→ PD（式 [(8.2)](../05-tracking-control/requirements.md#eq-8-2)）→ 轮速分配（式 [(8.3)](../05-tracking-control/requirements.md#eq-8-3)–[(8.5)](../05-tracking-control/requirements.md#eq-8-5)）→ 电机滞后（式 [(8.7)](../05-tracking-control/requirements.md#eq-8-7)）→ 差速运动学（式 [(8.8)](../05-tracking-control/requirements.md#eq-8-8)/[(8.9)](../05-tracking-control/requirements.md#eq-8-9)）→ Unit Delay 位姿反馈；完赛/失控（式 [(8.10)](../05-tracking-control/requirements.md#eq-8-10)）触发 Stop Simulation。
- FR-8: `runAll` 全部自检入口：磁场/电感环节（对照 §10.1 自检 [1][2][9][10]，判据见 [`specs/features/model/02-magnetic-field/validation.md`](../02-magnetic-field/validation.md) 与 [`specs/features/model/03-sensor-model/validation.md`](../03-sensor-model/validation.md)）+ em_field_check 开环模型对照 + 循迹闭环（电机滞后阶跃 63.2%、直道收敛、闭环一圈完赛、em_track_sim 对纯 MATLAB 参考实现 `em_simulateTracking` 逐步一致）；任一不通过以 error 结束。
- FR-9: 演示出图三入口（`plot_field_heatmap` / `plot_sweep` / `plot_trajectory`），离屏出 PNG 存 `outputs/`（出图约定见接口约定）。
- FR-10: 全部公式注释的"式 (x.y)"编号与 specs/features/01~05 保留的原编号一致；磁场核心 `em_computeB` 与 TS 版同源逐行对齐。

## 技术约束

- TC-1: 环境 MATLAB R2025a + Simulink（仅需基础 Simulink，无额外工具箱）；本机 MATLAB：`E:\APP\MATLAB\R2025a`。
- TC-2: SI 单位内部计算（m、rad、T、A、V、s），与 [`techstack.md`](../../../techstack.md) 硬性约束 1 一致。
- TC-3: 求解器统一 Fixed-step discrete，步长 5 ms（`P.dt`，与实车控制周期一致）；`em_field_check` StopTime 固定 3.0 s，`em_track_sim` StopTime = `P.stopTime`（默认 120 s，实际由终止判定提前 Stop）。
- TC-4: 公式与默认值与 `em-field-studio/src/model/` 逐行对齐；MATLAB 侧任何公式/默认值改动必须同步对应 feature 规约与 JS 侧（对齐方向以 JS 侧为准）。
- TC-5: 算法块用 Interpreted MATLAB Function（`blocks/ifc*.m`），运行时 `evalin('base',...)` 读 P/TD（本机 Stateflow MATLAB Function 块 chart.Script 解析存在环境性故障，故改用解释型块）。
- TC-6: 闭环仿真必须 `P.Pcoef = -1` 才闭合负反馈（本布局 (L−R)/(L+R) 与纠偏方向相反，与 JS 侧 `selfcheck-tracking.ts` 的 `P:-1` 一致）；`params` 默认 +1 忠实于式 [(8.1)](../05-tracking-control/requirements.md#eq-8-1) 原文，`runAll` 与 `plot_trajectory` 内部已置 −1。
- TC-7: 模型中两处除法（/dt、/W）用 Product 真除法而非 1/x 增益，保持与参考实现逐 bit 兼容（倒数乘与除法在 IEEE 下差 1 ulp，S 弯弯心振荡段会被放大，见 `selfcheck/dbg_diff.m`）。
- TC-8: 模型 InitFcn 回调 `em_ensure_init` 仅在 P/TD 缺失时兜底初始化，不覆盖用户已设好的值。

## 接口约定

### 代码落点（`matlab-simulink/`）

| 位置 | 职责 |
|---|---|
| `params.m` / `init.m` / `em_ensure_init.m` | 参数与初始化（唯一参数来源 `params.m`） |
| `build_track_data.m` | 赛道 → 场单元 + 中线采样（TD 结构） |
| `track_lib/` | 预设赛道（`seg_line(ℓ)` / `seg_arc(R,α°,转向)` 段构造 + 直道 `track_straight` / 直角弯 `track_right_angle` / S 弯 `track_s_curve` / 圆角矩形闭环 `track_loop_rounded` / 尖角方框闭环 `track_loop_square`） |
| `geom/` | 赛道几何（§4：`em_advancePen`、`em_buildElements`/`em_buildFieldElements` 离散化、`em_samplePath`/`em_pointAtLength` 中线采样、`em_closureGap`、`em_trackTip`） |
| `field/` | 磁场（§5：`em_wireSegB` 闭式解 式 [(5.2)](../02-magnetic-field/requirements.md#eq-5-2)、`em_computeB` 离散积分 式 [(5.1)](../02-magnetic-field/requirements.md#eq-5-1)、`em_infiniteWireB` 解析对照 式 [(5.5)](../02-magnetic-field/requirements.md#eq-5-5)、`em_computeGrid` 网格批算） |
| `sensor/` | 电感响应（§6：`em_calibK` 标定 式 [(6.2)](../03-sensor-model/requirements.md#eq-6-2)–[(6.4)](../03-sensor-model/requirements.md#eq-6-4)、`em_touchField`、`em_sweepAlongTrack` 全程扫描） |
| `control/` | 循迹控制（§8：`em_errDefault` 式 [(8.1)](../05-tracking-control/requirements.md#eq-8-1)、`em_wheelSpeeds` 式 [(8.3)](../05-tracking-control/requirements.md#eq-8-3)–[(8.5)](../05-tracking-control/requirements.md#eq-8-5)、`em_motorLag` 式 [(8.7)](../05-tracking-control/requirements.md#eq-8-7)、`em_stepCar` 式 [(8.8)](../05-tracking-control/requirements.md#eq-8-8)/[(8.9)](../05-tracking-control/requirements.md#eq-8-9)）+ `em_simulateTracking` 纯 MATLAB 参考实现 |
| `blocks/` | Simulink 解释型 MATLAB Function 块包装脚本（`ifcPlant` / `ifcErr` / `ifcAlloc` / `ifcLag`） |
| `build_all.m` / `build_em_field_check.m` / `build_em_track_sim.m` | 程序化构建 .slx 模型 |
| `selfcheck/` | 自检：`runAll` / `sc_field` / `sc_tracking`（对照 §10.1，即各 feature validation.md） |
| `demo/` | 出图脚本（→ `outputs/*.png`） |

### params.m 参数表（默认值）

| 字段 | 默认值 | 含义（依据式编号） |
|---|---|---|
| `MU0` | 4π×10⁻⁷ H/m | 真空磁导率 |
| `I` | 0.1 A | 赛道电流幅值（界面可调 20–200 mA） |
| `R_MIN` | 1e-3 m | 奇异截断距离（式 [(5.4)](../02-magnetic-field/requirements.md#eq-5-4)） |
| `MAX_DS` | 0.01 m | 圆弧离散最大段长（§4.2） |
| `CLOSE_SNAP` | 0.02 m | 闭环吸合阈值（式 [(4.3)](../01-track-geometry/requirements.md#eq-4-3)） |
| `VPP_ANCHOR` | 6 V | 标定锚点 Vpp（20 kHz/100 mA 贴线，先验值 5–7） |
| `k` | VPP_ANCHOR / (μ₀I / 2π·(0.00025+0.003)) ≈ 9.75×10⁵ V/T | 标定系数（式 [(6.2)](../03-sensor-model/requirements.md#eq-6-2)–[(6.4)](../03-sensor-model/requirements.md#eq-6-4)，内联计算等同 `em_calibK`） |
| `sensMat` | 4×6，见下 | 默认 4 电感布局（§6.3 表；列：车体系 x, y, 高度 h, 敏感轴车体系分量 ax, ay, az，式 [(6.7)](../03-sensor-model/requirements.md#eq-6-7)/[(6.8)](../03-sensor-model/requirements.md#eq-6-8)） |
| `sensNames` | `{'L1','R1','L2','R2'}` | 电感名 |
| `A` / `B` / `C` / `Pcoef` | 全 1 | 误差公式系数（式 [(8.1)](../05-tracking-control/requirements.md#eq-8-1)，结构固定、系数可调） |
| `kp` / `kd` | 0.5 / 0.05 | PD 比例/微分系数（式 [(8.2)](../05-tracking-control/requirements.md#eq-8-2)，微分为相邻控制步差分/dt） |
| `vBase` / `vMax` | 1.0 / 2.0 m/s | 基础速度 / 轮速上限（限幅 [0, vMax]，式 [(8.3)](../05-tracking-control/requirements.md#eq-8-3)–[(8.5)](../05-tracking-control/requirements.md#eq-8-5)） |
| `w` | 1.5 | 差速权重（内轮变化量 : 外轮变化量 = w : 1） |
| `tauS` | 0.030 s | 电机一阶滞后时间常数（0 = 无滞后，瞬时跟随，式 [(8.6)](../05-tracking-control/requirements.md#eq-8-6)/[(8.7)](../05-tracking-control/requirements.md#eq-8-7)） |
| `W` | 0.135 m | 轮距（式 [(8.8)](../05-tracking-control/requirements.md#eq-8-8)） |
| `dt` | 0.005 s | 控制/积分步长（5 ms，与实车一致） |
| `initE` / `initPsi` | 0 / 0 | 初始横向偏差 m（>0 右偏）/ 初始航向角扰动 rad（>0 右偏） |
| `errLimit` / `errLimitSteps` | 2 / 200 | 失控判停：|Err| 阈值 / 持续超限步数 |
| `finishTol` | 0.5 m | 非闭环完赛容差（闭环赛道跑一圈即停，式 [(8.10)](../05-tracking-control/requirements.md#eq-8-10)） |
| `stopTime` | 120 s | 仿真时长上限（实际由终止判定提前 Stop） |
| `trackName` | `'track_s_curve'` | 默认赛道（`track_lib/` 中的函数名） |

`sensMat` 各行（§6.3 默认布局）：L1 `[-0.050, 0.08, 0.075, 0,1,0]`（主对·左，纵向感 By）；R1 `[+0.050, 0.08, 0.075, 0,1,0]`（主对·右）；L2 `[-0.075, 0.08, 0.075, 1,0,0]`（宽对·左，横向感 Bx）；R2 `[+0.075, 0.08, 0.075, 1,0,0]`（宽对·右）。

### 参数/赛道注入：`init('track 名', P)`

- 用法四种：`init`（默认参数+默认赛道）/ `init('track_xxx')`（换赛道）/ `init([], P)`（自定义参数，先 `P = params;` 再改字段）/ `init('track_xxx', P)`（两者都指定）。标准改参流程：`P = params; P.kp = 0.8; init([], P); sim('em_track_sim');`
- 注入内容：`assignin('base','P',P)` 与 `assignin('base','TD',TD)`。TD 由 `build_track_data(trackName, P)` 构建（`wires`/`mids`/`dls` 场计算单元、`path` 中线采样、`length` 总长、`closed` 闭环标志），init 再派生：初始位姿 `x0/y0/theta0`（起点中线处 + e/ψ 扰动，e>0 右偏、ψ>0 顺时针）、电机滞后系数 `alpha = exp(-dt/tauS)`（式 [(8.7)](../05-tracking-control/requirements.md#eq-8-7)；tauS=0 时 alpha=0）、完赛弧长 `finishDist`（闭环 = 单圈总长；非闭环 = 总长 + finishTol，式 [(8.10)](../05-tracking-control/requirements.md#eq-8-10)）、`sensMat`。
- 模型的 InitFcn 回调在 P/TD 缺失时自动调用 `em_ensure_init` 兜底，不覆盖已有值。

### 入口命令

```matlab
cd('E:\study\Electromagnetism\matlab-simulink')
build_all        % 一键：初始化参数/赛道 + 构建两个 .slx 模型
runAll           % 全部自检（磁场/电感 + 循迹闭环 + 模型对参考一致性）

plot_field_heatmap('track_loop_rounded')   % 磁场 |B| 热力图（§5.5；h 默认 75 mm）
plot_sweep('track_s_curve', 0, 0)          % 全程扫描 U(s)（§6.5；e_mm, ψ_deg）
plot_trajectory('track_s_curve', 30, 5)    % 循迹仿真四联图（§8；初扰 e_mm, ψ_deg；内部置 Pcoef=-1）
```

批处理自检：`matlab -batch "cd('.../matlab-simulink'); runAll"`（任一失败 error，退出码非 0）。

### 模型信号约定

- `em_field_check`：To Workspace 变量 `elog`（Structure With Time），信号 `[e, U1..U4]`。
- `em_track_sim`：To Workspace 变量 `simlog`（Structure With Time），信号 `[x, y, θ, vL, vR, err, U1..U4]`。

### outputs/ 出图约定

- 离屏 figure（`'Visible','off'`）、150 dpi PNG，目录不存在时自动创建；文件名：
  - `plot_field_heatmap` → `outputs/heatmap_<赛道名>.png`（赛道包围盒外扩 0.25 m、约 5 mm 分辨率，叠白色中线，色标 |B| (μT)）
  - `plot_sweep` → `outputs/sweep_<赛道名>.png`（4 电感 U(s)，横轴弧长 m、纵轴 Vpp）
  - `plot_trajectory` → `outputs/tracking_<赛道名>.png`（四联图：轨迹+起终点 / Err(t) 式 [(8.1)](../05-tracking-control/requirements.md#eq-8-1) / 实际轮速 式 [(8.7)](../05-tracking-control/requirements.md#eq-8-7) / 各电感 U(t) 式 [(6.1)](../03-sensor-model/requirements.md#eq-6-1)）
- `outputs/` 不进 git（根 .gitignore 已排除）。

## 非目标（Non-goals）

- §7 实测数据经验模型（需实车 CSV，属 `specs/features/model/04-measured-data-model/`，本移植不含）；
- §8.6 一键整定网格搜索（式 [(8.11)](../05-tracking-control/requirements.md#eq-8-11)，属 `specs/features/model/05-tracking-control/`，本移植不含）；
- 附加独立导线（extraWires）；
- NaN 判停（Simulink 中无对应简洁模块）；
- 误差公式的表达式文本解析器（Simulink 侧为固定结构 + 系数 A/B/C/P）；
- 实车嵌入式控制代码（mission 范围外）。
