/** 渲染舰队槽位并处理选择、清空和拖拽排序意图。 */
import type { ShipLibraryShip } from '../../types/ipc.js';
import type {
  FleetCandidateDraftViewObject as FleetCandidateDraft,
  FleetDraftViewObject as FleetDraft,
  FleetRuleDraftViewObject as FleetRuleDraft,
  FleetSlotDraftViewObject as FleetSlotDraft,
} from '../../types/view.js';
import { normalizeFleetShipTypeCode } from '../../shared/fleetShipTypes';
import {
  showAlert,
  showConfirm,
} from '../../controller/shared/DialogHelper';
import {
  captureScrollPosition,
  restoreScrollPosition,
} from '../shared/scrollPosition';
import { createShipArtwork } from './ShipArtwork';
import { FLEET_DRAG_MIME } from './FleetGalleryView';
import { FleetRuleView } from './FleetRuleView';

type SlotGroup = 'formation' | 'backup';

interface FleetDragData {
  source?: 'gallery' | SlotGroup;
  shipId?: number;
  position?: number;
  candidateIndex?: number;
}

export interface FleetEditorViewHost {
  currentDraft(): FleetDraft;
  createRuleDraft(): FleetRuleDraft;
  createCandidateDraft(ship?: ShipLibraryShip | null): FleetCandidateDraft;
  createSlotDraft(): FleetSlotDraft;
  cloneRule(source: FleetRuleDraft): FleetRuleDraft;
  copyRule(target: FleetRuleDraft, source: FleetRuleDraft): void;
  shipById(id: number): ShipLibraryShip | undefined;
  colorfulBackgroundUrl(): string;
  shipTypeDisplay(ship: ShipLibraryShip): string;
  renderGallerySelection(): void;
  updateGalleryCardTargets(): void;
}

const DEFAULT_BACKUP_SLOT_COUNT = 6;
const FLEET_SLOT_COUNT = 6;

export class FleetEditorView {
  private readonly slotList = document.getElementById('fleet-slot-list')!;
  private readonly backupSlotList = document.getElementById(
    'fleet-backup-slot-list',
  )!;
  private readonly backupScroll = this.backupSlotList.parentElement!;
  private readonly backupTitle = document.getElementById(
    'fleet-backup-title',
  )!;
  private readonly backupAppendDrop = document.getElementById(
    'fleet-backup-append-drop',
  )!;
  private readonly backupCopyDialog = document.getElementById(
    'fleet-backup-copy-dialog',
  )!;
  private readonly backupCopyDescription = document.getElementById(
    'fleet-backup-copy-description',
  )!;
  private readonly backupCopyTargets = document.getElementById(
    'fleet-backup-copy-targets',
  )!;
  private readonly ruleView: FleetRuleView;

  private activeSlotGroup: SlotGroup = 'formation';
  private activePosition = 0;
  private activeBackupIndex = 0;
  private backupDragScroll:
    { top: number; left: number } | null = null;

  constructor(private readonly host: FleetEditorViewHost) {
    this.ruleView = new FleetRuleView({
      primaryRule: () => this.currentSlot(),
      backupRule: () => this.currentBackupRule(),
      clearRule: rule => this.clearFleetRule(rule),
    });
    this.bindActions();
  }

  render(): void {
    this.renderSlots();
    this.renderBackupSlots();
    this.ruleView.render();
  }

  reset(): void {
    this.activeSlotGroup = 'formation';
    this.activePosition = 0;
    this.activeBackupIndex = 0;
    this.render();
    this.host.renderGallerySelection();
  }

  activeSlotDescription(): string {
    if (this.activeSlotGroup === 'formation') {
      return `编队位置 ${this.activePosition + 1}`;
    }
    return `位置 ${this.activePosition + 1} 的第 ${
      this.activeBackupIndex + 1
    } 个备选槽位`;
  }

  selectedShips(): ShipLibraryShip[] {
    if (this.activeSlotGroup === 'formation') {
      return this.currentFleet().slots
        .map(slot => slot.primary)
        .filter((ship): ship is ShipLibraryShip => ship !== null);
    }
    return this.currentSlot().candidates
      .map(candidate => candidate.ship)
      .filter((ship): ship is ShipLibraryShip => ship !== null);
  }

