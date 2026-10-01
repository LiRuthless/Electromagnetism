# Phase 8: 打包发布与自检体系 — 需求

> ✅ 已实现。关联 [`plan.md`](plan.md)；归档来源：[`archive/docs/legacy/程序设计说明.md`](../../../archive/docs/legacy/程序设计说明.md) §7、[`archive/docs/legacy/数学模型.md`](../../../archive/docs/legacy/数学模型.md) §10.1、[`em-field-studio/BUILD-EXE.md`](../../../em-field-studio/BUILD-EXE.md)。

## 功能需求

- **FR-1（两阶段发布流程，✅ 2026-08-03 起生效）**：每次程序更新分两阶段，先预览、确认后再打 exe——
  1. **预览版**：改完代码后只做 `npm run build`（或直接 `npm run dev` / 本地静态预览 dist），**不打包 exe**，交用户确认效果；
  2. **正式版**：用户明确同意后，才按 [`BUILD-EXE.md`](../../../em-field-studio/BUILD-EXE.md) 流程打 Windows 便携版 exe，产物复制到工作区根覆盖旧版。

- **FR-2（命令与自检体系）**：`em-field-studio/` 下提供下列命令（完整定义见"接口约定"npm scripts 表）：

  | 命令 | 作用 |
  |---|---|
  | `npm run dev` | Vite 开发服务器 |
  | `npm run build` | 类型检查 + 构建 dist（预览版到这一步为止，FR-1） |
  | `npm run dist:win` | electron-builder 打 Windows 便携版（本机离线打包的坑与完整流程见 [`BUILD-EXE.md`](../../../em-field-studio/BUILD-EXE.md)；**须经用户确认后执行**） |
  | `npm run selfcheck` | 物理正确性自检（70 项，判据总览见 FR-3） |
  | `npm run selfcheck:measured` | 实测模型自检（CSV 解析、方案A 拟合回收、方案B 偏差插值、横向距离符号，判据总览见 FR-3） |
  | `npm run selfcheck:tracking` | 循迹闭环自检（公式解析、轮速分配、电机一阶滞后、运动学、直道收敛、闭环一圈完赛、朝向约定回归，判据总览见 FR-3） |
  | `scripts/test-*.ts` | 附加测试：appState 持久化（含 v6 字段）、尖角、状态恢复、扫描（适配新布局）、Worker |

