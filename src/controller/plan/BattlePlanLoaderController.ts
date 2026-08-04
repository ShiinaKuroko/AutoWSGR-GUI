/** 管理受管作战方案选择器的加载、筛选、选择和结果返回流程。 */
import type {
  ManagedBattlePlan,
  ManagedBattlePlanSelection,
  ManagedTeamPlan,
  PlanPresetSource,
  PlanTeamBinding,
} from '../../types/ipc.js';
import {
  BattlePlanLoaderView,
  type BattlePlanLoaderPurpose,
  type BattlePlanSortField,
} from '../../view/plan/BattlePlanLoaderView';
import { Logger } from '../../utils/Logger';
import {
  showAlert,
  showSaveSuccess,
} from '../shared/DialogHelper';

export interface BattlePlanLoaderHost {
  getCurrentPlanIdentity(): {
    file: string | null;
    source: PlanPresetSource;
  };
  openManagedPlan(file: string, source: PlanPresetSource): Promise<boolean>;
}

export class BattlePlanLoaderController {
  private plans: ManagedBattlePlan[] = [];
  private selectedPlan: ManagedBattlePlan | null = null;
  private selectedFleetIndex: number | null = null;
  private sortField: BattlePlanSortField = 'modifiedAt';
  private purpose: BattlePlanLoaderPurpose = 'editor';
  private resolveSelection: (
    (selection: ManagedBattlePlanSelection | null) => void
  ) | null = null;

  constructor(
    private readonly view: BattlePlanLoaderView,
    private readonly host: BattlePlanLoaderHost,
  ) {}

  bindActions(): void {
    this.view.bindActions({
      onCancel: () => this.close(),
      onImportLocal: () => void this.importLocal(),
      onRefresh: () => void this.refresh(),
      onFiltersChange: () => this.render(),
      onSortFieldChange: (field) => {
        this.sortField = field;
        this.view.setSortField(field);
        this.render();
      },
      onSelectPlan: (file, source) => this.selectPlan(file, source),
      onSelectFleet: (index) => this.selectFleet(index),
      onConfirm: () => void this.confirm(),
    });
    this.view.setSortField(this.sortField);
  }

  openForEditor(): Promise<void> {
    this.finishSelection(null);
    this.purpose = 'editor';
    this.selectedFleetIndex = null;
    this.prepareAndOpen();
    return this.refresh().then(() => this.view.focusSearch());
  }

  pick(
    purpose: Exclude<BattlePlanLoaderPurpose, 'editor'>,
  ): Promise<ManagedBattlePlanSelection | null> {
    this.finishSelection(null);
    this.purpose = purpose;
    this.selectedFleetIndex = null;
    this.prepareAndOpen();
    void this.refresh().then(() => this.view.focusSearch());
    return new Promise((resolve) => {
      this.resolveSelection = resolve;
    });
  }

  private prepareAndOpen(): void {
    this.view.setPurposeCopy(this.purpose);
    this.view.resetSearch();
    this.view.open();
  }

  private close(): void {
    this.view.close();
    this.finishSelection(null);
    this.selectedFleetIndex = null;
    this.purpose = 'editor';
    this.view.setPurposeCopy(this.purpose);
  }

  private finishSelection(
    selection: ManagedBattlePlanSelection | null,
  ): void {
    const resolve = this.resolveSelection;
    this.resolveSelection = null;
    resolve?.(selection);
  }

  private async importLocal(): Promise<void> {
    const bridge = window.electronBridge;
    if (!bridge?.importLocalCombatPlan) {
      await showAlert('导入失败', '请完整重启 GUI 后再操作');
      return;
    }
    this.view.setImportLoading(true);
    try {
      const result = await bridge.importLocalCombatPlan();
      if (result.canceled) return;
      if (!result.success || !result.file) {
        throw new Error(result.error || '本地 YAML 导入失败');
      }

      await this.refresh();
      const imported = this.plans.find(plan => (
        plan.source === 'user' && plan.file === result.file
      ));
      if (imported) this.selectPlan(imported.file, imported.source);
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
      this.view.setImportLoading(false);
    }
  }

