# Phase 12: 仿真器架构分层 — 验证

> 新增自检脚本 `em-field-studio/scripts/model/selfcheck-sim.ts`（`npm run selfcheck:sim`，Node/tsx 直跑 `src/model/`）；脚本内编号 [1]–[4] 依次对应 V-1 / V-2 / V-3 / V-5（V-4 = 既有三组自检 + 构建，不在脚本内）。基线生成脚本 `scripts/model/gen-tracking-baseline.ts` 已于重构前运行一次（Group 0，基线 commit 5d263d47），产物 `scripts/model/fixtures/tracking-baseline.json` 入库。**2026-10-01 全部自动化项实测通过：V-1 逐点偏差 = 0（位精确一致）。**

## 验证清单（Scorecard）

| # | 检查项 | 方法 | 通过标准 | 关联需求 |
|---|---|---|---|---|
| V-1 | 回归等价性（`Simulator.runToEnd()` vs 重构前基线） | 自动化 `selfcheck:sim`（脚本 [1]） | 基线 fixture `scripts/model/fixtures/tracking-baseline.json`（重构前 `simulateTracking()` 生成，含直道收敛 + S 弯两场景（均非闭环，与 selfcheck-tracking [4]/[6]b 同构）：`runToEnd()` 轨迹 t/x/y/θ/vL/vR/err/sensorU **逐点一致**，最大偏差 < 1e-12（2026-10-01 实测 = 0，位精确一致）；status / steps / distM / finishIndex 完全一致 | FR-4, FR-6, TC-5 |
| V-2 | 多速率调度正确性 | 自动化 `selfcheck:sim`（合成测试：物理步长 1 ms + 控制周期 5 ms） | (a) 1000 个 tick 内控制任务触发**恰好 200 次**；(b) 零阶保持：相邻触发之间的 4 个 tick 沿用同一指令（`WheelCommand` 引用/数值不变）；(c) 整数 µs 时间轴：仿真 1000 s（1e6 tick）后时钟读数严格 = 1e9 µs、第 k 次触发时刻严格 = 5k ms，无浮点漂移；(d) 过期合并：`periodMs < dtSim` 误配时每 tick 至多触发一次且不补触发 | FR-2, TC-1 |
| V-3 | FormulaController 等价性 | 自动化 `selfcheck:sim` | 同一读数序列喂给 `FormulaController.step()` 与直调 `compileFormula()`+`pdOutput()`+`wheelSpeeds()` 内联序列，逐步 `WheelCommand`（vLCmd/vRCmd/err）完全一致（== 或 < 1e-12）；含首步 errRate=0、分母零回退上一步误差、限幅 [0, vMax] 三个边界 | FR-1 |
| V-4 | 既有三组自检 + 构建 | 自动化 | `npm run selfcheck`、`npm run selfcheck:measured`、`npm run selfcheck:tracking`（调用点不动的兼容薄壳）全过；`npm run build` 类型检查 + 构建通过 | FR-6, TC-5 |
| V-5 | 一键调 PID 迁移等价 | 自动化 `selfcheck:sim` | 固定赛道/参数下 `runAutoTuneSync()` 与重构前 `runAutoTune` 记录的参考结果（同基线 fixture 一并固化）选出的 (Kp, Kd) 完全一致；候选评估总数 = 13×11 + 81；生成器逐候选 yield 的进度计数单调递增至 total | FR-5 |

## 自动化验证

在 `em-field-studio/` 下执行（[`specs/techstack.md`](../../../techstack.md) 测试策略）：

| 命令 | 判据 |
|---|---|
| `npm run selfcheck:sim`（新增） | 上述 V-1 / V-2 / V-3 / V-5 全部 PASS，进程退出码 0（末行输出"仿真器架构分层自检全部通过 ✓"） |
| `npm run selfcheck`、`npm run selfcheck:measured`、`npm run selfcheck:tracking` | 既有三组自检全过（动 `src/model/` 后的硬性要求；`selfcheck:tracking` 调用点不变即兼容薄壳的回归防护） |
| `npm run build` | 类型检查 + 构建通过 |
| `npm run lint` | 不新增任何问题（2026-10-01 实测 27 problems / 18 errors 全部为 `components/ui/*` 等 Phase 12 前既有遗留；本 Phase 顺带修复了 Home.tsx 的 2 个 `_dropped` 未用变量 error 与 1 个失效 eslint-disable） |
| `npx tsx scripts/model/gen-tracking-baseline.ts` | **仅重构动刀前运行一次**（Group 0，已执行并提交），产物提交后不再重跑——重跑会失去"重构前基线"语义 |

