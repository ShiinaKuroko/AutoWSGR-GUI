/**
 * ConfigModel —— 用户配置(UserSettings)的 Model 层。
 * 负责从 YAML 加载、导出配置，以及局部更新。
 */
import * as yaml from 'js-yaml';
import type {
  GuiAutomationSettings,
  NormalFightTaskConfig,
  UserSettings,
} from '../types/model';
import { Logger } from '../utils/Logger';

const DEFAULT_SETTINGS: UserSettings = {
  emulator: {
    type: '雷电',
  },
  account: {
    game_app: '官服',
  },
  ocr: {
    gpu: false,
    mirror: 'modelscope',
    ship_name_match_confidence: 0.65,
    ship_name_corrections: {},
    ship_name_aliases: {},
  },
  log: {
    level: 'INFO',
    root: 'log',
  },
  daily_automation: {
    auto_expedition: false,
    auto_gain_bonus: false,
    auto_bath_repair: false,
    auto_set_support: false,
    bath_repair_blacklist: [],
    auto_battle: false,
    battle_type: '困难潜艇',
    auto_exercise: false,
    exercise_fleet_id: null,
    auto_normal_fight: false,
    normal_fight_tasks: [],
    quick_repair_limit: null,
    stop_max_ship: false,
    stop_max_loot: false,
  },
  operation_delay_min: 0,
  operation_delay_max: 0,
  dock_full_destroy: false,
  repair_manually: false,
  bathroom_count: 2,
  destroy_ship_work_mode: 0,
  destroy_ship_types: [],
  remove_equipment_mode: true,
};

const DEFAULT_GUI_AUTOMATION: GuiAutomationSettings = {
  expeditionInterval: 15,
  battleTimes: 3,
  autoLoot: false,
  lootPlanIndex: 0,
  lootStopCount: 50,
};

const LEGACY_DAILY_KEYS = [
  'expedition_interval',
  'battle_times',
  'auto_decisive',
  'decisive_ticket_reserve',
  'decisive_template_id',
  'auto_loot',
  'loot_plan_index',
  'loot_stop_count',
] as const;

export class ConfigModel {
  private settings: UserSettings;
  private guiAutomation: GuiAutomationSettings;
  private legacyGuiAutomation: Partial<GuiAutomationSettings> = {};
  /** 原始 YAML 根对象，用于保留 GUI 尚未建模的后端配置 */
  private rawRoot: Record<string, unknown> = {};

  constructor() {
    this.settings = structuredClone(DEFAULT_SETTINGS);
    this.guiAutomation = structuredClone(DEFAULT_GUI_AUTOMATION);
  }

  /** 当前配置 (只读引用) */
  get current(): UserSettings {
    return this.settings;
  }

  /** GUI 自身定时调度配置，不参与 usersettings.yaml 序列化。 */
  get currentGuiAutomation(): GuiAutomationSettings {
    return this.guiAutomation;
  }

  /** 旧版 usersettings.yaml 中可迁移的 GUI 私有字段。 */
  get migratedGuiAutomation(): Partial<GuiAutomationSettings> {
    return structuredClone(this.legacyGuiAutomation);
  }

  /** 从 YAML 字符串加载配置，缺失字段保留默认值 */
  loadFromYaml(yamlStr: string): void {
    const parsed = yaml.load(yamlStr) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      Logger.debug('配置 YAML 解析结果为空，使用默认值');
      return;
    }

    this.rawRoot = structuredClone(parsed);
    const base = structuredClone(DEFAULT_SETTINGS);

    const emulator = this.asRecord(parsed.emulator);
    if (emulator) {
      if (typeof emulator.type === 'string') base.emulator.type = emulator.type;
      if (typeof emulator.path === 'string') base.emulator.path = emulator.path;
      if (typeof emulator.serial === 'string') base.emulator.serial = emulator.serial;
      if (typeof emulator.process_name === 'string') {
        base.emulator.process_name = emulator.process_name;
      }
    }

