/** 渲染决战舰队配置并向 Controller 提交编辑意图。 */
/**
 * 旧决战计划编辑页。
 *
 * 主选区域复用舰队规划的六位置编队规则：
 * 1. 固定显示六个位置，舰船按位置顺序传给后端 level1。
 * 2. 图鉴填入当前位置；当前为空时优先填第一个空位。
 * 3. 同一舰船不会重复添加，删除后其余舰船向前压缩。
 * 4. 主选槽之间支持拖拽换位。
 *
 * 备选区域复用舰队规划的备选列表规则：
 * 1. 默认至少显示六个槽位，可通过“增加备选”继续扩展。
 * 2. 图鉴可填入或替换当前备选槽，删除后自动压缩。
 * 3. 备选槽支持拖拽排序，并可与主选槽互相拖动或交换。
 *
 * 保存时空槽不会写入 gui_settings.json。
 */
import type {
  ShipLibraryLabels,
  ShipLibraryManifest,
  ShipLibraryShip,
} from '../../types/ipc.js';
import {
  SHIP_TYPE_FILTER_ORDER,
  TYPE_LABELS,
} from '../../shared/fleetShipTypes';
import {
  showAlert,
  showConfirm,
  showSaveSuccess,
} from '../../controller/shared/DialogHelper';
import {
  captureScrollPosition,
  restoreScrollPosition,
} from '../shared/scrollPosition';
import { createShipArtwork } from './ShipArtwork';

export type DecisiveLevel = 'level1' | 'level2';
type FilterKind = 'group' | 'type' | 'country';
type SortField = 'type' | 'name' | 'id';

export interface DecisivePlanViewState {
  chapter: number;
  useQuickRepair: boolean;
  level1: readonly string[];
  level2: readonly string[];
  dirty: boolean;
}

export interface DecisivePlanSaveResult {
  success: boolean;
  error?: unknown;
}

export interface DecisivePlanViewHost {
  getState(): DecisivePlanViewState;
  setChapter(chapter: number): void;
  changeChapter(chapter: number): Promise<DecisivePlanSaveResult>;
  setUseQuickRepair(useQuickRepair: boolean): void;
  findShip(name: string): { level: DecisiveLevel; index: number } | null;
  placeShip(
    name: string,
    level: DecisiveLevel,
    requestedIndex: number,
    maxIndex: number,
  ): number;
  removeShip(level: DecisiveLevel, index: number): boolean;
  moveShip(
    sourceLevel: DecisiveLevel,
    sourceIndex: number,
    targetLevel: DecisiveLevel,
    targetIndex: number,
  ): number | null;
  resetTeams(): Promise<DecisivePlanSaveResult>;
  save(): Promise<DecisivePlanSaveResult>;
}

interface DecisiveDragData {
  source?: 'gallery' | 'queue';
  shipId?: number;
  level?: DecisiveLevel;
  index?: number;
}

const LEVELS: DecisiveLevel[] = ['level1', 'level2'];
const LEVEL_LABELS: Record<DecisiveLevel, string> = {
  level1: '主选队列',
  level2: '备选队列',
};
const MAIN_SLOT_COUNT = 6;
const DEFAULT_BACKUP_SLOT_COUNT = 6;
const MIN_GALLERY_BATCH_SIZE = 12;
const GALLERY_CARD_WIDTH = 128;
const GALLERY_CARD_HEIGHT = 200;
const GALLERY_GAP = 6;
const DECISIVE_DRAG_MIME = 'application/x-autowsgr-decisive-ship';
const EMPTY_LABELS: ShipLibraryLabels = {
  ship_types: {},
  size_classes: {},
  role_classes: {},
  countries: {},
  variants: {},
};

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`缺少决战页面元素: #${id}`);
  return element as T;
}

