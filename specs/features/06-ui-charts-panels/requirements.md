# Phase 6: 界面图表与面板体系 — 需求

> 本功能为纯 UI/交互层，**不含数学公式**（无"式 (x.y)"条目收录）；涉及的物理量与模型公式见 `specs/features/02-magnetic-field/`、`specs/features/03-sensor-model/`、`specs/features/05-tracking-control/`。

## 功能需求

### 布局与顶栏

- **FR-1 三栏布局** ✅：左侧赛道编辑与物理参数面板（默认宽 330px）｜中央磁场俯视图大画布｜右侧电感面板（默认宽 350px）。折线图可拖出为中央画布上的浮动窗（FR-16）。
- **FR-2 顶栏** ✅：标题 + 赛道总长（mm，闭环时附"闭环赛道（一圈）"标记）；场计算进度（百分比/耗时，完成后显示网格规模与耗时）；**导出**菜单（磁场网格 CSV、电感读数 CSV、画布 PNG、全程扫描 CSV、循迹轨迹 CSV、赛道定义 JSON——各文件格式见 `specs/features/07-persistence-export/`）；**恢复默认**按钮（确认后清工作状态 key，赛道库与面板宽度布局不受影响）。

### 中央画布（FieldCanvas）

- **FR-3 绘制内容** ✅：热力图（turbo 色标用于 |B|，发散蓝-黑-红色标用于 Bz/Bx 带符号分量）+ marching squares 等值线 + 赛道线 + 车体/电感叠加（电感按真实 Ø6mm 绘制）。
- **FR-4 悬停探针** ✅：显示该点 Bx/By/Bz/|B|；悬停在赛道线 <10 mm 时提示真实线径（0.5 mm）。
- **FR-5 视图交互** ✅：滚轮缩放（zoom to cursor）、中键或空格+拖拽平移；视图状态（缩放/平移）参与持久化（`specs/features/07-persistence-export/`）。
- **FR-6 循迹叠加** ✅：绘制小车轨迹线（一圈，闭环赛道时仅一圈）、当前位姿车框、电感位置、冲线点/失控点标记；车框朝向约定见 [`specs/features/03-sensor-model/requirements.md`](../03-sensor-model/requirements.md)（ψ 符号约定）。
- **FR-7 转角刻度叠加** ✅：几何约定（转角判定、300 mm 标尺与截断规则）见 [`specs/features/01-track-geometry/requirements.md`](../01-track-geometry/requirements.md)。画布右下角"转角刻度"开关独立控制（默认开，会话内状态，不参与持久化）；刻度随视图缩放平移联动，不遮挡段长标注；由 `mathmodel/track.ts cornerRulers()` 计算顶点与两侧切向/段长截断，`FieldCanvas.tsx` 叠加层绘制。
- 画布侧还呈现自由铺设交互（笔尖显示、圆弧虚影、CAD 动态输入框）；铺设语义与几何构造属 `specs/features/01-track-geometry/`。

### 面板体系

- **FR-8 左侧栏收起** ✅：侧栏顶部标题栏（"赛道编辑"）加折叠按钮，收起为 32px 窄条（仅留展开按钮与图标）；收起/展开状态随 appState `leftCollapsed` 持久化。
- **FR-9 右侧面板模块顺序** ✅：自上而下固定为——1. 采集数据源；2. 实测数据标定；3. 车体位姿（含标定 Vpp）；4. 电感读数剖面图；5. 全程扫描（双图切换，FR-10）；6. 循迹控制区（TrackingPanel，见 `specs/features/05-tracking-control/`）；7. 电感布局编辑；8. 物理公式。实现：Home 将 `<TrackingPanel>` 以 `trackingSlot` 传入 SensorPanel，渲染于全程扫描区与电感布局区之间。右侧栏顶部有标题栏（"电感与仿真"），可收起为 32px 窄条（会话内状态不持久化）。
- **FR-10 全程扫描区双图切换** ✅：Tab 切换两个折线图——
  - ①`全程扫描 U(s)`（SensorSweepChart）：每个电感一条曲线（按名称着色），竖线标记当前 s；可导出扫描 CSV；扫描依赖变化时防抖 250 ms 重算，拖 s 滑块不触发；支持点击联动（FR-20）；
  - ②`循迹轨迹电感值`（TrackingSensorChart）：横轴 t / 弧长 s 可切，竖线标记当前轨迹进度 trajT；支持点击联动（FR-21）；循迹数据为空时给"请先开启循迹仿真"空态提示（图内容细节见 `specs/features/05-tracking-control/`）；
  - 两图保持挂载（hidden 切换），各自保留独立缩放状态（FR-13）；均可浮出为浮动窗（FR-16）。
