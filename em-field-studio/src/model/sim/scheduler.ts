/**
 * 多速率周期任务调度器（Phase 12）：物理积分步长 dtSim 与控制任务周期分离。
 *
 * 时间轴为整数微秒（dtSimMs 与各 periodMs 经 Math.round(x×1000) 转换），
 * 时钟推进、到期判定、到期点推进全部整数运算，长程仿真无浮点漂移；
 * 仅在对外（SensorReadings.tMs）时换算回 float ms。
 *
 * 触发语义：任务到期（now ≥ due）即触发一次，随后 due += periodUs 循环推进至
 * due > now——过期周期合并（单个 tick 内同一任务至多触发一次，不补触发）；
 * 控制指令在两个 tick 之间零阶保持。任务按注册顺序执行。
 * 现有循迹行为 = 单任务 periodMs = dtMs 的特例（每 tick 恰好触发一次）。
 */
export interface ScheduledTaskDef {
  /** 任务周期（ms） */
  periodMs: number;
  /** 到周期触发的入口 */
  entry: () => void;
}

export class Scheduler {
  /** 物理积分步长（整数 µs） */
  private dtSimUs: number;
  private nowUs = 0;
  private tasks: { periodUs: number; dueUs: number; entry: () => void }[];

  constructor(dtSimMs: number, tasks: ScheduledTaskDef[]) {
    this.dtSimUs = Math.max(1, Math.round(dtSimMs * 1000));
    this.tasks = tasks.map((t) => ({
      periodUs: Math.max(1, Math.round(t.periodMs * 1000)),
      dueUs: 0,
      entry: t.entry,
    }));
  }

  /** 复位时钟与全部任务到期点 */
  reset(): void {
    this.nowUs = 0;
    for (const t of this.tasks) t.dueUs = 0;
  }

  /** 当前仿真时钟（ms，由整数 µs 换算，无累积误差） */
  get nowMs(): number {
    return this.nowUs / 1000;
  }

  /** 当前物理步长（µs） */
  get stepUs(): number {
    return this.dtSimUs;
  }

  /** 改物理步长（时钟与任务到期点保持不变） */
  setStepMs(dtSimMs: number): void {
    this.dtSimUs = Math.max(1, Math.round(dtSimMs * 1000));
  }

  /** 触发当前时刻到期的任务（注册序；过期周期合并，每任务至多一次） */
  runDue(): void {
    for (const t of this.tasks) {
      if (this.nowUs >= t.dueUs) {
        t.entry();
        do {
          t.dueUs += t.periodUs;
        } while (t.dueUs <= this.nowUs);
      }
    }
  }

  /** 时钟推进一个物理 tick */
  advance(): void {
    this.nowUs += this.dtSimUs;
  }
}
