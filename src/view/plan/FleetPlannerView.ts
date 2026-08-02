/**
 * FleetPlannerView —— 本地舰队规划页面。
 * 读取 Electron 提供的舰船清单，负责筛选、排序、图鉴卡片和单支舰队草稿。
 * 国籍、大小和主力/护卫仅用于界面筛选，不会写入后端任务字段。
 */
import type {
  ManagedTeamPlan,
  PlanFileReadError,
  PlanPresetSource,
  PlanTeamBinding,
  ShipLibraryLabels,
  ShipLibraryManifest,
  ShipLibraryShip,
  UserTeamPlan,
  UserTeamPlanSlot,
  UserTeamShipRule,
} from '../../types/electronBridge';
import {
  showAlert,
  showConfirm,
  showPrompt,
  showSaveSuccess,
} from '../../controller/shared/DialogHelper';
import {
  appendTeamPlanCardContent,
  compareTeamPlans,
  filterAndSortTeamPlans,
  teamPlanCardData,
} from './TeamPlanListUi';
import type { TeamPlanSortField } from './TeamPlanListUi';
import {
  captureScrollPosition,
  restoreScrollPosition,
} from '../shared/scrollPosition';
import { createShipArtwork } from './ShipArtwork';

type SortField = 'type' | 'name' | 'id';
type FilterKind = 'group' | 'type' | 'country';
type SlotGroup = 'formation' | 'backup';
type ManagementSource = PlanPresetSource | 'all';
type ManagementKind = 'battle' | 'team' | 'all';

interface PlanManagementTaskGroup {
  name: string;
  items: ReadonlyArray<{
    kind: string;
    path?: string;
    managedSource?: PlanPresetSource;
    managedFile?: string;
  }>;
}

interface FleetDragData {
  source?: 'gallery' | SlotGroup;
  shipId?: number;
  position?: number;
  candidateIndex?: number;
}

const DEFAULT_BACKUP_SLOT_COUNT = 6;
const MIN_GALLERY_BATCH_SIZE = 12;
const GALLERY_CARD_WIDTH = 128;
const GALLERY_CARD_HEIGHT = 200;
const GALLERY_GAP = 6;
const FLEET_SLOT_COUNT = 6;
const FLEET_DRAG_MIME = 'application/x-autowsgr-fleet';
const REFIT_FILTER_STORAGE_KEY = 'fleetPlannerRefitFilter';
const EMPTY_LABELS: ShipLibraryLabels = {
  ship_types: {},
  size_classes: {},
  role_classes: {},
  countries: {},
  variants: {},
};

const SHIP_TYPE_SHORT_NAMES: Record<string, string> = {
  ap: '补给',
  av: '装母',
  bb: '战列',
  bbg: '导战',
  bbv: '航战',
  bc: '战巡',
  bm: '重炮',
  ca: '重巡',
  cav: '航巡',
  cbg: '大巡',
  cf: '旗舰',
  cg: '导巡',
  cgaa: '防巡',
  cl: '轻巡',
  clt: '雷巡',
  cv: '航母',
  cvl: '轻母',
  dd: '驱逐',
  ddg: '导驱',
  ddgaa: '防驱',
  sc: '炮潜',
  ss: '潜艇',
  ssg: '导潜',
};

const SHIP_TYPE_FILTER_ORDER = [
  'ap',
  'av',
  'cv',
  'bb',
  'bbg',
  'bbv',
  'bc',
  'bm',
  'ca',
  'cav',
  'cl',
  'clt',
  'cvl',
  'dd',
  'ddg',
  'cg',
  'ssg',
  'sc',
  'ss',
  'ddgaa',
  'cgaa',
  'cbg',
];

const ALLOWED_FLEET_SHIP_TYPES = new Set([
  'dd',
  'cl',
  'ca',
  'cav',
  'clt',
  'bb',
  'bc',
  'bbv',
  'cv',
  'cvl',
  'av',
  'ss',
  'ssg',
  'cg',
  'cgaa',
  'ddg',
  'ddgaa',
  'bm',
  'cbg',
  'cf',
  'ss_or_ssg',
]);

interface FleetRuleDraft {
  shipTypes: string[];
  levelEnabled: boolean;
  minLevel: number | null;
  maxLevel: number | null;
}

interface FleetCandidateDraft extends FleetRuleDraft {
  ship: ShipLibraryShip | null;
}

interface FleetSlotDraft extends FleetRuleDraft {
  primary: ShipLibraryShip | null;
  candidates: FleetCandidateDraft[];
}

interface FleetDraft {
  name: string;
  file: string | null;
  source: PlanPresetSource;
  slots: FleetSlotDraft[];
}

function createFleetRuleDraft(): FleetRuleDraft {
  return {
    shipTypes: [],
    levelEnabled: false,
    minLevel: null,
    maxLevel: null,
  };
}

function createFleetCandidateDraft(
  ship: ShipLibraryShip | null = null,
): FleetCandidateDraft {
  return {
    ship,
    ...createFleetRuleDraft(),
  };
}

function createFleetSlotDraft(): FleetSlotDraft {
  return {
    primary: null,
    candidates: Array.from(
      { length: DEFAULT_BACKUP_SLOT_COUNT },
      () => createFleetCandidateDraft(),
    ),
    ...createFleetRuleDraft(),
  };
}

function createFleetDraft(): FleetDraft {
  return {
    name: '',
    file: null,
    source: 'user',
    slots: Array.from(
      { length: FLEET_SLOT_COUNT },
      createFleetSlotDraft,
    ),
  };
}

export class FleetPlannerView {
  onOpenBattlePlan: (
    (file: string, source: PlanPresetSource) => Promise<void>
  ) | null = null;

  private taskGroupsProvider: () => ReadonlyArray<PlanManagementTaskGroup>
    = () => [];

  private readonly slotList: HTMLElement;
  private readonly backupSlotList: HTMLElement;
  private readonly backupScroll: HTMLElement;
  private readonly gallery: HTMLElement;
  private readonly countLabel: HTMLElement;
  private readonly searchInput: HTMLInputElement;
  private readonly filterButtons: HTMLButtonElement[];
  private readonly filterCount: HTMLElement;
  private readonly filterPopover: HTMLElement;
  private readonly typeOptions: HTMLElement;
  private readonly countryOptions: HTMLElement;
  private readonly refitFilter: HTMLInputElement;
  private readonly sortDescending: HTMLInputElement;
  private readonly presetNameInput: HTMLInputElement;
  private readonly levelEnabled: HTMLInputElement;
  private readonly levelFields: HTMLElement;
  private readonly minLevel: HTMLInputElement;
  private readonly maxLevel: HTMLInputElement;
  private readonly backupLevelEnabled: HTMLInputElement;
  private readonly backupLevelFields: HTMLElement;
  private readonly backupMinLevel: HTMLInputElement;
  private readonly backupMaxLevel: HTMLInputElement;
  private readonly backupTitle: HTMLElement;
  private readonly backupAppendDrop: HTMLElement;
  private readonly teamLoader: HTMLElement;
  private readonly teamLoaderSearch: HTMLInputElement;
  private readonly teamLoaderList: HTMLElement;
  private readonly teamLoaderCount: HTMLElement;
  private readonly teamLoaderFilterSystem: HTMLInputElement;
  private readonly teamLoaderSortButtons: HTMLButtonElement[];
  private readonly teamLoaderSortAscending: HTMLInputElement;
  private readonly teamLoaderPreviewTitle: HTMLElement;
  private readonly teamLoaderPreviewSlots: HTMLElement;
  private readonly teamLoaderBackupTitle: HTMLElement;
  private readonly teamLoaderBackupSlots: HTMLElement;
  private readonly teamLoaderStatus: HTMLElement;
  private readonly teamLoaderConfirm: HTMLButtonElement;
  private readonly backupCopyDialog: HTMLElement;
  private readonly backupCopyDescription: HTMLElement;
  private readonly backupCopyTargets: HTMLElement;
  private readonly managementBody: HTMLTableSectionElement | null;
  private readonly managementTabs: HTMLButtonElement[];
  private readonly managementKindButtons: HTMLButtonElement[];
  private readonly managementSearch: HTMLInputElement | null;
  private readonly managementAttentionOnly: HTMLInputElement | null;
  private readonly galleryResizeObserver: ResizeObserver;

  private manifest: ShipLibraryManifest | null = null;
  private labels: ShipLibraryLabels = EMPTY_LABELS;
  private ships: ShipLibraryShip[] = [];
  private visibleShips: ShipLibraryShip[] = [];
  private colorfulBackgroundUrl = '';
  private renderedShipCount = 0;
  private loading: Promise<void> | null = null;

  private activeSlotGroup: SlotGroup = 'formation';
  private activePosition = 0;
  private activeBackupIndex = 0;
  private fleet = createFleetDraft();
  private savedFleetSnapshot = '';
  private loadableTeamPlans: UserTeamPlan[] = [];
  private selectedLoadPlan: UserTeamPlan | null = null;
  private selectedLoadPlanPosition = 0;
  private teamLoaderSortField: TeamPlanSortField = 'modifiedAt';
  private managementSource: ManagementSource = 'all';
  private managementKind: ManagementKind = 'all';
  private managementQuery = '';
  private managementErrors: PlanFileReadError[] = [];
  private ignoredUnlinkedPlans = new Set<string>();
  private managementBindings: PlanTeamBinding[] = [];
  private managedTeamPlans: ManagedTeamPlan[] = [];

  private groupFilter: string | null = 'all';
  private typeFilters = new Set<string>();
  private countryFilters = new Set<string>();
  private refitOnly = false;
  private sortField: SortField = 'id';
  private descending = false;
  private searchText = '';
  private galleryDragScrollTop: number | null = null;
  private backupDragScroll:
    { top: number; left: number } | null = null;

