/**
 * metaLoader —— 异步加载任务组条目的元信息。
 */
import type { TaskGroupItem } from '../../model/TaskGroupModel';
import type { TemplateModel } from '../../model/TemplateModel';
import type { TaskGroupItemMeta } from '../../view/taskGroup/TaskGroupView';

const REPAIR: Record<number, string> = { 1: '中破就修', 2: '大破才修' };
const TYPE_LABELS: Record<string, string> = {
  normal_fight: '普通出击', event_fight: '活动出击',
  exercise: '演习', campaign: '战役', decisive: '决战',
};

export async function loadItemMetas(
  items: ReadonlyArray<TaskGroupItem>,
  templateModel: TemplateModel,
): Promise<(TaskGroupItemMeta | null)[]> {
  const bridge = window.electronBridge;
  if (!bridge) return items.map(() => null);

  return Promise.all(items.map(async (item): Promise<TaskGroupItemMeta | null> => {
    try {
      if (item.kind === 'template') {
        const tpl = templateModel.get(item.templateId ?? '');
        if (!tpl) return { typeLabel: '模板已删除' };
        const meta: TaskGroupItemMeta = { typeLabel: TYPE_LABELS[tpl.type] ?? tpl.type };
        if (tpl.fleet_id) meta.fleetId = tpl.fleet_id;
        if (item.fleet_id) meta.fleetId = item.fleet_id;
        if (tpl.fleet?.length) meta.fleet = tpl.fleet.filter(Boolean);
        if (item.campaignName) meta.mapName = item.campaignName;
        else if (tpl.campaign_name) meta.mapName = tpl.campaign_name;
        if (item.chapter) meta.mapName = `决战第${item.chapter}章`;
        else if (tpl.chapter) meta.mapName = `决战第${tpl.chapter}章`;
        return meta;
      }

      const content = await bridge.readFile(item.path!);
      const parsed = (await import('js-yaml')).load(content) as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object') return null;

      const meta: TaskGroupItemMeta = {};
      if (item.autoFleetFallback) meta.autoFleetFallback = true;

      if ('chapter' in parsed && 'map' in parsed) {
        const ch = String(parsed.chapter);
        const mp = String(parsed.map);
        if ('event' in parsed || /^[EH]$/i.test(ch)) {
          const match = mp.match(/^(\d+)([ab])?$/i);
          const entrance = match?.[2]?.toLowerCase() === 'b' ? 'β' : 'α';
          meta.mapName = `${ch.toUpperCase()}-Ex-${match?.[1] ?? mp}-${entrance}`;
          meta.typeLabel = '活动出击';
        } else {
          const chapterNumber = Number(ch);
          meta.mapName = chapterNumber === 99 ? `Ex-${Number(mp)}` : `${chapterNumber}-${Number(mp)}`;
        }
      }

      if ('fleet_id' in parsed) meta.fleetId = Number(parsed.fleet_id) || undefined;

      if ('repair_mode' in parsed) {
        const rm = parsed.repair_mode;
        if (typeof rm === 'number') meta.repairMode = REPAIR[rm] ?? `修理${rm}`;
        else if (Array.isArray(rm)) meta.repairMode = REPAIR[rm[0]] ?? `修理${rm[0]}`;
      }

      if ('task_type' in parsed && !('chapter' in parsed)) {
        meta.typeLabel = TYPE_LABELS[String(parsed.task_type)] ?? String(parsed.task_type);
      }

      if ('fleet' in parsed && Array.isArray(parsed.fleet)) {
        meta.fleet = (parsed.fleet as unknown[]).map(s => String(s || '')).filter(Boolean);
      }

      return meta;
    } catch {
      return null;
    }
  }));
}
