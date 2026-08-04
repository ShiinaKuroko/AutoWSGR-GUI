/** 协调任务列表文件选择、解析和批量载入。 */
/**
 * Task-list loader shown on the home page.
 *
 * The left column selects a saved task group. The right column previews the
 * group's plans and keeps drag sorting in memory until the user confirms.
 */
import type {
  TaskGroupItem,
  TaskGroupModel,
} from '../../model/TaskGroupModel';
import type { ManagedBattlePlan } from '../../types/ipc.js';
import {
  captureScrollPosition,
  restoreScrollPosition,
} from '../../view/shared/scrollPosition';
import { showConfirm } from '../shared/DialogHelper';

export class TaskListLoaderController {
  private readonly dialog: HTMLElement;
  private readonly countEl: HTMLElement;
  private readonly groupsEl: HTMLElement;
  private readonly previewTitleEl: HTMLElement;
  private readonly previewEl: HTMLElement;
  private readonly confirmButton: HTMLButtonElement;
  private selectedGroupName = '';
  private draftItems: TaskGroupItem[] = [];
  private managedPlans: ManagedBattlePlan[] = [];
  private draggedIndex: number | null = null;

  constructor(
    private readonly model: TaskGroupModel,
    private readonly onLoaded: () => void,
  ) {
    this.dialog = document.getElementById('task-list-loader')!;
    this.countEl = document.getElementById('task-list-loader-count')!;
    this.groupsEl = document.getElementById('task-list-loader-groups')!;
    this.previewTitleEl = document.getElementById(
      'task-list-loader-preview-title',
    )!;
    this.previewEl = document.getElementById('task-list-loader-preview')!;
    this.confirmButton = document.getElementById(
      'btn-confirm-task-list-loader',
    ) as HTMLButtonElement;
    this.bindActions();
  }

  open(): void {
    const groups = this.model.groups;
    this.countEl.textContent = `共 ${groups.length} 个计划组`;
    const activeExists = groups.some(
      group => group.name === this.model.activeGroupName,
    );
    this.selectGroup(
      activeExists
        ? this.model.activeGroupName
        : groups[0]?.name ?? '',
    );
    this.dialog.style.display = 'flex';
    void this.refreshManagedPlans();
  }

  private async refreshManagedPlans(): Promise<void> {
    const bridge = window.electronBridge;
    if (!bridge?.getPlanManagement) return;
    try {
      const result = await bridge.getPlanManagement();
      this.managedPlans = result.battlePlans;
      if (this.dialog.style.display !== 'none') this.renderPreview();
    } catch {
      this.managedPlans = [];
    }
  }

