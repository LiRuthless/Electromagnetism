# Phase 4: 实测数据经验模型 — 实现计划

> 本规约为已实现功能的回溯文档化（棕地逆向，2026-09-30 依据归档设计文档补齐）。

## 目标

导入实车采值 CSV（横向偏差 e vs 各通道 U），用经验模型**替代或修正**仿真公式（`specs/features/03-sensor-model/requirements.md` 式 (6.1)）给出电感读数，供读数剖面、全程扫描与循迹闭环使用。提供两种可切换的经验模型：

- **方案A（fit）**：解析形状最小二乘拟合——以无限长直导线磁场曲线形状（Lorentzian 形 / |d| 形）为基函数拟合每通道 U(d)；
- **方案B（phys）**：物理公式基准 + 偏差校正——以长直导线解析基准为形，只插值实测与公式的偏差。

本功能模型是"实验建模"的直接受益者：其建模输入（实测数据集）由 `specs/research/2026-08-13-experiment-modeling.md` 实验 6 的横向扫描实验提供（🧪 待用户实操）。

## 背景与依据

- 关联宪章：
  - `specs/mission.md` 范围内条目"实测数据经验模型（方案A 拟合 / 方案B 物理+偏差）与 CSV 导入导出"；成功标准"仿真与实车的偏差区间被实验量化界定"（本功能承担偏差修正一环）。
  - `specs/techstack.md`：SI 单位内部计算（硬性约束 1）；`src/mathmodel/` 纯计算层（硬性约束 2）；appState schema 纪律（硬性约束 3，实测标定状态入 `MeasuredState`）。
  - `specs/research/2026-08-13-experiment-modeling.md`：实验 6（横向扫描 U(e)，主实测数据集）约定采集规程与数据质量判据；接口① 文件格式约定见 `specs/features/07-persistence-export/requirements.md`。
- 前置条件：
  - Phase 1（`01-track-geometry`）：`samplePath()` 路径采样点列（signedLateralDistance 的投影对象）；
  - Phase 2（`02-magnetic-field`）：长直导线解析形状（式 (5.5)，方案A 基函数与方案B 基准的理论约束）、`MU0`；
  - Phase 3（`03-sensor-model`）：电感布局与敏感轴（axisPreset）、贴线锚点标定 k（式 (6.4)）、仿真回退公式（式 (6.1)）。

## 任务分组（Task Groups）

### Group 1: CSV 导入解析与数据集结构（2026-07-24 初版随"实测数据标定"落地）
- [x] `parseMeasuredCSV()`：首行表头、首列横向偏差单位识别（cm 自动换算 mm；无法识别按 cm 处理并中文标注）、分隔符自动检测（逗号/分号/制表符）、UTF-8 BOM 兼容、空行/非法行跳过、有效点 < 3 抛中文错误、采样点按 e 升序、只保留有数据的通道
- [x] 数据结构 `MeasuredPoint` / `MeasuredDataset`（含 `eUnitNote` 单位标注）

### Group 2: 方案A 解析形状最小二乘拟合（2026-07-24 初版）
- [x] 拟合形状函数 `fitShape()`：竖直电感 Lorentzian 形 / 横躺电感 |d| 形（式 (7.2)）
- [x] `fitChannelModel()`：h_eff ∈ [15, 200] mm × e0 ∈ [−40, 40] mm 各 60 档网格搜索，内层 k 解析解（式 (7.3)），输出 RMSE / R²（式 (7.4)）
- [x] `evalFitModel()` 求值

### Group 3: 方案B 物理公式基准 + 偏差校正（2026-07-31，替代原 LUT 查表插值）
- [x] `physBaseline()`：长直导线解析基准 U₀(d)（式 (7.5)，含电感高度/敏感轴/电流/标定 k 上下文 `PhysBaselineCtx`）
- [x] `evalPhysModel()`：偏差 δ 分段线性插值、采样范围外钳位端点偏差（仍随 U₀ 物理形状外推）、结果 max(0, ·) 钳位（式 (7.6)(7.7)）；通道无数据返回 null