- **FR-11 分区卡片化** ✅：两侧面板全部模块统一为可折叠分区卡片（PanelSection）——标题栏（chevron + 标题 + 可选灰色小字说明 + 右侧操作位）点击折叠/展开；低频操作按钮（实测标定导入/清除、电感布局添加/导出/导入、循迹启用开关）移入标题栏右侧，点击不触发折叠。折叠状态为会话内内存状态，**不持久化**；`defaultOpen` 仅在首次挂载时生效。默认折叠：左侧"计算状态"；右侧"物理公式"；"实测数据标定"在选中实测源或已导入数据时默认展开、其余情况默认折叠。
- **FR-12 面板拖拽调宽** ✅：react-resizable-panels v4——左面板拖右缘调宽（240px–45% 窗口宽）、右面板拖左缘调宽（300px–55% 窗口宽）、中央画布最小 30%；拖到最小宽度以下自动收起为 32px 窄条。宽度布局存独立 localStorage key `em-field-studio/panel-layout`（panel id → flexGrow，防抖 300 ms 保存，与 appState 解耦，损坏只回退默认宽度），**不影响 `APP_STATE_VERSION`（仍 v6）**。

### 折线图统一缩放

- **FR-13 覆盖范围** ✅：全部折线图可放大查看——SensorChart（读数剖面）、SensorSweepChart（全程扫描）、TrackingSensorChart（循迹轨迹电感值）、TrackingPanel 内 Err(t)/轮速(t) 曲线、实测标定对比预览图（MeasuredFitChart）。
- **FR-14 缩放交互** ✅：鼠标框选或滚轮放大目标区间；Shift+拖拽（或中键拖拽）平移；双击或图右上角"⟲ 复位"按钮回全量程；悬停 tooltip 在放大后保持可用；y 量程随可见区间自适应拉伸（纯 SVG 图），recharts 图按可见域过滤数据。
- **FR-15 统一封装** ✅：`ZoomableChart.tsx`——`useChartZoom()` hook（域管理 + 框选/平移/滚轮/复位）+ `ZoomResetButton`，各图共用；图表浮动化后缩放交互在浮动窗口中保持可用；与点击联动共存（框选缩放的"单击即微小框选"与点击按位移阈值 <2% 区分，FR-22）。

### 折线图浮动化

- **FR-16 浮动范围与图表 id** ✅：除电感读数剖面图（SensorChart，固定留右栏）外的所有折线图——全程扫描/循迹轨迹电感图（FR-10 双图）、TrackingPanel 内 Err(t) 与轮速(t) 曲线、实测标定对比预览图——均可"拖出"为中央画布上的浮动窗口。图表 id（持久化 key）：`sweep` / `trajSensors` / `trkErr` / `trkWheels` / `measuredFit`。
- **FR-17 浮动交互** ✅：
  - 拖出：按住图表标题栏拖入中央画布区域即转为浮动窗（或点图表右上角"弹出 ⧉"按钮直接浮出于画布中央）；
  - 移动：浮动窗标题栏拖拽，可在中央画布范围内任意移动（不越出主窗口）；
  - 缩放：鼠标选中浮动窗边框/四角拖拽，八向拉伸（最小 240×160 px）；图表内容随尺寸重排——纯 SVG 图按宽度自适应，recharts 图按窗口尺寸重排；
  - 收回：点"收回"按钮回到原面板位置（原位留占位条；不销毁图表数据）；
  - 浮出/收回的瞬间图表缩放域重置（浮动期间保持不变）；
  - 浮动窗内保留 FR-14 全部缩放/复位交互与 FR-20/21 点击联动。
- **FR-18 浮动架构** ✅：`FloatingChart.tsx` 统一容器——Home 在中央画布区提供 portal 宿主层与状态表（`FloatingLayerContext`），浮动时经 `createPortal` 渲染绝对定位窗（指针事件处理移动/八向拉伸）；z 序后弹出/最近操作的在上。
- **FR-19 浮动持久化与空态** ✅：每张图的浮动状态（是否浮出、位置、尺寸）随 appState v6 `floatingCharts` 保存（`specs/features/07-persistence-export/`）；循迹未开启等无数据状态下打开浮动窗给空态提示。

