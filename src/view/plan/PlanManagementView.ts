/** 渲染本地方案列表并发出导入、导出、重命名和删除意图。 */
import type {
  ElectronBridge,
  ManagedTeamPlan,
  PlanFileReadError,
  PlanPresetSource,
  PlanTeamBinding,
  UserPlanExportSelection,
} from '../../types/ipc.js';
import {
  showAlert,
  showConfirm,
  showPrompt,
  showSaveSuccess,
} from '../../controller/shared/DialogHelper';
import {
  captureScrollPosition,
  restoreScrollPosition,
} from '../shared/scrollPosition';

type ManagementSource = PlanPresetSource | 'all';
type ManagementKind = 'battle' | 'team' | 'all';

export interface PlanManagementTaskGroup {
  name: string;
  items: ReadonlyArray<{
    kind: string;
    path?: string;
    managedSource?: PlanPresetSource;
    managedFile?: string;
  }>;
}

export interface PlanManagementViewHost extends Pick<
  ElectronBridge,
  | 'getPlanManagement'
  | 'exportUserPlans'
  | 'setPlanUnlinkedIgnored'
  | 'renameUserCombatPlan'
  | 'deleteUserCombatPlan'
  | 'deleteUserTeamPlan'
> {
  taskGroups(): ReadonlyArray<PlanManagementTaskGroup>;
  openBattlePlan(file: string, source: PlanPresetSource): Promise<void>;
  openTeamPlan(file: string, source: PlanPresetSource): Promise<void>;
}

interface ManagementRow {
  kind: 'battle' | 'team';
  source: PlanPresetSource;
  name: string;
  file: string;
  relations: string[];
  taskGroups: string[];
  missingRelations: Set<string>;
  status: string;
  statusClass: 'ok' | 'warning' | 'muted';
  attention: boolean;
  ignoredUnlinked?: boolean;
  invalid?: boolean;
  errorMessage?: string;
}

export class PlanManagementView {
  private readonly body = document.getElementById(
    'plan-team-management-body',
  ) as HTMLTableSectionElement | null;
  private readonly tabs = Array.from(
    document.querySelectorAll<HTMLButtonElement>(
      '[data-plan-management-source]',
    ),
  );
  private readonly kindButtons = Array.from(
    document.querySelectorAll<HTMLButtonElement>(
      '[data-plan-management-kind]',
    ),
  );
  private readonly search = document.getElementById(
    'plan-management-search',
  ) as HTMLInputElement | null;
  private readonly attentionOnly = document.getElementById(
    'plan-management-attention-only',
  ) as HTMLInputElement | null;
  private readonly selectAll = document.getElementById(
    'plan-management-select-all',
  ) as HTMLInputElement | null;
  private readonly exportButton = document.getElementById(
    'btn-export-user-plans',
  ) as HTMLButtonElement | null;

  private source: ManagementSource = 'all';
  private kind: ManagementKind = 'all';
  private query = '';
  private errors: PlanFileReadError[] = [];
  private ignoredUnlinkedPlans = new Set<string>();
  private bindings: PlanTeamBinding[] = [];
  private teamPlans: ManagedTeamPlan[] = [];
  private selections = new Map<string, UserPlanExportSelection>();
  private visibleSelections: UserPlanExportSelection[] = [];
  private exporting = false;

  constructor(private readonly host: PlanManagementViewHost) {
    this.bindActions();
  }

  async load(): Promise<void> {
    if (!this.body) return;
    this.body.innerHTML = '<tr><td colspan="7">正在读取计划…</td></tr>';
    try {
      const result = await this.host.getPlanManagement();
      this.bindings = result.bindings;
      this.teamPlans = result.teamPlans;
      this.errors = result.errors;
      this.ignoredUnlinkedPlans = new Set(result.ignoredUnlinkedPlans);
      this.render();
    } catch (error) {
      this.body.innerHTML = '';
      const row = this.body.insertRow();
      const cell = row.insertCell();
      cell.colSpan = 7;
      cell.className = 'plan-management-empty';
      cell.textContent = error instanceof Error
        ? error.message
        : String(error);
    }
  }

