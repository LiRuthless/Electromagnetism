# Phase 5: 循迹闭环控制 — 需求

> 数学公式保留归档版《数学模型.md》§8 的"式 (x.y)"编号与 LaTeX 原表述；代码注释与 `matlab-simulink/` 移植引用这些编号。

## 功能需求

### FR-1　闭环信号流（✅）

小车按两轮差速运动学行驶，轨迹完全由轮速积分决定；控制律与实车代码保持一致，用于赛前调参。闭环信号流为：

$$\text{位姿}(x,y,\theta)\to\text{电感世界坐标}\to U_i\ (\text{式6.1})\to Err\ (\S8.2)\to u\ (\text{PD，}\S8.3)\to v_L^{cmd},v_R^{cmd}\ (\S8.3)\to v_L,v_R\ (\text{电机滞后，}\S8.4)\to\text{积分新位姿}\ (\S8.5)\to\cdots$$

直至跑完全程（闭环赛道 = 一圈）或失控判停。其中 U_i 的响应公式见 `specs/features/03-sensor-model/requirements.md` 式 (6.1)。**关键约定（2026-08-02 明确）**：Err 计算所用电感值是车体在**仿真轨迹实际位姿**处读到的值（由 `readSensor` 按当前数据源在车体世界坐标处求值），不是赛道中线参考位姿下的读数。

### FR-2　误差公式默认式（差比和差加权）（✅）

默认公式（2026-08-03 随 4 电感默认布局联动，代码 `DEFAULT_FORMULA`）：

$$Err=\frac{A\,(L1-R1)+B\,(L2-R2)}{A\,(L1+R1)+C\,|L2-R2|}\cdot P \tag{8.1}$$

其中，L1、R1 为左右主电感对读数（Vpp），L2、R2 为左右宽对辅助电感读数；A、B、C 为加权系数（分子主对差权重 / 分子宽对差权重 / 分母宽对差权重）；P 为比例系数（输出量级）。该式为"差比和"结构的加权变体：分子是两对电感的横向差加权和，反映横向偏差方向与大小；分母为加权和做归一化，使 Err 对信号强度变化（电流波动、高度变化）不敏感。默认布局（L1/R1/L2/R2）见 `specs/features/03-sensor-model/requirements.md`。

### FR-3　误差表达式可编辑（✅）

界面上以文本编辑，可用变量 = 各电感名 + A/B/C/P；支持 `+ - * /`、括号、一元负号、`abs(...)` 与 `|...|`；递归下降解析（**无 eval**，`compileFormula()`），非法时提示并回退默认公式；求值时分母为零等非法结果回退上一步误差，避免轨迹发散出 NaN。

### FR-4　PD 控制律（✅）

$$u=K_p\,Err+K_d\,\frac{dErr}{dt} \tag{8.2}$$

其中 dErr/dt 取相邻控制步误差差分除以 dt（首步为 0）。Kp / Kd 默认 0.5 / 0.05。

### FR-5　差速轮速分配与限幅（✅）

输出 u **直接以基础速度加减方式分配给两轮**，保持平均速度 ≈ v_base；转弯时内轮变化量 : 外轮变化量 = w : 1：

$$\Delta v_{外}=\frac{2|u|}{1+w},\qquad \Delta v_{内}=\frac{2|u|\,w}{1+w} \tag{8.3}$$

右转（u > 0，左外右内）：

$$v_L=v_{base}+\Delta v_{外},\qquad v_R=v_{base}-\Delta v_{内} \tag{8.4}$$

左转反之。轮速限幅：

$$v_L,v_R\leftarrow\text{clamp}\big([0,\;v_{max}]\big) \tag{8.5}$$

物理意义：w > 1 时内轮变化量大于外轮，相同 u 下转弯更"狠"而平均速度保持，符合实车差速调弯直觉；限幅反映电机占空比饱和约束。

### FR-6　电机一阶滞后模型（2026-08-12 新增）（✅）

