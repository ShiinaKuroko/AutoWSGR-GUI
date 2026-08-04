/** 协调作战方案加载、预览、编辑、保存和任务执行。 */
/**
 * 编排受管方案、任务预设、节点编辑和计划预览。
 */
import { PlanPreviewView } from '../../view/plan/PlanPreviewView';
import { PlanModel } from '../../model/PlanModel';
import type { CombatPlanReq, EventFightReq, NodeDecisionReq, NormalFightReq } from '../../types/api.js';
import type { Scheduler } from '../../model/scheduler';
import { TaskPriority } from '../../model/scheduler';
import type { FleetPreset, NodeArgs, TaskPreset } from '../../types/model.js';
import {
  getNodeType,
  isNightNode,
  isDetourNode,
  isTerminalNode,
  loadMapData,
  loadExMapData,
  loadEventMapData,
} from '../../model/MapDataLoader';
import type { MapData } from '../../model/MapDataLoader';
import type {
  ManagedBattlePlanSelection,
  PlanPresetSource,
} from '../../types/ipc.js';
import { BattlePlanLoaderView } from '../../view/plan/BattlePlanLoaderView';
import {
  resolveFleetPreset,
  shipSlotLabel,
} from '../../model/fleet/ShipMatcher';
import { resolveFleetPresetRules } from '../../model/fleet/FleetRuleMapper';
import { toBackendName } from '../../model/fleet/ShipNameNormalizer';
import { Logger } from '../../utils/Logger';
import {
  showAlert,
  showConfirm,
  showSaveSuccess,
} from '../shared/DialogHelper';
import { importTaskPresetFlow, closePresetDetailFlow, executePresetFlow, type PresetState } from './presetFlow';
import { yamlCodec, jsonCodec } from '../../adapter';
import { saveNodeEditorValues } from './nodeEditor';
import { buildPlanPreviewVO } from './rendering';
import { normalizeSelectedNodesForBackend } from './selectedNodes';
import { BattlePlanLoaderController } from './BattlePlanLoaderController';

export interface PlanHost {
  readonly scheduler: Scheduler;
  plansDir: string;
  renderMain(): void;
  switchPage(page: string): void;
}

export class PlanController {
  private currentPlan: PlanModel | null = null;
  private currentMapData: MapData | null = null;
  private editingNodeId: string | null = null;
  private currentPreset: TaskPreset | null = null;
  private currentPresetFilePath = '';
  private mapLoadVersion = 0;
  private planPresetName = '';
  private currentManagedPlanFile: string | null = null;
  private currentPlanSource: PlanPresetSource = 'user';
  private savedPlanSnapshot = '';
  private readonly battlePlanLoader: BattlePlanLoaderController;

  constructor(
    private readonly planView: PlanPreviewView,
    readonly host: PlanHost,
  ) {
    this.battlePlanLoader = new BattlePlanLoaderController(
      new BattlePlanLoaderView(),
      {
        getCurrentPlanIdentity: () => ({
          file: this.currentManagedPlanFile,
          source: this.currentPlanSource,
        }),
        openManagedPlan: (file, source) => (
          this.openManagedPlan(file, source)
        ),
      },
    );
  }

  // ── 公共访问器 ──

  getCurrentPlan(): PlanModel | null { return this.currentPlan; }

  pickManagedBattlePlan(): Promise<ManagedBattlePlanSelection | null> {
    return this.battlePlanLoader.pick('task-list');
  }

  pickManagedBattlePlanForQueue(): Promise<ManagedBattlePlanSelection | null> {
    return this.battlePlanLoader.pick('queue');
  }

  pickManagedBattlePlanForAutomation(): Promise<ManagedBattlePlanSelection | null> {
    return this.battlePlanLoader.pick('automation');
  }

  setCurrentPlan(plan: PlanModel, mapData: MapData | null): void {
    this.editingNodeId = null;
    this.planView.resetNodeEditorDrafts();
    this.planView.hideNodeEditor();
    this.mapLoadVersion++;
    this.currentPlan = plan;
    this.currentMapData = mapData;
    this.planPresetName = this.planNameFromPath(plan.fileName);
    this.currentManagedPlanFile = null;
    this.currentPlanSource = 'user';
    this.savedPlanSnapshot = this.planDraftSnapshot();
  }

