# model —— 模型层（纯计算，无 UI）

本目录是程序的**模型层**，与前端层（`src/ui/`，可视化/交互）分域维护：2026-08-12 由 `src/physics/` + `src/sensors/measured.ts` 合并迁建为 `src/mathmodel/`，2026-10-01 随两层物理迁移改现名并收编数据源抽象 `sources.ts`。

- **设计规约**：`specs/features/model/`（SDD 体系，各模块落点见下表；公式、符号约定、默认值以代码为准回填规约）。
- 原设计基准双文档已于 2026-09-30 归档至 `archive/docs/legacy/`，仅供查证；本文出现的"式 (x.y)"编号与各 feature 规约中保留的原编号一致。

## 模块

| 文件 | 内容 | 规约落点 |
|---|---|---|
| `track.ts` | 赛道几何：段序列 → 离散电流元 / 路径采样 / 闭环吸合 / 形状工具 / 转角刻度 / 局部最近点 | specs/features/model/01-track-geometry/（式 (4.x)） |
| `field.ts` | 磁场计算：毕奥-萨伐尔分段积分 + 直线段闭式解 + 网格批算 | specs/features/model/02-magnetic-field/（式 (5.x)） |
| `sensor.ts` | 电感响应模型：U = k·\|B·n̂\|、贴线标定 k、敏感轴、车体位姿变换 | specs/features/model/03-sensor-model/（式 (6.x)） |
| `sweep.ts` | 全程扫描：固定 e/ψ 的 U(s)（仿真 / 实测两版） | specs/features/model/03-sensor-model/ |
| `measured.ts` | 实测数据经验模型：CSV 导入、方案A 拟合、方案B 物理公式+偏差校正 | specs/features/model/04-measured-data-model/（式 (7.x)） |
| `control.ts` | 误差公式（可编辑表达式解析）+ PD + 差速轮速分配 + 电机一阶滞后 motorLag | specs/features/model/05-tracking-control/（式 (8.1)–(8.7)） |
| `kinematics.ts` | 两轮差速运动学 + `simulateTracking()` 兼容薄壳（转调 Simulator.runToEnd） | specs/features/model/05-tracking-control/（式 (8.8)–(8.11)） |
| `sim/` | 仿真器子层：Simulator 门面 / 多速率调度器 / Vehicle / CarController 接口 / 一键调 PID / WASM 控制器宿主与 ABI | specs/features/model/12-simulator-architecture/、13-wasm-controller/ |
| `sources.ts` | 采集数据源抽象（仿真可用；串口预留；文件已实现指引性 stub） | specs/features/model/04-measured-data-model/ |

## 维护约定

- 本层**不依赖任何 UI / React / DOM / localStorage**（techstack 硬性约束 2），须可在 Node 中直接运行（`scripts/model/` 自检即如此）；前端层可 import 本层，反向禁止。
- 修改本层的公式、默认值、参数后：① 跑 `npm run selfcheck` / `selfcheck:measured` / `selfcheck:tracking`（涉及仿真器/WASM 时加跑 `selfcheck:sim` / `selfcheck:wasm`）；② 回填对应 feature 规约（上表落点）的 requirements.md，并在 `CHANGELOG.md` 登记。