式 (8.3)–(8.5) 给出的是**指令轮速**。真实电机与驱动电路存在惯性，实际轮速不能瞬时跟随指令。将每个驱动轮的实际轮速 vᵢ 建模为对指令值 vᵢ_cmd 的一阶惯性环节：

$$\tau_m \frac{dv_i}{dt} + v_i = v_i^{cmd},\qquad i\in\{L,R\} \tag{8.6}$$

其中，τ_m 为电机时间常数（默认 30 ms，界面可调 0–500 ms；τ_m = 0 退化为瞬时跟随，即 2026-08-12 前的旧行为）。由于该环节是线性的，双轮共用 τ_m 时，质心速度 v 与差速 Δv = v_R − v_L 各自以同一时间常数跟随其指令值——文献中常见的"差速一阶滞后"模型即本模型的特例。**τ_m 取决于电机、驱动电路与负载，理论无法给出，默认 30 ms 仅为先验值——其辨识方法见 `specs/research/2026-08-13-experiment-modeling.md` 实验 4。**

控制步内指令值恒定，式 (8.6) 有闭式解，仿真按精确更新（代码 `motorLag()`）：

$$v_i \leftarrow v_i^{cmd} + \big(v_i - v_i^{cmd}\big)\,e^{-dt/\tau_m} \tag{8.7}$$

其中，dt 为控制步长。精确更新对任意 dt/τ_m 稳定（无显式欧拉在 τ_m ≪ dt 时的刚性限制）。滞后状态初始值取 v_L = v_R = v_base（起步以基础速度直行）。运动学积分（FR-7）、行驶弧长与轨迹记录中的轮速均为**实际**轮速。

物理意义：τ_m 把"控制输出 → 轮速响应"的惯性显式化——过弯瞬间指令已到限幅而实际差速仍在爬升，转向滞后于几何需求；含滞后模型的整定结果更接近实车表现（自检 selfcheck:tracking [7] 验证阶跃响应 t = τ_m 时达阶跃量的 1 − 1/e ≈ 63.2%、差速以同一 τ_m 跟随、含滞后的闭环收敛回归）。

### FR-7　两轮差速运动学（✅）

运动学（代码 `stepCar()`，半隐式欧拉：先转后移；v_L、v_R 为电机滞后后的实际轮速）：

$$v=\frac{v_R+v_L}{2},\qquad \omega=\frac{v_R-v_L}{W} \tag{8.8}$$

$$\theta_{n+1}=\theta_n+\omega\,dt,\qquad x_{n+1}=x_n+v\cos\theta_{n+1}\,dt,\qquad y_{n+1}=y_n+v\sin\theta_{n+1}\,dt \tag{8.9}$$

其中 W 为轮距（m，默认 0.135）。初始位姿：赛道起点中线处、航向取起点切向，可加初始 e / ψ 扰动。**W 由轮胎有效接触间距决定（含打滑修正）、v_base 受电池电压与传动效率影响，均取名义先验值——其标定方法见 `specs/research/2026-08-13-experiment-modeling.md` 实验 5。**

### FR-8　终止条件（✅，代码 `simulateTracking()`）

$$\text{finished：行驶弧长}\ge\begin{cases}L_{track} & \text{闭环赛道（仅一圈）}\\ L_{track}+0.5\ \text{m} & \text{非闭环}\end{cases} \tag{8.10}$$

此外：|Err| 持续超 `errLimit` 达 `errLimitSteps` 步 → lost（失控判停）；步数硬上限 100000 → maxSteps；位姿出现 NaN 判失控。闭环赛道的判定与吸合段见 `specs/features/01-track-geometry/requirements.md`。

### FR-9　一键整定目标函数（2026-08-03 起为轨迹形状贴合）（✅）

一键调 PID 在给定范围内网格搜索 (Kp, Kd)（粗搜 13×11 + 最优邻域 9×9 细化），逐组跑 FR-1 仿真，按下式评价轨迹形状：