  getCurrentPresetInfo(): { preset: TaskPreset; filePath: string } | null {
    return this.currentPreset && this.currentPresetFilePath
      ? { preset: this.currentPreset, filePath: this.currentPresetFilePath }
      : null;
  }

  // ── PresetState 适配（供 presetFlow 函数读写） ──

  private get presetState(): PresetState {
    // 返回可变引用，presetFlow 函数直接读写 controller 字段
    const self = this;
    return {
      get currentPreset() { return self.currentPreset; },
      set currentPreset(v) { self.currentPreset = v; },
      get currentPresetFilePath() { return self.currentPresetFilePath; },
      set currentPresetFilePath(v) { self.currentPresetFilePath = v; },
    };
  }

  // ════════════════════════════════════════
  // 事件绑定
  // ════════════════════════════════════════

  bindActions(): void {
    document.getElementById('btn-new-battle-plan')?.addEventListener(
      'click',
      () => void this.newPlan(),
    );
    document.getElementById('btn-load-battle-plan')?.addEventListener(
      'click',
      () => void this.loadPlan(),
    );
    document.getElementById('btn-save-plan')?.addEventListener(
      'click',
      () => void this.savePlan(),
    );
    this.battlePlanLoader.bindActions();

    // 节点编辑
    this.planView.onNodeClick = (nodeId) => {
      if (!this.currentPlan) return;
      const mapData = this.currentMapData;
      const nodeType = mapData ? getNodeType(mapData, nodeId) : 'Normal';
      this.editingNodeId = nodeId;
      const args = this.currentPlan.getNodeArgs(nodeId);
      const rulesText = (args.enemy_rules ?? []).map(r => `${r[0]}, ${r[1]}`).join('\n');
      const mapNight = this.currentMapData ? isNightNode(this.currentMapData, nodeId) : false;
      const isEnabled = this.currentPlan.data.selected_nodes.includes(nodeId);
      const canDetour = this.currentMapData ? isDetourNode(this.currentMapData, nodeId) : false;
      const isEndpoint = (this.currentPlan.data.endpoint_nodes ?? []).includes(nodeId);
      const isTerminal = this.currentMapData ? isTerminalNode(this.currentMapData, nodeId) : false;
      this.planView.showNodeEditor(nodeId, nodeType, {
        enabled: isEnabled,
        formation: args.formation ?? 2,
        night: args.night ?? false,
        longMissileSupport: args.long_missile_support ?? false,
        proceed: args.proceed ?? true,
        detour: args.detour ?? false,
        canDetour,
        slWhenDetourFails: args.SL_when_detour_fails ?? false,
        isEndpoint,
        result: this.currentPlan.data.result,
        isTerminal,
        enemyRules: rulesText,
      }, mapNight);
    };

    document.getElementById('btn-node-editor-close')?.addEventListener('click', () => {
      this.editingNodeId = null;
      this.planView.hideNodeEditor();
    });

    document.getElementById('btn-node-edit-save')?.addEventListener('click', () => {
      if (saveNodeEditorValues(this.planView, this.currentPlan, this.editingNodeId)) {
        this.editingNodeId = null;
        this.renderPlanPreview();
      }
    });

    this.planView.onMapChange = (chapter, map) => {
      void this.changeMap(chapter, map);
    };
    this.planView.onPresetNameChange = (name) => {
      this.planPresetName = name;
    };

    this.planView.onPlanFieldChange = (field, value) => {
      if (!this.currentPlan) return;
      if (field === 'repair_mode') this.currentPlan.data.repair_mode = value as number;
      else if (field === 'fight_condition') this.currentPlan.data.fight_condition = value as number;
      else if (field === 'fleet_id') this.currentPlan.data.fleet_id = value as number;
      else if (field === 'times') this.currentPlan.data.times = value as number;
      else if (field === 'gap') this.currentPlan.data.gap = value as number;
      else if (field === 'loot_count_ge' || field === 'ship_count_ge') {
        if (!this.currentPlan.data.stop_condition) this.currentPlan.data.stop_condition = {};
        this.currentPlan.data.stop_condition[field] = value as number | undefined;
        const sc = this.currentPlan.data.stop_condition;
        if (sc.loot_count_ge == null && sc.ship_count_ge == null) this.currentPlan.data.stop_condition = undefined;
      }
    };

    this.planView.onUserTeamChange = (teams) => {
      if (!this.currentPlan) return;
      this.applyFleetPresets(teams);
    };
  }

