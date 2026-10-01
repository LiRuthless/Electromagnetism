# Electromagnetism · 电磁场建模仿真

智能车电磁赛道的磁场建模与循迹仿真项目，包含 Python 数值仿真与 Electron 桌面仿真工具两部分。

## 目录结构

```
├── AGENTS.md              # SDD 智能体入口指针（先读）
├── CHANGELOG.md           # 变更日志
├── specs/                 # SDD 规约体系：mission/techstack/roadmap + features/ + research/
├── docs/legacy/           # 原设计基准双文档（数学模型/程序设计说明，2026-09-30 归档，仅供查证）
├── 启动仿真工具.bat        # Windows 下一键启动仿真工具
├── track_model/           # Python 赛道/磁场/传感器仿真（run_all.py 一键复现）
├── em-field-studio/       # 电磁场建模仿真工具（Electron + Vite + TypeScript）
├── matlab-simulink/       # MATLAB/Simulink 对照移植
├── docs/                  # 建模方案、仿真结果小结、参考论文清单等
├── presets/               # 传感器布局 / 赛道预设（JSON）
├── references/            # 参考资料图片、检索记录
├── scripts/               # 辅助脚本（如 extract_papers.py 提取论文文本）
│
├── papers/                # 参考论文 PDF（体积大，仅本地保留，不进仓库）
├── outputs/               # 仿真输出图表（生成物，不进仓库）
└── backup/                # 旧版本安装包备份（不进仓库）
```

## 快速开始

**Python 仿真**

```bash
cd track_model
python run_all.py    # 图表输出到 outputs/，定量结论存 run_summary.json
```

**桌面仿真工具**

```bash
cd em-field-studio
npm install
npm run dev          # 开发模式；打包见 em-field-studio/BUILD-EXE.md
```

## 设计文档

本项目采用 SDD（规约驱动开发）文档体系，入口见 `AGENTS.md`：

- 宪章：`specs/mission.md` / `specs/techstack.md` / `specs/roadmap.md`
- 功能规约：`specs/features/NN-*/`（plan / requirements / validation 三件套）
- 变更日志：`CHANGELOG.md`；实验建模手册：`specs/research/2026-08-13-experiment-modeling.md`

任何设计变更先更新对应 feature 规约，再实现。原设计基准双文档（《数学模型.md》《程序设计说明.md》）已归档至 `docs/legacy/`，仅供查证。
