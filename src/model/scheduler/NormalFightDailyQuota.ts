/** 维护自动出征计划每日完成次数，并在本地日期变化时重置。 */
import {
  browserStorageStore,
  type StorageStore,
} from '../../adapter/StorageAdapter.js';
import type { NormalFightTaskConfig } from '../../types/model.js';

export const MAX_NORMAL_FIGHT_DAILY_EXECUTIONS = 999;
export const DEFAULT_NORMAL_FIGHT_DAILY_EXECUTIONS = 1;

const STORAGE_KEY = 'normal_fight_daily_quota_v1';
const STORAGE_VERSION = 1;

interface PersistedNormalFightQuota {
  version: number;
  dateKey: string;
  completed: Record<string, number>;
}

function localDateKey(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function emptyState(timestamp: number): PersistedNormalFightQuota {
  return {
    version: STORAGE_VERSION,
    dateKey: localDateKey(timestamp),
    completed: {},
  };
}

export function normalFightDailyLimit(
  value: unknown,
  fallback = DEFAULT_NORMAL_FIGHT_DAILY_EXECUTIONS,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(
    1,
    Math.min(MAX_NORMAL_FIGHT_DAILY_EXECUTIONS, Math.trunc(parsed)),
  );
}

export function normalFightTaskKey(task: NormalFightTaskConfig): string {
  const name = task.name.trim().replace(/\\/g, '/').toLocaleLowerCase();
  return JSON.stringify([
    name,
    task.fleet_id ?? null,
    task.fleet_preset_index ?? null,
  ]);
}

/** 按计划和舰队去重，兼容旧配置中的重复自动出征项。 */
export function uniqueNormalFightTasks(
  tasks: readonly NormalFightTaskConfig[],
): NormalFightTaskConfig[] {
  const seen = new Set<string>();
  return tasks.filter((task) => {
    const key = normalFightTaskKey(task);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sanitizeState(
  value: unknown,
  timestamp: number,
): PersistedNormalFightQuota {
  if (!value || typeof value !== 'object') return emptyState(timestamp);
  const source = value as Partial<PersistedNormalFightQuota>;
  if (
    source.version !== STORAGE_VERSION
    || source.dateKey !== localDateKey(timestamp)
    || !source.completed
    || typeof source.completed !== 'object'
  ) {
    return emptyState(timestamp);
  }

  const completed: Record<string, number> = {};
  for (const [key, rawCount] of Object.entries(source.completed)) {
    const count = Number(rawCount);
    if (key && Number.isFinite(count) && count > 0) {
      completed[key] = Math.trunc(count);
    }
  }
  return {
    version: STORAGE_VERSION,
    dateKey: source.dateKey,
    completed,
  };
}

export class NormalFightDailyQuota {
  private state: PersistedNormalFightQuota;

  constructor(
    private readonly storage: StorageStore = browserStorageStore,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.state = this.load(this.now());
  }

  remaining(
    task: NormalFightTaskConfig,
    timestamp = this.now(),
  ): number {
    this.ensureCurrentDay(timestamp);
    const limit = normalFightDailyLimit(task.times);
    const completed = this.state.completed[normalFightTaskKey(task)] ?? 0;
    return Math.max(0, limit - completed);
  }

  totalRemaining(
    tasks: readonly NormalFightTaskConfig[],
    timestamp = this.now(),
  ): number {
    return uniqueNormalFightTasks(tasks).reduce(
      (total, task) => total + this.remaining(task, timestamp),
      0,
    );
  }

  hasRemaining(
    tasks: readonly NormalFightTaskConfig[],
    timestamp = this.now(),
  ): boolean {
    return uniqueNormalFightTasks(tasks)
      .some(task => this.remaining(task, timestamp) > 0);
  }

  markCompleted(
    task: NormalFightTaskConfig,
    timestamp = this.now(),
  ): number {
    this.ensureCurrentDay(timestamp);
    const key = normalFightTaskKey(task);
    this.state.completed[key] = (this.state.completed[key] ?? 0) + 1;
    this.save();
    return this.remaining(task, timestamp);
  }

  private ensureCurrentDay(timestamp: number): void {
    if (this.state.dateKey === localDateKey(timestamp)) return;
    this.state = emptyState(timestamp);
    this.save();
  }

  private load(timestamp: number): PersistedNormalFightQuota {
    try {
      const raw = this.storage.get(STORAGE_KEY);
      return raw
        ? sanitizeState(JSON.parse(raw), timestamp)
        : emptyState(timestamp);
    } catch {
      return emptyState(timestamp);
    }
  }

  private save(): void {
    try {
      this.storage.set(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // 存储不可用时仅影响跨重启恢复，不阻断调度。
    }
  }
}
