# Phase 3: 电感响应模型 — 验证

> ✅ 全部自动化验证已实现并随代码通过；人工验证步骤供每次涉及本功能的改动后复查。判据与归档设计文档自检表一致（原"数学模型.md §10.1"）。

## 验证清单（Scorecard）

| # | 检查项 | 方法 | 通过标准 | 关联需求 |
|---|---|---|---|---|
| V-1 | 贴线锚点标定自洽 | `npm run selfcheck`（selfcheck [10] a/b） | 20 m 直导线闭式解贴线点 B_touch ≈ 6.154 μT，反推 k 回代读数 = 锚点 6 V（偏差 < 1e-9）；`kFromAnchor(6)` ≈ 9.75×10⁵ V/T，与闭式反推相对差 < 0.05%（无限长近似，端部修正可忽略） | FR-2, FR-3 |
| V-2 | 读数随电流线性缩放 | `npm run selfcheck`（selfcheck [10] c） | k 固定，I = 100 → 200 mA 同点读数严格 2×（偏差 < 1e-9） | FR-1, FR-3 |
| V-3 | cosθ 方向性 | `npm run selfcheck`（selfcheck [10] d） | 同一 B 场下敏感轴绕垂直于 B 的轴转 60°，读数比 = cos60° 精确等于 0.5（偏差 < 1e-9） | FR-1, FR-4 |
| V-4 | 全程扫描曲线形态 | `npx tsx scripts/model/test-sweep.ts` | [A] 8 m 直道（e = ψ = 0）：中段（2–6 m，排除端部效应）各电感波动 < 1%，感 By 主对（L1/R1）读数恒 0（直导线无纵向分量）；8 m 扫描耗时 < 300 ms。[B] 1 m 直线 + 90° 弧（r = 0.5 m）+ 1 m 直线：弯道区特征起伏（摆幅最强曲线 max/min > 1.3），峰值位于弯道附近（700–2100 mm） | FR-8 |
| V-5 | 默认布局与恢复默认 | 人工操作 | 顶栏"恢复默认"后电感布局 = FR-5 默认 4 电感表（L1/R1/L2/R2，y = 80 mm，h = 75 mm），与工作区 `archive/presets/sensor-layout.json` 等价 | FR-5 |
| V-6 | ψ 符号约定回归 | `npm run selfcheck:tracking`（[6] 朝向约定回归） | 式 [(6.9)](requirements.md#eq-6-9) 约定全过：含 θ 连续累积超 ±π 与 S 弯逐步重建一致性 | FR-7, FR-14 |
| V-7 | 位姿滑块与数值键入 | 人工操作 | 拖 s/e/ψ 滑块车框与读数实时刷新、方向符合约定；点数值键入精确值，越界钳位到滑块量程 | FR-11 |
| V-8 | 标定 Vpp 调整 | 人工操作 | 拖 5–7 V 滑块，反推 k 显示同步更新、各电感读数随 Vpp 线性缩放；当前值可键入 | FR-12 |
| V-9 | 布局增删改与 JSON 互逆 | 人工操作 | 增 / 删 / 改即时生效于读数与画布叠加；导出布局 JSON → 改乱布局 → 导入后完全还原 | FR-13 |

## 自动化验证

在 `em-field-studio/` 下执行：

- `npm run selfcheck` —— 物理正确性自检全部通过，其中 selfcheck [10]（电感标定审计）覆盖 V-1 / V-2 / V-3：标定自洽 < 0.05%、严格 2× 线性缩放、cosθ 方向性精确 0.5。
- `npm run selfcheck:tracking` —— 其中 [6] 朝向约定回归覆盖 V-6（式 [(6.9)](requirements.md#eq-6-9)，含 θ 连续累积超 ±π 与 S 弯逐步重建一致性）。
- `npx tsx scripts/model/test-sweep.ts` —— 扫描形态自检覆盖 V-4（直道中段恒定 / 弯道特征起伏 / 耗时 < 300 ms；该脚本不进 `npm run selfcheck`，须单独运行）。
- `npm run build` —— 类型检查 + 构建通过（改 `src/model/` 任何公式 / 默认值后，三组自检 + build 全过才可回填规约状态标记，见 [`specs/techstack.md`](../../../techstack.md) 测试策略）。

## 人工验证步骤

1. `npm run dev` 启动（或使用已发布 exe），铺设一条含直道与弯道的赛道。
2. **位姿滑块（V-7）**：右侧"车体位姿"区选"手动位姿"。拖 s 滑块（量程 0–全长 mm）——画布车框沿中线移动、电感读数剖面图同步刷新；拖 e 滑块（±250 mm）——车框相对中线横移，e > 0 向右偏；拖 ψ 滑块（±30°）——车框偏转，ψ > 0 向右（顺时针）偏。点击 s/e/ψ 当前值直接键入精确数字（如 e 键入 −120），失焦/Enter 提交生效；键入越界值（如 e 键入 999）被钳位到 ±250。
3. **标定 Vpp（V-8）**：拖"标定 Vpp"滑块（5–7 V）——旁显反推 k 同步更新（6 V 时 k ≈ 9.75×10⁵ V/T），各电感读数随 Vpp 线性缩放；点击当前值可键入精确 Vpp（越界钳位 5–7）。
4. **布局编辑（V-9 / V-5）**：在"电感布局"分区标题栏点 +添加——新电感出现在读数剖面与画布叠加（按真实 Ø6 mm 绘制）；修改某电感的名称 / 车体系 x / y / h / 敏感轴预设（含 custom 自定义轴向量）——读数与剖面图即时更新；删除电感——对应曲线与叠加消失。点标题栏"导出"保存布局 JSON；随意改乱布局后"导入"该 JSON——布局完全还原。点顶栏"恢复默认"——布局回到 FR-5 默认 4 电感。
5. **跟随仿真轨迹（V-6 联动）**：开启循迹仿真后将位姿来源切到"跟随仿真轨迹"——s/e/ψ 变为只读、由轨迹位姿经 `nearestOnPath()` 反算显示，车框朝向在弯道处正确（不镜像反转）；循迹未开启或无有效轨迹时该选项置灰提示（完整交互约定见 `specs/features/model/05-tracking-control/`）。

## 回归检查

- 不改磁场计算（`specs/features/model/02-magnetic-field/`，式 [(5.1)](../02-magnetic-field/requirements.md#eq-5-1)[(5.2)](../02-magnetic-field/requirements.md#eq-5-2)[(5.5)](../02-magnetic-field/requirements.md#eq-5-5)）与赛道几何（`specs/features/model/01-track-geometry/`）：`computeB` / 路径采样接口签名不变。
- 默认布局电感名 L1/R1/L2/R2 被默认误差公式引用（[`specs/features/model/05-tracking-control/requirements.md`](../05-tracking-control/requirements.md) 式 [(8.1)](../05-tracking-control/requirements.md#eq-8-1)）——布局改名或删减时误差公式须可解析或回退，不得产生 NaN 轨迹。
- 电感布局、车体位姿（含 poseSource / trajT）、标定 Vpp 的 appState v6 持久化字段兼容（`specs/features/ui/07-persistence-export/`）：旧存档无损加载，非法字段逐字段回退默认值，绝不崩溃。
- 实测数据源下无数据通道回退仿真公式 [(6.1)](requirements.md#eq-6-1) 且通道名加 `*` 标注（`specs/features/model/04-measured-data-model/`）。
- 循迹闭环读数链路不受影响：Err 计算所用电感值仍是车体在仿真轨迹实际位姿处按式 [(6.1)](requirements.md#eq-6-1) 读到的值（`specs/features/model/05-tracking-control/`）。
