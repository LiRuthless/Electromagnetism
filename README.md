# Electromagnetism · 电磁场建模仿真

智能车电磁赛道的磁场建模与循迹仿真项目，包含 Python 数值仿真与 Electron 桌面仿真工具两部分。

## 目录结构

```
├── 数学模型.md            # 设计基准文档：数学模型
├── 程序设计说明.md         # 设计基准文档：程序设计（含人机交互）
├── 启动仿真工具.bat        # Windows 下一键启动仿真工具
├── track_model/           # Python 赛道/磁场/传感器仿真（run_all.py 一键复现）
├── em-field-studio/       # 电磁场建模仿真工具（Electron + Vite + TypeScript）
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

本仓库的设计基准文档为根目录的 `数学模型.md` 与 `程序设计说明.md`，任何设计变更需同步更新这两份文档。
