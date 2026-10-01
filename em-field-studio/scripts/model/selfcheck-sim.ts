/**
 * 仿真器架构分层自检（npm run selfcheck:sim，Phase 12）：
 *
 * 1. V-1 回归等价性：同一赛道/参数下 Simulator.runToEnd()（经 createSensorSampler 仿真源）
 *    与 scripts/model/fixtures/tracking-baseline.json（重构前 simulateTracking 生成）逐点一致（<1e-12）。
 * 2. V-2 多速率调度：物理 1ms + 控制 5ms 合成测试——触发次数/触发时刻/零阶保持/
 *    整数 µs 时间轴长程无漂移/过期周期合并。
 * 3. V-3 FormulaController 等价性：与直调 compileFormula+pdOutput+wheelSpeeds 内联序列
 *    逐步一致（含首步 errRate=0、分母零回退上一步误差、限幅边界）。
 * 4. V-5 一键调 PID 迁移等价：runAutoTuneSync 与基线 fixture 固化的重构前参考结果一致。
 *
 * 注意：tracking-baseline.json 由重构前代码生成（scripts/gen-tracking-baseline.ts，
 * Group 0 已提交），重构后不得重跑生成脚本。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileFormula, DEFAULT_TRACKING, pdOutput, wheelSpeeds } from '../../src/model/control';
import type { TrackingParams } from '../../src/model/control';
import type { TrackingResult } from '../../src/model/kinematics';
import { buildFieldElements, samplePath } from '../../src/model/track';
import type { SegDef, TrackDef } from '../../src/model/track';
import { defaultLayout, kFromAnchor } from '../../src/model/sensor';
import { FormulaController } from '../../src/model/sim/controller';
import type { CarController, WheelCommand } from '../../src/model/sim/controller';
import { Scheduler } from '../../src/model/sim/scheduler';
import { createSensorSampler } from '../../src/model/sim/vehicle';
import { Simulator } from '../../src/model/sim/simulator';
import { autoTuneGrid, buildSegSpans, runAutoTuneSync } from '../../src/model/sim/autotune';

let failures = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) failures++;
};

interface FixtureScenario {
  name: string;
  track: TrackDef;
  closed: boolean;
  currentMa: number;
  vppAnchor: number;
  params: TrackingParams;
  result: TrackingResult;
}
const fixture = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'tracking-baseline.json'), 'utf8'),
) as {
  gitCommit: string;
  scenarios: FixtureScenario[];
  autotune: { scenario: string; kpMax: number; kdMax: number; eInMaxMm: number; total: number; best: { kp: number; kd: number } | null };
};

function buildSimulator(sc: FixtureScenario): Simulator {
  const path = samplePath(sc.track);
  const elements = buildFieldElements(sc.track);
  const sensors = defaultLayout();
  const sampler = createSensorSampler({
    path,
    elements,
    currentMa: sc.currentMa,
    k: kFromAnchor(sc.vppAnchor),
    sourceKind: 'simulation',
    measured: null,
  });
  return new Simulator({
    path,
    sensors,
    vehicle: {
      controller: new FormulaController(sc.params, compileFormula(sc.params.formula)),
      sampler,
      params: sc.params,
    },
    tasks: [{ periodMs: sc.params.dtMs, entry: 'control' }],
    closed: sc.closed,
  });
}

// ---- [1] V-1 回归等价性 ----
console.log('[1] V-1 回归等价：Simulator.runToEnd() vs 重构前基线（逐点 <1e-12）');
for (const sc of fixture.scenarios) {
  const r = buildSimulator(sc).runToEnd();
  const b = sc.result;
  let worst = 0;
  const cmpArr = (a: number[], c: number[]) => {
    if (a.length !== c.length) {
      worst = Infinity;
      return;
    }
    for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - c[i]));
  };
  cmpArr(r.t, b.t);
  cmpArr(r.x, b.x);
  cmpArr(r.y, b.y);
  cmpArr(r.theta, b.theta);
  cmpArr(r.vL, b.vL);
  cmpArr(r.vR, b.vR);
  cmpArr(r.err, b.err);
  for (let j = 0; j < b.sensorU.length; j++) cmpArr(r.sensorU[j].values, b.sensorU[j].values);
  check(
    worst < 1e-12,
    `  [${sc.name}] 轨迹逐点最大偏差 ${worst === 0 ? '0（位精确一致）' : worst.toExponential(2)}（${r.steps} 步）`,
  );
  check(
    r.status === b.status && r.steps === b.steps && r.finishIndex === b.finishIndex && r.distM === b.distM,
    `  [${sc.name}] status=${r.status} steps=${r.steps} finishIndex=${r.finishIndex} distM=${r.distM.toFixed(6)} 全一致`,
  );
}

// ---- [2] V-2 多速率调度 ----
console.log('\n[2] V-2 多速率调度：物理 1ms + 控制 5ms / ZOH / 整数 µs 无漂移 / 过期合并');
{
  // (a)(c) 触发次数与时刻：1ms 步长 × 1000 tick，5ms 周期应触发恰好 200 次，时刻严格 5k ms
  const fireMs: number[] = [];
  const sched = new Scheduler(1, [{ periodMs: 5, entry: () => fireMs.push(sched.nowMs) }]);
  for (let i = 0; i < 1000; i++) {
    sched.runDue();
    sched.advance();
  }
  let timesOk = fireMs.length === 200;
  for (let k = 0; k < fireMs.length; k++) if (fireMs[k] !== 5 * k) timesOk = false;
  check(timesOk, `  (a) 触发 ${fireMs.length} 次（应 200），时刻严格 = 5k ms（整数 µs 无漂移）`);
  check(sched.nowMs === 1000, `  (c) 1000 tick 后时钟 = ${sched.nowMs}ms（严格 1000）`);

  // (c2) 长程：1e6 tick（1000 s）后时钟严格 = 1e9 µs，任务触发恰好 200000 次
  let cnt = 0;
  const sched2 = new Scheduler(1, [{ periodMs: 5, entry: () => cnt++ }]);
  for (let i = 0; i < 1e6; i++) {
    sched2.runDue();
    sched2.advance();
  }
  check(sched2.nowMs === 1e6 && cnt === 200000, `  (c) 长程 1000s：时钟=${sched2.nowMs}ms 触发=${cnt} 次（应 1e6 / 200000）`);

  // (d) 过期合并：period 2ms < dtSim 5ms，每 tick 至多触发一次、不补触发
  let cntD = 0;
  const sched3 = new Scheduler(5, [{ periodMs: 2, entry: () => cntD++ }]);
  for (let i = 0; i < 100; i++) {
    sched3.runDue();
    sched3.advance();
  }
  check(cntD === 100, `  (d) 过期合并：period 2ms < dtSim 5ms，100 tick 触发 ${cntD} 次（应 100，不补触发）`);

  // (b) 零阶保持（整车级）：假控制器每次 step 指令自增，τ=0 时记录轮速应每 5 行才变一次
  const segs: SegDef[] = [{ kind: 'line', length: 100 }];
  const path = samplePath({ name: '长直道', segments: segs });
  class CountController implements CarController {
    n = 0;
    init(): void {}
    reset(): void {
      this.n = 0;
    }
    step(): WheelCommand {
      return { vLCmd: 0.5 + this.n++ * 0.001, vRCmd: 0.5 };
    }
  }
  const sim = new Simulator({
    path,
    sensors: defaultLayout(),
    vehicle: {
      controller: new CountController(),
      sampler: () => 1,
      params: { ...DEFAULT_TRACKING, dtMs: 1, motorTauMs: 0, vBase: 0.5, vMax: 5 },
    },
    tasks: [{ periodMs: 5, entry: 'control' }],
    closed: false,
    maxSteps: 1000,
  });
  const r = sim.runToEnd();
  let zohOk = r.steps === 1000;
  for (let i = 0; i < r.steps && zohOk; i++) {
    const expect = 0.5 + Math.floor(i / 5) * 0.001;
    if (Math.abs(r.vL[i] - expect) > 1e-12) zohOk = false;
  }
  check(zohOk, `  (b) 零阶保持：指令在两个控制 tick 间保持（1000 行轮速按 5 行一档 = 0.5+⌊i/5⌋·0.001）`);
}

// ---- [3] V-3 FormulaController 等价性 ----
console.log('\n[3] V-3 FormulaController vs 直调 compileFormula+pdOutput+wheelSpeeds 内联序列');
{
  const params: TrackingParams = { ...DEFAULT_TRACKING, vBase: 1, vMax: 2, w: 1.5, kp: 0.5, kd: 0.05 };
  const formula = compileFormula(params.formula);
  const ctrl = new FormulaController(params, formula);
  // 内联参照序列（重构前 simulateTracking 控制段逻辑）
  let prevErr = 0;
  const dt = Math.max(params.dtMs, 0.5) / 1000;
  const ref = (u: Record<string, number>, stepIdx: number): WheelCommand => {
    const vars: Record<string, number> = { A: params.A, B: params.B, C: params.C, P: params.P, ...u };
    let err: number;
    try {
      err = formula.eval(vars);
    } catch {
      err = prevErr;
    }
    if (!Number.isFinite(err)) err = prevErr;
    const errRate = stepIdx === 0 ? 0 : (err - prevErr) / dt;
    const out = pdOutput(err, errRate, params);
    const cmd = wheelSpeeds(out, params);
    prevErr = err;
    return { vLCmd: cmd.vL, vRCmd: cmd.vR, err };
  };
  // 读数序列：正常 → 分母零（L1+R1=0 且 L2=R2 → 0/0=NaN 回退）→ 未知变量公式另测 → 限幅
  const seq: Record<string, number>[] = [
    { L1: 3, R1: 1, L2: 2, R2: 0 },
    { L1: 0, R1: 0, L2: 1, R2: 1 }, // 分母 = A·0 + C·0 = 0 → NaN → 回退上一步误差
    { L1: 1, R1: 3, L2: 0, R2: 2 },
    { L1: 100, R1: 0, L2: 50, R2: 0 }, // 大误差 → 限幅 [0, vMax]
  ];
  let allEq = true;
  for (let i = 0; i < seq.length; i++) {
    const got = ctrl.step({ tMs: i * params.dtMs, u: seq[i] });
    const exp = ref(seq[i], i);
    if (got.vLCmd !== exp.vLCmd || got.vRCmd !== exp.vRCmd || got.err !== exp.err) allEq = false;
  }
  check(allEq, '  逐步 WheelCommand 完全一致（含首步 errRate=0、NaN 回退上一步误差、限幅）');
  // 未知变量公式：eval 抛错 → 回退上一步误差
  const ctrl2 = new FormulaController(params, compileFormula('XX*2'));
  const c0 = ctrl2.step({ tMs: 0, u: { L1: 1 } }); // err 回退 prevErr=0
  const c1 = ctrl2.step({ tMs: 5, u: { L1: 2 } });
  check(
    c0.err === 0 && c1.err === 0 && c1.vLCmd === 1 && c1.vRCmd === 1,
    '  未知变量求值抛错 → 回退上一步误差（恒 0 → 直行 v_base）',
  );
}

// ---- [4] V-5 一键调 PID 迁移等价 ----
console.log('\n[4] V-5 一键调 PID：runAutoTuneSync 与重构前参考结果一致（S 弯网格 13×11+9×9）');
{
  const at = fixture.autotune;
  const sc = fixture.scenarios.find((s) => s.name === at.scenario);
  if (!sc) {
    check(false, `  基线缺少场景 ${at.scenario}`);
  } else {
    const path = samplePath(sc.track);
    const sim = buildSimulator(sc);
    const segSpans = buildSegSpans(sc.track.segments, sc.closed, path.length);
    let last = { done: 0, total: 0 };
    let yields = 0;
    let monotonic = true;
    const gen = autoTuneGrid({
      simulator: sim,
      baseParams: sc.params,
      path,
      segSpans,
      kpMax: at.kpMax,
      kdMax: at.kdMax,
      eInMaxMm: at.eInMaxMm,
    });
    let r = gen.next();
    while (!r.done) {
      if (r.value.done < last.done) monotonic = false;
      last = r.value;
      yields++;
      r = gen.next();
    }
    const best = r.value;
    check(
      last.done === at.total && last.total === at.total && monotonic,
      `  进度单调递增至 ${last.done}/${last.total}（候选评估 13×11+81=${at.total}，yield ${yields} 次）`,
    );
    check(
      (best === null) === (at.best === null) &&
        (best === null || (best.kp === at.best!.kp && best.kd === at.best!.kd)),
      `  最优组合 Kp=${best?.kp} Kd=${best?.kd}（基线 Kp=${at.best?.kp} Kd=${at.best?.kd}）`,
    );
    // 同步排干包装一致性
    const best2 = runAutoTuneSync({
      simulator: buildSimulator(sc),
      baseParams: sc.params,
      path,
      segSpans,
      kpMax: at.kpMax,
      kdMax: at.kdMax,
      eInMaxMm: at.eInMaxMm,
    });
    check(
      (best2 === null) === (best === null) && (best2 === null || (best2.kp === best!.kp && best2.kd === best!.kd)),
      '  runAutoTuneSync 排干包装结果一致',
    );
  }
}

console.log(failures === 0 ? '\n仿真器架构分层自检全部通过 ✓' : `\n${failures} 项失败 ✗`);
process.exit(failures === 0 ? 0 : 1);
