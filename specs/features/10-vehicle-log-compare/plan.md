# Phase 10: 实车循迹日志对比视图 — 实现计划

> ⬜ 骨架规约（2026-09-30 随 SDD 体系迁移建立）。本阶段为 roadmap 指定的下一阶段，**前置依赖未满足**：需实验 9 产出的实车循迹日志数据（见 [`specs/research/2026-08-13-experiment-modeling.md`](../../research/2026-08-13-experiment-modeling.md)）。数据到位后按 SDD 流程访谈补全本三件套，再开始实现。

## 目标

导入实车循迹日志 CSV（接口④），与仿真循迹轨迹的 Err(t) / 轮速(t) / 各电感 U(t) 曲线同图叠加对照，支撑模型偏差分析（实验 9 的数据处理环节）。

## 背景与依据

- 关联宪章：[`specs/mission.md`](../../mission.md) 成功标准（仿真与实车偏差区间被实验量化界定）。
- 前置条件：Phase 5（循迹轨迹 CSV 导出，接口② ✅）；实验 9 实车日志（🧪 待实操）。
- 既有约定：接口④ 文件格式与接口② 同构（`t, x, y, θ, v_L, v_R, Err, 各电感 U`；x/y/θ 缺省时由轮速按式 [(8.9)](../05-tracking-control/requirements.md#eq-8-9) 离线积分重建），见 [`specs/features/07-persistence-export/requirements.md`](../07-persistence-export/requirements.md)。

## 任务分组（Task Groups）

### Group 1: 日志导入与对齐
- [ ] 实车日志 CSV 解析（复用/扩展实测 CSV 解析约定）
- [ ] 轮速离线积分重建 x/y/θ（式 [(8.9)](../05-tracking-control/requirements.md#eq-8-9)）
- [ ] 仿真与实车轨迹按弧长对齐

### Group 2: 对比视图
- [ ] Err(t) / 轮速(t) / 各电感 U(t) 仿真-实车曲线叠加（复用 ZoomableChart/FloatingChart 体系）
- [ ] 偏差量级统计与适用工况区间标注

## 实现顺序与依赖

Group 1 → Group 2；不改动既有循迹仿真与导出功能。

## 风险与取舍

- 实车日志采样率/列缺失不确定——解析需宽容（列缺失降级、采样率自适应）。
- 明确排除：实时串口直采（属 Phase 11 `11-serial-source`，本阶段只处理离线 CSV）。
