# Phase 1: 赛道几何模型与铺设编辑 — 实现计划

> 本规约为已实现功能的回溯文档化（棕地逆向，2026-09-30 依据归档设计文档补齐）。

## 目标

建立赛道中线的参数化几何模型（直线/圆弧段序列、式 [(4.1)](requirements.md#eq-4-1)[(4.2)](requirements.md#eq-4-2) 笔尖递推、双套离散化、闭环吸合、形状工具）与对应的铺设编辑交互（鼠标铺设、圆弧工具、闭环勾选、转角刻度、赛道库），作为"赛道几何 → 磁场分布 → 电感响应 → 循迹控制"模型链条的第一环。本规约同时是**全局坐标系与符号约定的家**（原《数学模型.md》§3 全文收录于 [`requirements.md`](requirements.md)）。

## 背景与依据

- 关联宪章：[`specs/mission.md`](../../mission.md) 愿景（模型链条第一环"赛道几何"）与范围内条目"电磁赛道的准静磁场建模与可视化"；[`specs/techstack.md`](../../techstack.md) 硬性约束 1（SI 单位内部计算）、2（`src/mathmodel/` 纯计算层）、3（appState schema 纪律——闭环标志随 v5 加入）与测试策略（物理正确性自检，非单元测试框架）。
- 前置条件：无（Phase 1 为模型链条起点）。几何核心与 Python 遗留存档 `track_model/track.py` 物理一致（JS 版 2026-07-24 起取代 Python 版）。
- 下游依赖本功能：02-magnetic-field（电流元/闭式直线段来自 `buildElements()`/`buildFieldElements()`）、03-sensor-model（中线采样 `samplePath()` 作车体位姿参考）、05-tracking-control（`createNearestSeeker()` 局部最近点查询、闭环"仅一圈"判据输入）。

## 任务分组（Task Groups）

### Group 1: 段序列几何核心与坐标系约定（实际实现：2026-07-24 初版落地）
- [x] 全局坐标系与符号约定（世界系/车体系，原《数学模型.md》§3）
- [x] SegDef/TrackDef 段序列表示（line/arc，`absAngle`/`exitAngle` 可选字段）
- [x] 笔尖位形递推 `advancePen()`/`trackTip()`（式 [(4.1)](requirements.md#eq-4-1)[(4.2)](requirements.md#eq-4-2)）
- [x] 离散化 `buildElements()`（MAX_DS = 1 cm）与中线采样 `samplePath()`（5 mm 步进）/`pointAtLength()`
- [x] 场计算专用 `buildFieldElements()`（直线段闭式积分不切碎、圆弧 ≤1 cm 离散）——后续演进，不晚于 2026-08-12 文档拆分（其时自检 [9] 已在验证直角区域闭式解达机器精度）

### Group 2: 形状工具与铺设编辑交互（实际实现：2026-07-24 初版落地）
- [x] 形状工具 `rightAngleSeg()`/`hexagonSegs()`/`lineSegTo()`
- [x] TrackEditor 鼠标铺设：直线连线（10 mm 顶点吸附、CAD 风格动态输入）、圆弧段参数化（半径/圆心角/转向 + 虚影预览）
- [x] 编辑方式 Tab（鼠标铺设 / 段列表只读查看）、撤销一段 / 清空重铺、段长标注开关
- [x] 赛道库（localStorage 独立 key）与赛道 JSON 导出/导入
- [x] 计算状态显示（离散电流元段数 / 网格单元数 / 赛道总长 / 上次重算耗时）

### Group 3: 闭环赛道（实际实现：2026-08-02 设计并当日落地，appState v4→v5）
- [x] `TrackDef.closed` 闭环标志与式 [(4.3)](requirements.md#eq-4-3) 闭环条件（CLOSE_SNAP_M = 20 mm，`closureGapM()`/`canCloseTrack()`）
- [x] 闭环勾选 UI（实时显示终点距起点距离，≤ 20 mm 可勾选、超出置灰提示；勾选后段被改超阈值自动取消闭环）
- [x] 闭环离散化自动补吸合段、中线采样形成闭合回路、总长 = 单圈长度
- [x] 闭环赛道循迹仿真仅生成一圈轨迹（与 05-tracking-control 终止条件式 [(8.10)](../05-tracking-control/requirements.md#eq-8-10) 联动）
- [x] 赛道 JSON 携带闭环标志 closed

### Group 4: 转角刻度与局部最近点查询（实际实现：2026-08-03 设计并当日落地）
- [x] `cornerRulers()`：转角顶点判定（相邻段切向夹角 > 5°）与两侧 300 mm 标尺（短段截断、圆弧侧切线直标尺、闭环含吸合处顶点）
- [x] FieldCanvas 转角刻度叠加层与画布右下角开关（默认开、会话内不持久化）
- [x] `createNearestSeeker()` 连续轨迹 O(窗口) 局部最近点查询与有符号横向偏差（供 05-tracking-control 一键整定目标函数式 [(8.11)](../05-tracking-control/requirements.md#eq-8-11) 逐点评价）

## 实现顺序与依赖

Group 1 → Group 2 → Group 3 → Group 4。Group 2 的铺设推进 / 虚影预览 / 段长摘要复用 Group 1 的 `advancePen()`/`trackTip()`/`segmentLength()`；Group 3 依赖 Group 1 的 `trackTip()`（`closureGapM()`），并向下游 05-tracking-control 提供 `closed` 输入；Group 4 依赖 Group 1 的段几何与 Group 3 的闭环吸合顶点。2026-08-12 文档拆分时代码由 `src/physics/` 迁建 `src/mathmodel/track.ts`（数学模型层单独维护），无行为变化。

## 风险与取舍

- **双套离散化**（`buildElements()` vs `buildFieldElements()`）：渲染 / 路径采样 / 段数展示统一用 ≤1 cm 离散，场计算对直线段改走闭式积分（[`specs/features/02-magnetic-field/requirements.md`](../02-magnetic-field/requirements.md) 式 [(5.2)](../02-magnetic-field/requirements.md#eq-5-2)）——以两份几何推进代码为代价换取直线段零离散误差（自检 [9] 达双精度机器量级 ~10⁻¹⁴）；圆弧段无简单闭式解，保持 ≤1 cm 离散（相对闭式解误差 < 0.1%）。
- **尖角近似，排除圆角过渡建模**（假设 3）：真实电磁线转弯处最小弯曲半径约 0.25 mm ≪ 1 cm 离散粒度与 ≥ 2 cm 典型探测距离；自检 [5] 验证尖角与 0.5 mm 圆角过渡的场值差异 < 0.1%，故折线顶点按理想尖点建模，不引入圆角段类型（判据见 [`specs/features/02-magnetic-field/validation.md`](../02-magnetic-field/validation.md)）。
- **环岛一律为正六边形，排除圆形环岛**（TrackEditor 头注释约定）：竞赛环岛由直边构成；`hexagonSegs()` 以入环边偏转 30°（无贴边）+ 末边 `exitAngle` 恢复入环航向，实现"直线—顶点—绕环一周—顶点—直线"的真实环岛接线，周长 = 6a 由自检 [6] 验证。
- **段列表只读**：段序列修改只经鼠标铺设（撤销/清空）或导入 JSON，段列表 Tab 不提供编辑入口，避免双编辑入口的状态一致性问题。
- **转角刻度开关不持久化**（会话内状态、默认开）：视图偏好不污染工作状态存档；与之相对，段长标注等编辑/铺设工具状态随 appState 持久化（见 [`specs/features/07-persistence-export/requirements.md`](../07-persistence-export/requirements.md)）。
- 各组实现日期推断自原《程序设计说明.md》§8 修改记录（2026-07-24 初版、2026-08-02 闭环、2026-08-03 转角刻度）与原《数学模型.md》§11 修改记录（2026-08-12 文档拆分）。