export class DecisivePlanView {
  private readonly chapter = requiredElement<HTMLSelectElement>(
    'decisive-plan-chapter',
  );
  private readonly quickRepair = requiredElement<HTMLInputElement>(
    'decisive-plan-quick-repair',
  );
  private readonly editEnabled = requiredElement<HTMLInputElement>(
    'decisive-plan-edit-enabled',
  );
  private readonly resetButton = requiredElement<HTMLButtonElement>(
    'btn-reset-decisive-plan',
  );
  private readonly addBackupButton = requiredElement<HTMLButtonElement>(
    'btn-add-decisive-backup',
  );
  private readonly status = requiredElement<HTMLElement>(
    'decisive-plan-status',
  );
  private readonly mainList = requiredElement<HTMLElement>(
    'decisive-level1-list',
  );
  private readonly backupList = requiredElement<HTMLElement>(
    'decisive-level2-list',
  );
  private readonly backupScroll = this.backupList.parentElement!;
  private readonly gallery = requiredElement<HTMLElement>(
    'decisive-ship-gallery',
  );
  private readonly gallerySearch = requiredElement<HTMLInputElement>(
    'decisive-gallery-search',
  );
  private readonly filterButtons = Array.from(
    document.querySelectorAll<HTMLButtonElement>(
      '[data-decisive-filter-trigger]',
    ),
  );
  private readonly filterCount = requiredElement<HTMLElement>(
    'decisive-filter-count',
  );
  private readonly filterPopover = requiredElement<HTMLElement>(
    'decisive-filter-popover',
  );
  private readonly typeOptions = requiredElement<HTMLElement>(
    'decisive-filter-types',
  );
  private readonly countryOptions = requiredElement<HTMLElement>(
    'decisive-filter-countries',
  );
  private readonly refitFilter = requiredElement<HTMLInputElement>(
    'decisive-filter-refit-only',
  );
  private readonly sortDescending = requiredElement<HTMLInputElement>(
    'decisive-sort-desc',
  );
  private readonly galleryCount = requiredElement<HTMLElement>(
    'decisive-gallery-count',
  );
  private readonly galleryResizeObserver: ResizeObserver;
  private ships: ShipLibraryShip[] = [];
  private labels: ShipLibraryLabels = EMPTY_LABELS;
  private visibleGalleryShips: ShipLibraryShip[] = [];
  private renderedGalleryCount = 0;
  private galleryLevel: DecisiveLevel = 'level1';
  private activeMainIndex = 0;
  private activeBackupIndex = 0;
  private backupSlotCount = DEFAULT_BACKUP_SLOT_COUNT;
  private groupFilter: string | null = 'all';
  private typeFilters = new Set<string>();
  private countryFilters = new Set<string>();
  private refitOnly = false;
  private sortField: SortField = 'id';
  private descending = false;
  private galleryDragScrollTop: number | null = null;
  private backupDragScroll: { top: number; left: number } | null = null;
  constructor(private readonly host: DecisivePlanViewHost) {
    this.galleryResizeObserver = new ResizeObserver(
      () => this.ensureGalleryFilled(),
    );
    this.galleryResizeObserver.observe(this.gallery);
  }

  bindActions(): void {
    this.chapter.addEventListener('change', () => {
      void this.changeChapter(Number(this.chapter.value));
    });
    this.quickRepair.addEventListener('change', () => {
      this.host.setUseQuickRepair(this.quickRepair.checked);
      this.markDirty();
    });
    this.editEnabled.addEventListener('change', () => {
      this.renderEditState();
      this.renderQueues();
    });
    this.bindSlotList(this.mainList, 'level1');
    this.bindSlotList(this.backupList, 'level2');
    this.addBackupButton.addEventListener('click', () => {
      if (!this.editEnabled.checked) return;
      this.backupSlotCount = Math.max(
        this.backupSlotCount,
        this.host.getState().level2.length,
        DEFAULT_BACKUP_SLOT_COUNT,
      ) + 1;
      this.galleryLevel = 'level2';
      this.activeBackupIndex = this.backupSlotCount - 1;
      this.renderQueues();
      this.renderGalleryTarget();
    });
    this.gallerySearch.addEventListener('input', () => {
      this.renderGallery();
    });
    this.filterButtons.forEach(button => {
      button.addEventListener('click', event => {
        event.stopPropagation();
        this.setFilterPopoverOpen(this.filterPopover.hidden);
      });
    });
    this.filterPopover.addEventListener('click', event => {
      const option = (event.target as HTMLElement).closest<HTMLButtonElement>(
        '[data-filter-kind]',
      );
      if (option) {
        this.setFilter(
          option.dataset['filterKind'] as FilterKind,
          option.dataset['filterValue'] ?? 'all',
        );
      }
      const sortOption = (event.target as HTMLElement).closest<HTMLButtonElement>(
        '[data-sort-field]',
      );
      if (sortOption) {
        this.sortField = sortOption.dataset['sortField'] as SortField;
        this.updateFilterControls();
        this.renderGallery();
      }
    });
    this.sortDescending.addEventListener('change', () => {
      this.descending = this.sortDescending.checked;
      this.updateFilterControls();
      this.renderGallery();
    });
    this.refitFilter.addEventListener('change', () => {
      this.refitOnly = this.refitFilter.checked;
      this.updateFilterControls();
      this.renderGallery();
    });
    requiredElement<HTMLButtonElement>('btn-reset-decisive-filter')
      .addEventListener('click', () => {
        this.groupFilter = 'all';
        this.typeFilters.clear();
        this.countryFilters.clear();
        this.refitOnly = false;
        this.sortField = 'id';
        this.descending = false;
        this.updateFilterControls();
        this.renderGallery();
      });
    requiredElement<HTMLButtonElement>('btn-confirm-decisive-filter')
      .addEventListener('click', () => this.setFilterPopoverOpen(false));
    document.addEventListener('click', event => {
      const target = event.target as Node;
      if (
        !this.filterPopover.hidden
        && !this.filterPopover.contains(target)
        && !this.filterButtons.some(button => button.contains(target))
      ) {
        this.setFilterPopoverOpen(false);
      }
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') this.setFilterPopoverOpen(false);
    });
    this.gallery.addEventListener('click', event => {
      const card = (event.target as HTMLElement).closest<HTMLButtonElement>(
        '[data-decisive-gallery-ship-id]',
      );
      if (!card) return;
      const shipId = Number(card.dataset['decisiveGalleryShipId']);
      const ship = this.ships.find(item => item.id === shipId);
      if (ship) this.assignGalleryShip(ship);
    });
    this.gallery.addEventListener('dragstart', event => {
      const card = (event.target as HTMLElement).closest<HTMLElement>(
        '[data-decisive-gallery-ship-id]',
      );
      if (!card || !event.dataTransfer || !this.editEnabled.checked) return;
      this.galleryDragScrollTop = this.gallery.scrollTop;
      this.rememberBackupScroll();
      event.dataTransfer.effectAllowed = 'copyMove';
      event.dataTransfer.setData(
        DECISIVE_DRAG_MIME,
        JSON.stringify({
          source: 'gallery',
          shipId: Number(card.dataset['decisiveGalleryShipId']),
        } satisfies DecisiveDragData),
      );
    });
    this.gallery.addEventListener('dragend', () => {
      this.galleryDragScrollTop = null;
      this.backupDragScroll = null;
      this.clearDragOver();
    });
    this.gallery.addEventListener('scroll', () => {
      const remaining = this.gallery.scrollHeight
        - this.gallery.scrollTop
        - this.gallery.clientHeight;
      if (remaining < 480) this.appendGalleryBatch();
    });
    requiredElement<HTMLButtonElement>('btn-save-decisive-plan')
      .addEventListener('click', () => void this.save());
    this.resetButton.addEventListener('click', () => void this.resetTeam());
  }

