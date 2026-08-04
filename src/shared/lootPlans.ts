/**
 * 自动战利品计划稳定标识及旧索引迁移规则。
 *
 * 旧版本只保存 planPaths 数组下标，数组调整后同一个数字会指向其他地图。
 * 当前版本改为保存系统计划文件名，文件名同时作为稳定计划标识。
 * 界面顺序可以继续调整，但不能再改变已保存配置的执行目标。
 *
 * 迁移分为三种来源：
 * 1. 当前 GUI 早期版本的 gui_settings.json 使用四项新数组；
 * 2. 旧 usersettings.yaml 默认使用 PR 前的四项数组；
 * 3. 完整旧安装优先读取其 builtin_templates.json 还原真实顺序。
 *
 * 所有迁移结果都必须落入白名单，未知值回退到默认 9-2。
 * 旧 9-4、8-5 计划保留独立系统资源，避免迁移到其他地图。
 * 该模块只处理标识转换，不读取文件，也不负责执行计划。
 */

export const LOOT_PLAN_IDS = [
  'bettle-捞胖次-9-4-6SS.yaml',
  'bettle-周常-9-2.yaml',
  'bettle-周常-7-4.yaml',
  'bettle-捞胖次-8-5.yaml',
  'bettle-周常-8-2.yaml',
  'bettle-周常-2-1.yaml',
] as const;

export type LootPlanId = typeof LOOT_PLAN_IDS[number];

export const DEFAULT_LOOT_PLAN_ID: LootPlanId = 'bettle-周常-9-2.yaml';

/** PR 调整后的旧 GUI JSON 数组，用于一次性迁移 lootPlanIndex。 */
export const INTERIM_LOOT_PLAN_IDS: readonly LootPlanId[] = [
  'bettle-周常-9-2.yaml',
  'bettle-周常-7-4.yaml',
  'bettle-周常-8-2.yaml',
  'bettle-周常-2-1.yaml',
];

/** PR 前四项数组，用于没有安装资源可供识别的 usersettings.yaml。 */
export const LEGACY_LOOT_PLAN_IDS: readonly LootPlanId[] = [
  'bettle-周常-9-2.yaml',
  'bettle-周常-7-4.yaml',
  'bettle-捞胖次-8-5.yaml',
  'bettle-周常-2-1.yaml',
];

const LOOT_PLAN_ID_SET = new Set<string>(LOOT_PLAN_IDS);

/** 判断外部值是否为当前支持的稳定计划标识。 */
export function isLootPlanId(value: unknown): value is LootPlanId {
  return typeof value === 'string' && LOOT_PLAN_ID_SET.has(value);
}

/** 只接受当前内置资源中明确支持的稳定计划标识。 */
export function normalizeLootPlanId(value: unknown): LootPlanId {
  return isLootPlanId(value)
    ? value
    : DEFAULT_LOOT_PLAN_ID;
}

/** 只接受整数或非空整数字符串，避免 null/false 被当成索引 0。 */
export function parseLootPlanIndex(value: unknown): number | null {
  if (
    typeof value !== 'number'
    && (typeof value !== 'string' || !value.trim())
  ) {
    return null;
  }
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

/** 按指定历史数组解释数字索引，非法或越界时交给调用方安全回退。 */
export function lootPlanIdFromIndex(
  value: unknown,
  planIds: readonly LootPlanId[],
): LootPlanId | null {
  const index = parseLootPlanIndex(value);
  if (index === null) return null;
  return planIds[index] ?? null;
}

/** 从旧模板中的路径恢复地图语义，不依赖路径所在目录。 */
export function lootPlanIdFromLegacyPath(
  value: unknown,
): LootPlanId | null {
  if (typeof value !== 'string') return null;
  const file = value.replace(/\\/g, '/').split('/').pop() ?? '';
  if (/9-4/i.test(file)) return 'bettle-捞胖次-9-4-6SS.yaml';
  if (/9-2/i.test(file)) return 'bettle-周常-9-2.yaml';
  if (/7-4/i.test(file)) return 'bettle-周常-7-4.yaml';
  if (/8-5/i.test(file)) return 'bettle-捞胖次-8-5.yaml';
  if (/8-2/i.test(file)) return 'bettle-周常-8-2.yaml';
  if (/2-1/i.test(file)) return 'bettle-周常-2-1.yaml';
  return null;
}
