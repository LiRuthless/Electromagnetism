/**
 * Worker 逻辑真机复现测试（node + tsx，polyfill 最小 web worker 环境）：
 * A. 单请求：进度 pct 严格单调递增 -> 最终结果到达，数值与主线程 computeGrid 一致；
 * B. 连续双请求：旧请求被协作式中止（无 result），新请求完成（有 result）。
 */
import { buildFieldElements, hexagonSegs, trackTip, type SegDef } from '../src/mathmodel/track';
import { computeGrid } from '../src/mathmodel/field';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- polyfill self / postMessage ----
type Handler = (e: { data: unknown }) => void;
const handlers: Handler[] = [];
interface OutMsg {
  type: string;
  seq: number;
  pct?: number;
  elapsedMs?: number;
  message?: string;
  bx?: Float32Array;
  bz?: Float32Array;
  bmag?: Float32Array;
  nx?: number;
  ny?: number;
}
const outbox: OutMsg[] = [];
(globalThis as Record<string, unknown>).self = {
  set onmessage(fn: Handler) {
    handlers.push(fn);
  },
  postMessage(msg: OutMsg) {
    outbox.push(msg);
  },
};

await import('../src/workers/fieldWorker.ts');

let failures = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) failures++;
};

// 赛道：六边形环岛 + 弯道（~629 电流元）
const segs: SegDef[] = [
  { kind: 'line', length: 1 },
  { kind: 'arc', radius: 0.5, angleDeg: 90, turn: 'right' },
  { kind: 'line', length: 0.5 },
];
segs.push(...hexagonSegs(trackTip(segs), 0.5, 'right'));
const tip2 = trackTip(segs);
segs.push({ kind: 'line', length: 1, absAngle: tip2.phi });
const el = buildFieldElements({ name: 't', segments: segs }); // 直线段闭式 + 圆弧离散（与 worker 同路径）

const NX = 200;
const NY = 160;
const mkReq = (seq: number) => ({
  seq,
  mids: el.mids,
  dls: el.dls,
  count: el.count,
  wires: el.wires,
  I: 0.1,
  x0: -0.85,
  y0: -0.35,
  nx: NX,
  ny: NY,
  dx: 3.7 / NX,
  dy: 5.0 / NY,
  h: 0.07,
});

check(handlers.length === 1, `worker 已注册 onmessage（${handlers.length}）`);

// ---- 场景 A：单请求，进度单调推进到结果 ----
console.log('\n[A] 单请求：进度 0->100% 单调 + 结果正确性');
handlers[0]({ data: mkReq(1) });
await sleep(4000);
const msgsA = outbox.filter((m) => m.seq === 1);
const progs = msgsA.filter((m) => m.type === 'progress');
const results = msgsA.filter((m) => m.type === 'result');
check(progs.length >= 3, `收到 ${progs.length} 条进度消息（≥3）`);
let mono = true;
for (let i = 1; i < progs.length; i++) {
  if ((progs[i].pct ?? 0) <= (progs[i - 1].pct ?? 0)) mono = false;
}
check(mono && (progs[0].pct ?? 0) > 0, `进度严格单调递增：${progs.map((p) => (p.pct ?? 0).toFixed(2)).join(' -> ')}`);
check(results.length === 1, `最终结果到达（${results.length} 个 result）`);
if (results.length === 1) {
  const r = results[0];
  const ref = computeGrid(el, 0.1, -0.85, -0.35, NX, NY, 3.7 / NX, 5.0 / NY, 0.07);
  let maxDiff = 0;
  for (let i = 0; i < NX * NY; i += 997) {
    const d = Math.abs((r.bmag?.[i] ?? 0) - ref.bmag[i]);
    if (d > maxDiff) maxDiff = d;
  }
  check(maxDiff < 1e-12, `worker 结果与主线程 computeGrid 抽样一致（maxDiff=${maxDiff.toExponential(1)}）`);
  console.log(`  单请求总耗时 ${(r.elapsedMs ?? 0).toFixed(0)} ms（${NX}x${NY} 网格 × ${el.count} 圆弧离散元 + ${(el.wires?.length ?? 0) / 4} 闭式直线段）`);
}

// ---- 场景 B：连续双请求，旧任务中止、新任务完成 ----
console.log('\n[B] 连续双请求：协作式取消');
outbox.length = 0;
handlers[0]({ data: mkReq(2) });
await sleep(30); // 让 req2 跑一两个块
handlers[0]({ data: mkReq(3) });
await sleep(4000);
const r2 = outbox.filter((m) => m.seq === 2 && m.type === 'result');
const r3 = outbox.filter((m) => m.seq === 3 && m.type === 'result');
check(r2.length === 0, `旧请求 seq=2 被中止（result 数=${r2.length}，应为 0）`);
check(r3.length === 1, `新请求 seq=3 完成（result 数=${r3.length}，应为 1）`);

console.log(failures === 0 ? '\nWorker 复现测试全部通过 ✓' : `\n${failures} 项失败 ✗`);
process.exit(failures === 0 ? 0 : 1);
