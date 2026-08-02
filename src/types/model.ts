/**
 * Model 层类型定义 —— 与后端 AutoWSGR 数据结构对应。
 * 这些是"高内聚"的业务实体，包含内部状态操作。
 */

// ════════════════════════════════════════
// 战斗方案 (Plan)
// ════════════════════════════════════════

/** 索敌规则条目: [条件表达式, 动作] */
export type EnemyRule = [string, string | number];

/** 后端支持的战果等级，顺序从低到高为 D/C/B/A/S/SS。 */
export type BattleResultGrade = 'D' | 'C' | 'B' | 'A' | 'S' | 'SS';

/** 单个节点的战斗参数 */
export interface NodeArgs {
  enemy_rules?: EnemyRule[];
  formation?: number;              // 1-5
  night?: boolean;
  /** 是否开启远程打击（导潜等可远程打击舰船） */
  long_missile_support?: boolean;
  proceed?: boolean;
  detour?: boolean;
  proceed_stop?: number[];         // 6 个元素
  SL_when_detour_fails?: boolean;
}

/** 一艘主选或备选舰船自己的选船规则。 */
export interface ShipRule {
  /** 固定舰名 */
  name: string;
  /** 传给后端搜索框的舰名（可选） */
  search_name?: string;
  /** 允许的舰种代号，如 ["ss", "ssg"] */
  ship_type?: string[];
  /** 等级下限（仅选择 >= 该等级） */
  min_level?: number;
  /** 等级上限（仅选择 <= 该等级） */
  max_level?: number;
}

/** 舰船筛选条件；candidates 仅表示该位置的备选舰船。 */
export interface ShipFilter {
  /** 固定主选舰名（旧模糊方案允许省略） */
  name?: string;
  /** 传给后端搜索框的主选舰名（可选） */
  search_name?: string;
  /** 国籍, 如 "德国", "日本" */
  nation?: string;
  /** 主选允许的舰种代号 */
  ship_type?: string[];
  /** 该位置的备选舰船完整规则 */
  candidates?: ShipRule[];
  /** 等级下限（仅选择 >= 该等级） */
  min_level?: number;
  /** 等级上限（仅选择 <= 该等级） */
  max_level?: number;
}

/** 编队槽位: 具体舰船名、筛选条件或空位置 */
export type ShipSlot = string | ShipFilter | null;

/** 编队预设: 一组预定义的舰船配置 */
export interface FleetPreset {
  /** 显示名称 */
  name: string;
  /** 舰船槽位列表 (按位置顺序) */
  ships: ShipSlot[];
}

/** Plan 文件解析后的完整数据 */
export interface PlanData {
  /** 常规图为数字章节；活动图为 E/H。 */
  chapter: number | string;
  /** 常规图为数字地图；活动图可带入口后缀，如 3a/3b。 */
  map: number | string;
  /** 作战模式；活动方案使用 event。 */
  mode?: string;
  /** 活动资源标识，如 20260730。后端 YAML 字段名为 event。 */
  event?: string;
  selected_nodes: string[];
  /** 终点节点列表：经过其中任一节点即认定本轮完成。未设置时回退到最后一个 selected_node。 */
  endpoint_nodes?: string[];
  /** 启用终点战果判断时的最低战果。 */
  result?: BattleResultGrade;
  fight_condition?: number;        // 1-5, 默认 1
  repair_mode?: number | number[];  // 1 或 2（或每舰位数组）, 默认 1
  fleet_id?: number;               // 编队号
  node_defaults?: NodeArgs;
  node_args?: Record<string, NodeArgs>;
  /** 预定义编队预设列表 */
  fleet_presets?: FleetPreset[];
  // 任务级字段（可内联在 plan 中，无需单独的 preset 文件）
  times?: number;
  gap?: number;
  stop_condition?: StopCondition;
  /** 定时触发时间 "HH:MM" 格式，到时自动加入队列 */
  scheduled_time?: string;
}

// ════════════════════════════════════════
// 用户配置
// ════════════════════════════════════════

export interface EmulatorConfig {
  type: string;
  path?: string;
  serial?: string;
  process_name?: string;
}

export interface AccountConfig {
  game_app: string;
}

export interface NormalFightTaskConfig {
  name: string;
  fleet_id?: number;
  /** 计划内“使用舰队”的索引，由 GUI 自动出征选择器使用。 */
  fleet_preset_index?: number;
  times?: number;
}

export interface DailyAutomationConfig {
  auto_expedition: boolean;
  auto_gain_bonus: boolean;
  auto_bath_repair: boolean;
  auto_set_support: boolean;
  bath_repair_blacklist: string[];
  auto_battle: boolean;
  battle_type: string;
  auto_exercise: boolean;
  exercise_fleet_id: number | null;
  auto_normal_fight: boolean;
  normal_fight_tasks: NormalFightTaskConfig[];
  quick_repair_limit: number | null;
  stop_max_ship: boolean;
  stop_max_loot: boolean;
}

export interface OCRConfig {
  gpu: boolean;
  mirror: 'origin' | 'github' | 'tencent' | 'modelscope';
  ship_name_match_confidence: number;
  ship_name_corrections: Record<string, string>;
  ship_name_aliases: Record<string, string>;
}

