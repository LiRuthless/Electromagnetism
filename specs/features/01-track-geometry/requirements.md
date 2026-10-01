# Phase 1: 赛道几何模型与铺设编辑 — 需求

> 状态标记：✅ 已实现（本功能主体全部 ✅，与 `em-field-studio/src/mathmodel/track.ts` 等代码一致）。关联 [`plan.md`](plan.md) / [`validation.md`](validation.md)。

## 功能需求

### 全局坐标系与符号约定（原《数学模型.md》§3，全文收录——本规约是全局坐标系/符号约定的家）

- FR-1（坐标系约定，✅）：全部 feature 规约与代码注释共用下表约定：

| 坐标系 | 约定 |
|---|---|
| 世界系 | z 竖直向上，导线贴地（z = 0）；段序列从原点 (0, 0) 出发，初始航向 +y，电流沿段序列方向流动 |
| 车体系 | x 向右，y 向前（车头），z 向上 |

- FR-2（单位与主要符号，✅）：计算一律采用 SI 单位（m、rad、T、A，[`techstack.md`](../../techstack.md) 硬性约束 1）；界面显示用 mm / Vpp。主要符号表为全局约定：

| 符号 | 含义 | 单位 / 默认 |
|---|---|---|
| I | 赛道电流幅值 | A，默认 0.1 |
| μ₀ | 真空磁导率 4π×10⁻⁷ | H/m |
| **B** = (Bx, By, Bz) | 磁感应强度矢量 | T |
| d | 电感到赛道的（有符号）横向距离 / 场点到直线段的垂直距离 | mm / m，右正 |
| k | 电感标定系数 | V/T |
| U | 电感检波输出（等效峰峰值 Vpp） | V |
| **n̂** | 电感敏感轴单位向量 | — |
| s | 沿赛道中线的累计弧长 | m / mm |
| e | 车体横向偏差（> 0 向右偏） | m / mm |
| ψ | 车体航向角偏差（> 0 向右偏，顺时针） | rad |
| θ | 车体绝对航向角（世界系，从 +x 起算） | rad |
| (x, y, θ) | 循迹仿真中的车体平面位姿 | — |
| Err | 循迹误差（差比和差加权输出） | — |
| Kp, Kd | PD 控制比例 / 微分系数 | 默认 0.5 / 0.05 |
| τ_m | 电机一阶滞后时间常数 | ms，默认 30（0 = 无滞后，先验值，实验 4 辨识） |
| v_L, v_R | 左 / 右轮线速度 | m/s |
| v_base, v_max | 基础速度 / 轮速上限 | m/s，默认 1.0 / 2.0（实验 5 标定） |
| w | 差速权重（内轮变化量 : 外轮变化量 = w : 1） | 默认 1.5 |
| W | 轮距 | m，默认 0.135（实验 5 标定） |
| dt | 控制 / 积分步长 | s，默认 5 ms |
| A, B, C, P | 误差公式加权系数 | 默认均为 1 |

表中"实验 n"均指 [`specs/research/2026-08-13-experiment-modeling.md`](../../research/2026-08-13-experiment-modeling.md) 中的实验编号。

### 段序列表示（原《数学模型.md》§4.1）

- FR-3（段序列与笔尖递推，✅）：赛道中线建模为**有序段序列** `SegDef[]`，从原点出发逐段接续，仅含两种段：
  - **直线段** `line`：长度 ℓ + 可选绝对方向角 `absAngle`（鼠标连线产生尖角时使用）+ 可选出段航向覆盖 `exitAngle`（仅正六边形环岛末边用）；
  - **圆弧段** `arc`：半径 R + 圆心角 α（度）+ 转向（left / right），沿当前切线方向接续。

设第 i 段起点位形为（xᵢ, yᵢ, φᵢ）（"笔尖"状态），则直线段终点位形为：

<a id="eq-4-1"></a>
$$(x_i+\ell\cos\varphi_i,\;y_i+\ell\sin\varphi_i,\;\varphi_i) \tag{4.1}$$

圆弧段（右转取负号）终点位形为：

<a id="eq-4-2"></a>
$$\varphi_{i+1}=\varphi_i\pm\alpha,\qquad \begin{pmatrix}x_{i+1}\\y_{i+1}\end{pmatrix}=\begin{pmatrix}x_i\\y_i\end{pmatrix}\mp R\begin{pmatrix}\sin\varphi_{i+1}-\sin\varphi_i\\-\cos\varphi_{i+1}+\cos\varphi_i\end{pmatrix} \tag{4.2}$$