  constructor() {
    this.slotList = document.getElementById('fleet-slot-list')!;
    this.backupSlotList = document.getElementById('fleet-backup-slot-list')!;
    this.backupScroll = this.backupSlotList.parentElement!;
    this.gallery = document.getElementById('fleet-ship-gallery')!;
    this.countLabel = document.getElementById('fleet-library-count')!;
    this.searchInput = document.getElementById('fleet-ship-search') as HTMLInputElement;
    this.filterButtons = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[data-fleet-filter-trigger]'),
    );
    this.filterCount = document.getElementById('fleet-filter-count')!;
    this.filterPopover = document.getElementById('fleet-filter-popover')!;
    this.typeOptions = document.getElementById('fleet-filter-types')!;
    this.countryOptions = document.getElementById('fleet-filter-countries')!;
    this.refitFilter = document.getElementById(
      'fleet-filter-refit-only',
    ) as HTMLInputElement;
    this.sortDescending = document.getElementById('fleet-sort-desc') as HTMLInputElement;
    this.refitOnly = localStorage.getItem(
      REFIT_FILTER_STORAGE_KEY,
    ) === 'true';
    this.refitFilter.checked = this.refitOnly;
    this.presetNameInput = document.getElementById(
      'fleet-preset-name',
    ) as HTMLInputElement;
    this.levelEnabled = document.getElementById(
      'fleet-level-enabled',
    ) as HTMLInputElement;
    this.levelFields = document.getElementById('fleet-level-fields')!;
    this.minLevel = document.getElementById('fleet-min-level') as HTMLInputElement;
    this.maxLevel = document.getElementById('fleet-max-level') as HTMLInputElement;
    this.backupLevelEnabled = document.getElementById(
      'fleet-backup-level-enabled',
    ) as HTMLInputElement;
    this.backupLevelFields = document.getElementById(
      'fleet-backup-level-fields',
    )!;
    this.backupMinLevel = document.getElementById(
      'fleet-backup-min-level',
    ) as HTMLInputElement;
    this.backupMaxLevel = document.getElementById(
      'fleet-backup-max-level',
    ) as HTMLInputElement;
    this.backupTitle = document.getElementById('fleet-backup-title')!;
    this.backupAppendDrop = document.getElementById(
      'fleet-backup-append-drop',
    )!;
    this.teamLoader = document.getElementById('fleet-team-loader')!;
    this.teamLoaderSearch = document.getElementById(
      'fleet-team-loader-search',
    ) as HTMLInputElement;
    this.teamLoaderList = document.getElementById('fleet-team-loader-list')!;
    this.teamLoaderCount = document.getElementById('fleet-team-loader-count')!;
    this.teamLoaderFilterSystem = document.getElementById(
      'fleet-team-loader-filter-system',
    ) as HTMLInputElement;
    this.teamLoaderSortButtons = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        '[data-team-loader-sort-field]',
      ),
    );
    this.teamLoaderSortAscending = document.getElementById(
      'fleet-team-loader-sort-asc',
    ) as HTMLInputElement;
    this.teamLoaderPreviewTitle = document.getElementById(
      'fleet-team-loader-preview-title',
    )!;
    this.teamLoaderPreviewSlots = document.getElementById(
      'fleet-team-loader-preview-slots',
    )!;
    this.teamLoaderBackupTitle = document.getElementById(
      'fleet-team-loader-backup-title',
    )!;
    this.teamLoaderBackupSlots = document.getElementById(
      'fleet-team-loader-backup-slots',
    )!;
    this.teamLoaderStatus = document.getElementById(
      'fleet-team-loader-status',
    )!;
    this.teamLoaderConfirm = document.getElementById(
      'btn-confirm-team-loader',
    ) as HTMLButtonElement;
    this.backupCopyDialog = document.getElementById(
      'fleet-backup-copy-dialog',
    )!;
    this.backupCopyDescription = document.getElementById(
      'fleet-backup-copy-description',
    )!;
    this.backupCopyTargets = document.getElementById(
      'fleet-backup-copy-targets',
    )!;
    this.managementBody = document.getElementById(
      'plan-team-management-body',
    ) as HTMLTableSectionElement | null;
    this.managementTabs = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        '[data-plan-management-source]',
      ),
    );
    this.managementKindButtons = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        '[data-plan-management-kind]',
      ),
    );
    this.managementSearch = document.getElementById(
      'plan-management-search',
    ) as HTMLInputElement | null;
    this.managementAttentionOnly = document.getElementById(
      'plan-management-attention-only',
    ) as HTMLInputElement | null;
    this.bindActions();
    this.renderSlots();
    this.renderBackupSlots();
    this.renderSlotRule();
    this.savedFleetSnapshot = this.fleetDraftSnapshot();
    this.galleryResizeObserver = new ResizeObserver(
      () => this.ensureGalleryFilled(),
    );
    this.galleryResizeObserver.observe(this.gallery);
  }

  setTaskGroupsProvider(
    provider: () => ReadonlyArray<PlanManagementTaskGroup>,
  ): void {
    this.taskGroupsProvider = provider;
  }

  /** 首次进入页面时加载资料库；更新资料库后可强制刷新。 */
  load(force = false): Promise<void> {
    if (this.loading) return this.loading;
    if (this.manifest && !force) return Promise.resolve();
    this.loading = this.loadManifest().finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  private async loadManifest(): Promise<void> {
    const bridge = window.electronBridge;
    if (!bridge?.getShipLibraryManifest) {
      this.showGalleryMessage('当前环境无法读取本地舰船资料库');
      return;
    }
    this.countLabel.textContent = '正在读取资料库…';
    try {
      this.manifest = await bridge.getShipLibraryManifest();
      this.labels = {
        ...EMPTY_LABELS,
        ...this.manifest.labels,
      };
      this.ships = this.manifest.ships.filter((ship) => (
        Number.isFinite(ship.id)
        && Boolean(ship.name)
        && Boolean(ship.portraitUrl)
      ));
      this.colorfulBackgroundUrl = this.ships.find(
        ship => ship.rarity === 6 && Boolean(ship.backgroundUrl),
      )?.backgroundUrl ?? '';
      this.renderFilterOptions();
      this.applyFilters();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.countLabel.textContent = '资料库不可用';
      this.showGalleryMessage(message);
    }
  }

  private bindActions(): void {
    this.slotList.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      const removeButton = target.closest<HTMLButtonElement>('[data-remove-slot]');
      if (removeButton) {
        const slot = Number(removeButton.dataset['removeSlot']);
        if (Number.isInteger(slot) && slot >= 0 && slot < FLEET_SLOT_COUNT) {
          const slots = this.currentFleet().slots;
          const selected = slots[slot];
          selected.primary = null;
          this.clearFleetRule(selected);
          // 仍有备选时保留位置；主选和备选都为空后才整体左移。
          this.activePosition = this.compactFleetSlots(selected, slot);
          this.activeSlotGroup = 'formation';
          this.activeBackupIndex = 0;
          this.renderSlots();
          this.renderBackupSlots();
          this.renderSlotRule();
          this.renderGallerySelection();
        }
        return;
      }
      const slotButton = target.closest<HTMLButtonElement>('[data-fleet-slot]');
      if (!slotButton) return;
      const slot = Number(slotButton.dataset['fleetSlot']);
      if (!Number.isInteger(slot) || slot < 0 || slot >= FLEET_SLOT_COUNT) return;
      const gallerySelectionChanged = this.activeSlotGroup !== 'formation';
      this.activeSlotGroup = 'formation';
      this.activePosition = slot;
      this.activeBackupIndex = 0;
      this.renderSlots();
      this.renderBackupSlots();
      this.renderSlotRule();
      if (gallerySelectionChanged) {
        this.renderGallerySelection();
      } else {
        this.updateGalleryCardTargets();
      }
    });
    this.slotList.addEventListener('dragstart', (event) => {
      const slot = (event.target as HTMLElement).closest<HTMLElement>(
        '[data-fleet-slot]',
      );
      if (!slot || !event.dataTransfer) return;
      const position = Number(slot.dataset['fleetSlot']);
      if (!this.currentFleet().slots[position]?.primary) return;
      if (position === this.activePosition) this.rememberBackupScroll();
      this.activeSlotGroup = 'formation';
      this.activePosition = position;
      this.activeBackupIndex = 0;
      this.renderBackupSlots();
      this.renderSlotRule();
      this.rememberBackupScroll();
      this.showBackupAppendDrop(true);
      event.dataTransfer.effectAllowed = 'copyMove';
      event.dataTransfer.setData(
        FLEET_DRAG_MIME,
        JSON.stringify({ source: 'formation', position }),
      );
    });
    this.slotList.addEventListener('dragover', (event) => {
      const slot = (event.target as HTMLElement).closest<HTMLElement>(
        '[data-fleet-slot]',
      );
      if (!slot || !event.dataTransfer?.types.includes(FLEET_DRAG_MIME)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      slot.classList.add('drag-over');
    });
    this.slotList.addEventListener('dragleave', (event) => {
      const slot = (event.target as HTMLElement).closest<HTMLElement>(
        '[data-fleet-slot]',
      );
      if (slot && !slot.contains(event.relatedTarget as Node | null)) {
        slot.classList.remove('drag-over');
      }
    });
    this.slotList.addEventListener('drop', (event) => {
      const slot = (event.target as HTMLElement).closest<HTMLElement>(
        '[data-fleet-slot]',
      );
      if (!slot || !event.dataTransfer) return;
      event.preventDefault();
      slot.classList.remove('drag-over');
      const position = Number(slot.dataset['fleetSlot']);
      this.handleFleetDrop(event.dataTransfer.getData(FLEET_DRAG_MIME), position);
    });
    this.slotList.addEventListener('dragend', () => {
      this.slotList.querySelectorAll('.drag-over').forEach((slot) => {
        slot.classList.remove('drag-over');
      });
      this.showBackupAppendDrop(false);
      this.backupDragScroll = null;
    });

    this.backupSlotList.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      const removeButton = target.closest<HTMLButtonElement>('[data-remove-backup-slot]');
      if (removeButton) {
        const slot = Number(removeButton.dataset['removeBackupSlot']);
        const candidates = this.currentSlot().candidates;
        if (Number.isInteger(slot) && slot >= 0 && slot < candidates.length) {
          const owner = this.currentSlot();
          // 第 7 个及以后的扩展槽随卡片一起删除，默认槽位只补足到 6 个。
          candidates.splice(slot, 1);
          this.compactCandidates(candidates);
          this.activeSlotGroup = 'backup';
          this.activeBackupIndex = Math.min(slot, candidates.length - 1);
          if (this.isFleetSlotEmpty(owner)) {
            this.activePosition = this.compactFleetSlots(
              null,
              this.activePosition,
            );
            this.activeSlotGroup = 'formation';
            this.activeBackupIndex = 0;
            this.renderSlots();
          }
          this.renderBackupSlots();
          this.renderSlotRule();
          this.renderGallerySelection();
        }
        return;
      }
      const slotButton = target.closest<HTMLButtonElement>('[data-backup-slot]');
      if (!slotButton) return;
      const slot = Number(slotButton.dataset['backupSlot']);
      if (
        !Number.isInteger(slot)
        || slot < 0
        || slot >= this.currentSlot().candidates.length
      ) {
        return;
      }
      const gallerySelectionChanged = this.activeSlotGroup !== 'backup';
      this.activeSlotGroup = 'backup';
      this.activeBackupIndex = slot;
      this.renderSlots();
      this.renderBackupSlots();
      this.renderSlotRule();
      if (gallerySelectionChanged) {
        this.renderGallerySelection();
      } else {
        this.updateGalleryCardTargets();
      }
      this.scrollBackupSlotIntoView(slot);
    });
    this.backupSlotList.addEventListener('dragstart', (event) => {
      const slot = (event.target as HTMLElement).closest<HTMLElement>(
        '[data-backup-slot]',
      );
      if (!slot || !event.dataTransfer) return;
      const candidateIndex = Number(slot.dataset['backupSlot']);
      if (!this.currentSlot().candidates[candidateIndex]?.ship) return;
      this.rememberBackupScroll();
      event.dataTransfer.effectAllowed = 'copyMove';
      event.dataTransfer.setData(
        FLEET_DRAG_MIME,
        JSON.stringify({
          source: 'backup',
          position: this.activePosition,
          candidateIndex,
        }),
      );
    });
    this.backupSlotList.addEventListener('dragover', (event) => {
      const slot = (event.target as HTMLElement).closest<HTMLElement>(
        '[data-backup-slot]',
      );
      if (!slot || !event.dataTransfer?.types.includes(FLEET_DRAG_MIME)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      slot.classList.add('drag-over');
    });
    this.backupSlotList.addEventListener('dragleave', (event) => {
      const slot = (event.target as HTMLElement).closest<HTMLElement>(
        '[data-backup-slot]',
      );
      if (slot && !slot.contains(event.relatedTarget as Node | null)) {
        slot.classList.remove('drag-over');
      }
    });
    this.backupSlotList.addEventListener('drop', (event) => {
      const slot = (event.target as HTMLElement).closest<HTMLElement>(
        '[data-backup-slot]',
      );
      if (!slot || !event.dataTransfer) return;
      event.preventDefault();
      slot.classList.remove('drag-over');
      this.handleBackupDrop(
        event.dataTransfer.getData(FLEET_DRAG_MIME),
        Number(slot.dataset['backupSlot']),
      );
    });
    this.backupSlotList.addEventListener('dragend', () => {
      this.backupSlotList.querySelectorAll('.drag-over').forEach((slot) => {
        slot.classList.remove('drag-over');
      });
      this.backupDragScroll = null;
    });
    this.backupAppendDrop.addEventListener('dragover', (event) => {
      if (!event.dataTransfer?.types.includes(FLEET_DRAG_MIME)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      this.backupAppendDrop.classList.add('drag-over');
    });
    this.backupAppendDrop.addEventListener('dragleave', () => {
      this.backupAppendDrop.classList.remove('drag-over');
    });
    this.backupAppendDrop.addEventListener('drop', (event) => {
      if (!event.dataTransfer) return;
      event.preventDefault();
      this.backupAppendDrop.classList.remove('drag-over');
      this.handleBackupAppendDrop(
        event.dataTransfer.getData(FLEET_DRAG_MIME),
      );
      this.showBackupAppendDrop(false);
    });

    this.gallery.addEventListener('click', (event) => {
      const card = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-ship-id]');
      if (!card) return;
      const shipId = Number(card.dataset['shipId']);
      const ship = this.ships.find((item) => item.id === shipId);
      if (ship) this.assignShip(ship);
    });
    this.gallery.addEventListener('dragstart', (event) => {
      const card = (event.target as HTMLElement).closest<HTMLElement>(
        '[data-ship-id]',
      );
      if (!card || !event.dataTransfer) return;
      this.galleryDragScrollTop = this.gallery.scrollTop;
      this.rememberBackupScroll();
      event.dataTransfer.effectAllowed = 'copyMove';
      event.dataTransfer.setData(
        FLEET_DRAG_MIME,
        JSON.stringify({ source: 'gallery', shipId: Number(card.dataset['shipId']) }),
      );
    });
    this.gallery.addEventListener('dragend', () => {
      this.galleryDragScrollTop = null;
      this.backupDragScroll = null;
    });
    this.gallery.addEventListener('scroll', () => {
      const remaining = this.gallery.scrollHeight
        - this.gallery.scrollTop
        - this.gallery.clientHeight;
      if (remaining < 480) this.appendGalleryBatch();
    });

    this.searchInput.addEventListener('input', () => {
      this.searchText = this.searchInput.value;
      this.applyFilters();
    });

    this.filterButtons.forEach((button) => {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        this.setFilterPopoverOpen(
          this.filterPopover.hidden ? 'filter' : null,
        );
      });
    });
    this.filterPopover.addEventListener('click', (event) => {
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
        this.applyFilters();
      }
    });
    document.addEventListener('click', (event) => {
      const target = event.target as Node;
      if (
        !this.filterPopover.hidden
        && !this.filterPopover.contains(target)
        && !this.filterButtons.some((button) => button.contains(target))
      ) {
        this.setFilterPopoverOpen(null);
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      this.setFilterPopoverOpen(null);
      this.closeTeamPlanLoader();
      this.closeBackupCopyDialog();
    });
    document.getElementById('btn-confirm-fleet-filter')?.addEventListener(
      'click',
      () => this.setFilterPopoverOpen(null),
    );

    this.sortDescending.addEventListener('change', () => {
      this.descending = this.sortDescending.checked;
      this.updateFilterControls();
      this.applyFilters();
    });
    this.refitFilter.addEventListener('change', () => {
      this.refitOnly = this.refitFilter.checked;
      localStorage.setItem(
        REFIT_FILTER_STORAGE_KEY,
        String(this.refitOnly),
      );
      this.updateFilterControls();
      this.applyFilters();
    });

    document.getElementById('btn-reset-fleet-filter')?.addEventListener('click', () => {
      this.groupFilter = 'all';
      this.typeFilters.clear();
      this.countryFilters.clear();
      this.refitOnly = false;
      localStorage.setItem(REFIT_FILTER_STORAGE_KEY, 'false');
      this.sortField = 'id';
      this.descending = false;
      this.updateFilterControls();
      this.applyFilters();
    });

    document.getElementById('btn-clear-fleet')?.addEventListener('click', () => {
      const current = this.currentFleet();
      current.slots = Array.from(
        { length: FLEET_SLOT_COUNT },
        createFleetSlotDraft,
      );
      this.activeSlotGroup = 'formation';
      this.activePosition = 0;
      this.activeBackupIndex = 0;
      this.renderSlots();
      this.renderBackupSlots();
      this.renderSlotRule();
      this.renderGallerySelection();
    });

    document.getElementById('btn-add-fleet-backup')?.addEventListener('click', () => {
      const candidates = this.currentSlot().candidates;
      let target = candidates.findIndex(candidate => candidate.ship === null);
      if (target < 0) {
        candidates.push(createFleetCandidateDraft());
        target = candidates.length - 1;
      }
      this.activeSlotGroup = 'backup';
      this.activeBackupIndex = target;
      this.renderSlots();
      this.renderBackupSlots();
      this.renderSlotRule();
      requestAnimationFrame(() => {
        this.backupSlotList.querySelector<HTMLElement>(
          `[data-backup-slot="${target}"]`,
        )?.scrollIntoView({
          block: 'nearest',
          inline: 'nearest',
          behavior: 'smooth',
        });
      });
    });

    document.getElementById('btn-copy-fleet-backup')?.addEventListener(
      'click',
      () => {
        void this.openBackupCopyDialog();
      },
    );

    this.presetNameInput.addEventListener('input', () => {
      this.currentFleet().name = this.presetNameInput.value;
    });
    this.levelEnabled.addEventListener('change', () => {
      this.currentSlot().levelEnabled = this.levelEnabled.checked;
      this.levelFields.hidden = !this.levelEnabled.checked;
    });
    this.minLevel.addEventListener('input', () => {
      const rule = this.currentSlot();
      rule.minLevel = this.readLevel(this.minLevel);
      this.updateLevelValidity(rule, this.minLevel, this.maxLevel);
    });
    this.maxLevel.addEventListener('input', () => {
      const rule = this.currentSlot();
      rule.maxLevel = this.readLevel(this.maxLevel);
      this.updateLevelValidity(rule, this.minLevel, this.maxLevel);
    });
    this.backupLevelEnabled.addEventListener('change', () => {
      const rule = this.currentBackupRule();
      rule.levelEnabled = rule.ship !== null
        && this.backupLevelEnabled.checked;
      this.backupLevelEnabled.checked = rule.levelEnabled;
      this.backupLevelFields.hidden = !rule.levelEnabled;
    });
    this.backupMinLevel.addEventListener('input', () => {
      const rule = this.currentBackupRule();
      rule.minLevel = this.readLevel(this.backupMinLevel);
      this.updateLevelValidity(rule, this.backupMinLevel, this.backupMaxLevel);
    });
    this.backupMaxLevel.addEventListener('input', () => {
      const rule = this.currentBackupRule();
      rule.maxLevel = this.readLevel(this.backupMaxLevel);
      this.updateLevelValidity(rule, this.backupMinLevel, this.backupMaxLevel);
    });

    document.getElementById('btn-save-team-plan')?.addEventListener('click', () => {
      void this.saveCurrentTeamPlan();
    });
    document.getElementById('btn-new-team-plan')?.addEventListener('click', () => {
      void this.newTeamPlan();
    });
    document.getElementById('btn-load-team-plan')?.addEventListener('click', () => {
      void this.openTeamPlanLoader();
    });
    document.getElementById('btn-refresh-team-loader')?.addEventListener(
      'click',
      () => {
        void this.refreshTeamPlanLoader();
      },
    );
    document.getElementById('btn-cancel-team-loader')?.addEventListener(
      'click',
      () => this.closeTeamPlanLoader(),
    );
    this.teamLoaderConfirm.addEventListener('click', () => {
      void this.confirmTeamPlanLoad();
    });
    this.teamLoaderSearch.addEventListener('input', () => {
      this.renderTeamPlanLoader();
    });
    this.teamLoaderFilterSystem.addEventListener('change', () => {
      this.ensureVisibleTeamPlanSelection();
      this.renderTeamPlanLoader();
    });
    this.teamLoaderSortAscending.addEventListener('change', () => {
      this.renderTeamPlanLoader();
    });
    this.teamLoaderSortButtons.forEach(button => {
      button.addEventListener('click', () => {
        const field = button.dataset['teamLoaderSortField'];
        if (field !== 'name' && field !== 'modifiedAt') return;
        this.teamLoaderSortField = field;
        this.teamLoaderSortButtons.forEach(option => {
          option.classList.toggle('active', option === button);
        });
        this.renderTeamPlanLoader();
      });
    });
    this.teamLoaderList.addEventListener('click', (event) => {
      const item = (event.target as HTMLElement).closest<HTMLButtonElement>(
        '[data-team-plan-index]',
      );
      if (!item) return;
      const index = Number(item.dataset['teamPlanIndex']);
      const plan = this.loadableTeamPlans[index];
      if (!plan) return;
      this.selectedLoadPlan = plan;
      this.selectedLoadPlanPosition = 0;
      this.teamLoaderList
        .querySelectorAll<HTMLButtonElement>('[data-team-plan-index]')
        .forEach(option => {
          const optionIndex = Number(option.dataset['teamPlanIndex']);
          option.classList.toggle(
            'active',
            this.loadableTeamPlans[optionIndex] === plan,
          );
        });
      this.renderTeamPlanLoaderPreview();
    });
    this.teamLoaderPreviewSlots.addEventListener('click', (event) => {
      const item = (event.target as HTMLElement).closest<HTMLButtonElement>(
        '[data-team-preview-position]',
      );
      if (!item) return;
      const position = Number(item.dataset['teamPreviewPosition']);
      if (!Number.isInteger(position) || position < 0) return;
      this.selectedLoadPlanPosition = position;
      this.renderTeamPlanLoaderPreview();
    });
    this.teamLoader.addEventListener('click', (event) => {
      if (event.target === this.teamLoader) this.closeTeamPlanLoader();
    });
    document.getElementById('btn-cancel-backup-copy')?.addEventListener(
      'click',
      () => this.closeBackupCopyDialog(),
    );
    this.backupCopyDialog.addEventListener('click', (event) => {
      if (event.target === this.backupCopyDialog) {
        this.closeBackupCopyDialog();
      }
    });
    this.backupCopyTargets.addEventListener('click', (event) => {
      const target = (event.target as HTMLElement).closest<HTMLButtonElement>(
        '[data-backup-copy-position]',
      );
      if (!target || target.disabled) return;
      const position = Number(target.dataset['backupCopyPosition']);
      if (Number.isInteger(position)) {
        void this.copyBackupsToPosition(position);
      }
    });
    document.getElementById('btn-refresh-plan-management')?.addEventListener('click', () => {
      void this.loadManagement();
    });
    this.managementTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const source = tab.dataset['planManagementSource'];
        if (source !== 'all' && source !== 'system' && source !== 'user') {
          return;
        }
        this.managementSource = source;
        this.renderManagement();
      });
    });
    this.managementKindButtons.forEach(button => {
      button.addEventListener('click', () => {
        const kind = button.dataset['planManagementKind'];
        if (kind !== 'all' && kind !== 'battle' && kind !== 'team') return;
        this.managementKind = kind;
        this.renderManagement();
      });
    });
    this.managementSearch?.addEventListener('input', () => {
      this.managementQuery = this.managementSearch?.value.trim() ?? '';
      this.renderManagement();
    });
    this.managementAttentionOnly?.addEventListener('change', () => {
      this.renderManagement();
    });
    this.managementBody?.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
        '[data-plan-operation]',
      );
      if (!button) return;
      const file = button.dataset['planFile'];
      if (!file) return;
      if (button.dataset['planOperation'] === 'rename') {
        void this.renameCombatPlan(file);
      } else if (button.dataset['planOperation'] === 'delete') {
        void this.deleteCombatPlan(file);
      } else if (button.dataset['planOperation'] === 'edit-battle') {
        const source = button.dataset['planSource'] === 'system'
          ? 'system'
          : 'user';
        void this.onOpenBattlePlan?.(file, source);
      } else if (button.dataset['planOperation'] === 'edit-team') {
        const source = button.dataset['planSource'] === 'system'
          ? 'system'
          : 'user';
        void this.openTeamPlanLoader(file, source);
      } else if (button.dataset['planOperation'] === 'delete-team') {
        void this.deleteTeamPlan(file, button.dataset['planName'] ?? '');
      } else if (button.dataset['planOperation'] === 'toggle-unlinked') {
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

  private setFilter(kind: FilterKind, value: string): void {
    if (kind === 'group') {
      this.groupFilter = value;
      this.typeFilters.clear();
      if (value !== 'all') {
        this.ships.forEach((ship) => {
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
    this.applyFilters();
  }

  private setFilterPopoverOpen(target: 'filter' | null): void {
    this.filterPopover.hidden = target !== 'filter';
    this.filterButtons.forEach((button) => {
      button.setAttribute(
        'aria-expanded',
        String(button.dataset['fleetFilterTrigger'] === target),
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
          SHIP_TYPE_SHORT_NAMES[code] ?? this.labels.ship_types[code]!,
        )),
    );
    this.countryOptions.replaceChildren(
      this.createFilterOption('country', 'all', '全部'),
      ...Object.entries(this.labels.countries)
        .map(([code, label]) => this.createFilterOption('country', code, label)),
    );
    this.renderSlotRule();
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
    this.filterPopover.querySelectorAll<HTMLElement>('[data-filter-kind]').forEach((item) => {
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
    this.filterPopover.querySelectorAll<HTMLElement>('[data-sort-field]').forEach((item) => {
      item.classList.toggle('active', item.dataset['sortField'] === this.sortField);
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

    this.filterButtons.forEach((button) => {
      const active = activeFilterCount > 0
        || this.sortField !== 'id'
        || this.descending;
      button.classList.toggle('active', active);
    });
  }

  private applyFilters(
    resetScroll = true,
    preservedScrollTop?: number,
  ): void {
    const previousScrollTop = resetScroll
      ? 0
      : preservedScrollTop ?? this.gallery.scrollTop;
    const previousRenderedShipCount = resetScroll
      ? 0
      : this.renderedShipCount;
    const search = this.normalizeSearch(this.searchText);
    const selectedIds = new Set(this.selectedShips().map(ship => ship.id));
    const refitSearchNames = this.refitOnly
      ? new Set(
          this.ships
            .filter(ship => ship.variant === 'refit')
            .map(ship => ship.search_name),
        )
      : null;
    this.visibleShips = this.ships.filter((ship) => {
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
      ].some((value) => this.normalizeSearch(value).includes(search));
      return !selectedIds.has(ship.id)
        && typeMatches
        && countryMatches
        && refitMatches
        && searchMatches;
    });

    const direction = this.descending ? -1 : 1;
    this.visibleShips.sort((left, right) => {
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

    this.countLabel.textContent = `显示 ${this.visibleShips.length} / ${this.ships.length} 艘`;
    this.renderedShipCount = 0;
    this.gallery.replaceChildren();
    if (this.visibleShips.length === 0) {
      this.showGalleryMessage('没有符合当前条件的舰娘');
      return;
    }
    this.appendGalleryBatch(Math.max(
      this.galleryBatchSize(),
      previousRenderedShipCount,
    ));
    this.gallery.scrollTop = previousScrollTop;
  }

  /** 根据当前图鉴宽高计算首屏和下一批需要的卡片数量。 */
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

  /** 分辨率变大时补齐新增列和可见行，不重建图鉴也不改变滚动位置。 */
  private ensureGalleryFilled(): void {
    if (this.visibleShips.length === 0) return;
    const missingCount = this.galleryBatchSize() - this.renderedShipCount;
    if (missingCount > 0) this.appendGalleryBatch(missingCount);
  }

  private appendGalleryBatch(count = this.galleryBatchSize()): void {
    if (this.renderedShipCount >= this.visibleShips.length) return;
    const scrollTop = this.gallery.scrollTop;
    const fragment = document.createDocumentFragment();
    const end = Math.min(
      this.renderedShipCount + count,
      this.visibleShips.length,
    );
    for (let index = this.renderedShipCount; index < end; index += 1) {
      fragment.append(this.createShipCard(this.visibleShips[index]));
    }
    this.renderedShipCount = end;
    this.gallery.append(fragment);
    this.gallery.scrollTop = scrollTop;
  }

  private createShipCard(ship: ShipLibraryShip): HTMLButtonElement {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'fleet-ship-card';
    card.dataset['shipId'] = String(ship.id);
    card.draggable = true;
    card.title = `将 ${ship.name} 放入${this.activeSlotDescription()}`;
    card.append(createShipArtwork(ship, this.shipTypeDisplay(ship)));
    return card;
  }

  private activeSlotDescription(): string {
    if (this.activeSlotGroup === 'formation') {
      return `编队位置 ${this.activePosition + 1}`;
    }
    return `位置 ${this.activePosition + 1} 的第 ${
      this.activeBackupIndex + 1
    } 个备选槽位`;
  }

  private assignShip(ship: ShipLibraryShip): void {
    if (this.activeSlotGroup === 'formation') {
      const existingPrimary = this.currentFleet().slots.findIndex(
        slot => slot.primary?.search_name === ship.search_name,
      );
      this.assignFormationShip(
        ship,
        existingPrimary >= 0 ? existingPrimary : this.activePosition,
      );
    } else {
      const slot = this.currentSlot();
      const existingBackup = slot.candidates.findIndex(
        candidate => candidate.ship?.search_name === ship.search_name,
      );
      if (existingBackup >= 0) {
        slot.candidates[existingBackup].ship = ship;
        this.applyDefaultShipType(slot.candidates[existingBackup], ship);
        this.activeBackupIndex = existingBackup;
      } else {
        const selected = slot.candidates[this.activeBackupIndex];
        const replacing = Boolean(selected?.ship);
        const firstEmpty = slot.candidates.findIndex(
          candidate => candidate.ship === null,
        );
        const target = (selected?.ship || firstEmpty < 0)
          ? this.activeBackupIndex
          : firstEmpty;
        if (!slot.candidates[target]) {
          slot.candidates.push(createFleetCandidateDraft());
        }
        const candidate = slot.candidates[target];
        candidate.ship = ship;
        this.applyDefaultShipType(candidate, ship);
        this.activeBackupIndex = target;
        // 替换后保留当前焦点；只有从空槽追加时才推进到下一个空槽。
        if (!replacing) {
          const nextEmpty = slot.candidates.findIndex(
            (item, index) => index > target && item.ship === null,
          );
          if (nextEmpty >= 0) this.activeBackupIndex = nextEmpty;
        }
      }
    }
    this.renderSlots();
    this.renderBackupSlots();
    this.renderSlotRule();
    this.renderGallerySelection();
  }

  private assignFormationShip(
    ship: ShipLibraryShip,
    position: number,
    sourceRule?: FleetRuleDraft,
    advanceToNextEmpty = true,
  ): void {
    const slots = this.currentFleet().slots;
    const firstEmpty = slots.findIndex(slot => this.isFleetSlotEmpty(slot));
    const requested = slots[position];
    const target = (
      requested.primary
      || !this.isFleetSlotEmpty(requested)
      || firstEmpty < 0
    )
      ? position
      : firstEmpty;
    const slot = slots[target];
    const replacing = slot.primary !== null;
    slot.primary = ship;
    if (sourceRule) this.copyFleetRule(slot, sourceRule);
    this.applyDefaultShipType(slot, ship);
    this.activeSlotGroup = 'formation';
    this.activePosition = target;
    this.activeBackupIndex = 0;
    if (!replacing && advanceToNextEmpty) {
      const nextEmpty = slots.findIndex(
        (current, index) => (
          index > target && this.isFleetSlotEmpty(current)
        ),
      );
      if (nextEmpty >= 0) this.activePosition = nextEmpty;
    }
  }

  private handleFleetDrop(raw: string, targetPosition: number): void {
    if (!raw || targetPosition < 0 || targetPosition >= FLEET_SLOT_COUNT) return;
    try {
      const data = JSON.parse(raw) as FleetDragData;
      if (
        data.source === 'formation'
        && Number.isInteger(data.position)
        && data.position! >= 0
        && data.position! < FLEET_SLOT_COUNT
      ) {
        const sourcePosition = data.position!;
        const moved = this.moveFormationSlot(sourcePosition, targetPosition);
        if (!moved) return;
        this.activeSlotGroup = 'formation';
        this.activePosition = Math.max(
          0,
          this.currentFleet().slots.indexOf(moved),
        );
        this.activeBackupIndex = 0;
      } else if (
        data.source === 'backup'
        && Number.isInteger(data.position)
        && Number.isInteger(data.candidateIndex)
      ) {
        if (!this.moveBackupToFormation(data, targetPosition)) return;
      } else {
        const dragged = this.draggedShipRule(data);
        if (!dragged) return;
        const existing = this.currentFleet().slots.findIndex(
          slot => slot.primary?.search_name === dragged.ship.search_name,
        );
        this.assignFormationShip(
          dragged.ship,
          existing >= 0 ? existing : targetPosition,
          existing < 0 ? dragged.rule : undefined,
          false,
        );
      }
      this.renderSlots();
      this.renderBackupSlots();
      this.renderSlotRule();
      this.renderGallerySelection();
      this.showBackupAppendDrop(false);
    } catch {
      // 忽略非本页面产生的拖拽数据。
    }
  }

  private handleBackupDrop(raw: string, targetIndex: number): void {
    const candidates = this.currentSlot().candidates;
    if (!raw || targetIndex < 0 || targetIndex >= candidates.length) return;
    try {
      const data = JSON.parse(raw) as FleetDragData;
      if (
        data.source === 'formation'
        && Number.isInteger(data.position)
      ) {
        if (!this.moveFormationToBackup(data.position!, targetIndex)) return;
      } else if (
        data.source === 'backup'
        && Number.isInteger(data.position)
        && Number.isInteger(data.candidateIndex)
      ) {
        if (!this.moveBackupCandidate(data, targetIndex)) return;
      } else {
        const dragged = this.draggedShipRule(data);
        if (!dragged) return;
        const existing = candidates.findIndex(
          candidate => candidate.ship?.search_name === dragged.ship.search_name,
        );
        const firstEmpty = candidates.findIndex(
          candidate => candidate.ship === null,
        );
        const index = existing >= 0
          ? existing
          : (candidates[targetIndex].ship ? targetIndex : firstEmpty);
        const selected = candidates[index];
        selected.ship = dragged.ship;
        this.applyDefaultShipType(selected, dragged.ship);
        this.compactCandidates(candidates);
        this.activeSlotGroup = 'backup';
        this.activeBackupIndex = Math.max(0, candidates.indexOf(selected));
      }
      this.renderSlots();
      this.renderBackupSlots();
      this.renderSlotRule();
      this.renderGallerySelection();
      this.showBackupAppendDrop(false);
    } catch {
      // 忽略非本页面产生的拖拽数据。
    }
  }

  private moveFormationSlot(
    sourcePosition: number,
    targetPosition: number,
  ): FleetSlotDraft | null {
    const slots = this.currentFleet().slots;
    const moved = slots[sourcePosition];
    if (!moved?.primary) return null;
    if (sourcePosition === targetPosition) return moved;

    if (!this.isFleetSlotEmpty(slots[targetPosition])) {
      [slots[sourcePosition], slots[targetPosition]] = [
        slots[targetPosition],
        moved,
      ];
      return moved;
    }

    // 拖向空槽时，将完整位置对象放到已占用位置末尾，备选规则不会被拆散。
    slots.splice(sourcePosition, 1);
    const firstEmpty = slots.findIndex(slot => this.isFleetSlotEmpty(slot));
    slots.splice(firstEmpty < 0 ? slots.length : firstEmpty, 0, moved);
    return moved;
  }

  private moveBackupToFormation(
    data: FleetDragData,
    targetPosition: number,
  ): boolean {
    const slots = this.currentFleet().slots;
    const sourceSlot = slots[data.position!];
    const targetSlot = slots[targetPosition];
    const sourceIndex = data.candidateIndex!;
    const candidate = sourceSlot?.candidates[sourceIndex];
    if (!candidate?.ship || !targetSlot) return false;

    if (targetSlot.primary) {
      this.swapPrimaryAndCandidate(targetSlot, sourceSlot, sourceIndex);
    } else {
      targetSlot.primary = candidate.ship;
      this.copyFleetRule(targetSlot, candidate);
      sourceSlot.candidates.splice(sourceIndex, 1);
      this.compactCandidates(sourceSlot.candidates);
      if (this.isFleetSlotEmpty(sourceSlot)) {
        this.compactFleetSlots(null, data.position!);
      }
    }

    this.activeSlotGroup = 'formation';
    this.activePosition = Math.max(0, slots.indexOf(targetSlot));
    this.activeBackupIndex = 0;
    return true;
  }

  private moveFormationToBackup(
    sourcePosition: number,
    targetIndex: number,
  ): boolean {
    const sourceSlot = this.currentFleet().slots[sourcePosition];
    const targetSlot = this.currentSlot();
    const target = targetSlot.candidates[targetIndex];
    if (!sourceSlot?.primary || !target) return false;

    let selected: FleetCandidateDraft;
    if (target.ship) {
      selected = this.swapPrimaryAndCandidate(
        sourceSlot,
        targetSlot,
        targetIndex,
      );
    } else {
      selected = this.appendFormationToBackup(sourceSlot, targetSlot);
    }

    this.activeSlotGroup = 'backup';
    this.activePosition = Math.max(
      0,
      this.currentFleet().slots.indexOf(targetSlot),
    );
    this.activeBackupIndex = Math.max(
      0,
      targetSlot.candidates.indexOf(selected),
    );
    return true;
  }

  private moveBackupCandidate(
    data: FleetDragData,
    targetIndex: number,
  ): boolean {
    const slots = this.currentFleet().slots;
    const sourceSlot = slots[data.position!];
    const targetSlot = this.currentSlot();
    const sourceIndex = data.candidateIndex!;
    const selected = sourceSlot?.candidates[sourceIndex];
    const target = targetSlot.candidates[targetIndex];
    if (!selected?.ship || !target) return false;

    if (sourceSlot === targetSlot) {
      [sourceSlot.candidates[sourceIndex], sourceSlot.candidates[targetIndex]] = [
        sourceSlot.candidates[targetIndex],
        selected,
      ];
      this.compactCandidates(sourceSlot.candidates);
    } else if (target.ship) {
      [sourceSlot.candidates[sourceIndex], targetSlot.candidates[targetIndex]] = [
        target,
        selected,
      ];
      this.compactCandidates(sourceSlot.candidates);
      this.compactCandidates(targetSlot.candidates);
    } else {
      targetSlot.candidates[targetIndex] = selected;
      sourceSlot.candidates[sourceIndex] = createFleetCandidateDraft();
      this.compactCandidates(sourceSlot.candidates);
      this.compactCandidates(targetSlot.candidates);
      if (this.isFleetSlotEmpty(sourceSlot)) {
        this.compactFleetSlots(null, data.position!);
      }
    }

    this.activeSlotGroup = 'backup';
    this.activePosition = Math.max(0, slots.indexOf(targetSlot));
    this.activeBackupIndex = Math.max(
      0,
      targetSlot.candidates.indexOf(selected),
    );
    return true;
  }

  private handleBackupAppendDrop(raw: string): void {
    if (!raw) return;
    try {
      const data = JSON.parse(raw) as FleetDragData;
      if (
        data.source !== 'formation'
        || !Number.isInteger(data.position)
      ) {
        return;
      }
      const sourceSlot = this.currentFleet().slots[data.position!];
      const targetSlot = this.currentSlot();
      if (!sourceSlot?.primary) return;
      const selected = this.appendFormationToBackup(sourceSlot, targetSlot);
      this.activeSlotGroup = 'backup';
      this.activePosition = Math.max(
        0,
        this.currentFleet().slots.indexOf(targetSlot),
      );
      this.activeBackupIndex = Math.max(
        0,
        targetSlot.candidates.indexOf(selected),
      );
      this.renderSlots();
      this.renderBackupSlots();
      this.renderSlotRule();
      this.renderGallerySelection();
    } catch {
      // 忽略非本页面产生的拖拽数据。
    }
  }

  private appendFormationToBackup(
    sourceSlot: FleetSlotDraft,
    targetSlot: FleetSlotDraft,
  ): FleetCandidateDraft {
    const ship = sourceSlot.primary!;
    const rule = this.cloneFleetRule(sourceSlot);
    const selected = this.appendBackupCandidate(targetSlot, ship, rule);
    sourceSlot.primary = null;
    this.clearFleetRule(sourceSlot);
    if (this.isFleetSlotEmpty(sourceSlot)) {
      this.compactFleetSlots(null, this.activePosition);
    }
    return selected;
  }

  private appendBackupCandidate(
    targetSlot: FleetSlotDraft,
    ship: ShipLibraryShip,
    rule: FleetRuleDraft,
  ): FleetCandidateDraft {
    const occupied = targetSlot.candidates.filter(candidate => (
      candidate.ship !== null
      && candidate.ship.search_name !== ship.search_name
    ));
    const selected = createFleetCandidateDraft(ship);
    this.copyFleetRule(selected, rule);
    occupied.push(selected);
    targetSlot.candidates.splice(
      0,
      targetSlot.candidates.length,
      ...occupied,
      ...Array.from(
        {
          length: Math.max(
            0,
            DEFAULT_BACKUP_SLOT_COUNT - occupied.length,
          ),
        },
        () => createFleetCandidateDraft(),
      ),
    );
    return selected;
  }

  private swapPrimaryAndCandidate(
    primarySlot: FleetSlotDraft,
    candidateSlot: FleetSlotDraft,
    candidateIndex: number,
  ): FleetCandidateDraft {
    const primary = primarySlot.primary!;
    const primaryRule = this.cloneFleetRule(primarySlot);
    const candidate = candidateSlot.candidates[candidateIndex];
    const promoted = candidate.ship!;
    const promotedRule = this.cloneFleetRule(candidate);

    primarySlot.primary = promoted;
    this.copyFleetRule(primarySlot, promotedRule);
    candidate.ship = primary;
    this.copyFleetRule(candidate, primaryRule);
    return candidate;
  }

  private cloneFleetRule(source: FleetRuleDraft): FleetRuleDraft {
    return {
      shipTypes: [...source.shipTypes],
      levelEnabled: source.levelEnabled,
      minLevel: source.minLevel,
      maxLevel: source.maxLevel,
    };
  }

  private backupQueuesEqual(
    source: FleetCandidateDraft[],
    target: FleetCandidateDraft[],
  ): boolean {
    const sourceBackups = source.filter(candidate => candidate.ship !== null);
    const targetBackups = target.filter(candidate => candidate.ship !== null);
    if (sourceBackups.length !== targetBackups.length) return false;

    return sourceBackups.every((candidate, index) => {
      const targetCandidate = targetBackups[index];
      const sameShipTypes = candidate.shipTypes.length
        === targetCandidate.shipTypes.length
        && candidate.shipTypes.every(
          shipType => targetCandidate.shipTypes.includes(shipType),
        );
      return candidate.ship?.id === targetCandidate.ship?.id
        && sameShipTypes
        && candidate.levelEnabled === targetCandidate.levelEnabled
        && candidate.minLevel === targetCandidate.minLevel
        && candidate.maxLevel === targetCandidate.maxLevel;
    });
  }

  private clearFleetRule(target: FleetRuleDraft): void {
    this.copyFleetRule(target, createFleetRuleDraft());
  }

  private isFleetSlotEmpty(slot: FleetSlotDraft): boolean {
    return slot.primary === null
      && slot.candidates.every(candidate => candidate.ship === null);
  }

  private compactFleetSlots(
    preferred: FleetSlotDraft | null,
    fallbackPosition: number,
  ): number {
    const slots = this.currentFleet().slots;
    const occupied = slots.filter(slot => !this.isFleetSlotEmpty(slot));
    slots.splice(
      0,
      slots.length,
      ...occupied,
      ...Array.from(
        { length: Math.max(0, FLEET_SLOT_COUNT - occupied.length) },
        createFleetSlotDraft,
      ),
    );
    const preferredPosition = preferred ? slots.indexOf(preferred) : -1;
    return preferredPosition >= 0
      ? preferredPosition
      : Math.min(Math.max(0, fallbackPosition), FLEET_SLOT_COUNT - 1);
  }

  private showBackupAppendDrop(visible: boolean): void {
    this.backupAppendDrop.hidden = !visible;
    if (!visible) this.backupAppendDrop.classList.remove('drag-over');
  }

  private draggedShipRule(
    data: FleetDragData,
  ): { ship: ShipLibraryShip; rule?: FleetRuleDraft } | null {
    if (data.source === 'gallery' && Number.isInteger(data.shipId)) {
      const ship = this.ships.find(item => item.id === data.shipId);
      return ship ? { ship } : null;
    }

    if (
      data.source === 'formation'
      && Number.isInteger(data.position)
      && data.position! >= 0
      && data.position! < FLEET_SLOT_COUNT
    ) {
      const rule = this.currentFleet().slots[data.position!];
      return rule.primary ? { ship: rule.primary, rule } : null;
    }

    if (
      data.source === 'backup'
      && Number.isInteger(data.position)
      && data.position! >= 0
      && data.position! < FLEET_SLOT_COUNT
      && Number.isInteger(data.candidateIndex)
    ) {
      const rule = this.currentFleet()
        .slots[data.position!]
        .candidates[data.candidateIndex!];
      return rule?.ship ? { ship: rule.ship, rule } : null;
    }

    return null;
  }

  private copyFleetRule(
    target: FleetRuleDraft,
    source: FleetRuleDraft,
  ): void {
    target.shipTypes = [...source.shipTypes];
    target.levelEnabled = source.levelEnabled;
    target.minLevel = source.minLevel;
    target.maxLevel = source.maxLevel;
  }

  private compactCandidates(candidates: FleetCandidateDraft[]): void {
    const occupied = candidates.filter(candidate => candidate.ship !== null);
    const slotCount = Math.max(DEFAULT_BACKUP_SLOT_COUNT, occupied.length);
    candidates.splice(
      0,
      candidates.length,
      ...occupied,
      ...Array.from(
        { length: slotCount - occupied.length },
        () => createFleetCandidateDraft(),
      ),
    );
  }

  private renderSlots(): void {
    const scroll = this.slotList.closest<HTMLElement>('.fleet-slot-scroll');
    const scrollPosition = captureScrollPosition(scroll);
    const fragment = document.createDocumentFragment();
    this.currentFleet().slots.forEach((slot, index) => {
      fragment.append(this.createFleetSlot(
        slot.primary,
        index,
        'formation',
        slot.primary === null && !this.isFleetSlotEmpty(slot),
      ));
    });
    this.slotList.replaceChildren(fragment);
    restoreScrollPosition(scroll, scrollPosition);
  }

  private renderBackupSlots(): void {
    const preservedScroll = this.backupDragScroll
      ?? captureScrollPosition(this.backupScroll);
    const fragment = document.createDocumentFragment();
    this.currentSlot().candidates.forEach((candidate, index) => {
      fragment.append(this.createFleetSlot(candidate.ship, index, 'backup'));
    });
    this.backupSlotList.replaceChildren(fragment);
    restoreScrollPosition(this.backupScroll, preservedScroll);
    const primary = this.currentSlot().primary;
    this.backupTitle.textContent = primary
      ? `${primary.name} 的备选队列`
      : `位置 ${this.activePosition + 1} 的备选队列`;
  }

  private rememberBackupScroll(): void {
    this.backupDragScroll = {
      top: this.backupScroll.scrollTop,
      left: this.backupScroll.scrollLeft,
    };
  }

  private scrollBackupSlotIntoView(index: number): void {
    requestAnimationFrame(() => {
      this.backupSlotList.querySelector<HTMLElement>(
        `[data-backup-slot="${index}"]`,
      )?.scrollIntoView({
        block: 'nearest',
        inline: 'nearest',
      });
    });
  }

  private createFleetSlot(
    ship: ShipLibraryShip | null,
    index: number,
    group: SlotGroup,
    candidateOnly = false,
  ): HTMLButtonElement {
    const slot = document.createElement('button');
    slot.type = 'button';
    slot.className = `fleet-slot fleet-${group}-slot`;
    if (group === 'formation') {
      slot.dataset['fleetSlot'] = String(index);
    } else {
      slot.dataset['backupSlot'] = String(index);
    }
    const active = group === 'formation'
      ? index === this.activePosition
      : this.activeSlotGroup === 'backup' && index === this.activeBackupIndex;
    slot.classList.toggle('active', active);
    slot.classList.toggle('candidate-only', candidateOnly);
    slot.draggable = Boolean(ship);
    if (candidateOnly) {
      slot.setAttribute(
        'aria-label',
        `位置 ${index + 1} 没有主选，已有备选舰船`,
      );
      if (this.colorfulBackgroundUrl) {
        const background = document.createElement('img');
        background.className = 'fleet-slot-placeholder-background';
        background.src = this.colorfulBackgroundUrl;
        background.alt = '';
        background.draggable = false;
        slot.append(background);
      }
    }

    if (ship) {
      slot.append(createShipArtwork(ship, this.shipTypeDisplay(ship)));
      const remove = document.createElement('span');
      remove.className = 'fleet-slot-remove';
      if (group === 'formation') {
        remove.dataset['removeSlot'] = String(index);
      } else {
        remove.dataset['removeBackupSlot'] = String(index);
      }
      remove.setAttribute('role', 'button');
      remove.setAttribute('aria-label', `移除 ${ship.name}`);
      remove.textContent = '×';
      slot.append(remove);
    } else {
      const empty = document.createElement('span');
      empty.className = 'fleet-slot-empty';
      empty.textContent = candidateOnly
        ? '使用备选队列'
        : group === 'formation'
        ? `位置 ${index + 1}`
        : `备选 ${index + 1}`;
      slot.append(empty);
    }
    return slot;
  }

  private renderGallerySelection(): void {
    const scrollTop = this.galleryDragScrollTop ?? this.gallery.scrollTop;
    this.applyFilters(false, scrollTop);
    requestAnimationFrame(() => {
      this.gallery.scrollTop = scrollTop;
    });
  }

  private updateGalleryCardTargets(): void {
    const description = this.activeSlotDescription();
    const shipsById = new Map(this.visibleShips.map(ship => [ship.id, ship]));
    this.gallery
      .querySelectorAll<HTMLButtonElement>('[data-ship-id]')
      .forEach(card => {
        const ship = shipsById.get(Number(card.dataset['shipId']));
        if (ship) card.title = `将 ${ship.name} 放入${description}`;
      });
  }

  private currentFleet(): FleetDraft {
    return this.fleet;
  }

  private currentSlot(): FleetSlotDraft {
    return this.currentFleet().slots[this.activePosition];
  }

  private currentBackupRule(): FleetCandidateDraft {
    return this.currentSlot().candidates[this.activeBackupIndex];
  }

  /** 比较当前草稿和最近一次成功保存或加载的内容。 */
  private fleetDraftSnapshot(): string {
    const ruleSnapshot = (rule: FleetRuleDraft) => ({
      shipTypes: [...rule.shipTypes],
      levelEnabled: rule.levelEnabled,
      minLevel: rule.minLevel,
      maxLevel: rule.maxLevel,
    });
    return JSON.stringify({
      name: this.presetNameInput.value,
      slots: this.currentFleet().slots.map(slot => ({
        primary: slot.primary?.id ?? null,
        rule: ruleSnapshot(slot),
        candidates: slot.candidates.map(candidate => ({
          ship: candidate.ship?.id ?? null,
          rule: ruleSnapshot(candidate),
        })),
      })),
    });
  }

  private hasUnsavedFleetChanges(): boolean {
    return this.fleetDraftSnapshot() !== this.savedFleetSnapshot;
  }

  private selectedShips(): ShipLibraryShip[] {
    if (this.activeSlotGroup === 'formation') {
      return this.currentFleet().slots
        .map(slot => slot.primary)
        .filter((ship): ship is ShipLibraryShip => ship !== null);
    }
    return this.currentSlot().candidates
      .map(candidate => candidate.ship)
      .filter((ship): ship is ShipLibraryShip => ship !== null);
  }

  private renderSlotRule(): void {
    const main = this.currentSlot();
    const hasPrimary = main.primary !== null;
    this.levelEnabled.checked = main.levelEnabled;
    this.levelEnabled.disabled = !hasPrimary;
    this.levelFields.hidden = !hasPrimary || !main.levelEnabled;
    this.minLevel.disabled = !hasPrimary;
    this.maxLevel.disabled = !hasPrimary;
    this.minLevel.value = main.minLevel === null ? '' : String(main.minLevel);
    this.maxLevel.value = main.maxLevel === null ? '' : String(main.maxLevel);
    this.updateLevelValidity(main, this.minLevel, this.maxLevel);

    const backup = this.currentBackupRule();
    const hasBackup = backup.ship !== null;
    if (!hasBackup) this.clearFleetRule(backup);
    this.backupLevelEnabled.checked = hasBackup && backup.levelEnabled;
    this.backupLevelEnabled.disabled = !hasBackup;
    this.backupLevelFields.hidden = !hasBackup || !backup.levelEnabled;
    this.backupMinLevel.disabled = !hasBackup;
    this.backupMaxLevel.disabled = !hasBackup;
    this.backupMinLevel.value = backup.minLevel === null
      ? ''
      : String(backup.minLevel);
    this.backupMaxLevel.value = backup.maxLevel === null
      ? ''
      : String(backup.maxLevel);
    this.updateLevelValidity(
      backup,
      this.backupMinLevel,
      this.backupMaxLevel,
    );
  }

  private applyDefaultShipType(
    rule: FleetRuleDraft,
    ship: ShipLibraryShip,
  ): void {
    if (
      rule.shipTypes.length === 0
      || !rule.shipTypes.includes(ship.ship_type)
    ) {
      rule.shipTypes = [ship.ship_type];
    }
  }

  private readLevel(input: HTMLInputElement): number | null {
    if (!input.value.trim()) return null;
    return Number(input.value);
  }

  private updateLevelValidity(
    rule: FleetRuleDraft,
    minInput: HTMLInputElement,
    maxInput: HTMLInputElement,
  ): void {
    const minInvalid = minInput.value !== ''
      && (!Number.isInteger(Number(minInput.value))
        || Number(minInput.value) < 1);
    const maxInvalid = maxInput.value !== ''
      && (!Number.isInteger(Number(maxInput.value))
        || Number(maxInput.value) < 1);
    const rangeInvalid = rule.minLevel !== null
      && rule.maxLevel !== null
      && rule.maxLevel < rule.minLevel;
    minInput.setCustomValidity(
      minInvalid ? '最小等级必须是大于或等于 1 的整数' : '',
    );
    maxInput.setCustomValidity(
      maxInvalid
        ? '最大等级必须是大于或等于 1 的整数'
        : rangeInvalid
          ? '最大等级必须大于或等于最小等级'
          : '',
    );
  }

  private buildTeamPlan(): UserTeamPlan {
    const fleet = this.currentFleet();
    const name = this.presetNameInput.value.trim();
    if (!name) throw new Error('请输入舰队预设名称');

    const occupiedSlots = fleet.slots.filter(
      slot => !this.isFleetSlotEmpty(slot),
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
    const bridge = window.electronBridge;
    if (!bridge?.saveUserTeamPlan) {
      await showAlert('保存失败', '当前环境不支持保存编队预设');
      return;
    }
    try {
      const plan = this.buildTeamPlan();
      const currentFile = this.currentFleet().file ?? undefined;
      const source = this.currentFleet().source;
      let result = await bridge.saveUserTeamPlan(
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
        result = await bridge.saveUserTeamPlan(
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
      this.savedFleetSnapshot = this.fleetDraftSnapshot();
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
    this.fleet = createFleetDraft();
    this.presetNameInput.value = '';
    this.activeSlotGroup = 'formation';
    this.activePosition = 0;
    this.activeBackupIndex = 0;
    this.renderSlots();
    this.renderBackupSlots();
    this.renderSlotRule();
    this.renderGallerySelection();
    this.savedFleetSnapshot = this.fleetDraftSnapshot();
    this.presetNameInput.focus();
  }

  private async openTeamPlanLoader(
    targetFile?: string,
    targetSource?: PlanPresetSource,
  ): Promise<void> {
    const bridge = window.electronBridge;
    if (!bridge?.listTeamPlans) {
      await showAlert('加载失败', '当前环境不支持加载编队预设');
      return;
    }
    await this.load();
    this.teamLoaderSearch.value = '';
    await this.refreshTeamPlanLoader();
    if (targetFile) {
      const selected = this.loadableTeamPlans.find(plan => (
        plan.file === targetFile
        && (plan.source ?? 'user') === (targetSource ?? 'user')
      ));
      if (selected) {
        this.selectedLoadPlan = selected;
        this.selectedLoadPlanPosition = 0;
        if (await this.confirmTeamPlanLoad()) {
          document.querySelector<HTMLButtonElement>(
            '[data-plan-tab="fleet"]',
          )?.click();
        }
      } else {
        await showAlert('加载失败', '未找到对应的舰队方案');
      }
      return;
    }
    this.teamLoader.style.display = 'flex';
    this.teamLoaderSearch.focus();
  }

  private closeTeamPlanLoader(): void {
    this.teamLoader.style.display = 'none';
  }

  private async refreshTeamPlanLoader(): Promise<void> {
    const bridge = window.electronBridge;
    if (!bridge?.listTeamPlans) return;
    this.teamLoaderCount.textContent = '正在读取编队预设…';
    this.teamLoaderStatus.textContent = '';
    try {
      const result = await bridge.listTeamPlans();
      this.loadableTeamPlans = result.plans;
      const currentFile = this.currentFleet().file;
      const currentSource = this.currentFleet().source;
      const visiblePlans = this.visibleTeamPlans();
      const firstSortedPlan = [...visiblePlans]
        .sort((left, right) => this.compareTeamPlans(left, right))
        [0];
      this.selectedLoadPlan = visiblePlans.find(
        plan => Boolean(currentFile)
          && plan.file === currentFile
          && (plan.source ?? 'user') === currentSource,
      ) ?? firstSortedPlan ?? null;
      this.selectedLoadPlanPosition = 0;
      this.teamLoaderCount.textContent =
        `共读取 ${result.plans.length} 个舰队预设`;
      this.teamLoaderStatus.textContent = result.errors.length > 0
        ? `有 ${result.errors.length} 个配置格式不合法，已跳过`
        : '';
      this.renderTeamPlanLoader();
    } catch (error) {
      this.loadableTeamPlans = [];
      this.selectedLoadPlan = null;
      this.selectedLoadPlanPosition = 0;
      this.teamLoaderCount.textContent = '读取失败';
      this.teamLoaderStatus.textContent = error instanceof Error
        ? error.message
        : String(error);
      this.renderTeamPlanLoader();
    }
  }

  private renderTeamPlanLoader(): void {
    const scrollPosition = captureScrollPosition(this.teamLoaderList);
    const fragment = document.createDocumentFragment();
    const visiblePlans = filterAndSortTeamPlans(this.loadableTeamPlans, {
      search: this.teamLoaderSearch.value,
      filterSystem: this.teamLoaderFilterSystem.checked,
      sortField: this.teamLoaderSortField,
      ascending: this.teamLoaderSortAscending.checked,
    });
    visiblePlans.forEach(({ plan, index }) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'fleet-team-loader-item';
      button.dataset['teamPlanIndex'] = String(index);
      button.classList.toggle('active', plan === this.selectedLoadPlan);
      appendTeamPlanCardContent(button, teamPlanCardData(plan));
      fragment.append(button);
    });
    if (!fragment.childNodes.length) {
      const empty = document.createElement('div');
      empty.className = 'fleet-library-empty';
      empty.textContent = this.loadableTeamPlans.length > 0
        ? '没有符合当前过滤条件的舰队预设'
        : '系统和用户编队目录中没有可加载的配置';
      fragment.append(empty);
    }
    this.teamLoaderList.replaceChildren(fragment);
    restoreScrollPosition(this.teamLoaderList, scrollPosition);
    this.renderTeamPlanLoaderPreview();
  }

  private compareTeamPlans(
    left: UserTeamPlan,
    right: UserTeamPlan,
  ): number {
    return compareTeamPlans(
      left,
      right,
      this.teamLoaderSortField,
      this.teamLoaderSortAscending.checked,
    );
  }

  private visibleTeamPlans(): UserTeamPlan[] {
    return this.loadableTeamPlans.filter(plan => (
      !this.teamLoaderFilterSystem.checked || plan.source !== 'system'
    ));
  }

  private ensureVisibleTeamPlanSelection(): void {
    const visiblePlans = this.visibleTeamPlans();
    if (!this.selectedLoadPlan || !visiblePlans.includes(this.selectedLoadPlan)) {
      this.selectedLoadPlan = [...visiblePlans]
        .sort((left, right) => this.compareTeamPlans(left, right))[0] ?? null;
      this.selectedLoadPlanPosition = 0;
    }
  }

  private renderTeamPlanLoaderPreview(): void {
    const plan = this.selectedLoadPlan;
    this.teamLoaderConfirm.disabled = !plan;
    this.teamLoaderPreviewTitle.textContent =
      `编队预览：${plan?.name ?? '未选择'}`;
    const fragment = document.createDocumentFragment();
    Array.from({ length: FLEET_SLOT_COUNT }, (_, index) => {
      const slot = plan?.ships[index];
      const backupCount = slot?.candidates?.length ?? 0;
      const primary = slot && (slot.name || slot.search_name)
        ? slot
        : undefined;
      const item = document.createElement('div');
      item.className = 'fleet-team-main-item';
      const card = this.createTeamPlanPreviewCard(
        primary,
        'main',
        index,
        !primary && backupCount > 0,
      );
      card.dataset['teamPreviewPosition'] = String(index);
      card.classList.toggle(
        'active',
        Boolean(plan) && index === this.selectedLoadPlanPosition,
      );
      card.setAttribute(
        'aria-pressed',
        String(Boolean(plan) && index === this.selectedLoadPlanPosition),
      );
      if (card instanceof HTMLButtonElement) card.disabled = !plan;
      item.append(card);
      const levels = this.createTeamPlanLevelSummary(primary);
      if (levels) item.append(levels);
      fragment.append(item);
    });
    this.teamLoaderPreviewSlots.replaceChildren(fragment);
    this.renderTeamPlanLoaderBackupPreview();
  }

  private renderTeamPlanLoaderBackupPreview(): void {
    const plan = this.selectedLoadPlan;
    const slot = plan?.ships[this.selectedLoadPlanPosition];
    const candidates = slot?.candidates ?? [];
    this.teamLoaderBackupTitle.textContent = slot?.name
      ? `【${slot.name}】的备选队列`
      : `【位置${this.selectedLoadPlanPosition + 1}】的备选队列`;
    if (candidates.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'fleet-team-loader-preview-empty';
      empty.textContent = plan
        ? `位置 ${this.selectedLoadPlanPosition + 1} 没有备选船只`
        : '请先选择一个舰队预设';
      this.teamLoaderBackupSlots.replaceChildren(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    candidates.forEach((candidate) => {
      fragment.append(this.createTeamPlanPreviewCard(
        candidate,
        'backup',
        this.selectedLoadPlanPosition,
      ));
    });
    this.teamLoaderBackupSlots.replaceChildren(fragment);
  }

  private createTeamPlanPreviewCard(
    rule: UserTeamPlanSlot | UserTeamShipRule | undefined,
    size: 'main' | 'backup',
    position: number,
    candidateOnly = false,
  ): HTMLElement {
    const card = document.createElement(size === 'main' ? 'button' : 'div');
    if (card instanceof HTMLButtonElement) card.type = 'button';
    card.className = `fleet-team-${size}-card`;
    const name = rule?.name ?? rule?.search_name ?? null;
    card.setAttribute(
      'aria-label',
      name ? `位置 ${position + 1}：${name}` : `位置 ${position + 1}：空`,
    );
    if (!name) {
      if (candidateOnly) {
        card.classList.add('candidate-only');
        if (this.colorfulBackgroundUrl) {
          const background = document.createElement('img');
          background.className = 'fleet-team-placeholder-background';
          background.src = this.colorfulBackgroundUrl;
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
    const ship = this.ships.find(item => item.name === name)
      ?? this.ships.find(item => item.search_name === name)
      ?? (
        rule?.search_name
          ? this.ships.find(item => item.search_name === rule.search_name)
          : undefined
      );
    if (ship) {
      card.append(createShipArtwork(ship, this.shipTypeDisplay(ship)));
    } else {
      const unknown = document.createElement('span');
      unknown.className = 'fleet-team-card-empty fleet-team-card-unknown';
      unknown.textContent = name;
      card.append(unknown);
    }
    return card;
  }

  private createTeamPlanLevelSummary(
    rule: UserTeamPlanSlot | UserTeamShipRule | undefined,
  ): HTMLElement | null {
    if (
      !rule
      || (rule.min_level === undefined && rule.max_level === undefined)
    ) {
      return null;
    }
    const summary = document.createElement('span');
    summary.className = 'fleet-team-level-summary';
    if (rule.min_level !== undefined) {
      const min = document.createElement('span');
      min.textContent = `最小等级：${rule.min_level}`;
      summary.append(min);
    }
    if (rule.max_level !== undefined) {
      const max = document.createElement('span');
      max.textContent = `最大等级：${rule.max_level}`;
      summary.append(max);
    }
    return summary;
  }

  private async confirmTeamPlanLoad(): Promise<boolean> {
    const plan = this.selectedLoadPlan;
    if (!plan) return false;
    if (this.hasUnsavedFleetChanges()) {
      const confirmed = await showConfirm(
        '未保存修改',
        '当前舰队编队存在未保存修改，继续加载将丢失这些修改，是否继续？',
      );
      if (!confirmed) return false;
    }
    try {
      this.applyTeamPlan(plan);
      this.closeTeamPlanLoader();
      return true;
    } catch {
      await showAlert('加载失败', '当前yaml格式不符合规则');
      return false;
    }
  }

  private applyTeamPlan(plan: UserTeamPlan): void {
    const slots = plan.ships.map(slot => this.draftFromPlanSlot(slot));
    while (slots.length < FLEET_SLOT_COUNT) slots.push(createFleetSlotDraft());
    this.fleet = {
      name: plan.name,
      file: plan.file ?? null,
      source: plan.source ?? 'user',
      slots: slots.slice(0, FLEET_SLOT_COUNT),
    };
    this.presetNameInput.value = plan.name;
    this.activeSlotGroup = 'formation';
    this.activePosition = 0;
    this.activeBackupIndex = 0;
    this.renderSlots();
    this.renderBackupSlots();
    this.renderSlotRule();
    this.renderGallerySelection();
    this.savedFleetSnapshot = this.fleetDraftSnapshot();
  }

  private async openBackupCopyDialog(): Promise<void> {
    const source = this.currentSlot();
    const sourceBackups = source.candidates.filter(
      candidate => candidate.ship !== null,
    );
    if (sourceBackups.length === 0) {
      await showAlert('无法复制', '当前位置没有可复制的备选舰船');
      return;
    }

    const sourceName = source.primary?.name ?? `位置${this.activePosition + 1}`;
    this.backupCopyDescription.textContent = (
      `将【${sourceName}】的 ${sourceBackups.length} 艘备选复制到其他位置。`
    );
    const fragment = document.createDocumentFragment();
    this.currentFleet().slots.forEach((slot, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'fleet-backup-copy-target';
      button.dataset['backupCopyPosition'] = String(index);
      const sameBackupQueue = this.backupQueuesEqual(
        source.candidates,
        slot.candidates,
      );
      const backupCount = slot.candidates.filter(
        candidate => candidate.ship !== null,
      ).length;
      button.disabled = index === this.activePosition
        || sameBackupQueue;

      const name = document.createElement('strong');
      name.textContent = slot.primary
        ? `位置 ${index + 1} · ${slot.primary.name}`
        : `位置 ${index + 1} · 无主选`;
      const summary = document.createElement('span');
      summary.textContent = slot.primary
        ? `${backupCount} 艘现有备选`
        : backupCount > 0
          ? `${backupCount} 艘现有纯备选`
          : '空位置，可复制为纯备选';
      if (index === this.activePosition) {
        summary.textContent = '当前备选队列';
      } else if (sameBackupQueue) {
        summary.textContent = '备选队列完全一致';
      }
      button.append(name, summary);
      fragment.append(button);
    });
    this.backupCopyTargets.replaceChildren(fragment);
    this.backupCopyDialog.style.display = 'flex';
  }

  private closeBackupCopyDialog(): void {
    this.backupCopyDialog.style.display = 'none';
  }

  private async copyBackupsToPosition(targetPosition: number): Promise<void> {
    if (
      targetPosition < 0
      || targetPosition >= FLEET_SLOT_COUNT
      || targetPosition === this.activePosition
    ) {
      return;
    }
    const source = this.currentSlot();
    const target = this.currentFleet().slots[targetPosition];
    if (!target) return;

    const sourceBackups = source.candidates.filter(
      (candidate): candidate is FleetCandidateDraft & {
        ship: ShipLibraryShip;
      } => candidate.ship !== null,
    );
    if (sourceBackups.length === 0) return;
    if (this.backupQueuesEqual(source.candidates, target.candidates)) return;
    const targetBackupCount = target.candidates.filter(
      candidate => candidate.ship !== null,
    ).length;
    if (targetBackupCount > 0) {
      const targetName = target.primary?.name ?? `位置${targetPosition + 1}`;
      const overwrite = await showConfirm(
        '覆盖备选队列',
        `【${targetName}】已有 ${targetBackupCount} 艘备选，是否覆盖？`,
      );
      if (!overwrite) return;
    }

    const copied = sourceBackups.map(candidate => ({
      ship: candidate.ship,
      ...this.cloneFleetRule(candidate),
    }));
    target.candidates = [
      ...copied,
      ...Array.from(
        {
          length: Math.max(
            0,
            DEFAULT_BACKUP_SLOT_COUNT - copied.length,
          ),
        },
        () => createFleetCandidateDraft(),
      ),
    ];
    this.closeBackupCopyDialog();
    this.renderSlots();
    this.renderBackupSlots();
    this.renderSlotRule();
    this.renderGallerySelection();
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
          () => createFleetCandidateDraft(),
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
    const ship = this.ships.find(item => item.name === rule.name)
      ?? this.ships.find(item => item.search_name === rule.search_name);
    if (!ship) throw new Error(`舰船不存在: ${rule.name}`);
    return ship;
  }

  async loadManagement(): Promise<void> {
    const bridge = window.electronBridge;
    if (!this.managementBody || !bridge?.getPlanManagement) return;
    this.managementBody.innerHTML = '<tr><td colspan="6">正在读取计划…</td></tr>';
    try {
      const result = await bridge.getPlanManagement();
      this.managementBindings = result.bindings;
      this.managedTeamPlans = result.teamPlans;
      this.managementErrors = result.errors;
      this.ignoredUnlinkedPlans = new Set(result.ignoredUnlinkedPlans);
      this.renderManagement();
    } catch (error) {
      this.managementBody.innerHTML = '';
      const row = this.managementBody.insertRow();
      const cell = row.insertCell();
      cell.colSpan = 6;
      cell.className = 'plan-management-empty';
      cell.textContent = error instanceof Error ? error.message : String(error);
    }
  }

  /** 汇总出征计划和舰队方案，并渲染关联状态。 */
  private renderManagement(): void {
    if (!this.managementBody) return;
    const scroll = this.managementBody.closest<HTMLElement>(
      '.plan-team-management-table-wrap',
    );
    const scrollPosition = captureScrollPosition(scroll);
    const source = this.managementSource;
    this.managementTabs.forEach(tab => {
      const active = tab.dataset['planManagementSource'] === source;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    this.managementKindButtons.forEach(button => {
      const active = button.dataset['planManagementKind']
        === this.managementKind;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });

    const sourceMatches = (itemSource: PlanPresetSource): boolean => (
      source === 'all' || itemSource === source
    );
    const planKey = (planSource: PlanPresetSource, file: string): string => (
      `${planSource}:${file.trim().toLocaleLowerCase('zh-CN')}`
    );
    const taskGroupUsage = new Map<string, Set<string>>();
    this.taskGroupsProvider().forEach(group => {
      group.items.forEach(item => {
        if (item.kind !== 'plan') return;
        let planSource = item.managedSource;
        let file = item.managedFile?.trim();
        if ((!planSource || !file) && item.path) {
          const normalizedPath = item.path.replace(/\\/g, '/');
          const lowerPath = normalizedPath.toLocaleLowerCase('zh-CN');
          if (/(^|\/)system_battle_plans\//.test(lowerPath)) {
            planSource = 'system';
          } else if (/(^|\/)user_battle_plans\//.test(lowerPath)) {
            planSource = 'user';
          }
          file = normalizedPath.split('/').pop()?.trim();
        }
        if (!planSource || !file) return;
        const key = planKey(planSource, file);
        const groups = taskGroupUsage.get(key) ?? new Set<string>();
        groups.add(group.name);
        taskGroupUsage.set(key, groups);
      });
    });

    const battlePlans = new Map<string, {
      file: string;
      name: string;
      source: PlanPresetSource;
      teams: Set<string>;
    }>();
    this.managementBindings.forEach(binding => {
      const key = `${binding.source}:${binding.planFile}`;
      let plan = battlePlans.get(key);
      if (!plan) {
        plan = {
          file: binding.planFile,
          name: binding.planName,
          source: binding.source,
          teams: new Set<string>(),
        };
        battlePlans.set(key, plan);
      }
      if (binding.teamName) plan.teams.add(binding.teamName);
    });

    const teamKey = (name: string): string => (
      name.trim().toLocaleLowerCase('zh-CN')
    );
    const availableTeams = new Set(
      this.managedTeamPlans.map(plan => teamKey(plan.name)),
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

    type ManagementRow = {
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
    };
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
    this.managedTeamPlans.forEach(plan => {
      const relations = [
        ...(teamUsage.get(teamKey(plan.name)) ?? []),
      ];
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
    this.managementErrors.forEach(error => {
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

    const sourceRows = rows.filter(row => sourceMatches(row.source));
    const filteredErrors = this.managementErrors.filter(error => (
      source === 'all' || error.source === source
    ));
    const linkedCount = sourceRows.filter(row => (
      row.kind === 'battle'
      && row.relations.length > 0
      && !row.attention
    )).length;
    const attentionCount = sourceRows.filter(row => row.attention).length;
    const setCount = (id: string, value: number): void => {
      const element = document.getElementById(id);
      if (element) element.textContent = String(value);
    };
    setCount(
      'plan-management-battle-count',
      sourceRows.filter(row => row.kind === 'battle').length,
    );
    setCount(
      'plan-management-team-count',
      sourceRows.filter(row => row.kind === 'team').length,
    );
    setCount('plan-management-linked-count', linkedCount);
    setCount('plan-management-attention-count', attentionCount);

    const warning = document.getElementById('plan-management-warning');
    if (warning) {
      warning.hidden = filteredErrors.length === 0;
      warning.textContent = filteredErrors.length > 0
        ? `有 ${filteredErrors.length} 个 YAML 无法读取，可在下方查看并处理。`
        : '';
      warning.title = filteredErrors
        .map(error => (
          `${error.source}/${error.file}: ${error.message}`
        ))
        .join('\n');
    }

    const query = this.managementQuery.toLocaleLowerCase('zh-CN');
    const attentionOnly = this.managementAttentionOnly?.checked ?? false;
    const visibleRows = sourceRows.filter(row => {
      if (this.managementKind !== 'all' && row.kind !== this.managementKind) {
        return false;
      }
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

    this.managementBody.replaceChildren();
    if (visibleRows.length === 0) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 6;
      cell.className = 'plan-management-empty';
      cell.textContent = sourceRows.length > 0
        ? '没有符合当前筛选条件的 YAML'
        : '当前目录中没有可读取的 YAML';
      row.append(cell);
      this.managementBody.append(row);
      restoreScrollPosition(scroll, scrollPosition);
      return;
    }

    const fragment = document.createDocumentFragment();
    visibleRows.forEach(item => {
      const row = document.createElement('tr');
      row.classList.toggle('needs-attention', item.attention);

      const planCell = document.createElement('td');
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
      planCell.append(kind, identity);

      const sourceCell = document.createElement('td');
      const sourceBadge = document.createElement('span');
      sourceBadge.className = `plan-source-badge ${item.source}`;
      sourceBadge.textContent = item.source === 'system' ? '系统' : '用户';
      sourceCell.append(sourceBadge);

      const relationCell = document.createElement('td');
      if (item.invalid) {
        relationCell.textContent = item.errorMessage || 'YAML 格式不合法';
        relationCell.className = 'plan-management-relation-error';
      } else if (item.relations.length === 0) {
        relationCell.textContent = item.kind === 'battle'
          ? item.ignoredUnlinked
            ? '该计划已设为无需舰队方案'
            : '未关联舰队方案'
          : item.ignoredUnlinked
            ? '该舰队方案已忽略引用检查'
            : '尚未被出征计划引用';
        relationCell.className = 'plan-management-relation-empty';
      } else {
        const relationList = document.createElement('div');
        relationList.className = 'plan-management-relations';
        item.relations.forEach(relation => {
          const chip = document.createElement('span');
          chip.className = item.missingRelations.has(relation)
            ? 'plan-relation-chip missing'
            : 'plan-relation-chip';
          chip.textContent = relation;
          if (item.missingRelations.has(relation)) {
            chip.title = '未找到同名舰队方案';
          }
          relationList.append(chip);
        });
        relationCell.append(relationList);
      }

      const taskGroupCell = document.createElement('td');
      if (item.kind === 'team') {
        taskGroupCell.textContent = '—';
        taskGroupCell.className = 'plan-management-relation-empty';
      } else if (item.taskGroups.length === 0) {
        taskGroupCell.textContent = '未加入任务分组';
        taskGroupCell.className = 'plan-management-relation-empty';
      } else {
        const groupList = document.createElement('div');
        groupList.className = 'plan-management-relations';
        item.taskGroups.forEach(groupName => {
          const chip = document.createElement('span');
          chip.className = 'plan-relation-chip';
          chip.textContent = groupName;
          groupList.append(chip);
        });
        taskGroupCell.append(groupList);
      }

      const statusCell = document.createElement('td');
      if (item.status) {
        const status = document.createElement('span');
        status.className = `plan-management-status ${item.statusClass}`;
        status.textContent = item.status;
        statusCell.append(status);
      }

      const actionCell = document.createElement('td');
      actionCell.className = 'plan-management-actions';
      if (item.invalid) {
        if (item.source === 'user') {
          actionCell.append(
            this.managementButton(
              '删除',
              item.kind === 'battle' ? 'delete' : 'delete-team',
              item.file,
              true,
              item.source,
              item.name,
            ),
          );
        } else {
          actionCell.textContent = '只读';
        }
      } else if (item.kind === 'battle') {
        actionCell.append(
          this.managementButton(
            item.source === 'system' ? '查看' : '编辑',
            'edit-battle',
            item.file,
            false,
            item.source,
          ),
        );
        if (item.relations.length === 0) {
          const toggleButton = this.managementButton(
            item.ignoredUnlinked ? '恢复检查' : '忽略提示',
            'toggle-unlinked',
            item.file,
            false,
            item.source,
          );
          toggleButton.dataset['planIgnored'] = String(
            item.ignoredUnlinked === true,
          );
          toggleButton.dataset['planKind'] = 'battle';
          actionCell.append(toggleButton);
        }
        if (item.source === 'user') {
          actionCell.append(
            this.managementButton('重命名', 'rename', item.file),
            this.managementButton('删除', 'delete', item.file, true),
          );
        }
      } else if (item.kind === 'team') {
        actionCell.append(
          this.managementButton(
            item.source === 'system' ? '查看' : '编辑',
            'edit-team',
            item.file,
            false,
            item.source,
          ),
        );
        if (item.relations.length === 0) {
          const toggleButton = this.managementButton(
            item.ignoredUnlinked ? '恢复检查' : '忽略提示',
            'toggle-unlinked',
            item.file,
            false,
            item.source,
          );
          toggleButton.dataset['planIgnored'] = String(
            item.ignoredUnlinked === true,
          );
          toggleButton.dataset['planKind'] = 'team';
          actionCell.append(toggleButton);
        }
        if (item.source === 'user') {
          actionCell.append(
            this.managementButton(
              '删除',
              'delete-team',
              item.file,
              true,
              item.source,
              item.name,
            ),
          );
        }
      } else {
        actionCell.textContent = '只读';
      }
      row.append(
        planCell,
        sourceCell,
        relationCell,
        taskGroupCell,
        statusCell,
        actionCell,
      );
      fragment.append(row);
    });
    this.managementBody.append(fragment);
    restoreScrollPosition(scroll, scrollPosition);
  }

  private managementButton(
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
    const primary = (
      label === '编辑'
      && (operation === 'edit-battle' || operation === 'edit-team')
    );
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
    const bridge = window.electronBridge;
    if (!bridge?.setPlanUnlinkedIgnored) {
      await showAlert('操作失败', '请完整重启 GUI 后再操作');
      return;
    }
    try {
      const values = await bridge.setPlanUnlinkedIgnored(
        kind,
        source,
        file,
        ignored,
      );
      this.ignoredUnlinkedPlans = new Set(values);
      this.renderManagement();
    } catch (error) {
      await showAlert(
        '操作失败',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private async renameCombatPlan(file: string): Promise<void> {
    const bridge = window.electronBridge;
    if (!bridge?.renameUserCombatPlan) return;
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
    const result = await bridge.renameUserCombatPlan(file, newName.trim());
    if (!result.success) {
      await showAlert('重命名失败', result.error || '未知错误');
      return;
    }
    await this.loadManagement();
  }

  private async deleteCombatPlan(file: string): Promise<void> {
    const bridge = window.electronBridge;
    if (!bridge?.deleteUserCombatPlan) return;
    const confirmed = await showConfirm(
      '删除出征计划',
      `确定删除用户计划 ${file} 吗？此操作无法撤销。`,
    );
    if (!confirmed) return;
    const result = await bridge.deleteUserCombatPlan(file);
    if (!result.success) {
      await showAlert('删除失败', result.error || '未知错误');
      return;
    }
    await this.loadManagement();
  }

  private async deleteTeamPlan(file: string, name: string): Promise<void> {
    const bridge = window.electronBridge;
    if (!bridge?.deleteUserTeamPlan) return;
    const normalizedName = name.trim().toLocaleLowerCase('zh-CN');
    const references = new Set(
      this.managementBindings
        .filter(binding => (
          binding.teamName?.trim().toLocaleLowerCase('zh-CN')
            === normalizedName
        ))
        .map(binding => binding.planName),
    );
    const hasOtherTeamWithSameName = this.managedTeamPlans.some(plan => (
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
    const result = await bridge.deleteUserTeamPlan(file);
    if (!result.success) {
      await showAlert('删除失败', result.error || '未知错误');
      return;
    }
    await this.loadManagement();
  }

  private shipTypeDisplay(ship: ShipLibraryShip): string {
    const typeName = SHIP_TYPE_SHORT_NAMES[ship.ship_type]
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

  private normalizeSearch(value: string): string {
    return value
      .toLocaleLowerCase('zh-CN')
      .replace(/[\s·•._-]+/g, '');
  }
}
