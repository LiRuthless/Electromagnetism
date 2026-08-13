/**
 * 验证 appState 持久化：save -> load 往返是否完整恢复（localStorage mock）
 * 运行：npx tsx scripts/test-state-restore.ts
 */
import {
  APP_STATE_KEY,
  APP_STATE_VERSION,
  loadAppState,
  saveAppState,
  type AppState,
} from '../src/utils/appState';

// ---- 最小 localStorage mock ----
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
};

const sample: AppState = {
  version: APP_STATE_VERSION,
  savedAt: new Date().toISOString(),
  trackDef: {
    name: '测试赛道',
    segments: [
      { kind: 'line', length: 1.234, absAngle: 45 },
      { kind: 'arc', radius: 0.5, angleDeg: 90, turn: 'right' },
      { kind: 'line', length: 0.8, exitAngle: 10 },
    ],
    extraWires: [[[0, 0], [0.1, 0.1]]],
  },
  params: { currentMa: 150, heightMm: 80, gridStepMm: 15, component: 'bmag', logScale: false },
  sensors: [
    { id: 's0', name: 'S1', x: 0, y: 0.05, h: 0.07, axisPreset: 'z', axis: [0, 0, 1] },
    { id: 's1', name: 'S2', x: 0.02, y: 0, h: 0.07, axisPreset: 'custom', axis: [1, 0, 0.5] },
  ],
  pose: { sMm: 123, eMm: -15, psiDeg: 7 },
  vppAnchor: 6.5,
  sourceKind: 'simulation',
  editMode: 'list',
  layMode: 'arc',
  placing: false,
  showSegLengths: true,
  arcPending: { radiusMm: 300, angleDeg: 60, turn: 'left' },
  view: { cx: 0.5, cy: -0.2, scale: 300 },
};

let fail = 0;
const eq = (name: string, a: unknown, b: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) {
    fail++;
    console.log('  期望:', JSON.stringify(b));
    console.log('  实际:', JSON.stringify(a));
  }
};

// 1) 空存储 -> null（回退默认）
eq('空存储返回 null', loadAppState(), null);

// 2) 保存 -> 读取 往返
saveAppState(sample);
const back = loadAppState();
if (!back) {
  console.log('FAIL  保存后 loadAppState 返回 null（关键 bug：恢复功能失效）');
  process.exit(1);
}
eq('trackDef', back.trackDef, sample.trackDef);
eq('params', back.params, sample.params);
eq('sensors', back.sensors, sample.sensors);
eq('pose', back.pose, sample.pose);
eq('vppAnchor', back.vppAnchor, sample.vppAnchor);
eq('sourceKind', back.sourceKind, sample.sourceKind);
eq('editMode', back.editMode, sample.editMode);
eq('layMode', back.layMode, sample.layMode);
eq('placing', back.placing, sample.placing);
eq('showSegLengths', back.showSegLengths, sample.showSegLengths);
eq('arcPending', back.arcPending, sample.arcPending);
eq('view', back.view, sample.view);

// 3) 版本不匹配 -> null（回退默认，不崩溃）
store.set(APP_STATE_KEY, JSON.stringify({ ...sample, version: 999 }));
eq('版本不匹配返回 null', loadAppState(), null);

// 4) JSON 损坏 -> null
store.set(APP_STATE_KEY, '{broken json');
eq('JSON 损坏返回 null', loadAppState(), null);

console.log(fail === 0 ? '\n全部通过：状态可以完整保存并恢复' : `\n${fail} 项失败`);
process.exit(fail === 0 ? 0 : 1);
