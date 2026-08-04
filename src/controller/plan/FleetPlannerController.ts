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
  fleetDraftSnapshot,
  hasFleetDraftChanges,
} from '../../model/fleet/FleetDraft';
import type {
  PlanPresetSource,
} from '../../types/ipc.js';
import {
  FleetPlannerView,
} from '../../view/plan/FleetPlannerView';
import type {
  PlanManagementTaskGroup,
} from '../../view/plan/PlanManagementView';

const REFIT_FILTER_STORAGE_KEY = 'fleetPlannerRefitFilter';

export class FleetPlannerController {
  private draft = createFleetDraft();
  private savedDraftSnapshot = fleetDraftSnapshot(this.draft);
  private readonly view: FleetPlannerView;

  constructor(
    repository: FleetPlannerRepository = fleetPlannerRepository,
    storage: StorageStore = browserStorageStore,
  ) {
    this.view = new FleetPlannerView({
      getShipLibraryManifest: () => (
        repository.getShipLibraryManifest()
      ),
      saveUserTeamPlan: (plan, overwrite, currentFile, source) => (
        repository.saveUserTeamPlan(
          plan,
          overwrite,
          currentFile,
          source,
        )
      ),
      listTeamPlans: () => repository.listTeamPlans(),
      getPlanManagement: () => repository.getPlanManagement(),
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
      getRefitFilter: () => (
        storage.get(REFIT_FILTER_STORAGE_KEY) === 'true'
      ),
      setRefitFilter: enabled => (
        storage.set(REFIT_FILTER_STORAGE_KEY, String(enabled))
      ),
      currentDraft: () => this.draft,
      replaceDraft: draft => {
        this.draft = draft;
      },
      createRuleDraft: () => createFleetRuleDraft(),
      createCandidateDraft: ship => createFleetCandidateDraft(ship),
      createSlotDraft: () => createFleetSlotDraft(),
      createDraft: () => createFleetDraft(),
      cloneRule: source => cloneFleetRule(source),
      copyRule: (target, source) => copyFleetRule(target, source),
      markDraftSaved: name => {
        this.draft.name = name;
        this.savedDraftSnapshot = fleetDraftSnapshot(this.draft);
      },
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
    return this.view.load(force);
  }

  loadManagement(): Promise<void> {
    return this.view.loadManagement();
  }
}
