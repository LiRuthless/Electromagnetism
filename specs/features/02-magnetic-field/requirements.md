# Phase 2: 磁场计算与网格调度 — 需求

> ✅ 本功能主体已实现（与 `em-field-studio/src/mathmodel/field.ts`、`src/workers/fieldWorker.ts`、`src/hooks/useFieldGrid.ts` 代码一致）。关联 [`plan.md`](plan.md)。
> 公式保留归档《数学模型.md》§5 的"式 (x.y)"编号与原 LaTeX 表述——`matlab-simulink/` 与 `em-field-studio/` 代码注释引用这些编号，禁止重编号或改写。

## 功能需求

### FR-1: 建模假设（1/2/3）与单位约定 ✅

对磁场计算作如下三条简化假设。**每条假设均给出成立理由，并由实验（[`specs/research/2026-08-13-experiment-modeling.md`](../../research/2026-08-13-experiment-modeling.md)）与自动化自检（见本目录 [`validation.md`](validation.md)）逐项回环确认其精度与适用边界。**（点探头近似——假设 4——属电感响应环节，见 `specs/features/03-sensor-model/`。）

**假设 1（准静态近似）**：20 kHz 交变磁场按静磁场处理，以电流幅值 I 计算磁场幅值。
*理由*：20 kHz 电磁波波长约 15 km，远大于 cm 级探测尺度，位移电流与辐射效应可忽略，磁场瞬时分布与同幅值稳恒电流的静磁场一致。

**假设 2（无限细线电流）**：真实电磁线（直径 0.5 mm）视为无截面几何线电流，线径不参与计算。
*理由*：由安培环路定理，圆截面导线外部的磁场与同轴无限细线电流**严格相同**（仅取决于总电流，与电流在截面内的分布无关）；20 kHz 下铜的趋肤深度约 0.46 mm，趋肤效应改变截面内电流分布但不改变外部磁场。该恒等性由自检 [7] 验证（[`validation.md`](validation.md) V-4）。

**假设 3（尖角近似）**：直角转弯等折线顶点按理想尖点建模，不做圆角过渡。
*理由*：实际转弯处最小弯曲半径约 0.25 mm（线半径量级），远小于 1 cm 的离散粒度与 ≥ 2 cm 的典型探测距离；自检验证在探测尺度下尖角与 0.5 mm 圆角过渡的场值差异 < 0.1%（[`validation.md`](validation.md) V-3）。

**单位约定**：计算一律采用 SI 单位（m、rad、T、A）；界面显示用 mm / Vpp。默认赛道电流幅值 I = 100 mA（界面可调 20–200 mA）。

### FR-2: 毕奥-萨伐尔分段积分（单点磁场 `computeB()`）✅

在上述假设下，贴地载流回路在场点 **P** 处的磁感应强度由毕奥-萨伐尔定律给出。将圆弧段离散为电流元 {d**l**ᵢ，中点 **r**ᵢ}，单点磁场可计算为：

<a id="eq-5-1"></a>
$$\mathbf B(\mathbf P)=\frac{\mu_0 I}{4\pi}\sum_i\frac{d\mathbf l_i\times(\mathbf P-\mathbf r_i)}{\lVert \mathbf P-\mathbf r_i\rVert^{3}} \tag{5.1}$$

