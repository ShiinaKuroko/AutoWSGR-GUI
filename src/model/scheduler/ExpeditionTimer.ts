/** 根据远征状态计算并发布下一次收取倒计时。 */
/**
 * ExpeditionTimer — 远征定时器。
 * 从 Scheduler 中拆出，负责远征检查的定时触发和倒计时。
 */

const EXPEDITION_TIMER_TICK_MS = 1000;

export interface ExpeditionTimerCallbacks {
  /** 倒计时 tick (秒); 负数表示远征收取进行中(倒计时挂起) */
  onTick?: (remainingSeconds: number) => void;
  /** 定时器触发，由调用方决定是否插入远征任务 */
  onTrigger: () => void;
}

export class ExpeditionTimer {
  private timer: ReturnType<typeof setInterval> | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private lastCheck = 0;
  /** 挂起标志: 远征检查已触发、但收取尚未结束。挂起期间倒计时停在 0, 等
   * markCompleted() (收取任务真正结束) 才从零重新计满一个间隔, 保证间隔是
   * 「两次收取结束之间」而不是「触发到触发」(否则收取本身耗时会吃掉间隔)。 */
  private _pendingCheck = false;
  private _intervalMs: number;
  private callbacks: ExpeditionTimerCallbacks;

  constructor(intervalMs: number, callbacks: ExpeditionTimerCallbacks) {
    this._intervalMs = intervalMs;
    this.callbacks = callbacks;
  }

  /** 更新间隔（毫秒），如果正在运行则自动重启 */
  setInterval(ms: number): void {
    this._intervalMs = ms;
    if (this.timer) {
      this.start();
    }
  }

  start(): void {
    this.lastCheck = Date.now();
    this._pendingCheck = false;
    this.stop();

    this.timer = setInterval(() => this.fire(), this._intervalMs);

    this.tickTimer = setInterval(() => this.emitTick(), EXPEDITION_TIMER_TICK_MS);
    this.emitTick();
  }

  /** 到点: 通知调度器排入远征检查任务; 倒计时由 hold() 挂起 */
  fire(): void {
    if (this._pendingCheck) {
      // 兜底: 上一轮远征未上报结束(任务被取消 / 异常), 强制重置避免倒计时永久挂起
      this.lastCheck = Date.now();
      this._pendingCheck = false;
    }
    this.callbacks.onTrigger();
  }

  /** 远征任务已排入队列: 挂起倒计时, 等收取结束后再重置 */
  hold(): void {
    this._pendingCheck = true;
    this.emitTick();
  }

  /** 远征收取任务结束: 从此刻起重新计满一个间隔 */
  markCompleted(): void {
    if (!this._pendingCheck) return;
    this._pendingCheck = false;
    this.lastCheck = Date.now();
    if (this.timer != null) {
      // 重新装填, 保证下次到点是「本次收取结束 + interval」而非原固定节拍
      clearInterval(this.timer);
      this.timer = setInterval(() => this.fire(), this._intervalMs);
    }
    this.emitTick();
  }

  emitTick(): void {
    if (this._pendingCheck) {
      this.callbacks.onTick?.(-1);
      return;
    }
    const elapsed = Date.now() - this.lastCheck;
    const remaining = Math.max(0, this._intervalMs - elapsed);
    this.callbacks.onTick?.(Math.ceil(remaining / 1000));
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  get isRunning(): boolean {
    return this.timer != null;
  }
}
