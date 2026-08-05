/** 定义跨 Controller 流程共享的宿主能力，避免流程模块反向依赖主 Controller。 */
import type { ConfigModel } from '../model/ConfigModel.js';
import type { MapData } from '../model/MapDataLoader.js';
import type { PlanModel } from '../model/PlanModel.js';
import type {
  CronScheduler,
  Scheduler,
} from '../model/scheduler/index.js';
import type {
  ElectronBridge,
  ManagedBattlePlanSelection,
  PlanPresetSource,
} from '../types/ipc.js';
import type { TaskPreset } from '../types/model.js';

export interface TaskGroupHost {
  readonly scheduler: Scheduler;
  plansDir: string;
  renderMain(): void;
  switchPage(page: string): void;
  importTaskPreset(preset: TaskPreset, filePath: string): void;
  getCurrentPlan(): PlanModel | null;
  setCurrentPlan(plan: PlanModel, mapData: MapData | null): void;
  renderPlanPreview(): void;
  closePresetDetail(): void;
  executePreset(): void;
  getCurrentPresetInfo(): { preset: TaskPreset; filePath: string } | null;
  pickManagedBattlePlan(): Promise<ManagedBattlePlanSelection | null>;
  openManagedPlan(
    file: string,
    source: PlanPresetSource,
  ): Promise<boolean>;
}

export interface PlanHost {
  readonly scheduler: Scheduler;
  plansDir: string;
  renderMain(): void;
  switchPage(page: string): void;
}

export interface StartupHost {
  readonly scheduler: Scheduler;
  readonly cronScheduler: CronScheduler;
  readonly configModel: ConfigModel;
  appRoot: string;
  plansDir: string;
  configDir: string;

  syncPaths(appRoot: string, plansDir: string, configDir: string): void;
  initLogger(bridge: ElectronBridge): void;
  loadConfigAndSync(): Promise<void>;
  detectAndApplyEmulator(): Promise<void>;
  showSetupWizard(): Promise<void>;
  loadModelsAndRender(bridge: ElectronBridge): Promise<void>;
  reviewMigrationConflicts(): Promise<void>;
  bindBackendLog(bridge: ElectronBridge): void;
  renderMain(): void;
  startHeartbeat(): void;
}