export interface LogConfig {
  level: 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';
  root: string;
  dir?: string | null;
  show_decisive_battle_info?: boolean;
  show_emulator_debug?: boolean;
  show_ui_debug?: boolean;
  show_vision_debug?: boolean;
  show_ops_debug?: boolean;
  show_combat_state_debug?: boolean;
  show_combat_recognition_debug?: boolean;
  channels?: Record<string, string>;
}

/** GUI 自身的调度参数，只保存到 gui_settings.json。 */
export interface GuiAutomationSettings {
  expeditionInterval: number;
  battleTimes: number;
  autoLoot: boolean;
  lootPlanIndex: number;
  lootStopCount: number;
}

export interface UserSettings {
  emulator: EmulatorConfig;
  account: AccountConfig;
  ocr: OCRConfig;
  log: LogConfig;
  daily_automation: DailyAutomationConfig;
  operation_delay_min: number;
  operation_delay_max: number;
  dock_full_destroy: boolean;
  repair_manually: boolean;
  bathroom_count: number;
  destroy_ship_work_mode: number;
  destroy_ship_types: string[];
  remove_equipment_mode: boolean;
  plan_root?: string;
}

// ════════════════════════════════════════
// 常量映射
// ════════════════════════════════════════

export const FORMATION_NAMES: Record<number, string> = {
  1: '单纵阵',
  2: '复纵阵',
  3: '轮型阵',
  4: '梯形阵',
  5: '单横阵',
};

export const FIGHT_CONDITION_NAMES: Record<number, string> = {
  1: '稳步前进',
  2: '火力万岁',
  3: '小心翼翼',
  4: '瞄准',
  5: '搜索阵型',
};

export const REPAIR_MODE_NAMES: Record<number, string> = {
  1: '中破就修',
  2: '大破才修',
};

// ════════════════════════════════════════
// 停止条件 (Stop Condition)
// ════════════════════════════════════════

/** 停止条件: 满足时自动终止任务循环 */
export interface StopCondition {
  /** 战利品数量达到上限时停止 */
  loot_count_ge?: number;
  /** 舰船获取数量达到上限时停止 */
  ship_count_ge?: number;
}

// ════════════════════════════════════════
// 任务预设 (Task Preset)
// ════════════════════════════════════════

/** 任务预设 YAML 解析后的结构 (task_type 字段用于区分) */
export interface TaskPreset {
  task_type: 'normal_fight' | 'event_fight' | 'campaign' | 'exercise' | 'decisive';
  // normal_fight / event_fight
  plan_id?: string;
  times?: number;
  gap?: number;
  fleet_id?: number;
  // campaign
  campaign_name?: string;
  // decisive
  chapter?: number;
  level1?: string[];
  level2?: string[];
  flagship_priority?: string[];
  /** 决战是否启用快修（桶修） */
  use_quick_repair?: boolean;
  // 停止条件
  stop_condition?: StopCondition;
  /** 定时触发时间 "HH:MM" 格式 */
  scheduled_time?: string;
}

// ════════════════════════════════════════
// 任务模板 (Task Template)
// ════════════════════════════════════════

/** 模板类型 */
export type TemplateType = 'normal_fight' | 'event_fight' | 'exercise' | 'campaign' | 'decisive';

/** 任务模板：可复用的任务蓝图 */
export interface TaskTemplate {
  id: string;
  name: string;
  type: TemplateType;
  createdAt: string;

  /** 是否为内置模板（只读，不可删除/编辑） */
  builtin?: boolean;
  /** 内置模板的描述说明 */
  description?: string;
  /** 是否强制重试失败任务（重试时插回同优先级队首，避免跳到下一条） */
  forceRetry?: boolean;
  /** 是否允许同优先级轮询（true=轮询，false/未设置=连续执行当前任务直至次数结束） */
  allowPolling?: boolean;

  // normal_fight / event_fight
  planPath?: string;               // 引用的方案文件路径（单方案，向后兼容）
  planPaths?: string[];            // 可选方案列表（多方案模板）
  fleet_id?: number;
  fleet?: string[];                // 编队舰船名称 (6 个位置)

  // exercise
  // fleet_id 已定义

  // campaign
  campaign_name?: string;

  // decisive
  chapter?: number;
  level1?: string[];
  level2?: string[];
  flagship_priority?: string[];
  /** 决战是否启用快修（桶修） */
  use_quick_repair?: boolean;

  // 默认运行时参数
  defaultTimes?: number;
  defaultGap?: number;
  defaultStopCondition?: StopCondition;
}

// ════════════════════════════════════════
// 泡澡修理配置 (Bath Repair)
// ════════════════════════════════════════

/** 单船修理阈值: 血量低于阈值时送入泡澡 */
export interface RepairThreshold {
  /** 阈值类型: percent=百分比 (如0.25=25%), absolute=绝对值 (如13点HP) */
  type: 'percent' | 'absolute';
  /** 阈值数值 */
  value: number;
}

/** 任务级泡澡修理配置 */
export interface BathRepairConfig {
  /** 是否启用泡澡修理（启用后不使用快修，等待泡澡完成） */
  enabled: boolean;
  /** 默认修理阈值（适用于所有舰船） */
  defaultThreshold: RepairThreshold;
  /** 按舰船名覆盖修理阈值 (显示名 → 阈值) */
  shipThresholds?: Record<string, RepairThreshold>;
}
