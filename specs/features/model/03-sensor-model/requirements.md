# Phase 3: 电感响应模型 — 需求

> ✅ 已实现（与 `em-field-studio/src/model/` 代码一致）。公式保留归档设计文档的"式 (x.y)"编号与原 LaTeX 表述，`matlab-simulink/` 与 `em-field-studio` 代码注释引用这些编号。

## 功能需求

### 响应公式与标定

- FR-1: 电感输出为检波后等效峰峰值电压，与其敏感轴方向的磁感应强度分量成正比：

<a id="eq-6-1"></a>
$$U=k\,\lvert\mathbf B\cdot\hat{\mathbf n}\rvert \tag{6.1}$$

  其中，U 为电感读数（V，Vpp），k 为标定系数（V/T），**n̂** 为敏感轴单位向量（世界系）。取绝对值是因为 ADC 幅值检测不分辨相位——该式表明读数只反映 |B| 沿敏感轴的投影大小，磁场方向信息由多电感布局组合恢复。
- FR-2: k 由标准信号源下的贴线锚点反推。20 kHz / 100 mA 下电感垂直贴信号线时输出 Vpp（默认 6 V，界面可调 5–7 V）；贴线几何为：

<a id="eq-6-2"></a>
$$d_{touch}=r_{wire}+r_{ind}=0.25\ \text{mm}+3\ \text{mm}=3.25\ \text{mm} \tag{6.2}$$

  其中，r_wire 为线半径，r_ind 为电感半径（Ø6 mm）。由式 [(5.5)](../02-magnetic-field/requirements.md#eq-5-5)（见 [`specs/features/model/02-magnetic-field/requirements.md`](../02-magnetic-field/requirements.md)），贴线处磁场为：

<a id="eq-6-3"></a>
$$B_{touch}=\frac{\mu_0 I}{2\pi d_{touch}}\approx 6.154\ \mu\text{T}\quad(I=100\ \text{mA}) \tag{6.3}$$

- FR-3: 于是标定系数：

<a id="eq-6-4"></a>
$$k=\frac{Vpp_{anchor}}{B_{touch}} \tag{6.4}$$

  （默认参数下 k ≈ 9.75×10⁵ V/T）。该标定的物理含义：锚点把"电感+检波放大链路"的整体增益归并到单一系数 k；电流变化时 k 不变，读数随 B（从而随 I）线性缩放（自检 [10] 验证严格 2× 缩放与 cosθ 方向性，见 [`validation.md`](validation.md)）。**注意：Vpp_anchor 取决于实车采集链路的实际增益，理论无法预知，默认 6 V 仅为先验值——其实测定方法见 [`specs/research/2026-08-13-experiment-modeling.md`](../../../research/2026-08-13-experiment-modeling.md) 实验 1（🧪 待实操）。**

### 敏感轴与布局

- FR-4: 敏感轴预设以水平面内方向为主：`x` = 水平横向（感 Bx）、`y` = 水平纵向即车头方向（感 By）、`z` = 竖直（感 Bz，保留可用）、`custom` = 自定义任意向量（代码 `axisVector()` 归一化）。
- FR-5: **默认布局（2026-08-03 起，代码 `defaultLayout()`，✅）**：4 电感，安装高度 h = 75 mm，同在 y = 80 mm 纵排：

| 电感 | 车体系 x | 车体系 y | h | 敏感轴 | 作用 |
|---|---|---|---|---|---|
| L1 | −50 mm | 80 mm | 75 mm | y（纵向，感 By） | 主对·左 |
| R1 | +50 mm | 80 mm | 75 mm | y（纵向，感 By） | 主对·右 |
| L2 | −75 mm | 80 mm | 75 mm | x（横向，感 Bx） | 宽对·左 |
| R2 | +75 mm | 80 mm | 75 mm | x（横向，感 Bx） | 宽对·右 |

  仅影响初始状态与"恢复默认"；已有用户 localStorage 中保存的布局不受影响。误差公式默认引用 L1/R1/L2/R2（式 [(8.1)](../05-tracking-control/requirements.md#eq-8-1)，见 [`specs/features/model/05-tracking-control/requirements.md`](../05-tracking-control/requirements.md)）。各电感的实际敏感轴方向由绕制与安装决定，与预设不符时以 [`specs/research/2026-08-13-experiment-modeling.md`](../../../research/2026-08-13-experiment-modeling.md) 实验 3 的实测方向为准更新布局（🧪 待实操）。

### 车体位姿与坐标变换

- FR-6: 车体位姿 `CarPose` 由赛道中线参考点（**p**，单位切向 **t̂**）+ 横向偏差 e（> 0 右偏）+ 航向角 ψ（> 0 右偏）定义。记切向右侧法向 **r̂** = (t_y, −t_x)，则车体原点与车体系两轴（世界系）为：

<a id="eq-6-5"></a>
$$\mathbf o=\mathbf p+e\,\hat{\mathbf r} \tag{6.5}$$

<a id="eq-6-6"></a>
$$\hat{\mathbf f}=\cos\psi\,\hat{\mathbf t}+\sin\psi\,\hat{\mathbf r},\qquad \hat{\mathbf r}'=\cos\psi\,\hat{\mathbf r}-\sin\psi\,\hat{\mathbf t} \tag{6.6}$$

  其中，**f̂** 为车头方向，**r̂'** 为车体右向（代码 `poseFrame()` 的 origin / forward / right）。电感车体系坐标 (x_s, y_s) 与车体系敏感轴 (a_x, a_y, a_z) 到世界系的变换为：

<a id="eq-6-7"></a>
$$\mathbf P_s=\mathbf o+x_s\,\hat{\mathbf r}'+y_s\,\hat{\mathbf f},\qquad z_s=h \tag{6.7}$$

<a id="eq-6-8"></a>
$$\hat{\mathbf n}_{world}=(a_x\hat r'_x+a_y\hat f_x,\;\;a_x\hat r'_y+a_y\hat f_y,\;\;a_z) \tag{6.8}$$

  （代码 `sensorWorld()` / `sensorAxisWorld()`）。
- FR-7: **ψ 符号约定（2026-08-03 朝向修复时明确）**：由式 [(6.6)](#eq-6-6)，车头方向角 = 切向角 − ψ（ψ > 0 为顺时针右偏）。故由循迹轨迹 θ 反算显示时应取：

<a id="eq-6-9"></a>
$$\psi=\text{切向角}-\theta \tag{6.9}$$

  并按最短弧归一到 (−π, π]。若符号写反（ψ = θ − 切向角），重建车头角变为 2·切向角 − θ，转弯时朝向将镜像反转——此为已修复缺陷的根因记录，`selfcheck:tracking` [6] 对该约定做回归防护（含 θ 连续累积超 ±π 与 S 弯逐步重建一致性，见 [`validation.md`](validation.md) V-6）。

### 全程扫描与轨迹读数

- FR-8: **全程扫描** `sweepAlongTrack()`：固定 e 与 ψ，车从 s = 0 扫到全长（默认 10 mm 步进），逐点按式 [(6.1)](#eq-6-1) 求各电感 U(s)。
- FR-9: 实测版 `sweepMeasuredAlongTrack()` 把电感世界坐标换算为有符号横向距离 d（式 [(7.1)](../04-measured-data-model/requirements.md#eq-7-1)，见 [`specs/features/model/04-measured-data-model/requirements.md`](../04-measured-data-model/requirements.md)）后交实测模型求值，无数据通道回退仿真公式 [(6.1)](#eq-6-1)（通道名加 `*` 标注）。
- FR-10: **循迹轨迹电感值**：直接取循迹仿真结果 `TrackingResult.sensorU`——车体在轨迹实际位姿上按式 [(6.1)](#eq-6-1) 读到的各电感 U，横轴可选时间 t 或轨迹弧长 s（数据整理，无新增物理计算；循迹仿真见 `specs/features/model/05-tracking-control/`）。

### 界面交互（车体位姿区与电感布局编辑）

- FR-11: 车体位姿区（右侧面板"电感与仿真"第 3 区）支持**手动位姿**：s（0–全长 mm）、e（±250 mm）、ψ（±30°）滑块；✅ 2026-08-15 起三个滑块的当前值均可**点击直接键入**精确值（失焦/Enter 提交，越界钳位到滑块量程）。
- FR-12: 标定 Vpp 滑块（5–7 V）及反推 k 显示（标定公式见 FR-2/FR-3 式 [(6.2)](#eq-6-2)–[(6.4)](#eq-6-4)；实车测定流程见 [`specs/research/2026-08-13-experiment-modeling.md`](../../../research/2026-08-13-experiment-modeling.md) 实验 1）；标定 Vpp 当前值同样可点击键入（2026-08-15 起）。
- FR-13: **电感布局编辑**：增 / 删 / 改（名称、车体系 x/y/h、敏感轴预设、自定义轴向量）；导出 / 导入布局 JSON。✅ 2026-08-15 起 +添加/导出/导入按钮移入分区标题栏；敏感轴下拉整宽自适应、选项文案精简（如"横向 x（感 Bx）"），不再溢出。
- FR-14: 位姿来源可切换为**跟随仿真轨迹**——位姿由循迹闭环轨迹驱动，s/e/ψ 由轨迹位姿经 `nearestOnPath()` 反算显示为只读（交互与置灰规则的完整约定见 `specs/features/model/05-tracking-control/`）。

## 技术约束

- TC-1: **SI 单位内部计算**（m、rad、T、A），仅界面显示用 mm / Vpp（[`specs/techstack.md`](../../../techstack.md) 硬性约束 1）。代码内 x/y/h/e 均以 m 存储，ψ 以 rad 存储。
- TC-2: **点探头近似（假设 4）**：6×8 工字电感（Ø6 mm × 高 10 mm）按几何中心点采样磁场。*理由*：电感直径远小于典型探测距离（≥ 20 mm），探头体积内的磁场梯度对平均值的修正为高阶小量。该假设由自检 [10] 的方向性与缩放自洽间接支撑，实车侧适用边界由实验 3/实验 6 数据质量综合体现（[`specs/research/2026-08-13-experiment-modeling.md`](../../../research/2026-08-13-experiment-modeling.md)）。
- TC-3: 响应、标定、布局、坐标变换与扫描均为**纯计算**，实现于 `src/model/`（sensor.ts / sweep.ts），禁止任何 UI / React / DOM 依赖（[`specs/techstack.md`](../../../techstack.md) 硬性约束 2）；公式或默认值改动必须同步本规约。
- TC-4: 读数与全程扫描在主线程**同步计算**（毫秒级）；扫描依赖变化时防抖 250 ms 重算，拖 s 滑块不触发（调度属人机交互部分，见 `specs/features/ui/06-ui-charts-panels/`）。
- TC-5: 电感布局、车体位姿（含位姿来源 poseSource 与轨迹进度 trajT）、标定 Vpp 随 appState v6 持久化（schema 纪律见 [`specs/techstack.md`](../../../techstack.md) 硬性约束 3 与 `specs/features/ui/07-persistence-export/`）；默认布局变更本身不引 schema 变化。
- TC-6: 由循迹轨迹反算 ψ 必须遵守式 [(6.9)](#eq-6-9) 符号约定并归一到 (−π, π]（已修复缺陷的回归防护，见 FR-7）。

## 接口约定

- **代码落点**：`em-field-studio/src/model/sensor.ts`（响应公式、标定、布局表、坐标变换）、`em-field-studio/src/model/sweep.ts`（全程扫描与实测版扫描）；UI 落点 `src/ui/components/SensorPanel.tsx`（车体位姿区、电感布局编辑）、`src/ui/pages/Home.tsx`（位姿状态编排、轨迹位姿反算 `trajPoseInfo`）。
- **`CarPose` 结构**（`sensor.ts`）：`{ px, py, tx, ty, e, psi }`——px/py 为赛道中线参考点（世界系，m），tx/ty 为单位切向，e 为横向偏差（m，> 0 向行进方向右侧偏移），psi 为航向角（rad，> 0 向右偏）。
- **`SensorDef` 与 `defaultLayout()`**（`sensor.ts`）：`{ id, name, x, y, h, axisPreset, axis }`——x/y/h 为车体系坐标与安装高度（m）；`axisPreset: 'z' | 'x' | 'y' | 'custom'`，`axis` 为自定义敏感轴（车体系三分量，无需归一化，`axisPreset = 'custom'` 时生效）。`axisVector(s)` 返回归一化敏感轴：`z → [0,0,1]`、`x → [1,0,0]`、`y → [0,1,0]`、`custom → axis`。`defaultLayout()` 返回 FR-5 表格的 4 电感（y = 0.08、h = 0.075，单位 m）。标定常量：`TOUCH_DIST_M = 0.00325`、`VPP_ANCHOR_DEFAULT = 6`；`touchField(I)` / `kFromAnchor(vppAnchor, I)` 对应式 [(6.3)](#eq-6-3)/[(6.4)](#eq-6-4)。
- **布局 JSON 格式**：`SensorDef[]` 数组（无 id 亦可导入），字段 `name / x / y / h（m）/ axisPreset / axis[3]`；与导出互逆。工作区样例 `archive/presets/sensor-layout.json` 与默认布局等价。
- **`nearestOnPath` 反算约定**（`track.ts`，"跟随仿真轨迹"模式由轨迹绝对位姿 (x, y, θ) 反算 s/e/ψ 展示用）：s 与参考点由 `nearestOnPath(path, x, y)` 在路径采样点上做相邻点细分投影插值取最近点；e 由 `signedLateralDistance()` 求取（右正，与式 [(6.5)](#eq-6-5) 的 e 约定一致，见 [`specs/features/model/04-measured-data-model/requirements.md`](../04-measured-data-model/requirements.md) 式 [(7.1)](../04-measured-data-model/requirements.md#eq-7-1)）；ψ 按式 [(6.9)](#eq-6-9) 取 `atan2(ty, tx) − θ` 并以最短弧归一到 (−π, π]。三者在界面上只读显示。
- **UI 交互约定**：手动位姿滑块量程 s 0–全长 mm、e ±250 mm、ψ ±30°；标定 Vpp 滑块 5–7 V；四处滑块当前值经共享组件 `ui/mini-num.tsx` 点击键入（失焦/Enter 提交、越界钳位到滑块量程）。布局编辑的 +添加 / 导出 / 导入按钮位于"电感布局"分区标题栏右侧（分区卡片体系见 `specs/features/ui/06-ui-charts-panels/`）。

## 非目标（Non-goals）

- 不建模探头体积内的磁场平均、磁芯非线性与温度漂移（点探头近似下为高阶小量；线性工作区间的实车边界由实验 2 标定，🧪）。
- 不在程序内自动辨识各电感实际敏感轴方向（由实验 3 实测后人工回填布局，🧪）。
- 循迹闭环轨迹的生成、误差公式与 PD 控制属 `specs/features/model/05-tracking-control/`；本功能只提供式 [(6.1)](#eq-6-1) 的读数求值与轨迹位姿的反算显示。
- 折线图的缩放 / 浮动化 / 点击联动、面板分区卡片与拖拽调宽属 `specs/features/ui/06-ui-charts-panels/`。
- 实测 CSV 导入与方案A/B 经验模型属 `specs/features/model/04-measured-data-model/`；本功能仅约定其扫描回退通道的 `*` 标注行为（FR-9）。
- 串口实车 ADC 直采为预留方向（roadmap Phase 11），本功能不涉及。