    const account = this.asRecord(parsed.account);
    if (account && typeof account.game_app === 'string') {
      base.account.game_app = account.game_app;
    }

    const ocr = this.asRecord(parsed.ocr);
    if (ocr) {
      if (typeof ocr.gpu === 'boolean') base.ocr.gpu = ocr.gpu;
      if (['origin', 'github', 'tencent', 'modelscope'].includes(String(ocr.mirror))) {
        base.ocr.mirror = String(ocr.mirror) as UserSettings['ocr']['mirror'];
      }
      base.ocr.ship_name_match_confidence = this.clampNumber(
        ocr.ship_name_match_confidence,
        0,
        1,
        base.ocr.ship_name_match_confidence,
      );
      base.ocr.ship_name_corrections = this.stringMap(
        ocr.ship_name_corrections,
      );
      base.ocr.ship_name_aliases = this.stringMap(ocr.ship_name_aliases);
    }

    const log = this.asRecord(parsed.log);
    if (log) {
      const levels = ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'];
      if (levels.includes(String(log.level))) {
        base.log.level = String(log.level) as UserSettings['log']['level'];
      }
      if (typeof log.root === 'string') base.log.root = log.root;
      if (typeof log.dir === 'string' || log.dir === null) base.log.dir = log.dir;
      for (const key of [
        'show_decisive_battle_info',
        'show_emulator_debug',
        'show_ui_debug',
        'show_vision_debug',
        'show_ops_debug',
        'show_combat_state_debug',
        'show_combat_recognition_debug',
      ] as const) {
        if (typeof log[key] === 'boolean') base.log[key] = log[key];
      }
      if (this.asRecord(log.channels)) {
        base.log.channels = this.stringMap(log.channels);
      }
    }

    const daily = this.asRecord(parsed.daily_automation);
    if (daily) {
      for (const key of [
        'auto_expedition',
        'auto_gain_bonus',
        'auto_bath_repair',
        'auto_set_support',
        'auto_battle',
        'auto_exercise',
        'auto_normal_fight',
        'stop_max_ship',
        'stop_max_loot',
      ] as const) {
        if (typeof daily[key] === 'boolean') base.daily_automation[key] = daily[key];
      }
      if (typeof daily.battle_type === 'string') {
        base.daily_automation.battle_type = daily.battle_type;
      }
      if (daily.exercise_fleet_id === null || Number.isFinite(Number(daily.exercise_fleet_id))) {
        base.daily_automation.exercise_fleet_id = daily.exercise_fleet_id === null
          ? null
          : Math.max(1, Math.trunc(Number(daily.exercise_fleet_id)));
      }
      base.daily_automation.bath_repair_blacklist = this.stringList(
        daily.bath_repair_blacklist,
      );
      base.daily_automation.normal_fight_tasks = this.normalFightTasks(
        daily.normal_fight_tasks,
      );
      if (daily.quick_repair_limit === null || Number.isFinite(Number(daily.quick_repair_limit))) {
        base.daily_automation.quick_repair_limit = daily.quick_repair_limit === null
          ? null
          : Math.max(0, Math.trunc(Number(daily.quick_repair_limit)));
      }
      this.legacyGuiAutomation = this.readLegacyGuiAutomation(daily);
    } else {
      this.legacyGuiAutomation = {};
    }

    base.operation_delay_min = this.clampNumber(
      parsed.operation_delay_min,
      0,
      10,
      0,
    );
    base.operation_delay_max = this.clampNumber(
      parsed.operation_delay_max,
      0,
      10,
      0,
    );
    if (typeof parsed.dock_full_destroy === 'boolean') {
      base.dock_full_destroy = parsed.dock_full_destroy;
    }
    if (typeof parsed.repair_manually === 'boolean') {
      base.repair_manually = parsed.repair_manually;
    }
    base.bathroom_count = Math.max(
      1,
      Math.min(12, Math.trunc(Number(parsed.bathroom_count) || 2)),
    );
    base.destroy_ship_work_mode = this.destroyMode(parsed.destroy_ship_work_mode);
    base.destroy_ship_types = this.stringList(parsed.destroy_ship_types);
    if (typeof parsed.remove_equipment_mode === 'boolean') {
      base.remove_equipment_mode = parsed.remove_equipment_mode;
    }
    if (typeof parsed.plan_root === 'string' && parsed.plan_root.trim()) {
      base.plan_root = parsed.plan_root;
    }