$$J=\underbrace{RMS(|e|_{直线})}_{直线贴中线}+\underbrace{2\,RMS(e_{外偏,弯道})}_{外偏双倍罚}+\underbrace{RMS\big(\max(0,\,e_{内收}-e_{in,max})_{弯道}\big)}_{内收超限罚}+\underbrace{0.5\,RMS(\Delta\theta_{抖动})}_{航向抖动罚} \tag{8.11}$$

其中：

- 轨迹点按所在中线段类型（直线段 / 弯道段，由段序列累计弧长区间表 `segSpans` + 局部最近点 s 判定；闭环吸合段按直线段处理）分类；
- 直线段罚横向偏差 |e|（贴中线）；弯道段允许并鼓励适度内收（走线圆润）——内收量 ≤ e_in_max（默认 50 mm，界面可调）不罚，超出部分按 1 倍罚，向外偏罚 2 倍；
- 内外侧判定：右转弧内收 = e > 0 侧（弯心在右），左转弧反之（e 为右正横向偏差，由 `createNearestSeeker` 局部最近点求取）；
- 航向抖动项取相邻步 Δθ 二阶差分，罚突变/振荡，保证过弯圆润；
- 选优顺序：先比能否完赛（失控判停不触发），再比 J 最小，再比完赛时间最短。

该目标函数的物理含义：把"快且稳"的驾驶经验形式化——直线不晃、弯道切弯但不冲出、姿态平滑。

### FR-10　循迹控制区（TrackingPanel）交互（✅）

- 位置：右侧面板第 6 区（全程扫描之后、电感布局之前，2026-08-03 上移；Home 将 `<TrackingPanel>` 以 `trackingSlot` 传入 SensorPanel 渲染）。
- 内容：循迹开关、误差公式文本框、A/B/C/P 权重、Kp/Kd（含"⚙ 一键调 PID"）、基础/上限速度、差速权重 w、轮距 W、步长 dt、电机时间常数 τ_m（2026-08-12 新增）、初始扰动、失控阈值。
- ✅ 以上任一参数（含公式本身）修改后，**小车轨迹同步重算并在画布上刷新**（防抖 ~200ms），无需手动触发。
- 参数标定来源：τ_m、W、v_base 等整车参数均为名义先验值，由实车实验标定回填（实验规程见 `specs/research/2026-08-13-experiment-modeling.md` 实验 4/5；数据接口见 `specs/features/07-persistence-export/requirements.md` 接口③）。

### FR-11　参数输入方式（✅，2026-08-03 输入方式变更已落地）

- **差速比 w、轮距 W、步长 dt、电机时间常数 τ_m、初始扰动（initE / initPsi）共 6 项**（τ_m 于 2026-08-12 新增）：数字输入框直接键入（失焦/Enter 提交，合法范围钳位与单位标注）；
- **其余滑块参数**：滑块两端的最大/最小值为可点击编辑的小输入框，用户可自定义量程（自定义量程随 appState v6 `trackingRanges` 持久化，见 `specs/features/07-persistence-export/requirements.md`）；当前值仍可滑块拖动、也可点数值直接键入（越界钳位到量程）；改量程后当前值越界时自动钳入；
- 实现：`TrackingPanel.tsx` 的 `SliderField`（量程编辑）+ `NumberField`（直输）+ `MiniNum`（失焦提交小输入；2026-08-15 提取为共享组件 `src/components/ui/mini-num.tsx`）。

全参数表（默认值 / 输入方式 / 钳位范围）见下文"接口约定"。

### FR-12　一键调 PID 交互（✅）

- TrackingPanel "⚙ 一键调 PID"按钮，自动整定 Kp/Kd——在当前赛道/电感布局/其他参数不变的前提下，于给定范围内网格搜索 (Kp, Kd) 组合（粗搜 13×11 + 最优邻域 9×9 局部细化，分块让出事件循环并显示进度），逐组跑循迹仿真，选出最优组合并自动填入；搜索上限 Kp≤/Kd≤ 可在按钮旁设置（默认 30 / 5）。
- ✅ 目标函数（2026-08-03 起）为**轨迹形状贴合**（直线贴中线、弯道内收圆润、外偏双倍罚、罚航向抖动），弯道内收上限 e_in_max 默认 50 mm、按钮旁可调；公式与选优顺序见 FR-9 式 (8.11)。
- 评价在主线程随网格搜索同步进行，逐轨迹点用局部最近点查询（`createNearestSeeker`，O(窗口)）避免全局最近点开销，分块让出事件循环保持 UI 响应。

