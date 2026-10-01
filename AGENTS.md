# AGENTS.md

本项目采用规约驱动开发（SDD，体系规范见根目录 `SDD文档体系规范.md`）。开始任何工作前，按顺序阅读：

1. `specs/mission.md` — 项目为什么存在
2. `specs/techstack.md` — 技术约束（含硬性约束，不可违反）
3. `specs/roadmap.md` — 当前进度与下一步

项目背景速览：智能车竞赛电磁组赛道的磁场建模与循迹仿真（20 kHz / 100 mA 贴地电磁线 + 车载工字电感 + 差速循迹）。主程序 `em-field-studio/`（Electron + React 19 + TS + Vite 桌面工具），另有 `matlab-simulink/` 对照移植与 `track_model/` Python 遗留存档。

## 工作规则

- 实现代码前必须存在对应的功能规约（`specs/features/<域>/NN-*/` 的 plan / requirements / validation 三件套）；先写并提交规约，再实现。
- **两层组织结构**：文档与代码均按两层维护——模型层（可脱离浏览器运行 / 与实车共享：数学模型、仿真器、车载控制器代码）与前端层（可视化 / UI / 桌面壳与持久化等基建）。新增功能先判定归属层，规约建到 `specs/features/model/` 或 `specs/features/ui/` 下；`NN` 序号仍与 roadmap 阶段编号对应，跨域不改号。
- 修改任何规约文档必须同步更新关联文档（plan / requirements / validation / roadmap / CHANGELOG），防止漂移。
- 每个任务分组完成后运行对应 validation.md 中的自动化验证（三组自检 + `npm run build`，见 `specs/techstack.md`）。
- 状态标记约定：✅ 已实现｜🔶 设计变更（待改代码）｜⬜ 新增设计（待实现）｜🧪 待实操（实验建模环节）。
- 协作方式：用户通常按条口述设计变更（常附公式截图——先读图提取公式再动笔）；歧义处先问或按常规理解具体化并显式声明；**文档可能滞后于代码，动笔前先核对目标文件源码**（默认值、`APP_STATE_VERSION`、新组件），已实现部分以代码为准；收尾回复给"用户要求 → 规约落点"对照表，并声明自行具体化的理解点。

## 历史资料与编号对应关系

- 原设计基准双文档已归档：`archive/docs/legacy/数学模型.md`、`archive/docs/legacy/程序设计说明.md`（2026-09-30 起不再维护，仅供查证）。
- **代码注释中的"《数学模型.md》§x / 式 (x.y)"编号依然有效**：迁移后的各 feature 规约原样保留了式编号；归档版全文可作对照。新旧对照：§4→`model/01-track-geometry`，§5→`model/02-magnetic-field`，§6→`model/03-sensor-model`，§7→`model/04-measured-data-model`，§8→`model/05-tracking-control`，§9→`specs/research/2026-08-13-experiment-modeling.md`，§10→各 feature 的 validation.md。
- 打包 exe 的本机离线流程见 `em-field-studio/BUILD-EXE.md`；**打 exe 必须经用户明确同意**（两阶段发布）。

## Git 约定

- 改动处理完毕后 commit 一次（`docs:` / `model:` / `feat:` / `fix:` / `chore:` + 中文要点）；默认只 commit 不 push。
- 宪章（mission/techstack/roadmap）的修改走独立分支单独提交。