- **FR-3（自动化自检总览，✅）**：验证体系分两层——**自动化自检**（本表，解析解对照 + 数值自洽 + 回归防护）与**假设回环**（自检与实验对建模假设的闭环确认，"自检判对错、实验定边界"，见各 feature validation.md 与 [`specs/research/2026-08-13-experiment-modeling.md`](../../research/2026-08-13-experiment-modeling.md)）。自检总览表如下（式编号为各 feature 规约保留的原编号；**各项判据细节见对应 feature 的 validation.md**）：

  | 自检 | 验证内容 | 对照基准 | 容差 / 判据 | 判据细节见 |
  |---|---|---|---|---|
  | selfcheck [1] | 4 m 长直道中心附近数值解 | 式 [(5.5)](../02-magnetic-field/requirements.md#eq-5-5) 解析解 | 相对误差 < 2%（ρ ∈ [2,20] cm） | [`specs/features/02-magnetic-field/validation.md`](../02-magnetic-field/validation.md) |
  | selfcheck [2] | B ∝ 1/ρ 衰减 | 相邻半径比 | ≈ 反比 | [`specs/features/02-magnetic-field/validation.md`](../02-magnetic-field/validation.md) |
  | selfcheck [3][4][6] | 弯道/十字/六边形离散化与弧长 | 几何真值（半圆 = πR 等） | 有限、非零、≤ 1 cm | [`specs/features/01-track-geometry/validation.md`](../01-track-geometry/validation.md) |
  | selfcheck [5] | 尖角近似（假设 3） | 0.5 mm 圆角过渡 | 场值差异 < 0.1% | [`specs/features/02-magnetic-field/validation.md`](../02-magnetic-field/validation.md) |
  | selfcheck [7] | 有限线径恒等（假设 2） | 安培环路定理 | 恒等 | [`specs/features/02-magnetic-field/validation.md`](../02-magnetic-field/validation.md) |
  | selfcheck [8] | 8 m 直道逐电感读数 | 解析解 | Tesla 域一致 | [`specs/features/03-sensor-model/validation.md`](../03-sensor-model/validation.md) |
  | selfcheck [9] | 直角区域闭式解（式 [5.2](../02-magnetic-field/requirements.md#eq-5-2)） | 真值 | 机器精度 ~10⁻¹⁴ | [`specs/features/02-magnetic-field/validation.md`](../02-magnetic-field/validation.md) |
  | selfcheck [10] | 标定自洽（式 [6.3](../03-sensor-model/requirements.md#eq-6-3)/[6.4](../03-sensor-model/requirements.md#eq-6-4)）、线性缩放、cosθ 方向性 | 解析反推 | < 0.05% / 严格 2× / 精确 0.5 | [`specs/features/03-sensor-model/validation.md`](../03-sensor-model/validation.md) |
  | selfcheck:measured | CSV 解析（BOM/分号/单位）、方案A 回收（式 [7.2](../04-measured-data-model/requirements.md#eq-7-2)–[7.4](../04-measured-data-model/requirements.md#eq-7-4)）、方案B 偏差插值（式 [7.7](../04-measured-data-model/requirements.md#eq-7-7)）、d 符号（式 [7.1](../04-measured-data-model/requirements.md#eq-7-1)） | 合成数据 | 回收 ±15%、R² > 0.95 | [`specs/features/04-measured-data-model/validation.md`](../04-measured-data-model/validation.md) |
  | selfcheck:tracking | 公式解析（式 [8.1](../05-tracking-control/requirements.md#eq-8-1)）、轮速分配（式 [8.3](../05-tracking-control/requirements.md#eq-8-3)–[8.5](../05-tracking-control/requirements.md#eq-8-5)）、电机一阶滞后（式 [8.6](../05-tracking-control/requirements.md#eq-8-6)/[8.7](../05-tracking-control/requirements.md#eq-8-7)：阶跃 63.2%、差速同 τ 跟随、含滞后闭环收敛）、运动学（式 [8.9](../05-tracking-control/requirements.md#eq-8-9)）、直道收敛、闭环吸合与一圈完赛（式 [8.10](../05-tracking-control/requirements.md#eq-8-10)）、朝向约定回归（式 [6.9](../03-sensor-model/requirements.md#eq-6-9)） | 解析/几何真值 | 全过 | [`specs/features/05-tracking-control/validation.md`](../05-tracking-control/validation.md) |
  | scripts/test-* | appState 持久化、状态恢复、扫描形态、Worker | — | 全过 | [`specs/features/07-persistence-export/validation.md`](../07-persistence-export/validation.md)、[`specs/features/02-magnetic-field/validation.md`](../02-magnetic-field/validation.md) |

- **FR-4（本机离线打包标准流程，✅）**：按 [`BUILD-EXE.md`](../../../em-field-studio/BUILD-EXE.md) 五步执行——① `npm run build` 构建 web 端；② `electron-builder --win portable -c.compression=store -c.electronDist=<本机缓存 zip>` 打包 win-unpacked（rename EPERM 时走 ②b 手工接管）；③ `electron-builder --prepackaged release/win-unpacked --win portable` 生成 7z 归档（约 5 分钟，被杀后 7z 仍已落盘）；④ `python scripts/extract-nsi.py` 从 builder-debug.yml 提取 portable.nsi，`node scripts/finish-portable.cjs` 复现 makensis 调用组装最终 exe；⑤ 复制产物到工作区根并清理中间产物。

- **FR-5（打包产物落点，✅）**：最终产物为 `E:\study\Electromagnetism\电磁场建模仿真工具 0.1.0.exe`（约 90 MB，单文件便携版），每次发布复制覆盖工作区根旧版；发布毕清理 `release/` 中间产物（win-unpacked、win-unpacked.tmp、*.7z、builder-debug.yml、portable*.nsi、0-messages.nsh）。`-c.compression=store` 只影响 win-unpacked 阶段的临时产物；最终 exe 体积由第 ③ 步的 7z 正常压缩决定（约 90 MB）。**发布渠道（2026-10-01 起）**：产物同时上传 GitHub Releases（exe 不进 git，走 Releases 附件，规避 GitHub 单文件 100MB 限制）；不再保留本地旧版备份（原 `backup/` 做法废止）。

- **FR-6（UI 离屏截图目检工具，✅ 2026-08-15）**：`scripts/screenshot.cjs` 用项目自带 Electron 离屏窗口加载 dist 构建产物并截图，用于面板/界面改造的逐场景目检（用法签名见"接口约定"）；依赖 dist 已构建（先 `npm run build`），截图前等待场计算完成；每次运行独立 userData，互不污染持久化状态。

- **FR-7（Electron 主进程约定，✅）**：`electron/main.cjs` 单窗口 1440×900，加载 `dist/index.html`，`contextIsolation` 开、`nodeIntegration` 关。

## 技术约束

- **TC-1（发布闸门，不可协商）**：打 exe 必须经用户明确同意——对应 [`specs/techstack.md`](../../techstack.md) 硬性约束 4；未经确认只出预览版（build/dev/静态预览 dist），不执行 `npm run dist:win` 或 [`BUILD-EXE.md`](../../../em-field-studio/BUILD-EXE.md) 任何打包步骤。
- **TC-2（完全离线打包）**：本机 GitHub 直连超时（2026-07-24 实测 `connect ETIMEDOUT`），electron-builder 不得走默认在线下载；须以 `-c.electronDist=` 指向本机缓存压缩包：`C:\Users\Li\AppData\Local\electron\Cache\0622c5b5b51ab3180f02f5370d555559fd4865e1757af5b2d5583806f774c12f\electron-v43.2.0-win32-x64.zip`。
- **TC-3（EPERM 手工组装）**：杀毒软件实时扫描锁定刚解压的 Electron 目录，electron-builder 的 rename 必现 `EPERM`；对策为手动 `cp -r win-unpacked.tmp win-unpacked`，组装 `resources/app`（dist + electron + package.json，并把 electron.exe 改名为 `电磁场建模仿真工具.exe`），然后用 `--prepackaged` 跳过打包阶段。
- **TC-4（300s 限制拆分）**：7z 正常压缩约 5 分钟，单次 Bash 300s 前台跑不完；先单独让 electron-builder 生成 `release/my-app-0.1.0-x64.nsis.7z`（超时被杀也没关系，7z 写完即落盘），再用 `scripts/finish-portable.cjs` 复现 makensis 调用组装最终 exe。
- **TC-5（Electron 安全）**：`contextIsolation` 开、`nodeIntegration` 关，单窗口加载 `dist/index.html`——对应 [`specs/techstack.md`](../../techstack.md) 硬性约束 6，打包产物与开发态一致。
- **TC-6（自检闸门）**：改 `src/mathmodel/` 任何公式/默认值/参数后，三组自检 + `npm run build` 全过才可回填规约状态标记（[`specs/techstack.md`](../../techstack.md) 测试策略）；测试策略为物理正确性自检 + 数值自洽 + 回归防护，**不引入单元测试框架**。

## 接口约定

### npm scripts（`em-field-studio/package.json`，定义与作用对照）

| 命令 | 定义 | 作用 |
|---|---|---|
| `npm run dev` | `vite` | Vite 开发服务器（预览） |
| `npm run build` | `tsc -b && vite build` | 类型检查 + 构建 dist（预览版到此为止） |
| `npm run preview` | `vite preview` | 本地静态预览 dist |
| `npm run dist:win` | `npm run build && electron-builder --win portable` | 打 Windows 便携 exe——必须经用户确认后执行，本机离线流程见 [`BUILD-EXE.md`](../../../em-field-studio/BUILD-EXE.md) |
| `npm run lint` | `eslint .` | 代码规范检查 |
| `npm run selfcheck` | `tsx scripts/selfcheck.ts` | 物理正确性自检（70 项，FR-3 前 8 行） |
| `npm run selfcheck:measured` | `tsx scripts/selfcheck-measured.ts` | 实测模型自检 |
| `npm run selfcheck:tracking` | `tsx scripts/selfcheck-tracking.ts` | 循迹闭环自检 |

### 脚本落点（`em-field-studio/scripts/`）

| 文件 | 用途 | 验证对象 / 关联 feature |
|---|---|---|
| `selfcheck.ts` | 物理正确性自检 selfcheck [1]–[10] | 01-track-geometry / 02-magnetic-field / 03-sensor-model |
| `selfcheck-measured.ts` | 实测模型自检 | 04-measured-data-model |
| `selfcheck-tracking.ts` | 循迹闭环自检 | 05-tracking-control |
| `test-appstate.ts` | appState 持久化（含 v6 字段），运行：`npx tsx scripts/test-appstate.ts` | 07-persistence-export |
| `test-state-restore.ts` | 状态恢复 | 07-persistence-export |
| `test-sweep.ts` | 扫描形态（适配新布局） | 03-sensor-model |
| `test-corner.ts` | 尖角 | 01-track-geometry / 02-magnetic-field |
| `test-worker.ts` | 磁场网格 Worker | 02-magnetic-field |
| `screenshot.cjs` | UI 离屏截图目检（FR-6） | 06-ui-charts-panels |
| `extract-nsi.py` | 从 builder-debug.yml 提取 portable.nsi（打包第 ④ 步） | 本 feature |
| `finish-portable.cjs` | 复现 makensis 调用组装最终 exe（打包第 ④ 步） | 本 feature |

### screenshot.cjs 用法签名

```
node_modules/.bin/electron.cmd scripts/screenshot.cjs <out.png> [宽] [高] [default|measured|none|种子.json] [scroll|collapse]
```

- 代码默认：宽 1600、高 950、variant `default`；
- 变体：`default`＝演示矩形闭环赛道 + 循迹开启（仿真源）；`measured`＝数据源切"实测物理+偏差 · 方案B"（最长选项，验证 Select 截断）；`none`＝不注入种子；`<path.json>`＝自定义 app-state 种子 JSON（`version` 须与 `APP_STATE_VERSION` 匹配，当前 v6，见 [`specs/features/07-persistence-export/requirements.md`](../07-persistence-export/requirements.md)）；
- 第 6 参数：`scroll`＝面板滚底；`collapse`＝双栏收起；
- 依赖 dist 已构建；截图前固定延时等待场计算完成；每次运行独立 userData（临时目录），互不污染。

### 打包产物与中间产物路径

- 最终产物：`E:\study\Electromagnetism\电磁场建模仿真工具 0.1.0.exe`（约 90 MB，覆盖旧版）；
- 构建输出：`em-field-studio/dist/`（web 端）、`em-field-studio/release/`（打包中间产物与最终 exe 的工作目录）；
- 中间产物（发布毕清理）：`release/win-unpacked`、`release/win-unpacked.tmp`、`release/*.7z`（`my-app-0.1.0-x64.nsis.7z`）、`release/builder-debug.yml`、`release/portable*.nsi`、`release/0-messages.nsh`；
- 手工组装的 `resources/app` 内容：`dist/` + `electron/` + `package.json`，且 `electron.exe` 改名为 `电磁场建模仿真工具.exe`；
- Electron 主进程落点：`electron/main.cjs`（单窗口 1440×900、标题「智能车电磁赛道磁场建模工具」、隐藏菜单栏、`loadFile(dist/index.html)`、`contextIsolation: true`、`nodeIntegration: false`）。

## 非目标（Non-goals）

- 不制作安装包（NSIS installer 等）——发布形态仅 portable 单文件 exe；不做自动更新机制。
- 不打非 Windows 平台包（electron-builder 目标固定 `--win portable`）。
- 不引入单元测试框架（自检脚本体系即测试策略，见 TC-6）。
- 不含实车实验的执行与数据采集——实验手册属 [`specs/research/2026-08-13-experiment-modeling.md`](../../research/2026-08-13-experiment-modeling.md)（🧪 待用户实操），实验数据经 `specs/features/07-persistence-export` 接口①–④进入模型。