  private async refresh(): Promise<void> {
    const bridge = window.electronBridge;
    if (!bridge?.getPlanManagement) {
      this.view.setStatus('请完整重启 GUI 后再操作');
      return;
    }
    this.view.setStatus('正在读取作战计划...');
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
      this.plans = compatibilityMode
        ? this.plansFromBindings(result.bindings, result.teamPlans)
        : detailedPlans;
      const visiblePlans = this.visiblePlans();
      const current = this.host.getCurrentPlanIdentity();
      this.selectedPlan = visiblePlans.find(plan => (
        Boolean(current.file)
        && plan.file === current.file
        && plan.source === current.source
      )) ?? visiblePlans[0] ?? null;
      this.resetFleetSelection(this.selectedPlan);
      this.view.setCount(this.plans.length);
      const errorCount = result.errors.filter(
        error => error.kind === 'battle',
      ).length;
      const message = compatibilityMode
        ? '当前主进程未更新，已显示基础列表；完整重启 GUI 后显示计划摘要'
        : errorCount > 0
          ? `${errorCount} 个 YAML 无法读取，已从列表中排除`
          : '';
      this.view.setStatus(message);
      this.render();
    } catch (error) {
      this.plans = [];
      this.selectedPlan = null;
      this.selectedFleetIndex = null;
      this.view.setStatus(
        `读取失败：${error instanceof Error ? error.message : String(error)}`,
      );
      this.render();
    }
  }

  private plansFromBindings(
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

  private visiblePlans(): ManagedBattlePlan[] {
    const filters = this.view.getFilters();
    const direction = filters.ascending ? 1 : -1;
    return this.plans
      .filter(plan => (
        this.purpose !== 'automation'
        || plan.kind === 'battle'
      ))
      .filter(plan => !filters.excludeSystem || plan.source !== 'system')
      .filter((plan) => {
        if (!filters.keyword) return true;
        return [
          plan.name,
          plan.file,
          String(plan.chapter),
          String(plan.map),
          `${plan.chapter}-${plan.map}`,
          plan.taskType ?? '',
          plan.campaignName ?? '',
        ].some(value => (
          value.toLocaleLowerCase('zh-CN').includes(filters.keyword)
        ));
      })
      .sort((left, right) => {
        const result = this.sortField === 'name'
          ? left.name.localeCompare(right.name, 'zh-CN')
          : left.modifiedAt - right.modifiedAt;
        return (
          result || left.name.localeCompare(right.name, 'zh-CN')
        ) * direction;
      });
  }

  private render(): void {
    const visiblePlans = this.visiblePlans();
    const previousSelection = this.selectedPlan;
    if (
      !this.selectedPlan
      || !visiblePlans.some(plan => (
        this.samePlan(plan, this.selectedPlan)
      ))
    ) {
      this.selectedPlan = visiblePlans[0] ?? null;
    }
    if (!this.samePlan(this.selectedPlan, previousSelection)) {
      this.resetFleetSelection(this.selectedPlan);
    }
    this.view.render({
      plans: visiblePlans,
      totalPlanCount: this.plans.length,
      selectedPlan: this.selectedPlan,
      selectedFleetIndex: this.selectedFleetIndex,
      purpose: this.purpose,
    });
  }

  private selectPlan(file: string, source: PlanPresetSource): void {
    const selected = this.plans.find(plan => (
      plan.file === file && plan.source === source
    ));
    if (!selected) return;
    if (!this.samePlan(selected, this.selectedPlan)) {
      this.resetFleetSelection(selected);
    }
    this.selectedPlan = selected;
    this.render();
  }

  private resetFleetSelection(plan: ManagedBattlePlan | null): void {
    this.selectedFleetIndex = (
      this.isPickingWithFleet()
      && plan?.kind === 'battle'
      && plan.fleets.length === 1
    ) ? 0 : null;
  }

  private selectFleet(index: number): void {
    if (
      !this.isPickingWithFleet()
      || !this.selectedPlan?.fleets[index]
    ) {
      return;
    }
    this.selectedFleetIndex = index;
    this.render();
  }

  private async confirm(): Promise<void> {
    if (!this.selectedPlan) return;
    if (this.isPickingWithFleet()) {
      if (
        this.requiresFleetSelection(this.selectedPlan)
        && this.selectedFleetIndex === null
      ) {
        return;
      }
      this.finishSelection({
        plan: this.selectedPlan,
        ...(this.selectedFleetIndex === null
          ? {}
          : { fleetPresetIndex: this.selectedFleetIndex }),
      });
      this.close();
      return;
    }
    const { file, source } = this.selectedPlan;
    const loaded = await this.host.openManagedPlan(file, source);
    if (loaded) this.close();
  }

  private isPickingWithFleet(): boolean {
    return (
      this.purpose === 'queue'
      || this.purpose === 'task-list'
      || this.purpose === 'automation'
    );
  }

  private requiresFleetSelection(plan: ManagedBattlePlan): boolean {
    if (plan.kind === 'preset') return false;
    return (
      this.purpose === 'automation'
      || (
        this.isPickingWithFleet()
        && plan.fleets.length > 0
      )
    );
  }

  private samePlan(
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
}
