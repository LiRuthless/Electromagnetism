# Phase 10: 实车循迹日志对比视图 — 需求

> ⬜ 骨架（待实验 9 数据到位后访谈补全）。关联 [`plan.md`](plan.md)。

## 功能需求

- FR-1: 用户可导入实车循迹日志 CSV（接口④格式：首行表头 `t, x, y, θ, v_L, v_R, Err, L1, R1, L2, R2`；与接口②仿真导出同构）。
- FR-2: x/y/θ 列缺失时，由 v_L/v_R 按式 [(8.9)](../../model/05-tracking-control/requirements.md#eq-8-9)（见 [`specs/features/model/05-tracking-control/requirements.md`](../../model/05-tracking-control/requirements.md)）离线积分重建位姿。
- FR-3: 仿真轨迹与实车日志按弧长对齐，Err(t)、v_L/v_R(t)、各电感 U(t) 同图叠加，曲线可区分来源（仿真/实车）。
- FR-4: 图表保留统一交互：缩放、浮动化、点击联动（见 [`specs/features/ui/06-ui-charts-panels/requirements.md`](../06-ui-charts-panels/requirements.md)）。
- FR-5: 给出逐弯偏差对照的可观测入口（Err 过零点与各电感峰值位置对应查看）。

## 技术约束

- TC-1: 不改动既有循迹仿真主链路与接口②导出格式。
- TC-2: 解析宽容：缺列/采样率不一致不崩溃，给降级提示。
- TC-3: 实车日志状态**不入 appState 持久化 schema**（沿用接口③④"文件级约定、不影响 `APP_STATE_VERSION`"的既有决定，见 [`techstack.md`](../../../techstack.md) 硬性约束 3）。

## 接口约定

- 输入文件：接口④ CSV（格式见 [`specs/features/ui/07-persistence-export/requirements.md`](../07-persistence-export/requirements.md) 接口表）。
- 建议文件命名：`exp9_循迹日志_YYYYMMDD.csv`，存 `measured-data/`。

## 非目标（Non-goals）

- 不做实时串口采集（Phase 11）。
- 不做自动参数复标定（偏差结论由用户按实验手册判据人工决策，线下回填参数）。
