# Phase 2: 磁场计算与网格调度 — 验证

> 关联 [`requirements.md`](requirements.md)（FR-1～FR-9 / TC-1～TC-6）。本文件同时是**全模型"假设回环"总述的家**（原《数学模型.md》§10.2 迁入本文件末尾）。

## 验证清单（Scorecard）

| # | 检查项 | 方法 | 通过标准 | 关联需求 |
|---|---|---|---|---|
| V-1 | 长直道解析对照（selfcheck [1]） | `npm run selfcheck` | 4 m 长直道中心附近（h = 7 cm）数值解 vs 式 [(5.5)](requirements.md#eq-5-5) 解析解，ρ ∈ [2, 20] cm 相对误差 < 2%；解析解自洽 < 1e-9 | FR-2, FR-5 |
| V-2 | B ∝ 1/ρ 衰减（selfcheck [2]） | `npm run selfcheck` | 相邻半径 B 之比 ≈ ρ 反比，逐档偏差 < 2% | FR-5 |
| V-3 | 尖角近似（selfcheck [5]，假设 3） | `npm run selfcheck` | 尖角折线 vs 0.5 mm 圆角过渡，转角附近探测距离 ≥ 2 cm 的 40 个采样点场值最大差异 < 0.1% | FR-1（假设 3） |
| V-4 | 有限线径恒等（selfcheck [7]，假设 2） | `npm run selfcheck` | d = 0.5 mm 圆截面导线外部场与同轴细线电流严格相同（安培环路定理，差异恒等于 0；r = 2 cm ≫ 线半径） | FR-1（假设 2） |
| V-5 | 8 m 直道逐电感审计（selfcheck [8]） | `npm run selfcheck` | 有限长导线解析解 vs 引擎逐电感对比（Tesla 域）：各电感误差 < 1%；By 无纵向串扰（≈ 0）；e = 0 时 L1/R1、L2/R2 对称（< 0.1%）；宽对读数符合解析值（< 1%）；主对（感 By）直道上读数恒 0 | FR-2, FR-3 |
| V-6 | 直角区域闭式解机器精度（selfcheck [9]） | `npm run selfcheck` | L 形场模型 = 2 条闭式直线段 + 0 离散元；尖角顶点周围 24 点最大相对误差 < 1e-9（式 [(5.2)](requirements.md#eq-5-2) 闭式路径达双精度机器量级 ~10⁻¹⁴）；角平分线镜像对称 < 1e-9；臂中段 vs 无限长解析解 < 5%（有限长端部修正 + 另一臂贡献） | FR-3, FR-4 |
| V-7 | Worker 协议（scripts/model/test-worker） | `npx tsx scripts/model/test-worker.ts` | 场景 A：进度消息 ≥ 3 条且严格单调递增，最终结果到达，与主线程 `computeGrid` 抽样一致（maxDiff < 1e-12）；场景 B：连续双请求时旧请求被协作式中止（无 result）、新请求完成（有 result） | FR-8, TC-4 |
| V-8 | 网格上限降档 | 人工操作（见人工验证步骤 3） | 网格单元数超 160k 时自动降档到 5 mm 整数档，"计算状态"提示实际生效步长；不超上限时按所选步长（5/10/20 mm）出图 | FR-7, TC-3 |
| V-9 | 看门狗与主线程兜底 | 代码审查 + 人工操作（见人工验证步骤 4） | Worker 10 s 无进展 / 报错 / Worker API 不可用时自动降级主线程同步计算，场必出图，状态置 `fallback` 并 console.warn 留痕 | FR-9, TC-4 |

> selfcheck [3][4][6]（弯道/十字/六边形离散化与弧长、正六边形几何）属 [`specs/features/model/01-track-geometry/validation.md`](../01-track-geometry/validation.md)；selfcheck [10]（标定自洽 / 线性缩放 / cosθ 方向性）属 [`specs/features/model/03-sensor-model/validation.md`](../03-sensor-model/validation.md)。

## 自动化验证

在 `em-field-studio/` 下执行：

| 命令 | 判据 |
|---|---|
| `npm run selfcheck` | 场相关项 [1][2][5][7][8][9] 全部 PASS（对应 V-1～V-6；完整 70 项含其他 feature 的项，应全过） |
| `npx tsx scripts/model/test-worker.ts` | 场景 A/B 全部 PASS（对应 V-7） |
| `npm run build` | 类型检查 + 构建通过 |

改 `src/model/field.ts` 任何公式 / 常量（I_DEFAULT、R_MIN、MU0）后：三组自检（`selfcheck` / `selfcheck:measured` / `selfcheck:tracking`）+ `npm run build` 全过才可回填状态标记（[`specs/techstack.md`](../../../techstack.md) 测试纪律）。

## 人工验证步骤

1. `npm run dev` 启动；铺设一条含直线与圆弧的赛道——中央画布热力图出图，顶栏显示场计算进度百分比与耗时；左侧"计算状态"分区可见离散电流元段数、网格单元数、赛道总长、上次重算耗时。
2. 调整"物理参数"：电流（20–200 mA）/ 观测平面高度（20–120 mm）/ 网格步长（5/10/20 mm）/ 显示分量（Bz/Bx/|B|）/ 对数色标——每次修改后约 180 ms 防抖，热力图自动重算刷新；快速连续拖动滑块时旧计算被中止（进度随最新请求重新推进、最终图与最终参数一致）。
3. 降档验证：铺设大尺寸赛道（或选 5 mm 步长）使网格单元数超 160k——"计算状态"显示"已自动降档至 X mm"（X 为 5 的整数倍），网格单元数 ≤ 160k。
4. 兜底验证（可结合代码审查）：确认 `useFieldGrid.ts` 中看门狗（WATCHDOG_MS = 10000）/ `onerror` / Worker API 不可用三条路径均汇入 `fallbackCompute()`；预期现象为 console.warn "[field] worker 不可用…"且热力图仍正常出图。
5. 悬停画布探针核对量级（探针属 `specs/features/ui/06-ui-charts-panels/`）：直道旁 20 mm、h = 70 mm、I = 100 mA 处 |B| 应为 μT 量级，并随横向距离增大近似 1/ρ 衰减。

## 回归检查

- 本功能变更不得破坏 Phase 1 赛道几何行为（`buildElements` / `buildFieldElements` 输出结构不变：mids/dls/count/wires）；
- 不得破坏下游：`computeB()` 单点场行为不变（03 电感读数、04 方案B 物理基准、05 循迹读数均直接调用）；
- `npm run selfcheck:measured`、`npm run selfcheck:tracking` 保持全过；其余附加测试（`scripts/ui/test-appstate.ts` / `test-state-restore.ts` / `test-sweep.ts` / `test-corner.ts`）保持全过；
- 网格 CSV 导出（`computeGridFull`，含 By）格式不变（属 `specs/features/ui/07-persistence-export/`）。

## 假设回环

> 本节为全模型四条假设的"自检判对错、实验定边界"回环总述（原《数学模型.md》§10.2 迁入，交叉引用已改写为 specs 体系路径）。假设 1/2/3 的陈述见本目录 [`requirements.md`](requirements.md) FR-1；假设 4（点探头近似）见 [`specs/features/model/03-sensor-model/requirements.md`](../03-sensor-model/requirements.md)。

各 feature validation.md 的自动化自检即四条假设的程序内闭环验证——准静态与细线假设由本文件 V-4（自检 [7]）、V-5（自检 [8]）支撑，尖角假设由 V-3（自检 [5]）支撑，点探头近似由 [`specs/features/model/03-sensor-model/validation.md`](../03-sensor-model/validation.md) 的自检 [10]（方向性与缩放自洽）间接支撑。[`specs/research/2026-08-13-experiment-modeling.md`](../../../research/2026-08-13-experiment-modeling.md) 的实验建模（🧪 待用户实操）从实车侧给出假设的**适用边界**：实验 2 标定准静态线性（假设 1）的成立区间；实验 3 确认投影模型与点探头近似（假设 4）；实验 6 的扫描数据质量综合体现细线/尖角/点探头假设（假设 2/3/4）在实车几何下的适用性；实验 8/9 的偏差量级界定控制律链路（`specs/features/model/05-tracking-control/`）模型的适用工况。假设的回环由此形成"自检判对错、实验定边界"的分工。
