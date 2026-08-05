/** 加载静态舰船资料并提供舰名和国籍只读目录。 */
import rawShips from '../data/ship_details.json';

export interface ShipInfo {
  name: string;
  nation: string;
  ship_type: string;
}

export const ALL_SHIPS: readonly ShipInfo[] = rawShips.map(ship => ({
  name: ship.name,
  nation: ship.nation,
  ship_type: ship.ship_type,
}));

export const ALL_NATIONS: readonly string[] = (() => {
  const priority = [
    '中国',
    '日本',
    '德国',
    '美国',
    '英国',
    '苏联',
    '法国',
    '意大利',
  ];
  const all = [...new Set(ALL_SHIPS.map(ship => ship.nation))];
  return [
    ...priority.filter(nation => all.includes(nation)),
    ...all.filter(nation => !priority.includes(nation)),
  ];
})();
