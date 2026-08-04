/** 定义 Controller 交给各页面渲染的 ViewObject、表单值和展示状态。 */

import type { PlanPresetSource, ShipLibraryShip } from './ipc.js';
import type { NormalFightTaskConfig, ShipSlot } from './model.js';

export interface ConfigViewObject {
  emulatorType: string;
  emulatorPath: string;
  emulatorSerial: string;
  gameApp: string;
  updateMode: 'auto' | 'manual';
  autoExpedition: boolean;
  expeditionInterval: number;
  autoBattle: boolean;
  battleType: string;
  autoExercise: boolean;
  exerciseFleetId: number;
  battleTimes: number;
  autoNormalFight: boolean;
  normalFightTasks: NormalFightTaskConfig[];
  autoLoot: boolean;
  lootPlanIndex: number;
  lootStopCount: number;
  logLevel: 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';
  logRoot: string;
  themeMode: 'dark' | 'light' | 'system';
  accentColor: string;
  debugMode: boolean;
  backendPort: number;
  backendStartupMode: 'managed' | 'external';
  backendRepoPath: string;
  ocrGpuMode: 'auto' | 'cpu' | 'cuda';
  ocrGpu: boolean;
  ocrMirror: 'origin' | 'github' | 'tencent' | 'modelscope';
  ocrConfidence: number;
  shipNameAliasesText: string;
  shipNameCorrectionsText: string;
  cudaPath: string;
  saveBackendScreenshots: boolean;
  pythonPath: string;
  defaultWindowWidth: number;
  defaultWindowHeight: number;
  rememberWindowBounds: boolean;
  operationDelayMin: number;
  operationDelayMax: number;
  dockFullDestroy: boolean;
  repairManually: boolean;
  bathroomCount: number;
  destroyShipWorkMode: number;
  destroyShipTypes: string[];
  removeEquipmentMode: boolean;
  planRoot: string;
}

export type AppStatus =
  | 'idle'
  | 'running'
  | 'stopping'
  | 'error'
  | 'not_connected';

export interface CurrentFleetShipVO {
  name: string;
  searchName?: string;
}

export interface MainViewObject {
  status: AppStatus;
  statusText: string;
  currentTask: TaskViewObject | null;
  currentFleet: CurrentFleetShipVO[];
  expeditionTimer: string;
  taskQueue: TaskQueueItemVO[];
  wsConnected: boolean;
  runningTaskId: string | null;
}

export interface TaskViewObject {
  name: string;
  type:
    | 'normal_fight'
    | 'event_fight'
    | 'campaign'
    | 'exercise'
    | 'expedition'
    | 'decisive';
  progress: string;
  startedAt: string;
}

export interface TaskQueueItemVO {
  id: string;
  name: string;
  priorityLabel: string;
  remaining: number;
  totalTimes: number;
  unlimited?: boolean;
  progress?: string;
  progressPercent?: number;
  acquisitionText?: string;
}

export interface LogEntryVO {
  time: string;
  level: string;
  channel: string;
  message: string;
}

export interface FleetRuleDraftViewObject {
  shipTypes: string[];
  levelEnabled: boolean;
  minLevel: number | null;
  maxLevel: number | null;
}

export interface FleetCandidateDraftViewObject
  extends FleetRuleDraftViewObject {
  ship: ShipLibraryShip | null;
}

export interface FleetSlotDraftViewObject
  extends FleetRuleDraftViewObject {
  primary: ShipLibraryShip | null;
  candidates: FleetCandidateDraftViewObject[];
}

export interface FleetDraftViewObject {
  name: string;
  file: string | null;
  source: PlanPresetSource;
  slots: FleetSlotDraftViewObject[];
}

export type MapNodeType =
  | 'Start'
  | 'Normal'
  | 'Boss'
  | 'Resource'
  | 'Penalty'
  | 'Suppress'
  | 'Aerial'
  | 'Hard';

export interface NodeViewObject {
  id: string;
  formation: string;
  night: boolean;
  proceed: boolean;
  hasCustomRules: boolean;
  note: string;
  nodeType: MapNodeType;
  detour: boolean;
  mapNight: boolean;
  position?: [number, number];
}

export interface MapEdgeVO {
  from: [number, number];
  to: [number, number];
  fromId: string;
  toId: string;
}

export interface PlanPreviewViewObject {
  fileName: string;
  chapter: number | string;
  map: number | string;
  mapName: string;
  repairModeValue: number;
  fightConditionValue: number;
  fleetId: number;
  selectedNodes: NodeViewObject[];
  comment: string;
  allNodes?: NodeViewObject[];
  edges?: MapEdgeVO[];
  mapAspectRatio?: number;
  fleetPresets?: FleetPresetVO[];
  times?: number;
  gap?: number;
  lootCountGe?: number;
  shipCountGe?: number;
}

export interface FleetPresetVO {
  name: string;
  ships: ShipSlot[];
}

export interface SetupWizardVO {
  emuType: string;
  serial: string;
  pythonPath: string;
}

export interface PresetDetailVO {
  name: string;
  typeLabel: string;
  taskType: string;
  fleetId?: number;
  exerciseFleetId?: number;
  campaignName?: string;
  chapter?: number;
  level1?: string[];
  level2?: string[];
  flagshipPriority?: string[];
  useQuickRepair?: boolean;
  planId?: string;
  times?: number;
}

export interface PresetFormValues {
  times: number;
  exerciseFleetId?: number;
  campaignName?: string;
  chapter?: number;
  level1?: string[];
  level2?: string[];
  flagshipPriority?: string[];
  useQuickRepair?: boolean;
  planId?: string;
  fightFleetId?: number;
}

export interface TaskGroupItemViewObject {
  path?: string;
  managedSource?: PlanPresetSource;
  managedFile?: string;
  templateId?: string;
  kind: 'plan' | 'preset' | 'template';
  times: number;
  label: string;
}

export interface TaskGroupItemMeta {
  mapName?: string;
  fleetId?: number;
  repairMode?: string;
  typeLabel?: string;
  fleet?: string[];
  fleetPresetName?: string;
}

export interface TaskGroupViewObject {
  groups: ReadonlyArray<{ name: string; itemCount: number }>;
  activeGroupName: string;
  items: ReadonlyArray<TaskGroupItemViewObject>;
  itemMetas?: ReadonlyArray<TaskGroupItemMeta | null>;
}

export interface TemplateLibraryItemVO {
  id: string;
  name: string;
  type: string;
  typeLabel: string;
  planCount: number;
  defaultTimes: number;
  description?: string;
  isBuiltin: boolean;
}

export interface WizardFormData {
  type: string;
  name: string;
  defaultTimes: number;
  stopLoot: number;
  stopShip: number;
  planPath?: string;
  fleetId?: number;
  fleetNf?: string[];
  exerciseFleetId?: number;
  fleetEx?: string[];
  campaignName?: string;
  fleetCp?: string[];
  chapter?: number;
  level1?: string[];
  level2?: string[];
  flagshipPriority?: string[];
  useQuickRepair?: boolean;
}

export interface WizardPrefillData {
  type?: string;
  name?: string;
  defaultTimes?: number;
  planPaths?: string[];
  planPath?: string;
  fleet_id?: number;
  fleet?: string[];
  campaign_name?: string;
  chapter?: number;
  level1?: string[];
  level2?: string[];
  flagship_priority?: string[];
  use_quick_repair?: boolean;
  defaultStopCondition?: {
    loot_count_ge?: number;
    ship_count_ge?: number;
  };
}

export interface SelectorOption {
  icon: string;
  label: string;
  sublabel?: string;
}
