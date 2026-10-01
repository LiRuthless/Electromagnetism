# Phase 7: 持久化与数据接口 — 需求

## 功能需求

### appState 持久化（✅）

- FR-1: 工作状态持久化于 localStorage，key 为 `em-field-studio/app-state`，schema 版本号 `APP_STATE_VERSION = 6`。赛道库另有独立 key，互不影响。
- FR-2: appState 覆盖范围——赛道定义（✅ 含闭环标志 closed）、物理参数、电感布局、车体位姿（✅ 含位姿来源 poseSource 与轨迹进度 trajT）、标定 Vpp、数据源、实测标定状态、编辑/铺设工具状态、画布视图、✅ 循迹参数 tracking（公式文本/A/B/C/P/Kp/Kd/vBase/vMax/w/wheelBase/dtMs/motorTauMs/initE/initPsi/errLimit/errLimitSteps）、✅ 左侧栏收起状态 leftCollapsed、✅ 折线图浮动状态 floatingCharts、✅ 循迹滑块自定义量程 trackingRanges。
- FR-3: 版本演进记录——✅ 闭环标志、位姿来源、侧栏收起状态随 v5 加入（2026-08-02，版本号 4 → 5）；✅ v6（2026-08-03，版本号 5 → 6）加入折线图浮动状态 `floatingCharts`（每张图：是否浮出、x/y/宽/高）与循迹滑块自定义量程 `trackingRanges`（各滑块参数的 min/max 用户覆盖值）；默认布局变更与循迹输入方式变更本身不引 schema 变化（默认布局只影响初始值/恢复默认，循迹参数仍是同一组字段）；motorTauMs 于 2026-08-12 新增——依赖 sanitizeTracking 逐字段回退默认值，旧 v6 存档无损加载，未升版本号。
- FR-4: 任何状态变化防抖 300 ms 自动保存。
- FR-5: 启动时校验恢复——版本不符 / JSON 损坏 / 结构非法 → 回退全默认，**绝不崩溃**；非关键字段非法只回退该字段默认值（如 vppAnchor 回退 6、sourceKind 回退 simulation、显示分量回退 bz、非法视图回退 null）。v6 子表逐条校验：`floatingCharts` 非法条目丢弃（非关键字段）；`trackingRanges` 中 min<max 不成立的量程条目丢弃。
- FR-6: ✅ 面板宽度布局独立持久化（2026-08-15）——key `em-field-studio/panel-layout`（react-resizable-panels Layout，panel id → flexGrow），防抖 300 ms 保存；与 appState 解耦、**无版本号**：损坏/缺失只回退默认面板宽度，不丢工作状态；**不影响 `APP_STATE_VERSION`（仍 v6）**。右侧栏收起与分区卡片折叠状态均不持久化（会话内内存状态）。
- FR-7: 赛道库独立 key `em-field-studio/track-library`：保存/载入/改名/删除当前赛道；导出/导入赛道 JSON（✅ 携带闭环标志）。
- FR-8: 顶栏"恢复默认"按钮只清工作状态 key——恢复默认后的电感布局 = 默认 4 电感布局（见 [`specs/features/model/03-sensor-model/requirements.md`](../../model/03-sensor-model/requirements.md)）；赛道库与面板宽度布局两个独立 key 均不受影响（实现层面：恢复默认仅重置左侧收起状态，不动 panel-layout）。

### 文件导出（✅）

- FR-9: 提供六项导出，格式见"接口约定"导出表：①磁场网格 CSV（x,y,h(mm) + Bx,By,Bz,|B|(μT)，表头注释含全部参数，带 BOM，Excel 友好）；②电感读数 CSV（当前位姿各电感：车体系坐标、轴向量、U(Vpp)）；③全程扫描 CSV（s(mm) + 各电感 U(s)，表头附 e/ψ/电流/k 等）；④画布 PNG（当前画布视图截图）；⑤赛道 JSON / 电感布局 JSON（与导入互逆，✅ 赛道 JSON 携带闭环标志）；⑥循迹轨迹 CSV（t(s)、x、y、θ、v_L、v_R、Err、各电感 U，逐时间步一行）。

### 实测数据导入与处理接口①–④（①② ✅ / ③④ 🧪）

