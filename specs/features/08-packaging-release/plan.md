# Phase 8: 打包发布与自检体系 — 实现计划

> 本规约为已实现功能的回溯文档化（棕地逆向，2026-09-30 依据归档设计文档补齐）。

## 目标

建立"改代码 → 自动化自检 → 预览版确认 → 打 exe 发布"的完整交付闭环：

1. 自动化自检体系：三组物理/模型自检命令 + `scripts/test-*.ts` 附加测试，覆盖数学模型全部公式的解析对照、数值自洽与回归防护（自检总览见 requirements.md FR-3，各判据细节见对应 feature 的 validation.md）；
2. 两阶段发布流程：每次程序更新先出预览版（build/dev）交用户确认，用户明确同意后才打 Windows 便携版 exe；
3. 本机离线打包流程：electron-builder portable 目标 + 本机三坑（GitHub 直连超时 / win-unpacked.tmp EPERM / Bash 300s 限制）的手工对策，产物复制到工作区根覆盖旧版；
4. UI 离屏截图目检工具（screenshot.cjs），支撑界面改造的逐场景截图核对。

本功能主体为 ✅ 已实现（源小节无 🧪/⬜ 条目）。

## 背景与依据

- 关联宪章：
  - `specs/mission.md`——范围内含"Windows 便携版 exe 打包与发布"；成功标准含"全部自动化自检通过（判据见各 feature 的 validation.md）"与"任何设计变更可沿规约 → 代码 → 自检追溯，文档与代码不漂移"；
  - `specs/techstack.md`——硬性约束 4（两阶段发布：改完代码只出预览版，用户明确同意后才打 exe）、硬性约束 6（Electron 安全：`contextIsolation` 开、`nodeIntegration` 关，单窗口加载 `dist/index.html`）、构建与工具链命令表、测试策略（物理正确性自检 + 数值自洽 + 回归防护，非单元测试框架）。
- 前置条件：Phase 01–07 各功能已实现——自检体系以它们的数学模型与持久化/调度机制为验证对象，打包体系以其构建产物（`dist/` + `electron/`）为输入。
- 归档来源：`archive/docs/legacy/程序设计说明.md` §7（打包与自检，两阶段发布流程 + 命令表 + Electron 主进程约定）、`archive/docs/legacy/数学模型.md` §10.1（自动化自检表）、`em-field-studio/BUILD-EXE.md`（本机离线打包操作手册，持续有效）。

## 任务分组（Task Groups）

### Group 1: 便携 exe 打包与本机离线流程（2026-07-24 三坑实测记录，2026-07-30 重新打包便携版落地）
- [x] electron-builder portable 目标配置（`package.json` build 节：productName「电磁场建模仿真工具」、`files: [dist/**, electron/**]`、`win.target = portable`）
- [x] 本机三坑对策固化：`-c.electronDist=` 离线缓存包、win-unpacked.tmp EPERM 手工组装、`scripts/finish-portable.cjs` 复现 makensis
- [x] `BUILD-EXE.md` 操作手册撰写（标准 5 步流程 + 中间产物清理）
- [x] 产物复制到工作区根 `E:\study\Electromagnetism\电磁场建模仿真工具 0.1.0.exe`（约 90 MB，覆盖旧版）

### Group 2: 自动化自检体系（初版随 2026-07-24 JS 版首版建立；实测/循迹自检随 2026-07-31 后对应功能落地扩充；循迹自检电机滞后项 2026-08-12 新增）
- [x] `npm run selfcheck` 物理正确性自检（70 项，式 (5.1)–(5.5)、式 (6.1)–(6.4) 解析对照与假设回环项）
- [x] `npm run selfcheck:measured` 实测模型自检（CSV 解析、方案A 拟合回收、方案B 偏差插值、横向距离符号，式 (7.1)–(7.7)）
- [x] `npm run selfcheck:tracking` 循迹闭环自检（式 (8.1)–(8.10)、朝向约定回归式 (6.9)；2026-08-12 新增电机一阶滞后项 [7]）
- [x] `scripts/test-*.ts` 附加测试（appState 持久化含 v6 字段、尖角、状态恢复、扫描适配新布局、Worker）

### Group 3: 两阶段发布流程约定（2026-08-03 新增约定，即刻生效）
- [x] 预览版：改完代码只做 `npm run build`（或 `npm run dev` / 本地静态预览 dist），不打 exe，交用户确认效果
- [x] 正式版：用户明确同意后按 `BUILD-EXE.md` 流程打 Windows 便携版 exe，产物复制到工作区根覆盖旧版

### Group 4: UI 离屏截图目检工具（2026-08-15，配套 06-ui-charts-panels 面板 UI 组件化改造的验证）
- [x] `scripts/screenshot.cjs`：Electron 离屏窗口加载 dist 构建产物，可选注入 app-state 种子（演示矩形闭环赛道）、面板滚底/双栏收起，每次运行独立 userData 互不污染

## 实现顺序与依赖

Group 1（打包）与 Group 2（自检）并行起步、随各 feature 功能演进同步扩充 → Group 3 流程约定（2026-08-03 起约束全部后续发布：2026-08-12/08-13/08-15 各次更新均只出预览版未打 exe） → Group 4 截图工具（依赖 dist 构建产物，2026-08-15）。自检是发布的前置闸门：改 `src/mathmodel/` 后须三组自检 + `npm run build` 全过（`specs/techstack.md` 测试策略），打 exe 前须先经预览版确认。

## 风险与取舍

- **本机网络限制（2026-07-24 实测）**：electron-builder 默认从 GitHub 下载 Electron 必现 `connect ETIMEDOUT`——明确排除在线打包流程，改为 `-c.electronDist=` 指向本机已有缓存压缩包，完全离线。
- **杀毒软件实时扫描锁定（EPERM）**：electron-builder 对 win-unpacked.tmp 的 rename 必现 `EPERM`——放弃让 electron-builder 一步到位，改手工 `cp -r` + 组装 `resources/app` 后以 `--prepackaged` 跳过打包阶段。
- **单次 Bash 300s 限制**：7z 正常压缩约 5 分钟，前台一次跑不完——拆成"先让 electron-builder 生成 7z 归档（超时被杀也没关系，7z 写完即落盘）→ `finish-portable.cjs` 复现 makensis 组装最终 exe"两步。
- **发布节奏取舍（2026-08-03）**：`BUILD-EXE.md` 头部原约定"每次代码修改后直接重新打包便携版 exe"被两阶段发布取代——exe 打包耗时（7z 压缩约 5 分钟）且体积大（约 90 MB），改为预览版先行、用户确认后才打正式版（BUILD-EXE.md 头部已于 2026-10-01 同步修正）。
- **发布渠道（2026-10-01）**：exe 产物上传 GitHub Releases（Releases 附件，规避 GitHub 单文件 100MB 限制），不再保留本地旧版备份——原 `backup/` 目录做法废止并删除。
- **测试策略取舍**：不引入单元测试框架，以"物理正确性自检 + 数值自洽 + 回归防护"脚本体系代替（`specs/techstack.md` 测试策略）——判据直接对应公式解析解与几何真值，更贴合建模项目的验证需求。
