# Phase 9: MATLAB/Simulink 对照移植 — 验证

> 关联 [`plan.md`](plan.md) / [`requirements.md`](requirements.md)。判据数值均照抄 `matlab-simulink/selfcheck/sc_field.m`、`sc_tracking.m`（其本身对照归档《数学模型.md》§10.1，即 [`specs/features/model/02-magnetic-field/validation.md`](../02-magnetic-field/validation.md)、[`specs/features/model/03-sensor-model/validation.md`](../03-sensor-model/validation.md)、[`specs/features/model/05-tracking-control/validation.md`](../05-tracking-control/validation.md) 的对应条目）。

## 验证清单（Scorecard）

| # | 检查项 | 方法 | 通过标准 | 关联需求 |
|---|---|---|---|---|
| V-1 | `build_all` 一键构建成功 | 自动（`build_all`） | `em_field_check.slx` / `em_track_sim.slx` 均构建落盘，构建末尾编译验证（`SimulationCommand','Update'`）无报错 | FR-7 |
| V-2 | [1] 4 m 长直道中心附近数值解 vs 无限长解析解（式 [(5.5)](../02-magnetic-field/requirements.md#eq-5-5)） | 自动（`sc_field`） | ρ ∈ [2, 20] cm（0.02:0.01:0.20）最大相对误差 < 2% | FR-2, FR-8 |
| V-3 | [2] B ∝ 1/ρ 反比衰减 | 自动（`sc_field`） | ρ = 0.05 m / 0.10 m 场值比值 ≈ 2，abs(ratio−2) < 0.02 | FR-2, FR-8 |
| V-4 | [9] 直线段闭式解（式 [(5.2)](../02-magnetic-field/requirements.md#eq-5-2)）vs 教材公式（式 [(5.3)](../02-magnetic-field/requirements.md#eq-5-3)） | 自动（`sc_field`） | 相对误差 < 1e-12（机器精度；场点 (0.5, 0.3, 0.075)，垂直距离含 z） | FR-2, FR-8 |
| V-5 | [10] 贴线锚点标定自洽（式 [(6.2)](../03-sensor-model/requirements.md#eq-6-2)–[(6.4)](../03-sensor-model/requirements.md#eq-6-4)）/ 线性缩放 / cosθ 方向性 | 自动（`sc_field`） | 贴线 3.25 mm 回收 6 V 相对误差 < 0.05%；电流 2× → 读数严格 2×（< 1e-6）；敏感轴绕 y 转 60° → 读数精确 0.5×（< 1e-6） | FR-3, FR-8 |
| V-6 | [slx] `em_field_check` 开环模型 U(e) vs 解析解（式 [(5.5)](../02-magnetic-field/requirements.md#eq-5-5)） | 自动（`sc_field`，需先 `build_all`） | L2/R2（横向感 Bx；L1/R1 感 By，无限长直导线上 By≡0）在 ρ ∈ [2, 20] cm 最大相对误差 < 2%；模型未构建则 FAIL 并提示先运行 `build_all` | FR-7, FR-8 |
| V-7 | (a) 电机一阶滞后阶跃响应（式 [(8.7)](../05-tracking-control/requirements.md#eq-8-7)） | 自动（`sc_tracking`） | dt = 5 ms、τ = 30 ms 时 t = τ 处 v 达阶跃量 1−1/e ≈ 63.2%（误差 < 1e-12）；τ = 0（alpha = 0）瞬时跟随 | FR-4, FR-8 |
| V-8 | (b) 直道初始扰动收敛完赛（参考实现，Pcoef = −1） | 自动（`sc_tracking`） | e₀ = +50 mm：status = finished 且 t ∈ [1, 3.5] s 窗口内最大 |x| < 30 mm（对齐 JS 侧 selfcheck-tracking；末段为导线端点外区域，Err 失真属物理现象不作判据） | FR-4, FR-8 |
| V-9 | (c) 闭环圆角矩形赛道一圈完赛（式 [(8.10)](../05-tracking-control/requirements.md#eq-8-10)，Pcoef = −1） | 自动（`sc_tracking`） | status = finished 且 |行驶弧长 − 单圈总长| < 0.05 m | FR-4, FR-8 |
| V-10 | (d) `em_track_sim` 与纯 MATLAB 参考实现 `em_simulateTracking` 逐步一致 | 自动（`sc_tracking`，需先 `build_all`） | 同一 S 弯赛道与扰动（e₀ = 30 mm、ψ₀ = 5°，Pcoef = −1）：max|Δx| < 1e-6 m、max|Δy| < 1e-6 m、max|ΔErr| < 1e-4（弯心振荡段对 ulp 噪声敏感），参考状态 finished | FR-4, FR-7, FR-8 |
| V-11 | `runAll` 汇总 | 自动 | sc_field + sc_tracking 全部 PASS 打印"全部通过"；任一失败 error 结束（batch 退出码非 0） | FR-8 |
| V-12 | 演示出图三入口 | 人工 | `plot_field_heatmap` / `plot_sweep` / `plot_trajectory` 各产出对应 PNG 至 `outputs/`，图面内容符合各自约定（见下"人工验证步骤"） | FR-9 |
| V-13 | 与 JS 侧同参数结果一致性抽查 | 人工 | 同赛道、同扰动、同参数（Pcoef = −1）下，MATLAB 循迹轨迹/误差曲线与 JS 侧循迹仿真导出（轨迹 CSV，接口②）形态与量级一致（如同条赛道完赛、Err 收敛形态相同；无须逐点相等） | FR-10, TC-4 |

## 自动化验证

在 MATLAB 中执行：

```matlab
cd('E:\study\Electromagnetism\matlab-simulink')
build_all        % V-1：双模型构建 + 编译通过
runAll           % V-2 ~ V-11：全部自检（磁场/电感 + 循迹闭环 + 模型对参考一致性）
```

或批处理（任一自检不通过时 error 结束，退出码非 0）：

```
matlab -batch "cd('E:\study\Electromagnetism\matlab-simulink'); runAll"
```

判据：`runAll` 汇总打印"全部通过"；任一 `[FAIL]` 即不通过。注意自检 [slx] 项与 (d) 项要求模型已构建——先 `build_all` 再 `runAll`。

## 人工验证步骤

1. **热力图（V-12a）**：`plot_field_heatmap('track_loop_rounded')` → 预期 `outputs/heatmap_track_loop_rounded.png` 生成；图中 |B| 沿赛道中线呈亮带、随距离衰减，白色中线叠加正确，标题含赛道名/观测高度 75 mm/电流 100 mA。
2. **全程扫描（V-12b）**：`plot_sweep('track_s_curve', 0, 0)` → 预期 `outputs/sweep_track_s_curve.png` 生成；4 条 U(s) 曲线（L1/R1 实线、L2/R2 虚线）在 S 弯两弯处呈左右对称的峰谷交替，e = 0、ψ = 0 时 L1/R1 曲线重合度高。
3. **循迹四联图（V-12c）**：`plot_trajectory('track_s_curve', 30, 5)`（内部已置 Pcoef = −1）→ 预期 `outputs/tracking_track_s_curve.png` 生成；轨迹自初始扰动收敛贴合中线并完赛，Err(t) 收敛至 0 附近，轮速不越限幅 [0, 2.0] m/s，各电感 U(t) 量级合理。
4. **JS 一致性抽查（V-13）**：在 em-field-studio 中以同赛道（S 弯）、同扰动（e₀ = 30 mm、ψ₀ = 5°）、同默认参数跑循迹仿真并导出轨迹 CSV；与 `plot_trajectory` 四联图对照——预期轨迹形态、Err 收敛过程、完赛行为一致（量级层面，非逐点一致；逐点一致性已由 V-10 在 MATLAB 内部对参考实现保证）。
5. **改参数冒烟**：`P = params; P.kp = 0.8; P.tauS = 0.05; init('track_loop_rounded', P); sim('em_track_sim');` → 预期无需重建模型即可跑通，`simlog` 落 base 工作区。

## 回归检查

- 本功能为平行移植，**不得改动 `em-field-studio/` 任何代码**；JS 侧既有行为（三组自检 `npm run selfcheck` / `selfcheck:measured` / `selfcheck:tracking` 与 `npm run build`）保持全绿（见 [`specs/features/ui/08-packaging-release/validation.md`](../../ui/08-packaging-release/validation.md)）。
- MATLAB 注释中的"式 (x.y)"编号必须与 specs/features/01~05 保留的原编号一致，**禁止重编号或改写公式**；引用归档文档时按 SDD 映射改写（数§4→`01-track-geometry`、数§5→`02-magnetic-field`、数§6→`03-sensor-model`、数§8→`05-tracking-control`、数§10.1→各 feature validation.md）。
- `params` 默认 `Pcoef = +1`（忠实式 [(8.1)](../05-tracking-control/requirements.md#eq-8-1) 原文）不得改为 −1；负反馈约定靠 `runAll` / `plot_trajectory` 内置置 −1 维持，该约定不得移除（移除则 V-8/V-9/V-10 必挂）。
- `em_track_sim` 中 /dt、/W 两处除法不得改回 1/x 增益（破坏 V-10 的逐 bit 一致性，TC-7）。
- 改参数只经 `params.m`（唯一参数来源）+ `init` 注入；不得向模型内硬编码参数。
