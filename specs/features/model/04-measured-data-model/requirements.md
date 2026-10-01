# Phase 4: 实测数据经验模型 — 需求

> ✅ 已实现（与 `src/model/measured.ts` 代码一致）。实现计划见 [plan.md](plan.md)；验证判据见 [validation.md](validation.md)。

## 功能需求

- **FR-1: 实测 CSV 导入解析**。用户可导入实车采值 CSV（横向偏差 e vs 各通道 U，`parseMeasuredCSV()`）。格式约定：
  - 首行表头；**第一列为横向偏差**，可识别表头：`e(mm)` / `e(cm)` / `e_mm` / `e_cm` / `emm` / `ecm` / `偏差` / `横向偏差`（小写、去空格/括号后匹配；`偏差(毫米)`/`偏差(厘米)` 同规则）；**cm 单位自动 ×10 换算 mm**；无法识别单位时**按 cm 处理并标注**（数据集携带 `eUnitNote` 中文说明，界面黄色提示）；
  - 其余列为**通道名，须与电感 `name` 一致**（如 `L1,R1,L2,R2`）；只保留确实出现过数据的通道；
  - 分隔符支持**逗号 / 分号 / 制表符**（按表头行出现频次自动检测）；兼容 **UTF-8 BOM**；
  - **空行 / 非法行跳过**；**有效点 < 3 抛中文错误**（"有效采样点不足……至少需要 3 个"）；解析后采样点按 e 升序排列。
