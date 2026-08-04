/** 持有普通舰队草稿并协调舰船库、规则编辑和计划管理。 */
import {
  fleetPlannerRepository,
} from '../../adapter/IpcAdapter';
import type {
  FleetPlannerRepository,
} from '../../adapter/IpcAdapter';
import {
  browserStorageStore,
} from '../../adapter/StorageAdapter';
import type {
  StorageStore,
} from '../../adapter/StorageAdapter';
import {
  cloneFleetRule,
  copyFleetRule,
  createFleetCandidateDraft,
  createFleetDraft,
  createFleetRuleDraft,
  createFleetSlotDraft,
  fleetDraftFromTeamPlan,
  fleetDraftSnapshot,
  fleetDraftToTeamPlan,
  hasFleetDraftChanges,
} from '../../model/fleet/FleetDraft';
import type {
  BackupFollowMode,
} from '../../model/fleet/FleetDraft';
import type {
  PlanPresetSource,
  ShipLibraryManifest,
  UserTeamPlan,
  UserTeamPlanSlot,
  UserTeamShipRule,
} from '../../types/ipc.js';
import type {
  FleetShipLibraryViewObject,
  TeamPlanListViewObject,
  TeamPlanShipRuleViewObject,
  TeamPlanSlotViewObject,
  TeamPlanViewObject,
} from '../../types/view.js';
import {
  FleetPlannerView,
} from '../../view/plan/FleetPlannerView';
import type {
  PlanManagementTaskGroup,
} from '../../view/plan/PlanManagementView';

const REFIT_FILTER_STORAGE_KEY = 'fleetPlannerRefitFilter';
const BACKUP_FOLLOW_MODE_STORAGE_KEY = 'fleetPlannerBackupFollowMode';

export class FleetPlannerController {
  private draft = createFleetDraft();
  private savedDraftSnapshot = fleetDraftSnapshot(this.draft);
  private readonly view: FleetPlannerView;
  private readonly teamPlans = new Map<string, UserTeamPlan>();
  private readonly teamPlanIds = new Map<string, string>();
  private shipLibrary: FleetShipLibraryViewObject | null = null;
  private shipLibraryLoading: Promise<void> | null = null;
  private nextTeamPlanId = 1;

  constructor(
    private readonly repository: FleetPlannerRepository
      = fleetPlannerRepository,
    private readonly storage: StorageStore = browserStorageStore,
  ) {
    this.view = new FleetPlannerView({
      loadShipLibrary: force => this.loadShipLibrary(force),
      loadTeamPlans: () => this.loadTeamPlans(),
      saveTeamPlan: name => this.saveTeamPlan(name),
      applyTeamPlan: planId => this.applyTeamPlan(planId),
      loadPlanManagement: () => repository.getPlanManagement(),
      exportUserPlans: selections => (
        repository.exportUserPlans(selections)
      ),
      setPlanUnlinkedIgnored: (kind, source, file, ignored) => (
        repository.setPlanUnlinkedIgnored(
          kind,
          source,
          file,
          ignored,
        )
      ),
      renameUserCombatPlan: (file, newName) => (
        repository.renameUserCombatPlan(file, newName)
      ),
      deleteUserCombatPlan: file => (
        repository.deleteUserCombatPlan(file)
      ),
      deleteUserTeamPlan: file => repository.deleteUserTeamPlan(file),
      openTeamPlan: (file, source) => this.openTeamPlan(file, source),
      getRefitFilter: () => (
        storage.get(REFIT_FILTER_STORAGE_KEY) === 'true'
      ),
      setRefitFilter: enabled => (
        storage.set(REFIT_FILTER_STORAGE_KEY, String(enabled))
      ),
      getBackupFollowMode: (): BackupFollowMode => (
        storage.get(BACKUP_FOLLOW_MODE_STORAGE_KEY) === 'position'
          ? 'position'
          : 'ship'
      ),
      setBackupFollowMode: mode => (
        storage.set(BACKUP_FOLLOW_MODE_STORAGE_KEY, mode)
      ),
      currentDraft: () => this.draft,
      setDraftName: name => {
        this.draft.name = name;
      },
      resetDraft: () => this.resetDraft(),
      createRuleDraft: () => createFleetRuleDraft(),
      createCandidateDraft: ship => createFleetCandidateDraft(ship),
      createSlotDraft: () => createFleetSlotDraft(),
      cloneRule: source => cloneFleetRule(source),
      copyRule: (target, source) => copyFleetRule(target, source),
      hasUnsavedDraftChanges: name => hasFleetDraftChanges(
        {
          ...this.draft,
          name,
        },
        this.savedDraftSnapshot,
      ),
    });
  }

  set onOpenBattlePlan(
    handler: (
      (file: string, source: PlanPresetSource) => Promise<void>
    ) | null,
  ) {
    this.view.onOpenBattlePlan = handler;
  }

  setTaskGroupsProvider(
    provider: () => ReadonlyArray<PlanManagementTaskGroup>,
  ): void {
    this.view.setTaskGroupsProvider(provider);
  }

  load(force = false): Promise<void> {
    return this.loadShipLibrary(force);
  }

  loadManagement(): Promise<void> {
    return this.view.loadManagement();
  }

  private loadShipLibrary(force: boolean): Promise<void> {
    if (this.shipLibraryLoading) return this.shipLibraryLoading;
    if (this.shipLibrary && !force) {
      this.view.showShipLibrary(this.shipLibrary);
      return Promise.resolve();
    }

    this.view.showShipLibraryLoading();
    this.shipLibraryLoading = this.repository.getShipLibraryManifest()
      .then(manifest => {
        this.shipLibrary = this.toShipLibraryViewObject(manifest);
        this.view.showShipLibrary(this.shipLibrary);
      })
      .catch(error => {
        this.view.showShipLibraryError(
          error instanceof Error ? error.message : String(error),
        );
      })
      .finally(() => {
        this.shipLibraryLoading = null;
      });
    return this.shipLibraryLoading;
  }