### 折线图点击联动车位

- **FR-20 全程扫描图联动** ✅：点击曲线上某数据点 → 车移动到对应赛道位置——位姿来源自动切到 `手动位姿`，s 滑块设为该点弧长（e/ψ 保持当前值），画布车框、读数剖面图、扫描图"当前"竖线同步刷新。
- **FR-21 循迹类图联动** ✅：循迹轨迹电感图、Err(t)、轮速(t) 点击某数据点 → 对应时间步 t——位姿来源自动切到 `跟随仿真轨迹`，轨迹进度 trajT 设为该 t（取最近时间步，并钳位到轨迹时长内），车体沿轨迹摆上对应位姿；循迹无有效轨迹时点击无效并提示。
- **FR-22 联动边界与实现** ✅：电感读数剖面图（x 轴为电感横向位置，无对应赛道位置）**不参与**点击联动。各图表组件带 `onPointClick` 回调，框选缩放的"单击即微小框选"与点击联动靠位移阈值 <2% 区分；Home 统一处理（`setPoseSource` + `setPose` / `setTrajT`）。

### 面板 UI 组件化改造细则

- **FR-23 Select 溢出修复（根因）** ✅：`ui/select.tsx` 触发框的选中值槽位改为 `min-w-0 + flex-1 + truncate`（超出省略号截断，箭头不压缩）；同时收敛各处过窄宽度与过长文案——采集数据源下拉整宽（`w-full`，文案精简如"实测物理+偏差 · 方案B"，完整说明在悬停 title）、敏感轴下拉整宽自适应（`flex-1`，文案如"横向 x（感 Bx）"）、显示分量 96→144px、网格步长 96→112px、环岛方向 56→70px。
- **FR-24 数值直接键入** ✅：车体位姿 s/e/ψ 与标定 Vpp 的滑块当前值可点击键入精确值（共享组件 `ui/mini-num.tsx`，由 TrackingPanel 的 MiniNum 提取；失焦/Enter 提交、越界钳位到滑块量程；循迹参数侧输入方式见 `specs/features/05-tracking-control/`）。
- **FR-25 深色视觉细节** ✅：深色细滚动条（全局 `::-webkit-scrollbar` 样式）、文本选中色与 cyan 强调色一致、面板顶部粘性标题栏（"赛道编辑" / "电感与仿真"）；整体视觉参考 Linear / Vercel / Raycast 等深色工具：近黑表面、弱边框、单一强调色、排版层级区分信息。

## 技术约束

- **TC-1 技术选型**：折线图（读数剖面/全程扫描/循迹轨迹电感值/Err(t)/轮速(t)）为纯 SVG 自绘；recharts 2.15.4 仅用于实测标定对比预览图；面板调宽用 react-resizable-panels 4.2.2；图标 lucide-react。版本锁定见 [`specs/techstack.md`](../../techstack.md)。
- **TC-2 分层纪律**：本功能全部代码属交互层（`src/components/`、`src/pages/Home.tsx`），禁止向 `src/mathmodel/` 纯计算层引入 UI/React/DOM 依赖（[`specs/techstack.md`](../../techstack.md) 硬性约束 2）。
- **TC-3 持久化纪律**：`floatingCharts`、`leftCollapsed` 走 appState（schema 版本纪律见 [`specs/techstack.md`](../../techstack.md) 硬性约束 3，当前 v6）；面板宽度布局走独立 key `em-field-studio/panel-layout`（无版本号，损坏只回退默认宽度）；分区折叠、右侧栏收起、转角刻度开关为会话内状态，不持久化。
- **TC-4 显示单位**：内部计算 SI 单位，界面显示 mm / Vpp（[`specs/techstack.md`](../../techstack.md) 硬性约束 1）。
- **TC-5 验证门槛**：本功能改动须 `npm run build` 通过 + `scripts/screenshot.cjs` 四场景截图目检无溢出（见 [`validation.md`](validation.md)）；不得破坏三组物理自检（回归）。
- **TC-6 交互共存**：缩放（框选/平移）、浮动（标题栏拖拽）、点击联动三类指针交互在同一图表上共存，须以位移阈值与修饰键区分，不得互相阻塞。

