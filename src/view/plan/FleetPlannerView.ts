/** 组合舰队编辑、规则、图鉴、计划管理和编队加载视图。 */
/**
 * FleetPlannerView —— 本地舰队规划页面。
 * 读取 Electron 提供的舰船清单，负责筛选、排序、图鉴卡片和单支舰队草稿。
 * 国籍、大小和主力/护卫仅用于界面筛选，不会写入后端任务字段。
 */
import type {
  ElectronBridge,
  PlanPresetSource,
  ShipLibraryShip,
  UserTeamPlan,
  UserTeamPlanSlot,
  UserTeamShipRule,
} from '../../types/ipc.js';
import type {
  FleetCandidateDraftViewObject as FleetCandidateDraft,
  FleetDraftViewObject as FleetDraft,
  FleetRuleDraftViewObject as FleetRuleDraft,
  FleetSlotDraftViewObject as FleetSlotDraft,
} from '../../types/view.js';
import {
  FLEET_SHIP_TYPE_CODES,
} from '../../shared/fleetShipTypes';
import {
  showAlert,
  showConfirm,
  showSaveSuccess,
} from '../../controller/shared/DialogHelper';
import {
  PlanManagementView,
} from './PlanManagementView';
import type {
  PlanManagementTaskGroup,
} from './PlanManagementView';
import {
  TeamPlanLoaderView,
} from './TeamPlanLoaderView';
import {
  FleetGalleryView,
} from './FleetGalleryView';
import { FleetEditorView } from './FleetEditorView';

export interface FleetPlannerViewHost extends Pick<
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
> {
  getRefitFilter(): boolean;
  setRefitFilter(enabled: boolean): void;
  currentDraft(): FleetDraft;
  replaceDraft(draft: FleetDraft): void;
  createRuleDraft(): FleetRuleDraft;
  createCandidateDraft(ship?: ShipLibraryShip | null): FleetCandidateDraft;
  createSlotDraft(): FleetSlotDraft;
  createDraft(): FleetDraft;
  cloneRule(source: FleetRuleDraft): FleetRuleDraft;
  copyRule(target: FleetRuleDraft, source: FleetRuleDraft): void;
  markDraftSaved(name: string): void;
  hasUnsavedDraftChanges(name: string): boolean;
}

const DEFAULT_BACKUP_SLOT_COUNT = 6;
const FLEET_SLOT_COUNT = 6;

const ALLOWED_FLEET_SHIP_TYPES = new Set(FLEET_SHIP_TYPE_CODES);

export class FleetPlannerView {
  onOpenBattlePlan: (
    (file: string, source: PlanPresetSource) => Promise<void>
  ) | null = null;

  private taskGroupsProvider: () => ReadonlyArray<PlanManagementTaskGroup>
    = () => [];

  private readonly presetNameInput: HTMLInputElement;
  private readonly editorView: FleetEditorView;
  private readonly galleryView: FleetGalleryView;
  private readonly teamPlanLoaderView: TeamPlanLoaderView;
  private readonly planManagementView: PlanManagementView;

  constructor(private readonly host: FleetPlannerViewHost) {
    this.presetNameInput = document.getElementById(
      'fleet-preset-name',
    ) as HTMLInputElement;
    this.editorView = new FleetEditorView({
      currentDraft: () => this.currentFleet(),
      createRuleDraft: () => this.host.createRuleDraft(),
      createCandidateDraft: ship => this.host.createCandidateDraft(ship),
      createSlotDraft: () => this.host.createSlotDraft(),
      cloneRule: source => this.host.cloneRule(source),
      copyRule: (target, source) => this.host.copyRule(target, source),
      shipById: id => this.galleryView.shipById(id),
      colorfulBackgroundUrl: () => (
        this.galleryView.colorfulBackgroundUrl()
      ),
      shipTypeDisplay: ship => this.galleryView.shipTypeDisplay(ship),
      renderGallerySelection: () => this.galleryView.renderSelection(),
      updateGalleryCardTargets: () => (
        this.galleryView.updateCardTargets()
      ),
    });
    this.galleryView = new FleetGalleryView({
      getShipLibraryManifest: () => this.host.getShipLibraryManifest(),
      getRefitFilter: () => this.host.getRefitFilter(),
      setRefitFilter: enabled => this.host.setRefitFilter(enabled),
      activeSlotDescription: () => (
        this.editorView.activeSlotDescription()
      ),
      selectedShips: () => this.editorView.selectedShips(),
      assignShip: ship => this.editorView.assignShip(ship),
      rememberBackupScroll: () => (
        this.editorView.rememberBackupScroll()
      ),
      clearBackupDragScroll: () => (
        this.editorView.clearBackupDragScroll()
      ),
    });
    this.teamPlanLoaderView = new TeamPlanLoaderView({
      listTeamPlans: () => this.host.listTeamPlans(),
      ensureLibrary: () => this.load(),
      currentPlan: () => ({
        file: this.currentFleet().file,
        source: this.currentFleet().source,
      }),
      ships: () => this.galleryView.ships(),
      colorfulBackgroundUrl: () => (
        this.galleryView.colorfulBackgroundUrl()
      ),
      shipTypeDisplay: ship => this.galleryView.shipTypeDisplay(ship),
      hasUnsavedChanges: () => this.hasUnsavedFleetChanges(),
      applyPlan: plan => this.applyTeamPlan(plan),
    });
    this.planManagementView = new PlanManagementView({
      getPlanManagement: () => this.host.getPlanManagement(),
      exportUserPlans: selections => this.host.exportUserPlans(selections),
      setPlanUnlinkedIgnored: (kind, source, file, ignored) => (
        this.host.setPlanUnlinkedIgnored(kind, source, file, ignored)
      ),
      renameUserCombatPlan: (file, newName) => (
        this.host.renameUserCombatPlan(file, newName)
      ),
      deleteUserCombatPlan: file => this.host.deleteUserCombatPlan(file),
      deleteUserTeamPlan: file => this.host.deleteUserTeamPlan(file),
      taskGroups: () => this.taskGroupsProvider(),
      openBattlePlan: async (file, source) => {
        await this.onOpenBattlePlan?.(file, source);
      },
      openTeamPlan: (file, source) => (
        this.teamPlanLoaderView.open(file, source)
      ),
    });
    this.bindActions();
    this.editorView.render();
    this.host.markDraftSaved(this.presetNameInput.value);
  }

