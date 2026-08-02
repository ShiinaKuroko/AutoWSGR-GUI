/** 通过 preload 注入的 IPC 桥 */
import type { BattleResultGrade } from './model';

export interface ShipLibraryStatus {
  exists: boolean;
  path: string;
  generatedAt?: string;
  shipCount: number;
  assetCount: number;
  missingAssets: number;
  error?: string;
}

export interface ShipLibraryUpdateResult {
  success: boolean;
  output?: string;
  generated_at?: string;
  ship_count?: number;
  asset_count?: number;
  added?: number;
  updated?: number;
  removed?: number;
  downloaded?: number;
  failed?: number;
  failures?: string[];
  error?: string;
}

export interface WindowPreferences {
  defaultWidth: number;
  defaultHeight: number;
  rememberBounds: boolean;
}

export interface GuiAutomationSettings {
  expeditionInterval: number;
  battleTimes: number;
  autoLoot: boolean;
  lootPlanIndex: number;
  lootStopCount: number;
}

export interface CudaValidationResult {
  valid: boolean;
  path: string;
  version: string | null;
  kind?: 'toolkit' | 'runtime';
  torchVersion?: string | null;
  device?: string | null;
  error?: string;
}

/** GUI 自己维护的决战队伍，执行时转换为后端 decisive 请求。 */
export interface DecisivePlanSettings {
  chapter: number;
  useQuickRepair: boolean;
  level1: string[];
  level2: string[];
}

export interface ShipLibraryLabels {
  locale?: string;
  ship_types: Record<string, string>;
  size_classes: Record<string, string>;
  role_classes: Record<string, string>;
  countries: Record<string, string>;
  variants: Record<string, string>;
}

export interface ShipLibraryShip {
  id: number;
  name: string;
  search_name: string;
  variant: 'normal' | 'refit' | 'special';
  rarity: number;
  ship_type: string;
  size_class: string;
  role_class: string;
  country: string;
  portraitUrl: string;
  backgroundUrl: string;
  frameUrl: string;
  typeIconUrl: string;
  wiki_url?: string;
}

export interface ShipLibraryManifest {
  schemaVersion: number;
  generatedAt: string;
  labels: ShipLibraryLabels;
  typeGroups: {
    size_classes: Record<string, string[]>;
    role_classes: Record<string, string[]>;
  };
  ships: ShipLibraryShip[];
}

export type PlanPresetSource = 'system' | 'user';

/** 一艘主选或备选舰船自己的选船规则。 */
export interface UserTeamShipRule {
  name: string;
  search_name?: string;
  ship_type?: string[];
  min_level?: number;
  max_level?: number;
}

/** 一个位置的可选主选规则和位置级备选规则。 */
export interface UserTeamPlanSlot {
  name?: string;
  search_name?: string;
  ship_type?: string[];
  min_level?: number;
  max_level?: number;
  candidates?: UserTeamShipRule[];
}

/** GUI 在系统或用户编队目录中维护的单个编队预设。 */
export interface UserTeamPlan {
  file?: string;
  modifiedAt?: number;
  source?: PlanPresetSource;
  name: string;
  ships: UserTeamPlanSlot[];
}

export interface UserTeamPlanResult {
  success: boolean;
  canceled?: boolean;
  exists?: boolean;
  file?: string;
  plan?: UserTeamPlan;
  error?: string;
}

export interface UserTeamPlanListResult {
  plans: UserTeamPlan[];
  errors: PlanFileReadError[];
}

export interface PlanTeamBinding {
  planFile: string;
  planName: string;
  source: PlanPresetSource;
  teamName: string | null;
}

export interface ManagedTeamPlan {
  file: string;
  name: string;
  source: PlanPresetSource;
}

export interface ManagedBattlePlanFleet {
  name: string;
  source: PlanPresetSource | 'deleted';
  primaryCount: number;
  backupCount: number;
}

