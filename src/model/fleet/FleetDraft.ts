/** 维护普通舰队槽位、候选舰和拖拽编辑的唯一草稿。 */
import type {
  PlanPresetSource,
  ShipLibraryShip,
} from '../../types/ipc.js';

const DEFAULT_BACKUP_SLOT_COUNT = 6;
const FLEET_SLOT_COUNT = 6;

export interface FleetRuleDraft {
  shipTypes: string[];
  levelEnabled: boolean;
  minLevel: number | null;
  maxLevel: number | null;
}

export interface FleetCandidateDraft extends FleetRuleDraft {
  ship: ShipLibraryShip | null;
}

export interface FleetSlotDraft extends FleetRuleDraft {
  primary: ShipLibraryShip | null;
  candidates: FleetCandidateDraft[];
}

export interface FleetDraft {
  name: string;
  file: string | null;
  source: PlanPresetSource;
  slots: FleetSlotDraft[];
}

export function createFleetRuleDraft(): FleetRuleDraft {
  return {
    shipTypes: [],
    levelEnabled: false,
    minLevel: null,
    maxLevel: null,
  };
}

export function createFleetCandidateDraft(
  ship: ShipLibraryShip | null = null,
): FleetCandidateDraft {
  return {
    ship,
    ...createFleetRuleDraft(),
  };
}

export function createFleetSlotDraft(): FleetSlotDraft {
  return {
    primary: null,
    candidates: Array.from(
      { length: DEFAULT_BACKUP_SLOT_COUNT },
      () => createFleetCandidateDraft(),
    ),
    ...createFleetRuleDraft(),
  };
}

export function createFleetDraft(): FleetDraft {
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

export function cloneFleetRule(source: FleetRuleDraft): FleetRuleDraft {
  return {
    shipTypes: [...source.shipTypes],
    levelEnabled: source.levelEnabled,
    minLevel: source.minLevel,
    maxLevel: source.maxLevel,
  };
}

export function copyFleetRule(
  target: FleetRuleDraft,
  source: FleetRuleDraft,
): void {
  target.shipTypes = [...source.shipTypes];
  target.levelEnabled = source.levelEnabled;
  target.minLevel = source.minLevel;
  target.maxLevel = source.maxLevel;
}

export function fleetDraftSnapshot(draft: FleetDraft): string {
  const ruleSnapshot = (rule: FleetRuleDraft) => ({
    shipTypes: [...rule.shipTypes],
    levelEnabled: rule.levelEnabled,
    minLevel: rule.minLevel,
    maxLevel: rule.maxLevel,
  });
  return JSON.stringify({
    name: draft.name,
    slots: draft.slots.map(slot => ({
      primary: slot.primary?.id ?? null,
      rule: ruleSnapshot(slot),
      candidates: slot.candidates.map(candidate => ({
        ship: candidate.ship?.id ?? null,
        rule: ruleSnapshot(candidate),
      })),
    })),
  });
}

export function hasFleetDraftChanges(
  draft: FleetDraft,
  savedSnapshot: string,
): boolean {
  return fleetDraftSnapshot(draft) !== savedSnapshot;
}
