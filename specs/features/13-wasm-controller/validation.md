# Phase 13: WASM 车载控制器 — 验证

> 判据落点：`em-field-studio/scripts/selfcheck-wasm.ts`（新增，tsx 直跑，npm script `selfcheck:wasm`）；fixture `scripts/fixtures/pd_controller.wasm` 由用户本机跑 `controller-template/build.bat` 生成后提交入库（流程见文末"fixture 生成流程"）。

## 验证清单（Scorecard）

| # | 检查项 | 方法 | 通过标准 | 关联需求 |
|---|---|---|---|---|
| V-1 | fixture 一致性（PD 示例 wasm vs FormulaController） | 自动化 `selfcheck:wasm` | `pd_controller.wasm`（模板 PD 示例，与式 [(8.1)](../05-tracking-control/requirements.md#eq-8-1) 同构差比和 + 同 Kp/Kd）与内置 FormulaController 同参数跑同一赛道：两者 status 一致；逐点位置 (x,y) RMS 偏差 < 5 mm（float32 累积差异容差，自定阈值，显式声明）；完赛时完赛时间相对差 < 5% | FR-1, FR-3, FR-6, FR-9 |
| V-2 | ABI 健壮性 | 自动化 `selfcheck:wasm` | 以下全部回退内置控制器且进程不崩溃、给出明确错误信息：①无效字节（随机 buffer / 截断的合法 wasm）；②ABI 版本不符（导出 `CTRL_ABI_VERSION = 99`）；③运行时 trap（任务内除零）；④缺全部任务入口（仅导出 `ctrl_init`）；⑤声明宿主未提供的 env 导入 | FR-5, FR-7 |
| V-3 | 多速率入口探测 | 自动化 `selfcheck:wasm` | 只导出 `ctrl_task_2ms`（缺 `ctrl_task_1ms`）的 wasm 正常加载并跑完仿真（1ms 任务跳过、有提示）；只导出 `ctrl_task_1ms` 同理；全缺 → V-2 ④ 拒绝加载 | FR-2 |
| V-4 | 既有自检与构建回归 | 自动化 | `npm run selfcheck`、`selfcheck:measured`、`selfcheck:tracking` 全过；`npm run build`（tsc -b + vite build）通过；`scripts/test-appstate.ts` 通过（含 `wasmController.fileName` 逐字段回退用例） | FR-11, TC-2, TC-3 |
| V-5 | 真实 wasm 上车对照 | 🧪 人工（实验环节） | 用户真实车载代码编译的 wasm 上传跑完全程；重新上传热替换生效（轨迹随新算法变化）；与实车行为对照结论回填 [`specs/research/2026-08-13-experiment-modeling.md`](../../research/2026-08-13-experiment-modeling.md) | FR-12 |

## 自动化验证

在 `em-field-studio/` 下执行（[`specs/techstack.md`](../../techstack.md) 测试策略）：

| 命令 | 判据 |
|---|---|
| `npm run selfcheck:wasm`（新增，tsx 直跑 `scripts/selfcheck-wasm.ts`） | 上述 V-1 ~ V-3 全部 PASS，进程退出码 0 |
| `npm run build` | 类型检查 + 构建通过 |
| `npm run selfcheck`、`npm run selfcheck:measured`、`npm run selfcheck:tracking` | 三组既有自检同步全过（改 `src/mathmodel/` 任何代码后的硬性要求） |
| `npx tsx scripts/test-appstate.ts` | appState 持久化测试通过（新增 `wasmController.fileName` 用例：缺失回退 null、非法回退 null、不升版本号） |

fixture 生成流程：用户本机安装 clang（LLVM）→ 在 `em-field-studio/controller-template/` 跑 `build.bat` → 产出 `pd_controller.wasm` 复制到 `scripts/fixtures/` → 提交入库。自检脚本发现 fixture 缺失时明确报错提示该流程（不静默跳过）。

## 人工验证步骤

1. **上传与来源显示**：`npm run dev` 启动，循迹控制区"控制器来源"上传 `pd_controller.wasm` → 来源显示变为"文件名 + ABI v1"，轨迹按 wasm 控制器重算（防抖 ~200ms），画布/曲线/摘要同步刷新。
2. **热替换**：修改 `controller.c`（如改 Kp）重新编译 → 再次上传 → 控制器 reset，轨迹立即按新算法重算，无需重启。
3. **回退链路**：上传一个文本文件伪装 .wasm → 提示加载失败原因并回退内置公式控制器，循迹仿真立即可跑。
4. **重启回退**：上传 wasm 后刷新页面 → 来源回退内置控制器，显示"请重新上传 {fileName}"提示（appState 只记文件名）。
5. **缺入口提示**：上传只含 `ctrl_task_2ms` 的 wasm → 正常加载，提示 1ms 任务缺失已跳过。

## 回归检查

- **ABI 稳定**：`CTRL_ABI_VERSION = 1` 发布后，导入表 / 入口表 / 式 [(13.1)](requirements.md#eq-13-1) 语义变更必须升版本并同步 `controller-template/` 与 fixture（[`specs/techstack.md`](../../techstack.md) 硬性约束 6）；selfcheck-wasm 的 V-2 ② 为版本拒绝的常设防护。
- **内置控制器不退化**：WasmController 的任何改动不得影响内置 FormulaController 路径——`selfcheck:tracking` 全过为底线（Phase 5 validation 的 V-1 ~ V-7 判据不变）。
- **appState 兼容**：旧 v6 存档（无 `wasmController` 字段）加载后逐字段回退 null，不崩溃、不丢其他状态、不升 `APP_STATE_VERSION`（硬性约束 3）。
- **trap 不传染**：wasm trap 后该实例作废、回退内置，后续仿真（含一键调 PID）不受影响——V-2 ③ 防护。
- **fixture 同步**：`controller-template/` 的 ABI 声明（`controller_api.h`）与 `controllerAbi.ts` 漂移时 V-1 必然失败——两者必须同一次提交内同步修改。