    this.settings = base;
  }

  /** 导出当前配置为 YAML 字符串 */
  toYaml(): string {
    const output = structuredClone(this.rawRoot);
    output.emulator = structuredClone(this.settings.emulator);
    output.account = { game_app: this.settings.account.game_app };
    output.ocr = this.mergeSection(this.rawRoot.ocr, this.settings.ocr);
    output.log = this.mergeSection(this.rawRoot.log, this.settings.log);

    const daily = this.mergeSection(
      this.rawRoot.daily_automation,
      this.settings.daily_automation,
    );
    for (const key of LEGACY_DAILY_KEYS) delete daily[key];
    if (daily.exercise_fleet_id === null) delete daily.exercise_fleet_id;
    if (daily.quick_repair_limit === null) delete daily.quick_repair_limit;
    output.daily_automation = daily;

    output.operation_delay_min = this.settings.operation_delay_min;
    output.operation_delay_max = this.settings.operation_delay_max;
    output.dock_full_destroy = this.settings.dock_full_destroy;
    output.repair_manually = this.settings.repair_manually;
    output.bathroom_count = this.settings.bathroom_count;
    output.destroy_ship_work_mode = this.settings.destroy_ship_work_mode;
    output.destroy_ship_types = [...this.settings.destroy_ship_types];
    output.remove_equipment_mode = this.settings.remove_equipment_mode;
    if (this.settings.plan_root) output.plan_root = this.settings.plan_root;
    else delete output.plan_root;

    return yaml.dump(output, { lineWidth: -1, noRefs: true });
  }

  /** 局部更新配置 (深合并) */
  update(partial: Partial<UserSettings>): void {
    if (partial.emulator) {
      Object.assign(this.settings.emulator, partial.emulator);
    }
    if (partial.account) {
      Object.assign(this.settings.account, partial.account);
    }
    if (partial.ocr) {
      Object.assign(this.settings.ocr, partial.ocr);
    }
    if (partial.log) {
      Object.assign(this.settings.log, partial.log);
    }
    if (partial.daily_automation) {
      Object.assign(this.settings.daily_automation, partial.daily_automation);
    }
    for (const key of [
      'operation_delay_min',
      'operation_delay_max',
      'dock_full_destroy',
      'repair_manually',
      'bathroom_count',
      'destroy_ship_work_mode',
      'destroy_ship_types',
      'remove_equipment_mode',
      'plan_root',
    ] as const) {
      if (key in partial) {
        (this.settings as unknown as Record<string, unknown>)[key] =
          structuredClone(partial[key]);
      }
    }
  }

  updateGuiAutomation(partial: Partial<GuiAutomationSettings>): void {
    Object.assign(this.guiAutomation, partial);
    this.guiAutomation.expeditionInterval = Math.max(
      1,
      Math.min(120, Math.trunc(this.guiAutomation.expeditionInterval || 15)),
    );
    this.guiAutomation.battleTimes = Math.max(
      1,
      Math.trunc(this.guiAutomation.battleTimes || 3),
    );
    this.guiAutomation.lootPlanIndex = Math.max(
      0,
      Math.trunc(this.guiAutomation.lootPlanIndex || 0),
    );
    this.guiAutomation.lootStopCount = Math.max(
      1,
      Math.min(50, Math.trunc(this.guiAutomation.lootStopCount || 50)),
    );
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  }

  private mergeSection(
    raw: unknown,
    values: object,
  ): Record<string, unknown> {
    const output = this.asRecord(raw)
      ? structuredClone(raw as Record<string, unknown>)
      : {};
    Object.assign(output, structuredClone(values));
    for (const [key, value] of Object.entries(output)) {
      if (value === undefined) delete output[key];
    }
    return output;
  }

  private clampNumber(
    value: unknown,
    min: number,
    max: number,
    fallback: number,
  ): number {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(min, Math.min(max, number));
  }

  private stringList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
      .filter(item => typeof item === 'string')
      .map(item => item.trim())
      .filter(Boolean);
  }

  private stringMap(value: unknown): Record<string, string> {
    const record = this.asRecord(value);
    if (!record) return {};
    const output: Record<string, string> = {};
    for (const [key, item] of Object.entries(record)) {
      if (typeof item === 'string' && key.trim() && item.trim()) {
        output[key.trim()] = item.trim();
      }
    }
    return output;
  }

  private normalFightTasks(value: unknown): NormalFightTaskConfig[] {
    if (!Array.isArray(value)) return [];
    const output: NormalFightTaskConfig[] = [];
    for (const item of value) {
      if (typeof item === 'string' && item.trim()) {
        output.push({ name: item.trim() });
        continue;
      }
      if (Array.isArray(item) && item.length > 0) {
        const name = String(item[0] ?? '').trim();
        if (!name) continue;
        const task: NormalFightTaskConfig = { name };
        if (item[1] != null && Number.isFinite(Number(item[1]))) {
          task.fleet_id = Math.max(1, Math.trunc(Number(item[1])));
        }
        if (item[2] != null && Number.isFinite(Number(item[2]))) {
          task.times = Math.max(1, Math.trunc(Number(item[2])));
        }
        output.push(task);
        continue;
      }
      const record = this.asRecord(item);
      if (!record || typeof record.name !== 'string' || !record.name.trim()) continue;
      const task: NormalFightTaskConfig = { name: record.name.trim() };
      if (record.fleet_id != null && Number.isFinite(Number(record.fleet_id))) {
        task.fleet_id = Math.max(1, Math.trunc(Number(record.fleet_id)));
      }
      if (
        record.fleet_preset_index != null
        && Number.isFinite(Number(record.fleet_preset_index))
      ) {
        task.fleet_preset_index = Math.max(
          0,
          Math.trunc(Number(record.fleet_preset_index)),
        );
      }
      if (record.times != null && Number.isFinite(Number(record.times))) {
        task.times = Math.max(1, Math.trunc(Number(record.times)));
      }
      output.push(task);
    }
    return output;
  }

  private readLegacyGuiAutomation(
    daily: Record<string, unknown>,
  ): Partial<GuiAutomationSettings> {
    const output: Partial<GuiAutomationSettings> = {};
    if (Number.isFinite(Number(daily.expedition_interval))) {
      output.expeditionInterval = Number(daily.expedition_interval);
    }
    if (Number.isFinite(Number(daily.battle_times))) {
      output.battleTimes = Number(daily.battle_times);
    }
    if (typeof daily.auto_loot === 'boolean') output.autoLoot = daily.auto_loot;
    if (Number.isFinite(Number(daily.loot_plan_index))) {
      output.lootPlanIndex = Number(daily.loot_plan_index);
    }
    if (Number.isFinite(Number(daily.loot_stop_count))) {
      output.lootStopCount = Number(daily.loot_stop_count);
    }
    return output;
  }

  private destroyMode(value: unknown): number {
    const aliases: Record<string, number> = {
      '不启用': 0,
      disable: 0,
      '黑名单': 1,
      include: 1,
      '白名单': 2,
      exclude: 2,
    };
    if (typeof value === 'string' && value.trim() in aliases) {
      return aliases[value.trim()];
    }
    const number = Math.trunc(Number(value));
    return [0, 1, 2].includes(number) ? number : 0;
  }
}
