# 技术栈（Tech Stack）

> 版本号为 `em-field-studio/node_modules` 实际安装版本（2026-09-30 核对）；升级须走独立分支并同步本文档。

## 语言与运行时

- TypeScript ~5.9.3（严格模式，`tsc -b` 过类型检查）
- Node.js v26（仅开发/构建/自检用，经 tsx 4.23.1 跑脚本）
- Python 3.11.5（仅 `track_model/` 遗留仿真，不再演进）
- MATLAB R2025a + Simulink 基础版（`matlab-simulink/` 对照移植，无额外工具箱）

## 框架与核心库

| 类别 | 选型 | 版本 | 理由 |
|---|---|---|---|
| UI 框架 | react / react-dom | 19.2.3 | 主界面 |
| 构建 | vite + @vitejs/plugin-react | 7.3.0 | 开发服务器与 dist 构建 |
| 桌面壳 | electron | 43.2.0 | Windows 便携版载体 |
| 打包 | electron-builder | 26.15.3 | portable 目标，离线流程见 `em-field-studio/BUILD-EXE.md` |
| 样式 | tailwindcss + tailwindcss-animate | 3.4.19 | 原子化样式 |
| 组件基元 | @radix-ui/react-* | ^1.x/^2.x（各包） | shadcn 风格通用组件（`src/components/ui/`） |
| 面板调宽 | react-resizable-panels | 4.2.2 | 左右面板拖拽调宽 |
| 图表（标定预览） | recharts | 2.15.4 | 实测对比预览图；其余折线图为纯 SVG 自绘 |
| 图标 | lucide-react | 0.562.0 | 统一图标 |
| 校验 | zod | 4.3.5 | 表单/数据校验 |
| Lint | eslint + typescript-eslint | 9.39.2 | 代码规范 |

## 数据存储

- 无数据库。三枚 localStorage key，互不影响：
  - `em-field-studio/app-state`——工作状态，schema 版本 `APP_STATE_VERSION = 6`（`src/utils/appState.ts`）；
  - `em-field-studio/panel-layout`——面板宽度布局，无版本号，损坏只回退默认宽度；
  - `em-field-studio/track-library`——赛道库，"恢复默认"不清它。
- 文件级数据：CSV（实测导入 / 网格 / 读数 / 扫描 / 循迹轨迹导出）、JSON（赛道 / 电感布局）、PNG（画布截图）；实测数据文件约定存放 `measured-data/`（首次实验时建立）。

## 构建与工具链

在 `em-field-studio/` 下执行：

| 命令 | 作用 |
|---|---|
| `npm run dev` | Vite 开发服务器（预览） |
| `npm run build` | 类型检查 + 构建 dist（"预览版"到此为止） |
| `npm run dist:win` | 打 Windows 便携 exe——**必须经用户确认后执行**，本机离线流程见 `BUILD-EXE.md` |
| `npm run selfcheck` / `selfcheck:measured` / `selfcheck:tracking` | 三组物理/模型自检 |
| `node_modules/.bin/electron.cmd scripts/screenshot.cjs …` | UI 离屏截图目检工具 |

MATLAB 侧：`matlab-simulink/` 下 `build_all`（一键建模）、`runAll`（全部自检）。

## 测试

- 测试策略 = **物理正确性自检 + 数值自洽 + 回归防护**，非单元测试框架：
  - `scripts/selfcheck*.ts` 三组自检（解析解对照 / 合成数据回收 / 闭环回归）；
  - `scripts/test-*.ts` 附加测试（appState 持久化、状态恢复、扫描、尖角、Worker）；
  - 各 feature 的 validation.md 给出判据与通过标准。
- 改 `src/mathmodel/` 任何公式/默认值/参数后：三组自检 + `npm run build` 全过才可回填规约状态标记。

## 硬性约束（不可协商）

1. **SI 单位内部计算**（m、rad、T、A），仅界面显示用 mm / Vpp。
2. **`src/mathmodel/` 为纯计算层**：禁止任何 UI / React / DOM 依赖；公式或默认值改动必须同步对应 feature 规约（见其 README 维护约定）。
3. **appState schema 纪律**：结构变更须 `APP_STATE_VERSION +1`；新增字段优先逐字段回退默认值（如 motorTauMs 未升版本的先例）；启动校验失败回退全默认，**绝不崩溃**。
4. **两阶段发布**：改完代码只出预览版（build/dev），用户明确同意后才打 exe。
5. **表达式解析禁用 `eval`**：误差公式走递归下降解析（`compileFormula()`）。
6. **Electron 安全**：`contextIsolation` 开、`nodeIntegration` 关，单窗口加载 `dist/index.html`。
7. **Git 约定**：改动处理完毕后 `git add -A && git commit` 一次（message 前缀 `docs:` / `model:` / `feat:` / `fix:` / `chore:` + 中文要点）；**默认只 commit 不 push**；规约与代码同仓库同流程，宪章修改走独立分支。

## 目录与代码规范

- 工作区根即 git 仓库（`origin = github.com/LiRuthless/Electromagnetism`，分支 `main`）；
- 主程序 `em-field-studio/`：`src/mathmodel/`（数学模型层，track/field/sensor/sweep/measured/control/kinematics）、`src/components/`（UI，`ui/` 为 shadcn 通用组件）、`src/pages/Home.tsx`（状态编排）、`src/utils/`（持久化/导出）、`src/workers/` + `src/hooks/`（磁场网格 Web Worker）、`electron/main.cjs`、`scripts/`（自检与打包辅助）；
- `matlab-simulink/`：Simulink 移植（geom/field/sensor/control/blocks/selfcheck/track_lib），公式注释的"式 (x.y)"编号与 specs/features/ 各规约保留的原编号一致；
- specs/ 内文件名一律小写英文 + 连字符；功能目录 `NN-<kebab-case-name>`；
- 格式化：沿用现有代码风格（无独立 formatter 配置），lint 过 `npm run lint`。
