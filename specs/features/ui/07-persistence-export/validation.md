# Phase 7: 持久化与数据接口 — 验证

## 验证清单（Scorecard）

| # | 检查项 | 方法 | 通过标准 | 关联需求 |
|---|---|---|---|---|
| V-1 | appState 保存 → 读取往返一致（含 v6 字段 floatingCharts / trackingRanges） | `npx tsx scripts/test-appstate.ts` [A] 组 | 各字段 PASS（trackDef / params / sensors / pose / vppAnchor / sourceKind / 开关 / arcPending / view / floatingCharts / trackingRanges 全一致），退出码 0 | FR-1, FR-2, FR-3 |
| V-2 | 版本不符（版本 +1、无版本字段）→ null；JSON 损坏 / 关键结构非法（sensors 非数组、非法段定义）→ null | `npx tsx scripts/test-appstate.ts` [B][C] 组；`npx tsx scripts/test-state-restore.ts` 第 1/3/4 项 | `loadAppState()` 返回 null，回退全默认，绝不崩溃，退出码 0 | FR-5, TC-1 |
| V-3 | 非关键字段非法只回退该字段默认值，不整体失败 | `npx tsx scripts/test-appstate.ts` [D] 组 | 仍返回状态；vppAnchor 回退 6、sourceKind 回退 simulation、component 回退 bz、非法 view 回退 null | FR-5 |
| V-4 | 状态恢复完整往返（空存储 → null；保存后逐字段恢复） | `npx tsx scripts/test-state-restore.ts` | 末行输出"全部通过：状态可以完整保存并恢复"，退出码 0 | FR-1, FR-5 |
| V-5 | "恢复默认"只清工作状态 key，赛道库不受影响 | `npx tsx scripts/test-appstate.ts` [E] 组 | `clearAppState()` 后 app-state 已清除，`em-field-studio/track-library` 内容不变 | FR-7, FR-8 |
| V-6 | 防抖 300 ms 自动保存 | 人工 | 改动任一状态后约 0.3 s 内写入 localStorage；刷新页面后状态完整恢复 | FR-4 |
| V-7 | 六项导出文件格式核对 | 人工（见下） | 各文件列/表头注释/BOM 与 [`requirements.md`](requirements.md) 导出表一致；JSON 导出 → 导入互逆 | FR-9, TC-4, TC-5 |
| V-8 | panel-layout 独立 key 行为 | 人工 | 拖拽调宽后刷新保持；手动改坏该 key 只回退默认宽度、工作状态不丢；该 key 无版本号 | FR-6, TC-2 |
| V-9 | 接口① 导入链路 | 引用 [`specs/features/model/04-measured-data-model/validation.md`](../../model/04-measured-data-model/validation.md)（selfcheck:measured 与人工导入核对） | 标定状态随 appState 持久化（刷新后仍在） | FR-10 |
| V-10 | 接口② 循迹轨迹 CSV 与接口④ 约定同构 | 人工列核对 | 列序 `t,x,y,θ,v_L,v_R,Err,各电感U` 与接口④ 约定一致，可作对照基准 | FR-11, FR-13 |

## 自动化验证

在 `em-field-studio/` 下执行：

```bash
npx tsx scripts/test-appstate.ts        # appState 持久化（含 v6 字段）
npx tsx scripts/test-state-restore.ts   # 状态恢复
npm run build                           # 类型检查 + 构建
```

判据：两个 test 脚本退出码均为 0——test-appstate 末行输出"持久化模块测试全部通过 ✓"（[A] 往返一致 / [B] 版本不匹配 → null / [C] 损坏 JSON 与非法结构 → null / [D] 非关键字段逐字段回退 / [E] clearAppState 只清工作状态 key 五组全 PASS）；test-state-restore 末行输出"全部通过：状态可以完整保存并恢复"。`npm run build` 无类型错误。

## 人工验证步骤

1. `npm run dev` 启动程序。
2. **自动保存与恢复**：铺设赛道、改物理参数、移动电感、拖动画布视图、开启循迹并改参数；等待约 0.5 s 后刷新页面——预期全部状态（含位姿来源/轨迹进度/左侧栏收起/浮动图位置尺寸/自定义滑块量程）完整恢复。
3. **损坏回退**：DevTools → Application → Local Storage 中把 `em-field-studio/app-state` 值改为乱码或把 `version` 改为 999，刷新——预期程序回退全默认正常启动，**不崩溃**。
4. **恢复默认**：点顶栏"恢复默认"并确认——预期工作状态全部重置（电感布局回默认 4 电感），赛道库条目仍在，面板宽度不变。
5. **面板宽度 key**：拖拽左/右面板边缘调宽后刷新——预期宽度保持；把 `em-field-studio/panel-layout` 值改为乱码后刷新——预期只回退默认面板宽度，工作状态完好。
6. **导出核对**（逐项导出后用 Excel / 文本编辑器打开）：
   - 磁场网格 CSV：Excel 打开中文表头注释不乱码（BOM 生效）；首列 `x(mm),y(mm),h(mm),Bx(uT),By(uT),Bz(uT),|B|(uT)`；注释行含赛道名/电流/观测高度/网格步长/赛道总长/网格原点/分辨率/导出时间。
   - 电感读数 CSV：列 `name,x_body(mm),y_body(mm),h(mm),axis_x,axis_y,axis_z,U(Vpp)`；行数 = 当前电感数；注释含位姿 e/ψ 与标定 k。
   - 全程扫描 CSV：首列 `s(mm)`，其后每电感一列 `<电感名>_U(Vpp)`；注释含 e/ψ/电流/扫描步长；行数与扫描采样一致。
   - 画布 PNG：图像与当前画布视图一致（热力图/等值线/赛道线/车体叠加）。
   - 赛道 JSON：含 `name`/`segments`（闭环赛道含 `closed: true`）；重新导入后赛道形状与闭环标志一致（互逆）。电感布局 JSON：电感数组，重新导入后布局一致。
   - 循迹轨迹 CSV：列 `t(s),x(m),y(m),theta(rad),v_L(m/s),v_R(m/s),Err,<电感名>_U(Vpp),…`，逐时间步一行；注释含结果状态/步数/用时/弧长/公式与全部循迹参数；与接口④ 约定列序同构（V-10）。
7. **接口① 持久化**：导入实测标定 CSV（实验 6 格式）后刷新页面——预期标定状态（数据集 + 拟合结果）仍在，数据源选择保持（详见 [`specs/features/model/04-measured-data-model/validation.md`](../../model/04-measured-data-model/validation.md)）。

## 回归检查

- 三组自检保持通过：`npm run selfcheck` / `npm run selfcheck:measured` / `npm run selfcheck:tracking`（判据见各对应 feature 的 validation.md）；
- `APP_STATE_VERSION` 保持 6——任何结构变更须先按 TC-1 升版本并同步本规约；
- 赛道库、面板宽度布局不被"恢复默认"清除（V-5 / 人工步骤 4–5）；
- 接口① 实测标定导入（Phase 4）、循迹轨迹 CSV 导出（Phase 5）、浮动图表状态（Phase 6）等上游功能行为不因本功能改动而变化；
- 接口③④ 维持纯文件级约定：不新增 localStorage 字段、不改变 `APP_STATE_VERSION`。
