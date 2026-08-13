/**
 * 磁场网格计算 hook：Web Worker 生命周期、防抖、协作式取消、进度上报。
 *
 * 关键修复（"进度一直 0%"根因）：
 * - worker 不再用 useMemo 创建——React StrictMode(dev) 双挂载会在 effect 清理中
 *   terminate 掉 memoized worker，而 useMemo 不重建，remount 后请求全部发进
 *   死 worker，表现为进度永远 0%。现改为 ref 惰性创建 + 清理时置空，remount 自动重建。
 * 兜底：
 * - worker onerror / 10s 看门狗无进展 -> 自动降级为主线程同步计算（保证场必出图）。
 */
import { useEffect, useRef, useState } from 'react';
import { computeGrid } from '../mathmodel/field';
import type { Elements } from '../mathmodel/track';
import type { GridOutMsg, GridRequest, GridResult } from '../workers/fieldWorker';

export interface GridParams {
  x0: number;
  y0: number;
  nx: number;
  ny: number;
  dx: number;
  dy: number;
}

interface State {
  grid: GridResult | null;
  computing: boolean;
  /** 计算进度 0~1（computing 时有意义） */
  progress: number;
  /** 本次计算已耗时 ms（computing 时实时增长） */
  runningMs: number;
  /** 上次完成耗时 ms */
  elapsedMs: number;
  /** worker 异常后是否已降级为主线程计算 */
  fallback: boolean;
}

const WATCHDOG_MS = 10000;

export function useFieldGrid(
  elements: Elements,
  I: number,
  h: number,
  gridParams: GridParams,
  debounceMs = 180,
): State {
  const [state, setState] = useState<State>({
    grid: null,
    computing: false,
    progress: 0,
    runningMs: 0,
    elapsedMs: 0,
    fallback: false,
  });
  const workerRef = useRef<Worker | null>(null);
  const seqRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const tickRef = useRef<number | null>(null);
  const watchdogRef = useRef<number | null>(null);
  const startRef = useRef(0);

  const stopTick = () => {
    if (tickRef.current) window.clearInterval(tickRef.current);
    tickRef.current = null;
  };
  const stopWatchdog = () => {
    if (watchdogRef.current) window.clearTimeout(watchdogRef.current);
    watchdogRef.current = null;
  };
  const startTick = () => {
    stopTick();
    startRef.current = performance.now();
    tickRef.current = window.setInterval(() => {
      setState((s) =>
        s.computing ? { ...s, runningMs: performance.now() - startRef.current } : s,
      );
    }, 150);
  };

  /** 主线程兜底计算（worker 失败时用，保证场必出图） */
  const fallbackCompute = (req: GridRequest, reason: string) => {
    console.warn(`[field] worker 不可用（${reason}），降级为主线程同步计算`);
    const t0 = performance.now();
    const { bx, bz, bmag } = computeGrid(
      { mids: req.mids, dls: req.dls, count: req.count, wires: req.wires },
      req.I, req.x0, req.y0, req.nx, req.ny, req.dx, req.dy, req.h,
    );
    stopTick();
    stopWatchdog();
    setState((s) => ({
      ...s,
      grid: {
        type: 'result',
        seq: req.seq,
        bx, bz, bmag,
        x0: req.x0, y0: req.y0, nx: req.nx, ny: req.ny, dx: req.dx, dy: req.dy,
        elapsedMs: performance.now() - t0,
      },
      computing: false,
      progress: 1,
      elapsedMs: performance.now() - t0,
      fallback: true,
    }));
  };

  const killWorker = () => {
    stopWatchdog();
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null; // 关键：置空以便重建（StrictMode remount / 看门狗）
    }
  };

  const ensureWorker = (): Worker | null => {
    if (typeof Worker === 'undefined') return null;
    if (!workerRef.current) {
      const w = new Worker(new URL('../workers/fieldWorker.ts', import.meta.url), {
        type: 'module',
      });
      w.onmessage = (e: MessageEvent<GridOutMsg>) => {
        const m = e.data;
        if (m.seq !== seqRef.current) return; // 过期消息丢弃
        if (m.type === 'progress') {
          // 有进展：重置看门狗
          stopWatchdog();
          armWatchdog();
          setState((s) => ({ ...s, computing: true, progress: m.pct, runningMs: m.elapsedMs }));
        } else if (m.type === 'result') {
          stopTick();
          stopWatchdog();
          setState((s) => ({
            ...s,
            grid: m,
            computing: false,
            progress: 1,
            elapsedMs: m.elapsedMs,
          }));
        } else if (m.type === 'error') {
          const req = lastReqRef.current;
          if (req && req.seq === m.seq) fallbackCompute(req, `worker 报错：${m.message}`);
        }
      };
      w.onerror = (ev) => {
        const req = lastReqRef.current;
        if (req) fallbackCompute(req, ev.message || 'onerror');
      };
      workerRef.current = w;
    }
    return workerRef.current;
  };

  const lastReqRef = useRef<GridRequest | null>(null);
  const armWatchdog = () => {
    stopWatchdog();
    watchdogRef.current = window.setTimeout(() => {
      const req = lastReqRef.current;
      if (!req) return;
      killWorker();
      fallbackCompute(req, `${WATCHDOG_MS / 1000}s 无进展`);
    }, WATCHDOG_MS);
  };

  const { x0, y0, nx, ny, dx, dy } = gridParams;

  useEffect(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    setState((s) => ({ ...s, computing: true, progress: 0, runningMs: 0 }));
    startTick();
    timerRef.current = window.setTimeout(() => {
      const seq = ++seqRef.current;
      const req: GridRequest = {
        seq,
        mids: elements.mids,
        dls: elements.dls,
        count: elements.count,
        wires: elements.wires,
        I, x0, y0, nx, ny, dx, dy, h,
      };
      lastReqRef.current = req;
      const w = ensureWorker();
      if (!w) {
        fallbackCompute(req, 'Worker API 不可用');
        return;
      }
      armWatchdog();
      w.postMessage(req);
    }, debounceMs);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elements, I, h, x0, y0, nx, ny, dx, dy, debounceMs]);

  // 卸载清理（StrictMode 双挂载时会走一遍：terminate 并置空，remount 时 ensureWorker 重建）
  useEffect(() => {
    return () => {
      stopTick();
      killWorker();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return state;
}
