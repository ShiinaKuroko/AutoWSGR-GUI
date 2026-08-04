/** 渲染方案内舰队预设并提供应用、编辑和任务创建入口。 */
import type { FleetPresetVO } from '../../types/view.js';
import type {
  BathRepairConfig,
  ShipFilter,
  ShipSlot,
} from '../../types/model.js';
import type {
  ElectronBridge,
  ShipLibraryManifest,
  ShipLibraryShip,
  UserTeamPlan,
  UserTeamPlanSlot,
} from '../../types/ipc.js';
import {
  appendTeamPlanCardContent,
  filterAndSortTeamPlans,
  teamPlanCardData,
} from './TeamPlanListUi';
import type {
  TeamPlanCardData,
  TeamPlanCardSource,
  TeamPlanSortField,
} from './TeamPlanListUi';
import {
  captureScrollPosition,
  restoreScrollPosition,
} from '../shared/scrollPosition';
import { createShipArtwork } from './ShipArtwork';
import { shipFilterLabel } from '../../model/fleet/ShipMatcher';

interface ShipPreviewRule {
  name: string;
  minLevel?: number;
  maxLevel?: number;
}

export type FleetPresetViewHost = Pick<
  ElectronBridge,
  'listTeamPlans' | 'getShipLibraryManifest'
>;

export class FleetPresetView {
  private readonly fleetPresetSection: HTMLElement;
  private readonly fleetPresetListEl: HTMLElement;
  private readonly fleetBindingListEl: HTMLElement;
  private readonly mainPreview: HTMLElement;
  private readonly backupPreview: HTMLElement;
  private readonly previewTitle: HTMLElement;
  private readonly backupTitle: HTMLElement;
  private readonly selectorPanel: HTMLElement;
  private readonly nodeRoutePanel: HTMLElement;
  private readonly selectorSearch: HTMLInputElement;
  private readonly selectorCount: HTMLElement;
  private readonly selectorFilterSystem: HTMLInputElement;
  private readonly selectorSortButtons: HTMLButtonElement[];
  private readonly selectorSortAscending: HTMLInputElement;
  private readonly selectorStatus: HTMLElement;

  selectedFleetPresetIndices: Set<number> = new Set();
  private currentPresets: FleetPresetVO[] = [];
  private userTeams: UserTeamPlan[] = [];
  private manifest: ShipLibraryManifest | null = null;
  private renderVersion = 0;
  private activePreviewTeamIndex = -1;
  private activePreviewPosition = 0;
  private selectorSortField: TeamPlanSortField = 'modifiedAt';
  private draggedTeamIndex: number | null = null;
  private teamListDragScrollTop = 0;

  onUserTeamChange?: (plans: FleetPresetVO[]) => void;

