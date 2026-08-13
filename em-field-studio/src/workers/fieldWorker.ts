/**
 * 磁场网格计算 Web Worker：分块计算 + 协作式取消 + 进度上报。
 *
 * - 分块：每次算 CHUNK_ROWS 行后 setTimeout(0) 让出事件循环，使新请求消息能被接收；
 * - 取消：onmessage 只更新 latestSeq，计算循环在块边界发现自身 seq 过期即中止，
 *   旧重任务不会堵住新请求（修复"重算很久都不更新"）；
 * - 进度：每块上报 { type:'progress' }，UI 显示百分比与已耗时。
 */
import { MU0, R_MIN, wireSegB } from '../mathmodel/field';
import type { Elements } from '../mathmodel/track';

export interface GridRequest {
  seq: number;
  mids: Float64Array;
  dls: Float64Array;
  count: number;
  /** 直线段闭式积分（可选）：每 4 个数 (x0,y0,x1,y1) */
  wires?: Float64Array;
  I: number;
  x0: number;
  y0: number;
  nx: number;
  ny: number;
  dx: number;
  dy: number;
  h: number;
}

export interface GridProgress {
  type: 'progress';
  seq: number;
  /** 0~1 */
  pct: number;
  elapsedMs: number;
}

export interface GridResult {
  type: 'result';
  seq: number;
  bx: Float32Array;
  bz: Float32Array;
  bmag: Float32Array;
  x0: number;
  y0: number;
  nx: number;
  ny: number;
  dx: number;
  dy: number;
  elapsedMs: number;
}

export interface GridError {
  type: 'error';
  seq: number;
  message: string;
}

export type GridOutMsg = GridProgress | GridResult | GridError;

const CHUNK_ROWS = 25;
let latestSeq = 0;

self.onmessage = (e: MessageEvent<GridRequest>) => {
  latestSeq = e.data.seq;
  run(e.data).catch((err: unknown) => {
    // 计算内部异常：通知主线程降级到同步计算兜底
    postError(e.data.seq, err);
  });
};

function postError(seq: number, err: unknown): void {
  (self as unknown as Worker).postMessage({
    type: 'error',
    seq,
    message: err instanceof Error ? err.message : String(err),
  } satisfies GridError);
}

async function run(q: GridRequest): Promise<void> {
  const el: Elements = { mids: q.mids, dls: q.dls, count: q.count };
  const t0 = performance.now();
  const nx = q.nx;
  const ny = q.ny;
  const bx = new Float32Array(nx * ny);
  const bz = new Float32Array(nx * ny);
  const bmag = new Float32Array(nx * ny);
  const coef = (MU0 * q.I) / (4 * Math.PI);
  const { mids, dls, count } = el;
  const wires = q.wires;
  const rMin2 = R_MIN * R_MIN;
  const post = (m: GridOutMsg, transfer: Transferable[] = []) =>
    (self as unknown as Worker).postMessage(m, transfer);

  for (let yBase = 0; yBase < ny; yBase += CHUNK_ROWS) {
    // 协作式取消：让出后若已有更新请求，立即放弃本次计算
    await new Promise((r) => setTimeout(r, 0));
    if (q.seq !== latestSeq) return;
    const yEnd = Math.min(ny, yBase + CHUNK_ROWS);
    for (let iy = yBase; iy < yEnd; iy++) {
      const py = q.y0 + (iy + 0.5) * q.dy;
      for (let ix = 0; ix < nx; ix++) {
        const px = q.x0 + (ix + 0.5) * q.dx;
        let sx = 0;
        let sy = 0;
        let sz = 0;
        for (let i = 0; i < count; i++) {
          const rx = px - mids[i * 3];
          const ry = py - mids[i * 3 + 1];
          const rz = q.h - mids[i * 3 + 2];
          const dlx = dls[i * 3];
          const dly = dls[i * 3 + 1];
          const dlz = dls[i * 3 + 2];
          let r2 = rx * rx + ry * ry + rz * rz;
          if (r2 < rMin2) r2 = rMin2;
          const w = coef / (r2 * Math.sqrt(r2));
          sx += (dly * rz - dlz * ry) * w;
          sy += (dlz * rx - dlx * rz) * w;
          sz += (dlx * ry - dly * rx) * w;
        }
        // 直线段闭式积分（精确；离散仅覆盖圆弧段）
        if (wires) {
          for (let i = 0; i + 3 < wires.length; i += 4) {
            const [wx, wy, wz] = wireSegB(px, py, q.h, wires[i], wires[i + 1], wires[i + 2], wires[i + 3], q.I);
            sx += wx;
            sy += wy;
            sz += wz;
          }
        }
        const idx = iy * nx + ix;
        bx[idx] = sx;
        bz[idx] = sz;
        bmag[idx] = Math.sqrt(sx * sx + sy * sy + sz * sz);
      }
    }
    post({
      type: 'progress',
      seq: q.seq,
      pct: yEnd / ny,
      elapsedMs: performance.now() - t0,
    });
  }

  if (q.seq !== latestSeq) return; // 最后一刻被取消
  post(
    {
      type: 'result',
      seq: q.seq,
      bx,
      bz,
      bmag,
      x0: q.x0,
      y0: q.y0,
      nx,
      ny,
      dx: q.dx,
      dy: q.dy,
      elapsedMs: performance.now() - t0,
    },
    [bx.buffer, bz.buffer, bmag.buffer],
  );
}