## 接口约定

### 代码文件落点

| 文件 | 内容 |
|---|---|
| `src/components/ZoomableChart.tsx` | `useChartZoom()` + `ZoomResetButton` + `ZOOM_HINT`（折线图统一缩放封装） |
| `src/components/FloatingChart.tsx` | `FloatingChart` 容器、`FloatingLayerContext`、`FloatingLayerHost`、`useFloatingZOrder`、`FLOAT_MIN_W`/`FLOAT_MIN_H` |
| `src/components/PanelSection.tsx` | 可折叠分区卡片（`title` / `hint` / `actions` / `defaultOpen`） |
| `src/components/ui/mini-num.tsx` | `MiniNum` 共享数字小输入（失焦/Enter 提交；键入过程不回写） |
| `src/components/ui/select.tsx` | Select 根因修复：`*:data-[slot=select-value]:min-w-0 / flex-1 / truncate`，箭头 `shrink-0` |
| `src/components/FieldCanvas.tsx` | 中央画布（热力图/等值线/叠加/探针/缩放平移/转角刻度叠加层） |
| `src/components/SensorPanel.tsx` | 右侧面板（8 模块顺序、`trackingSlot`、全程扫描区双图 hidden 切换） |
| `src/pages/Home.tsx` | 三栏 `ResizablePanelGroup` 布局、浮动层宿主、点击联动统一处理、panel-layout 持久化、顶栏 |
| `scripts/screenshot.cjs` | UI 离屏截图目检工具（规格本体见 `specs/features/08-packaging-release/`） |

### 图表 id 表（浮动化/持久化 key）

| id | 图表 | 宿主 |
|---|---|---|
| `sweep` | 全程扫描 U(s)（SensorSweepChart） | 右侧全程扫描区 Tab① |
| `trajSensors` | 循迹轨迹电感值（TrackingSensorChart） | 右侧全程扫描区 Tab② |
| `trkErr` | Err(t) | TrackingPanel 内 |
| `trkWheels` | 轮速(t) | TrackingPanel 内 |
| `measuredFit` | 实测标定对比预览图（MeasuredFitChart，recharts） | 实测数据标定区 |

电感读数剖面图 SensorChart 无 id——不浮动、不参与点击联动。

### useChartZoom 交互约定

- 用法：`zoom = useChartZoom(fullMin, fullMax)`，返回 `{ domain, zoomed, box, beginBox, beginPan, dragTo, endDrag, wheelAt, reset, attachWheel }`；`domain` 为当前可见 x 域（未放大时等于全量程），`box` 为框选进行中的视口小数区间。
- 指针语义：`beginBox`/`beginPan(frac)` 按下（frac = 光标在绘图区宽度内的小数位置），`dragTo(frac)` 拖动，`endDrag(frac)` 抬起提交；**框选宽度 < 全量程 2%（`b - a < 0.02`）视为单击误触，不缩放**（即 FR-22 的 <2% 位移阈值）；最小可视窗口 = 全量程的 2%（`MIN_SPAN_FRAC = 0.02`，防止无限放大）。
- 滚轮：`wheelAt(frac, deltaY)` 以光标位置为中心缩放，缩放因子 `exp(deltaY · 0.0015)`（上滚放大）；`attachWheel(el, fracOf)` 绑定非被动 wheel 监听（`preventDefault` 阻止面板滚动），返回清理函数。
- 复位：`reset()` 回全量程（`domain` 置 null）；双击图面或 `ZoomResetButton`（"⟲ 复位"）触发；图下方小字提示 `ZOOM_HINT = '框选/滚轮放大 · Shift+拖拽平移 · 双击复位'`。
- y 量程：纯 SVG 图随可见区间自适应拉伸；recharts 图按可见域过滤数据。

### FloatingChart 交互与数据结构

