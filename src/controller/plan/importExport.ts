/**
 * importExport —— 方案导入/导出/新建流程独立函数。
 */
import { PlanModel } from '../../model/PlanModel';
import { loadMapData, loadExMapData, loadEventMapData } from '../../model/MapDataLoader';
import type { MapData } from '../../model/MapDataLoader';
import type { TaskPreset } from '../../types/model';
import { Logger } from '../../utils/Logger';
import type { PlanHost } from './PlanController';

export interface PlanSetters {
  setCurrentPlan(plan: PlanModel): void;
  setCurrentMapData(mapData: MapData | null): void;
  renderPlanPreview(): void;
  importTaskPreset(preset: TaskPreset, filePath: string): void;
}

function defaultPlanFileName(currentPlan: PlanModel): string {
  return currentPlan.fileName
    ? currentPlan.fileName.split(/[\\/]/).pop() || `${currentPlan.mapName}.yaml`
    : `${currentPlan.mapName}.yaml`;
}

function buildDefaultPlanPath(currentPlan: PlanModel, host: PlanHost): string {
  const fileName = defaultPlanFileName(currentPlan);
  return host.plansDir ? `${host.plansDir}\\${fileName}` : fileName;
}

/** 导入 Plan 或 TaskPreset YAML 文件 */
export async function importPlanFlow(
  host: PlanHost,
  setters: PlanSetters,
): Promise<void> {
  const bridge = window.electronBridge;
  if (!bridge) {
    console.error('electronBridge 未注入，无法打开文件对话框');
    return;
  }

  const result = await bridge.openFileDialog([
    { name: 'YAML 方案/任务预设', extensions: ['yaml', 'yml'] },
  ], host.plansDir || undefined);
  if (!result) return;

  try {
    const parsed = (await import('js-yaml')).load(result.content) as Record<string, unknown>;

    // 含 chapter + map → 战斗方案
    if (parsed && typeof parsed === 'object' && 'chapter' in parsed && 'map' in parsed) {
      const plan = PlanModel.fromYaml(result.content, result.path);
      Logger.debug(`方案已导入: ${result.path}`);
      const { chapter, map } = plan.data;
      const mapData = plan.isEvent
        ? await loadEventMapData(plan.data.event ?? '', chapter, map)
        : chapter === 99
          ? await loadExMapData(Number(map))
          : await loadMapData(Number(chapter), Number(map));
      setters.setCurrentPlan(plan);
      setters.setCurrentMapData(mapData);
      setters.renderPlanPreview();
      host.switchPage('plan');
      return;
    }

    // 仅 task_type → 任务预设
    if (parsed && typeof parsed === 'object' && 'task_type' in parsed) {
      setters.importTaskPreset(parsed as unknown as TaskPreset, result.path);
      return;
    }

    throw new Error('文件缺少 chapter/map 或 task_type 字段');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('YAML 解析失败:', msg);
    Logger.error(`文件导入失败: ${msg}`);
  }
}

/** 导出当前方案为 YAML 文件 */
export async function exportPlanFlow(
  currentPlan: PlanModel | null,
  host: PlanHost,
  renderPlanPreview: () => void,
): Promise<void> {
  if (!currentPlan) return;
  const bridge = window.electronBridge;
  if (!bridge) return;

  const yamlStr = currentPlan.toYaml();
  const defaultPath = buildDefaultPlanPath(currentPlan, host);

  const saved = await bridge.saveFileDialog(defaultPath, yamlStr, [
    { name: 'YAML 方案', extensions: ['yaml', 'yml'] },
  ]);
  if (saved) {
    currentPlan.fileName = saved;
    Logger.info(`方案已另存为: ${saved}`);
    renderPlanPreview();
  }
}

/** 保存当前方案（有路径则覆盖保存，无路径则走另存为） */
export async function savePlanFlow(
  currentPlan: PlanModel | null,
  host: PlanHost,
  renderPlanPreview: () => void,
): Promise<void> {
  if (!currentPlan) return;
  const bridge = window.electronBridge;
  if (!bridge) return;

  const yamlStr = currentPlan.toYaml();
  const existingPath = currentPlan.fileName?.trim();

  if (existingPath) {
    await bridge.saveFile(existingPath, yamlStr);
    Logger.info(`方案已保存: ${existingPath}`);
    renderPlanPreview();
    return;
  }

  const defaultPath = buildDefaultPlanPath(currentPlan, host);
  const saved = await bridge.saveFileDialog(defaultPath, yamlStr, [
    { name: 'YAML 方案', extensions: ['yaml', 'yml'] },
  ]);
  if (saved) {
    currentPlan.fileName = saved;
    Logger.info(`方案已保存: ${saved}`);
    renderPlanPreview();
  }
}