### FR-13　位姿来源切换（✅，2026-08-02 新增）

- 车体位姿面板增加**位姿来源**切换：`手动位姿` / `跟随仿真轨迹`。
- `手动位姿`：现状（s/e/ψ 滑块直接驱动车体）。
- `跟随仿真轨迹`：车体改为沿循迹闭环轨迹摆放——轨迹进度滑块（时间 t，上限取冲线点）取轨迹对应记录的 (x, y, θ)；s/e/ψ 由 `nearestOnPath()` + `signedLateralDistance()` 反算显示为只读（ψ 反算约定见 `specs/features/03-sensor-model/requirements.md` 式 (6.9)）；读数剖面图、画布车框、全程扫描"当前"竖线随轨迹进度联动。
- 前提：循迹开关 `tracking.enabled` 打开且有有效轨迹；否则该选项置灰并提示（来源停留在轨迹模式时自动回退手动位姿计算）。
- 位姿来源模式与轨迹进度入 appState 持久化（v5）。
- 图表点击数据点可自动切换来源并定位（见 `specs/features/06-ui-charts-panels/requirements.md` 点击联动车位）。

### FR-14　循迹结果显示（✅）

- **画布叠加**：轨迹线（闭环赛道时仅一圈）、当前车框、电感位置、冲线/失控标记。
- **TrackingPanel 内曲线**：Err(t)、轮速(t)（可放大、可浮动、可点击联动，见 `specs/features/06-ui-charts-panels/requirements.md`）与结果摘要（状态、用时、弧长、步数）。
- **循迹轨迹电感值图**（TrackingSensorChart，2026-08-03 新增）：全程扫描区双图之②，车体在轨迹实际位姿上读到的各电感 U，横轴可选时间 t 或轨迹弧长 s，竖线标记当前 trajT，数据取到冲线点 finishIndex；循迹未开启/无有效轨迹时给空态提示。数据直接取循迹仿真结果 `TrackingResult.sensorU`（数据整理，无新增物理计算）。

### FR-15　循迹轨迹 CSV 导出（接口②）（✅）

顶栏"导出"菜单导出循迹轨迹 CSV（`exportTrackingCSV()`），逐时间步一行；作为实车循迹日志（接口④）的对照基准文件。列格式见下文"接口约定"；接口①–④ 汇总见 `specs/features/07-persistence-export/requirements.md`。

## 技术约束

- **TC-1**：SI 单位内部计算（m、rad、s、m/s）；界面显示/输入用 mm、°、ms、m/s，换算在 UI 层完成（`specs/techstack.md` 硬性约束 1）。
- **TC-2**：控制与运动学内核（`src/mathmodel/control.ts`、`kinematics.ts`）为纯计算层，禁止 UI / React / DOM 依赖；`simulateTracking()` 的读数经 `readSensor` 回调由调用方按当前数据源注入（仿真源 / 实测源），内核不感知数据源（`specs/techstack.md` 硬性约束 2）。
- **TC-3**：误差表达式解析禁用 `eval`，走递归下降解析 `compileFormula()`（`specs/techstack.md` 硬性约束 5）。
- **TC-4**：循迹参数持久化于 appState v6 `tracking`（公式文本/A/B/C/P/Kp/Kd/vBase/vMax/w/wheelBase/dtMs/motorTauMs/initE/initPsi/errLimit/errLimitSteps）与滑块自定义量程 `trackingRanges`；motorTauMs（2026-08-12 新增）依赖逐字段回退默认值，**未升版本号**——新增字段优先逐字段回退的先例即此（`specs/techstack.md` 硬性约束 3）。
- **TC-5**：性能——整条轨迹在主线程同步积分（数百~数千步 × 每步电感数个单点场计算，毫秒级）；一键整定的轨迹评价用 `createNearestSeeker` O(窗口) 局部最近点查询，避免全局最近点 O(步数×采样点) 开销；网格搜索分块 `setTimeout(0)` 让出事件循环。
- **TC-6**：数值稳健——dt 下限 0.5 ms（`Math.max(dtMs, 0.5)`）；轮距下限防除零（`Math.max(W, 1e-4)`）；精确更新式 (8.7) 对任意 dt/τ_m 稳定；公式求值非法 / 位姿 NaN 防护（FR-3 / FR-8）。

