# Phase 8: 打包发布与自检体系 — 验证

> ✅ 已实现。关联 [`plan.md`](plan.md) / [`requirements.md`](requirements.md)。

## 验证清单（Scorecard）

| # | 检查项 | 方法 | 通过标准 | 关联需求 |
|---|---|---|---|---|
| V-1 | 三组自检全过 | 自动：`npm run selfcheck`、`npm run selfcheck:measured`、`npm run selfcheck:tracking` | 三条命令均跑完且全部判据通过（FR-3 总览表各行） | FR-2, FR-3, TC-6 |
| V-2 | 附加测试全过 | 自动：`npx tsx scripts/test-<名>.ts` 逐个运行 5 个 test-* 脚本 | appstate / state-restore / sweep / corner / worker 全部通过 | FR-2 |
| V-3 | 构建通过 | 自动：`npm run build` | `tsc -b` 类型检查无错、dist 构建产出成功 | FR-2, TC-6 |
| V-4 | 自检覆盖完整性 | 文档核对：FR-3 总览表对照归档《数学模型.md》§10.1 | 11 行自检项逐行一致（验证内容/对照基准/容差判据），无删减、无放宽；各行"判据细节见"指向对应 feature validation.md | FR-3 |
| V-5 | 打包流程可复现 | 按 [`BUILD-EXE.md`](../../../../em-field-studio/BUILD-EXE.md) 标准流程在本机执行（须经用户确认，TC-1） | `release/` 产出便携版 exe；三坑均有对策（离线 electronDist / EPERM 手工组装 / 7z+finish-portable 两步） | FR-4, TC-2, TC-3, TC-4 |
| V-6 | 打包后 exe 启动人工核对 | 双击工作区根 `电磁场建模仿真工具 0.1.0.exe` | 窗口出现（1440×900）；赛道可铺设；磁场热力图出图 | FR-5, FR-7 |
| V-7 | screenshot.cjs 场景目检 | `node_modules/.bin/electron.cmd scripts/screenshot.cjs` 截取默认 / 最长数据源选项 / 双栏收起 / 窄窗口 1280×800 四种场景 | 四张截图逐一目检无文字溢出、无布局破坏 | FR-6 |
| V-8 | 发布流程合规性 | 流程核对：本次发布是否有用户明确同意；发布记录（修改记录 / 对话）可查 | 未经用户确认不产生新 exe；确认后产物覆盖工作区根旧版、中间产物已清理、产物已上传 GitHub Releases | FR-1, FR-5, TC-1 |

## 自动化验证（自检命令与判据）

在 `em-field-studio/` 下执行（Node 脚本经 tsx 运行）：

```bash
npm run selfcheck              # 物理正确性自检（70 项）：[1] 长直道 vs 式 (5.5) 相对误差 <2%（ρ∈[2,20]cm）；[2] B∝1/ρ；[3][4][6] 离散化与弧长 ≤1cm；[5] 尖角差异 <0.1%；[7] 线径恒等；[8] Tesla 域一致；[9] 闭式解机器精度 ~10⁻¹⁴；[10] 标定自洽 <0.05% / 严格 2× / 精确 0.5
npm run selfcheck:measured     # 实测模型自检：合成数据回收 ±15%、R² > 0.95
npm run selfcheck:tracking     # 循迹闭环自检：全过（含阶跃 63.2%、差速同 τ、含滞后闭环收敛、朝向约定回归）
npx tsx scripts/test-appstate.ts && npx tsx scripts/test-state-restore.ts && npx tsx scripts/test-sweep.ts && npx tsx scripts/test-corner.ts && npx tsx scripts/test-worker.ts   # 附加测试：全过
npm run build                  # 类型检查 + dist 构建：无错
```

判据：以上命令全部退出码为 0、自检脚本末行汇总全过——即 [`specs/techstack.md`](../../../techstack.md) 测试策略规定的"三组自检 + `npm run build` 全过"闸门。各判据细节见对应 feature 的 validation.md（对应关系见 [`requirements.md`](requirements.md) FR-3 总览表）。

## 人工验证步骤

**打包后 exe 核对（每次正式版发布必做，V-6）**：

1. 确认本次发布已经用户明确同意（TC-1），按 [`BUILD-EXE.md`](../../../../em-field-studio/BUILD-EXE.md) 完成打包并复制产物到工作区根；
2. 双击 `E:\study\Electromagnetism\电磁场建模仿真工具 0.1.0.exe`——预期：单窗口出现，尺寸 1440×900，标题「智能车电磁赛道磁场建模工具」；
3. 在画布上铺设若干段赛道（直线/圆弧）——预期：赛道线正常绘制、段长标注正常；
4. 观察中央画布——预期：磁场热力图正常出图（场计算进度推进至完成），悬停探针有读数。

**UI 截图目检（界面改造后必做，V-7）**：

1. 先 `npm run build` 确保 dist 为最新；
2. 依次运行 screenshot.cjs 截取四种场景：默认（`default`）、最长数据源选项（`measured`）、双栏收起（`default` + `collapse`）、窄窗口（宽 1280 高 800）；
3. 逐一目检截图——预期：无文字溢出选项框、无布局破坏（2026-08-15 面板 UI 改造的验证方式）。

**发布合规核对（V-8）**：核对修改记录/对话中本次发布有用户明确同意的记录；预览版阶段（未经确认）不存在新产出的 exe。

## 回归检查

- 自检命令集合与判据不得缩水：任何 feature 变更不得删除或放宽 FR-3 总览表对应行（公式/默认值变更须同步更新对应 feature 规约并保持自检通过，见 [`specs/techstack.md`](../../../techstack.md) 硬性约束 2 与 TC-6）；
- `npm run dist:win` 仍须经用户确认后才可执行（TC-1），两阶段发布流程不因任何改动绕过；
- Electron 主进程安全约定不回归：`contextIsolation` 开、`nodeIntegration` 关、单窗口加载 `dist/index.html`（TC-5）；
- 打包流程或产物路径变更须先改 [`BUILD-EXE.md`](../../../../em-field-studio/BUILD-EXE.md) 与本规约三件套，再动流程（SDD 防漂移，见根目录 [`AGENTS.md`](../../../../AGENTS.md) 工作规则）；
- 产物落点不变：正式版 exe 固定复制到工作区根 `电磁场建模仿真工具 0.1.0.exe` 覆盖旧版，发布毕清理 `release/` 中间产物（FR-5）。