  private bindActions(): void {
    document.getElementById('btn-refresh-plan-management')
      ?.addEventListener('click', () => {
        void this.load();
      });
    this.exportButton?.addEventListener('click', () => {
      void this.exportSelectedPlans();
    });
    this.selectAll?.addEventListener('change', () => {
      const selected = this.selectAll?.checked === true;
      this.visibleSelections.forEach(selection => {
        const key = this.selectionKey(selection);
        if (selected) {
          this.selections.set(key, selection);
        } else {
          this.selections.delete(key);
        }
      });
      this.render();
    });
    this.tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const source = tab.dataset['planManagementSource'];
        if (source !== 'all' && source !== 'system' && source !== 'user') {
          return;
        }
        this.source = source;
        this.render();
      });
    });
    this.kindButtons.forEach(button => {
      button.addEventListener('click', () => {
        const kind = button.dataset['planManagementKind'];
        if (kind !== 'all' && kind !== 'battle' && kind !== 'team') return;
        this.kind = kind;
        this.render();
      });
    });
    this.search?.addEventListener('input', () => {
      this.query = this.search?.value.trim() ?? '';
      this.render();
    });
    this.attentionOnly?.addEventListener('change', () => {
      this.render();
    });
    this.body?.addEventListener('change', event => {
      const checkbox = (event.target as HTMLElement)
        .closest<HTMLInputElement>('[data-plan-selection]');
      if (!checkbox) return;
      const kind = checkbox.dataset['planKind'];
      const file = checkbox.dataset['planFile'];
      if ((kind !== 'battle' && kind !== 'team') || !file) return;
      const selection: UserPlanExportSelection = { kind, file };
      const key = this.selectionKey(selection);
      if (checkbox.checked) {
        this.selections.set(key, selection);
      } else {
        this.selections.delete(key);
      }
      this.updateSelectionControls();
    });
    this.body?.addEventListener('click', event => {
      const button = (event.target as HTMLElement)
        .closest<HTMLButtonElement>('[data-plan-operation]');
      if (!button) return;
      const file = button.dataset['planFile'];
      if (!file) return;
      const operation = button.dataset['planOperation'];
      if (operation === 'rename') {
        void this.renameCombatPlan(file);
      } else if (operation === 'delete') {
        void this.deleteCombatPlan(file);
      } else if (operation === 'edit-battle') {
        const source = button.dataset['planSource'] === 'system'
          ? 'system'
          : 'user';
        void this.host.openBattlePlan(file, source);
      } else if (operation === 'edit-team') {
        const source = button.dataset['planSource'] === 'system'
          ? 'system'
          : 'user';
        void this.host.openTeamPlan(file, source);
      } else if (operation === 'delete-team') {
        void this.deleteTeamPlan(file, button.dataset['planName'] ?? '');
      } else if (operation === 'toggle-unlinked') {
        const kind = button.dataset['planKind'] === 'team'
          ? 'team'
          : 'battle';
        const source = button.dataset['planSource'] === 'system'
          ? 'system'
          : 'user';
        void this.toggleUnlinkedIgnored(
          kind,
          file,
          source,
          button.dataset['planIgnored'] !== 'true',
        );
      }
    });
  }

  private render(): void {
    if (!this.body) return;
    const scroll = this.body.closest<HTMLElement>(
      '.plan-team-management-table-wrap',
    );
    const scrollPosition = captureScrollPosition(scroll);
    this.renderActiveFilters();

    const planKey = (
      source: PlanPresetSource,
      file: string,
    ): string => (
      `${source}:${file.trim().toLocaleLowerCase('zh-CN')}`
    );
    const taskGroupUsage = this.collectTaskGroupUsage(planKey);
    const battlePlans = this.collectBattlePlans();
    const teamKey = (name: string): string => (
      name.trim().toLocaleLowerCase('zh-CN')
    );
    const availableTeams = new Set(
      this.teamPlans.map(plan => teamKey(plan.name)),
    );
    const teamUsage = new Map<string, Set<string>>();
    battlePlans.forEach(plan => {
      plan.teams.forEach(name => {
        const key = teamKey(name);
        const usedBy = teamUsage.get(key) ?? new Set<string>();
        usedBy.add(plan.name);
        teamUsage.set(key, usedBy);
      });
    });

    const rows: ManagementRow[] = [];
    battlePlans.forEach(plan => {
      const relations = [...plan.teams];
      const missingRelations = new Set(relations.filter(name => (
        !availableTeams.has(teamKey(name))
      )));
      const ignoredUnlinked = this.ignoredUnlinkedPlans.has(
        `battle/${plan.source}/${plan.file}`,
      );
      const attention = (
        (relations.length === 0 && !ignoredUnlinked)
        || missingRelations.size > 0
      );
      rows.push({
        kind: 'battle',
        source: plan.source,
        name: plan.name,
        file: plan.file,
        relations,
        taskGroups: [
          ...(taskGroupUsage.get(planKey(plan.source, plan.file)) ?? []),
        ],
        missingRelations,
        status: relations.length === 0
          ? ignoredUnlinked
            ? ''
            : '未关联舰队'
          : missingRelations.size > 0
            ? '舰队文件缺失'
            : '关联正常',
        statusClass: ignoredUnlinked
          ? 'muted'
          : attention
            ? 'warning'
            : 'ok',
        attention,
        ignoredUnlinked,
      });
    });
    this.teamPlans.forEach(plan => {
      const relations = [...(teamUsage.get(teamKey(plan.name)) ?? [])];
      const ignoredUnlinked = this.ignoredUnlinkedPlans.has(
        `team/${plan.source}/${plan.file}`,
      );
      rows.push({
        kind: 'team',
        source: plan.source,
        name: plan.name,
        file: plan.file,
        relations,
        taskGroups: [],
        missingRelations: new Set<string>(),
        status: relations.length > 0
          ? `已被 ${relations.length} 个计划引用`
          : ignoredUnlinked
            ? ''
            : '未被引用',
        statusClass: relations.length > 0 ? 'ok' : 'muted',
        attention: relations.length === 0 && !ignoredUnlinked,
        ignoredUnlinked,
      });
    });
    this.errors.forEach(error => {
      rows.push({
        kind: error.kind,
        source: error.source,
        name: error.file.replace(/\.ya?ml$/i, ''),
        file: error.file,
        relations: [],
        taskGroups: error.kind === 'battle'
          ? [...(taskGroupUsage.get(planKey(error.source, error.file)) ?? [])]
          : [],
        missingRelations: new Set<string>(),
        status: '无法读取',
        statusClass: 'warning',
        attention: true,
        invalid: true,
        errorMessage: error.message,
      });
    });

    const sourceRows = rows.filter(row => (
      this.source === 'all' || row.source === this.source
    ));
    this.renderCountsAndWarnings(sourceRows);
    const visibleRows = this.filterRows(sourceRows);
    this.syncSelections(rows, visibleRows);
    this.body.replaceChildren();
    if (visibleRows.length === 0) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 7;
      cell.className = 'plan-management-empty';
      cell.textContent = sourceRows.length > 0
        ? '没有符合当前筛选条件的 YAML'
        : '当前目录中没有可读取的 YAML';
      row.append(cell);
      this.body.append(row);
      restoreScrollPosition(scroll, scrollPosition);
      return;
    }

    const fragment = document.createDocumentFragment();
    visibleRows.forEach(item => fragment.append(this.createRow(item)));
    this.body.append(fragment);
    restoreScrollPosition(scroll, scrollPosition);
  }

  private renderActiveFilters(): void {
    this.tabs.forEach(tab => {
      const active = tab.dataset['planManagementSource'] === this.source;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    this.kindButtons.forEach(button => {
      const active = button.dataset['planManagementKind'] === this.kind;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  private collectTaskGroupUsage(
    planKey: (source: PlanPresetSource, file: string) => string,
  ): Map<string, Set<string>> {
    const usage = new Map<string, Set<string>>();
    this.host.taskGroups().forEach(group => {
      group.items.forEach(item => {
        if (item.kind !== 'plan') return;
        let source = item.managedSource;
        let file = item.managedFile?.trim();
        if ((!source || !file) && item.path) {
          const normalizedPath = item.path.replace(/\\/g, '/');
          const lowerPath = normalizedPath.toLocaleLowerCase('zh-CN');
          if (/(^|\/)system_battle_plans\//.test(lowerPath)) {
            source = 'system';
          } else if (/(^|\/)user_battle_plans\//.test(lowerPath)) {
            source = 'user';
          }
          file = normalizedPath.split('/').pop()?.trim();
        }
        if (!source || !file) return;
        const key = planKey(source, file);
        const groups = usage.get(key) ?? new Set<string>();
        groups.add(group.name);
        usage.set(key, groups);
      });
    });
    return usage;
  }

  private collectBattlePlans(): Map<string, {
    file: string;
    name: string;
    source: PlanPresetSource;
    teams: Set<string>;
  }> {
    const plans = new Map<string, {
      file: string;
      name: string;
      source: PlanPresetSource;
      teams: Set<string>;
    }>();
    this.bindings.forEach(binding => {
      const key = `${binding.source}:${binding.planFile}`;
      let plan = plans.get(key);
      if (!plan) {
        plan = {
          file: binding.planFile,
          name: binding.planName,
          source: binding.source,
          teams: new Set<string>(),
        };
        plans.set(key, plan);
      }
      if (binding.teamName) plan.teams.add(binding.teamName);
    });
    return plans;
  }

  private renderCountsAndWarnings(rows: ManagementRow[]): void {
    const filteredErrors = this.errors.filter(error => (
      this.source === 'all' || error.source === this.source
    ));
    const linkedCount = rows.filter(row => (
      row.kind === 'battle'
      && row.relations.length > 0
      && !row.attention
    )).length;
    const setCount = (id: string, value: number): void => {
      const element = document.getElementById(id);
      if (element) element.textContent = String(value);
    };
    setCount(
      'plan-management-battle-count',
      rows.filter(row => row.kind === 'battle').length,
    );
    setCount(
      'plan-management-team-count',
      rows.filter(row => row.kind === 'team').length,
    );
    setCount('plan-management-linked-count', linkedCount);
    setCount(
      'plan-management-attention-count',
      rows.filter(row => row.attention).length,
    );

    const warning = document.getElementById('plan-management-warning');
    if (!warning) return;
    warning.hidden = filteredErrors.length === 0;
    warning.textContent = filteredErrors.length > 0
      ? `有 ${filteredErrors.length} 个 YAML 无法读取，可在下方查看并处理。`
      : '';
    warning.title = filteredErrors
      .map(error => `${error.source}/${error.file}: ${error.message}`)
      .join('\n');
  }

  private filterRows(rows: ManagementRow[]): ManagementRow[] {
    const query = this.query.toLocaleLowerCase('zh-CN');
    const attentionOnly = this.attentionOnly?.checked ?? false;
    return rows.filter(row => {
      if (this.kind !== 'all' && row.kind !== this.kind) return false;
      if (attentionOnly && !row.attention) return false;
      if (!query) return true;
      return [
        row.name,
        row.file,
        row.errorMessage ?? '',
        ...row.relations,
        ...row.taskGroups,
      ].some(value => value.toLocaleLowerCase('zh-CN').includes(query));
    }).sort((left, right) => {
      if (left.attention !== right.attention) return left.attention ? -1 : 1;
      if (left.kind !== right.kind) return left.kind === 'battle' ? -1 : 1;
      return left.name.localeCompare(right.name, 'zh-CN');
    });
  }

  private syncSelections(
    rows: ManagementRow[],
    visibleRows: ManagementRow[],
  ): void {
    const availableKeys = new Set(
      rows
        .filter(row => row.source === 'user')
        .map(row => this.selectionKey({
          kind: row.kind,
          file: row.file,
        })),
    );
    this.selections.forEach((_selection, key) => {
      if (!availableKeys.has(key)) this.selections.delete(key);
    });
    this.visibleSelections = visibleRows
      .filter(row => row.source === 'user')
      .map(row => ({ kind: row.kind, file: row.file }));
    this.updateSelectionControls();
  }

  private createRow(item: ManagementRow): HTMLTableRowElement {
    const row = document.createElement('tr');
    row.classList.toggle('needs-attention', item.attention);
    const selectionCell = this.createSelectionCell(item);
    const planCell = this.createPlanCell(item);
    const sourceCell = this.createSourceCell(item);
    const relationCell = this.createRelationCell(item);
    const taskGroupCell = this.createTaskGroupCell(item);
    const statusCell = document.createElement('td');
    if (item.status) {
      const status = document.createElement('span');
      status.className = `plan-management-status ${item.statusClass}`;
      status.textContent = item.status;
      statusCell.append(status);
    }
    row.append(
      selectionCell,
      planCell,
      sourceCell,
      relationCell,
      taskGroupCell,
      statusCell,
      this.createActionCell(item),
    );
    return row;
  }

  private createSelectionCell(item: ManagementRow): HTMLTableCellElement {
    const cell = document.createElement('td');
    cell.className = 'plan-management-selection-cell';
    if (item.source !== 'user') {
      cell.title = '系统预设不支持导出';
      return cell;
    }
    const selection: UserPlanExportSelection = {
      kind: item.kind,
      file: item.file,
    };
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.dataset['planSelection'] = 'true';
    checkbox.dataset['planKind'] = item.kind;
    checkbox.dataset['planFile'] = item.file;
    checkbox.checked = this.selections.has(this.selectionKey(selection));
    checkbox.disabled = this.exporting;
    checkbox.setAttribute('aria-label', `选择用户配置 ${item.name}`);
    cell.append(checkbox);
    return cell;
  }

  private createPlanCell(item: ManagementRow): HTMLTableCellElement {
    const cell = document.createElement('td');
    const kind = document.createElement('span');
    kind.className = `plan-kind-badge ${item.kind}`;
    kind.textContent = item.kind === 'battle' ? '出征' : '舰队';
    const identity = document.createElement('span');
    identity.className = 'plan-management-identity';
    const name = document.createElement('strong');
    name.textContent = item.name;
    const file = document.createElement('small');
    file.textContent = item.file;
    identity.append(name, file);
    cell.append(kind, identity);
    return cell;
  }

  private createSourceCell(item: ManagementRow): HTMLTableCellElement {
    const cell = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = `plan-source-badge ${item.source}`;
    badge.textContent = item.source === 'system' ? '系统' : '用户';
    cell.append(badge);
    return cell;
  }

  private createRelationCell(item: ManagementRow): HTMLTableCellElement {
    const cell = document.createElement('td');
    if (item.invalid) {
      cell.textContent = item.errorMessage || 'YAML 格式不合法';
      cell.className = 'plan-management-relation-error';
    } else if (item.relations.length === 0) {
      cell.textContent = item.kind === 'battle'
        ? item.ignoredUnlinked
          ? '该计划已设为无需舰队方案'
          : '未关联舰队方案'
        : item.ignoredUnlinked
          ? '该舰队方案已忽略引用检查'
          : '尚未被出征计划引用';
      cell.className = 'plan-management-relation-empty';
    } else {
      const list = document.createElement('div');
      list.className = 'plan-management-relations';
      item.relations.forEach(relation => {
        const chip = document.createElement('span');
        chip.className = item.missingRelations.has(relation)
          ? 'plan-relation-chip missing'
          : 'plan-relation-chip';
        chip.textContent = relation;
        if (item.missingRelations.has(relation)) {
          chip.title = '未找到同名舰队方案';
        }
        list.append(chip);
      });
      cell.append(list);
    }
    return cell;
  }

  private createTaskGroupCell(item: ManagementRow): HTMLTableCellElement {
    const cell = document.createElement('td');
    if (item.kind === 'team') {
      cell.textContent = '—';
      cell.className = 'plan-management-relation-empty';
    } else if (item.taskGroups.length === 0) {
      cell.textContent = '未加入任务分组';
      cell.className = 'plan-management-relation-empty';
    } else {
      const list = document.createElement('div');
      list.className = 'plan-management-relations';
      item.taskGroups.forEach(groupName => {
        const chip = document.createElement('span');
        chip.className = 'plan-relation-chip';
        chip.textContent = groupName;
        list.append(chip);
      });
      cell.append(list);
    }
    return cell;
  }

  private createActionCell(item: ManagementRow): HTMLTableCellElement {
    const cell = document.createElement('td');
    cell.className = 'plan-management-actions';
    if (item.invalid) {
      if (item.source === 'user') {
        cell.append(this.actionButton(
          '删除',
          item.kind === 'battle' ? 'delete' : 'delete-team',
          item.file,
          true,
          item.source,
          item.name,
        ));
      } else {
        cell.textContent = '只读';
      }
      return cell;
    }

    if (item.kind === 'battle') {
      cell.append(this.actionButton(
        item.source === 'system' ? '查看' : '编辑',
        'edit-battle',
        item.file,
        false,
        item.source,
      ));
      if (item.relations.length === 0) {
        cell.append(this.unlinkedButton(item));
      }
      if (item.source === 'user') {
        cell.append(
          this.actionButton('重命名', 'rename', item.file),
          this.actionButton('删除', 'delete', item.file, true),
        );
      }
    } else {
      cell.append(this.actionButton(
        item.source === 'system' ? '查看' : '编辑',
        'edit-team',
        item.file,
        false,
        item.source,
      ));
      if (item.relations.length === 0) {
        cell.append(this.unlinkedButton(item));
      }
      if (item.source === 'user') {
        cell.append(this.actionButton(
          '删除',
          'delete-team',
          item.file,
          true,
          item.source,
          item.name,
        ));
      }
    }
    return cell;
  }

  private unlinkedButton(item: ManagementRow): HTMLButtonElement {
    const button = this.actionButton(
      item.ignoredUnlinked ? '恢复检查' : '忽略提示',
      'toggle-unlinked',
      item.file,
      false,
      item.source,
    );
    button.dataset['planIgnored'] = String(item.ignoredUnlinked === true);
    button.dataset['planKind'] = item.kind;
    return button;
  }

  private selectionKey(selection: UserPlanExportSelection): string {
    return `${selection.kind}:${selection.file.toLocaleLowerCase('en-US')}`;
  }

  private updateSelectionControls(): void {
    const visibleSelectedCount = this.visibleSelections.filter(
      selection => this.selections.has(this.selectionKey(selection)),
    ).length;
    if (this.selectAll) {
      this.selectAll.checked = (
        this.visibleSelections.length > 0
        && visibleSelectedCount === this.visibleSelections.length
      );
      this.selectAll.indeterminate = (
        visibleSelectedCount > 0
        && visibleSelectedCount < this.visibleSelections.length
      );
      this.selectAll.disabled = (
        this.exporting || this.visibleSelections.length === 0
      );
    }
    if (this.exportButton) {
      this.exportButton.disabled = this.exporting || this.selections.size === 0;
      this.exportButton.title = this.selections.size > 0
        ? `导出已选择的 ${this.selections.size} 个用户配置`
        : '请先选择用户配置';
    }
    this.body
      ?.querySelectorAll<HTMLInputElement>('[data-plan-selection]')
      .forEach(checkbox => {
        checkbox.disabled = this.exporting;
      });
  }

  private async exportSelectedPlans(): Promise<void> {
    if (this.exporting || this.selections.size === 0) return;
    const selections = [...this.selections.values()];
    this.exporting = true;
    this.updateSelectionControls();
    try {
      const result = await this.host.exportUserPlans(selections);
      if (result.canceled) return;
      if (!result.success) {
        await showAlert('导出失败', result.error || '未知错误');
        return;
      }
      showSaveSuccess(
        `已导出 ${result.count ?? selections.length} 个用户配置`,
      );
    } catch (error) {
      await showAlert(
        '导出失败',
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      this.exporting = false;
      this.updateSelectionControls();
    }
  }

  private actionButton(
    label: string,
    operation:
      | 'rename'
      | 'delete'
      | 'edit-battle'
      | 'edit-team'
      | 'delete-team'
      | 'toggle-unlinked',
    file: string,
    danger = false,
    source?: PlanPresetSource,
    name?: string,
  ): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    const primary = label === '编辑'
      && (operation === 'edit-battle' || operation === 'edit-team');
    button.className = [
      'btn',
      'btn-small',
      danger ? 'btn-danger' : '',
      primary ? 'btn-primary' : '',
    ].filter(Boolean).join(' ');
    button.dataset['planOperation'] = operation;
    button.dataset['planFile'] = file;
    if (source) button.dataset['planSource'] = source;
    if (name) button.dataset['planName'] = name;
    button.textContent = label;
    return button;
  }

  private async toggleUnlinkedIgnored(
    kind: 'battle' | 'team',
    file: string,
    source: PlanPresetSource,
    ignored: boolean,
  ): Promise<void> {
    try {
      const values = await this.host.setPlanUnlinkedIgnored(
        kind,
        source,
        file,
        ignored,
      );
      this.ignoredUnlinkedPlans = new Set(values);
      this.render();
    } catch (error) {
      await showAlert(
        '操作失败',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private async renameCombatPlan(file: string): Promise<void> {
    const currentName = file
      .replace(/\.ya?ml$/i, '')
      .replace(/^bettle-/i, '');
    const newName = await showPrompt(
      '重命名出征计划',
      '只修改用户计划文件名，不修改 YAML 的后端字段。',
      currentName,
    );
    if (newName === null || !newName.trim() || newName.trim() === currentName) {
      return;
    }
    const result = await this.host.renameUserCombatPlan(file, newName.trim());
    if (!result.success) {
      await showAlert('重命名失败', result.error || '未知错误');
      return;
    }
    await this.load();
  }

  private async deleteCombatPlan(file: string): Promise<void> {
    const confirmed = await showConfirm(
      '删除出征计划',
      `确定删除用户计划 ${file} 吗？此操作无法撤销。`,
    );
    if (!confirmed) return;
    const result = await this.host.deleteUserCombatPlan(file);
    if (!result.success) {
      await showAlert('删除失败', result.error || '未知错误');
      return;
    }
    await this.load();
  }

  private async deleteTeamPlan(file: string, name: string): Promise<void> {
    const normalizedName = name.trim().toLocaleLowerCase('zh-CN');
    const references = new Set(
      this.bindings
        .filter(binding => (
          binding.teamName?.trim().toLocaleLowerCase('zh-CN')
            === normalizedName
        ))
        .map(binding => binding.planName),
    );
    const hasOtherTeamWithSameName = this.teamPlans.some(plan => (
      plan.file !== file
      && plan.name.trim().toLocaleLowerCase('zh-CN') === normalizedName
    ));
    let referenceNotice = '';
    if (references.size > 0) {
      referenceNotice = hasOtherTeamWithSameName
        ? `\n当前有 ${references.size} 个出征计划引用该名称，删除后仍会匹配另一份同名舰队方案。`
        : `\n当前有 ${references.size} 个出征计划引用该舰队；删除后这些计划会显示舰队文件缺失。`;
    }
    const confirmed = await showConfirm(
      '删除舰队方案',
      `确定删除舰队方案 ${name || file} 吗？${referenceNotice}\n此操作无法撤销。`,
    );
    if (!confirmed) return;
    const result = await this.host.deleteUserTeamPlan(file);
    if (!result.success) {
      await showAlert('删除失败', result.error || '未知错误');
      return;
    }
    await this.load();
  }
}