## 接口约定

### 代码落点

| 文件 | 内容 |
|---|---|
| `src/mathmodel/control.ts` | `TrackingParams`、`DEFAULT_TRACKING`、`DEFAULT_FORMULA`、`compileFormula()` → `CompiledFormula{variables, eval(vars)}`、`pdOutput()`、`wheelSpeeds()`、`motorLag()` |
| `src/mathmodel/kinematics.ts` | `CarState{x,y,theta}`、`stepCar()`（半隐式欧拉）、`carFrame()`、`TrackingResult`、`simulateTracking()`、常量 `FINISH_TOLERANCE_M = 0.5`、`MAX_TRACKING_STEPS = 100000` |
| `src/components/TrackingPanel.tsx` | 循迹控制区 UI（`SliderField` / `NumberField` / `MiniNum`、公式文本框、一键调 PID 按钮与 Kp≤/Kd≤/内收≤ 设置、Err(t)/轮速(t) 曲线与结果摘要） |
| `src/components/TrackingSensorChart.tsx` | 循迹轨迹电感值折线图（横轴 t / 弧长 s） |
| `src/pages/Home.tsx` | 轨迹同步重算（防抖 ~200ms，`trackingTick`）、`runAutoTune()`（网格搜索 + 式 (8.11) 评价 + `segSpans`）、位姿来源编排 |
| `src/utils/exporters.ts` | `exportTrackingCSV()`（接口②） |
| `src/utils/appState.ts` | `tracking` / `trackingRanges` 字段持久化与逐字段回退 |

### `DEFAULT_TRACKING` 全参数表（默认值 + 范围）

| 参数（字段） | 默认（`DEFAULT_TRACKING`） | 输入方式（✅ 现行） | 钳位 / 默认滑块量程 |
|---|---|---|---|
| 循迹开关 `enabled` | false | 开关 | — |
| 误差公式文本 `formula` | `(A*(L1-R1)+B*(L2-R2))/(A*(L1+R1)+C*abs(L2-R2))*P` | 文本框 | 非法回退默认公式 |
| A / B / C | 1 / 1 / 1 | 滑块，**最大/最小值可输入** | 默认量程 0–10（步 0.1） |
| P | 1 | 滑块，**最大/最小值可输入** | 默认量程 0–20（步 0.1） |
| kp / kd | 0.5 / 0.05 | 滑块（✅ 一键整定），**最大/最小值可输入** | 默认量程 0–30（步 0.05）/ 0–5（步 0.01） |
| vBase / vMax | 1.0 / 2.0 m/s | 滑块，**最大/最小值可输入** | 默认量程 0.1–3 / 0.2–5 m/s；当前值下限钳 0.05 / 0.1 |
| w | 1.5 | **纯数字直接输入（无滑块）** | 钳位 (0, 99] |
| wheelBase W | 0.135 m | **纯数字直接输入（无滑块，单位 mm）** | 钳位 50–500 mm |
| dtMs | 5 ms | **纯数字直接输入（无滑块）** | 钳位 0.5–50 ms |
| motorTauMs | 30 ms | **纯数字直接输入（无滑块）** | 钳位 0–500 ms（0 = 无滞后，模型见 FR-6，2026-08-12 新增） |
| initEMm / initPsiDeg | 0 / 0 | **纯数字直接输入（无滑块）** | 钳位 ±500 mm / ±90° |
| errLimit / errLimitSteps | 2 / 200 步 | 滑块，**最大/最小值可输入** | 默认量程 0.1–5（步 0.1）/ 10–1000（步 10）；当前值下限钳 0.01 / 1 |

