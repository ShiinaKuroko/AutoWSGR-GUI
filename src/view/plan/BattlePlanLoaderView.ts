/** 渲染受管作战方案选择器，并收集搜索、筛选和舰队选择操作。 */
import type {
  ManagedBattlePlan,
  PlanPresetSource,
} from '../../types/ipc.js';
import { appendTeamPlanCardContent } from './TeamPlanListUi';

export type BattlePlanLoaderPurpose =
  'editor' | 'queue' | 'task-list' | 'automation';

export type BattlePlanSortField = 'name' | 'modifiedAt';

export interface BattlePlanLoaderCallbacks {
  onCancel(): void;
  onImportLocal(): void;
  onRefresh(): void;
  onFiltersChange(): void;
  onSortFieldChange(field: BattlePlanSortField): void;
  onSelectPlan(file: string, source: PlanPresetSource): void;
  onSelectFleet(index: number): void;
  onConfirm(): void;
}

export interface BattlePlanLoaderFilters {
  keyword: string;
  excludeSystem: boolean;
  ascending: boolean;
}

export interface BattlePlanLoaderViewObject {
  plans: ManagedBattlePlan[];
  totalPlanCount: number;
  selectedPlan: ManagedBattlePlan | null;
  selectedFleetIndex: number | null;
  purpose: BattlePlanLoaderPurpose;
}

export class BattlePlanLoaderView {
  private callbacks: BattlePlanLoaderCallbacks | null = null;

