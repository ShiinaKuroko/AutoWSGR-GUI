/**
 * MapDataLoader —— 加载地图 JSON 数据。
 * 通过 IPC 从 resource/maps/ 目录读取地图数据文件。
 */

/** 地图节点类型 */
export type MapNodeType = 'Start' | 'Normal' | 'Boss' | 'Resource' | 'Penalty' | 'Suppress' | 'Aerial' | 'Hard';

/** 单个地图节点的数据 */
export interface MapPoint {
  type: MapNodeType;
  detour: boolean;
  night: boolean;
  position: [number, number];
  next: string[];
}

/** 一张地图的完整数据 (key → MapPoint) */
export type MapData = Record<string, MapPoint>;

/** 地图数据缓存 */
const mapCache = new Map<string, MapData>();

/** 加载指定章节-关卡的地图数据 */
export async function loadMapData(chapter: number, map: number): Promise<MapData | null> {
  const key = `${chapter}-${map}`;
  if (mapCache.has(key)) return mapCache.get(key)!;

  const filePath = `resource/maps/${key}.json`;
  try {
    const bridge = (window as any).electronBridge;
    const content: string = await bridge.readFile(filePath);
    const data: MapData = JSON.parse(content);
    mapCache.set(key, data);
    return data;
  } catch {
    return null;
  }
}

/** 加载 Ex 关卡地图数据 */
export async function loadExMapData(exNumber: number): Promise<MapData | null> {
  const key = `Ex-${exNumber}`;
  if (mapCache.has(key)) return mapCache.get(key)!;

  const filePath = `resource/maps/${key}.json`;
  try {
    const bridge = (window as any).electronBridge;
    const content: string = await bridge.readFile(filePath);
    const data: MapData = JSON.parse(content);
    mapCache.set(key, data);
    return data;
  } catch {
    return null;
  }
}

function normalizeEventNodeType(raw: unknown): MapNodeType {
  switch (String(raw).toUpperCase()) {
    case 'NULL': return 'Start';
    case 'FIGTH':
    case 'FIGHT': return 'Normal';
    case 'BOSS':
    case 'SPECIAL_BOSS':
    case 'LITTLE_BOSS': return 'Boss';
    default: return 'Normal';
  }
}

/** 加载活动地图。map 可为 1/1a/3b，入口默认 α。 */
export async function loadEventMapData(
  eventName: string,
  chapter: number | string,
  map: number | string,
): Promise<MapData | null> {
  const match = String(map).trim().match(/^(\d+)([ab])?$/i);
  const difficulty = String(chapter).trim().toUpperCase();
  if (!eventName || !match || !['E', 'H'].includes(difficulty)) return null;
  const stage = match[1];
  const entrance = (match[2] ?? 'a').toLowerCase();
  const key = `event-${eventName}-${difficulty}-${stage}${entrance}`;
  if (mapCache.has(key)) return mapCache.get(key)!;

  const filePath = `resource/maps/event/${eventName}/${difficulty}-${stage}${entrance}.json`;
  try {
    const bridge = (window as any).electronBridge;
    const content: string = await bridge.readFile(filePath);
    const raw = JSON.parse(content) as Record<string, Partial<MapPoint>>;
    const data: MapData = {};
    for (const [id, point] of Object.entries(raw)) {
      data[id] = {
        type: normalizeEventNodeType(point.type),
        detour: !!point.detour,
        night: !!point.night,
        position: Array.isArray(point.position) ? point.position as [number, number] : [0, 0],
        next: Array.isArray(point.next) ? point.next.map(String) : [],
      };
    }
    mapCache.set(key, data);
    return data;
  } catch {
    return null;
  }
}

/** 获取地图中某节点的类型，找不到则返回 'Normal' */
export function getNodeType(mapData: MapData, nodeId: string): MapNodeType {
  return mapData[nodeId]?.type ?? 'Normal';
}

/** 获取地图中某节点是否为迂回点 */
export function isDetourNode(mapData: MapData, nodeId: string): boolean {
  return mapData[nodeId]?.detour ?? false;
}

/** 获取地图中某节点是否为夜战点 */
export function isNightNode(mapData: MapData, nodeId: string): boolean {
  return mapData[nodeId]?.night ?? false;
}

/** 获取地图中某节点是否为终端节点（无后续节点，如 BOSS 点） */
export function isTerminalNode(mapData: MapData, nodeId: string): boolean {
  const next = mapData[nodeId]?.next;
  return !next || next.length === 0;
}