  private applyFleetPresets(presets: FleetPreset[]): void {
    if (!this.currentPlan) return;
    this.currentPlan.data.fleet_presets = presets.map(team => ({
      name: team.name,
      ships: team.ships.map(slot => (
        slot === null || typeof slot === 'string'
          ? slot
          : {
              name: slot.name,
              candidates: slot.candidates
                ? slot.candidates.map(candidate => ({
                    ...candidate,
                    ship_type: candidate.ship_type
                      ? [...candidate.ship_type]
                      : undefined,
                  }))
                : undefined,
              search_name: slot.search_name,
              ship_type: slot.ship_type
                ? [...slot.ship_type]
                : undefined,
              min_level: slot.min_level,
              max_level: slot.max_level,
            }
      )),
    }));
  }

  // ── 委托方法 ──

  async openManagedPlan(
    file: string,
    source: PlanPresetSource,
    skipDiscardConfirm = false,
  ): Promise<boolean> {
    if (
      !skipDiscardConfirm
      && !(await this.confirmDiscardUnsaved())
    ) {
      return false;
    }
    const bridge = window.electronBridge;
    if (!bridge?.readManagedCombatPlan) {
      await showAlert('加载失败', '请完整重启 GUI 后再操作');
      return false;
    }
    try {
      const result = await bridge.readManagedCombatPlan(source, file);
      if (!result.success || !result.path || result.content === undefined) {
        await showAlert('加载失败', result.error || '无法读取出征计划');
        return false;
      }
      const parsed = yamlCodec.parse<unknown>(result.content);
      if (
        parsed
        && typeof parsed === 'object'
        && 'task_type' in parsed
        && !('map' in parsed)
      ) {
        this.importTaskPreset(parsed as TaskPreset, result.path);
        return true;
      }
      const plan = PlanModel.fromYaml(result.content, result.path);
      const { chapter, map } = plan.data;
      const mapData = plan.isEvent
        ? await loadEventMapData(plan.data.event ?? '', chapter, map)
        : chapter === 99
          ? await loadExMapData(Number(map))
          : await loadMapData(Number(chapter), Number(map));
      this.setCurrentPlan(plan, mapData);
      this.currentManagedPlanFile = file;
      this.currentPlanSource = source;
      this.savedPlanSnapshot = this.planDraftSnapshot();
      this.renderPlanPreview();
      this.host.switchPage('plan');
      return true;
    } catch (error) {
      await showAlert(
        '加载失败',
        error instanceof Error ? error.message : String(error),
      );
      return false;
    }
  }

  private async newPlan(): Promise<void> {
    if (this.hasUnsavedPlanChanges()) {
      const confirmed = await showConfirm(
        '新建出征预设',
        '当前出征规划存在未保存修改，继续新建将丢失这些修改，是否继续？',
      );
      if (!confirmed) return;
    }
    this.planView.resetNodeEditorDrafts();
    this.currentPlan = null;
    this.currentMapData = null;
    this.planPresetName = '';
    this.currentManagedPlanFile = null;
    this.currentPlanSource = 'user';
    this.planView.hideNodeEditor();
    await this.changeMap('1', 1);
    this.savedPlanSnapshot = this.planDraftSnapshot();
    this.planView.focusPresetName();
  }

  private async loadPlan(): Promise<void> {
    await this.battlePlanLoader.openForEditor();
  }

  private async confirmDiscardUnsaved(
    action: '加载' = '加载',
  ): Promise<boolean> {
    if (!this.hasUnsavedPlanChanges()) return true;
    return showConfirm(
      '未保存修改',
      `当前出征规划存在未保存修改，继续${action}将丢失这些修改，是否继续？`,
    );
  }

  private planDraftSnapshot(): string {
    if (!this.currentPlan) return '';
    return jsonCodec.stringify({
      name: this.planPresetName,
      yaml: this.currentPlan.toYaml(),
    });
  }

  private hasUnsavedPlanChanges(): boolean {
    return this.planDraftSnapshot() !== this.savedPlanSnapshot;
  }

