/**
 * 编排受管方案、任务预设、节点编辑和计划预览。
 */
import { PlanPreviewView } from '../../view/plan/PlanPreviewView';
import { PlanModel } from '../../model/PlanModel';
import type { CombatPlanReq, EventFightReq, NodeDecisionReq, NormalFightReq } from '../../types/api';
import type { Scheduler } from '../../model/scheduler';
import { TaskPriority } from '../../model/scheduler';
import type { FleetPreset, NodeArgs, TaskPreset } from '../../types/model';
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
  ManagedBattlePlan,
  ManagedBattlePlanSelection,
  ManagedTeamPlan,
  PlanPresetSource,
  PlanTeamBinding,
} from '../../types/electronBridge';
import { appendTeamPlanCardContent } from '../../view/plan/TeamPlanListUi';
import { toBackendName, resolveFleetPreset, resolveFleetPresetRules, shipSlotLabel } from '../../data/shipData';
import { Logger } from '../../utils/Logger';
import {
  showAlert,
  showConfirm,
  showSaveSuccess,
} from '../shared/DialogHelper';
import { importTaskPresetFlow, closePresetDetailFlow, executePresetFlow, type PresetState } from './presetFlow';
import { saveNodeEditorValues } from './nodeEditor';
import { buildPlanPreviewVO } from './rendering';
import { normalizeSelectedNodesForBackend } from './selectedNodes';

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
  private battlePlanLoaderPlans: ManagedBattlePlan[] = [];
  private selectedBattlePlan: ManagedBattlePlan | null = null;
  private selectedBattlePlanFleetIndex: number | null = null;
  private battlePlanLoaderSortField: 'name' | 'modifiedAt' = 'modifiedAt';
  private battlePlanLoaderPurpose:
    'editor' | 'queue' | 'task-list' | 'automation' = 'editor';
  private resolveBattlePlanSelection: (
    (selection: ManagedBattlePlanSelection | null) => void
  ) | null = null;

  constructor(
    private readonly planView: PlanPreviewView,
    readonly host: PlanHost,
  ) {}

  // ── 公共访问器 ──

  getCurrentPlan(): PlanModel | null { return this.currentPlan; }

  pickManagedBattlePlan(): Promise<ManagedBattlePlanSelection | null> {
    this.finishBattlePlanSelection(null);
    this.battlePlanLoaderPurpose = 'task-list';
    this.selectedBattlePlanFleetIndex = null;
    this.updateBattlePlanLoaderCopy();
    const searchInput = document.getElementById(
      'battle-plan-loader-search',
    ) as HTMLInputElement | null;
    if (searchInput) searchInput.value = '';
    this.openBattlePlanLoader();
    void this.refreshBattlePlanLoader().then(() => searchInput?.focus());
    return new Promise((resolve) => {
      this.resolveBattlePlanSelection = resolve;
    });
  }

  pickManagedBattlePlanForQueue(): Promise<ManagedBattlePlanSelection | null> {
    this.finishBattlePlanSelection(null);
    this.battlePlanLoaderPurpose = 'queue';
    this.selectedBattlePlanFleetIndex = null;
    this.updateBattlePlanLoaderCopy();
    const searchInput = document.getElementById(
      'battle-plan-loader-search',
    ) as HTMLInputElement | null;
    if (searchInput) searchInput.value = '';
    this.openBattlePlanLoader();
    void this.refreshBattlePlanLoader().then(() => searchInput?.focus());
    return new Promise((resolve) => {
      this.resolveBattlePlanSelection = resolve;
    });
  }

  pickManagedBattlePlanForAutomation(): Promise<ManagedBattlePlanSelection | null> {
    this.finishBattlePlanSelection(null);
    this.battlePlanLoaderPurpose = 'automation';
    this.selectedBattlePlanFleetIndex = null;
    this.updateBattlePlanLoaderCopy();
    const searchInput = document.getElementById(
      'battle-plan-loader-search',
    ) as HTMLInputElement | null;
    if (searchInput) searchInput.value = '';
    this.openBattlePlanLoader();
    void this.refreshBattlePlanLoader().then(() => searchInput?.focus());
    return new Promise((resolve) => {
      this.resolveBattlePlanSelection = resolve;
    });
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
    this.bindBattlePlanLoaderActions();

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
      this.planView.showNodeEditor(nodeId, nodeType as any, {
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
      const parsed = (await import('js-yaml')).load(result.content);
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
    this.finishBattlePlanSelection(null);
    this.battlePlanLoaderPurpose = 'editor';
    this.updateBattlePlanLoaderCopy();
    const searchInput = document.getElementById(
      'battle-plan-loader-search',
    ) as HTMLInputElement | null;
    if (searchInput) searchInput.value = '';
    this.openBattlePlanLoader();
    await this.refreshBattlePlanLoader();
    searchInput?.focus();
  }

  private async importLocalBattlePlan(): Promise<void> {
    const bridge = window.electronBridge;
    if (!bridge?.importLocalCombatPlan) {
      await showAlert('导入失败', '请完整重启 GUI 后再操作');
      return;
    }
    const button = document.getElementById(
      'btn-import-local-battle-plan',
    ) as HTMLButtonElement | null;
    if (button) button.disabled = true;
    try {
      const result = await bridge.importLocalCombatPlan();
      if (result.canceled) return;
      if (!result.success || !result.file) {
        throw new Error(result.error || '本地 YAML 导入失败');
      }

      await this.refreshBattlePlanLoader();
      const imported = this.battlePlanLoaderPlans.find(plan => (
        plan.source === 'user' && plan.file === result.file
      ));
      if (imported) this.selectBattlePlan(imported);
      Logger.info(`本地出征计划已升级并导入: ${result.file}`);
      showSaveSuccess(
        result.kind === 'preset'
          ? '已添加本地任务预设'
          : `已添加本地 YAML，并升级 ${
            result.teamFiles?.length ?? 0
          } 支关联编队`,
      );
    } catch (error) {
      await showAlert(
        '导入失败',
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      if (button) button.disabled = false;
    }
  }

  private bindBattlePlanLoaderActions(): void {
    const dialog = document.getElementById('battle-plan-loader');
    document.getElementById('btn-cancel-battle-plan-loader')?.addEventListener(
      'click',
      () => this.closeBattlePlanLoader(),
    );
    document.getElementById('btn-import-local-battle-plan')?.addEventListener(
      'click',
      () => void this.importLocalBattlePlan(),
    );
    document.getElementById('btn-refresh-battle-plan-loader')?.addEventListener(
      'click',
      () => void this.refreshBattlePlanLoader(),
    );
    document.getElementById('battle-plan-loader-search')?.addEventListener(
      'input',
      () => this.renderBattlePlanLoaderList(),
    );
    document.getElementById('battle-plan-loader-filter-system')?.addEventListener(
      'change',
      () => this.renderBattlePlanLoaderList(),
    );
    document.getElementById('battle-plan-loader-sort-asc')?.addEventListener(
      'change',
      () => this.renderBattlePlanLoaderList(),
    );
    document.querySelectorAll<HTMLElement>('[data-battle-plan-sort-field]').forEach((button) => {
      button.addEventListener('click', () => {
        this.battlePlanLoaderSortField = button.dataset['battlePlanSortField'] === 'name'
          ? 'name'
          : 'modifiedAt';
        document.querySelectorAll<HTMLElement>('[data-battle-plan-sort-field]').forEach((item) => {
          item.classList.toggle(
            'active',
            item.dataset['battlePlanSortField'] === this.battlePlanLoaderSortField,
          );
        });
        this.renderBattlePlanLoaderList();
      });
    });
    document.getElementById('battle-plan-loader-list')?.addEventListener(
      'click',
      (event) => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
          '[data-battle-plan-file]',
        );
        if (!button) return;
        const selected = this.battlePlanLoaderPlans.find(plan => (
          plan.file === button.dataset['battlePlanFile']
          && plan.source === button.dataset['battlePlanSource']
        ));
        if (selected) this.selectBattlePlan(selected);
      },
    );
    document.getElementById('btn-confirm-battle-plan-loader')?.addEventListener(
      'click',
      () => void this.confirmBattlePlanLoader(),
    );
    dialog?.addEventListener('click', (event) => {
      if (event.target === dialog) this.closeBattlePlanLoader();
    });
  }

  private openBattlePlanLoader(): void {
    const dialog = document.getElementById('battle-plan-loader');
    if (dialog) dialog.style.display = 'flex';
  }

  private closeBattlePlanLoader(): void {
    const dialog = document.getElementById('battle-plan-loader');
    if (dialog) dialog.style.display = 'none';
    this.finishBattlePlanSelection(null);
    this.selectedBattlePlanFleetIndex = null;
    this.battlePlanLoaderPurpose = 'editor';
    this.updateBattlePlanLoaderCopy();
  }

  private finishBattlePlanSelection(
    selection: ManagedBattlePlanSelection | null,
  ): void {
    const resolve = this.resolveBattlePlanSelection;
    this.resolveBattlePlanSelection = null;
    resolve?.(selection);
  }

  private updateBattlePlanLoaderCopy(): void {
    const pickingForQueue = this.battlePlanLoaderPurpose === 'queue';
    const pickingForTaskList = this.battlePlanLoaderPurpose === 'task-list';
    const pickingForAutomation = this.battlePlanLoaderPurpose === 'automation';
    const title = document.getElementById('battle-plan-loader-title');
    const description = document.getElementById(
      'battle-plan-loader-description',
    );
    const confirm = document.getElementById(
      'btn-confirm-battle-plan-loader',
    );
    if (title) {
      title.textContent = pickingForQueue
        ? '加载计划到任务队列'
        : pickingForTaskList
          ? '添加计划到任务列表'
          : pickingForAutomation
            ? '加载自动出征计划'
            : '加载出征配置';
    }
    if (description) {
      description.textContent = pickingForQueue
        ? '选择加入任务队列的作战计划；计划包含编队时需选择本次使用的编队。'
        : pickingForTaskList
          ? '选择作战计划；计划包含编队时需选择本次使用的编队。'
          : pickingForAutomation
            ? '选择自动出征使用的作战计划和队伍。'
            : '读取系统与用户作战计划目录中的合法 YAML 配置。';
    }
    if (confirm) {
      confirm.textContent = pickingForQueue
        ? '加入队列'
        : pickingForTaskList
          ? '添加到列表'
          : '加载';
    }
  }

  private async refreshBattlePlanLoader(): Promise<void> {
    const bridge = window.electronBridge;
    const status = document.getElementById('battle-plan-loader-status');
    if (!bridge?.getPlanManagement) {
      if (status) {
        status.hidden = false;
        status.textContent = '请完整重启 GUI 后再操作';
      }
      return;
    }
    if (status) {
      status.hidden = false;
      status.textContent = '正在读取作战计划...';
    }
    try {
      const result = await bridge.getPlanManagement();
      const detailedPlans = (
        result as typeof result & { battlePlans?: ManagedBattlePlan[] }
      ).battlePlans;
      const compatibilityMode = !Array.isArray(detailedPlans)
        || detailedPlans.some(plan => (
          !Array.isArray(plan.fleets)
          || typeof plan.fleetId !== 'number'
        ));
      this.battlePlanLoaderPlans = compatibilityMode
        ? this.battlePlansFromBindings(result.bindings, result.teamPlans)
        : detailedPlans;
      const visiblePlans = this.visibleBattlePlans();
      this.selectedBattlePlan = visiblePlans.find(plan => (
        Boolean(this.currentManagedPlanFile)
        && plan.file === this.currentManagedPlanFile
        && plan.source === this.currentPlanSource
      )) ?? visiblePlans[0] ?? null;
      this.resetBattlePlanFleetSelection(this.selectedBattlePlan);
      const count = document.getElementById('battle-plan-loader-count');
      if (count) {
        count.textContent = `共读取 ${this.battlePlanLoaderPlans.length} 个作战配置`;
      }
      const errorCount = result.errors.filter(error => error.kind === 'battle').length;
      if (status) {
        const message = compatibilityMode
          ? '当前主进程未更新，已显示基础列表；完整重启 GUI 后显示计划摘要'
          : errorCount > 0
            ? `${errorCount} 个 YAML 无法读取，已从列表中排除`
            : '';
        status.textContent = message;
        status.hidden = !message;
      }
      this.renderBattlePlanLoaderList();
    } catch (error) {
      this.battlePlanLoaderPlans = [];
      this.clearBattlePlanSelection();
      if (status) {
        status.hidden = false;
        status.textContent = `读取失败：${error instanceof Error ? error.message : String(error)}`;
      }
      this.renderBattlePlanLoaderList();
    }
  }

  private battlePlansFromBindings(
    bindings: PlanTeamBinding[],
    teamPlans: ManagedTeamPlan[],
  ): ManagedBattlePlan[] {
    const plans = new Map<string, ManagedBattlePlan>();
    bindings.forEach((binding) => {
      const key = `${binding.source}/${binding.planFile}`;
      const existing = plans.get(key);
      if (existing) {
        if (binding.teamName) {
          existing.fleets.push(this.compatibilityFleetSummary(
            binding.teamName,
            binding.source,
            teamPlans,
          ));
          existing.fleetCount = existing.fleets.length;
        }
        return;
      }
      const fleets = binding.teamName
        ? [this.compatibilityFleetSummary(
          binding.teamName,
          binding.source,
          teamPlans,
        )]
        : [];
      plans.set(key, {
        kind: 'battle',
        file: binding.planFile,
        name: binding.planName,
        source: binding.source,
        modifiedAt: 0,
        chapter: '?',
        map: '?',
        times: 0,
        gap: 0,
        fleetId: 1,
        repairMode: 1,
        result: null,
        lootCountGe: -1,
        shipCountGe: -1,
        fleetCount: fleets.length,
        nodeCount: 0,
        fleets,
      });
    });
    return [...plans.values()];
  }

  private compatibilityFleetSummary(
    name: string,
    battleSource: PlanPresetSource,
    teamPlans: ManagedTeamPlan[],
  ): ManagedBattlePlan['fleets'][number] {
    const matchingPlan = teamPlans.find(plan => (
      plan.name === name && plan.source === battleSource
    )) ?? teamPlans.find(plan => plan.name === name);
    return {
      name,
      source: matchingPlan?.source ?? 'deleted',
      primaryCount: 0,
      backupCount: 0,
    };
  }

  private visibleBattlePlans(): ManagedBattlePlan[] {
    const searchInput = document.getElementById(
      'battle-plan-loader-search',
    ) as HTMLInputElement | null;
    const filterSystem = document.getElementById(
      'battle-plan-loader-filter-system',
    ) as HTMLInputElement | null;
    const sortAsc = document.getElementById(
      'battle-plan-loader-sort-asc',
    ) as HTMLInputElement | null;
    const keyword = (searchInput?.value ?? '').trim().toLocaleLowerCase('zh-CN');
    const direction = sortAsc?.checked ? 1 : -1;
    return this.battlePlanLoaderPlans
      .filter(plan => (
        this.battlePlanLoaderPurpose !== 'automation'
        || plan.kind === 'battle'
      ))
      .filter(plan => !filterSystem?.checked || plan.source !== 'system')
      .filter((plan) => {
        if (!keyword) return true;
        return [
          plan.name,
          plan.file,
          String(plan.chapter),
          String(plan.map),
          `${plan.chapter}-${plan.map}`,
          plan.taskType ?? '',
          plan.campaignName ?? '',
        ].some(value => value.toLocaleLowerCase('zh-CN').includes(keyword));
      })
      .sort((left, right) => {
        const result = this.battlePlanLoaderSortField === 'name'
          ? left.name.localeCompare(right.name, 'zh-CN')
          : left.modifiedAt - right.modifiedAt;
        return (result || left.name.localeCompare(right.name, 'zh-CN')) * direction;
      });
  }

  private renderBattlePlanLoaderList(): void {
    const list = document.getElementById('battle-plan-loader-list');
    if (!list) return;
    const visiblePlans = this.visibleBattlePlans();
    const previousSelection = this.selectedBattlePlan;
    if (
      !this.selectedBattlePlan
      || !visiblePlans.some(plan => this.sameBattlePlan(plan, this.selectedBattlePlan))
    ) {
      this.selectedBattlePlan = visiblePlans[0] ?? null;
    }
    if (!this.sameBattlePlan(this.selectedBattlePlan, previousSelection)) {
      this.resetBattlePlanFleetSelection(this.selectedBattlePlan);
    }
    list.replaceChildren();
    if (visiblePlans.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'fleet-team-loader-preview-empty';
      empty.textContent = this.battlePlanLoaderPlans.length === 0
        ? '未读取到合法的作战配置'
        : '没有符合当前条件的作战配置';
      list.append(empty);
      this.clearBattlePlanSelection();
      return;
    }
    visiblePlans.forEach((plan) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'fleet-team-loader-item battle-plan-loader-item';
      button.dataset['battlePlanFile'] = plan.file;
      button.dataset['battlePlanSource'] = plan.source;
      button.classList.toggle(
        'active',
        this.sameBattlePlan(plan, this.selectedBattlePlan),
      );

      const heading = document.createElement('div');
      heading.className = 'fleet-team-loader-item-heading';
      const name = document.createElement('strong');
      name.textContent = plan.name;
      const badge = document.createElement('span');
      badge.className = `fleet-team-source-badge ${plan.source}`;
      badge.textContent = plan.source === 'system' ? '系统预设' : '用户预设';
      heading.append(name, badge);

      const fileName = document.createElement('span');
      fileName.className = 'battle-plan-loader-item-file';
      fileName.textContent = plan.file;
      fileName.title = plan.file;
      const meta = document.createElement('span');
      meta.className = 'battle-plan-loader-item-meta';
      meta.textContent = plan.kind === 'preset'
        ? `${this.taskPresetTypeLabel(plan)} · 任务预设`
        : plan.modifiedAt > 0
          ? `${this.battlePlanMapLabel(plan)} · ${plan.fleetCount} 支关联编队`
        : `${plan.fleetCount} 支关联编队 · 重启后显示完整摘要`;
      button.append(heading, fileName, meta);
      list.append(button);
    });
    if (this.selectedBattlePlan) {
      this.renderBattlePlanPreview(this.selectedBattlePlan);
    }
  }

  private selectBattlePlan(plan: ManagedBattlePlan): void {
    if (!this.sameBattlePlan(plan, this.selectedBattlePlan)) {
      this.resetBattlePlanFleetSelection(plan);
    }
    this.selectedBattlePlan = plan;
    document.querySelectorAll<HTMLElement>('[data-battle-plan-file]').forEach((item) => {
      item.classList.toggle(
        'active',
        item.dataset['battlePlanFile'] === plan.file
          && item.dataset['battlePlanSource'] === plan.source,
      );
    });
    this.renderBattlePlanPreview(plan);
  }

  private resetBattlePlanFleetSelection(plan: ManagedBattlePlan | null): void {
    this.selectedBattlePlanFleetIndex = (
      this.isPickingBattlePlanWithFleet()
      && plan?.kind === 'battle'
      && plan?.fleets.length === 1
    ) ? 0 : null;
  }

  private selectBattlePlanFleet(plan: ManagedBattlePlan, index: number): void {
    if (
      !this.isPickingBattlePlanWithFleet()
      || !this.sameBattlePlan(plan, this.selectedBattlePlan)
      || !plan.fleets[index]
    ) {
      return;
    }
    this.selectedBattlePlanFleetIndex = index;
    this.renderBattlePlanPreview(plan);
  }

  private renderBattlePlanPreview(plan: ManagedBattlePlan): void {
    const title = document.getElementById('battle-plan-loader-preview-title');
    const badge = document.getElementById('battle-plan-loader-preview-source');
    const body = document.getElementById('battle-plan-loader-preview-body');
    const confirmButton = document.getElementById(
      'btn-confirm-battle-plan-loader',
    ) as HTMLButtonElement | null;
    if (title) title.textContent = `配置预览：${plan.name}`;
    if (badge) {
      badge.hidden = false;
      badge.className = `fleet-team-source-badge ${plan.source}`;
      badge.textContent = plan.source === 'system' ? '系统预设' : '用户预设';
    }
    if (body) {
      const hasDetails = plan.modifiedAt > 0;
      if (plan.kind === 'preset') {
        body.replaceChildren(
          this.createBattlePlanPreviewField(
            '任务类型',
            this.taskPresetTypeLabel(plan),
          ),
          this.createBattlePlanPreviewField(
            '执行次数',
            `${plan.times} 次`,
          ),
          this.createBattlePlanPreviewField(
            '任务参数',
            this.taskPresetParameterLabel(plan),
            true,
          ),
          this.createBattlePlanPreviewField(
            '完整配置',
            '加载后可在任务预设页面查看',
            true,
          ),
        );
      } else {
        body.replaceChildren(
          this.createBattlePlanPreviewField('章节关卡', this.battlePlanMapLabel(plan)),
          this.createBattlePlanPreviewField(
            '执行次数',
            hasDetails ? `${plan.times} 次` : '重启后显示',
          ),
          this.createBattlePlanPreviewField(
            '维修方案',
            hasDetails
              ? `${this.battlePlanRepairLabel(plan.repairMode)}-${this.battlePlanRepairMethodLabel()}`
              : '重启后显示',
          ),
          this.createBattlePlanPreviewField(
            '终点战果判断',
            hasDetails ? this.battlePlanResultLabel(plan.result) : '重启后显示',
          ),
          this.createBattlePlanFleetPreview(plan, hasDetails),
          this.createBattlePlanStopPreview(plan, hasDetails),
        );
      }
    }
    if (confirmButton) {
      confirmButton.disabled = (
        this.requiresBattlePlanFleetSelection(plan)
        && this.selectedBattlePlanFleetIndex === null
      );
    }
  }

  private createBattlePlanPreviewField(
    label: string,
    value: string,
    wide = false,
  ): HTMLElement {
    const field = document.createElement('div');
    field.className = `battle-plan-preview-field${wide ? ' wide' : ''}`;
    const caption = document.createElement('span');
    caption.textContent = label;
    const content = document.createElement('strong');
    content.textContent = value;
    content.title = value;
    field.append(caption, content);
    return field;
  }

  private createBattlePlanFleetPreview(
    plan: ManagedBattlePlan,
    hasDetails: boolean,
  ): HTMLElement {
    const section = document.createElement('section');
    section.className = 'battle-plan-preview-section wide';

    const heading = document.createElement('div');
    heading.className = 'battle-plan-preview-section-heading';
    const title = document.createElement('span');
    title.textContent = '使用舰队';
    const fleetId = document.createElement('strong');
    fleetId.textContent = hasDetails
      ? `舰队编号：第 ${plan.fleetId} 舰队`
      : '舰队编号：重启后显示';
    heading.append(title, fleetId);

    const list = document.createElement('div');
    list.className = 'battle-plan-preview-fleet-list';
    if (plan.fleets.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'battle-plan-preview-empty';
      empty.textContent = this.battlePlanLoaderPurpose === 'automation'
        ? '没有可选择的编队，无法用于自动出征'
        : this.isPickingBattlePlanWithFleet()
          ? '未配置编队预设，将使用 YAML 的舰队编号和游戏当前编成'
          : '未配置编队预设';
      list.append(empty);
    } else {
      const selectable = this.isPickingBattlePlanWithFleet();
      plan.fleets.forEach((fleet, index) => {
        const card = document.createElement(selectable ? 'button' : 'div');
        if (card instanceof HTMLButtonElement) card.type = 'button';
        card.className = 'fleet-team-loader-item battle-plan-preview-fleet-card';
        card.classList.toggle('selectable', selectable);
        card.classList.toggle(
          'active',
          selectable && this.selectedBattlePlanFleetIndex === index,
        );
        appendTeamPlanCardContent(card, {
          name: fleet.name,
          source: fleet.source,
          primaryCount: fleet.primaryCount,
          backupCount: fleet.backupCount,
        });
        if (selectable) {
          const state = document.createElement('span');
          state.className = 'battle-plan-fleet-selection-state';
          state.textContent = this.selectedBattlePlanFleetIndex === index
            ? '已选择'
            : '点击选择';
          card.append(state);
          card.setAttribute(
            'aria-pressed',
            String(this.selectedBattlePlanFleetIndex === index),
          );
          card.addEventListener(
            'click',
            () => this.selectBattlePlanFleet(plan, index),
          );
        }
        list.append(card);
      });
    }
    section.append(heading, list);
    return section;
  }

  private createBattlePlanStopPreview(
    plan: ManagedBattlePlan,
    hasDetails: boolean,
  ): HTMLElement {
    const field = document.createElement('section');
    field.className = 'battle-plan-preview-section wide';
    const heading = document.createElement('div');
    heading.className = 'battle-plan-preview-section-heading';
    const title = document.createElement('span');
    title.textContent = '停止检测';
    heading.append(title);

    const values = document.createElement('div');
    values.className = 'battle-plan-preview-stop-values';
    const loot = document.createElement('div');
    const lootLabel = document.createElement('span');
    lootLabel.textContent = '战利品检测';
    const lootValue = document.createElement('strong');
    lootValue.textContent = hasDetails ? String(plan.lootCountGe) : '重启后显示';
    loot.append(lootLabel, lootValue);
    const ship = document.createElement('div');
    const shipLabel = document.createElement('span');
    shipLabel.textContent = '掉落检测';
    const shipValue = document.createElement('strong');
    shipValue.textContent = hasDetails ? String(plan.shipCountGe) : '重启后显示';
    ship.append(shipLabel, shipValue);
    values.append(loot, ship);
    field.append(heading, values);
    return field;
  }

  private battlePlanRepairLabel(repairMode: number | number[]): string {
    const label = (value: number): string => {
      if (value === 1) return '中破就修';
      if (value === 2) return '大破才修';
      return String(value);
    };
    return Array.isArray(repairMode)
      ? `按舰位：${repairMode.map(label).join(' / ')}`
      : label(repairMode);
  }

  private battlePlanRepairMethodLabel(): string {
    const method = document.getElementById(
      'plan-edit-repair-method',
    ) as HTMLSelectElement | null;
    return method?.value === 'bath' ? '泡澡维修' : '快速维修';
  }

  private battlePlanResultLabel(result: ManagedBattlePlan['result']): string {
    if (!result) return '不判断';
    return result === 'SS' ? result : `${result}及以上`;
  }

  private clearBattlePlanSelection(): void {
    this.selectedBattlePlan = null;
    this.selectedBattlePlanFleetIndex = null;
    const title = document.getElementById('battle-plan-loader-preview-title');
    const badge = document.getElementById('battle-plan-loader-preview-source');
    const body = document.getElementById('battle-plan-loader-preview-body');
    const confirmButton = document.getElementById(
      'btn-confirm-battle-plan-loader',
    ) as HTMLButtonElement | null;
    if (title) title.textContent = '配置预览：未选择';
    if (badge) badge.hidden = true;
    if (body) {
      const empty = document.createElement('div');
      empty.className = 'fleet-team-loader-preview-empty';
      empty.textContent = '从左侧选择一个出征配置查看摘要';
      body.replaceChildren(empty);
    }
    if (confirmButton) confirmButton.disabled = true;
  }

  private async confirmBattlePlanLoader(): Promise<void> {
    if (!this.selectedBattlePlan) return;
    if (this.isPickingBattlePlanWithFleet()) {
      if (
        this.requiresBattlePlanFleetSelection(this.selectedBattlePlan)
        && this.selectedBattlePlanFleetIndex === null
      ) {
        return;
      }
      this.finishBattlePlanSelection({
        plan: this.selectedBattlePlan,
        ...(this.selectedBattlePlanFleetIndex === null
          ? {}
          : { fleetPresetIndex: this.selectedBattlePlanFleetIndex }),
      });
      this.closeBattlePlanLoader();
      return;
    }
    const { file, source } = this.selectedBattlePlan;
    const loaded = await this.openManagedPlan(file, source);
    if (loaded) this.closeBattlePlanLoader();
  }

  private isPickingBattlePlanWithFleet(): boolean {
    return (
      this.battlePlanLoaderPurpose === 'queue'
      || this.battlePlanLoaderPurpose === 'task-list'
      || this.battlePlanLoaderPurpose === 'automation'
    );
  }

  private requiresBattlePlanFleetSelection(plan: ManagedBattlePlan): boolean {
    if (plan.kind === 'preset') return false;
    return (
      this.battlePlanLoaderPurpose === 'automation'
      || (
        this.isPickingBattlePlanWithFleet()
        && plan.fleets.length > 0
      )
    );
  }

  private sameBattlePlan(
    left: ManagedBattlePlan | null,
    right: ManagedBattlePlan | null,
  ): boolean {
    return Boolean(
      left
      && right
      && left.file === right.file
      && left.source === right.source,
    );
  }

  private battlePlanMapLabel(plan: ManagedBattlePlan): string {
    if (plan.kind === 'preset') return this.taskPresetTypeLabel(plan);
    const chapter = String(plan.chapter).trim();
    const map = String(plan.map);
    if (chapter === '?' || map === '?') return '重启后显示';
    const normalizedChapter = chapter.toLocaleUpperCase('en-US');
    const normalizedMap = map.toLocaleUpperCase('en-US');
    if (normalizedChapter === 'E' || normalizedChapter === 'H') {
      return `${normalizedChapter}${normalizedMap}`;
    }
    if (normalizedChapter === 'EX') return `EX-${normalizedMap}`;
    return `${chapter}-${map}`;
  }

  private taskPresetTypeLabel(plan: ManagedBattlePlan): string {
    const labels: Record<string, string> = {
      normal_fight: '普通出击',
      event_fight: '活动出击',
      campaign: '战役',
      exercise: '演习',
      decisive: '决战',
    };
    return labels[plan.taskType ?? ''] ?? plan.taskType ?? '任务预设';
  }

  private taskPresetParameterLabel(plan: ManagedBattlePlan): string {
    if (plan.taskType === 'campaign') {
      return plan.campaignName || '未指定战役';
    }
    if (plan.taskType === 'exercise') {
      return `第 ${plan.fleetId} 舰队`;
    }
    if (plan.taskType === 'decisive') {
      return `第 ${plan.chapter} 章`;
    }
    return '引用受管出征计划';
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
    return JSON.stringify({
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
      mapped.enemy_rules = args.enemy_rules.map(([cond, action]) => [String(cond), String(action)]);
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
        req.plan.fleet_rules = resolveFleetPresetRules(firstPreset.ships);
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