  showLoaded(manifest: ShipLibraryManifest): void {
    this.loadShipLibrary(manifest);
    this.backupSlotCount = Math.max(
      DEFAULT_BACKUP_SLOT_COUNT,
      this.host.getState().level2.length,
    );
    this.render();
    this.setStatus('配置已加载');
  }

  showLoadFailure(): void {
    this.loadShipLibrary(null);
    this.backupSlotCount = Math.max(
      DEFAULT_BACKUP_SLOT_COUNT,
      this.host.getState().level2.length,
    );
    this.render();
    this.setStatus('读取失败，已使用默认队伍', true);
  }

  showChapterLoaded(): void {
    this.backupSlotCount = Math.max(
      DEFAULT_BACKUP_SLOT_COUNT,
      this.host.getState().level2.length,
    );
    this.render();
    this.setStatus(`第 ${this.host.getState().chapter} 章配置已加载`);
  }

  private bindSlotList(
    list: HTMLElement,
    level: DecisiveLevel,
  ): void {
    list.addEventListener('click', event => {
      const target = event.target as HTMLElement;
      const remove = target.closest<HTMLButtonElement>(
        '[data-decisive-remove-index]',
      );
      if (remove) {
        if (!this.editEnabled.checked) return;
        event.stopPropagation();
        const index = Number(remove.dataset['decisiveRemoveIndex']);
        this.removeShip(level, index);
        return;
      }
      const slot = target.closest<HTMLButtonElement>('[data-decisive-slot-index]');
      if (!slot) return;
      const index = Number(slot.dataset['decisiveSlotIndex']);
      if (!Number.isInteger(index) || index < 0) return;
      this.selectSlot(level, index);
    });
  }

  private loadShipLibrary(manifest: ShipLibraryManifest | null): void {
    if (!manifest?.ships) {
      this.galleryCount.textContent = '图鉴不可用';
      this.labels = EMPTY_LABELS;
      this.ships = [];
      return;
    }

    this.labels = {
      ...EMPTY_LABELS,
      ...manifest.labels,
    };
    this.ships = manifest.ships.filter(ship => (
      Number.isFinite(ship.id)
      && Boolean(ship.name)
      && Boolean(ship.search_name)
      && Boolean(ship.portraitUrl)
    ));
    this.renderFilterOptions();
  }

  private render(): void {
    const state = this.host.getState();
    this.chapter.value = String(state.chapter);
    this.quickRepair.checked = state.useQuickRepair;
    this.editEnabled.checked = false;
    this.renderEditState();
    this.renderQueues();
    this.renderGallery();
    this.renderGalleryTarget();
  }

  private renderEditState(): void {
    const editing = this.editEnabled.checked;
    this.resetButton.disabled = !editing;
    this.addBackupButton.disabled = !editing;
    this.gallery.classList.toggle('is-locked', !editing);
    this.gallery
      .querySelectorAll<HTMLButtonElement>('[data-decisive-gallery-ship-id]')
      .forEach(card => {
        card.disabled = !editing;
        card.draggable = editing;
      });
  }