用户按 [`specs/research/2026-08-13-experiment-modeling.md`](../../../research/2026-08-13-experiment-modeling.md) 实验建模（实验作为建模的有机环节，个人实验手册——仅供阅读执行、不构成程序功能需求、无需写入程序）测得数据后，按本节约定**整理 → 导入 → 处理**。本节仅为文件格式与交接约定：除接口①②对应的已实现功能外，程序无需任何改动。

- FR-10: 接口① 静态扫描标定 CSV（✅ 已实现）——直道横向扫描 e vs 各通道 U（实验 6；实验 7 同构可分文件）。格式与识别规则细节见 [`specs/features/model/04-measured-data-model/requirements.md`](../../model/04-measured-data-model/requirements.md)，要点：首行表头首列横向偏差 `e(mm)`（或 `e_cm`/`e(cm)`/`偏差` 等，cm 自动换算 mm）；其余列 = 电感名（`L1,R1,L2,R2`，须与布局 name 一致）；逗号/分号/制表符分隔；UTF-8 BOM 兼容；空行/非法行跳过；有效点 ≥ 3。程序入口：右侧"实测数据标定"区导入 → `parseMeasuredCSV()` → 自动完成方案A 拟合（k/h_eff/e0/RMSE/R²）与方案B 偏差建模（见 [`specs/features/model/04-measured-data-model/requirements.md`](../../model/04-measured-data-model/requirements.md)）；数据源切 `measured-fit` / `measured-phys` 即生效；标定状态随 appState 持久化。
- FR-11: 接口② 循迹轨迹 CSV 仿真基准（✅ 已实现）——`t(s), x, y, θ, v_L, v_R, Err, 各电感 U`（exporters.ts，见 FR-9）；顶栏"导出"菜单导出；作为实车循迹日志（接口④）的对照基准文件。
- FR-12: 接口③ 参数标定数据线下汇总处理（🧪 约定生效，程序内辨识为预留方向）——标定/线性区间/敏感轴记录（实验 1/2/3）、电机阶跃与轮距速度标定（实验 4/5）、高度扫描（实验 7）、直道收敛偏差记录（实验 8）。建议模板：阶跃日志 `t_ms, vL_cmd, vR_cmd, vL, vR`；电流扫描 `I_mA, L1, R1, L2, R2`；其余实验按 [`specs/research/2026-08-13-experiment-modeling.md`](../../../research/2026-08-13-experiment-modeling.md) 各实验"数据记录"项的表格整理为 CSV。**程序内无导入入口**——按模板整理 CSV 后交助手线下汇总（拟合 τ_m、线性度 R²、回收 k、W/v_base 标定值），结论以数字直输回填 TrackingPanel 参数（`motorTauMs` 等，见 [`specs/features/model/05-tracking-control/requirements.md`](../../model/05-tracking-control/requirements.md)，无 schema 变化）与"标定 Vpp"滑块。
- FR-13: 接口④ 实车循迹日志线下对照（🧪 约定生效，对比视图待实现）——实车跑圈日志（实验 9 偏差分析）。文件与接口②**同构**：`t, x, y, θ, vL, vR, Err, L1, R1, L2, R2`（车载端可只记 t + 各电感 + 轮速 + Err，x/y/θ 由轮速离线积分重建，重建公式 式 [(8.9)](../../model/05-tracking-control/requirements.md#eq-8-9)，见下）。**程序内无对比视图**——与接口②导出文件按弧长对齐逐列对照（可交助手画仿真/实车对比曲线）；程序内实车日志对比视图与 SerialSource 串口直采为预留方向（[`specs/roadmap.md`](../../../roadmap.md) Phase 10 / Phase 11）。

  重建所依据的两轮差速运动学（代码 `stepCar()`，半隐式欧拉：先转后移；v_L、v_R 为电机滞后后的实际轮速；权威表述见 [`specs/features/model/05-tracking-control/requirements.md`](../../model/05-tracking-control/requirements.md)）：

  $$v=\frac{v_R+v_L}{2},\qquad \omega=\frac{v_R-v_L}{W} \tag{8.8}$$

  $$\theta_{n+1}=\theta_n+\omega\,dt,\qquad x_{n+1}=x_n+v\cos\theta_{n+1}\,dt,\qquad y_{n+1}=y_n+v\sin\theta_{n+1}\,dt \tag{8.9}$$

  其中 W 为轮距（m）。

- FR-14: 补充约定——
  - 接口③④当前版本**不入 localStorage、不影响 `APP_STATE_VERSION`**——它们是文件级约定，程序无对应持久化字段；
  - 接口①的文件即实验 6 的直接产物，采集时务必保持 I = 100 mA 恒定、电感布局与程序内一致（默认布局见 [`specs/features/model/03-sensor-model/requirements.md`](../../model/03-sensor-model/requirements.md)），否则方案B 物理基准（含 h 与标定 k）会失配；
  - 建议文件命名：`exp1_标定_YYYYMMDD.csv`、`exp6_直道扫描_YYYYMMDD.csv`、`exp4_阶跃_YYYYMMDD.csv`、`exp9_循迹日志_YYYYMMDD.csv`，统一存放工作区 `measured-data\` 目录（⬜ 约定，首次实验时建立）；
  - 后续若实车数据量增大，优先实现接口④的程序内对比视图（仿真/实车 Err(t)、轮速(t)、电感 U(t) 曲线叠加，roadmap Phase 10），其次评估 SerialSource 串口直采（接法已写在 `src/model/sources.ts` 头注释，roadmap Phase 11）。

## 技术约束

- TC-1: **appState schema 纪律**（[`techstack.md`](../../../techstack.md) 硬性约束 3）：结构变更须 `APP_STATE_VERSION +1`；新增字段优先逐字段回退默认值（motorTauMs 未升版本的先例）；启动校验失败回退全默认，**绝不崩溃**。
- TC-2: 三枚 localStorage key 互不影响（[`techstack.md`](../../../techstack.md) 数据存储）：`em-field-studio/app-state`（工作状态，v6）、`em-field-studio/panel-layout`（面板宽度布局，无版本号，损坏只回退默认宽度）、`em-field-studio/track-library`（赛道库，"恢复默认"不清它）。
- TC-3: 无数据库；文件级数据为 CSV（实测导入 / 网格 / 读数 / 扫描 / 循迹轨迹导出）、JSON（赛道 / 电感布局）、PNG（画布截图）；实测数据文件约定存放 `measured-data/`（首次实验时建立）。
- TC-4: SI 单位内部计算（m、rad、T、A），仅界面显示与导出文件用 mm / Vpp / μT（[`techstack.md`](../../../techstack.md) 硬性约束 1）。
- TC-5: 全部 CSV 导出带 UTF-8 BOM（Excel 友好）。
- TC-6: 接口③④为纯文件级约定，程序无需任何改动、无对应持久化字段。
- TC-7: localStorage 仅在工作状态模块函数内部惰性访问，模块可在 Node（无 localStorage，用 stub/mock）下被 import 单测；写入失败（配额/隐私模式）静默忽略。

## 接口约定

### 代码文件落点

- `src/ui/utils/appState.ts`——工作状态持久化：`APP_STATE_KEY = 'em-field-studio/app-state'`、`APP_STATE_VERSION = 6`、`AppState` 接口、`loadAppState()`（读取并校验，失败返回 null）/ `saveAppState()`（写入失败静默忽略）/ `clearAppState()`（只清工作状态 key），以及逐字段校验函数 `sanitizeTrackDef / sanitizeParams / sanitizeSensor / sanitizeTracking / sanitizeFloatingCharts / sanitizeTrackingRanges / sanitizeMeasured`。
- `src/ui/utils/exporters.ts`——导出与赛道库：`exportGridCSV / exportReadingsCSV / exportSweepCSV / exportTrackingCSV / exportCanvasPNG / exportTrackJSON / parseTrackJSON`；赛道库 `loadLibrary / saveLibrary`（key `em-field-studio/track-library`，元素 `SavedTrack = { name, def: TrackDef, savedAt }`）。
- `src/ui/pages/Home.tsx`——全部状态编排：工作状态变化防抖 300 ms 自动保存（`saveAppState`）；`PANEL_LAYOUT_KEY = 'em-field-studio/panel-layout'` 的加载/保存；`resetDefaults()`（确认弹窗 → `clearAppState()` → 各状态回默认值、电感布局回 `defaultLayout()`、画布重挂载回自动 fit）。
- `src/ui/components/SensorPanel.tsx`——电感布局 JSON 导出/导入（导出文件名 `sensor-layout.json`，导出时剔除内部 `id` 字段）。

### 数据结构（appState v6）

```ts
interface AppState {
  version: number;            // = APP_STATE_VERSION
  savedAt: string;            // ISO 时间
  trackDef: TrackDef;         // 含 closed?: true（v5）
  params: GlobalParams;       // currentMa / heightMm / gridStepMm / component / logScale
  sensors: SensorDef[];
  pose: PoseState;            // sMm / eMm / psiDeg
  vppAnchor: number;          // 标定锚点 Vpp（V），非法回退 6
  sourceKind: SourceKind;     // 非法回退 'simulation'
  measured: MeasuredState | null;   // 实测标定状态（数据集 + 每通道方案A 拟合结果）
  editMode: EditMode; layMode: LayMode; placing: boolean;
  showSegLengths: boolean; arcPending: ArcPending;
  view: AppViewState | null;  // cx / cy / scale，非法回退 null
  tracking: TrackingParams;   // 16 字段，sanitizeTracking 逐字段回退（motorTauMs 先例）
  poseSource: 'manual' | 'trajectory';  // v5
  trajT: number;              // v5
  leftCollapsed: boolean;     // v5
  floatingCharts: Record<string, { floating: boolean; x: number; y: number; w: number; h: number }>; // v6
  trackingRanges: Record<string, { min: number; max: number }>;  // v6，min<max 不成立丢弃
}
```

浮动窗位置/尺寸为中央画布坐标 px；浮动状态条目校验时下限钳位（x/y ≥ 0，w ≥ 240，h ≥ 160，与浮动窗最小尺寸 240×160 一致，见 [`specs/features/ui/06-ui-charts-panels/requirements.md`](../06-ui-charts-panels/requirements.md)）。

### 三枚 localStorage key 与版本纪律

| key | 内容 | 版本纪律 | 损坏后果 |
|---|---|---|---|
| `em-field-studio/app-state` | 全部工作状态（AppState） | `APP_STATE_VERSION = 6`；结构变更须 +1；新增字段优先逐字段回退默认 | 回退全默认，绝不崩溃 |
| `em-field-studio/panel-layout` | 面板宽度布局（panel id → flexGrow） | 无版本号，与 appState 解耦 | 只回退默认面板宽度 |
| `em-field-studio/track-library` | 赛道库（SavedTrack 数组） | 无版本号 | "恢复默认"不清它 |

### 六项导出文件格式

| 导出项 | 文件格式约定 | 文件名 | 状态 |
|---|---|---|---|
| 磁场网格 CSV | 表头注释含全部参数（赛道/电流/观测高度/网格步长/赛道总长/网格原点/分辨率/导出时间）；列：`x(mm),y(mm),h(mm),Bx(uT),By(uT),Bz(uT),\|B\|(uT)`；带 BOM | `field-grid-<时间戳>.csv` | ✅ |
| 电感读数 CSV | 注释含赛道/电流/位姿 e/ψ/标定 k/锚点 Vpp；列：`name,x_body(mm),y_body(mm),h(mm),axis_x,axis_y,axis_z,U(Vpp)`；带 BOM | `sensor-readings-<时间戳>.csv` | ✅ |
| 全程扫描 CSV | 注释含 e/ψ/电流/高度/标定 k/锚点 Vpp/扫描步长；列：`s(mm),<电感名>_U(Vpp),…`；带 BOM | `sensor-sweep-<时间戳>.csv` | ✅ |
| 画布 PNG | 当前画布视图截图 | `field-view-<时间戳>.png` | ✅ |
| 赛道 JSON / 电感布局 JSON | 与导入互逆；赛道 JSON 为 TrackDef（✅ 携带闭环标志 closed）；布局 JSON 为电感数组（剔除内部 id） | `track-<赛道名>.json` / `sensor-layout.json` | ✅ |
| 循迹轨迹 CSV | 注释含赛道/电流/数据源/结果状态/步数/用时/弧长/误差公式与全部循迹参数；列：`t(s),x(m),y(m),theta(rad),v_L(m/s),v_R(m/s),Err,<电感名>_U(Vpp),…`，逐时间步一行；带 BOM。记录的轮速为电机滞后后的**实际**轮速 | `tracking-trajectory-<时间戳>.csv` | ✅ |

导出入口：顶栏"导出"菜单（磁场网格 CSV、电感读数 CSV、画布 PNG、赛道定义 JSON、循迹轨迹 CSV）；全程扫描 CSV 在全程扫描图区导出；布局 JSON 在电感布局区导出/导入。

### 实测数据接口①–④汇总表

| 接口 | 数据类型（来源实验） | 文件格式约定 | 程序入口 / 处理方式 | 状态 |
|---|---|---|---|---|
| ① 静态扫描标定 CSV | 直道横向扫描 e vs 各通道 U（实验 6；实验 7 同构可分文件） | 详见 [`specs/features/model/04-measured-data-model/requirements.md`](../../model/04-measured-data-model/requirements.md)；要点：首列 `e(mm)`（或 `e_cm`/`e(cm)`/`偏差` 等，cm 自动换算 mm），其余列 = 电感名（须与布局 name 一致），逗号/分号/制表符分隔，UTF-8 BOM 兼容，空行/非法行跳过，有效点 ≥ 3 | 右侧"实测数据标定"区导入 → `parseMeasuredCSV()` → 自动完成方案A 拟合与方案B 偏差建模；数据源切 `measured-fit` / `measured-phys` 即生效；标定状态随 appState 持久化 | ✅ 已实现 |
| ② 循迹轨迹 CSV（仿真基准） | 仿真循迹轨迹逐时间步 | `t(s), x, y, θ, v_L, v_R, Err, 各电感 U`（见上方导出表） | 顶栏"导出"菜单导出；作为实车循迹日志（接口④）的对照基准文件 | ✅ 已实现 |
| ③ 参数标定数据（线下汇总处理） | 标定/线性区间/敏感轴记录（实验 1/2/3）、电机阶跃与轮距速度标定（实验 4/5）、高度扫描（实验 7）、直道收敛偏差记录（实验 8） | 建议模板：阶跃日志 `t_ms, vL_cmd, vR_cmd, vL, vR`；电流扫描 `I_mA, L1, R1, L2, R2`；其余实验按 [`specs/research/2026-08-13-experiment-modeling.md`](../../../research/2026-08-13-experiment-modeling.md) 各实验"数据记录"项的表格整理为 CSV | **程序内无导入入口**——线下汇总（拟合 τ_m、线性度 R²、回收 k、W/v_base 标定值），结论以数字直输回填 TrackingPanel 参数（`motorTauMs` 等，无 schema 变化）与"标定 Vpp"滑块 | 🧪 约定生效（程序内辨识为预留方向） |
| ④ 实车循迹日志（线下对照） | 实车跑圈日志（实验 9 偏差分析） | 与接口②**同构**：`t, x, y, θ, vL, vR, Err, L1, R1, L2, R2`（车载端可只记 t + 各电感 + 轮速 + Err，x/y/θ 由轮速按式 [(8.9)](../../model/05-tracking-control/requirements.md#eq-8-9) 离线积分重建） | **程序内无对比视图**——与接口②导出文件按弧长对齐逐列对照（可交助手画仿真/实车对比曲线）；程序内实车日志对比视图与 SerialSource 串口直采为预留方向（roadmap Phase 10 / Phase 11） | 🧪 约定生效（对比视图待实现） |

补充约定同 FR-14：③④ 不入 localStorage、不影响 `APP_STATE_VERSION`；接口① 采集须保持 I = 100 mA 恒定、电感布局与程序内一致；建议文件命名 `exp1_标定_YYYYMMDD.csv` / `exp6_直道扫描_YYYYMMDD.csv` / `exp4_阶跃_YYYYMMDD.csv` / `exp9_循迹日志_YYYYMMDD.csv`，统一存放 `measured-data\`（⬜ 首次实验时建立）；后续优先实现接口④对比视图，其次评估 SerialSource。

## 非目标（Non-goals）

- 接口③的程序内参数辨识（预留方向，当前版本线下汇总处理）；
- 接口④的程序内实车日志对比视图（roadmap Phase 10 `10-vehicle-log-compare`，待实验 9 数据到位）；
- SerialSource 串口实时采集（roadmap Phase 11 `11-serial-source`）；
- panel-layout 与赛道库的版本迁移机制（有意无版本号）；
- 右侧栏收起状态、分区卡片折叠状态、画布"转角刻度"开关的持久化（有意为会话内状态）；
- 任何云端同步 / 数据库存储（本项目无数据库）。