  private planNameFromPath(filePath: string): string {
    const file = filePath.split(/[\\/]/).pop() ?? '';
    return file
      .replace(/\.ya?ml$/i, '')
      .replace(/^bettle-/i, '');
  }

  private normalizePlanName(value: string): string {
    return value
      .trim()
      .replace(/\.ya?ml$/i, '')
      .replace(/^bettle-/i, '')
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
      .replace(/[. ]+$/g, '')
      .slice(0, 100);
  }

  private async savePlan(): Promise<void> {
    if (!this.currentPlan) return;
    const bridge = window.electronBridge;
    if (!bridge?.saveManagedCombatPlan) {
      await showAlert('保存失败', '当前环境不支持保存出征规划');
      return;
    }
    const name = this.normalizePlanName(this.planView.getPresetName());
    if (!name) {
      await showAlert('保存失败', '请先填写预设名称');
      return;
    }

    try {
      this.applyFleetPresets(this.planView.getSelectedPresets());
      const content = this.currentPlan.toYaml();
      const copiedFromSystem = this.currentPlanSource === 'system';
      const currentFile = copiedFromSystem
        ? undefined
        : this.currentManagedPlanFile ?? undefined;
      const source: PlanPresetSource = 'user';
      let result = await bridge.saveManagedCombatPlan(
        name,
        content,
        false,
        currentFile,
        source,
      );
      if (result.exists) {
        const conflictDetails = result.conflicts?.length
          ? `\n\n${result.conflicts.join('\n')}`
          : '';
        const overwrite = await showConfirm(
          '覆盖配置',
          `存在同名配置，是否覆盖？${conflictDetails}`,
        );
        if (!overwrite) return;
        result = await bridge.saveManagedCombatPlan(
          name,
          content,
          true,
          currentFile,
          source,
        );
      }
      if (!result.success) {
        throw new Error(result.error || '保存失败');
      }

      this.currentPlan.fileName = result.path ?? this.currentPlan.fileName;
      this.currentManagedPlanFile = result.file ?? `bettle-${name}.yaml`;
      this.currentPlanSource = result.source ?? source;
      this.planPresetName = name;
      this.savedPlanSnapshot = this.planDraftSnapshot();
      this.renderPlanPreview();
      Logger.info(`出征规划已保存: ${this.currentManagedPlanFile}`);
      showSaveSuccess(
        copiedFromSystem
          ? `出征规划「${name}」已保存为用户配置`
          : `出征规划「${name}」保存成功`,
      );
    } catch (error) {
      await showAlert(
        '保存失败',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  importTaskPreset(preset: TaskPreset, filePath: string): void {
    this.mapLoadVersion++;
    importTaskPresetFlow(preset, filePath, this.planView, this.host, this.presetState);
  }

  closePresetDetail(): void {
    closePresetDetailFlow(this.planView, this.presetState);
  }

  executePreset(): void {
    executePresetFlow(this.planView, this.host, this.presetState);
  }

  renderPlanPreview(): void {
    if (!this.currentPlan) { this.planView.render(null); return; }
    const vo = buildPlanPreviewVO(this.currentPlan, this.currentMapData);
    this.planView.render(vo);
    this.planView.setPresetName(this.planPresetName);
    this.planView.showPlanView();
  }

  async ensureDefaultPlan(): Promise<void> {
    if (this.currentPreset) return;
    if (this.currentPlan) {
      this.renderPlanPreview();
      return;
    }
    await this.changeMap('1', 1);
    this.savedPlanSnapshot = this.planDraftSnapshot();
  }

  private async changeMap(chapterValue: string, map: number): Promise<void> {
    const version = ++this.mapLoadVersion;
    const chapter = chapterValue === 'Ex'
      ? 99
      : Number(chapterValue);
    const mapData = chapterValue === 'Ex'
      ? await loadExMapData(map)
      : await loadMapData(chapter, map);
    if (version !== this.mapLoadVersion) return;
    if (!mapData) {
      Logger.error(`地图 ${chapterValue}-${map} 数据不存在`);
      this.renderPlanPreview();
      return;
    }

    this.planView.resetNodeEditorDrafts();
    const selectedNodes = Object.keys(mapData).sort();
    if (!this.currentPlan) {
      this.currentPlan = PlanModel.create(chapter, map, selectedNodes);
    } else {
      this.currentPlan.data.chapter = chapter;
      this.currentPlan.data.map = map;
      this.currentPlan.data.mode = undefined;
      this.currentPlan.data.event = undefined;
      this.currentPlan.data.selected_nodes = selectedNodes;
      this.currentPlan.data.endpoint_nodes = undefined;
      this.currentPlan.data.result = undefined;
      this.currentPlan.data.node_args = {};
    }

    this.currentMapData = mapData;
    this.editingNodeId = null;
    this.planView.hideNodeEditor();
    this.renderPlanPreview();
    Logger.info(`已切换地图 ${this.currentPlan.mapName}`);
  }

  // ── 执行方案 ──

  private toNodeDecisionReq(args?: NodeArgs): NodeDecisionReq | undefined {
    if (!args) return undefined;
    const mapped: NodeDecisionReq = {};
    if (args.formation != null) mapped.formation = args.formation;
    if (args.night != null) mapped.night = args.night;
    if (args.long_missile_support != null) mapped.long_missile_support = args.long_missile_support;
    if (args.proceed != null) mapped.proceed = args.proceed;
    if (args.detour != null) mapped.detour = args.detour;
    if (args.proceed_stop != null) mapped.proceed_stop = args.proceed_stop;
    if (args.SL_when_detour_fails != null) mapped.SL_when_detour_fails = args.SL_when_detour_fails;
    if (args.enemy_rules && args.enemy_rules.length > 0) {
      mapped.enemy_rules = args.enemy_rules.map(([cond, action]) => [String(cond), action]);
    }
    if (args.enemy_formation_rules && args.enemy_formation_rules.length > 0) {
      mapped.enemy_formation_rules = args.enemy_formation_rules.map(([cond, action]) => [String(cond), action]);
    }
    if (args.SL_when_spot_enemy_fails != null) {
      mapped.SL_when_spot_enemy_fails = args.SL_when_spot_enemy_fails;
    }
    if (args.SL_when_enter_fight != null) mapped.SL_when_enter_fight = args.SL_when_enter_fight;
    if (args.formation_when_spot_enemy_fails != null) {
      mapped.formation_when_spot_enemy_fails = args.formation_when_spot_enemy_fails;
    }
    return Object.keys(mapped).length > 0 ? mapped : undefined;
  }

  private buildInlinePlan(plan: PlanModel): CombatPlanReq {
    const selectedNodes = normalizeSelectedNodesForBackend(plan.data.selected_nodes);
    const inlinePlan: CombatPlanReq = {
      chapter: plan.data.chapter,
      map: plan.data.map,
      selected_nodes: selectedNodes,
    };

    if (plan.data.mode) inlinePlan.mode = plan.data.mode;
    if (plan.data.event) inlinePlan.event_name = plan.data.event;

    if (plan.data.fleet_id != null) inlinePlan.fleet_id = plan.data.fleet_id;
    if (plan.data.repair_mode != null) {
      inlinePlan.repair_mode = Array.isArray(plan.data.repair_mode)
        ? [...plan.data.repair_mode]
        : [plan.data.repair_mode];
    }
    if (plan.data.fight_condition != null) inlinePlan.fight_condition = plan.data.fight_condition;

    const nodeDefaults = this.toNodeDecisionReq(plan.data.node_defaults);
    if (nodeDefaults) inlinePlan.node_defaults = nodeDefaults;

    if (plan.data.node_args) {
      const nodeArgs: Record<string, NodeDecisionReq> = {};
      for (const [nodeId, nodeArg] of Object.entries(plan.data.node_args)) {
        const mapped = this.toNodeDecisionReq(nodeArg);
        if (mapped) nodeArgs[nodeId] = mapped;
      }
      if (Object.keys(nodeArgs).length > 0) inlinePlan.node_args = nodeArgs;
    }

    return inlinePlan;
  }

  private async ensurePlanFileForExecution(plan: PlanModel): Promise<string | null> {
    const bridge = window.electronBridge;
    if (!bridge?.prepareCombatPlanExecution) return null;

    const result = await bridge.prepareCombatPlanExecution(
      plan.toYaml(),
      plan.mapName,
    );
    if (!result.success || !result.path) {
      Logger.warn(
        result.error || '无法生成运行时出征计划',
      );
      return null;
    }
    return result.path;
  }

  private async executePlan(): Promise<void> {
    if (!this.currentPlan) return;
    const plan = this.currentPlan;
    const times = plan.data.times ?? 1;
    const lootCountGe = plan.data.stop_condition?.loot_count_ge;
    const shipCountGe = plan.data.stop_condition?.ship_count_ge;
    const stopCondition = (
      (lootCountGe !== undefined && lootCountGe > 0)
      || (shipCountGe !== undefined && shipCountGe > 0)
    )
      ? {
          loot_count_ge: lootCountGe !== undefined && lootCountGe > 0
            ? lootCountGe
            : undefined,
          ship_count_ge: shipCountGe !== undefined && shipCountGe > 0
            ? shipCountGe
            : undefined,
        }
      : undefined;
    const selectedPresets = this.planView.getSelectedPresets();
    const firstPreset = selectedPresets.length > 0 ? selectedPresets[0] : undefined;
    const effectiveFleetId = plan.data.fleet_id ?? 1;

    const req: NormalFightReq | EventFightReq = plan.isEvent
      ? { type: 'event_fight', times: 1, gap: plan.data.gap ?? 0, fleet_id: effectiveFleetId }
      : { type: 'normal_fight', times: 1, gap: plan.data.gap ?? 0 };
    const ensuredPlanPath = await this.ensurePlanFileForExecution(plan);

    if (ensuredPlanPath) {
      req.plan_id = ensuredPlanPath;
    } else {
      req.plan = this.buildInlinePlan(plan);
      Logger.warn('无法保存方案文件，回退为内存方案执行（部分高级规则可能不生效）');
    }

    if (plan.data.selected_nodes.length > 0) {
      req.plan = req.plan ?? {};
      req.plan.selected_nodes = normalizeSelectedNodesForBackend(plan.data.selected_nodes);
      // 后端 schema 会为 plan.fleet_id 注入默认值 1；
      // 这里显式传入当前舰队，避免 selected_nodes 覆盖请求意外把舰队重置为 1。
      req.plan.fleet_id = effectiveFleetId;
    }

    if (firstPreset && firstPreset.ships.length > 0) {
      const resolved = resolveFleetPreset(firstPreset.ships);
      if (resolved.length > 0) {
        if (req.type === 'event_fight') req.fleet_id = effectiveFleetId;
        if (!req.plan) req.plan = {};
        req.plan.fleet = resolved.map(toBackendName);
        req.plan.fleet_id = effectiveFleetId;
        const fleetRules = resolveFleetPresetRules(firstPreset.ships);
        if (fleetRules.length > 0) req.plan.fleet_rules = fleetRules;
      }
    }

    const bathRepairConfig = this.planView.getBathRepairConfig();
    const fleetId = effectiveFleetId;
    const fleetPresets = selectedPresets.length > 1 ? selectedPresets : undefined;
    const currentPresetIndex = fleetPresets ? 0 : undefined;

    const taskType = plan.isEvent ? 'event_fight' : 'normal_fight';
    this.host.scheduler.addTask(
      plan.mapName, taskType, req, TaskPriority.USER_TASK, times,
      stopCondition, bathRepairConfig, fleetId, fleetPresets, currentPresetIndex,
      undefined, undefined, plan.data.endpoint_nodes, plan.data.result,
    );
    const planRef = req.plan_id ?? '(inline-unsaved)';
    Logger.debug(`executePlan: map=${plan.mapName} plan_id=${planRef} times=${times} gap=${req.gap}${firstPreset ? ' fleet=' + firstPreset.ships.map(s => shipSlotLabel(s)).join(',') : ''}${fleetPresets ? ' rotation=' + fleetPresets.length + '套' : ''}`);

    this.planView.selectedFleetPresetIndices.clear();
    this.host.switchPage('main');
    this.host.renderMain();

    if (stopCondition) {
      const parts: string[] = [`×${times}`];
      if (stopCondition.loot_count_ge) parts.push(`战利品≥${stopCondition.loot_count_ge}时停止`);
      if (stopCondition.ship_count_ge) parts.push(`舰船≥${stopCondition.ship_count_ge}时停止`);
      Logger.info(`任务「${plan.mapName}」已加入队列 (${parts.join(', ')})`);
    }
  }
}
