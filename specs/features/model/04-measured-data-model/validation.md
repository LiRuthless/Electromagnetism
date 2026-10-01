# Phase 4: 实测数据经验模型 — 验证

## 验证清单（Scorecard）

| # | 检查项 | 方法 | 通过标准 | 关联需求 |
|---|---|---|---|---|
| V-1 | CSV 解析：表头识别 / cm→mm 换算 / 通道解析 / 非法行跳过 / 排序 | `npm run selfcheck:measured`（合成 `e_cm,L1,R1,M1`，e_cm ∈ [−25, 25] 步进 5，混入空行与非法行） | 有效点 = 11（非法行已跳过）；通道 = `L1,R1,M1`；e 范围 [−250, 250] mm（cm 已 ×10）；按 eMm 升序；文件名保留 | FR-1 |
| V-2 | 无单位表头回退 | 同上（表头 `偏差,L1`） | 按 cm 处理（×10 换算）且数据集携带 `eUnitNote` 中文标注 | FR-1 |
| V-3 | 方案A 合成数据回收 | 同上（h = 70 mm 的 Lorentzian / \|d\| 形 + 5% 确定性噪声，可复现） | h_eff 回收在 70 mm **±15%** 内；**R² > 0.95**；\|e0\| < 3 mm；L1 拟合峰值 U(0) ≈ 5 V（偏差 < 10%） | FR-3 |
| V-4 | 方案B 偏差插值 | 同上（`evalPhysModel`） | 节点处精确回收实测值（U = U₀ + δ_i = y_i）；节点中点 = 物理基准 + 两侧偏差均值；范围外 = 基准形状外推 + 端点偏差（非钳位 U 值）；无数据通道返回 null | FR-4, FR-5 |
| V-5 | CSV 兼容性 | 同上（BOM + 分号 + `e(mm)` 表头；及仅 2 有效点文件） | BOM/分号正确解析，e(mm) 保持 mm 不换算；有效点 < 3 抛中文错误（"有效采样点不足"） | FR-1 |
| V-6 | 有符号横向距离 d 符号约定 | 同上（4 m 直道沿 +y） | 右侧 (100, 2000) mm → d ≈ +100 mm；左侧 → d ≈ −100 mm（容差 6 mm，含采样插值误差） | FR-2 |
| V-7 | 构建与全量回归 | `npm run build` + 三组自检 | 全部通过 | 全部 |
| V-8 | 🧪 实验 6 数据质量判据（实车侧，待实操） | 按 [`specs/research/2026-08-13-experiment-modeling.md`](../../../research/2026-08-13-experiment-modeling.md) 实验 6 采集接口① CSV 导入 | 方案A 拟合 R² > 0.95（式 [(7.4)](requirements.md#eq-7-4)）；h_eff 回收值接近实际安装高度且落在 [15, 200] mm；方案B 偏差 \|δ\| 峰值 < 读数峰值的 20%；实验散点与同参数仿真全程扫描曲线同图对比，峰值位置与两翼衰减形态一致；不达标重采 | FR-3, FR-4 |

## 自动化验证

在 `em-field-studio/` 下执行：

| 命令 | 判据 |
|---|---|
| `npm run selfcheck:measured` | 全部 PASS：CSV 解析（V-1/V-2/V-5）、方案A 回收 ±15% 且 R² > 0.95（V-3）、方案B 偏差插值三态（V-4）、d 符号（V-6） |
| `npm run build` | 类型检查 + 构建通过 |
| `npm run selfcheck` / `npm run selfcheck:tracking` | 既有两组自检保持全过（本功能不得破坏，见回归检查） |

改 `src/mathmodel/measured.ts` 任何公式/默认值/参数（网格范围 [15,200]×[−40,40]、60 档、有效点阈值 3 等）后：三组自检 + `npm run build` 全过才可回填本规约状态标记（[`specs/techstack.md`](../../../techstack.md) 测试纪律）。

## 人工验证步骤

1. `npm run dev` 启动，铺设一条直道（≥ 2 m）。
2. 右侧"实测数据标定"区导入一份接口① CSV（可用 selfcheck 同款合成格式：`e_cm,L1,R1,M1`）。预期：数据集概况显示文件名、采样点数、e 范围；通道匹配徽章标示有数据/缺失回退；方案A 拟合结果表给出每通道 k / h_eff / e0 / RMSE / R²；方案B 行给出每通道偏差节点数；对比预览图显示实测散点 + 方案A 曲线 + 方案B 曲线（可切换通道、可浮出为浮动窗）。
3. 采集数据源切到"实测拟合 · 方案A"与"实测物理+偏差 · 方案B"：预期读数剖面图与全程扫描图切换为实测模型读数；CSV 中缺失的电感通道读数名加 `*` 标注（回退仿真公式），全程扫描曲线名同步加 `*`。
4. 导入首列为无单位表头（如 `偏差`）的 CSV：预期标定区出现黄色 `eUnitNote` 标注（按 cm 处理 ×10）。
5. 导入通道名与当前电感布局全不匹配的 CSV：预期弹窗提示无通道匹配（数据仍导入，可改电感名后重新匹配）。
6. 数据源保持实测源，重启应用：预期标定状态（数据集 + 拟合结果）与数据源选择恢复（appState 持久化）。
7. 点"清除实测数据"或顶栏"恢复默认"：预期回到仿真模型读数，标定区恢复空态。

## 回归检查

- 数据源为"仿真模型"时，读数剖面、全程扫描、循迹仿真行为与读数不变（式 [(6.1)](../03-sensor-model/requirements.md#eq-6-1)，见 [`specs/features/model/03-sensor-model/validation.md`](../03-sensor-model/validation.md) 与 [`specs/features/model/05-tracking-control/validation.md`](../05-tracking-control/validation.md)）。
- 方案B 基准随电感高度 h、敏感轴、电流 I、标定 k 联动——改动标定 Vpp 或电流后实测物理+偏差读数应相应变化。
- appState `APP_STATE_VERSION = 6` 不变；旧存档（无 `measured` 字段）无损加载（[`specs/features/ui/07-persistence-export/validation.md`](../../ui/07-persistence-export/validation.md)）。
- `npm run selfcheck`、`npm run selfcheck:tracking`、`scripts/test-*` 全部保持通过；`npm run build` 通过。
