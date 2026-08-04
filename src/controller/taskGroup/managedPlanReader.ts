/** 读取受管作战方案并统一返回内容和来源信息。 */
/**
 * Reads a task-list item from either the managed plan directories or a
 * legacy/local file path.
 */
import type { TaskGroupItem } from '../../model/TaskGroupModel';

export interface TaskGroupItemFile {
  content: string;
  path: string;
}

export async function readTaskGroupItemFile(
  item: TaskGroupItem,
): Promise<TaskGroupItemFile> {
  const bridge = window.electronBridge;
  if (!bridge) throw new Error('Electron bridge is unavailable');

  if (item.managedSource && item.managedFile) {
    if (!bridge.readManagedCombatPlan) {
      throw new Error('当前 GUI 不支持读取计划管理目录');
    }
    const result = await bridge.readManagedCombatPlan(
      item.managedSource,
      item.managedFile,
    );
    if (!result.success || result.content === undefined || !result.path) {
      throw new Error(result.error || `无法读取 ${item.managedFile}`);
    }
    return {
      content: result.content,
      path: result.runtimePath ?? result.path,
    };
  }

  if (!item.path) throw new Error('任务没有关联配置文件');
  if (bridge.readCombatPlanFile) {
    const result = await bridge.readCombatPlanFile(item.path);
    if (!result.success || result.content === undefined || !result.path) {
      throw new Error(result.error || `无法读取 ${item.path}`);
    }
    return {
      content: result.content,
      path: result.runtimePath ?? result.path,
    };
  }
  return {
    content: await bridge.readFile(item.path),
    path: item.path,
  };
}