- **拖出阈值**：按住内联标题栏拖拽，指针 clientX/Y 进入中央画布宿主层矩形（`layerEl.getBoundingClientRect()`）即转为浮动窗并继续拖动；拖出过程中标题栏显示高亮提示环。
- **尺寸**：默认浮出尺寸 420×280 px（`defaultW`/`defaultH`，受画布尺寸钳位）；拉伸下限 `FLOAT_MIN_W = 240`、`FLOAT_MIN_H = 160`；位置与尺寸始终钳位在画布范围内。
- **八向拉伸**：边框 n/s/e/w + 四角 ne/nw/se/sw 手柄，各配对应 cursor；右下角有可视化把手"◢"。
- **收回**：标题栏或原位占位条上的"收回"按钮 → `floating: false`，图表回到原面板位置（占位条消失，数据不销毁）；浮出/收回瞬间缩放域重置。
- **z 序**：`zIndex = 20 + zOrder.indexOf(id)`；浮出、按下、拉伸时 `bringToFront(id)`——后弹出/最近操作的在上。
- **数据结构（appState v6 `floatingCharts`）**：`FloatingChartsMap = Record<id, FloatingChartState>`，`FloatingChartState = { floating: boolean; x: number; y: number; w: number; h: number }`（坐标/尺寸为画布宿主层内 px）。

### FloatingLayerContext portal 宿主

- `FloatingLayerContext = createContext<FloatingCtx | null>`，`FloatingCtx = { layerEl, states: FloatingChartsMap, setChart(id, patch), zOrder, bringToFront(id) }`。
- Home 侧：`useFloatingZOrder()` 维护 z 序（`bringToFront`/`ensure`）；`<FloatingLayerHost hostRef={setFloatLayerEl}>` 渲染于中央画布区（`absolute inset-0`、`pointer-events-none`、overflow-hidden，z-30），浮动窗经 `createPortal` 渲染进该层（窗体自身 `pointer-events-auto`）；`FloatingLayerContext.Provider` 包裹整个三栏布局，故左右面板内图表均可浮出。
- 无上下文（异常兜底）时 FloatingChart 直接内联渲染。

### 面板布局参数（Home.tsx ResizablePanelGroup）

| panel id | defaultSize | minSize | maxSize | collapsedSize | 收起状态持久化 |
|---|---|---|---|---|---|
| `left` | 330px | 240px | 45% | 32px | appState `leftCollapsed`（v5 起） |
| `canvas` | 自适应 | 30% | — | — | — |
| `right` | 350px | 300px | 55% | 32px | 会话内（不持久化） |

- 拖到最小宽度以下自动收起：`onResize` 回调中 `size.inPixels <= 40` 判定为收起并回同步收起状态。
- 宽度布局：key `em-field-studio/panel-layout`，值为 react-resizable-panels `Layout`（panel id → flexGrow），防抖 300 ms 保存，仅首次挂载读取，逐条校验（非正数条目丢弃）。

### 点击联动回调

- 图表组件 props：`onSweepPointClick(sMm: number)`（扫描图）、`onTrajPointClick(tSec: number)` / `onChartPointClick`（循迹类图）。
- Home 处理：扫描点 → `setPoseSource('manual')` + `setPoseState({ sMm })`（e/ψ 保持）；循迹点 → 无有效轨迹时提示"循迹无有效轨迹——请先开启循迹仿真"，否则 `setPoseSource('trajectory')` + `setTrajT(clamp(tSec, 0, trajDurationS))`。

### screenshot.cjs 调用约定

```
node_modules/.bin/electron.cmd scripts/screenshot.cjs <out.png> [宽] [高] [default|measured|none|种子.json] [scroll|collapse]
```

Electron 离屏窗口加载 dist 构建产物；变体 `default`（演示矩形闭环赛道 + 循迹开启）/ `measured`（数据源切最长选项"实测物理+偏差 · 方案B"）/ `none` / 自定义 app-state 种子 JSON；第 6 参 `scroll` 面板滚底、`collapse` 双栏收起；每次运行独立 userData 互不污染；截图前固定延时等待场计算完成。依赖 `dist/` 已构建。

## 非目标（Non-goals）

- 电感读数剖面图（SensorChart）的浮动化与点击联动（设计明确排除：x 轴为电感横向位置，无赛道位置语义）。
- 分区卡片折叠状态、右侧栏收起状态、转角刻度开关的持久化（设计明确为会话内状态）。
- 独立 OS 级浮动窗口（Electron 多窗口）；浮动范围限于中央画布。
- 串口直采（SerialSource，Phase 11）与实车循迹日志程序内对比视图（Phase 10）的图表。
- 亮色主题、移动端/触屏适配、图表配置化与用户自定义看板。
- 折线图缩放域的持久化（仅浮动几何状态持久化，缩放域为会话内状态）。