- **FR-2: 有符号横向距离 d**。实测模型的自变量统一为电感到赛道中线的**有符号横向距离** d（mm，右正）。`signedLateralDistance()` 在路径采样点上做相邻点细分投影插值取最近点，符号按切向右手侧为正（与 [`specs/features/model/03-sensor-model/requirements.md`](../03-sensor-model/requirements.md) 式 [(6.5)](../03-sensor-model/requirements.md#eq-6-5) 的 e 约定一致）：

  <a id="eq-7-1"></a>
  $$d=\text{sign}\big((\mathbf P-\mathbf q)\times\hat{\mathbf t}\big)\cdot\min_{\mathbf q\in\text{中线}}\lVert\mathbf P-\mathbf q\rVert \tag{7.1}$$

  其中 **q** 为中线采样点（含线段内插值），叉积 z 分量定号。
- **FR-3: 方案A——解析形状最小二乘拟合（fit）**。以无限长直导线磁场曲线形状为基函数做最小二乘拟合：

  <a id="eq-7-2"></a>
  $$U(d)=k\,f(d),\qquad f(d)=\begin{cases}\dfrac{h_{eff}}{(d-e_0)^2+h_{eff}^2} & \text{竖直电感（Lorentzian 形）}\\[3mm]\dfrac{|d-e_0|}{(d-e_0)^2+h_{eff}^2} & \text{横躺电感（|d| 形）}\end{cases} \tag{7.2}$$

  其中，k 为幅值系数，h_eff 为等效高度（mm，含安装残差），e0 为对中残差（mm）。拟合在 **h_eff ∈ [15, 200] mm × e0 ∈ [−40, 40] mm 各 60 档网格**上搜索，内层对线性参数 k 解析求解：

  <a id="eq-7-3"></a>
  $$k=\frac{\sum_i y_i f_i}{\sum_i f_i^{2}},\qquad \text{取 SSE}=\sum_i (y_i-k f_i)^2\ \text{最小者} \tag{7.3}$$

  输出拟合质量指标：

  <a id="eq-7-4"></a>
  $$RMSE=\sqrt{\frac{SSE}{n}},\qquad R^{2}=1-\frac{SSE}{\sum_i (y_i-\bar y)^{2}} \tag{7.4}$$

  形状选择按敏感轴：`x`（横躺，感 Bx）→ |d| 形；`z`（竖直）/ `y` / `custom` 及未知 → Lorentzian 形兜底。每通道独立拟合；单通道有效点 < 3 时报错（该通道无拟合结果，回退仿真）。
- **FR-4: 方案B——物理公式基准 + 偏差校正（phys，2026-07-31 起替代原 LUT）**。以仿真物理公式为基准，只插值实测与公式的偏差。物理基准取长直导线解析形状（实测标定在直道上采集；导线沿车头方向，电感相对导线位置为横向 d、高度 h）：

  <a id="eq-7-5"></a>
  $$\mathbf B(d)=\frac{\mu_0 I}{2\pi(d^{2}+h^{2})}\,(h,\;0,\;-d),\qquad U_0(d)=k\,\lvert\mathbf B(d)\cdot\hat{\mathbf n}\rvert \tag{7.5}$$

  各实测点偏差：

  <a id="eq-7-6"></a>
  $$\delta_i=U_{\text{实测}}(d_i)-U_0(d_i) \tag{7.6}$$

  δ(d) 分段线性插值，采样范围外钳位端点偏差（仍随 U₀ 物理形状外推），最终读数：

  <a id="eq-7-7"></a>
  $$U(d)=\max\big(0,\;U_0(d)+\hat\delta(d)\big) \tag{7.7}$$

  该设计使整体形状与物理一致，偏差项只修正实车与理想模型的差异——外推区与稀疏采样区比纯查表插值更稳健；钳位 ≥ 0 反映 Vpp 非负的物理约束。基准上下文取当前电感安装高度 h、敏感轴、赛道电流 I 与标定 k（式 [(6.4)](../03-sensor-model/requirements.md#eq-6-4)，见 [`specs/features/model/03-sensor-model/requirements.md`](../03-sensor-model/requirements.md)）。
- **FR-5: 统一求值与仿真回退**。`evalMeasured()` 按当前模型种类求值；**通道无实测数据（或方案A 无拟合结果）时返回 null，调用方回退仿真公式**（式 [(6.1)](../03-sensor-model/requirements.md#eq-6-1)），**读数名加 `*` 标注**。实测版全程扫描 `sweepMeasuredAlongTrack()` 把电感世界坐标换算为 d 后交实测模型求值，回退通道同样加 `*` 标注。
- **FR-6: 采集数据源 5 种可切换**。右侧面板"采集数据源"下拉：仿真模型 / 实测拟合(方案A) / 实测物理+偏差(方案B) / 串口(预留) / 文件(已实现)（`src/model/sources.ts`，`SourceKind = 'simulation' | 'measured-fit' | 'measured-phys' | 'serial' | 'file'`）；实测源未导入数据时给黄色提示。数据源切换即时生效：电感读数剖面、全程扫描、循迹仿真读数注入（`readSensor`）均按当前数据源求值。
- **FR-7: 实测数据标定区 UI**。右侧面板"实测数据标定"区提供：导入 CSV / 清除按钮；数据集概况（文件名、采样点数、e 范围，含 `eUnitNote` 单位标注）；**通道匹配徽章**（有数据 / 缺失回退）；**方案A 拟合结果表**（每通道 k / h_eff / e0 / RMSE / R²）；**方案B 偏差节点数**（每通道有效偏差节点数）；**单通道对比预览图**（实测散点 + 方案A 拟合曲线 + 方案B 物理+偏差曲线，recharts 实现，可浮出为浮动窗 `measuredFit`，见 [`specs/features/ui/06-ui-charts-panels/requirements.md`](../../ui/06-ui-charts-panels/requirements.md)）。
- **FR-8: 导入即自动建模、标定状态持久化**。导入入口（`handleImportMeasured`）解析 CSV 后自动完成方案A 拟合（对通道名与当前电感布局匹配的通道逐通道 `fitChannelModel`）与方案B 偏差建模（随求值自动完成，无需显式步骤）；无通道匹配或部分通道拟合失败时弹窗提示。标定状态（数据集 + 拟合结果 `MeasuredState`）与数据源选择随 appState 持久化（见 [`specs/features/ui/07-persistence-export/requirements.md`](../../ui/07-persistence-export/requirements.md)），重启后恢复；"恢复默认"与"清除实测数据"将其清空。

## 技术约束

- **TC-1: SI 单位内部计算**（[`specs/techstack.md`](../../../techstack.md) 硬性约束 1）。实测模型接口处的 d 以 mm 计（CSV 与拟合网格均为 mm 域），方案B 基准 `physBaseline()` 内部换算 m 后按 SI 计算；读数 U 一律为检波后等效峰峰值 Vpp（V）。
- **TC-2: `src/model/measured.ts` 为纯计算层**（硬性约束 2）：禁止任何 UI / React / DOM 依赖；公式或默认值（网格范围、档数、阈值）改动必须同步本规约。
- **TC-3: 实测源不走 `SensorDataSource` 接口**。`measured-fit` / `measured-phys` 由 Home 直接求值（`evalMeasured`），`createSource()` 对其抛出说明性错误；`FileSource` 仅作"已实现"的指引性 stub（接法说明见 `src/model/sources.ts` 头注释）。
- **TC-4: appState schema 纪律**（硬性约束 3）：`measured` 字段经 `sanitizeMeasured()` 逐字段校验回退；启动校验失败回退全默认，绝不崩溃。
- **TC-5: 公式编号纪律**：式 [(7.1)](#eq-7-1)–[(7.7)](#eq-7-7) 编号与原 LaTeX 表述为需求基准，`matlab-simulink/` 与 `em-field-studio` 代码注释引用这些编号，禁止重编号或改写。

## 接口约定

### 代码落点（`em-field-studio/`）

| 文件 | 内容 |
|---|---|
| `src/model/measured.ts` | 本功能全部计算：`parseMeasuredCSV` / `fitChannelModel` / `evalFitModel` / `physBaseline` / `evalPhysModel` / `evalMeasured` / `signedLateralDistance`（2026-08-12 由 `src/sensors/` 并入数学模型层） |
| `src/model/sweep.ts` | `sweepMeasuredAlongTrack()`：实测版全程扫描（回退仿真、`*` 标注） |
| `src/model/sources.ts` | 数据源抽象与 `SourceKind` 枚举（实测两源由 Home 直接求值，见 TC-3） |
| `src/ui/pages/Home.tsx` | `handleImportMeasured`（导入 → 解析 → 逐通道拟合）、读数/扫描/循迹三处的实测求值与仿真回退 |
| `src/ui/components/SensorPanel.tsx` | 采集数据源下拉、实测数据标定区、`MeasuredFitChart` 对比预览图（浮动窗 id `measuredFit`） |
| `src/ui/utils/appState.ts` | `measured` / `sourceKind` 持久化与 `sanitizeMeasured()` 校验 |

### 数据结构

```ts
interface MeasuredPoint { eMm: number; values: Record<string, number> }   // 单采样点：e（mm，右正）+ 各通道读数（Vpp）
interface MeasuredDataset { fileName: string; channels: string[]; points: MeasuredPoint[]; eUnitNote?: string }
interface ChannelFit { k: number; hEffMm: number; e0Mm: number; rmse: number; r2: number }  // 方案A 单通道拟合结果
interface PhysBaselineCtx { hM: number; axis: [number, number, number]; I: number; k: number } // 方案B 基准上下文
type MeasuredModelKind = 'fit' | 'phys'
interface MeasuredState { dataset: MeasuredDataset; fits: Record<string, ChannelFit> }  // 持久化单元
```

### CSV 格式（接口①）

首行表头：首列横向偏差（`e(mm)` 推荐，`e_cm` / `e(cm)` / `偏差` 等均可，cm 自动换算 mm，无法识别按 cm 处理并标注）；其余列 = 电感名（须与布局 `name` 一致）。逗号/分号/制表符分隔；UTF-8 BOM 兼容；空行/非法行跳过；有效点 ≥ 3。该 CSV 由 [`specs/research/2026-08-13-experiment-modeling.md`](../../../research/2026-08-13-experiment-modeling.md) 实验 6 的横向扫描实验产出（🧪 待实操；采集时保持 I = 100 mA 恒定、电感布局与程序内一致，否则方案B 物理基准失配）。接口① 汇总约定见 [`specs/features/ui/07-persistence-export/requirements.md`](../../ui/07-persistence-export/requirements.md)。

### UI 交互

- 导入：右侧"实测数据标定"区 → `parseMeasuredCSV()` → 自动完成方案A 拟合（k/h_eff/e0/RMSE/R²）与方案B 偏差建模 → 数据源切 `measured-fit` / `measured-phys` 即生效；标定状态随 appState 持久化。
- 无数据通道：读数剖面、全程扫描、循迹仿真中回退仿真公式（式 [(6.1)](../03-sensor-model/requirements.md#eq-6-1)），通道名加 `*` 标注；标定区通道匹配徽章同步标示"缺失回退"。
- 实测数据标定区分区默认展开时机（选中实测源或已导入数据时）等面板细节见 [`specs/features/ui/06-ui-charts-panels/requirements.md`](../../ui/06-ui-charts-panels/requirements.md)。

## 非目标（Non-goals）

- 不做串口实时采集（SerialSource 为预留方向，Phase 11 `11-serial-source`）。
- 不做实车循迹日志程序内对比视图（Phase 10 `10-vehicle-log-compare`，接口④）。
- 不做程序内参数辨识：实验 1/2/3/4/5/7/8 数据按接口③模板线下汇总处理（见 [`specs/research/2026-08-13-experiment-modeling.md`](../../../research/2026-08-13-experiment-modeling.md)），结论以数字回填参数。
- 方案A 不做网格搜索之外的迭代精化与参数不确定度估计。
- 不做 (e, h) 二维联合经验模型——实验 7 高度扫描仅作 h_eff 的物理佐证，不进入模型结构。
- 不在模型内修正弯道/十字处相对直道标定形状的差异（单变量 d 建模为既定约定；适用范围由实验 9 偏差分析界定，系统性偏差可补充方案B 偏差项 δ）。