## 人工验证步骤

1. **快进模式回归**：`npm run dev` 启动，铺设含弯道的闭环赛道（或种子矩形闭环），打开循迹开关 → 轨迹线/车框/电感位置与重构前一致；拖动 Kp 滑块或改误差公式 → 约 200 ms 防抖重算，Err(t)/轮速(t)/摘要同步刷新；对照重构前截图/导出 CSV，轨迹形状无肉眼差异。
2. **一键调 PID 回归**：点"⚙ 一键调 PID"→ 进度百分比正常推进、期间 UI 可操作；结束后最优 Kp/Kd 自动填入并触发重算；调整 Kp≤/Kd≤/内收≤ 重跑结果随之变化；与重构前同一赛道的结果一致。
3. **导出回归**：顶栏"导出"→ 循迹轨迹 CSV，列格式/注释行/行数与重构前一致（接口② 契约不变）。
4. **实时模式**：切到实时模式 → 运行后画布逐帧看到小车沿轨迹行驶；暂停/继续/重置可用；0.25×/0.5×/1×/2×/4× 倍速播放流畅；终止（冲线/失控）后自动停在末帧并显示摘要。
5. **实时 vs 快进一致**：同一赛道/参数下，实时模式跑完的轨迹与快进模式轨迹重合（叠加无肉眼偏差），结果摘要（状态/用时/弧长/步数）一致。
6. **持久化不动**：刷新页面后循迹参数/量程/位姿来源保留（appState v6 语义不变）；实时模式的播放中/倍速状态不持久化（刷新后回到默认停止态），旧 v6 存档加载不崩溃。

## 回归检查

- **等价搬移纪律**：V-1 容差 < 1e-12 且预期为 0；若出现非零偏差，先排查重构是否改动了浮点运算顺序/记录时机/首步语义，不得放宽容差了事。
- **基线 fixture 时效**：`tracking-baseline.json` 由重构前代码生成并随 Group 0 提交；后续 Phase 若合法改动数值行为（如新增物理模型），须同步重生成基线并在 CHANGELOG 记明——基线只锁"本次重构等价"，不锁永恒。
- **兼容薄壳不被绕过**：`simulateTracking()` 必须保持签名与 `TrackingResult` 结构；`scripts/model/selfcheck-tracking.ts`、`matlab-simulink/` 注释引用、CSV 导出链路均以此为锚，改动须同步复核 Phase 5 验证（[`05-tracking-control/validation.md`](../05-tracking-control/validation.md)）。
- **模型层纯净**：`src/model/sim/` 不得 import React/DOM/`setTimeout`——`npm run build` 之外，review 时 grep 确认；一键调 PID 的让出逻辑只许出现在 UI 侧驱动循环。
- **朝向与读数约定**：读数采样器收敛后，ψ 符号约定（式 [(6.9)](../03-sensor-model/requirements.md#eq-6-9)）与"仿真源/实测源回退 + `*` 标注"策略行为不变——`selfcheck:tracking` [6] 与 Phase 4 验证继续生效，采样器不得引入第二份实现。
- **终止判据语义**：闭环一圈/非闭环 +0.5 m/失控判停/步数上限/NaN 判失控逐项沿用式 [(8.10)](../05-tracking-control/requirements.md#eq-8-10)；控制器不上报 err 时失控判停退化语义（仅 NaN/步数上限）须有注释与自检覆盖。
- **appState 兼容**：`APP_STATE_VERSION` 保持 6，旧存档无损加载（[`specs/techstack.md`](../../../techstack.md) 硬性约束 3）。