其中，ℓ 为直线段长度，R 为圆弧半径，α 为圆心角，φ 为航向角。式 [(4.1)](#eq-4-1)[(4.2)](#eq-4-2) 即代码 `advancePen()` 的数学内容；整条赛道由递推 `trackTip()` 确定终点。

### 离散化与路径采样（原《数学模型.md》§4.2）

- FR-4（双套离散化，✅）：场计算与路径采样使用两套离散化：
  - `buildElements()`：全部段按最大段长 **MAX_DS = 1 cm** 切碎为电流元（渲染、路径采样、段数展示用）；
  - `buildFieldElements()`：**场计算专用**——直线段不切碎，走闭式积分（精确，公式见 [`specs/features/02-magnetic-field/requirements.md`](../02-magnetic-field/requirements.md) 式 [(5.2)](../02-magnetic-field/requirements.md#eq-5-2)）；仅圆弧段保持 ≤ 1 cm 离散（离散积分相对闭式解误差 < 0.1%，自检 [9]，判据见 [`specs/features/02-magnetic-field/validation.md`](../02-magnetic-field/validation.md)）。
- FR-5（中线采样，✅）：`samplePath()` 按 5 mm 步进输出点列、单位切向与累计弧长；`pointAtLength(path, s)` 由弧长取点（线性插值，clamp 到端点）。

### 闭环条件（原《数学模型.md》§4.3）

- FR-6（闭环赛道，✅）：`TrackDef` 含闭环标志 `closed`。记段序列终点为 **p**_end、起点为原点，闭环允许条件为：

<a id="eq-4-3"></a>
$$g=\lVert \mathbf p_{end}\rVert\le g_0,\qquad g_0=\texttt{CLOSE\_SNAP\_M}=20\ \text{mm} \tag{4.3}$$

其中 g 即代码 `closureGapM()`；勾选闭环后若段被修改导致 g 超阈值，自动取消闭环。闭环时离散化自动补一段终点 → 起点的**吸合段**（长度 ≤ g₀，按直线段闭式积分处理），中线采样形成闭合回路，总长 = 单圈长度。闭环赛道的循迹仿真仅生成一圈轨迹（终止条件见 [`specs/features/05-tracking-control/requirements.md`](../05-tracking-control/requirements.md) 式 [(8.10)](../05-tracking-control/requirements.md#eq-8-10)）。

### 形状工具与辅助几何量（原《数学模型.md》§4.4）

- FR-7（形状工具，✅）：形状工具生成后仍是普通段序列：
  - `rightAngleSeg()`：直角弯——尖角转 ±90° 的直线段（`absAngle`）；
  - `hexagonSegs()`：正六边形环岛——入环边偏转 30°（无贴边），绕环一周回到入环顶点，末边经 `exitAngle` 恢复入环航向直行出环；边长 a 时周长 = 6a（自检 [6] 验证，见 [`validation.md`](validation.md)）；
  - `lineSegTo()`：鼠标连线段（笔尖 → 目标点，< 5 mm 忽略）。
- FR-8（辅助几何量，✅）：`cornerRulers()` 给出各转角顶点（相邻段切向夹角 > 5°）两侧沿切向的标尺方向与长度（标称 300 mm，短段按实际段长截断，圆弧侧沿顶点切线画直标尺），供画布叠加（交互见 FR-17/FR-18）；`createNearestSeeker()` 提供连续轨迹的 O(窗口) 局部最近点查询与有符号横向偏差（右正），供一键整定目标函数逐点评价（[`specs/features/05-tracking-control/requirements.md`](../05-tracking-control/requirements.md) 式 [(8.11)](../05-tracking-control/requirements.md#eq-8-11)）。

### 铺设编辑交互（原《程序设计说明.md》§3.1 TrackEditor，本功能范围部分）

- FR-9（编辑方式，✅）：左侧面板 TrackEditor 两个编辑 Tab：`鼠标铺设`（主）/ `段列表查看`（只读——逐段显示"#n 直线 ℓmm ∠θ°"或"#n 圆弧 R…mm α°左/右 弧长…mm"，不提供编辑）。
- FR-10（直线连线子模式，✅）：画布单击 / Enter 逐点连线（顶点吸附 10 mm）；键入数字锁定长度/角度（CAD 风格动态输入，Tab 切换输入框）；双击 / Esc 结束；结束后单击画布可继续铺设。
- FR-11（圆弧段子模式，✅）：半径滑块（50–2000 mm，10 mm 步进）+ 圆心角（30/45/60/90/120/180° 按钮或 1–360° 输入）+ 左/右转；"铺设该圆弧"沿当前切线接续，画布显示虚影预览。
- FR-12（形状工具入口，✅）：直角弯（边长 mm，左/右转 90°）；正六边形环岛（边长 mm，左/右环）；均从当前笔尖接续，几何构造对应 FR-7。
- FR-13（撤销/清空与段长标注，✅）：撤销一段（移除末段）/ 清空重铺；段长标注开关控制画布各段中点处的段长数字（开关状态随 appState 持久化，默认关，见 [`specs/features/07-persistence-export/requirements.md`](../07-persistence-export/requirements.md)）。
- FR-14（闭环勾选 UI，✅）：闭环赛道（首尾相连）开关实时显示终点距起点距离（mm），≤ 20 mm 可勾选、超出置灰并提示"终点距起点超过 20mm，无法闭环"；勾选后段被改导致超阈值自动取消闭环（几何条件同 FR-6 式 [(4.3)](#eq-4-3)）。
- FR-15（赛道库，✅）：localStorage 独立 key `em-field-studio/track-library`，保存 / 载入 / 改名 / 删除当前赛道；导出 / 导入赛道 JSON（携带闭环标志 closed）；"恢复默认"不清赛道库（[`techstack.md`](../../techstack.md) 数据存储约定）。
- FR-16（计算状态显示，✅）：显示离散电流元段数、网格单元数（上限 160k，超出自动降档到 5mm 整数档并提示）、赛道总长、上次重算耗时。

### 转角刻度（原《程序设计说明.md》§3.2 转角刻度小节，全文）

- FR-17（转角刻度标尺，✅）：在赛道每个**转角顶点**（相邻段方向变化处，含闭环吸合处的顶点）沿相接两段、从顶点向两端各画一条刻度标尺，标称长度 **300 mm**（带 100 mm 分度 tick 与端点标注）；相接段长度 < 300 mm 时，该侧标尺只画到段端为止（按实际段长显示）；判定"转角"：相邻段切向夹角 > 5°（尖角）即标注；圆弧段内部不逐点标，仅在段与段的接缝顶点标；**补充约定（实现时具体化）**：圆弧侧标尺沿顶点**切线方向画直标尺**，长度按段弧长截断。
- FR-18（转角刻度开关，✅）：画布右下角"转角刻度"开关独立控制（默认开，会话内状态，不参与持久化），标尺随视图缩放平移联动，不遮挡段长标注；实现为 `mathmodel/track.ts cornerRulers()` 计算顶点与两侧切向/段长截断，`FieldCanvas.tsx` 叠加层绘制。

## 技术约束

- TC-1：内部计算一律 SI 单位（m、rad、T、A），仅界面显示用 mm / Vpp（[`techstack.md`](../../techstack.md) 硬性约束 1）。
- TC-2：`src/mathmodel/track.ts` 为纯计算层，禁止任何 UI / React / DOM 依赖（[`techstack.md`](../../techstack.md) 硬性约束 2）；公式或默认值改动必须同步本规约，且三组自检 + `npm run build` 全过才可回填状态标记（[`techstack.md`](../../techstack.md) 测试策略）。
- TC-3：式 [(4.1)](#eq-4-1)[(4.2)](#eq-4-2)[(4.3)](#eq-4-3) 的编号与 LaTeX 表述冻结——`em-field-studio` 与 `matlab-simulink/` 代码注释引用这些编号，禁止重编号或改写（[`techstack.md`](../../techstack.md) 目录与代码规范）。
- TC-4：关键几何常量（改动视为模型变更，须同步本规约与自检）：`MAX_DS = 0.01` m（离散小段最大长度）、`CLOSE_SNAP_M = 0.02` m（闭环吸合阈值）、`samplePath()` 默认步进 0.005 m、`lineSegTo()` 忽略阈值 0.005 m、鼠标铺设顶点吸附 10 mm、转角判定 `minAngleDeg = 5`°、标尺标称长度 `rulerM = 0.3` m（100 mm 分度）。
- TC-5：持久化边界——赛道定义（含 closed 标志）与编辑/铺设工具状态（editMode / layMode / placing / showSegLengths / arcPending）随 appState v6 持久化（闭环标志自 v5 加入）；转角刻度开关**不持久化**（会话内）。schema 纪律见 [`techstack.md`](../../techstack.md) 硬性约束 3 与 [`specs/features/07-persistence-export/requirements.md`](../07-persistence-export/requirements.md)。
- TC-6：赛道库 key `em-field-studio/track-library` 与 appState 解耦、互不影响，"恢复默认"不清（[`techstack.md`](../../techstack.md) 数据存储）。
- TC-7：闭环赛道的"循迹仅一圈"行为由几何层向 05-tracking-control 传入 `closed` 实现（终止判据式 [(8.10)](../05-tracking-control/requirements.md#eq-8-10)），几何层不复制该逻辑。

## 接口约定

### 代码落点

| 文件 | 职责 |
|---|---|
| `em-field-studio/src/mathmodel/track.ts` | 几何核心（纯计算）：段序列 → 离散电流元 / 路径采样 / 闭环吸合 / 形状工具 / 转角刻度 / 局部最近点查询 |
| `em-field-studio/src/components/TrackEditor.tsx` | 左侧面板：铺设工具、形状工具、闭环勾选、撤销/清空、段长标注、赛道库、计算状态 |
| `em-field-studio/src/components/FieldCanvas.tsx` | 中央画布：铺设交互渲染（笔尖/虚影/动态输入框）、段长标注、转角刻度叠加层与右下角开关 |
| `em-field-studio/src/pages/Home.tsx` | 状态编排：`closureGapMm` 计算、闭环勾选/自动取消、`cornerRulers()` 调用、赛道库操作 |
| `em-field-studio/src/utils/exporters.ts` | 赛道库 localStorage 持久化（`loadLibrary()`/`saveLibrary()`）与赛道 JSON 导出/导入（`exportTrackJSON()`/`parseTrackJSON()`） |

### 数据结构（`src/mathmodel/track.ts`）

```ts
export const MAX_DS = 0.01;        // 离散小段最大长度 1 cm
export const WIRE_DIAMETER = 0.0005; // 真实电磁线直径 0.5 mm（仅物理说明，不影响场计算）
export const CLOSE_SNAP_M = 0.02;  // 闭环吸合阈值 20 mm

export interface LineSegDef {
  kind: 'line';
  length: number;      // m
  absAngle?: number;   // 绝对方向（rad，从 +x 起算）：鼠标连线尖角用；缺省沿当前航向
  exitAngle?: number;  // 出段航向覆盖（rad）：仅正六边形环岛末边用
}
export interface ArcSegDef {
  kind: 'arc';
  radius: number;      // m
  angleDeg: number;    // 圆心角（度，>0）
  turn: 'left' | 'right';
}
export type SegDef = LineSegDef | ArcSegDef;

export interface TrackDef {
  name: string;
  segments: SegDef[];
  extraWires?: [number, number][][]; // 附加独立导线（如十字支线）点列，仅随旧格式 JSON 载入
  closed?: boolean;                  // 闭环赛道（首尾相连），式 (4.3)
}
```

派生结构：`Elements`（离散电流元：`mids`/`dls` 扁平 xyz 数组 + 可选 `wires` 闭式直线段表）、`PathSample`（`pts`/`tang`/`s`/`length`）、`PenState`（笔尖 `{x, y, phi}`，`PEN_START = {x:0, y:0, phi:π/2}`）、`SegSummary`（段长 + 几何中点）、`CornerRuler`（顶点 + 两侧标尺方向/截断长度 + 转角角度）。

### track.ts 导出函数清单

| 导出 | 用途 | 关联 |
|---|---|---|
| `buildElements(def, maxDs?)` | 全段 ≤1 cm 离散为电流元（渲染/采样/段数） | FR-4 |
| `buildFieldElements(def)` | 场计算专用：直线段闭式（入 `wires`）、圆弧 ≤1 cm 离散 | FR-4，02 式 [(5.2)](../02-magnetic-field/requirements.md#eq-5-2) |
| `samplePath(def, ds?)` | 中线 5 mm 采样：点列/单位切向/累计弧长 | FR-5 |
| `pointAtLength(path, s)` | 由弧长取点（线性插值，clamp 端点） | FR-5 |
| `advancePen(seg, pen)` / `trackTip(segments)` | 单段/整列笔尖位形递推 | 式 [(4.1)](#eq-4-1)[(4.2)](#eq-4-2) |
| `segmentLength(seg)` / `segmentSummaries(segments)` | 段弧长（直线=ℓ，圆弧=R·α）/ 各段摘要（段长标注用） | FR-13 |
| `previewSegment(seg, pen, n?)` | 单段预览折线（铺设虚影） | FR-11 |
| `rightAngleSeg(tip, lengthM, dir)` / `hexagonSegs(tip, edgeM, dir)` / `lineSegTo(tip, x, y)` | 形状工具 | FR-7 |
| `closureGapM(segments)` / `canCloseTrack(segments)` | 闭环缝隙 / 闭环允许条件 | 式 [(4.3)](#eq-4-3) |
| `nearestOnPath(path, x, y)` | 全局最近中线参考点（细分插值），供"跟随仿真轨迹"位姿反算 | 05（程§4.4） |
| `cornerRulers(segments, closed?, rulerM?, minAngleDeg?)` | 转角刻度标尺计算 | FR-17 |
| `createNearestSeeker(path, window?, farM?)` | 连续轨迹 O(窗口) 局部最近点 + 有符号横向偏差 | FR-8，05 式 [(8.11)](../05-tracking-control/requirements.md#eq-8-11) |

### 赛道 JSON 与赛道库

- 赛道 JSON = `TrackDef` 序列化（`exportTrackJSON()`，文件名 `track-<name>.json`）；导入 `parseTrackJSON()` 校验 `segments` 数组与 `kind ∈ {line, arc}`，`closed === true` 时携带闭环标志，`extraWires` 为数组时保留。
- 赛道库条目 `SavedTrack { name: string; def: TrackDef; savedAt: string }`，localStorage key `em-field-studio/track-library`，列表显示总长与保存日期。

### UI 交互约定

- TrackEditor 面板自上而下：编辑方式 Tab → 鼠标铺设区（直线连线/圆弧段子模式 + 形状工具 + 撤销/清空 + 闭环勾选）→ 段长标注开关 → 赛道库 → 物理参数 → 计算状态。
- **物理参数面板（电流 I 20–200 mA、观测平面高度 h 20–120 mm、网格步长 5/10/20 mm、显示分量 Bz/Bx/|B|、|B| 对数色标、线径 0.5 mm 物理说明）见 [`specs/features/02-magnetic-field/requirements.md`](../02-magnetic-field/requirements.md)。**
- 面板级 UI 机制（左侧面板收起为 32px 窄条、拖拽调宽、分区卡片化）属 [`specs/features/06-ui-charts-panels/requirements.md`](../06-ui-charts-panels/requirements.md)，本规约不覆盖。
- 转角刻度开关位于画布右下角，仅当存在转角顶点时显示；默认开、会话内状态。

## 非目标（Non-goals）

- 物理参数面板（电流/观测高度/网格步长/显示分量/对数色标）与磁场计算本身（毕奥-萨伐尔积分、闭式解、奇异截断、网格批算、Web Worker 调度）——归 `specs/features/02-magnetic-field/`。
- 面板收起/拖拽调宽/分区卡片化、画布热力图/等值线/悬停探针/视图缩放平移、循迹轨迹叠加等通用界面能力——归 `specs/features/06-ui-charts-panels/`。
- 闭环赛道"循迹仅一圈"的终止判据与一键整定目标函数——归 `specs/features/05-tracking-control/`（本功能仅提供 `closed` 输入与 `createNearestSeeker()`）。
- 圆角过渡段类型（尖角近似已足够，见 [`plan.md`](plan.md) 风险与取舍）。
- 圆形环岛（环岛一律按正六边形建模）。
- 段列表内的段直接编辑（段列表只读；修改经鼠标铺设撤销/清空或导入 JSON）。
- 附加独立导线 `extraWires` 的界面编辑（仅随旧格式 JSON 载入保留并在段列表提示）。