  bindActions(callbacks: BattlePlanLoaderCallbacks): void {
    this.callbacks = callbacks;
    const dialog = document.getElementById('battle-plan-loader');
    document.getElementById('btn-cancel-battle-plan-loader')?.addEventListener(
      'click',
      () => callbacks.onCancel(),
    );
    document.getElementById('btn-import-local-battle-plan')?.addEventListener(
      'click',
      () => callbacks.onImportLocal(),
    );
    document.getElementById('btn-refresh-battle-plan-loader')?.addEventListener(
      'click',
      () => callbacks.onRefresh(),
    );
    document.getElementById('battle-plan-loader-search')?.addEventListener(
      'input',
      () => callbacks.onFiltersChange(),
    );
    document.getElementById('battle-plan-loader-filter-system')?.addEventListener(
      'change',
      () => callbacks.onFiltersChange(),
    );
    document.getElementById('battle-plan-loader-sort-asc')?.addEventListener(
      'change',
      () => callbacks.onFiltersChange(),
    );
    document.querySelectorAll<HTMLElement>(
      '[data-battle-plan-sort-field]',
    ).forEach((button) => {
      button.addEventListener('click', () => {
        callbacks.onSortFieldChange(
          button.dataset['battlePlanSortField'] === 'name'
            ? 'name'
            : 'modifiedAt',
        );
      });
    });
    document.getElementById('battle-plan-loader-list')?.addEventListener(
      'click',
      (event) => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
          '[data-battle-plan-file]',
        );
        const file = button?.dataset['battlePlanFile'];
        const source = button?.dataset['battlePlanSource'];
        if (
          file
          && (source === 'system' || source === 'user')
        ) {
          callbacks.onSelectPlan(file, source);
        }
      },
    );
    document.getElementById('btn-confirm-battle-plan-loader')?.addEventListener(
      'click',
      () => callbacks.onConfirm(),
    );
    dialog?.addEventListener('click', (event) => {
      if (event.target === dialog) callbacks.onCancel();
    });
  }

  open(): void {
    const dialog = document.getElementById('battle-plan-loader');
    if (dialog) dialog.style.display = 'flex';
  }

  close(): void {
    const dialog = document.getElementById('battle-plan-loader');
    if (dialog) dialog.style.display = 'none';
  }

  resetSearch(): void {
    const searchInput = document.getElementById(
      'battle-plan-loader-search',
    ) as HTMLInputElement | null;
    if (searchInput) searchInput.value = '';
  }

  focusSearch(): void {
    const searchInput = document.getElementById(
      'battle-plan-loader-search',
    ) as HTMLInputElement | null;
    searchInput?.focus();
  }

  getFilters(): BattlePlanLoaderFilters {
    const searchInput = document.getElementById(
      'battle-plan-loader-search',
    ) as HTMLInputElement | null;
    const filterSystem = document.getElementById(
      'battle-plan-loader-filter-system',
    ) as HTMLInputElement | null;
    const sortAsc = document.getElementById(
      'battle-plan-loader-sort-asc',
    ) as HTMLInputElement | null;
    return {
      keyword: (searchInput?.value ?? '').trim().toLocaleLowerCase('zh-CN'),
      excludeSystem: filterSystem?.checked ?? false,
      ascending: sortAsc?.checked ?? false,
    };
  }

  setSortField(field: BattlePlanSortField): void {
    document.querySelectorAll<HTMLElement>(
      '[data-battle-plan-sort-field]',
    ).forEach((item) => {
      item.classList.toggle(
        'active',
        item.dataset['battlePlanSortField'] === field,
      );
    });
  }

  setPurposeCopy(purpose: BattlePlanLoaderPurpose): void {
    const pickingForQueue = purpose === 'queue';
    const pickingForTaskList = purpose === 'task-list';
    const pickingForAutomation = purpose === 'automation';
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

  setStatus(message: string): void {
    const status = document.getElementById('battle-plan-loader-status');
    if (!status) return;
    status.textContent = message;
    status.hidden = !message;
  }

  setCount(count: number): void {
    const element = document.getElementById('battle-plan-loader-count');
    if (element) element.textContent = `共读取 ${count} 个作战配置`;
  }

  setImportLoading(loading: boolean): void {
    const button = document.getElementById(
      'btn-import-local-battle-plan',
    ) as HTMLButtonElement | null;
    if (button) button.disabled = loading;
  }

  render(vo: BattlePlanLoaderViewObject): void {
    const list = document.getElementById('battle-plan-loader-list');
    if (!list) return;
    list.replaceChildren();
    if (vo.plans.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'fleet-team-loader-preview-empty';
      empty.textContent = vo.totalPlanCount === 0
        ? '未读取到合法的作战配置'
        : '没有符合当前条件的作战配置';
      list.append(empty);
      this.clearSelection();
      return;
    }

    vo.plans.forEach((plan) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'fleet-team-loader-item battle-plan-loader-item';
      button.dataset['battlePlanFile'] = plan.file;
      button.dataset['battlePlanSource'] = plan.source;
      button.classList.toggle(
        'active',
        this.sameBattlePlan(plan, vo.selectedPlan),
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
    if (vo.selectedPlan) {
      this.renderPreview(
        vo.selectedPlan,
        vo.selectedFleetIndex,
        vo.purpose,
      );
    }
  }

  private renderPreview(
    plan: ManagedBattlePlan,
    selectedFleetIndex: number | null,
    purpose: BattlePlanLoaderPurpose,
  ): void {
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
          this.createPreviewField('任务类型', this.taskPresetTypeLabel(plan)),
          this.createPreviewField('执行次数', `${plan.times} 次`),
          this.createPreviewField(
            '任务参数',
            this.taskPresetParameterLabel(plan),
            true,
          ),
          this.createPreviewField(
            '完整配置',
            '加载后可在任务预设页面查看',
            true,
          ),
        );
      } else {
        body.replaceChildren(
          this.createPreviewField('章节关卡', this.battlePlanMapLabel(plan)),
          this.createPreviewField(
            '执行次数',
            hasDetails ? `${plan.times} 次` : '重启后显示',
          ),
          this.createPreviewField(
            '维修方案',
            hasDetails
              ? `${this.battlePlanRepairLabel(plan.repairMode)}-${this.repairMethodLabel()}`
              : '重启后显示',
          ),
          this.createPreviewField(
            '终点战果判断',
            hasDetails ? this.battlePlanResultLabel(plan.result) : '重启后显示',
          ),
          this.createFleetPreview(
            plan,
            hasDetails,
            selectedFleetIndex,
            purpose,
          ),
          this.createStopPreview(plan, hasDetails),
        );
      }
    }
    if (confirmButton) {
      confirmButton.disabled = (
        this.requiresFleetSelection(plan, purpose)
        && selectedFleetIndex === null
      );
    }
  }

  private createPreviewField(
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

  private createFleetPreview(
    plan: ManagedBattlePlan,
    hasDetails: boolean,
    selectedFleetIndex: number | null,
    purpose: BattlePlanLoaderPurpose,
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
      empty.textContent = purpose === 'automation'
        ? '没有可选择的编队，无法用于自动出征'
        : this.isPickingWithFleet(purpose)
          ? '未配置编队预设，将使用 YAML 的舰队编号和游戏当前编成'
          : '未配置编队预设';
      list.append(empty);
    } else {
      const selectable = this.isPickingWithFleet(purpose);
      plan.fleets.forEach((fleet, index) => {
        const card = document.createElement(selectable ? 'button' : 'div');
        if (card instanceof HTMLButtonElement) card.type = 'button';
        card.className = 'fleet-team-loader-item battle-plan-preview-fleet-card';
        card.classList.toggle('selectable', selectable);
        card.classList.toggle(
          'active',
          selectable && selectedFleetIndex === index,
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
          state.textContent = selectedFleetIndex === index
            ? '已选择'
            : '点击选择';
          card.append(state);
          card.setAttribute(
            'aria-pressed',
            String(selectedFleetIndex === index),
          );
          card.addEventListener(
            'click',
            () => this.callbacks?.onSelectFleet(index),
          );
        }
        list.append(card);
      });
    }
    section.append(heading, list);
    return section;
  }

  private createStopPreview(
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

  private clearSelection(): void {
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

  private isPickingWithFleet(purpose: BattlePlanLoaderPurpose): boolean {
    return (
      purpose === 'queue'
      || purpose === 'task-list'
      || purpose === 'automation'
    );
  }

  private requiresFleetSelection(
    plan: ManagedBattlePlan,
    purpose: BattlePlanLoaderPurpose,
  ): boolean {
    if (plan.kind === 'preset') return false;
    return (
      purpose === 'automation'
      || (
        this.isPickingWithFleet(purpose)
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

  private repairMethodLabel(): string {
    const method = document.getElementById(
      'plan-edit-repair-method',
    ) as HTMLSelectElement | null;
    return method?.value === 'bath' ? '泡澡维修' : '快速维修';
  }

  private battlePlanResultLabel(result: ManagedBattlePlan['result']): string {
    if (!result) return '不判断';
    return result === 'SS' ? result : `${result}及以上`;
  }
}
