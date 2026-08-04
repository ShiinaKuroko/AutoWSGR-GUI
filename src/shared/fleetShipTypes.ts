/** GUI 显示和 YAML 校验共用的后端舰种代码。 */
export const TYPE_LABELS: Record<string, string> = {
  bb: '战列', bbv: '航战', bbg: '导战',
  bc: '战巡', cbg: '大巡',
  cv: '航母', cvl: '轻母', av: '装母',
  ca: '重巡', cav: '航巡',
  cl: '轻巡', clt: '雷巡',
  dd: '驱逐', ddg: '导驱', ddgaa: '防驱',
  ss: '潜艇', sc: '炮潜', ssg: '导潜',
  ss_or_ssg: '潜艇/导潜',
  bm: '重炮', ap: '补给', cg: '导巡', cgaa: '防巡',
};

export const FLEET_SHIP_TYPE_CODES = Object.freeze(Object.keys(TYPE_LABELS));

export function shipTypeLabel(code: string): string {
  return TYPE_LABELS[code] || code;
}
