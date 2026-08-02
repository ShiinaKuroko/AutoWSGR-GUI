import type {
  CurrentFleetShipVO,
  MainViewObject,
  TaskQueueItemVO,
} from '../../types/view';
import type { Scheduler } from '../../model/scheduler';
import type { TaskRequest } from '../../types/api';
import { PRIORITY_LABELS, STATUS_TEXT } from './constants';

export interface RenderingState {
  readonly scheduler: Scheduler;
  currentProgress: string;
  trackedLoot: string;
  trackedShip: string;
  wsConnected: boolean;
  expeditionTimerText: string;
}

/** 根据日志中解析到的后端 OCR 数据构建资源文本 */
export function buildAcquisitionText(trackedLoot: string, trackedShip: string): string | undefined {
  const parts: string[] = [];
  if (trackedLoot) parts.push(`装备 ${trackedLoot}`);
  if (trackedShip) parts.push(`舰船 ${trackedShip}`);
  return parts.length > 0 ? parts.join(' | ') : undefined;
}

function normalizedShipName(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function fleetRuleShip(rule: unknown): CurrentFleetShipVO | null {
  if (typeof rule === 'string') {
    const name = rule.trim();
    return name ? { name } : null;
  }
  if (!rule || typeof rule !== 'object') return null;
  const record = rule as Record<string, unknown>;
  const searchName = normalizedShipName(record['search_name']);
  const name = normalizedShipName(record['name']) || searchName;
  if (!name) return null;
  return searchName && searchName !== name
    ? { name, searchName }
    : { name };
}

function firstCandidateShip(rule: unknown): CurrentFleetShipVO | null {
  if (!rule || typeof rule !== 'object') return null;
  const candidates = (rule as Record<string, unknown>)['candidates'];
  if (!Array.isArray(candidates)) return null;
  return fleetRuleShip(candidates[0]);
}

/** 仅返回当前请求中能够明确识别的编队，不根据舰队编号猜测舰船。 */
export function resolveCurrentFleet(
  request: TaskRequest,
): CurrentFleetShipVO[] {
  if (request.type !== 'normal_fight' && request.type !== 'event_fight') {
    return [];
  }
  const rules = Array.isArray(request.plan?.fleet_rules)
    ? request.plan.fleet_rules
    : [];
  const fleet = Array.isArray(request.plan?.fleet)
    ? request.plan.fleet
    : [];
  const slotCount = Math.min(6, Math.max(rules.length, fleet.length));
  const ships: CurrentFleetShipVO[] = [];
  for (let index = 0; index < slotCount; index += 1) {
    const fleetName = normalizedShipName(fleet[index]);
    const ship = fleetRuleShip(rules[index])
      || firstCandidateShip(rules[index])
      || (fleetName ? { name: fleetName } : null);
    if (ship) ships.push(ship);
  }
  return ships;
}

/** 从调度器状态 + 追踪数据拼装 MainViewObject */
export function buildMainViewObject(state: RenderingState): MainViewObject {
  const { scheduler, currentProgress, trackedLoot, trackedShip, wsConnected, expeditionTimerText } = state;
  const running = scheduler.currentRunningTask;
  const queue = scheduler.taskQueue;

  const taskQueueVo: TaskQueueItemVO[] = [];

  if (running) {
    let progressPercent = 0;
    if (currentProgress) {
      const parts = currentProgress.split('/');
      if (parts.length === 2) {
        const cur = parseInt(parts[0], 10);
        const total = parseInt(parts[1], 10);
        if (total > 0) progressPercent = cur / total;
      }
    }
    taskQueueVo.push({
      id: running.id,
      name: running.name,
      priorityLabel: PRIORITY_LABELS[running.priority] ?? '用户',
      remaining: running.remainingTimes,
      totalTimes: running.totalTimes,
      unlimited: running.unlimited,
      progress: currentProgress || undefined,
      progressPercent,
      acquisitionText: buildAcquisitionText(trackedLoot, trackedShip),
    });
  }

  for (const t of queue) {
    taskQueueVo.push({
      id: t.id,
      name: t.name,
      priorityLabel: PRIORITY_LABELS[t.priority] ?? '用户',
      remaining: t.remainingTimes,
      totalTimes: t.totalTimes,
      unlimited: t.unlimited,
    });
  }

  return {
    status: scheduler.status === 'not_connected' ? 'not_connected' : scheduler.status,
    statusText: STATUS_TEXT[scheduler.status] ?? '未知',
    currentTask: running
      ? {
          name: running.name,
          type: running.type as MainViewObject['currentTask'] extends null ? never : NonNullable<MainViewObject['currentTask']>['type'],
          progress: currentProgress || '0/0',
          startedAt: '',
        }
      : null,
    currentFleet: running
      ? resolveCurrentFleet(running.request)
      : [],
    expeditionTimer: expeditionTimerText,
    taskQueue: taskQueueVo,
    wsConnected,
    runningTaskId: running?.id ?? null,
  };
}
