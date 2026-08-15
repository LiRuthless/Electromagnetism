/**
 * 离屏截图工具（开发用）：用项目自带 Electron 加载 dist 构建产物并截图。
 *
 * 用法：
 *   node_modules\.bin\electron.cmd scripts\screenshot.cjs <out.png> [width] [height] [variant]
 * variant:
 *   default       —— 演示矩形闭环赛道 + 循迹开启（仿真源）
 *   measured      —— 数据源切到"实测物理+偏差 · 方案B"（最长选项，验证 Select 截断）
 *   <path.json>   —— 自定义 app-state 种子 JSON 文件
 *
 * 依赖 dist/ 已构建（npm run build）。截图前等待场计算完成（固定延时）。
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const out = process.argv[2] || 'shot.png';
const W = parseInt(process.argv[3] || '1600', 10);
const H = parseInt(process.argv[4] || '950', 10);
const variant = process.argv[5] || 'default';

// 每次运行使用独立 userData，避免截图之间互相恢复对方持久化的面板布局/工作状态
app.setPath('userData', path.join(require('os').tmpdir(), `emfs-shot-${Date.now()}`));

/** 演示种子状态（结构与 src/utils/appState.ts 的 AppState 对应，version 必须匹配） */
function seedState(sourceKind) {
  return {
    version: 6,
    savedAt: new Date().toISOString(),
    trackDef: {
      name: '演示矩形赛道',
      closed: true,
      segments: [
        { kind: 'line', length: 0.8, absAngle: 0 },
        { kind: 'line', length: 0.5, absAngle: Math.PI / 2 },
        { kind: 'line', length: 0.8, absAngle: Math.PI },
        { kind: 'line', length: 0.5, absAngle: -Math.PI / 2 },
      ],
    },
    params: { currentMa: 100, heightMm: 70, gridStepMm: 10, component: 'bz', logScale: true },
    sensors: [
      { id: 's1', name: 'L1', x: -0.05, y: 0.08, h: 0.075, axisPreset: 'y', axis: [0, 0, 1] },
      { id: 's2', name: 'R1', x: 0.05, y: 0.08, h: 0.075, axisPreset: 'y', axis: [0, 0, 1] },
      { id: 's3', name: 'L2', x: -0.075, y: 0.08, h: 0.075, axisPreset: 'x', axis: [0, 0, 1] },
      { id: 's4', name: 'R2', x: 0.075, y: 0.08, h: 0.075, axisPreset: 'x', axis: [0, 0, 1] },
    ],
    pose: { sMm: 120, eMm: 15, psiDeg: 5 },
    vppAnchor: 6,
    sourceKind,
    measured: null,
    editMode: 'lay',
    layMode: 'line',
    placing: true,
    showSegLengths: true,
    arcPending: { radiusMm: 500, angleDeg: 90, turn: 'right' },
    view: null,
    tracking: { enabled: true },
    poseSource: 'manual',
    trajT: 0,
    leftCollapsed: false,
    floatingCharts: {},
    trackingRanges: {},
  };
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: W,
    height: H,
    show: false,
    webPreferences: { offscreen: true },
  });
  const distIndex = path.join(__dirname, '..', 'dist', 'index.html');

  let seed = null;
  if (variant === 'default') seed = seedState('simulation');
  else if (variant === 'measured') seed = seedState('measured-phys');
  else if (variant !== 'none') seed = JSON.parse(fs.readFileSync(variant, 'utf8'));

  await win.loadFile(distIndex);
  if (seed) {
    await win.webContents.executeJavaScript(
      `localStorage.setItem('em-field-studio/app-state', ${JSON.stringify(JSON.stringify(seed))});`,
    );
    await win.loadFile(distIndex);
  }
  // 等待场网格 + 循迹仿真计算完成
  await new Promise((r) => setTimeout(r, 6000));
  if (process.argv[6] === 'scroll') {
    await win.webContents.executeJavaScript(
      `document.querySelectorAll('.overflow-y-auto').forEach((el) => { el.scrollTop = el.scrollHeight; });`,
    );
    await new Promise((r) => setTimeout(r, 500));
  }
  if (process.argv[6] === 'collapse') {
    await win.webContents.executeJavaScript(
      `document.querySelectorAll('[title^="收起面板"]').forEach((el) => el.click());`,
    );
    await new Promise((r) => setTimeout(r, 800));
  }
  const img = await win.webContents.capturePage();
  fs.writeFileSync(out, img.toPNG());
  console.log(`saved: ${out} (${W}x${H}, variant=${variant})`);
  app.exit(0);
});