  private toShipLibraryViewObject(
    manifest: ShipLibraryManifest,
  ): FleetShipLibraryViewObject {
    const ships = manifest.ships.filter(ship => (
      Number.isFinite(ship.id)
      && Boolean(ship.name)
      && Boolean(ship.portraitUrl)
    ));
    return {
      labels: manifest.labels,
      ships,
      colorfulBackgroundUrl: ships.find(
        ship => ship.rarity === 6 && Boolean(ship.backgroundUrl),
      )?.backgroundUrl ?? '',
    };
  }

  private async loadTeamPlans(): Promise<TeamPlanListViewObject> {
    const result = await this.repository.listTeamPlans();
    this.teamPlans.clear();
    const plans = result.plans.map((plan, index) => {
      const source = plan.source ?? 'user';
      const identity = this.teamPlanIdentity(
        source,
        plan.file ?? `missing-${index}-${plan.name}`,
      );
      let id = this.teamPlanIds.get(identity);
      if (!id) {
        id = `team-plan-${this.nextTeamPlanId}`;
        this.nextTeamPlanId += 1;
        this.teamPlanIds.set(identity, id);
      }
      this.teamPlans.set(id, plan);
      return this.toTeamPlanViewObject(id, plan, source);
    });
    return {
      plans,
      errorCount: result.errors.length,
    };
  }

  private toTeamPlanViewObject(
    id: string,
    plan: UserTeamPlan,
    source: PlanPresetSource,
  ): TeamPlanViewObject {
    return {
      id,
      name: plan.name,
      source,
      modifiedAt: plan.modifiedAt,
      selected: Boolean(
        plan.file
        && this.draft.file
        && source === this.draft.source
        && this.teamPlanIdentity(source, plan.file)
          === this.teamPlanIdentity(this.draft.source, this.draft.file),
      ),
      ships: plan.ships.map(slot => this.toTeamPlanSlotViewObject(slot)),
    };
  }

  private toTeamPlanSlotViewObject(
    slot: UserTeamPlanSlot,
  ): TeamPlanSlotViewObject {
    const primary = slot.name
      ? this.toTeamPlanRuleViewObject({
          name: slot.name,
          search_name: slot.search_name,
          ship_type: slot.ship_type,
          min_level: slot.min_level,
          max_level: slot.max_level,
        })
      : undefined;
    return {
      primary,
      candidates: (slot.candidates ?? []).map(
        candidate => this.toTeamPlanRuleViewObject(candidate),
      ),
    };
  }

  private toTeamPlanRuleViewObject(
    rule: UserTeamShipRule,
  ): TeamPlanShipRuleViewObject {
    return {
      name: rule.name,
      searchName: rule.search_name,
      shipTypes: [...(rule.ship_type ?? [])],
      minLevel: rule.min_level,
      maxLevel: rule.max_level,
    };
  }

  private async saveTeamPlan(rawName: string): Promise<void> {
    try {
      const plan = fleetDraftToTeamPlan(this.draft, rawName);
      const currentFile = this.draft.file ?? undefined;
      const currentSource = this.draft.source;
      let result = await this.repository.saveUserTeamPlan(
        plan,
        false,
        currentFile,
        currentSource,
      );
      if (result.exists) {
        if (!await this.view.confirmTeamPlanOverwrite()) return;
        result = await this.repository.saveUserTeamPlan(
          plan,
          true,
          currentFile,
          currentSource,
        );
      }
      if (!result.success) {
        throw new Error(result.error || '保存失败');
      }

      this.draft.name = plan.name;
      this.draft.file = result.file ?? result.plan?.file ?? null;
      this.draft.source = result.plan?.source ?? 'user';
      this.savedDraftSnapshot = fleetDraftSnapshot(this.draft);
      this.view.showDraftName(plan.name);
      this.view.showTeamPlanSaved(plan.name);
    } catch (error) {
      await this.view.showTeamPlanSaveError(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private async applyTeamPlan(
    planId: string,
  ): Promise<{ success: boolean; error?: string }> {
    const plan = this.teamPlans.get(planId);
    if (!plan) {
      return {
        success: false,
        error: '未找到对应的舰队方案',
      };
    }
    try {
      this.draft = fleetDraftFromTeamPlan(
        plan,
        this.shipLibrary?.ships ?? [],
      );
      this.savedDraftSnapshot = fleetDraftSnapshot(this.draft);
      this.view.showDraft(this.draft.name);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async openTeamPlan(
    file: string,
    source: PlanPresetSource,
  ): Promise<void> {
    await this.loadShipLibrary(false);
    await this.loadTeamPlans();
    const id = this.teamPlanIds.get(this.teamPlanIdentity(source, file));
    if (!id || !this.teamPlans.has(id)) {
      await this.view.showTeamPlanLoadError('未找到对应的舰队方案');
      return;
    }
    await this.view.openTeamPlan(id);
  }

  private resetDraft(): void {
    this.draft = createFleetDraft();
    this.savedDraftSnapshot = fleetDraftSnapshot(this.draft);
  }

  private teamPlanIdentity(
    source: PlanPresetSource,
    file: string,
  ): string {
    return `${source}:${file.trim().toLocaleLowerCase('en-US')}`;
  }
}