  private renderQueues(): void {
    const state = this.host.getState();
    const mainScroll = this.mainList.closest<HTMLElement>('.fleet-slot-scroll');
    const mainScrollPosition = captureScrollPosition(mainScroll);
    const mainFragment = document.createDocumentFragment();
    const mainQueue = state.level1;
    for (let index = 0; index < MAIN_SLOT_COUNT; index += 1) {
      mainFragment.append(
        this.createFleetSlot('level1', index, mainQueue[index]),
      );
    }
    this.mainList.replaceChildren(mainFragment);
    restoreScrollPosition(mainScroll, mainScrollPosition);

    const backupScrollPosition = this.backupDragScroll
      ?? captureScrollPosition(this.backupScroll);
    this.backupSlotCount = Math.max(
      DEFAULT_BACKUP_SLOT_COUNT,
      this.backupSlotCount,
      state.level2.length,
    );
    const backupQueue = state.level2;
    const backupFragment = document.createDocumentFragment();
    for (let index = 0; index < this.backupSlotCount; index += 1) {
      backupFragment.append(
        this.createFleetSlot('level2', index, backupQueue[index]),
      );
    }
    this.backupList.replaceChildren(backupFragment);
    restoreScrollPosition(this.backupScroll, backupScrollPosition);

    requiredElement<HTMLElement>('decisive-level2-count').textContent =
      `${backupQueue.length} 艘`;
  }