一键调 PID 设置（按钮旁，会话内 `useState`，不入 appState）：`Kp≤` 默认 30（1–200）、`Kd≤` 默认 5（0.1–50）、`内收≤` e_in_max 默认 50 mm（0–200）。

### `TrackingResult` 结构（`kinematics.ts`）

```ts
interface TrackingResult {
  status: 'finished' | 'lost' | 'maxSteps';
  t: number[];      // 各时间步记录（长度 = 步数）
  x: number[]; y: number[]; theta: number[];
  vL: number[]; vR: number[];   // 电机滞后后的实际轮速
  err: number[];
  sensorU: { name: string; values: number[] }[]; // 每个电感一条 U(t)（名称可能带 * 回退标注）
  timeS: number;    // 仿真用时（s）
  distM: number;    // 行驶弧长（m）
  steps: number;    // 步数
  elapsedMs: number;// 实际计算耗时（ms）
  finishIndex: number; // 首次跑满赛道总长的记录索引；未跑满时为最后一步
}
```

### 轨迹 CSV 列（接口②，`exportTrackingCSV()`）

- 数据表头行：`t(s),x(m),y(m),theta(rad),v_L(m/s),v_R(m/s),Err,{电感名}_U(Vpp)…`（每电感一列，名称可能带 `*` 回退标注）。
- 表头前 5 行 `#` 注释：①导出标题；②赛道名 / 电流 mA / 数据源 / 赛道总长 mm；③结果（跑完全程 / 失控判停 / 达到步数上限）、步数、用时 s、行驶弧长 mm；④公式文本；⑤`A B C P Kp Kd v_base v_max w W dt 初始e 初始psi` 全参数快照；⑥导出时间。
- 数值精度：t 3 位、x/y 4 位、θ 5 位、v_L/v_R 4 位、Err 5 位、U 4 位小数；逐时间步一行；UTF-8 带 BOM（Excel 友好）；文件名 `tracking-trajectory-{时间戳}.csv`。
- 轮速列为**实际**轮速（电机滞后后）；该文件是实车循迹日志（接口④）的对照基准，接口④ 与之同构（x/y/θ 缺省时由轮速按式 (8.9) 离线积分重建），见 `specs/features/07-persistence-export/requirements.md` 与 `specs/features/10-vehicle-log-compare/`。

### UI 交互约定

- 任一循迹参数（含公式）修改 → 防抖 ~200ms 重算轨迹并刷新画布/曲线/摘要。
- 位姿来源切换：`跟随仿真轨迹` 在循迹未开启或无有效轨迹时置灰提示；来源停留在轨迹模式而失去有效轨迹时自动回退手动位姿计算；来源与轨迹进度 trajT 入 appState（v5 起）。
- 一键调 PID 期间按钮显示进度百分比并禁用；无可行解（全部失控/步数上限）时返回 null 并提示。

## 非目标（Non-goals）

- 实车嵌入式控制代码（`specs/mission.md` 范围外——本功能控制律仅用于仿真调参）。
- 实车循迹日志程序内对比视图（接口④ 的处理，属 Phase 10 `10-vehicle-log-compare`，🧪 待实车数据）。
- SerialSource 串口直采实车 ADC（属 Phase 11 `11-serial-source`，预留方向）。
- 程序内参数自动辨识（τ_m / W / v_base 等的辨识走接口③ 线下汇总处理后数字直输回填，🧪 约定已生效，见 `specs/research/2026-08-13-experiment-modeling.md`）。
- 左右轮分别建模的电机滞后（实验 4 判据规定双轮 τ_m 相差 ≥ 30% 时排查后再议；当前模型双轮共用 τ_m）。
- 轨迹预测/预瞄控制、路径规划等实车未使用的控制结构。