export interface ManagedBattlePlan {
  file: string;
  name: string;
  source: PlanPresetSource;
  modifiedAt: number;
  chapter: number | string;
  map: number | string;
  times: number;
  gap: number;
  fleetId: number;
  repairMode: number | number[];
  result: BattleResultGrade | null;
  lootCountGe: number;
  shipCountGe: number;
  fleetCount: number;
  nodeCount: number;
  fleets: ManagedBattlePlanFleet[];
}

/** 从作战计划加载浮窗中选择的计划及其唯一使用编队。 */
export interface ManagedBattlePlanSelection {
  plan: ManagedBattlePlan;
  fleetPresetIndex: number;
}

export interface PlanFileReadError {
  file: string;
  source: PlanPresetSource;
  kind: 'battle' | 'team';
  message: string;
}

export interface PlanManagementResult {
  bindings: PlanTeamBinding[];
  battlePlans: ManagedBattlePlan[];
  teamPlans: ManagedTeamPlan[];
  errors: PlanFileReadError[];
  ignoredUnlinkedPlans: string[];
}

export interface PlanFileOperationResult {
  success: boolean;
  exists?: boolean;
  file?: string;
  path?: string;
  sourcePath?: string;
  runtimePath?: string;
  content?: string;
  source?: PlanPresetSource;
  teamFiles?: string[];
  conflicts?: string[];
  error?: string;
}

export interface LegacyPlanConversionResult
  extends PlanFileOperationResult {
  canceled?: boolean;
  inputPath?: string;
}

export interface AdbOperationResult {
  success: boolean;
  serial: string;
  status: string;
  message: string;
}