  private createFleetSlot(
    level: DecisiveLevel,
    index: number,
    name?: string,
  ): HTMLButtonElement {
    const slot = document.createElement('button');
    slot.type = 'button';
    slot.className = `fleet-slot fleet-${
      level === 'level1' ? 'formation' : 'backup'
    }-slot`;
    slot.dataset['decisiveSlotIndex'] = String(index);
    slot.dataset['decisiveSlotLevel'] = level;
    const active = level === this.galleryLevel
      && index === (
        level === 'level1' ? this.activeMainIndex : this.activeBackupIndex
      );
    slot.classList.toggle('active', active);
    slot.draggable = this.editEnabled.checked && Boolean(name);
    slot.title = name
      ? `${LEVEL_LABELS[level]}第 ${index + 1} 位：${name}`
      : `${LEVEL_LABELS[level]}第 ${index + 1} 个空槽`;

    if (name) {
      const ship = this.findDisplayShip(name);
      if (ship) {
        slot.append(createShipArtwork(
          ship,
          this.shipTypeDisplay(ship),
        ));
      } else {
        const fallback = document.createElement('span');
        fallback.className = 'fleet-slot-empty';
        fallback.textContent = name;
        slot.append(fallback);
      }
      if (this.editEnabled.checked) {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'fleet-slot-remove';
        remove.dataset['decisiveRemoveIndex'] = String(index);
        remove.title = `移除 ${name}`;
        remove.setAttribute('aria-label', `移除 ${name}`);
        remove.textContent = '×';
        slot.append(remove);
      }
    } else {
      const empty = document.createElement('span');
      empty.className = 'fleet-slot-empty';
      empty.textContent = level === 'level1'
        ? `位置 ${index + 1}`
        : `备选 ${index + 1}`;
      slot.append(empty);
    }

    if (this.editEnabled.checked && name) {
      slot.addEventListener('dragstart', event => {
        if (!event.dataTransfer) return;
        this.rememberBackupScroll();
        slot.classList.add('is-dragging');
        event.dataTransfer.effectAllowed = 'copyMove';
        event.dataTransfer.setData(
          DECISIVE_DRAG_MIME,
          JSON.stringify({
            source: 'queue',
            level,
            index,
          } satisfies DecisiveDragData),
        );
      });
      slot.addEventListener('dragend', () => {
        this.backupDragScroll = null;
        slot.classList.remove('is-dragging');
        this.clearDragOver();
      });
    }
    if (this.editEnabled.checked) {
      slot.addEventListener('dragover', event => {
        if (!event.dataTransfer?.types.includes(DECISIVE_DRAG_MIME)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        slot.classList.add('drag-over');
      });
      slot.addEventListener('dragleave', event => {
        if (!slot.contains(event.relatedTarget as Node | null)) {
          slot.classList.remove('drag-over');
        }
      });
      slot.addEventListener('drop', event => {
        if (!event.dataTransfer) return;
        event.preventDefault();
        slot.classList.remove('drag-over');
        this.handleDrop(
          event.dataTransfer.getData(DECISIVE_DRAG_MIME),
          level,
          index,
        );
      });
    }
    return slot;
  }

  private selectSlot(level: DecisiveLevel, index: number): void {
    this.galleryLevel = level;
    if (level === 'level1') {
      if (index >= MAIN_SLOT_COUNT) return;
      this.activeMainIndex = index;
    } else {
      if (index >= this.backupSlotCount) return;
      this.activeBackupIndex = index;
    }
    this.renderQueues();
    this.renderGalleryTarget();
    if (level === 'level2') this.scrollBackupSlotIntoView(index);
  }

  private assignGalleryShip(ship: ShipLibraryShip): void {
    if (!this.editEnabled.checked) return;
    const existing = this.findConfiguredShip(ship.search_name);
    if (existing) {
      this.selectSlot(existing.level, existing.index);
      return;
    }

    const level = this.galleryLevel;
    let target: number;
    let replacing: boolean;
    const state = this.host.getState();
    if (level === 'level1') {
      const queueLength = state.level1.length;
      const firstEmpty = queueLength < MAIN_SLOT_COUNT
        ? queueLength
        : -1;
      replacing = this.activeMainIndex < queueLength;
      target = replacing || firstEmpty < 0
        ? this.activeMainIndex
        : firstEmpty;
    } else {
      const queueLength = state.level2.length;
      const firstEmpty = queueLength < this.backupSlotCount
        ? queueLength
        : -1;
      replacing = this.activeBackupIndex < queueLength;
      target = replacing || firstEmpty < 0
        ? this.activeBackupIndex
        : firstEmpty;
    }
    this.placeGalleryShip(ship, level, target, !replacing);
  }

  private placeGalleryShip(
    ship: ShipLibraryShip,
    level: DecisiveLevel,
    requestedIndex: number,
    advanceToNextEmpty: boolean,
  ): void {
    if (!this.editEnabled.checked) return;
    const existing = this.findConfiguredShip(ship.search_name);
    if (existing) {
      this.selectSlot(existing.level, existing.index);
      return;
    }

    const maxIndex = level === 'level1'
      ? MAIN_SLOT_COUNT - 1
      : this.backupSlotCount - 1;
    const target = this.host.placeShip(
      ship.search_name,
      level,
      requestedIndex,
      maxIndex,
    );
    const queueLength = this.host.getState()[level].length;

    this.galleryLevel = level;
    if (level === 'level1') {
      this.activeMainIndex = target;
      if (advanceToNextEmpty && queueLength < MAIN_SLOT_COUNT) {
        this.activeMainIndex = queueLength;
      }
    } else {
      this.activeBackupIndex = target;
      if (advanceToNextEmpty && target + 1 < this.backupSlotCount) {
        this.activeBackupIndex = target + 1;
      }
    }
    this.markDirty();
    this.renderQueues();
    this.renderGallery(false);
    this.renderGalleryTarget();
    if (level === 'level2') this.scrollBackupSlotIntoView(this.activeBackupIndex);
  }

  private removeShip(level: DecisiveLevel, index: number): void {
    if (!this.host.removeShip(level, index)) return;
    if (level === 'level1') {
      this.activeMainIndex = Math.min(this.activeMainIndex, MAIN_SLOT_COUNT - 1);
    } else {
      this.backupSlotCount = Math.max(
        DEFAULT_BACKUP_SLOT_COUNT,
        this.host.getState().level2.length,
      );
      this.activeBackupIndex = Math.min(
        this.activeBackupIndex,
        this.backupSlotCount - 1,
      );
    }
    this.markDirty();
    this.renderQueues();
    this.renderGallery(false);
  }

  private handleDrop(
    raw: string,
    targetLevel: DecisiveLevel,
    targetIndex: number,
  ): void {
    if (!this.editEnabled.checked) return;
    try {
      const source = JSON.parse(raw) as DecisiveDragData;
      if (source.source === 'gallery') {
        const ship = this.ships.find(item => item.id === Number(source.shipId));
        if (ship) this.placeGalleryShip(ship, targetLevel, targetIndex, false);
        return;
      }
      if (
        source.source !== 'queue'
        || !LEVELS.includes(source.level as DecisiveLevel)
        || !Number.isInteger(source.index)
      ) {
        return;
      }
      this.moveQueueShip(
        source.level as DecisiveLevel,
        Number(source.index),
        targetLevel,
        targetIndex,
      );
    } catch {
      // 忽略非本页面产生的拖拽数据。
    } finally {
      this.galleryDragScrollTop = null;
      this.backupDragScroll = null;
      this.clearDragOver();
    }
  }

  private moveQueueShip(
    sourceLevel: DecisiveLevel,
    sourceIndex: number,
    targetLevel: DecisiveLevel,
    targetIndex: number,
  ): void {
    const movedTarget = this.host.moveShip(
      sourceLevel,
      sourceIndex,
      targetLevel,
      targetIndex,
    );
    if (movedTarget === null) return;
    targetIndex = movedTarget;

    this.galleryLevel = targetLevel;
    if (targetLevel === 'level1') {
      this.activeMainIndex = Math.min(targetIndex, MAIN_SLOT_COUNT - 1);
    } else {
      this.activeBackupIndex = targetIndex;
    }
    this.backupSlotCount = Math.max(
      DEFAULT_BACKUP_SLOT_COUNT,
      this.host.getState().level2.length,
    );
    this.markDirty();
    this.renderQueues();
    this.renderGallery(false);
    this.renderGalleryTarget();
    if (targetLevel === 'level2') this.scrollBackupSlotIntoView(targetIndex);
  }

  private clearDragOver(): void {
    document
      .querySelectorAll('.decisive-plan-card .fleet-slot.drag-over')
      .forEach(slot => slot.classList.remove('drag-over'));
  }

  private rememberBackupScroll(): void {
    this.backupDragScroll = captureScrollPosition(this.backupScroll);
  }

  private scrollBackupSlotIntoView(index: number): void {
    requestAnimationFrame(() => {
      this.backupList.querySelector<HTMLElement>(
        `[data-decisive-slot-index="${index}"]`,
      )?.scrollIntoView({
        block: 'nearest',
        inline: 'nearest',
      });
    });
  }

  private findDisplayShip(name: string): ShipLibraryShip | undefined {
    return this.ships.find(ship => (
      ship.search_name === name && ship.variant === 'normal'
    )) ?? this.ships.find(ship => ship.search_name === name);
  }

  private findConfiguredShip(
    name: string,
  ): { level: DecisiveLevel; index: number } | null {
    return this.host.findShip(name);
  }

  private renderGalleryTarget(): void {
    this.gallery
      .querySelectorAll<HTMLButtonElement>('[data-decisive-gallery-ship-id]')
      .forEach(card => {
        const shipId = Number(card.dataset['decisiveGalleryShipId']);
        const ship = this.ships.find(item => item.id === shipId);
        if (ship) this.updateGalleryCard(card, ship);
      });
    this.updateGalleryCount();
  }

  private setFilter(kind: FilterKind, value: string): void {
    if (kind === 'group') {
      this.groupFilter = value;
      this.typeFilters.clear();
      if (value !== 'all') {
        this.ships.forEach(ship => {
          if (
            (ship.size_class === value || ship.role_class === value)
            && SHIP_TYPE_FILTER_ORDER.includes(ship.ship_type)
          ) {
            this.typeFilters.add(ship.ship_type);
          }
        });
      }
    } else {
      const filters = kind === 'type'
        ? this.typeFilters
        : this.countryFilters;
      if (kind === 'type') this.groupFilter = null;
      if (value === 'all') {
        filters.clear();
      } else if (filters.has(value)) {
        filters.delete(value);
      } else {
        filters.add(value);
      }
    }
    this.updateFilterControls();
    this.renderGallery();
  }

  private setFilterPopoverOpen(open: boolean): void {
    this.filterPopover.hidden = !open;
    this.filterButtons.forEach(button => {
      button.setAttribute(
        'aria-expanded',
        String(open && button.dataset['decisiveFilterTrigger'] === 'filter'),
      );
    });
  }

  private renderFilterOptions(): void {
    this.typeOptions.replaceChildren(
      this.createFilterOption('type', 'all', '全部'),
      ...SHIP_TYPE_FILTER_ORDER
        .filter(code => this.labels.ship_types[code] !== undefined)
        .map(code => this.createFilterOption(
          'type',
          code,
          TYPE_LABELS[code] ?? this.labels.ship_types[code]!,
        )),
    );
    this.countryOptions.replaceChildren(
      this.createFilterOption('country', 'all', '全部'),
      ...Object.entries(this.labels.countries)
        .map(([code, label]) => (
          this.createFilterOption('country', code, label)
        )),
    );
    this.updateFilterControls();
  }

  private createFilterOption(
    kind: FilterKind,
    value: string,
    label: string,
  ): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'fleet-filter-option';
    button.dataset['filterKind'] = kind;
    button.dataset['filterValue'] = value;
    button.setAttribute('aria-pressed', 'false');
    button.textContent = label;
    return button;
  }

