/** 封装 Electron IPC 文件与计划操作，提供 Renderer 侧仓储接口。 */
import type {
  DecisivePlanSettings,
  ElectronBridge,
  ShipLibraryManifest,
} from '../types/ipc.js';

export interface RendererIpc {
  readonly bridge: ElectronBridge;
}

export function getRendererIpc(): RendererIpc {
  const bridge = window.electronBridge;
  if (!bridge) throw new Error('Electron IPC bridge 不可用');
  return { bridge };
}

export type FileRepository = Pick<ElectronBridge, 'readFile' | 'saveFile' | 'appendFile'>;

export const rendererFileRepository: FileRepository = {
  readFile(path: string): Promise<string> {
    return getRendererIpc().bridge.readFile(path);
  },

  saveFile(path: string, content: string): Promise<void> {
    return getRendererIpc().bridge.saveFile(path, content);
  },

  appendFile(path: string, content: string): Promise<void> {
    return getRendererIpc().bridge.appendFile(path, content);
  },
};

export interface MapDataRepository {
  read(path: string): Promise<string>;
}

export function createMapDataRepository(
  files: FileRepository = rendererFileRepository,
): MapDataRepository {
  return {
    read(path: string): Promise<string> {
      return files.readFile(path);
    },
  };
}

export const mapDataRepository = createMapDataRepository();

export interface DecisivePlanRepository {
  loadSettings(): Promise<DecisivePlanSettings>;
  saveSettings(
    settings: DecisivePlanSettings,
  ): Promise<DecisivePlanSettings>;
  loadShipLibrary(): Promise<ShipLibraryManifest>;
}

export const decisivePlanRepository: DecisivePlanRepository = {
  loadSettings(): Promise<DecisivePlanSettings> {
    return getRendererIpc().bridge.getDecisivePlanSettings();
  },

  saveSettings(
    settings: DecisivePlanSettings,
  ): Promise<DecisivePlanSettings> {
    return getRendererIpc().bridge.setDecisivePlanSettings(settings);
  },

  loadShipLibrary(): Promise<ShipLibraryManifest> {
    return getRendererIpc().bridge.getShipLibraryManifest();
  },
};

export type FleetPlannerRepository = Pick<
  ElectronBridge,
  | 'getShipLibraryManifest'
  | 'saveUserTeamPlan'
  | 'listTeamPlans'
  | 'getPlanManagement'
  | 'exportUserPlans'
  | 'setPlanUnlinkedIgnored'
  | 'renameUserCombatPlan'
  | 'deleteUserCombatPlan'
  | 'deleteUserTeamPlan'
>;

export const fleetPlannerRepository: FleetPlannerRepository = {
  getShipLibraryManifest() {
    return getRendererIpc().bridge.getShipLibraryManifest();
  },

  saveUserTeamPlan(plan, overwrite, currentFile, source) {
    return getRendererIpc().bridge.saveUserTeamPlan(
      plan,
      overwrite,
      currentFile,
      source,
    );
  },

  listTeamPlans() {
    return getRendererIpc().bridge.listTeamPlans();
  },

  getPlanManagement() {
    return getRendererIpc().bridge.getPlanManagement();
  },

  exportUserPlans(selections) {
    return getRendererIpc().bridge.exportUserPlans(selections);
  },

  setPlanUnlinkedIgnored(kind, source, file, ignored) {
    return getRendererIpc().bridge.setPlanUnlinkedIgnored(
      kind,
      source,
      file,
      ignored,
    );
  },

  renameUserCombatPlan(file, newName) {
    return getRendererIpc().bridge.renameUserCombatPlan(file, newName);
  },

  deleteUserCombatPlan(file) {
    return getRendererIpc().bridge.deleteUserCombatPlan(file);
  },

  deleteUserTeamPlan(file) {
    return getRendererIpc().bridge.deleteUserTeamPlan(file);
  },
};
