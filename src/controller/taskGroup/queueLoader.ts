/**
 * queueLoader —— 将任务组条目加载到调度队列的独立函数。
 */
import type { TaskGroupModel, TaskGroupItem } from '../../model/TaskGroupModel';
import type { TemplateModel } from '../../model/TemplateModel';
import { PlanModel } from '../../model/PlanModel';
import { TaskPriority, type Scheduler } from '../../model/scheduler';
import type { EventFightReq, NormalFightReq, TaskRequest } from '../../types/api';
import type { ManagedBattlePlanSelection } from '../../types/electronBridge';
import type { TaskPreset } from '../../types/model';
import { resolveFleetPreset, resolveFleetPresetRules, toBackendName } from '../../data/shipData';
import { Logger } from '../../utils/Logger';
import { normalizeSelectedNodesForBackend } from '../plan/selectedNodes';
import type { TaskGroupHost } from './TaskGroupController';
import { readTaskGroupItemFile } from './managedPlanReader';

export function buildPlanQueueRequest(
  item: TaskGroupItem,
  plan: PlanModel,
  planId: string,
): {
  req: NormalFightReq | EventFightReq;
  selectedFleetId: number | undefined;
} {
  const req: NormalFightReq | EventFightReq = {
    type: plan.isEvent ? 'event_fight' : 'normal_fight',
    plan_id: planId,
    times: 1,
    gap: plan.data.gap ?? 0,
  };
  if (plan.data.selected_nodes.length > 0) {
    req.plan = req.plan ?? {};
    req.plan.selected_nodes = normalizeSelectedNodesForBackend(
      plan.data.selected_nodes,
    );
  }

  const selectedFleetId = item.fleet_id ?? plan.data.fleet_id;
  if (selectedFleetId != null) {
    if (req.type === 'event_fight') req.fleet_id = selectedFleetId;
    req.plan = req.plan ?? {};
    req.plan.fleet_id = selectedFleetId;
  }

  const presets = plan.data.fleet_presets;
  if (presets?.length) {
    // 旧任务列表未保存索引时沿用原行为，默认使用第一支编队。
    const presetIndex = item.fleetPresetIndex ?? 0;
    const preset = presets[presetIndex];
    if (!preset) {
      throw new Error(`选择的使用舰队不存在（索引 ${presetIndex}）`);
    }
    const resolved = resolveFleetPreset(preset.ships);
    const rules = resolveFleetPresetRules(preset.ships);
    if (resolved.length === 0 || rules.length === 0) {
      throw new Error(`使用舰队「${preset.name}」没有可用舰船`);
    }

    // 后端覆盖请求只携带这一支编队，其他 fleet_presets 不进入请求。
    req.plan = req.plan ?? {};
    req.plan.fleet = resolved.map(toBackendName);
    req.plan.fleet_rules = rules;
  } else if (item.fleetPresetIndex != null) {
    throw new Error('作战计划中已没有所选使用舰队');
  }

  return { req, selectedFleetId };
}

interface PlanQueueHost {
  readonly scheduler: Scheduler;
  renderMain(): void;
}

function addPlanTaskToQueue(
  item: TaskGroupItem,
  plan: PlanModel,
  planId: string,
  scheduler: Scheduler,
): void {
  const { req, selectedFleetId } = buildPlanQueueRequest(item, plan, planId);
  scheduler.addTask(
    plan.mapName,
    plan.isEvent ? 'event_fight' : 'normal_fight',
    req,
    TaskPriority.USER_TASK,
    item.times,
    plan.data.stop_condition,
    undefined,
    selectedFleetId,
    undefined,
    undefined,
    !!item.forceRetry,
    !!item.allowPolling,
    plan.data.endpoint_nodes,
    plan.data.result,
    typeof plan.data.chapter === 'number'
      ? plan.data.chapter || undefined
      : undefined,
  );
}

/** 按任务预设类型构造请求并直接加入调度队列。 */
function addPresetTaskToQueue(
  item: TaskGroupItem,
  preset: TaskPreset,
  scheduler: Scheduler,
): void {
  let req: TaskRequest;
  if (preset.task_type === 'campaign') {
    req = {
      type: 'campaign',
      campaign_name: preset.campaign_name ?? '',
      times: 1,
    };
  } else if (preset.task_type === 'exercise') {
    req = {
      type: 'exercise',
      fleet_id: preset.fleet_id ?? 1,
    };
  } else if (preset.task_type === 'decisive') {
    req = {
      type: 'decisive',
      chapter: preset.chapter,
      level1: preset.level1 ?? [],
      level2: preset.level2 ?? [],
      flagship_priority: preset.flagship_priority ?? [],
      use_quick_repair: preset.use_quick_repair,
    };
  } else {
    req = {
      type: preset.task_type,
      plan_id: preset.plan_id,
      times: 1,
      gap: preset.gap ?? 0,
      fleet_id: preset.fleet_id,
    };
  }
  const effectiveTimes = (
    preset.task_type === 'exercise'
    || preset.task_type === 'decisive'
  )
    ? 1
    : Math.max(1, item.times || preset.times || 1);
  scheduler.addTask(
    item.label,
    preset.task_type,
    req,
    TaskPriority.USER_TASK,
    effectiveTimes,
    preset.stop_condition,
    undefined,
    preset.fleet_id,
  );
}

