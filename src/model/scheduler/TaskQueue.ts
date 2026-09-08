/** 唯一持有就绪与延迟队列，并实现优先级和轮询排序。 */
/**
 * TaskQueue —— 优先级任务队列 + 延迟任务管理。
 * 从 Scheduler.ts 拆出，封装队列数据结构及相关操作。
 */
import type { TaskRequest } from '../../types/api.js';
import type {
  StopCondition,
  BattleResultGrade,
} from '../../types/model.js';
import { TaskPriority, type SchedulerTaskType, type SchedulerTask } from '../../types/scheduler';
import { createSchedulerTask, findPriorityInsertionIndex } from './SchedulerTaskPolicy.js';

// ════════════════════════════════════════
// ID 生成 & 辅助函数
// ════════════════════════════════════════

let nextTaskId = 1;

export function generateTaskId(): string {
  return `sched_${nextTaskId++}`;
}

/** 从 "[UI] 战利品数量: 50/50" 格式中提取当前值 */
export function parseUiCount(msg: string, label: string): number | null {
  const re = new RegExp(`\\[UI\\] ${label}[:：]\\s*(\\d+)`);
  const m = msg.match(re);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * 将支持重复执行的后端请求拆成调度器管理的单轮任务。
 * 兼容旧数据中写在 request.times 的总次数，并保留 GUI 的无限任务语义。
 */
export function normalizeRoundTask(
  type: SchedulerTaskType,
  request: TaskRequest,
  times: number,
): { request: TaskRequest; times: number } {
  const schedulerTimes = times === Number.POSITIVE_INFINITY
    ? times
    : Number.isFinite(times)
      ? Math.max(1, Math.trunc(times))
      : 1;
  const isRoundBased = type === 'normal_fight'
    || type === 'event_fight'
    || type === 'campaign';
  const hasRoundRequest = request.type === 'normal_fight'
    || request.type === 'event_fight'
    || request.type === 'campaign';
  if (!isRoundBased || !hasRoundRequest) {
    return { request, times: schedulerTimes };
  }

  const requestTimes = Number.isFinite(request.times)
    ? Math.max(1, Math.trunc(request.times ?? 1))
    : 1;
  return {
    request: { ...request, times: 1 },
    times: schedulerTimes === Number.POSITIVE_INFINITY
      ? schedulerTimes
      : Math.max(schedulerTimes, requestTimes),
  };
}

// ════════════════════════════════════════
// TaskQueue 实现
// ════════════════════════════════════════

export class TaskQueue {
  private queue: SchedulerTask[] = [];

  // ── 队列读取 ──

  get items(): ReadonlyArray<SchedulerTask> {
    return this.queue;
  }

  get length(): number {
    return this.queue.length;
  }

  /** 从队首取出一个任务 */
  shift(): SchedulerTask | undefined {
    return this.queue.shift();
  }

  /** 检查队列中是否存在指定类型的任务 */
  hasType(type: SchedulerTaskType): boolean {
    return this.queue.some(t => t.type === type);
  }

  // ── 队列写入 ──

  /**
   * 按优先级插入队列。
   * 同优先级内按 sortKey 升序排列（sortKey 越小越靠前）。
   * beforeSamePriority=true 时，会插入到同优先级任务之前（用于重试/跟随）。
   */
  insertByPriority(task: SchedulerTask, beforeSamePriority = false): void {
    const idx = findPriorityInsertionIndex(this.queue, task, beforeSamePriority);
    if (idx === -1) {
      this.queue.push(task);
    } else {
      this.queue.splice(idx, 0, task);
    }
  }

  /** 创建任务并按优先级入队，返回任务 ID */
  addTask(
    name: string,
    type: SchedulerTaskType,
    request: TaskRequest,
    priority: TaskPriority = TaskPriority.USER_TASK,
    times: number = 1,
    stopCondition?: StopCondition,
    forceRetry?: boolean,
    allowPolling?: boolean,
    endpointNodes?: string[],
    endpointResult?: BattleResultGrade,
    sortKey?: number,
  ): string {
    const id = generateTaskId();
    const normalized = normalizeRoundTask(type, request, times);
    const task = createSchedulerTask({
      id,
      name,
      type,
      request: normalized.request,
      priority,
      times: normalized.times,
      stopCondition,
      forceRetry,
      allowPolling,
      endpointNodes,
      endpointResult,
      sortKey,
    });
    this.insertByPriority(task);
    return id;
  }

  /** 查找队列中的任务。 */
  findTask(taskId: string): SchedulerTask | null {
    return this.queue.find(task => task.id === taskId) ?? null;
  }

  /** 移除队列中的任务，并返回被移除的任务。 */
  removeTask(taskId: string): SchedulerTask | null {
    const idx = this.queue.findIndex((t) => t.id === taskId);
    if (idx === -1) return null;
    return this.queue.splice(idx, 1)[0];
  }

  removeTasksByLogicalId(logicalId: string): void {
    this.queue = this.queue.filter(task => task.logicalId !== logicalId);
  }

  /** 移动队列中的任务顺序 */
  moveTask(fromIndex: number, toIndex: number): void {
    if (fromIndex < 0 || fromIndex >= this.queue.length) return;
    if (toIndex < 0 || toIndex >= this.queue.length) return;
    if (fromIndex === toIndex) return;
    const [task] = this.queue.splice(fromIndex, 1);
    this.queue.splice(toIndex, 0, task);
  }

  /** 清空队列 */
  clear(): void {
    this.queue = [];
  }

}