  constructor(private readonly host: FleetPresetViewHost) {
    this.fleetPresetSection = document.getElementById('fleet-preset-section')!;
    this.fleetPresetListEl = document.getElementById('fleet-preset-list')!;
    this.fleetBindingListEl = document.getElementById('fleet-binding-list')!;
    this.mainPreview = document.getElementById('fleet-team-main-preview')!;
    this.backupPreview = document.getElementById('fleet-team-backup-preview')!;
    this.previewTitle = document.getElementById('fleet-team-preview-title')!;
    this.backupTitle = document.getElementById('fleet-team-backup-title')!;
    this.selectorPanel = document.getElementById('fleet-selector-panel')!;
    this.nodeRoutePanel = document.getElementById('plan-node-route-panel')!;
    this.selectorSearch = document.getElementById(
      'plan-team-selector-search',
    ) as HTMLInputElement;
    this.selectorCount = document.getElementById(
      'plan-team-selector-count',
    )!;
    this.selectorFilterSystem = document.getElementById(
      'plan-team-selector-filter-system',
    ) as HTMLInputElement;
    this.selectorSortButtons = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        '[data-plan-team-sort-field]',
      ),
    );
    this.selectorSortAscending = document.getElementById(
      'plan-team-selector-sort-asc',
    ) as HTMLInputElement;
    this.selectorStatus = document.getElementById(
      'plan-team-selector-status',
    )!;

    document.getElementById('btn-open-fleet-selector')?.addEventListener(
      'click',
      () => this.showSelector(),
    );
    document.getElementById('btn-close-fleet-selector')?.addEventListener(
      'click',
      () => this.hideSelector(),
    );
    this.selectorSearch.addEventListener('input', () => {
      this.renderTeamList();
    });
    this.selectorFilterSystem.addEventListener('change', () => {
      this.renderTeamList();
    });
    this.selectorSortAscending.addEventListener('change', () => {
      this.renderTeamList();
    });
    this.selectorSortButtons.forEach(button => {
      button.addEventListener('click', () => {
        const field = button.dataset['planTeamSortField'];
        if (field !== 'name' && field !== 'modifiedAt') return;
        this.selectorSortField = field;
        this.selectorSortButtons.forEach(option => {
          option.classList.toggle('active', option === button);
        });
        this.renderTeamList();
      });
    });
    this.fleetBindingListEl.addEventListener('dragover', event => {
      if (this.draggedTeamIndex === null) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      this.fleetBindingListEl.classList.add('drag-active');
    });
    this.fleetBindingListEl.addEventListener('dragleave', event => {
      const nextTarget = event.relatedTarget;
      if (
        nextTarget instanceof Node
        && this.fleetBindingListEl.contains(nextTarget)
      ) {
        return;
      }
      this.fleetBindingListEl.classList.remove('drag-active');
    });
    this.fleetBindingListEl.addEventListener('drop', event => {
      if (this.draggedTeamIndex === null) return;
      event.preventDefault();
      this.applyTeamPreset(this.draggedTeamIndex);
      this.fleetBindingListEl.classList.remove('drag-active');
    });
  }

  showSection(): void { this.fleetPresetSection.style.display = ''; }
  hideSection(): void { this.fleetPresetSection.style.display = 'none'; }
  showSelector(): void {
    this.nodeRoutePanel.hidden = true;
    this.selectorPanel.hidden = false;
  }
  hideSelector(): void {
    this.selectorPanel.hidden = true;
    this.nodeRoutePanel.hidden = false;
  }

  render(presets?: FleetPresetVO[], _fleetId = 1): void {
    this.fleetPresetSection.style.display = '';
    this.hideSelector();
    this.currentPresets = presets ?? [];
    this.selectedFleetPresetIndices.clear();
    this.activePreviewTeamIndex = -1;
    this.fleetPresetListEl.innerHTML =
      '<div class="fleet-team-empty">正在读取编队预设…</div>';
    this.selectorCount.textContent = '正在读取编队预设…';
    this.selectorStatus.textContent = '';
    this.renderBindings();
    this.renderPreview(this.currentPresets[0]?.ships);
    const version = ++this.renderVersion;
    void this.loadUserTeams(version);
  }

  private async loadUserTeams(version: number): Promise<void> {
    try {
      const [result, manifest] = await Promise.all([
        this.host.listTeamPlans(),
        this.manifest
          ? Promise.resolve(this.manifest)
          : this.host.getShipLibraryManifest(),
      ]);
      if (version !== this.renderVersion) return;
      this.userTeams = result.plans;
      this.manifest = manifest;
      this.selectorCount.textContent =
        `共读取 ${result.plans.length} 个舰队预设`;
      this.selectorStatus.textContent = result.errors.length > 0
        ? `有 ${result.errors.length} 个配置格式不合法，已跳过`
        : '';

      this.selectedFleetPresetIndices = this.findBoundTeamIndices();
      const selectedIndex = this.selectedFleetPresetIndices.values().next().value;
      this.activePreviewTeamIndex = typeof selectedIndex === 'number'
        ? selectedIndex
        : this.currentPresets.length === 0 && this.userTeams.length > 0
          ? 0
          : -1;
      this.renderTeamList();
      this.renderBindings();
      this.renderPreview(
        this.activePreviewTeamIndex >= 0
          ? this.toFleetPreset(
              this.userTeams[this.activePreviewTeamIndex],
            ).ships
          : this.currentPresets[0]?.ships,
      );
    } catch (error) {
      if (version !== this.renderVersion) return;
      this.fleetPresetListEl.innerHTML =
        '<div class="fleet-team-empty">编队预设读取失败</div>';
      this.selectorCount.textContent = '读取失败';
      this.selectorStatus.textContent = error instanceof Error
        ? error.message
        : String(error);
      console.error('读取编队预设失败', error);
    }
  }

  private renderTeamList(): void {
    const scrollPosition = captureScrollPosition(this.fleetPresetListEl);
    const visibleTeams = filterAndSortTeamPlans(this.userTeams, {
      search: this.selectorSearch.value,
      filterSystem: this.selectorFilterSystem.checked,
      sortField: this.selectorSortField,
      ascending: this.selectorSortAscending.checked,
    });
    const previousPreviewIndex = this.activePreviewTeamIndex;
    const firstVisibleIndex = visibleTeams[0]?.index;
    const activePreviewVisible = visibleTeams.some(
      ({ index }) => index === this.activePreviewTeamIndex,
    );
    if (
      this.activePreviewTeamIndex < 0
      && this.currentPresets.length === 0
      && firstVisibleIndex !== undefined
    ) {
      this.activePreviewTeamIndex = firstVisibleIndex;
    } else if (
      this.activePreviewTeamIndex >= 0
      && !activePreviewVisible
    ) {
      this.activePreviewTeamIndex = firstVisibleIndex ?? -1;
    }

    this.fleetPresetListEl.replaceChildren();
    if (this.userTeams.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'fleet-team-empty';
      empty.textContent = '暂无编队预设，请先在“舰队规划”中保存';
      this.fleetPresetListEl.append(empty);
      restoreScrollPosition(this.fleetPresetListEl, scrollPosition);
      return;
    }

    if (visibleTeams.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'fleet-team-empty';
      empty.textContent = '没有符合当前过滤条件的舰队预设';
      this.fleetPresetListEl.append(empty);
    }

    visibleTeams.forEach(({ plan, index }) => {
      const item = document.createElement('div');
      item.className = 'fleet-team-loader-item fleet-preset-item';
      item.dataset['teamPlanIndex'] = String(index);
      item.draggable = true;
      item.title = `拖拽“${plan.name}”到编队配置`;
      item.classList.toggle(
        'selected',
        this.selectedFleetPresetIndices.has(index),
      );
      item.classList.toggle(
        'previewing',
        this.activePreviewTeamIndex === index,
      );

      const previewButton = document.createElement('button');
      previewButton.type = 'button';
      previewButton.className = 'fleet-preset-preview-button';
      appendTeamPlanCardContent(previewButton, teamPlanCardData(plan));

      previewButton.addEventListener('click', () => {
        this.activePreviewTeamIndex = index;
        this.fleetPresetListEl
          .querySelectorAll<HTMLElement>('[data-team-plan-index]')
          .forEach(option => {
            option.classList.toggle(
              'previewing',
              Number(option.dataset['teamPlanIndex']) === index,
            );
          });
        this.renderPreview(this.toFleetPreset(plan).ships);
      });
      item.append(previewButton);

      item.addEventListener('dragstart', event => {
        this.draggedTeamIndex = index;
        this.teamListDragScrollTop = this.fleetPresetListEl.scrollTop;
        item.classList.add('dragging');
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = 'copy';
          event.dataTransfer.setData('text/plain', String(index));
        }
      });
      item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
        this.draggedTeamIndex = null;
        this.fleetBindingListEl.classList.remove('drag-active');
        this.restoreTeamListScroll();
      });
      this.fleetPresetListEl.append(item);
    });

    if (this.activePreviewTeamIndex !== previousPreviewIndex) {
      this.renderPreview(
        this.activePreviewTeamIndex >= 0
          ? this.toFleetPreset(
              this.userTeams[this.activePreviewTeamIndex],
            ).ships
          : undefined,
      );
    }
    restoreScrollPosition(this.fleetPresetListEl, scrollPosition);
  }

  getSelectedPresets(): FleetPresetVO[] {
    return [...this.currentPresets];
  }

  getBathRepairConfig(): BathRepairConfig | undefined {
    const method = document.getElementById(
      'plan-edit-repair-method',
    ) as HTMLSelectElement | null;
    if (method?.value !== 'bath') return undefined;

    return {
      enabled: true,
      defaultThreshold: { type: 'percent', value: 50 },
    };
  }

  private findBoundTeamIndices(): Set<number> {
    const indices = new Set<number>();
    this.currentPresets.forEach((current) => {
      const key = this.presetRuleKey(current);
      const index = this.userTeams.findIndex(plan => (
        plan.name === current.name
        && this.presetRuleKey(this.toFleetPreset(plan)) === key
      ));
      if (index >= 0) indices.add(index);
    });
    return indices;
  }

  private presetRuleKey(preset: FleetPresetVO): string {
    return JSON.stringify(preset.ships.map(slot => (
      slot === null || typeof slot === 'string'
        ? slot
        : {
            name: slot.name ?? null,
            candidates: slot.candidates ?? null,
            search_name: slot.search_name ?? null,
            ship_type: slot.ship_type ?? null,
            min_level: slot.min_level ?? null,
            max_level: slot.max_level ?? null,
          }
    )));
  }

  private toFleetPreset(plan: UserTeamPlan): FleetPresetVO {
    return {
      name: plan.name,
      ships: plan.ships.map(slot => this.toShipSlot(slot)),
    };
  }

  private toShipSlot(slot: UserTeamPlanSlot | null): ShipSlot {
    if (slot === null) return null;
    const filter: ShipFilter = {
      name: slot.name,
    };
    if (slot.candidates) {
      filter.candidates = slot.candidates.map(candidate => ({
        ...candidate,
        ship_type: candidate.ship_type
          ? [...candidate.ship_type]
          : undefined,
      }));
    }
    if (slot.search_name) filter.search_name = slot.search_name;
    if (slot.ship_type) filter.ship_type = [...slot.ship_type];
    if (slot.min_level !== undefined) filter.min_level = slot.min_level;
    if (slot.max_level !== undefined) filter.max_level = slot.max_level;
    return filter;
  }

  private renderBindings(): void {
    this.fleetBindingListEl.replaceChildren();
    if (this.currentPresets.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'fleet-team-empty fleet-binding-empty';
      empty.textContent = '拖拽预设卡片到这里';
      this.fleetBindingListEl.append(empty);
      return;
    }

    this.currentPresets.forEach((preset, presetIndex) => {
      const teamIndex = this.userTeams.findIndex(plan => (
        plan.name === preset.name
        && this.presetRuleKey(this.toFleetPreset(plan))
          === this.presetRuleKey(preset)
      ));
      const sourcePlan = teamIndex >= 0
        ? this.userTeams[teamIndex]
        : this.userTeams.find(plan => plan.name === preset.name);
      const record = document.createElement('div');
      record.className = 'fleet-team-loader-item fleet-binding-record';

      const previewButton = document.createElement('button');
      previewButton.type = 'button';
      previewButton.className = 'fleet-binding-preview';
      appendTeamPlanCardContent(
        previewButton,
        this.boundTeamCardData(
          preset,
          sourcePlan?.source ?? 'deleted',
          sourcePlan?.modifiedAt,
        ),
      );

      previewButton.addEventListener('click', () => {
        this.showSelector();
        if (sourcePlan) {
          this.selectorSearch.value = '';
          if (sourcePlan.source === 'system') {
            this.selectorFilterSystem.checked = false;
          }
        }
        this.activePreviewTeamIndex = teamIndex;
        this.renderTeamList();
        this.renderPreview(preset.ships);
      });

      const removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.className = 'fleet-binding-remove';
      removeButton.setAttribute('aria-label', `移除${preset.name}`);
      removeButton.title = `从编队配置中移除“${preset.name}”`;
      removeButton.textContent = '×';
      removeButton.addEventListener('click', () => {
        this.removeTeamPreset(presetIndex);
      });

      record.append(previewButton, removeButton);
      this.fleetBindingListEl.append(record);
    });
  }

  private boundTeamCardData(
    preset: FleetPresetVO,
    source: TeamPlanCardSource,
    modifiedAt?: number,
  ): TeamPlanCardData {
    return {
      name: preset.name,
      source,
      primaryCount: preset.ships.filter(
        slot => typeof slot === 'string' || Boolean(slot?.name),
      ).length,
      backupCount: preset.ships.reduce(
        (count, slot) => count + (
          typeof slot === 'object' && slot !== null
            ? slot.candidates?.length ?? 0
            : 0
        ),
        0,
      ),
      modifiedAt,
    };
  }

  private applyTeamPreset(index: number): void {
    const plan = this.userTeams[index];
    if (!plan || this.selectedFleetPresetIndices.has(index)) {
      this.restoreTeamListScroll();
      return;
    }
    this.currentPresets = [
      ...this.currentPresets,
      this.toFleetPreset(plan),
    ];
    this.commitTeamPresetChange();
    this.restoreTeamListScroll();
  }

  private removeTeamPreset(index: number): void {
    if (index < 0 || index >= this.currentPresets.length) return;
    this.currentPresets = this.currentPresets.filter(
      (_, presetIndex) => presetIndex !== index,
    );
    this.commitTeamPresetChange();
    this.renderPreview(this.currentPresets[0]?.ships);
  }

  private commitTeamPresetChange(): void {
    this.selectedFleetPresetIndices = this.findBoundTeamIndices();
    this.renderBindings();
    this.fleetPresetListEl
      .querySelectorAll<HTMLElement>('[data-team-plan-index]')
      .forEach(card => {
        const index = Number(card.dataset['teamPlanIndex']);
        card.classList.toggle(
          'selected',
          this.selectedFleetPresetIndices.has(index),
        );
      });
    this.onUserTeamChange?.([...this.currentPresets]);
  }

  private restoreTeamListScroll(): void {
    const scrollTop = this.teamListDragScrollTop;
    this.fleetPresetListEl.scrollTop = scrollTop;
    requestAnimationFrame(() => {
      this.fleetPresetListEl.scrollTop = scrollTop;
    });
  }

  private renderPreview(ships?: ShipSlot[]): void {
    const slots = Array.from({ length: 6 }, (_, index) => (
      this.previewSlot(ships?.[index] ?? null)
    ));
    this.activePreviewPosition = 0;
    this.previewTitle.textContent = '编队预览';

    const mainFragment = document.createDocumentFragment();
    slots.forEach((slot, index) => {
      const item = document.createElement('div');
      item.className = 'fleet-team-main-item';
      const card = this.createPreviewCard(
        slot.primary,
        'main',
        index,
        slot.backups.length > 0,
      );
      card.classList.toggle('active', index === this.activePreviewPosition);
      card.addEventListener('click', () => {
        this.activePreviewPosition = index;
        this.mainPreview.querySelectorAll('.fleet-team-main-card').forEach(
          (mainCard, cardIndex) => mainCard.classList.toggle(
            'active',
            cardIndex === index,
          ),
        );
        this.renderBackupPosition(slots, index);
      });
      item.append(card);
      const level = this.createLevelSummary(slot.primary);
      if (level) item.append(level);
      mainFragment.append(item);
    });
    this.mainPreview.replaceChildren(mainFragment);
    this.renderBackupPosition(slots, this.activePreviewPosition);
  }

  private renderBackupPosition(
    slots: Array<{
      primary: ShipPreviewRule | null;
      backups: ShipPreviewRule[];
    }>,
    position: number,
  ): void {
    const backupFragment = document.createDocumentFragment();
    const slot = slots[position];
    this.backupTitle.textContent = slot.primary?.name
      ? `【${slot.primary.name}】的备选队列`
      : `【位置${position + 1}】的备选队列`;
    slot.backups.forEach((rule) => {
      backupFragment.append(this.createPreviewCard(rule, 'backup', position));
    });
    if (slot.backups.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'fleet-team-empty';
      empty.textContent = '该位置没有备选舰娘';
      backupFragment.append(empty);
    }
    this.backupPreview.replaceChildren(backupFragment);
  }

  private previewSlot(slot: ShipSlot): {
    primary: ShipPreviewRule | null;
    backups: ShipPreviewRule[];
  } {
    if (slot === null) return { primary: null, backups: [] };
    if (typeof slot === 'string') {
      return { primary: { name: slot }, backups: [] };
    }
    const hasAnonymousFilter = (
      (slot.candidates?.length ?? 0) === 0
      && (
        Boolean(slot.nation)
        || (slot.ship_type?.length ?? 0) > 0
        || slot.min_level !== undefined
        || slot.max_level !== undefined
      )
    );
    return {
      primary: slot.name || slot.search_name
        ? {
            name: slot.name ?? slot.search_name ?? '',
            minLevel: slot.min_level,
            maxLevel: slot.max_level,
          }
        : hasAnonymousFilter
          ? {
              name: shipFilterLabel({
                ...slot,
                min_level: undefined,
                max_level: undefined,
              }),
              minLevel: slot.min_level,
              maxLevel: slot.max_level,
            }
          : null,
      backups: (slot.candidates ?? []).map(candidate => ({
        name: candidate.name,
        minLevel: candidate.min_level,
        maxLevel: candidate.max_level,
      })),
    };
  }

  private createPreviewCard(
    rule: ShipPreviewRule | null,
    size: 'main' | 'backup',
    position: number,
    candidateOnly = false,
  ): HTMLElement {
    const card = document.createElement(size === 'main' ? 'button' : 'div');
    if (card instanceof HTMLButtonElement) card.type = 'button';
    card.className = `fleet-team-${size}-card`;
    const name = rule?.name ?? null;
    card.setAttribute(
      'aria-label',
      name ? `位置 ${position + 1}：${name}` : `位置 ${position + 1}：空`,
    );
    if (!name) {
      if (candidateOnly) {
        card.classList.add('candidate-only');
        const backgroundUrl = this.manifest?.ships.find(
          ship => ship.rarity === 6 && Boolean(ship.backgroundUrl),
        )?.backgroundUrl;
        if (backgroundUrl) {
          const background = document.createElement('img');
          background.className = 'fleet-team-placeholder-background';
          background.src = backgroundUrl;
          background.alt = '';
          background.draggable = false;
          card.append(background);
        }
      }
      const empty = document.createElement('span');
      empty.className = 'fleet-team-card-empty';
      empty.textContent = candidateOnly ? '使用备选队列' : '空';
      card.append(empty);
      return card;
    }

    card.title = name;
    card.dataset['name'] = name;
    const ship = this.findShip(name);
    if (ship) {
      card.append(createShipArtwork(
        ship,
        this.manifest?.labels.ship_types[ship.ship_type] ?? ship.ship_type,
      ));
    } else {
      const unknown = document.createElement('span');
      unknown.className = 'fleet-team-card-empty fleet-team-card-unknown';
      unknown.textContent = name;
      card.append(unknown);
    }
    return card;
  }

  private createLevelSummary(
    rule: ShipPreviewRule | null,
  ): HTMLElement | null {
    if (
      !rule
      || (rule.minLevel === undefined && rule.maxLevel === undefined)
    ) {
      return null;
    }
    const summary = document.createElement('span');
    summary.className = 'fleet-team-level-summary';
    if (rule.minLevel !== undefined) {
      const min = document.createElement('span');
      min.textContent = `最小等级：${rule.minLevel}`;
      summary.append(min);
    }
    if (rule.maxLevel !== undefined) {
      const max = document.createElement('span');
      max.textContent = `最大等级：${rule.maxLevel}`;
      summary.append(max);
    }
    return summary;
  }

  private findShip(name: string): ShipLibraryShip | undefined {
    return this.manifest?.ships.find(ship => ship.name === name)
      ?? this.manifest?.ships.find(ship => ship.search_name === name);
  }

}