  private bindActions(): void {
    document.getElementById('btn-cancel-task-list-loader')
      ?.addEventListener('click', () => this.close());
    this.confirmButton.addEventListener('click', () => {
      void this.confirm();
    });
    this.dialog.addEventListener('click', event => {
      if (event.target === this.dialog) this.close();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && this.dialog.style.display !== 'none') {
        this.close();
      }
    });
  }

  private close(): void {
    this.dialog.style.display = 'none';
    this.draggedIndex = null;
  }

  private selectGroup(name: string): void {
    this.selectedGroupName = name;
    const group = name ? this.model.getGroup(name) : null;
    this.draftItems = group
      ? group.items.map(item => ({ ...item }))
      : [];
    this.confirmButton.disabled = !group;
    this.renderGroups();
    this.renderPreview();
  }

  private renderGroups(): void {
    const scrollPosition = captureScrollPosition(this.groupsEl);
    this.groupsEl.innerHTML = '';
    if (this.model.groups.length === 0) {
      this.groupsEl.innerHTML = [
        '<div class="fleet-team-loader-preview-empty">',
        '暂无已保存的任务列表',
        '</div>',
      ].join('');
      restoreScrollPosition(this.groupsEl, scrollPosition);
      return;
    }

    for (const group of this.model.groups) {
      const row = document.createElement('div');
      row.className = 'task-list-loader-group-row';

      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'task-list-loader-group-card';
      card.classList.toggle('active', group.name === this.selectedGroupName);

      const name = document.createElement('strong');
      name.textContent = group.name;
      const count = document.createElement('span');
      count.textContent = `${group.items.length} 个出征计划`;
      card.append(name, count);
      card.addEventListener('click', () => this.selectGroup(group.name));

      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'task-list-loader-group-delete';
      deleteButton.textContent = '删除';
      deleteButton.title = `删除任务列表「${group.name}」`;
      deleteButton.addEventListener('click', () => {
        void this.deleteGroup(group.name);
      });

      row.append(card, deleteButton);
      this.groupsEl.appendChild(row);
    }
    restoreScrollPosition(this.groupsEl, scrollPosition);
  }

  private renderPreview(): void {
    this.previewTitleEl.textContent = this.selectedGroupName
      ? `计划列表预览：${this.selectedGroupName}`
      : '计划列表预览：未选择';
    this.previewEl.innerHTML = '';

    if (!this.selectedGroupName) {
      this.previewEl.innerHTML = [
        '<div class="fleet-team-loader-preview-empty">',
        '从左侧选择一个计划组',
        '</div>',
      ].join('');
      return;
    }
    if (this.draftItems.length === 0) {
      this.previewEl.innerHTML = [
        '<div class="fleet-team-loader-preview-empty">',
        '该计划组尚未关联出征计划',
        '</div>',
      ].join('');
      return;
    }

    this.draftItems.forEach((item, index) => {
      this.previewEl.appendChild(this.createPreviewCard(item, index));
    });
  }

  private createPreviewCard(
    item: TaskGroupItem,
    index: number,
  ): HTMLElement {
    const card = document.createElement('div');
    card.className = 'task-list-loader-plan-card';
    card.draggable = true;
    card.dataset['index'] = String(index);

    const handle = document.createElement('span');
    handle.className = 'tg-drag-handle';
    handle.textContent = '⠿';

    const order = document.createElement('span');
    order.className = 'tg-order';
    order.textContent = String(index + 1).padStart(2, '0');

    const content = document.createElement('div');
    content.className = 'tg-content';
    const heading = document.createElement('div');
    heading.className = 'tg-item-heading';
    const label = document.createElement('strong');
    label.className = 'tg-label';
    label.textContent = item.label;
    const fleetName = this.fleetPresetName(item);
    const fleetTag = document.createElement('span');
    fleetTag.className = 'tg-fleet-tag';
    fleetTag.textContent = fleetName;
    fleetTag.title = `使用队伍：${fleetName}`;
    fleetTag.hidden = !fleetName;
    const source = document.createElement('span');
    source.className = `tg-source ${this.sourceClass(item)}`;
    source.textContent = this.sourceLabel(item);
    heading.append(label, fleetTag, source);

    const fileName = document.createElement('span');
    fileName.className = 'tg-detail';
    fileName.textContent = item.managedFile
      ?? item.path?.split(/[\\/]/).pop()
      ?? item.templateId
      ?? '-';
    content.append(heading, fileName);

    const times = document.createElement('span');
    times.className = 'task-list-loader-plan-times';
    times.textContent = `执行 ${item.times} 次`;
    card.append(handle, order, content, times);

    card.addEventListener('dragstart', event => {
      this.draggedIndex = index;
      card.classList.add('dragging');
      event.dataTransfer!.effectAllowed = 'move';
    });
    card.addEventListener('dragend', () => {
      this.draggedIndex = null;
      card.classList.remove('dragging');
      this.previewEl.querySelectorAll('.drag-over').forEach(element => {
        element.classList.remove('drag-over');
      });
    });
    card.addEventListener('dragover', event => {
      event.preventDefault();
      card.classList.add('drag-over');
      event.dataTransfer!.dropEffect = 'move';
    });
    card.addEventListener('dragleave', () => {
      card.classList.remove('drag-over');
    });
    card.addEventListener('drop', event => {
      event.preventDefault();
      card.classList.remove('drag-over');
      this.moveDraftItem(index);
    });
    return card;
  }

  private fleetPresetName(item: TaskGroupItem): string {
    if (
      item.kind !== 'plan'
      || !item.managedSource
      || !item.managedFile
    ) {
      return '';
    }
    const plan = this.managedPlans.find(candidate => (
      candidate.source === item.managedSource
      && candidate.file === item.managedFile
    ));
    const presetIndex = item.fleetPresetIndex ?? 0;
    return plan?.fleets[presetIndex]?.name ?? '';
  }

  private moveDraftItem(toIndex: number): void {
    const fromIndex = this.draggedIndex;
    if (
      fromIndex === null
      || fromIndex === toIndex
      || fromIndex < 0
      || fromIndex >= this.draftItems.length
    ) {
      return;
    }
    const [item] = this.draftItems.splice(fromIndex, 1);
    this.draftItems.splice(toIndex, 0, item);
    this.draggedIndex = null;
    this.renderPreview();
  }

  private async deleteGroup(name: string): Promise<void> {
    const groupIndex = this.model.groups.findIndex(
      group => group.name === name,
    );
    if (!name || groupIndex < 0) return;

    const confirmed = await showConfirm(
      '确认删除任务列表',
      `确定删除任务列表「${name}」？\n\n删除后无法恢复。`,
    );
    if (!confirmed || !this.model.deleteGroup(name)) return;

    await this.model.save();
    this.countEl.textContent = `共 ${this.model.groups.length} 个计划组`;
    let nextGroupName = this.selectedGroupName;
    if (name === this.selectedGroupName) {
      const nextIndex = Math.min(groupIndex, this.model.groups.length - 1);
      nextGroupName = this.model.groups[nextIndex]?.name ?? '';
    }
    this.selectGroup(nextGroupName);
    this.onLoaded();
  }

  private async confirm(): Promise<void> {
    if (!this.selectedGroupName) return;
    this.model.upsertGroup(
      this.selectedGroupName,
      this.draftItems.map(item => ({ ...item })),
    );
    this.model.setActiveGroup(this.selectedGroupName);
    await this.model.save();
    this.onLoaded();
    this.close();
  }

  private sourceClass(item: TaskGroupItem): string {
    if (item.managedSource === 'system') return 'system';
    if (item.managedSource === 'user') return 'user';
    if (item.kind === 'template') return 'template';
    return 'local';
  }

  private sourceLabel(item: TaskGroupItem): string {
    if (item.managedSource === 'system') return '系统预设';
    if (item.managedSource === 'user') return '用户预设';
    if (item.kind === 'template') return '任务模板';
    if (item.kind === 'preset') return '任务预设';
    return '本地文件';
  }
}
