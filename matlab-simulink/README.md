# matlab-simulink — 电磁赛道 Simulink 建模

《数学模型.md》§4～§8 模型链条（赛道几何 → 磁场 → 电感响应 → 循迹控制）的
MATLAB / Simulink 移植，公式与默认值与 `em-field-studio/src/mathmodel/` 逐行对齐。
本目录公式注释中的"式 (x.y)"编号与 SDD 规约（`specs/features/01`–`05`，原样保留原编号）
一致；原《数学模型.md》已归档至 `archive/docs/legacy/数学模型.md`，可作全文对照。
功能规约见 `specs/features/model/09-matlab-simulink-port/`。

## 环境

- MATLAB R2025a + Simulink（仅需基础 Simulink，无额外工具箱）
- 本机 MATLAB：`E:\APP\MATLAB\R2025a`

## 快速开始

```matlab
cd('E:\study\Electromagnetism\matlab-simulink')
build_all        % 一键：初始化参数/赛道 + 构建两个 .slx 模型
runAll           % 全部自检（磁场/电感 + 循迹闭环 + 模型对参考一致性）
```

演示出图（PNG 存到 `outputs/`）：

```matlab
plot_field_heatmap('track_loop_rounded')   % 磁场 |B| 热力图（§5.5）
plot_sweep('track_s_curve', 0, 0)          % 全程扫描 U(s)（§6.5）
plot_trajectory('track_s_curve', 30, 5)    % 循迹仿真四联图（§8）
```

改参数 / 换赛道：

```matlab
P = params;  P.kp = 0.8;  P.tauS = 0.05;   % 改 PD / 电机时间常数
init('track_loop_rounded', P);             % 注入 base 工作区
sim('em_track_sim');                        % 跑闭环仿真
```

## 模型说明

| 模型 | 内容 | 判停 |
|---|---|---|
| `em_field_check.slx` | Plant 开环：直导线横向扫描 U(e)，对照解析解（式 5.5） | 固定 3 s |
| `em_track_sim.slx` | 闭环循迹：Plant → 误差(式 8.1) → PD(式 8.2) → 轮速分配(式 8.3–8.5) → 电机滞后(式 8.7) → 差速运动学(式 8.8/8.9) → Unit Delay 位姿反馈 | 完赛 / 失控（式 8.10）→ Stop Simulation |

- 求解器：Fixed-step discrete，步长 5 ms（与实车控制周期一致）。
- 电机滞后用 Unit Delay + 精确更新（式 8.7），与 1/(τs+1) 的零阶保持
  精确离散化等价；τ=0 时 alpha=0 退化为瞬时跟随。
- **负反馈符号**：闭环仿真必须 `P.Pcoef = -1`。本布局下车右偏（e>0）时
  左感升/右感降，差比和 (L−R)/(L+R)>0 与纠偏方向相反，Pcoef=-1 才闭合负反馈
  （与 em-field-studio `selfcheck-tracking.ts` 的 `P:-1` 一致）。
  `params` 默认 +1 忠实于文档式 8.1；`runAll` 与 `plot_trajectory` 内部已置 -1。
- Plant / 误差 / 分配 / 滞后为 **Interpreted MATLAB Function** 块，包装脚本在
  `blocks/ifc*.m`，经 `evalin('base',...)` 读 P/TD——改参数只需重新 `init`，
  无需重建模型；磁场核心 `em_computeB` 与 TS 版同源。
  （本机 Stateflow MATLAB Function 块 chart.Script 解析存在环境性故障，故改用解释型块。）
- 误差公式移植为固定结构 + 可调系数 A/B/C/P（不含程序的表达式文本解析器）。
- 未移植内容：§7 实测经验模型（需实车 CSV）、§8.6 一键整定网格搜索、
  附加独立导线（extraWires）、NaN 判停（Simulink 中无对应简洁模块）。

## 目录

```
params.m / init.m / em_ensure_init.m   参数与初始化（唯一参数来源 params.m）
build_track_data.m                     赛道 → 场单元 + 中线采样
track_lib/    预设赛道（直道/直角弯/S弯/圆角矩形闭环/尖角方框闭环）
geom/         赛道几何（§4：advancePen、离散化、中线采样）
field/        磁场（§5：闭式解 5.2、离散积分 5.1、解析对照 5.5、网格批算）
sensor/       电感响应（§6：标定 6.2–6.4、全程扫描）
control/      循迹控制（§8）+ em_simulateTracking 纯 MATLAB 参考实现
blocks/       Simulink 解释型 MATLAB Function 块包装脚本（ifc*.m）
build_*.m     程序化构建 .slx 模型
selfcheck/    自检（对照 §10.1）：runAll / sc_field / sc_tracking
demo/         出图脚本（outputs/*.png）
```
