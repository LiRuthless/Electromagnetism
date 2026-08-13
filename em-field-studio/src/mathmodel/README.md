# mathmodel —— 数学模型层（纯计算，无 UI）

本目录是程序的**数学模型层**，与界面/交互代码分离维护（2026-08-12 由 `src/physics/` + `src/sensors/measured.ts` 合并迁建）。

- **设计基准文档**：`E:\study\Electromagnetism\数学模型.md`（公式、符号约定、默认值以代码为准回填文档）。
- **人机交互部分**（赛道编辑、界面、图表、持久化等）见 `E:\study\Electromagnetism\程序设计说明.md`。

## 模块

| 文件 | 内容 | 文档落点 |
|---|---|---|
| `track.ts` | 赛道几何：段序列 → 离散电流元 / 路径采样 / 闭环吸合 / 形状工具 / 转角刻度 / 局部最近点 | 数学模型.md §4 |
| `field.ts` | 磁场计算：毕奥-萨伐尔分段积分 + 直线段闭式解 + 网格批算 | 数学模型.md §5 |
| `sensor.ts` | 电感响应模型：U = k·\|B·n̂\|、贴线标定 k、敏感轴、车体位姿变换 | 数学模型.md §6 |
| `sweep.ts` | 全程扫描：固定 e/ψ 的 U(s)（仿真 / 实测两版） | 数学模型.md §6.5 |
| `measured.ts` | 实测数据经验模型：CSV 导入、方案A 拟合、方案B 物理公式+偏差校正 | 数学模型.md §7 |
| `control.ts` | 误差公式（可编辑表达式解析）+ PD + 差速轮速分配 + 电机一阶滞后 motorLag | 数学模型.md §8.2/§8.3/§8.4 |
| `kinematics.ts` | 两轮差速运动学 + 循迹闭环轨迹仿真主循环（含电机滞后状态量） | 数学模型.md §8.5 |

## 维护约定

- 本层**不依赖任何 UI / React / localStorage**；仅 `track.ts`/`sweep.ts` 等为上层提供数据，数据源接口 `src/sensors/sources.ts` 属于交互层。
- 修改本层的公式、默认值、参数后：① 跑 `npm run selfcheck` / `selfcheck:measured` / `selfcheck:tracking`；② 回填 `数学模型.md` 对应小节与修改记录。
