# Phase 7: 持久化与数据接口 — 实现计划

> 本规约为已实现功能的回溯文档化（棕地逆向，2026-09-30 依据归档设计文档 [`程序设计说明.md`](../../../../archive/docs/legacy/程序设计说明.md) §6 补齐）。

## 目标

交付程序的工作状态持久化（appState v6，防抖自动保存、启动校验回退绝不崩溃）、两枚独立 localStorage key（面板宽度布局、赛道库）、六项文件导出（CSV/PNG/JSON），以及实测数据导入与处理接口①–④的文件格式与交接约定。

## 背景与依据

- 关联宪章：
  - [`specs/mission.md`](../../../mission.md) 范围内条目"实测数据经验模型（方案A 拟合 / 方案B 物理+偏差）与 CSV 导入导出""实验建模手册与数据接口约定"；成功标准"任何设计变更可沿'规约 → 代码 → 自检'追溯"。
  - [`specs/techstack.md`](../../../techstack.md) 数据存储条目（无数据库，三枚 localStorage key 互不影响；文件级数据 CSV/JSON/PNG，实测数据文件约定存放 `measured-data/`）；硬性约束 1（SI 单位内部计算，仅界面显示用 mm / Vpp）、硬性约束 3（appState schema 纪律：结构变更须 `APP_STATE_VERSION +1`；新增字段优先逐字段回退默认值；启动校验失败回退全默认，绝不崩溃）。
- 前置条件：Phase 1（赛道几何，赛道定义/闭环标志）、Phase 3（电感布局与默认 4 电感）、Phase 4（实测标定状态结构）、Phase 5（循迹参数与轨迹结果）、Phase 6（浮动图表状态、面板调宽布局）。
- 源小节：[`程序设计说明.md`](../../../../archive/docs/legacy/程序设计说明.md) §6.1（localStorage 持久化）、§6.2（文件导出）、§6.3（实测数据导入与处理接口汇总，2026-08-13 新增）。

## 任务分组（Task Groups）

### Group 1: 工作状态持久化基线（appState v1–v4）
- [x] `em-field-studio/app-state` key + schema 版本号机制；保存/读取/清除 API
- [x] 启动校验恢复：版本不符 / JSON 损坏 / 结构非法 → 回退全默认，绝不崩溃；非关键字段非法只回退该字段默认值
- [x] 任何状态变化防抖 300 ms 自动保存
- [x] v4 纳入循迹参数 tracking（随循迹闭环功能落地）
- [x] 赛道库独立 key `em-field-studio/track-library`（保存/载入/改名/删除），与 appState 互不影响

（实际实现日期：2026-07-24 初版完成；tracking 入 v4 于 2026-07-31 后随循迹闭环落地）

### Group 2: 文件导出六项（exporters.ts）
- [x] 磁场网格 CSV（x,y,h(mm) + Bx,By,Bz,|B|(μT)，表头注释含全部参数，带 BOM）
- [x] 电感读数 CSV、全程扫描 CSV、画布 PNG
- [x] 赛道 JSON / 电感布局 JSON（与导入互逆）
- [x] 循迹轨迹 CSV（逐时间步一行）

（实际实现日期：2026-07-24 初版（含实测数据标定导入）；循迹轨迹 CSV 于 2026-07-31 后随循迹闭环落地；赛道 JSON 携带闭环标志于 2026-08-02）

### Group 3: appState v4 → v5
- [x] 赛道闭环标志 closed、位姿来源 poseSource、轨迹进度 trajT、左侧栏收起 leftCollapsed 入持久化

（实际实现日期：2026-08-02，版本号 4 → 5）

### Group 4: appState v5 → v6
- [x] 折线图浮动状态 `floatingCharts`（每张图：是否浮出、x/y/宽/高）
- [x] 循迹滑块自定义量程 `trackingRanges`（各滑块参数的 min/max 用户覆盖值）
- [x] v6 校验规则：逐条校验，非法条目丢弃（非关键字段）；min<max 不成立的量程条目丢弃

（实际实现日期：2026-08-03，版本号 5 → 6）

### Group 5: motorTauMs 增补（未升版本号的逐字段回退先例）
- [x] tracking 内增补 motorTauMs（电机一阶滞后时间常数）——依赖 sanitizeTracking 逐字段回退默认值，旧 v6 存档无损加载，未升版本号

（实际实现日期：2026-08-12）

### Group 6: 面板宽度布局独立持久化
- [x] 独立 key `em-field-studio/panel-layout`（react-resizable-panels Layout，panel id → flexGrow），防抖 300 ms 保存
- [x] 与 appState 解耦、无版本号——损坏/缺失只回退默认面板宽度，不丢工作状态；不影响 `APP_STATE_VERSION`（仍 v6）

（实际实现日期：2026-08-15，随面板 UI 组件化改造落地）

### Group 7: 实测数据导入与处理接口①–④约定
- [x] 接口① 静态扫描标定 CSV 导入（走"实测数据标定"区，✅ 已实现）
- [x] 接口② 循迹轨迹 CSV 仿真基准导出（✅ 已实现）
- [x] 接口③ 参数标定数据线下汇总处理约定（🧪 约定生效，程序内无导入入口）
- [x] 接口④ 实车循迹日志线下对照约定（🧪 约定生效，对比视图待实现）
- [x] 补充约定：文件命名 `exp*_YYYYMMDD.csv`、`measured-data\` 目录（⬜ 首次实验时建立）、③④ 不影响 `APP_STATE_VERSION`

（实际实现日期：① 随 2026-07-24 初版实测标定落地；② 随 2026-07-31 后循迹闭环落地；①–④ 汇总约定 2026-08-13 文档落地）

## 实现顺序与依赖

Group 1（持久化基线与赛道库）→ Group 2（导出，依赖各 Phase 的数据结构）→ Group 3 / 4（schema 演进，分别随 2026-08-02 / 2026-08-03 两批设计更新落地）→ Group 5（跟随 Phase 5 电机滞后模型）→ Group 6（跟随 Phase 6 面板 UI 改造）→ Group 7（①② 早已实现，③④ 为纯文件级约定，2026-08-13 随实验建模规程一并成文，无需程序改动）。

## 风险与取舍

- **motorTauMs 未升版本号**：新增字段优先采用逐字段回退默认值（sanitizeTracking），使旧 v6 存档无损加载，避免用户存档因版本号 +1 而整体作废——此后成为 [`techstack.md`](../../../techstack.md) 硬性约束 3 记载的先例。代价：同版本号内字段集合不完全一致，靠逐字段回退保证兼容。
- **panel-layout 无版本号、与 appState 解耦**：布局损坏/缺失只回退默认面板宽度，不丢工作状态；有意不接受 schema 版本管理的复杂度。
- **接口③④选择"线下汇总 / 线下对照"而非程序内辨识 / 程序内对比视图**：当前版本程序无需任何改动，结论以数字直输回填参数；程序内对比视图（接口④）与 SerialSource 串口直采明确排除为预留方向（roadmap Phase 10 / Phase 11），待实车数据量增大后按"先④后串口"的优先级实现。
- **会话内状态不持久化**：右侧栏收起状态、分区卡片折叠状态、画布"转角刻度"开关均为会话内内存状态，有意不入 appState，减少 schema 字段噪音。
- **写入失败静默忽略**：localStorage 配额耗尽 / 隐私模式下 saveAppState 静默失败，不打断使用（持久化是增强而非硬依赖）。