  private updateFilterControls(): void {
    this.filterPopover
      .querySelectorAll<HTMLElement>('[data-filter-kind]')
      .forEach(item => {
        const kind = item.dataset['filterKind'];
        const value = item.dataset['filterValue'] ?? 'all';
        const active = kind === 'group'
          ? value === this.groupFilter
          : kind === 'type'
            ? value === 'all'
              ? this.typeFilters.size === 0
              : this.typeFilters.has(value)
            : value === 'all'
              ? this.countryFilters.size === 0
              : this.countryFilters.has(value);
        item.classList.toggle('active', active);
        item.setAttribute('aria-pressed', String(active));
      });
    this.filterPopover
      .querySelectorAll<HTMLElement>('[data-sort-field]')
      .forEach(item => {
        item.classList.toggle(
          'active',
          item.dataset['sortField'] === this.sortField,
        );
      });
    this.sortDescending.checked = this.descending;
    this.refitFilter.checked = this.refitOnly;
    const activeFilterCount = [
      this.typeFilters.size > 0,
      this.countryFilters.size > 0,
      this.refitOnly,
    ].filter(Boolean).length;
    this.filterCount.textContent = activeFilterCount > 0
      ? String(activeFilterCount)
      : '';
    this.filterButtons.forEach(button => {
      button.classList.toggle(
        'active',
        activeFilterCount > 0
          || this.sortField !== 'id'
          || this.descending,
      );
    });
  }