### Group 4: 有符号横向距离与统一求值/回退（2026-07-24 初版；2026-08-02 起被位姿反算复用）
- [x] `signedLateralDistance()`：电感世界坐标 → 到赛道中线的有符号横向距离 d（式 (7.1)，右正）
- [x] `evalMeasured()` 统一求值接口（fit / phys 两种 `MeasuredModelKind`）
- [x] `sweepMeasuredAlongTrack()`：实测版全程扫描，无数据通道回退仿真公式、通道名加 `*` 标注

### Group 5: UI 集成与持久化（2026-07-24 初版；2026-08-13 接口①汇总；2026-08-15 下拉文案精简）
- [x] 采集数据源下拉 5 种（仿真模型 / 实测拟合(方案A) / 实测物理+偏差(方案B) / 串口(预留) / 文件(已实现)），实测源未导入数据时给黄色提示
- [x] 右侧"实测数据标定"区：导入 CSV / 清除、数据集概况（文件、采样点数、e 范围）、通道匹配徽章（有数据/缺失回退）、方案A 拟合结果表、方案B 偏差节点数、单通道对比预览图（实测散点 + 方案A 曲线 + 方案B 曲线，recharts，可浮出为浮动窗 `measuredFit`）
- [x] 导入入口 `handleImportMeasured`：`parseMeasuredCSV` → 对匹配通道逐通道 `fitChannelModel`（方案A 拟合），方案B 偏差建模随求值自动完成；数据源切 `measured-fit` / `measured-phys` 即生效（读数剖面、全程扫描、循迹读数同步切换）
- [x] 标定状态（`measured`）与数据源（`sourceKind`）随 appState 持久化（`sanitizeMeasured` 逐字段校验回退）

### Group 6: 自动化自检与代码层迁建（自检随功能同步；2026-08-12 迁建）
- [x] `scripts/selfcheck-measured.ts`：CSV 解析（BOM/分号/单位）、方案A 合成数据回收、方案B 偏差插值、d 符号（判据见 validation.md）
- [x] 2026-08-12 文档拆分配套：`src/sensors/measured.ts` 并入 `src/mathmodel/measured.ts`（数学模型层单独维护），构建 + 全部自检通过

## 实现顺序与依赖

Group 1（CSV 解析）→ Group 2 / Group 3（两种模型可并行，均只依赖数据集）→ Group 4（d 换算与统一求值，依赖 Phase 1 路径采样）→ Group 5（UI 集成与持久化，依赖 Phase 3 电感布局/标定 k）；Group 6 自检贯穿各组，2026-08-12 随 `src/mathmodel/` 迁建做回归。

## 风险与取舍

- **被明确排除的方案：方案B 原为纯查表插值（LUT）**，2026-07-31 起改为物理公式基准 + 偏差校正——外推区与稀疏采样区纯查表插值不如物理基准稳健（式 (7.7) 的物理意义解读；LUT 方案取消记录见 `specs/roadmap.md` "已合并/已取消的计划"）。
- **e 列单位无法识别时按 cm 处理**（社区数据多为 cm）——存在误换算风险，以 `eUnitNote` 中文标注在标定区显式提示，由用户核对。
- **方案A 仅 60×60 网格搜索、无迭代细化**——h_eff 回收精度受网格粒度限制，自检判据相应取 ±15%（而非精确回收）；幅值 k 为解析解不受影响。
- **拟合形状按敏感轴二选一**：`x` → |d| 形，`z`/`y`/`custom` 及未知一律 Lorentzian 兜底（`fitShape()`）——纵躺（y 轴）电感用 Lorentzian 是工程近似，实车敏感轴以实验 3 标定为准。
- **单变量建模**：经验模型自变量只有横向距离 d（直道标定形状）；弯道/十字处的形状失真不在模型内修正，由实验 9 偏差分析界定适用范围、可整理后补充方案B 偏差项 δ。