  setTaskGroupsProvider(
    provider: () => ReadonlyArray<PlanManagementTaskGroup>,
  ): void {
    this.taskGroupsProvider = provider;
  }

  /** 首次进入页面时加载资料库；更新资料库后可强制刷新。 */
  load(force = false): Promise<void> {
    return this.galleryView.load(force);
  }

  private bindActions(): void {
    this.presetNameInput.addEventListener('input', () => {
      this.currentFleet().name = this.presetNameInput.value;
    });

    document.getElementById('btn-save-team-plan')?.addEventListener('click', () => {
      void this.saveCurrentTeamPlan();
    });
    document.getElementById('btn-new-team-plan')?.addEventListener('click', () => {
      void this.newTeamPlan();
    });
    document.getElementById('btn-load-team-plan')?.addEventListener('click', () => {
      void this.teamPlanLoaderView.open();
    });
  }

  private currentFleet(): FleetDraft {
    return this.host.currentDraft();
  }

  private hasUnsavedFleetChanges(): boolean {
    return this.host.hasUnsavedDraftChanges(this.presetNameInput.value);
  }

  private buildTeamPlan(): UserTeamPlan {
    const fleet = this.currentFleet();
    const name = this.presetNameInput.value.trim();
    if (!name) throw new Error('请输入舰队预设名称');

    const occupiedSlots = fleet.slots.filter(
      slot => !this.editorView.isSlotEmpty(slot),
    );
    if (occupiedSlots.length === 0) {
      throw new Error('当前编队至少需要一艘主选或备选舰船');
    }
    const ships = occupiedSlots.map((slot, index) => (
      this.buildTeamPlanSlot(slot, index)
    ));
    return { name, ships };
  }

  private buildTeamPlanSlot(
    slot: FleetSlotDraft,
    index: number,
  ): UserTeamPlanSlot {
    const primary = slot.primary;
    const backups = slot.candidates.filter(
      (candidate): candidate is FleetCandidateDraft & {
        ship: ShipLibraryShip;
      } => candidate.ship !== null,
    );
    const result: UserTeamPlanSlot = primary
      ? this.buildTeamShipRule(primary, slot, `位置 ${index + 1} 主选`)
      : {};
    if (backups.length > 0) {
      result.candidates = backups.map((candidate, candidateIndex) => (
        this.buildTeamShipRule(
          candidate.ship,
          candidate,
          `位置 ${index + 1} 备选 ${candidateIndex + 1}`,
        )
      ));
    }
    return result;
  }