  private renderGallery(resetScroll = true): void {
    const preservedScroll = captureScrollPosition(this.gallery);
    if (!resetScroll && this.galleryDragScrollTop !== null) {
      preservedScroll.top = this.galleryDragScrollTop;
    }
    const previousRenderedCount = resetScroll
      ? 0
      : this.renderedGalleryCount;
    const search = this.normalizeGallerySearch(this.gallerySearch.value);
    const state = this.host.getState();
    const selectedNames = new Set([
      ...state.level1,
      ...state.level2,
    ]);
    const refitSearchNames = this.refitOnly
      ? new Set(
          this.ships
            .filter(ship => ship.variant === 'refit')
            .map(ship => ship.search_name),
        )
      : null;
    this.visibleGalleryShips = this.ships.filter(ship => {
      const typeMatches = this.typeFilters.size === 0
        || this.typeFilters.has(ship.ship_type);
      const countryMatches = this.countryFilters.size === 0
        || this.countryFilters.has(ship.country);
      const refitMatches = refitSearchNames === null
        || ship.variant === 'refit'
        || !refitSearchNames.has(ship.search_name);
      const searchMatches = !search || [
        ship.name,
        ship.search_name,
        String(ship.id),
        this.labels.ship_types[ship.ship_type] ?? '',
        ship.ship_type,
      ].some(value => this.normalizeGallerySearch(value).includes(search));
      return !selectedNames.has(ship.search_name)
        && typeMatches
        && countryMatches
        && refitMatches
        && searchMatches;
    });

    const direction = this.descending ? -1 : 1;
    this.visibleGalleryShips.sort((left, right) => {
      let result = 0;
      if (this.sortField === 'name') {
        result = left.name.localeCompare(right.name, 'zh-CN');
      } else if (this.sortField === 'type') {
        const leftType = this.labels.ship_types[left.ship_type] ?? left.ship_type;
        const rightType = this.labels.ship_types[right.ship_type] ?? right.ship_type;
        result = leftType.localeCompare(rightType, 'zh-CN');
      } else {
        result = left.id - right.id;
      }
      return (result || left.id - right.id) * direction;
    });

    this.renderedGalleryCount = 0;
    this.gallery.replaceChildren();
    this.updateGalleryCount();
    if (this.visibleGalleryShips.length === 0) {
      this.showGalleryMessage(
        this.ships.length === 0
          ? '舰船资料库不可用'
          : '没有符合当前条件的舰娘',
      );
      return;
    }
    this.appendGalleryBatch(Math.max(
      this.galleryBatchSize(),
      previousRenderedCount,
    ));
    restoreScrollPosition(
      this.gallery,
      resetScroll ? { top: 0, left: 0 } : preservedScroll,
    );
  }

  /** 根据图鉴当前宽高计算首屏和下一批需要的卡片数量。 */
  private galleryBatchSize(): number {
    const columns = Math.max(
      1,
      Math.floor(
        (this.gallery.clientWidth + GALLERY_GAP)
        / (GALLERY_CARD_WIDTH + GALLERY_GAP),
      ),
    );
    const visibleRows = Math.max(
      1,
      Math.ceil(
        (this.gallery.clientHeight + GALLERY_GAP)
        / (GALLERY_CARD_HEIGHT + GALLERY_GAP),
      ),
    );
    return Math.max(
      MIN_GALLERY_BATCH_SIZE,
      columns * (visibleRows + 2),
    );
  }

  /** 窗口变大时补齐新增列和可见行，不重建图鉴。 */
  private ensureGalleryFilled(): void {
    if (this.visibleGalleryShips.length === 0) return;
    const missingCount = this.galleryBatchSize() - this.renderedGalleryCount;
    if (missingCount > 0) this.appendGalleryBatch(missingCount);
  }

  private appendGalleryBatch(count = this.galleryBatchSize()): void {
    if (this.renderedGalleryCount >= this.visibleGalleryShips.length) return;
    const preservedScroll = captureScrollPosition(this.gallery);
    const fragment = document.createDocumentFragment();
    const end = Math.min(
      this.renderedGalleryCount + count,
      this.visibleGalleryShips.length,
    );
    for (let index = this.renderedGalleryCount; index < end; index += 1) {
      fragment.append(this.createGalleryCard(this.visibleGalleryShips[index]));
    }
    this.renderedGalleryCount = end;
    this.gallery.append(fragment);
    restoreScrollPosition(this.gallery, preservedScroll);
  }

