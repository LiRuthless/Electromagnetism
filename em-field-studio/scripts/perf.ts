import { buildElements, presetCross } from '../src/mathmodel/track';
import { computeGrid } from '../src/mathmodel/field';
const el = buildElements(presetCross()); // 800 段，最重场景
const t0 = performance.now();
computeGrid(el, 0.1, -2.35, -0.35, 200, 200, 0.0235, 0.0235, 0.07);
console.log('200x200 grid x 800 elements:', (performance.now() - t0).toFixed(0), 'ms');
const t1 = performance.now();
computeGrid(el, 0.1, -2.35, -0.35, 470, 200, 0.01, 0.01, 0.07);
console.log('5mm step 94000 cells:', (performance.now() - t1).toFixed(0), 'ms');