  assignShip(ship: ShipLibraryShip): void {
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
          slot.candidates.push(this.host.createCandidateDraft());
        }
        const candidate = slot.candidates[target];
        candidate.ship = ship;
        this.applyDefaultShipType(candidate, ship);
        this.activeBackupIndex = target;
        if (!replacing) {
          const nextEmpty = slot.candidates.findIndex(
            (item, index) => index > target && item.ship === null,
          );
          if (nextEmpty >= 0) this.activeBackupIndex = nextEmpty;
        }
      }
    }
    this.render();
    this.host.renderGallerySelection();
  }

  rememberBackupScroll(): void {
    this.backupDragScroll = {
      top: this.backupScroll.scrollTop,
      left: this.backupScroll.scrollLeft,
    };
  }

  clearBackupDragScroll(): void {
    this.backupDragScroll = null;
  }

  isSlotEmpty(slot: FleetSlotDraft): boolean {
    return slot.primary === null
      && slot.candidates.every(candidate => candidate.ship === null);
  }

  private bindActions(): void {
    this.slotList.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      const removeButton = target.closest<HTMLButtonElement>(
        '[data-remove-slot]',
      );
      if (removeButton) {
        const slot = Number(removeButton.dataset['removeSlot']);
        if (Number.isInteger(slot) && slot >= 0 && slot < FLEET_SLOT_COUNT) {
          const slots = this.currentFleet().slots;
          const selected = slots[slot];
          selected.primary = null;
          this.clearFleetRule(selected);
          this.activePosition = this.compactFleetSlots(selected, slot);
          this.activeSlotGroup = 'formation';
          this.activeBackupIndex = 0;
          this.render();
          this.host.renderGallerySelection();
        }
        return;
      }
      const slotButton = target.closest<HTMLButtonElement>(
        '[data-fleet-slot]',
      );
      if (!slotButton) return;
      const slot = Number(slotButton.dataset['fleetSlot']);
      if (
        !Number.isInteger(slot)
        || slot < 0
        || slot >= FLEET_SLOT_COUNT
      ) {
        return;
      }
      const gallerySelectionChanged = this.activeSlotGroup !== 'formation';
      this.activeSlotGroup = 'formation';
      this.activePosition = slot;
      this.activeBackupIndex = 0;
      this.render();
      if (gallerySelectionChanged) {
        this.host.renderGallerySelection();
      } else {
        this.host.updateGalleryCardTargets();
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
      this.ruleView.render();
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
      if (!slot || !event.dataTransfer?.types.includes(FLEET_DRAG_MIME)) {
        return;
      }
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
      this.handleFleetDrop(
        event.dataTransfer.getData(FLEET_DRAG_MIME),
        Number(slot.dataset['fleetSlot']),
      );
    });
    this.slotList.addEventListener('dragend', () => {
      this.slotList.querySelectorAll('.drag-over').forEach((slot) => {
        slot.classList.remove('drag-over');
      });
      this.showBackupAppendDrop(false);
      this.clearBackupDragScroll();
    });

    this.backupSlotList.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      const removeButton = target.closest<HTMLButtonElement>(
        '[data-remove-backup-slot]',
      );
      if (removeButton) {
        const slot = Number(removeButton.dataset['removeBackupSlot']);
        const candidates = this.currentSlot().candidates;
        if (
          Number.isInteger(slot)
          && slot >= 0
          && slot < candidates.length
        ) {
          const owner = this.currentSlot();
          candidates.splice(slot, 1);
          this.compactCandidates(candidates);
          this.activeSlotGroup = 'backup';
          this.activeBackupIndex = Math.min(slot, candidates.length - 1);
          if (this.isSlotEmpty(owner)) {
            this.activePosition = this.compactFleetSlots(
              null,
              this.activePosition,
            );
            this.activeSlotGroup = 'formation';
            this.activeBackupIndex = 0;
          }
          this.render();
          this.host.renderGallerySelection();
        }
        return;
      }
      const slotButton = target.closest<HTMLButtonElement>(
        '[data-backup-slot]',
      );
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
      this.render();
      if (gallerySelectionChanged) {
        this.host.renderGallerySelection();
      } else {
        this.host.updateGalleryCardTargets();
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
      if (!slot || !event.dataTransfer?.types.includes(FLEET_DRAG_MIME)) {
        return;
      }
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
      this.clearBackupDragScroll();
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

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.closeBackupCopyDialog();
    });
    document.getElementById('btn-clear-fleet')?.addEventListener(
      'click',
      () => {
        this.currentFleet().slots = Array.from(
          { length: FLEET_SLOT_COUNT },
          () => this.host.createSlotDraft(),
        );
        this.reset();
      },
    );
    document.getElementById('btn-add-fleet-backup')?.addEventListener(
      'click',
      () => {
        const candidates = this.currentSlot().candidates;
        let target = candidates.findIndex(
          candidate => candidate.ship === null,
        );
        if (target < 0) {
          candidates.push(this.host.createCandidateDraft());
          target = candidates.length - 1;
        }
        this.activeSlotGroup = 'backup';
        this.activeBackupIndex = target;
        this.render();
        requestAnimationFrame(() => {
          this.backupSlotList.querySelector<HTMLElement>(
            `[data-backup-slot="${target}"]`,
          )?.scrollIntoView({
            block: 'nearest',
            inline: 'nearest',
            behavior: 'smooth',
          });
        });
      },
    );
    document.getElementById('btn-copy-fleet-backup')?.addEventListener(
      'click',
      () => {
        void this.openBackupCopyDialog();
      },
    );
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
  }

  private assignFormationShip(
    ship: ShipLibraryShip,
    position: number,
    sourceRule?: FleetRuleDraft,
    advanceToNextEmpty = true,
  ): void {
    const slots = this.currentFleet().slots;
    const firstEmpty = slots.findIndex(slot => this.isSlotEmpty(slot));
    const requested = slots[position];
    const target = (
      requested.primary
      || !this.isSlotEmpty(requested)
      || firstEmpty < 0
    )
      ? position
      : firstEmpty;
    const slot = slots[target];
    const replacing = slot.primary !== null;
    slot.primary = ship;
    if (sourceRule) this.host.copyRule(slot, sourceRule);
    this.applyDefaultShipType(slot, ship);
    this.activeSlotGroup = 'formation';
    this.activePosition = target;
    this.activeBackupIndex = 0;
    if (!replacing && advanceToNextEmpty) {
      const nextEmpty = slots.findIndex(
        (current, index) => (
          index > target && this.isSlotEmpty(current)
        ),
      );
      if (nextEmpty >= 0) this.activePosition = nextEmpty;
    }
  }

  private handleFleetDrop(raw: string, targetPosition: number): void {
    if (!raw || targetPosition < 0 || targetPosition >= FLEET_SLOT_COUNT) {
      return;
    }
    try {
      const data = JSON.parse(raw) as FleetDragData;
      if (
        data.source === 'formation'
        && Number.isInteger(data.position)
        && data.position! >= 0
        && data.position! < FLEET_SLOT_COUNT
      ) {
        const moved = this.moveFormationSlot(
          data.position!,
          targetPosition,
        );
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
      this.render();
      this.host.renderGallerySelection();
      this.showBackupAppendDrop(false);
    } catch {
      // Ignore drag data created outside the fleet planner.
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
          candidate => (
            candidate.ship?.search_name === dragged.ship.search_name
          ),
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
      this.render();
      this.host.renderGallerySelection();
      this.showBackupAppendDrop(false);
    } catch {
      // Ignore drag data created outside the fleet planner.
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

    if (!this.isSlotEmpty(slots[targetPosition])) {
      [slots[sourcePosition], slots[targetPosition]] = [
        slots[targetPosition],
        moved,
      ];
      return moved;
    }

    slots.splice(sourcePosition, 1);
    const firstEmpty = slots.findIndex(slot => this.isSlotEmpty(slot));
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
      this.host.copyRule(targetSlot, candidate);
      sourceSlot.candidates.splice(sourceIndex, 1);
      this.compactCandidates(sourceSlot.candidates);
      if (this.isSlotEmpty(sourceSlot)) {
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

    const selected = target.ship
      ? this.swapPrimaryAndCandidate(
          sourceSlot,
          targetSlot,
          targetIndex,
        )
      : this.appendFormationToBackup(sourceSlot, targetSlot);
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
      sourceSlot.candidates[sourceIndex] = this.host.createCandidateDraft();
      this.compactCandidates(sourceSlot.candidates);
      this.compactCandidates(targetSlot.candidates);
      if (this.isSlotEmpty(sourceSlot)) {
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
      this.render();
      this.host.renderGallerySelection();
    } catch {
      // Ignore drag data created outside the fleet planner.
    }
  }

  private appendFormationToBackup(
    sourceSlot: FleetSlotDraft,
    targetSlot: FleetSlotDraft,
  ): FleetCandidateDraft {
    const ship = sourceSlot.primary!;
    const rule = this.host.cloneRule(sourceSlot);
    const selected = this.appendBackupCandidate(targetSlot, ship, rule);
    sourceSlot.primary = null;
    this.clearFleetRule(sourceSlot);
    if (this.isSlotEmpty(sourceSlot)) {
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
    const selected = this.host.createCandidateDraft(ship);
    this.host.copyRule(selected, rule);
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
        () => this.host.createCandidateDraft(),
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
    const primaryRule = this.host.cloneRule(primarySlot);
    const candidate = candidateSlot.candidates[candidateIndex];
    const promoted = candidate.ship!;
    const promotedRule = this.host.cloneRule(candidate);

    primarySlot.primary = promoted;
    this.host.copyRule(primarySlot, promotedRule);
    candidate.ship = primary;
    this.host.copyRule(candidate, primaryRule);
    return candidate;
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
    this.host.copyRule(target, this.host.createRuleDraft());
  }

  private compactFleetSlots(
    preferred: FleetSlotDraft | null,
    fallbackPosition: number,
  ): number {
    const slots = this.currentFleet().slots;
    const occupied = slots.filter(slot => !this.isSlotEmpty(slot));
    slots.splice(
      0,
      slots.length,
      ...occupied,
      ...Array.from(
        { length: Math.max(0, FLEET_SLOT_COUNT - occupied.length) },
        () => this.host.createSlotDraft(),
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
      const ship = this.host.shipById(data.shipId!);
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

  private compactCandidates(candidates: FleetCandidateDraft[]): void {
    const occupied = candidates.filter(candidate => candidate.ship !== null);
    const slotCount = Math.max(DEFAULT_BACKUP_SLOT_COUNT, occupied.length);
    candidates.splice(
      0,
      candidates.length,
      ...occupied,
      ...Array.from(
        { length: slotCount - occupied.length },
        () => this.host.createCandidateDraft(),
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
        slot.primary === null && !this.isSlotEmpty(slot),
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
      : this.activeSlotGroup === 'backup'
        && index === this.activeBackupIndex;
    slot.classList.toggle('active', active);
    slot.classList.toggle('candidate-only', candidateOnly);
    slot.draggable = Boolean(ship);
    if (candidateOnly) {
      slot.setAttribute(
        'aria-label',
        `位置 ${index + 1} 没有主选，已有备选舰船`,
      );
      const colorfulBackgroundUrl = this.host.colorfulBackgroundUrl();
      if (colorfulBackgroundUrl) {
        const background = document.createElement('img');
        background.className = 'fleet-slot-placeholder-background';
        background.src = colorfulBackgroundUrl;
        background.alt = '';
        background.draggable = false;
        slot.append(background);
      }
    }

    if (ship) {
      slot.append(createShipArtwork(
        ship,
        this.host.shipTypeDisplay(ship),
      ));
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

  private currentFleet(): FleetDraft {
    return this.host.currentDraft();
  }

  private currentSlot(): FleetSlotDraft {
    return this.currentFleet().slots[this.activePosition];
  }

  private currentBackupRule(): FleetCandidateDraft {
    return this.currentSlot().candidates[this.activeBackupIndex];
  }

  private applyDefaultShipType(
    rule: FleetRuleDraft,
    ship: ShipLibraryShip,
  ): void {
    const shipType = normalizeFleetShipTypeCode(ship.ship_type);
    if (!shipType) return;
    if (
      rule.shipTypes.length === 0
      || !rule.shipTypes.includes(shipType)
    ) {
      rule.shipTypes = [shipType];
    }
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

    const sourceName = source.primary?.name
      ?? `位置${this.activePosition + 1}`;
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
      button.disabled = index === this.activePosition || sameBackupQueue;

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
      const targetName = target.primary?.name
        ?? `位置${targetPosition + 1}`;
      const overwrite = await showConfirm(
        '覆盖备选队列',
        `【${targetName}】已有 ${targetBackupCount} 艘备选，是否覆盖？`,
      );
      if (!overwrite) return;
    }

    const copied = sourceBackups.map(candidate => ({
      ship: candidate.ship,
      ...this.host.cloneRule(candidate),
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
        () => this.host.createCandidateDraft(),
      ),
    ];
    this.closeBackupCopyDialog();
    this.render();
    this.host.renderGallerySelection();
  }
}