  private createGalleryCard(ship: ShipLibraryShip): HTMLButtonElement {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'fleet-ship-card';
    card.dataset['decisiveGalleryShipId'] = String(ship.id);
    card.append(createShipArtwork(ship, this.shipTypeDisplay(ship)));
    this.updateGalleryCard(card, ship);
    return card;
  }

  private updateGalleryCard(
    card: HTMLButtonElement,
    ship: ShipLibraryShip,
  ): void {
    const editing = this.editEnabled.checked;
    card.disabled = !editing;
    card.draggable = editing;
    card.title = `将 ${ship.search_name} 放入${this.activeSlotDescription()}`;
  }

  private activeSlotDescription(): string {
    if (this.galleryLevel === 'level1') {
      return `主选位置 ${this.activeMainIndex + 1}`;
    }
    return `第 ${this.activeBackupIndex + 1} 个备选槽位`;
  }

  private updateGalleryCount(): void {
    if (this.ships.length === 0) {
      this.galleryCount.textContent = '图鉴不可用';
      return;
    }
    this.galleryCount.textContent =
      `显示 ${this.visibleGalleryShips.length} / ${this.ships.length} 艘`;
  }

  private normalizeGallerySearch(value: string): string {
    return value
      .toLocaleLowerCase('zh-CN')
      .replace(/[\s·•._-]+/g, '');
  }

  private async resetTeam(): Promise<void> {
    if (!this.editEnabled.checked) return;
    const confirmed = await showConfirm(
      '恢复默认决战队伍',
      '将按照GUI2.0提供的默认配置恢复当前队伍队列，此行为将会覆盖继承至旧目录的决战配置。恢复后请点击保存配置。',
    );
    if (!confirmed) return;
    const result = await this.host.resetTeams();
    if (!result.success) {
      this.setStatus('恢复默认配置失败', true);
      await showAlert(
        '恢复失败',
        result.error instanceof Error
          ? result.error.message
          : String(result.error ?? '未知错误'),
      );
      return;
    }
    this.activeMainIndex = 0;
    this.activeBackupIndex = 0;
    this.galleryLevel = 'level1';
    this.backupSlotCount = Math.max(
      DEFAULT_BACKUP_SLOT_COUNT,
      this.host.getState().level2.length,
    );
    this.markDirty();
    this.renderQueues();
    this.renderGallery(false);
    this.renderGalleryTarget();
  }

  private async changeChapter(chapter: number): Promise<void> {
    const previousChapter = this.host.getState().chapter;
    if (chapter === previousChapter) return;
    if (this.host.getState().dirty) {
      const confirmed = await showConfirm(
        '切换决战章节',
        `第 ${previousChapter} 章有未保存修改，切换章节将放弃这些修改。是否继续？`,
      );
      if (!confirmed) {
        this.chapter.value = String(previousChapter);
        return;
      }
    }

    this.chapter.disabled = true;
    this.setStatus(`正在读取第 ${chapter} 章配置…`);
    const result = await this.host.changeChapter(chapter);
    this.chapter.disabled = false;
    if (result.success) {
      this.showChapterLoaded();
      return;
    }

    this.chapter.value = String(previousChapter);
    this.setStatus(`第 ${chapter} 章配置读取失败`, true);
    await showAlert(
      '切换章节失败',
      result.error instanceof Error
        ? result.error.message
        : String(result.error ?? '未知错误'),
    );
  }

  private async save(showSavedStatus = true): Promise<boolean> {
    this.host.setChapter(Number(this.chapter.value));
    this.host.setUseQuickRepair(this.quickRepair.checked);
    const result = await this.host.save();
    if (result.success) {
      if (showSavedStatus) {
        this.setStatus('配置已保存');
        showSaveSuccess('决战配置保存成功');
      }
      return true;
    }
    this.setStatus('配置保存失败', true);
    await showAlert(
      '保存失败',
      result.error instanceof Error
        ? result.error.message
        : String(result.error ?? '未知错误'),
    );
    return false;
  }

  private markDirty(): void {
    this.setStatus('有未保存修改');
  }

  private setStatus(message: string, error = false): void {
    this.status.textContent = message;
    this.status.classList.toggle('is-error', error);
    this.status.classList.toggle(
      'is-dirty',
      this.host.getState().dirty && !error,
    );
  }

  private shipTypeDisplay(ship: ShipLibraryShip): string {
    const typeName = TYPE_LABELS[ship.ship_type]
      ?? this.labels.ship_types[ship.ship_type]
      ?? ship.ship_type;
    return `${typeName}-${ship.ship_type.toUpperCase()}`;
  }

  private showGalleryMessage(message: string): void {
    const empty = document.createElement('div');
    empty.className = 'fleet-library-empty';
    empty.textContent = message;
    this.gallery.replaceChildren(empty);
  }
}
