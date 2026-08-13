/**
 * 工作状态持久化模块单测（Node + localStorage stub）。
 * 运行：npx tsx scripts/test-appstate.ts
 */

// ---- localStorage stub（必须先于被测模块 import）----
class LocalStorageStub {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? (this.m.get(k) as string) : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}
(globalThis as Record<string, unknown>).localStorage = new LocalStorageStub();

const { loadAppState, saveAppState, clearAppState, APP_STATE_KEY, APP_STATE_VERSION } =
  await import('../src/utils/appState');
const { defaultLayout } = await import('../src/mathmodel/sensor');

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra = '') {
  if (cond) {
    passed++;
    console.log(`PASS  ${name}${extra ? `（${extra}）` : ''}`);
  } else {
    failed++;
    console.log(`FAIL  ${name}${extra ? `（${extra}）` : ''}`);
  }
}

const sample = {
  version: APP_STATE_VERSION,
  savedAt: new Date().toISOString(),
  trackDef: {
    name: '测试赛道',
    segments: [
      { kind: 'line', length: 0.5 },
      { kind: 'line', length: 0.3, absAngle: 1.5707963 },
      { kind: 'arc', radius: 0.5, angleDeg: 90, turn: 'right' },
    ],
    extraWires: [
      [
        [0, 0],
        [0.1, 0.2],
      ],
    ],
  },
  params: { currentMa: 150, heightMm: 55, gridStepMm: 20, component: 'bmag', logScale: false },
  sensors: defaultLayout().map((s, i) => ({ ...s, x: s.x + i * 0.001 })),
  pose: { sMm: 1234, eMm: -45, psiDeg: 12 },
  vppAnchor: 5.5,
  sourceKind: 'serial',
  editMode: 'list',
  layMode: 'arc',
  placing: false,
  showSegLengths: true,
  arcPending: { radiusMm: 300, angleDeg: 60, turn: 'left' },
  view: { cx: 0.4, cy: -0.2, scale: 123.4 },
  // v6 新增：折线图浮动状态 + 循迹滑块自定义量程
  floatingCharts: { sweep: { floating: true, x: 40, y: 30, w: 460, h: 300 } },
  trackingRanges: { kp: { min: 0, max: 50 } },
} as const;

console.log('[A] 保存 -> 读取 往返一致');
saveAppState(JSON.parse(JSON.stringify(sample)));
const s1 = loadAppState();
check('读取到状态', s1 !== null);
check('trackDef 一致', JSON.stringify(s1?.trackDef) === JSON.stringify(sample.trackDef));
check('params 一致', JSON.stringify(s1?.params) === JSON.stringify(sample.params));
check('sensors 数量与坐标一致', s1?.sensors.length === sample.sensors.length &&
  s1.sensors.every((s, i) => Math.abs(s.x - sample.sensors[i].x) < 1e-12));
check('pose 一致', s1?.pose.sMm === 1234 && s1.pose.eMm === -45 && s1.pose.psiDeg === 12);
check('vppAnchor / sourceKind / 开关一致', s1?.vppAnchor === 5.5 && s1.sourceKind === 'serial' &&
  s1.editMode === 'list' && s1.layMode === 'arc' && s1.placing === false &&
  s1.showSegLengths === true);
check('arcPending / view 一致', s1?.arcPending.radiusMm === 300 && s1.arcPending.turn === 'left' &&
  s1.view?.scale === 123.4);
check('v6 floatingCharts / trackingRanges 一致',
  s1?.floatingCharts.sweep?.floating === true && s1.floatingCharts.sweep.w === 460 &&
  s1.trackingRanges.kp?.max === 50);

console.log('[B] 版本不匹配 -> null（回退默认，不崩溃）');
localStorage.setItem(
  APP_STATE_KEY,
  JSON.stringify({ ...sample, version: APP_STATE_VERSION + 1 }),
);
check('版本+1 -> null', loadAppState() === null);
localStorage.setItem(APP_STATE_KEY, JSON.stringify({ ...sample, version: undefined }));
check('无版本字段 -> null', loadAppState() === null);

console.log('[C] JSON 损坏 / 结构非法 -> null');
localStorage.setItem(APP_STATE_KEY, '{broken json!!!');
check('损坏 JSON -> null', loadAppState() === null);
localStorage.setItem(APP_STATE_KEY, JSON.stringify({ ...sample, sensors: 'not-an-array' }));
check('sensors 非数组 -> null', loadAppState() === null);
localStorage.setItem(
  APP_STATE_KEY,
  JSON.stringify({ ...sample, trackDef: { name: 'x', segments: [{ kind: 'line', length: 'bad' }] } }),
);
check('非法段定义 -> null', loadAppState() === null);

console.log('[D] 非关键字段非法 -> 该字段回退默认而非整体失败');
localStorage.setItem(
  APP_STATE_KEY,
  JSON.stringify({
    ...sample,
    vppAnchor: -5,
    sourceKind: 'nonsense',
    params: { ...sample.params, component: 'bogus' },
    view: { cx: 0, cy: 0, scale: -1 },
  }),
);
const s4 = loadAppState();
check('仍返回状态', s4 !== null);
check('vppAnchor 回退 6', s4?.vppAnchor === 6);
check('sourceKind 回退 simulation', s4?.sourceKind === 'simulation');
check('component 回退 bz', s4?.params.component === 'bz');
check('非法 view -> null', s4?.view === null);

console.log('[E] clearAppState 只清工作状态 key');
localStorage.setItem('em-field-studio/track-library', '[{"name":"keep"}]');
saveAppState(JSON.parse(JSON.stringify(sample)));
clearAppState();
check('app-state 已清除', loadAppState() === null);
check('赛道库 key 未受影响', localStorage.getItem('em-field-studio/track-library') === '[{"name":"keep"}]');

console.log(`\n${failed === 0 ? '持久化模块测试全部通过 ✓' : `有 ${failed} 项失败 ✗`}（${passed} 项通过）`);
process.exit(failed === 0 ? 0 : 1);