  private buildTeamShipRule(
    ship: ShipLibraryShip,
    rule: FleetRuleDraft,
    field: string,
  ): UserTeamShipRule {
    const invalidShipType = rule.shipTypes.find(
      shipType => !ALLOWED_FLEET_SHIP_TYPES.has(shipType),
    );
    if (invalidShipType) {
      throw new Error(`${field} 的舰种不符合后端接口：${invalidShipType}`);
    }
    if (rule.levelEnabled) {
      if (
        rule.minLevel !== null
        && (!Number.isInteger(rule.minLevel) || rule.minLevel < 1)
      ) {
        throw new Error(`${field} 的最小等级不合法`);
      }
      if (
        rule.maxLevel !== null
        && (!Number.isInteger(rule.maxLevel) || rule.maxLevel < 1)
      ) {
        throw new Error(`${field} 的最大等级不合法`);
      }
      if (
        rule.minLevel !== null
        && rule.maxLevel !== null
        && rule.maxLevel < rule.minLevel
      ) {
        throw new Error(`${field} 的最大等级不能小于最小等级`);
      }
    }

    const result: UserTeamShipRule = {
      name: ship.name,
    };
    if (ship.search_name && ship.search_name !== ship.name) {
      result.search_name = ship.search_name;
    }
    if (rule.shipTypes.length > 0) {
      result.ship_type = [...rule.shipTypes];
    }
    if (rule.levelEnabled && rule.minLevel !== null) {
      result.min_level = rule.minLevel;
    }
    if (rule.levelEnabled && rule.maxLevel !== null) {
      result.max_level = rule.maxLevel;
    }
    return result;
  }

  private async saveCurrentTeamPlan(): Promise<void> {
    try {
      const plan = this.buildTeamPlan();
      const currentFile = this.currentFleet().file ?? undefined;
      const source = this.currentFleet().source;
      let result = await this.host.saveUserTeamPlan(
        plan,
        false,
        currentFile,
        source,
      );
      if (result.exists) {
        const overwrite = await showConfirm(
          '覆盖配置',
          '存在同名配置，是否覆盖',
        );
        if (!overwrite) return;
        result = await this.host.saveUserTeamPlan(
          plan,
          true,
          currentFile,
          source,
        );
      }
      if (!result.success) {
        throw new Error(result.error || '保存失败');
      }
      this.currentFleet().name = plan.name;
      this.currentFleet().file = result.file ?? null;
      this.currentFleet().source = result.plan?.source ?? source;
      this.host.markDraftSaved(plan.name);
      showSaveSuccess(`舰队方案「${plan.name}」保存成功`);
    } catch (error) {
      await showAlert(
        '保存失败',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private async newTeamPlan(): Promise<void> {
    if (this.hasUnsavedFleetChanges()) {
      const confirmed = await showConfirm(
        '新建舰队预设',
        '当前舰队编队存在未保存修改，继续新建将丢失这些修改，是否继续？',
      );
      if (!confirmed) return;
    }
    this.host.replaceDraft(this.host.createDraft());
    this.presetNameInput.value = '';
    this.editorView.reset();
    this.host.markDraftSaved('');
    this.presetNameInput.focus();
  }

  private applyTeamPlan(plan: UserTeamPlan): void {
    const slots = plan.ships.map(slot => this.draftFromPlanSlot(slot));
    while (slots.length < FLEET_SLOT_COUNT) {
      slots.push(this.host.createSlotDraft());
    }
    this.host.replaceDraft({
      name: plan.name,
      file: plan.file ?? null,
      source: plan.source ?? 'user',
      slots: slots.slice(0, FLEET_SLOT_COUNT),
    });
    this.presetNameInput.value = plan.name;
    this.editorView.reset();
    this.host.markDraftSaved(plan.name);
  }

  private draftFromPlanSlot(slot: UserTeamPlanSlot): FleetSlotDraft {
    const primary = slot.name ? this.findPlanShip({
      name: slot.name,
      search_name: slot.search_name,
      ship_type: slot.ship_type,
      min_level: slot.min_level,
      max_level: slot.max_level,
    }) : null;
    const backups = (slot.candidates ?? []).map(candidate => (
      this.draftFromShipRule(candidate)
    ));
    return {
      primary,
      candidates: [
        ...backups,
        ...Array.from(
          { length: Math.max(0, DEFAULT_BACKUP_SLOT_COUNT - backups.length) },
          () => this.host.createCandidateDraft(),
        ),
      ],
      shipTypes: primary ? [...(slot.ship_type ?? [])] : [],
      levelEnabled: primary
        ? slot.min_level !== undefined || slot.max_level !== undefined
        : false,
      minLevel: primary ? slot.min_level ?? null : null,
      maxLevel: primary ? slot.max_level ?? null : null,
    };
  }

  private draftFromShipRule(rule: UserTeamShipRule): FleetCandidateDraft {
    return {
      ship: this.findPlanShip(rule),
      shipTypes: [...(rule.ship_type ?? [])],
      levelEnabled: rule.min_level !== undefined || rule.max_level !== undefined,
      minLevel: rule.min_level ?? null,
      maxLevel: rule.max_level ?? null,
    };
  }

  private findPlanShip(rule: UserTeamShipRule): ShipLibraryShip {
    const ships = this.galleryView.ships();
    const ship = ships.find(item => item.name === rule.name)
      ?? ships.find(item => item.search_name === rule.search_name);
    if (!ship) throw new Error(`舰船不存在: ${rule.name}`);
    return ship;
  }

  loadManagement(): Promise<void> {
    return this.planManagementView.load();
  }

}
