# mathmodel —— 数学模型层（纯计算，无 UI）

本目录是程序的**数学模型层**，与界面/交互代码分离维护（2026-08-12 由 `src/physics/` + `src/sensors/measured.ts` 合并迁建）。

- **设计规约**：`E:\study\Electromagnetism\specs\features\`（SDD 体系，各模块落点见下表；公式、符号约定、默认值以代码为准回填规约）。
- 原设计基准双文档已于 2026-09-30 归档至 `docs/legacy/`，仅供查证；本文出现的"式 (x.y)"编号与各 feature 规约中保留的原编号一致。

## 模块

| 文件 | 内容 | 规约落点 |
|---|---|---|
| `track.ts` | 赛道几何：段序列 → 离散电流元 / 路径采样 / 闭环吸合 / 形状工具 / 转角刻度 / 局部最近点 | specs/features/01-track-geometry/（式 (4.x)） |
| `field.ts` | 磁场计算：毕奥-萨伐尔分段积分 + 直线段闭式解 + 网格批算 | specs/features/02-magnetic-field/（式 (5.x)） |
| `sensor.ts` | 电感响应模型：U = k·\|B·n̂\|、贴线标定 k、敏感轴、车体位姿变换 | specs/features/03-sensor-model/（式 (6.x)） |
| `sweep.ts` | 全程扫描：固定 e/ψ 的 U(s)（仿真 / 实测两版） | specs/features/03-sensor-model/ |
| `measured.ts` | 实测数据经验模型：CSV 导入、方案A 拟合、方案B 物理公式+偏差校正 | specs/features/04-measured-data-model/（式 (7.x)） |
| `control.ts` | 误差公式（可编辑表达式解析）+ PD + 差速轮速分配 + 电机一阶滞后 motorLag | specs/features/05-tracking-control/（式 (8.1)–(8.7)） |
| `kinematics.ts` | 两轮差速运动学 + 循迹闭环轨迹仿真主循环（含电机滞后状态量） | specs/features/05-tracking-control/（式 (8.8)–(8.11)） |

## 维护约定

- 本层**不依赖任何 UI / React / localStorage**；仅 `track.ts`/`sweep.ts` 等为上层提供数据，数据源接口 `src/sensors/sources.ts` 属于交互层。
- 修改本层的公式、默认值、参数后：① 跑 `npm run selfcheck` / `selfcheck:measured` / `selfcheck:tracking`；② 回填对应 feature 规约（上表落点）的 requirements.md，并在 `CHANGELOG.md` 登记。