其中，μ₀ 为真空磁导率，I 为电流幅值。式 [(5.1)](#eq-5-1) 即代码 `computeB()` 的离散积分部分（直线段部分另按 FR-3 闭式积分叠加）。

### FR-3: 有限长直线段闭式解（精确，`wireSegB()`）✅

直线段不离散，直接以闭式积分代入。对电流元 a → b（均贴地），记线段方向单位矢量 **t̂**，**r**₁ = **P** − a，**r**₂ = **P** − b，**ρ** 为 **P** 到直线的垂直矢量，则：

<a id="eq-5-2"></a>
$$\mathbf B_{seg}(\mathbf P)=\frac{\mu_0 I}{4\pi}\cdot\frac{\hat{\mathbf t}\times\mathbf r_1}{\lvert\rho\rvert^{2}}\left(\frac{\mathbf r_1\cdot\hat{\mathbf t}}{\lVert\mathbf r_1\rVert}-\frac{\mathbf r_2\cdot\hat{\mathbf t}}{\lVert\mathbf r_2\rVert}\right) \tag{5.2}$$

该式与教材常见的下式等价：

<a id="eq-5-3"></a>
$$B=\frac{\mu_0 I}{4\pi d}(\cos\theta_1-\cos\theta_2) \tag{5.3}$$

其中，θ₁、θ₂ 为场点与线段两端连线和线段方向的夹角，d 为垂直距离；方向由式 [(5.2)](#eq-5-2) 的叉积给出。闭式解消除了直线段离散误差（自检 [9] 验证达双精度机器量级 ~10⁻¹⁴，见 [`validation.md`](validation.md) V-6），是场计算精确性的主要来源。对应代码 `wireSegB()`。

### FR-4: 奇异截断（R_MIN = 1 mm）✅

为避免场点落在导线（延长线）上时出现 r → 0 奇异，所有距离按下式截断：

<a id="eq-5-4"></a>
$$r\leftarrow\max(r,\;R_{MIN}),\qquad R_{MIN}=1\ \text{mm} \tag{5.4}$$

该截断等效于给细线电流一个 1 mm 量级的有限半径，在 ≥ 2 cm 探测距离处对场值的影响可忽略。

### FR-5: 解析对照解（`infiniteWireB()`）✅

无限长直导线解析解（自检对照基准）：

<a id="eq-5-5"></a>
$$B(\rho)=\frac{\mu_0 I}{2\pi\rho} \tag{5.5}$$

其中 ρ 为到导线的垂直距离；方向沿 **d** × **ρ̂**。代码 `infiniteWireB()`（导线沿 +y、过原点）。该式表明**长直道中心附近的磁场应趋近 1/ρ 反比衰减**——这是自检 [1][2]（[`validation.md`](validation.md) V-1/V-2）的物理依据，也是 [`specs/research/2026-08-13-experiment-modeling.md`](../../research/2026-08-13-experiment-modeling.md) 实验 6 扫描曲线形状的理论约束。

### FR-6: 观测面网格批算（`computeGrid()` / `computeGridFull()`）✅

观测平面 z = h 上 n_x × n_y 网格的批算与式 [(5.1)](#eq-5-1)[(5.2)](#eq-5-2) 共用同一积分核：`computeGrid()` 输出 Bx / Bz / |B|（画布热力图用），`computeGridFull()` 额外输出 By（CSV 导出用，导出格式见 `specs/features/07-persistence-export/`）。网格在 Web Worker 中分块计算（调度见 FR-8 / FR-9）。

### FR-7: 网格分辨率、上限降档与物理参数界面约定 ✅

- **网格分辨率** = 赛道包围盒（+0.35 m 边距）/ 步长；**硬上限 400×400 = 160k 单元**，超出自动降档到 5 mm 整数档并提示实际生效步长。
- **物理参数**（左侧面板）：电流 I（20–200 mA，默认 100 mA）、观测平面高度 h（20–120 mm）、网格步长（5/10/20 mm，默认 10 mm）、显示分量（Bz / Bx / |B|，默认 Bz）、|B| 对数色标开关（默认开，仅 |B| 分量时显示）；线径 0.5 mm 仅作物理说明展示（由假设 2，线径不参与计算）。
- **计算状态**（默认折叠分区）：离散电流元段数、网格单元数（上限 160k，降档时提示"已自动降档至 X mm"）、赛道总长、上次重算耗时。

### FR-8: Web Worker 分块调度（`fieldWorker.ts`）✅

网格计算走 Web Worker：**每 25 行一块**，每块前 `setTimeout(0)` 让出事件循环实现**协作式取消**（新请求到达即放弃旧任务——`onmessage` 只更新 latestSeq，计算循环在块边界发现自身 seq 过期即中止，旧重任务不堵住新请求）；每块上报进度（百分比与已耗时）。Worker 计算内部异常时向主线程发 error 消息，通知降级兜底。

### FR-9: Worker 生命周期 hook（`useFieldGrid.ts`）✅

- 参数（赛道电流元 / 电流 I / 高度 h / 网格参数）变化后**防抖 180 ms** 重算；
- Worker 用 ref 惰性创建、卸载清理时 terminate 并置空以便重建（修复 React StrictMode 双挂载导致的"进度永远 0%"）；
- **10 s 看门狗**：无进展（进度消息超时）或 Worker 报错 / Worker API 不可用 → **自动降级为主线程同步计算**（`computeGrid`，保证场必出图），状态置 `fallback` 并 console.warn 留痕；
- 计算期间上报状态：computing / progress（0~1）/ runningMs（实时计时）/ elapsedMs（上次完成耗时）。

## 技术约束

- **TC-1**：SI 单位内部计算（m、rad、T、A），仅界面显示用 mm / Vpp（[`specs/techstack.md`](../../techstack.md) 硬性约束 1）。场值一律 Tesla；电流入参单位 A（界面 mA ÷ 1000）。
- **TC-2**：`src/mathmodel/field.ts` 为纯计算层，禁止任何 UI / React / DOM 依赖（[`specs/techstack.md`](../../techstack.md) 硬性约束 2）；公式或默认值（I_DEFAULT、R_MIN、MU0）改动必须同步本规约。
- **TC-3**：网格单元硬上限 400×400 = 160k（性能保护）；超出时只允许"自动降档到 5 mm 整数档 + 提示"，不得截断赛道范围或静默超算。
- **TC-4**：Worker 内积分核与主线程 `computeGrid()` 为同一套公式（离散求和 + `wireSegB` 闭式叠加），两条路径结果须逐点一致（`scripts/test-worker.ts` 抽样 maxDiff < 1e-12 验证）；主线程同步路径仅作降级兜底，非常态路径。
- **TC-5**：网格输出为 Float32Array 行优先扁平数组（`idx = iy * nx + ix`，场点取单元中心 `(i + 0.5) · d`），结果 buffer 经 postMessage Transferable 转移（避免拷贝）。
- **TC-6**：读数与全程扫描在主线程同步计算（毫秒级，不经 Worker）；扫描防抖 250 ms（属 `specs/features/03-sensor-model/`）。循迹闭环整条轨迹也在主线程同步积分（属 `specs/features/05-tracking-control/`）——本功能的 Worker 调度只覆盖观测面网格批算。

## 接口约定

### 代码落点

| 文件 | 内容 |
|---|---|
| `em-field-studio/src/mathmodel/field.ts` | 常量 `MU0 = 4π×10⁻⁷ H/m`、`I_DEFAULT = 0.1 A`、`R_MIN = 1e-3 m`；`wireSegB()` / `computeB()` / `computeGrid()` / `computeGridFull()` / `infiniteWireB()` |
| `em-field-studio/src/workers/fieldWorker.ts` | 网格 Web Worker：分块（CHUNK_ROWS = 25）/ 协作式取消 / 进度上报 |
| `em-field-studio/src/hooks/useFieldGrid.ts` | Worker 生命周期 hook：防抖 180 ms / 看门狗 WATCHDOG_MS = 10000 / 主线程兜底 |
| `em-field-studio/src/pages/Home.tsx` | 网格参数计算：`trackBBox(path, extraWires, 0.35)` 包围盒 + 边距，`GRID_CELL_CAP = 160000`，超上限按 √(nx·ny/上限) 倍率向上取整到 5 mm 档降档 |
| `em-field-studio/src/components/TrackEditor.tsx` | "物理参数"与"计算状态"分区（FR-7）；`GlobalParams { currentMa, heightMm, gridStepMm, component, logScale }` |

### 函数签名与数据结构

- `computeB(px, py, pz, el: Elements, I = I_DEFAULT): [Bx, By, Bz]`——单点 B 矢量，单位 Tesla；`Elements = { mids: Float64Array, dls: Float64Array, count: number, wires?: Float64Array }`（wires 每 4 个数一条闭式直线段 x0,y0,x1,y1，由 Phase 1 `buildFieldElements()` 产出）。
- `wireSegB(px, py, pz, x0, y0, x1, y1, I = I_DEFAULT): [Bx, By, Bz]`——式 [(5.2)](#eq-5-2) 单条直线段；零长线段返回 [0,0,0]。
- `computeGrid(el, I, x0, y0, nx, ny, dx, dy, h): { bx, bz, bmag }`——观测平面 z = h 上网格批算，**输出分量 = Bx / Bz / |B|**（画布热力图三选一显示；**不输出 By**）；Float32Array，行优先，单位 Tesla。
- `computeGridFull(el, I, x0, y0, nx, ny, dx, dy, h): { bx, by, bz, bmag }`——同一积分核，额外输出 By（CSV 导出用）。
- `infiniteWireB(px, py, pz, I = I_DEFAULT): [Bx, By, Bz]`——式 [(5.5)](#eq-5-5)，导线沿 +y、过原点。

### fieldWorker 消息协议

主线程 → Worker（`GridRequest`）：

```ts
{ seq: number; mids: Float64Array; dls: Float64Array; count: number;
  wires?: Float64Array;               // 每 4 个数 (x0,y0,x1,y1)，直线段闭式积分
  I: number; x0: number; y0: number;  // 网格原点（包围盒左下，含 0.35 m 边距）
  nx: number; ny: number; dx: number; dy: number; h: number }
```

Worker → 主线程（`GridOutMsg` 三选一）：

```ts
{ type: 'progress'; seq: number; pct: number; elapsedMs: number }   // 每 25 行块一条，pct ∈ 0~1
{ type: 'result';  seq: number; bx: Float32Array; bz: Float32Array; bmag: Float32Array;
  x0: number; y0: number; nx: number; ny: number; dx: number; dy: number; elapsedMs: number }
                                                  // bx/bz/bmag 的 buffer 以 Transferable 转移
{ type: 'error';   seq: number; message: string }
```

取消语义：**无显式 cancel 消息**——新请求到达即更新 `latestSeq`，计算循环在每块边界（`setTimeout(0)` 让出后）发现自身 seq 过期即中止（不发 result）；主线程侧同样丢弃过期 seq 的消息。`seq` 由主线程单调递增分配。

### useFieldGrid 行为约定

`useFieldGrid(elements, I, h, gridParams, debounceMs = 180): State`，其中 `State = { grid: GridResult | null; computing: boolean; progress: number; runningMs: number; elapsedMs: number; fallback: boolean }`。依赖变化 → 立即置 computing、150 ms 间隔刷新 runningMs → 防抖 180 ms 后发新 seq 请求；progress 消息重置看门狗；result 落盘 grid 并记录 elapsedMs；看门狗（10 s 无进展）/ error / Worker API 不可用 → `fallbackCompute()` 主线程同步算同一请求并置 `fallback = true`。

### UI 交互约定（FR-7 对应）

电流滑块 20–200 mA（步进 5）；高度滑块 20–120 mm（步进 5）；网格步长下拉 5/10/20 mm；显示分量下拉 Bz（竖直）/ Bx（横向）/ |B|（幅值）；对数色标开关仅当选中 |B| 时显示。"计算状态"为可折叠分区、默认折叠（分区卡片体系见 `specs/features/06-ui-charts-panels/`）。顶栏场计算进度（百分比 / 耗时）与磁场网格 CSV 导出分别见 `specs/features/06-ui-charts-panels/` 与 `specs/features/07-persistence-export/`。

## 非目标（Non-goals）

- 不做三维 / 瞬态 / 全波电磁场仿真（[`specs/mission.md`](../../mission.md) 范围外；假设 1 的准静态近似已足够）。
- 不做圆弧段闭式积分——圆弧 ≤ 1 cm 离散相对闭式解误差 < 0.1%（Phase 1 约定），无精度需求驱动。
- 画布热力图不提供 By 分量显示（`computeGrid` 输出裁剪为 Bx / Bz / |B|；By 仅经 `computeGridFull` 供 CSV 导出）。
- 不负责电感读数、全程扫描与循迹仿真的计算调度——它们全部在主线程同步完成（毫秒级），分属 03 / 05 规约；本功能只为观测面网格批算提供 Worker 调度。
- 不做网格自适应加密 / 多分辨率缓存；分辨率仅由"包围盒 + 0.35 m 边距 / 步长 + 160k 上限降档"决定。