/** 将计划浮窗选中的受管计划直接加入任务队列。 */
export async function loadManagedPlanToQueue(
  selection: ManagedBattlePlanSelection,
  host: PlanQueueHost,
): Promise<void> {
  const item: TaskGroupItem = {
    managedSource: selection.plan.source,
    managedFile: selection.plan.file,
    kind: selection.plan.kind === 'preset' ? 'preset' : 'plan',
    times: Math.max(1, selection.plan.times || 1),
    label: selection.plan.name,
    fleetPresetIndex: selection.fleetPresetIndex,
  };
  const { content, path } = await readTaskGroupItemFile(item);
  const parsed = (await import('js-yaml')).load(content) as Record<
    string,
    unknown
  >;
  if (
    item.kind === 'preset'
    || ('task_type' in parsed && !('map' in parsed))
  ) {
    addPresetTaskToQueue(
      item,
      parsed as unknown as TaskPreset,
      host.scheduler,
    );
  } else {
    const plan = PlanModel.fromYaml(content, path);
    addPlanTaskToQueue(item, plan, path, host.scheduler);
  }
  Logger.info(`已将「${selection.plan.name}」加入任务队列`);
  host.renderMain();
}

/** 加载整个任务组到调度队列 */
export async function loadGroupToQueue(
  taskGroupModel: TaskGroupModel,
  templateModel: TemplateModel,
  host: TaskGroupHost,
): Promise<void> {
  const group = taskGroupModel.getActiveGroup();
  if (!group || group.items.length === 0) { Logger.warn('当前任务组为空'); return; }
  const bridge = window.electronBridge;
  if (!bridge) return;

  let loadedCount = 0;
  for (const item of group.items) {
    try {
      if (item.kind === 'template') {
        loadedCount += loadTemplateToQueue(item, templateModel, host) ? 1 : 0;
        continue;
      }

      const { content, path } = await readTaskGroupItemFile(item);
      const parsed = (await import('js-yaml')).load(content) as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object') continue;

      if (item.kind === 'preset' || ('task_type' in parsed && !('map' in parsed))) {
        addPresetTaskToQueue(
          item,
          parsed as unknown as TaskPreset,
          host.scheduler,
        );
      } else {
        const plan = PlanModel.fromYaml(content, path);
        addPlanTaskToQueue(item, plan, plan.fileName, host.scheduler);
      }
      loadedCount++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      Logger.error(`加载「${item.label}」失败: ${msg}`);
    }
  }

  if (loadedCount > 0) {
    Logger.info(`已从任务组「${group.name}」加载 ${loadedCount} 个任务到队列`);
    host.switchPage('main');
    host.renderMain();
  }
}

/** 将模板类型条目加载到调度队列 */
export function loadTemplateToQueue(
  item: TaskGroupItem,
  templateModel: TemplateModel,
  host: TaskGroupHost,
): boolean {
  const tpl = templateModel.get(item.templateId ?? '');
  if (!tpl) { Logger.error(`模板「${item.label}」不存在，可能已被删除`); return false; }

  let req: TaskRequest;
  const times = item.times;
  const allowPolling = item.allowPolling ?? tpl.allowPolling ?? false;

  switch (tpl.type) {
    case 'exercise':
      req = { type: 'exercise', fleet_id: item.fleet_id ?? tpl.fleet_id ?? 1 };
      host.scheduler.addTask(item.label || tpl.name, 'exercise', req, TaskPriority.USER_TASK, 1, undefined, undefined, undefined, undefined, undefined, undefined, allowPolling);
      break;
    case 'campaign': {
      const cName = item.campaignName ?? tpl.campaign_name ?? '困难潜艇';
      req = { type: 'campaign', campaign_name: cName, times: 1 };
      host.scheduler.addTask(item.label || tpl.name, 'campaign', req, TaskPriority.USER_TASK, times, undefined, undefined, undefined, undefined, undefined, undefined, allowPolling);
      break;
    }
    case 'decisive':
      req = {
        type: 'decisive',
        chapter: item.chapter ?? tpl.chapter ?? 6,
        level1: tpl.level1 ?? [],
        level2: tpl.level2 ?? [],
        flagship_priority: tpl.flagship_priority ?? [],
        use_quick_repair: tpl.use_quick_repair,
      };
      host.scheduler.addTask(item.label || tpl.name, 'decisive', req, TaskPriority.USER_TASK, times, undefined, undefined, undefined, undefined, undefined, undefined, allowPolling);
      break;
    default:
      return false;
  }
  return true;
}

/** 加载单个条目到队列（拖拽触发） */
export async function loadSingleItemToQueue(
  index: number,
  taskGroupModel: TaskGroupModel,
  templateModel: TemplateModel,
  host: TaskGroupHost,
): Promise<void> {
  const group = taskGroupModel.getActiveGroup();
  if (!group) return;
  const item = group.items[index];
  if (!item) return;

  if (item.kind === 'template') {
    loadTemplateToQueue(item, templateModel, host);
    Logger.info(`已将「${item.label}」加入队列`);
    host.renderMain();
    return;
  }

  const bridge = window.electronBridge;
  if (!bridge) return;

  try {
    const { content, path } = await readTaskGroupItemFile(item);
    const parsed = (await import('js-yaml')).load(content) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return;

    if (item.kind === 'preset' || ('task_type' in parsed && !('map' in parsed))) {
      addPresetTaskToQueue(
        item,
        parsed as unknown as TaskPreset,
        host.scheduler,
      );
    } else {
      const plan = PlanModel.fromYaml(content, path);
      addPlanTaskToQueue(item, plan, plan.fileName, host.scheduler);
    }

    Logger.info(`已将「${item.label}」加入队列`);
    host.renderMain();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    Logger.error(`加载「${item.label}」失败: ${msg}`);
  }
}