export interface ElectronBridge {
  openDirectoryDialog: (title?: string) => Promise<string | null>;
  openFileDialog: (filters: { name: string; extensions: string[] }[], defaultDir?: string) => Promise<{ path: string; content: string } | null>;
  saveFile: (path: string, content: string) => Promise<void>;
  saveFileDialog: (defaultName: string, content: string, filters: { name: string; extensions: string[] }[]) => Promise<string | null>;
  readFile: (path: string) => Promise<string>;
  appendFile: (path: string, content: string) => Promise<void>;
  detectEmulator: () => Promise<{ type: string; path: string; serial: string; adbPath: string } | null>;
  checkAdbDevices: () => Promise<{ serial: string; status: string }[]>;
  connectAdbDevice: (serial: string) => Promise<AdbOperationResult>;
  disconnectAdbDevice: (serial: string) => Promise<AdbOperationResult>;
  getAppRoot: () => Promise<string>;
  resolveAppPath: (filePath: string) => Promise<string>;
  getPlansDir: () => Promise<string>;
  getConfigDir: () => Promise<string>;
  listPlanFiles: () => Promise<{ name: string; file: string }[]>;
  openFolder: (folderPath: string) => Promise<void>;
  checkEnvironment: () => Promise<{
    pythonCmd: string | null;
    pythonVersion: string | null;
    missingPackages: string[];
    allReady: boolean;
  }>;
  /*
   * 测试期接口（后端源码更新）已停用，类型保留便于回滚恢复。
  checkUpdates: () => Promise<{
    gitAvailable: boolean;
    hasUpdates: boolean;
    currentBranch: string;
    behindCount: number;
    remoteUrl: string;
  }>;
  */
  installDeps: () => Promise<{ success: boolean; output: string }>;
  /*
   * 测试期接口（后端源码更新）已停用，类型保留便于回滚恢复。
  pullUpdates: () => Promise<{ success: boolean; output: string }>;
  */
  startBackend: () => Promise<{ success: boolean; message: string }>;
  runSetup: () => Promise<{ success: boolean; output: string }>;
  installPortablePython: () => Promise<{ success: boolean }>;
  checkGuiUpdates: () => Promise<{ version: string } | null>;
  downloadGuiUpdate: () => Promise<{ success: boolean; message?: string }>;
  installGuiUpdate: () => void;
  onUpdateStatus: (callback: (status: any) => void) => void;
  onBackendLog: (callback: (line: string) => void) => void;
  onSetupLog: (callback: (text: string) => void) => void;
  getAppVersion: () => string;
  getBackendPort: () => number;
  setBackendPort: (port: number) => Promise<void>;
  getGuiAutomationSettings: () => Promise<{
    exists: boolean;
    settings: Partial<GuiAutomationSettings>;
  }>;
  setGuiAutomationSettings: (
    settings: GuiAutomationSettings,
  ) => Promise<GuiAutomationSettings>;
  getDecisivePlanSettings: () => Promise<DecisivePlanSettings>;
  setDecisivePlanSettings: (
    settings: DecisivePlanSettings,
  ) => Promise<DecisivePlanSettings>;
  getBackendStartupMode: () => 'managed' | 'external';
  setBackendStartupMode: (mode: 'managed' | 'external') => Promise<void>;
  getBackendRepoPath: () => string;
  setBackendRepoPath: (repoPath: string | null) => Promise<void>;
  getOcrGpuMode: () => 'auto' | 'cpu' | 'cuda';
  setOcrGpuMode: (mode: 'auto' | 'cpu' | 'cuda') => Promise<void>;
  getCudaPath: () => string;
  setCudaPath: (cudaPath: string | null) => Promise<void>;
  validateCudaPath: (cudaPath: string) => Promise<CudaValidationResult>;
  getSaveBackendScreenshots: () => boolean;
  setSaveBackendScreenshots: (enabled: boolean) => Promise<void>;
  getWindowPreferences: () => WindowPreferences;
  setWindowPreferences: (preferences: WindowPreferences) => Promise<WindowPreferences>;
  getUpdateMode: () => 'auto' | 'manual';
  setUpdateMode: (mode: 'auto' | 'manual') => Promise<void>;
  getShipLibraryStatus: () => Promise<ShipLibraryStatus>;
  getShipLibraryManifest: () => Promise<ShipLibraryManifest>;
  updateShipLibrary: () => Promise<ShipLibraryUpdateResult>;
  onShipLibraryUpdateProgress: (callback: (progress: { message: string }) => void) => void;
  saveUserTeamPlan: (
    plan: UserTeamPlan,
    overwrite?: boolean,
    currentFile?: string,
    source?: PlanPresetSource,
  ) => Promise<UserTeamPlanResult>;
  pickUserTeamPlan: () => Promise<UserTeamPlanResult>;
  listTeamPlans: () => Promise<UserTeamPlanListResult>;
  getPlanManagement: () => Promise<PlanManagementResult>;
  setPlanUnlinkedIgnored: (
    kind: 'battle' | 'team',
    source: PlanPresetSource,
    file: string,
    ignored: boolean,
  ) => Promise<string[]>;
  readManagedCombatPlan: (
    source: PlanPresetSource,
    file: string,
  ) => Promise<PlanFileOperationResult>;
  readCombatPlanFile: (
    filePath: string,
  ) => Promise<PlanFileOperationResult>;
  prepareCombatPlanExecution: (
    content: string,
    hint: string,
  ) => Promise<PlanFileOperationResult>;
  convertLegacyCombatPlan: (
    overwrite?: boolean,
    inputPath?: string,
  ) => Promise<LegacyPlanConversionResult>;
  saveManagedCombatPlan: (
    name: string,
    content: string,
    overwrite?: boolean,
    currentFile?: string,
    source?: PlanPresetSource,
  ) => Promise<PlanFileOperationResult>;
  renameUserCombatPlan: (
    file: string,
    newName: string,
  ) => Promise<PlanFileOperationResult>;
  deleteUserCombatPlan: (file: string) => Promise<PlanFileOperationResult>;
  deleteUserTeamPlan: (file: string) => Promise<PlanFileOperationResult>;
  getPythonPath: () => string | null;
  setPythonPath: (pythonPath: string | null) => Promise<void>;
  validatePython: (pythonPath: string) => Promise<{ valid: boolean; version: string | null; error?: string }>;
}

declare global {
  interface Window {
    electronBridge?: ElectronBridge;
  }
}
