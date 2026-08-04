/** 维护任务优先级、状态文案和修理模式等界面常量。 */
import { TaskPriority } from '../../model/scheduler';
import { REPAIR_MODE_NAMES } from '../../types/model.js';

/** 优先级 → 中文标签 */
export const PRIORITY_LABELS: Record<number, string> = {
  [TaskPriority.EXPEDITION]: '远征',
  [TaskPriority.USER_TASK]: '用户',
  [TaskPriority.DAILY]: '日常',
};

/** 调度器状态 → 中文文案 */
export const STATUS_TEXT: Record<string, string> = {
  idle: '空闲',
  running: '运行中',
  stopping: '正在停止…',
  not_connected: '未连接',
};

/** 将 repair_mode（数字或数组）转换为显示文本 */
export function resolveRepairModeLabel(mode: number | number[]): string {
  if (Array.isArray(mode)) {
    const unique = [...new Set(mode)];
    if (unique.length === 1) return REPAIR_MODE_NAMES[unique[0]] ?? '中破就修';
    const circled = ['①','②','③','④','⑤','⑥'];
    const short: Record<number, string> = { 1: '中破', 2: '大破' };
    return mode.map((v, i) => `${circled[i] ?? (i+1)}${short[v] ?? v}`).join(' ');
  }
  return REPAIR_MODE_NAMES[mode] ?? '中破就修';
}
