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
- Electron 用户数据在本机 `C:\Users\Li\AppData\Roaming\my-app\`（leveldb 为 UTF-16+snappy，不可靠解析；用户说"现在程序中的状态"时以源码默认值为准，如 `defaultLayout()`、`DEFAULT_TRACKING`）。

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
- 文献与参考资料统一收编根目录 `archive/`（docs/ 项目文档与 legacy 归档、papers/ 论文 PDF（仅本地）、presets/ 预设、references/ 参考图、scripts/extract_papers.py）；
- 格式化：沿用现有代码风格（无独立 formatter 配置），lint 过 `npm run lint`。

## 代码架构地图（mathmodel 文件 ↔ 规约对照）

| 文件（`em-field-studio/src/`） | 职责 | 对应规约 |
|---|---|---|
| `mathmodel/track.ts` | 赛道几何：段序列（line/arc）→ 离散电流元 / 路径采样 / 形状工具 / 转角刻度 / 最近点查询 | `01-track-geometry/`（式 4.x） |
| `mathmodel/field.ts` | 磁场计算：毕奥-萨伐尔积分 + 直线段闭式解 + 网格批算 | `02-magnetic-field/`（式 5.x） |
| `mathmodel/sensor.ts` | 电感模型：布局、敏感轴、标定 k、车体坐标变换 | `03-sensor-model/`（式 6.x） |
| `mathmodel/sweep.ts` | 全程扫描：固定 e/ψ 沿赛道扫全程得 U(s) | `03-sensor-model/` |
| `mathmodel/measured.ts` | 实测数据模型：CSV 导入 + 方案A 拟合 + 方案B 物理偏差校正 | `04-measured-data-model/`（式 7.x） |
| `mathmodel/control.ts` | 误差公式（递归下降解析无 eval）+ PD + 差速轮速分配 + 电机一阶滞后 | `05-tracking-control/`（式 8.1–8.7） |
| `mathmodel/kinematics.ts` | 两轮差速运动学 + 循迹闭环轨迹仿真主循环 | `05-tracking-control/`（式 8.8–8.11） |
| `components/TrackEditor.tsx` | 左侧面板：铺设工具、赛道库、物理参数 | `01` / `06` |
| `components/FieldCanvas.tsx` | 中央画布：热力图/等值线/车体叠加/铺设交互/循迹轨迹/转角刻度 | `06` |
| `components/SensorPanel.tsx` | 右侧面板：数据源、实测标定、位姿、读数剖面、全程扫描、布局编辑 | `03` / `04` / `06` |
| `components/TrackingPanel.tsx` | 循迹控制区（公式/权重/PD/一键调 PID/轮速/扰动） | `05` |
| `components/PanelSection.tsx` | 可折叠分区卡片（两侧面板统一容器） | `06` |
| `components/ZoomableChart.tsx` / `FloatingChart.tsx` | 折线图统一缩放封装 / 浮动窗容器 | `06` |
| `pages/Home.tsx` | 主页面：全部状态编排、数据流、持久化、导出、浮动层宿主 | — |
| `utils/appState.ts` | localStorage 持久化（`APP_STATE_VERSION`） | `07` |
| `utils/exporters.ts` | CSV/PNG/JSON 导出 + 赛道库持久化 | `07` |
| `sensors/sources.ts` | 数据源抽象（仿真可用；串口预留；文件已实现） | `04` |
| `workers/fieldWorker.ts` + `hooks/useFieldGrid.ts` | 磁场网格 Web Worker（分块/取消/进度/看门狗/主线程兜底） | `02` |
| `electron/main.cjs` | Electron 主进程（单窗口 1440×900，contextIsolation 开） | `08` |
