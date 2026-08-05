import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import esbuild from 'esbuild';

const require = createRequire(import.meta.url);
const result = esbuild.buildSync({
  stdin: {
    contents: [
      "export * from './src/model/fleet/index.ts';",
      "export { toBackendName } from './src/shared/shipNameNormalizer.ts';",
      "export { CurrentFleetController } from './src/controller/app/CurrentFleetController.ts';",
      "export { PlanFleetPresetController } from './src/controller/plan/PlanFleetPresetController.ts';",
      "export { PlanManagementController } from './src/controller/plan/PlanManagementController.ts';",
      "export { buildPlanManagementViewObject } from './src/controller/plan/planManagementViewObjects.ts';",
      "export * from './src/view/plan/GalleryShipCollection.ts';",
    ].join('\n'),
    loader: 'ts',
    resolveDir: process.cwd(),
    sourcefile: 'fleet-domain-test-entry.ts',
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  loader: { '.json': 'json' },
});
const module = { exports: {} };
new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, module, module.exports);
const {
  applyFleetDraftEdit,
  calculateGalleryBatchSize,
  CurrentFleetController,
  DecisiveFleetDraft,
  filterAndSortGalleryShips,
  PlanFleetPresetController,
  PlanManagementController,
  buildPlanManagementViewObject,
  compactFleetDraftSlots,
  createFleetCandidateDraft,
  createFleetDraft,
  fleetDraftFromTeamPlan,
  fleetDraftToTeamPlan,
  fleetPresetIdentityKey,
  fleetPresetRuleKey,
  hasOtherPrimaryShip,
  insertFleetCandidate,
  insertFleetPrimary,
  isFleetSlotEmpty,
  moveFleetPrimary,
  normalizeGallerySearch,
  removeFleetPrimary,
  resolveFleetSlotPosition,
  resolveGalleryFormationAssignment,
  resolveGalleryFormationDropTarget,
  resolveFleetPresetRules,
  resolveFleetPreset,
  toBackendName,
} = module.exports;

let passedScenarioCount = 0;
async function runScenario(name, run) {
  try {
    await run();
    passedScenarioCount += 1;
    console.log(`PASSED: ${name}`);
  } catch (error) {
    console.error(`FAILED: ${name}`);
    throw error;
  }
}

const testShip = (id, name) => ({
  id,
  name,
  search_name: name,
  ship_type: 'dd',
});
const galleryShip = (
  id,
  name,
  searchName,
  variant,
  shipType,
  country,
) => ({
  id,
  name,
  search_name: searchName,
  variant,
  rarity: 1,
  ship_type: shipType,
  size_class: 'small',
  role_class: 'surface',
  country,
  portraitUrl: '',
  backgroundUrl: '',
  frameUrl: '',
  typeIconUrl: '',
});

await runScenario('舰名归一化与图库筛选保持普通和决战语义', () => {
assert.equal(toBackendName('岛风(岛风型驱逐舰)·改'), '岛风');
assert.equal(normalizeGallerySearch(' U.47·狼群 '), 'u47狼群');

const galleryShips = [
  galleryShip(3, '夕张', '夕张', 'normal', 'cl', 'jp'),
  galleryShip(1, 'U-47', 'U-47', 'normal', 'ss', 'de'),
  galleryShip(2, 'U-47·狼群', 'U-47', 'refit', 'ss', 'de'),
  galleryShip(4, 'T-23', 'T-23', 'special', 'dd', 'de'),
];
const galleryTypeLabels = {
  cl: '轻巡洋舰',
  dd: '驱逐舰',
  ss: '潜艇',
};
const refitGalleryShips = filterAndSortGalleryShips(galleryShips, {
  searchText: 'U.47',
  typeFilters: new Set(['ss']),
  countryFilters: new Set(['de']),
  refitOnly: true,
  sortField: 'id',
  descending: false,
  shipTypeLabels: galleryTypeLabels,
  isExcluded: () => false,
});
assert.deepEqual(refitGalleryShips.map(ship => ship.id), [2]);

const decisiveVisibleShips = filterAndSortGalleryShips(galleryShips, {
  searchText: '',
  typeFilters: new Set(),
  countryFilters: new Set(),
  refitOnly: false,
  sortField: 'id',
  descending: true,
  shipTypeLabels: galleryTypeLabels,
  isExcluded: ship => ship.search_name === 'U-47',
});
assert.deepEqual(
  decisiveVisibleShips.map(ship => ship.id),
  [4, 3],
);
assert.deepEqual(galleryShips.map(ship => ship.id), [3, 1, 2, 4]);

const typeSearchShips = filterAndSortGalleryShips(galleryShips, {
  searchText: '潜艇',
  typeFilters: new Set(),
  countryFilters: new Set(),
  refitOnly: false,
  sortField: 'id',
  descending: false,
  shipTypeLabels: galleryTypeLabels,
  isExcluded: ship => ship.id === 2,
});
assert.deepEqual(typeSearchShips.map(ship => ship.id), [1]);

assert.equal(calculateGalleryBatchSize(0, 0), 12);
assert.equal(calculateGalleryBatchSize(664, 612), 25);
});

const createFollowModeDraft = () => {
  const draft = createFleetDraft();
  draft.slots[0].primary = testShip(1, '主选A');
  draft.slots[0].candidates[0] = createFleetCandidateDraft(
    testShip(11, '备选A'),
  );
  draft.slots[1].primary = testShip(2, '主选B');
  draft.slots[1].candidates[0] = createFleetCandidateDraft(
    testShip(12, '备选B'),
  );
  return draft;
};

await runScenario('主选分配删除和插入保持槽位与焦点规则', () => {
const duplicatePrimaryDraft = createFollowModeDraft();
assert.equal(
  hasOtherPrimaryShip(
    duplicatePrimaryDraft.slots,
    '主选A',
    1,
  ),
  true,
);
assert.equal(
  hasOtherPrimaryShip(
    duplicatePrimaryDraft.slots,
    '主选A',
    0,
  ),
  false,
);

const preservedFocusDraft = createFleetDraft();
preservedFocusDraft.slots[0].primary = testShip(31, '删除目标');
preservedFocusDraft.slots[1].primary = testShip(32, '中间主选');
preservedFocusDraft.slots[2].primary = testShip(33, '当前焦点');
const focusedSlot = preservedFocusDraft.slots[2];
const focusedPosition = removeFleetPrimary(
  preservedFocusDraft.slots,
  0,
  2,
);
assert.equal(focusedPosition, 1);
assert.equal(preservedFocusDraft.slots[focusedPosition], focusedSlot);
assert.equal(
  preservedFocusDraft.slots[focusedPosition].primary.name,
  '当前焦点',
);

const rightRemovalDraft = createFleetDraft();
rightRemovalDraft.slots[0].primary = testShip(34, '当前焦点');
rightRemovalDraft.slots[1].primary = testShip(35, '删除目标');
const rightFocusedSlot = rightRemovalDraft.slots[0];
const rightFocusedPosition = removeFleetPrimary(
  rightRemovalDraft.slots,
  1,
  0,
);
assert.equal(rightFocusedPosition, 0);
assert.equal(rightRemovalDraft.slots[0], rightFocusedSlot);

const emptyFormationDraft = createFleetDraft();
assert.deepEqual(
  resolveGalleryFormationAssignment(
    emptyFormationDraft.slots,
    0,
    '连续新增A',
  ),
  { targetPosition: 0, activePosition: 1 },
);

const continuousFormationDraft = createFleetDraft();
continuousFormationDraft.slots[0].primary = testShip(41, '已有主选');
assert.deepEqual(
  resolveGalleryFormationAssignment(
    continuousFormationDraft.slots,
    0,
    '连续新增B',
  ),
  { targetPosition: 1, activePosition: 1 },
);

const replacementFormationDraft = createFleetDraft();
replacementFormationDraft.slots[0].primary = testShip(42, '当前主选');
replacementFormationDraft.slots[1].primary = testShip(43, '右侧主选');
assert.deepEqual(
  resolveGalleryFormationAssignment(
    replacementFormationDraft.slots,
    0,
    '替换主选',
  ),
  { targetPosition: 0, activePosition: 0 },
);
assert.deepEqual(
  resolveGalleryFormationAssignment(
    replacementFormationDraft.slots,
    0,
    '右侧主选',
  ),
  { targetPosition: 1, activePosition: 0 },
);

const skippedEmptyDraft = createFleetDraft();
assert.deepEqual(
  resolveGalleryFormationAssignment(
    skippedEmptyDraft.slots,
    3,
    '从左侧新增',
  ),
  { targetPosition: 0, activePosition: 1 },
);

const insertedFormationDraft = createFleetDraft();
insertedFormationDraft.slots.slice(0, 5).forEach((slot, index) => {
  slot.primary = testShip(70 + index, `原编队${index + 1}`);
});
assert.equal(
  resolveGalleryFormationDropTarget(insertedFormationDraft.slots, 2),
  2,
);
const leftEmptyFormationDraft = createFleetDraft();
leftEmptyFormationDraft.slots[2].primary = testShip(69, '右侧已有舰船');
assert.equal(
  resolveGalleryFormationDropTarget(leftEmptyFormationDraft.slots, 2),
  0,
);
const leftFormationSlots = insertedFormationDraft.slots.slice(0, 2);
const shiftedFormationSlots = insertedFormationDraft.slots.slice(2, 5);
const insertedFormationSlot = createFleetDraft().slots[0];
insertedFormationSlot.primary = testShip(80, '插入编队');
assert.equal(
  insertFleetPrimary(
    insertedFormationDraft.slots,
    2,
    insertedFormationSlot,
    'ship',
  ),
  insertedFormationSlot,
);
assert.deepEqual(
  insertedFormationDraft.slots.slice(0, 2),
  leftFormationSlots,
);
assert.equal(insertedFormationDraft.slots[2], insertedFormationSlot);
assert.deepEqual(
  insertedFormationDraft.slots.slice(3, 6),
  shiftedFormationSlots,
);

const fullFormationDraft = createFleetDraft();
fullFormationDraft.slots.forEach((slot, index) => {
  slot.primary = testShip(90 + index, `满编${index + 1}`);
});
const fullFormationSnapshot = [...fullFormationDraft.slots];
const rejectedFormationSlot = createFleetDraft().slots[0];
rejectedFormationSlot.primary = testShip(99, '无空位插入');
assert.equal(
  insertFleetPrimary(
    fullFormationDraft.slots,
    2,
    rejectedFormationSlot,
    'ship',
  ),
  null,
);
assert.deepEqual(fullFormationDraft.slots, fullFormationSnapshot);

const insertedCandidates = Array.from(
  { length: 6 },
  (_, index) => createFleetCandidateDraft(
    index < 5 ? testShip(100 + index, `原备选${index + 1}`) : null,
  ),
);
const leftCandidates = insertedCandidates.slice(0, 2);
const shiftedCandidates = insertedCandidates.slice(2, 5);
const insertedCandidate = createFleetCandidateDraft(
  testShip(110, '插入备选'),
);
assert.equal(
  insertFleetCandidate(insertedCandidates, 2, insertedCandidate),
  2,
);
assert.deepEqual(insertedCandidates.slice(0, 2), leftCandidates);
assert.equal(insertedCandidates[2], insertedCandidate);
assert.deepEqual(insertedCandidates.slice(3, 6), shiftedCandidates);
});

await runScenario('主选拖拽遵守舰船或位置备选跟随模式', () => {
const dragFocusDraft = createFollowModeDraft();
dragFocusDraft.slots[2].primary = testShip(44, '保持焦点');
const dragFocusedSlot = dragFocusDraft.slots[2];
moveFleetPrimary(dragFocusDraft.slots, 0, 1, 'ship');
assert.equal(
  resolveFleetSlotPosition(dragFocusDraft.slots, dragFocusedSlot, 2),
  2,
);

const shipFollowDraft = createFollowModeDraft();
moveFleetPrimary(
  shipFollowDraft.slots,
  0,
  1,
  'ship',
);
assert.equal(shipFollowDraft.slots[0].primary.name, '主选B');
assert.equal(shipFollowDraft.slots[0].candidates[0].ship.name, '备选B');

const positionFollowDraft = createFollowModeDraft();
moveFleetPrimary(
  positionFollowDraft.slots,
  0,
  1,
  'position',
);
assert.equal(positionFollowDraft.slots[0].primary.name, '主选B');
assert.equal(positionFollowDraft.slots[0].candidates[0].ship.name, '备选A');
assert.equal(positionFollowDraft.slots[1].primary.name, '主选A');
assert.equal(positionFollowDraft.slots[1].candidates[0].ship.name, '备选B');

const switchedModeDraft = createFollowModeDraft();
moveFleetPrimary(
  switchedModeDraft.slots,
  0,
  1,
  'position',
);
assert.equal(switchedModeDraft.slots[0].primary.name, '主选B');
assert.equal(switchedModeDraft.slots[0].candidates[0].ship.name, '备选A');
moveFleetPrimary(
  switchedModeDraft.slots,
  0,
  1,
  'ship',
);
assert.equal(switchedModeDraft.slots[0].primary.name, '主选A');
assert.equal(switchedModeDraft.slots[0].candidates[0].ship.name, '备选B');
assert.equal(switchedModeDraft.slots[1].primary.name, '主选B');
assert.equal(switchedModeDraft.slots[1].candidates[0].ship.name, '备选A');

const reservedPositionDraft = createFleetDraft();
reservedPositionDraft.slots[0].primary = testShip(3, '主选C');
reservedPositionDraft.slots[0].candidates[0] = createFleetCandidateDraft(
  testShip(13, '备选C'),
);
reservedPositionDraft.slots[1].primary = testShip(4, '主选D');
reservedPositionDraft.slots[0].primary = null;
compactFleetDraftSlots(reservedPositionDraft.slots);
assert.equal(reservedPositionDraft.slots[0].primary, null);
assert.equal(
  reservedPositionDraft.slots[0].candidates[0].ship.name,
  '备选C',
);
assert.equal(reservedPositionDraft.slots[1].primary.name, '主选D');
reservedPositionDraft.slots[0].candidates[0].ship = null;
compactFleetDraftSlots(reservedPositionDraft.slots);
assert.equal(reservedPositionDraft.slots[0].primary.name, '主选D');

const shiftedCandidateOnlyDraft = createFleetDraft();
shiftedCandidateOnlyDraft.slots[0].primary = testShip(5, '主选E');
shiftedCandidateOnlyDraft.slots[1].primary = testShip(6, '主选F');
shiftedCandidateOnlyDraft.slots[1].candidates[0] =
  createFleetCandidateDraft(testShip(16, '备选F'));
shiftedCandidateOnlyDraft.slots[2].candidates[0] =
  createFleetCandidateDraft(testShip(17, '纯备选G'));
shiftedCandidateOnlyDraft.slots[0].primary = null;
compactFleetDraftSlots(shiftedCandidateOnlyDraft.slots);
assert.equal(shiftedCandidateOnlyDraft.slots[0].primary.name, '主选F');
assert.equal(
  shiftedCandidateOnlyDraft.slots[0].candidates[0].ship.name,
  '备选F',
);
assert.equal(shiftedCandidateOnlyDraft.slots[1].primary, null);
assert.equal(
  shiftedCandidateOnlyDraft.slots[1].candidates[0].ship.name,
  '纯备选G',
);

const delayedBindingDraft = createFleetDraft();
delayedBindingDraft.slots[0].primary = testShip(7, '主选H');
const waitingSlot = delayedBindingDraft.slots[3];
waitingSlot.candidates[0] =
  createFleetCandidateDraft(testShip(18, '待绑定备选'));
assert.equal(waitingSlot.primary, null);
assert.equal(isFleetSlotEmpty(waitingSlot), false);
waitingSlot.primary = testShip(8, '新加入主选');
moveFleetPrimary(delayedBindingDraft.slots, 3, 0, 'ship');
assert.equal(delayedBindingDraft.slots[0].primary.name, '新加入主选');
assert.equal(
  delayedBindingDraft.slots[0].candidates[0].ship.name,
  '待绑定备选',
);

const draggedBindingDraft = createFleetDraft();
const draggedSource = draggedBindingDraft.slots[0];
draggedSource.primary = testShip(9, '拖入主选');
draggedSource.candidates[0] =
  createFleetCandidateDraft(testShip(20, '来源位置备选'));
const draggedTarget = draggedBindingDraft.slots[1];
draggedTarget.candidates[0] =
  createFleetCandidateDraft(testShip(19, '目标位置备选'));
moveFleetPrimary(draggedBindingDraft.slots, 0, 1, 'ship');
assert.equal(draggedBindingDraft.slots.indexOf(draggedSource), 1);
assert.equal(draggedSource.primary.name, '拖入主选');
assert.equal(draggedSource.candidates[0].ship.name, '来源位置备选');
assert.equal(draggedBindingDraft.slots.indexOf(draggedTarget), 0);
assert.equal(draggedBindingDraft.slots[0].primary, null);
assert.equal(
  draggedBindingDraft.slots[0].candidates[0].ship.name,
  '目标位置备选',
);

const positionBindingDraft = createFleetDraft();
positionBindingDraft.slots[0].primary = testShip(10, '位置模式主选');
positionBindingDraft.slots[0].candidates[0] =
  createFleetCandidateDraft(testShip(21, '来源位置保留备选'));
const positionTarget = positionBindingDraft.slots[1];
positionTarget.candidates[0] =
  createFleetCandidateDraft(testShip(22, '目标位置备选'));
moveFleetPrimary(positionBindingDraft.slots, 0, 1, 'position');
assert.equal(positionTarget.primary.name, '位置模式主选');
assert.equal(positionTarget.candidates[0].ship.name, '目标位置备选');
assert.equal(positionBindingDraft.slots[0].primary, null);
assert.equal(
  positionBindingDraft.slots[0].candidates[0].ship.name,
  '来源位置保留备选',
);

const candidateOnlyReorderDraft = createFleetDraft();
const candidateOnlySlots = candidateOnlyReorderDraft.slots.slice(0, 3);
candidateOnlySlots.forEach((slot, index) => {
  slot.candidates[0] = createFleetCandidateDraft(
    testShip(51 + index, `纯备选位置${index + 1}`),
  );
});
assert.equal(
  moveFleetPrimary(candidateOnlyReorderDraft.slots, 0, 2, 'position'),
  candidateOnlySlots[0],
);
assert.equal(candidateOnlyReorderDraft.slots[0], candidateOnlySlots[2]);
assert.equal(candidateOnlyReorderDraft.slots[1], candidateOnlySlots[1]);
assert.equal(candidateOnlyReorderDraft.slots[2], candidateOnlySlots[0]);
assert.equal(
  moveFleetPrimary(candidateOnlyReorderDraft.slots, 2, 0, 'ship'),
  null,
);

const candidateOnlyMoveToEndDraft = createFleetDraft();
const candidateOnlyMoveSlots = candidateOnlyMoveToEndDraft.slots.slice(0, 3);
candidateOnlyMoveSlots.forEach((slot, index) => {
  slot.candidates[0] = createFleetCandidateDraft(
    testShip(61 + index, `移动纯备选${index + 1}`),
  );
});
moveFleetPrimary(candidateOnlyMoveToEndDraft.slots, 0, 5, 'position');
assert.equal(
  candidateOnlyMoveToEndDraft.slots[0],
  candidateOnlyMoveSlots[1],
);
assert.equal(
  candidateOnlyMoveToEndDraft.slots[1],
  candidateOnlyMoveSlots[2],
);
assert.equal(
  candidateOnlyMoveToEndDraft.slots[2],
  candidateOnlyMoveSlots[0],
);
});

await runScenario('统一编辑入口处理赋值规则拖拽复制与清空', () => {
const editorAssignmentDraft = createFleetDraft();
const editorPrimary = testShip(120, '编辑器主选');
const primaryAssignment = applyFleetDraftEdit(editorAssignmentDraft, {
  type: 'assign-ship',
  selection: {
    group: 'formation',
    position: 0,
    candidateIndex: 0,
  },
  ship: editorPrimary,
});
assert.equal(editorAssignmentDraft.slots[0].primary, editorPrimary);
assert.deepEqual(editorAssignmentDraft.slots[0].shipTypes, ['dd']);
assert.deepEqual(primaryAssignment.selection, {
  group: 'formation',
  position: 1,
  candidateIndex: 0,
});

const editorBackup = testShip(121, '编辑器备选');
const backupAssignment = applyFleetDraftEdit(editorAssignmentDraft, {
  type: 'assign-ship',
  selection: {
    group: 'backup',
    position: 0,
    candidateIndex: 0,
  },
  ship: editorBackup,
});
assert.equal(
  editorAssignmentDraft.slots[0].candidates[0].ship,
  editorBackup,
);
assert.deepEqual(
  editorAssignmentDraft.slots[0].candidates[0].shipTypes,
  ['dd'],
);
assert.deepEqual(backupAssignment.selection, {
  group: 'backup',
  position: 0,
  candidateIndex: 1,
});

assert.equal(applyFleetDraftEdit(editorAssignmentDraft, {
  type: 'update-rule',
  position: 0,
  update: {
    levelEnabled: true,
    minLevel: 30,
    maxLevel: 90,
  },
}).changed, true);
assert.equal(editorAssignmentDraft.slots[0].levelEnabled, true);
assert.equal(editorAssignmentDraft.slots[0].minLevel, 30);
assert.equal(editorAssignmentDraft.slots[0].maxLevel, 90);
assert.equal(applyFleetDraftEdit(editorAssignmentDraft, {
  type: 'update-rule',
  position: 0,
  candidateIndex: 0,
  update: { minLevel: 50 },
}).changed, true);
assert.equal(editorAssignmentDraft.slots[0].candidates[0].minLevel, 50);

const editorShipFollowDraft = createFollowModeDraft();
const shipFollowResult = applyFleetDraftEdit(editorShipFollowDraft, {
  type: 'drop-formation',
  source: { group: 'formation', position: 0 },
  targetPosition: 1,
  selection: {
    group: 'formation',
    position: 0,
    candidateIndex: 0,
  },
  backupFollowMode: 'ship',
});
assert.equal(editorShipFollowDraft.slots[0].primary.name, '主选B');
assert.equal(
  editorShipFollowDraft.slots[0].candidates[0].ship.name,
  '备选B',
);
assert.equal(shipFollowResult.selection.position, 1);

const editorPositionFollowDraft = createFollowModeDraft();
const positionFollowResult = applyFleetDraftEdit(editorPositionFollowDraft, {
  type: 'drop-formation',
  source: { group: 'formation', position: 0 },
  targetPosition: 1,
  selection: {
    group: 'formation',
    position: 0,
    candidateIndex: 0,
  },
  backupFollowMode: 'position',
});
assert.equal(editorPositionFollowDraft.slots[0].primary.name, '主选B');
assert.equal(
  editorPositionFollowDraft.slots[0].candidates[0].ship.name,
  '备选A',
);
assert.equal(positionFollowResult.selection.position, 1);

const editorCrossGroupDraft = createFollowModeDraft();
const movedToBackup = applyFleetDraftEdit(editorCrossGroupDraft, {
  type: 'drop-backup',
  source: { group: 'formation', position: 0 },
  targetPosition: 1,
  targetCandidateIndex: 1,
});
assert.equal(movedToBackup.changed, true);
assert.equal(editorCrossGroupDraft.slots[0].primary, null);
assert.equal(
  editorCrossGroupDraft.slots[0].candidates[0].ship.name,
  '备选A',
);
assert.equal(editorCrossGroupDraft.slots[1].primary.name, '主选B');
assert.deepEqual(
  editorCrossGroupDraft.slots[1].candidates
    .filter(candidate => candidate.ship)
    .map(candidate => candidate.ship.name),
  ['备选B', '主选A'],
);

const duplicateCandidate = createFleetCandidateDraft(
  editorCrossGroupDraft.slots[1].primary,
);
editorCrossGroupDraft.slots[0].candidates[1] = duplicateCandidate;
const rejectedDuplicate = applyFleetDraftEdit(editorCrossGroupDraft, {
  type: 'drop-formation',
  source: {
    group: 'backup',
    position: 0,
    candidateIndex: 1,
  },
  targetPosition: 0,
  selection: {
    group: 'formation',
    position: 1,
    candidateIndex: 0,
  },
  backupFollowMode: 'ship',
});
assert.equal(rejectedDuplicate.changed, false);
assert.match(rejectedDuplicate.error.message, /不能添加同名舰船/);

const editorCopyDraft = createFleetDraft();
editorCopyDraft.slots[0].candidates[0] = createFleetCandidateDraft(
  testShip(122, '复制备选'),
);
editorCopyDraft.slots[0].candidates[0].levelEnabled = true;
editorCopyDraft.slots[0].candidates[0].minLevel = 40;
assert.equal(applyFleetDraftEdit(editorCopyDraft, {
  type: 'copy-backups',
  sourcePosition: 0,
  targetPosition: 1,
}).changed, true);
assert.equal(
  editorCopyDraft.slots[1].candidates[0].ship.name,
  '复制备选',
);
assert.equal(editorCopyDraft.slots[1].candidates[0].minLevel, 40);
assert.notEqual(
  editorCopyDraft.slots[1].candidates[0],
  editorCopyDraft.slots[0].candidates[0],
);

assert.equal(applyFleetDraftEdit(editorCopyDraft, {
  type: 'clear',
}).changed, true);
assert.equal(
  editorCopyDraft.slots.every(slot => isFleetSlotEmpty(slot)),
  true,
);
});

await runScenario('舰队方案往返持久化并拒绝非法规则', () => {
const persistedDraft = createFleetDraft();
persistedDraft.slots[0].primary = testShip(201, '主选持久化');
persistedDraft.slots[0].shipTypes = ['cl'];
persistedDraft.slots[0].levelEnabled = true;
persistedDraft.slots[0].minLevel = 20;
persistedDraft.slots[0].candidates[0] = createFleetCandidateDraft(
  testShip(202, '主选的备选'),
);
persistedDraft.slots[0].candidates[0].levelEnabled = true;
persistedDraft.slots[0].candidates[0].maxLevel = 90;
persistedDraft.slots[1].candidates[0] = createFleetCandidateDraft(
  testShip(203, '纯候选'),
);
persistedDraft.slots[1].shipTypes = ['dd'];
persistedDraft.slots[1].levelEnabled = true;
persistedDraft.slots[1].minLevel = 30;
persistedDraft.slots[1].maxLevel = 80;

const persistedPlan = fleetDraftToTeamPlan(
  persistedDraft,
  '  持久化测试  ',
);
assert.equal(persistedPlan.name, '持久化测试');
assert.deepEqual(persistedPlan.ships[0], {
  name: '主选持久化',
  ship_type: ['cl'],
  min_level: 20,
  candidates: [{
    name: '主选的备选',
    max_level: 90,
  }],
});
assert.equal('name' in persistedPlan.ships[1], false);
assert.deepEqual(persistedPlan.ships[1], {
  ship_type: ['dd'],
  min_level: 30,
  max_level: 80,
  candidates: [{ name: '纯候选' }],
});

const restoredDraft = fleetDraftFromTeamPlan({
  ...persistedPlan,
  file: 'team-持久化测试.yaml',
  source: 'system',
}, [
  testShip(201, '主选持久化'),
  testShip(202, '主选的备选'),
  testShip(203, '纯候选'),
]);
assert.equal(restoredDraft.file, 'team-持久化测试.yaml');
assert.equal(restoredDraft.source, 'system');
assert.equal(restoredDraft.slots[1].primary, null);
assert.equal(restoredDraft.slots[1].candidates[0].ship.name, '纯候选');
assert.deepEqual(restoredDraft.slots[1].shipTypes, ['dd']);
assert.equal(restoredDraft.slots[1].minLevel, 30);
assert.equal(restoredDraft.slots[1].maxLevel, 80);
assert.deepEqual(
  fleetDraftToTeamPlan(restoredDraft, restoredDraft.name),
  persistedPlan,
);

assert.throws(
  () => fleetDraftToTeamPlan(createFleetDraft(), '空舰队'),
  /至少需要一艘/,
);
assert.throws(
  () => fleetDraftToTeamPlan(persistedDraft, '   '),
  /请输入舰队预设名称/,
);

const invalidRuleDraft = () => {
  const draft = createFleetDraft();
  draft.slots[0].primary = testShip(204, '非法规则');
  return draft;
};
const invalidShipTypeDraft = invalidRuleDraft();
invalidShipTypeDraft.slots[0].shipTypes = ['not-a-ship-type'];
assert.throws(
  () => fleetDraftToTeamPlan(invalidShipTypeDraft, '非法舰种'),
  /舰种不符合后端接口/,
);
const invalidMinLevelDraft = invalidRuleDraft();
invalidMinLevelDraft.slots[0].levelEnabled = true;
invalidMinLevelDraft.slots[0].minLevel = 0;
assert.throws(
  () => fleetDraftToTeamPlan(invalidMinLevelDraft, '非法最小等级'),
  /最小等级不合法/,
);
const invalidMaxLevelDraft = invalidRuleDraft();
invalidMaxLevelDraft.slots[0].levelEnabled = true;
invalidMaxLevelDraft.slots[0].maxLevel = 1.5;
assert.throws(
  () => fleetDraftToTeamPlan(invalidMaxLevelDraft, '非法最大等级'),
  /最大等级不合法/,
);
const reversedLevelDraft = invalidRuleDraft();
reversedLevelDraft.slots[0].levelEnabled = true;
reversedLevelDraft.slots[0].minLevel = 80;
reversedLevelDraft.slots[0].maxLevel = 20;
assert.throws(
  () => fleetDraftToTeamPlan(reversedLevelDraft, '反向等级'),
  /最大等级不能小于最小等级/,
);
});

await runScenario('舰队规则解析保留纯候选与舰名别名', () => {
const candidateOnly = resolveFleetPresetRules([{
  candidates: [{ name: '海伦娜' }, { name: '克利夫兰' }],
  ship_type: ['cl'],
  min_level: 10,
  max_level: 80,
}]);
assert.equal(candidateOnly.length, 1);
assert.equal('name' in candidateOnly[0], false);
assert.deepEqual(candidateOnly[0].candidates?.map(rule => rule.name), ['海伦娜', '克利夫兰']);
assert.deepEqual(candidateOnly[0].ship_type, ['cl']);
assert.equal(candidateOnly[0].min_level, 10);
assert.equal(candidateOnly[0].max_level, 80);

const aliasedRules = resolveFleetPresetRules([
  '85工程',
  {
    name: 'Z28',
    candidates: [
      { name: '吕贝克' },
      { name: 'Z46', search_name: '计划内Z46' },
    ],
  },
  { name: '吕贝克', search_name: '计划内吕贝克' },
], {
  契卡洛夫: '85工程',
  自定义Z28: 'Z28',
  自定义吕贝克: '吕贝克',
});
assert.deepEqual(aliasedRules[0], {
  name: '85工程',
  search_name: '契卡洛夫',
});
assert.deepEqual(aliasedRules[1], {
  name: 'Z28',
  search_name: '自定义Z28',
  candidates: [
    { name: '吕贝克', search_name: '自定义吕贝克' },
    { name: 'Z46', search_name: '计划内Z46' },
  ],
});
assert.deepEqual(aliasedRules[2], {
  name: '吕贝克',
  search_name: '计划内吕贝克',
});

const resolved = resolveFleetPreset(['海伦娜', { ship_type: ['cl'] }]);
assert.equal(resolved[0], '海伦娜');
assert.equal(resolved.length, 2);
assert.notEqual(resolved[1], '海伦娜');
});

const existingFleetPresets = [{
  name: '已有编队',
  ships: [
    '海伦娜',
    {
      candidates: [
        { name: '昆西', ship_type: ['cl'] },
        { name: '克利夫兰' },
      ],
      ship_type: ['cl', 'ca'],
      min_level: 10,
    },
  ],
}];

await runScenario('舰队预设身份区分名称顺序与等级条件', () => {
const sameRulesDifferentName = {
  name: '不同名称但内容相同',
  ships: [
    { name: '海伦娜' },
    {
      candidates: [
        { name: '昆西', ship_type: ['cl'] },
        { name: '克利夫兰' },
      ],
      ship_type: ['ca', 'cl'],
      min_level: 10,
    },
  ],
};
assert.equal(
  fleetPresetRuleKey(existingFleetPresets[0]),
  fleetPresetRuleKey(sameRulesDifferentName),
);
assert.notEqual(
  fleetPresetIdentityKey(existingFleetPresets[0]),
  fleetPresetIdentityKey(sameRulesDifferentName),
);
assert.equal(
  fleetPresetIdentityKey(existingFleetPresets[0]),
  fleetPresetIdentityKey({
    ...existingFleetPresets[0],
    name: ' 已有编队 ',
  }),
);
assert.notEqual(
  fleetPresetRuleKey(existingFleetPresets[0]),
  fleetPresetRuleKey({
    name: '候选顺序不同',
    ships: [
      '海伦娜',
      {
        candidates: [
          { name: '克利夫兰' },
          { name: '昆西', ship_type: ['cl'] },
        ],
        ship_type: ['cl', 'ca'],
        min_level: 10,
      },
    ],
  }),
);
assert.notEqual(
  fleetPresetIdentityKey(existingFleetPresets[0]),
  fleetPresetIdentityKey({
    name: '等级条件不同',
    ships: [
      '海伦娜',
      {
        candidates: [
          { name: '昆西', ship_type: ['cl'] },
          { name: '克利夫兰' },
        ],
        ship_type: ['cl', 'ca'],
        min_level: 20,
      },
    ],
  }),
);
});

const manifest = {
  schemaVersion: 1,
  generatedAt: '2026-08-05T00:00:00.000Z',
  labels: {
    ship_types: { cl: '轻巡洋舰' },
    size_classes: {},
    role_classes: {},
    countries: {},
    variants: {},
  },
  typeGroups: {
    size_classes: {},
    role_classes: {},
  },
  ships: [
    {
      id: 1,
      name: '海伦娜',
      search_name: '海伦娜',
      variant: 'normal',
      rarity: 5,
      ship_type: 'cl',
      size_class: 'medium',
      role_class: 'gun',
      country: 'US',
      portraitUrl: 'ship://1/portrait',
      backgroundUrl: 'ship://5/background',
      frameUrl: 'ship://5/frame',
      typeIconUrl: 'ship://cl/icon',
    },
    {
      id: 2,
      name: '无立绘数据',
      search_name: '无立绘数据',
      variant: 'normal',
      rarity: 1,
      ship_type: 'cl',
      size_class: 'medium',
      role_class: 'gun',
      country: 'US',
      portraitUrl: '',
      backgroundUrl: '',
      frameUrl: '',
      typeIconUrl: '',
    },
  ],
};
const catalogPlans = [
  {
    file: '已有编队.yaml',
    modifiedAt: 100,
    source: 'user',
    name: '已有编队',
    ships: [
      { name: '海伦娜' },
      {
        candidates: [
          { name: '昆西', ship_type: ['cl'] },
          { name: '克利夫兰' },
        ],
        ship_type: ['cl', 'ca'],
        min_level: 10,
      },
    ],
  },
  {
    file: '纯候选编队.yaml',
    modifiedAt: 200,
    source: 'system',
    name: '纯候选编队',
    ships: [{
      candidates: [{ name: '海伦娜', min_level: 100 }],
    }],
  },
];

await runScenario('舰队预设目录加载隔离副本并报告损坏计划', async () => {
const presetController = new PlanFleetPresetController({
  async getShipLibraryManifest() {
    return manifest;
  },
  async listTeamPlans() {
    return {
      plans: catalogPlans,
      errors: [{
        file: '损坏编队.yaml',
        source: 'user',
        kind: 'team',
        message: 'YAML 无法解析',
      }],
    };
  },
});
assert.equal(
  presetController.toViewObject(existingFleetPresets).status,
  'loading',
);
await presetController.load();
const presetCatalog = presetController.toViewObject(existingFleetPresets);
assert.equal(presetCatalog.status, 'ready');
assert.equal(presetCatalog.errorCount, 1);
assert.equal(presetCatalog.plans.length, 2);
assert.equal(presetCatalog.plans[0].selected, true);
assert.equal(presetCatalog.bindings[0].source, 'user');
assert.equal(
  presetCatalog.bindings[0].catalogPlanId,
  presetCatalog.plans[0].id,
);
assert.equal(presetCatalog.plans[1].ships[0].primary, undefined);
assert.deepEqual(
  presetCatalog.plans[1].ships[0].candidates.map(rule => rule.name),
  ['海伦娜'],
);
assert.equal(presetCatalog.shipLibrary.ships.length, 1);
assert.equal(presetCatalog.shipLibrary.ships[0].name, '海伦娜');
assert.equal(
  presetController.appendPreset(
    existingFleetPresets,
    presetCatalog.plans[0].id,
  ),
  null,
);

const firstAppend = presetController.appendPreset(
  [],
  presetCatalog.plans[1].id,
);
const secondAppend = presetController.appendPreset(
  [],
  presetCatalog.plans[1].id,
);
assert.ok(firstAppend);
assert.ok(secondAppend);
firstAppend[0].ships[0].candidates[0].name = '修改副本';
assert.equal(
  secondAppend[0].ships[0].candidates[0].name,
  '海伦娜',
);
assert.deepEqual(
  presetController.removePreset(
    [existingFleetPresets[0], secondAppend[0]],
    0,
  ),
  secondAppend,
);
assert.equal(presetController.removePreset(secondAppend, -1), null);
assert.equal(presetController.removePreset(secondAppend, 1), null);

const failedPresetController = new PlanFleetPresetController({
  async getShipLibraryManifest() {
    return manifest;
  },
  async listTeamPlans() {
    throw new Error('目录读取失败');
  },
});
await failedPresetController.load();
const failedCatalog = failedPresetController.toViewObject([]);
assert.equal(failedCatalog.status, 'error');
assert.equal(failedCatalog.message, '目录读取失败');
});

await runScenario('当前舰队解析复用资料库缓存并容忍加载失败', async () => {
let currentFleetManifestLoads = 0;
const currentFleetController = new CurrentFleetController({
  async getShipLibraryManifest() {
    currentFleetManifestLoads += 1;
    return manifest;
  },
});
const currentFleetRequest = {
  type: 'normal_fight',
  plan: {
    fleet_rules: [
      { name: '海伦娜·改' },
      { candidates: [{ name: '海伦娜' }] },
    ],
    fleet: ['', '', '未知舰船'],
  },
};
const unloadedFleet = currentFleetController.resolve(currentFleetRequest);
assert.equal(unloadedFleet[0].name, '海伦娜·改');
assert.equal(unloadedFleet[0].ship, undefined);
await currentFleetController.load();
const loadedFleet = currentFleetController.resolve(currentFleetRequest);
assert.equal(loadedFleet.length, 3);
assert.equal(loadedFleet[0].ship.id, 1);
assert.equal(loadedFleet[0].shipTypeLabel, '轻巡洋舰');
assert.equal(loadedFleet[1].ship.id, 1);
assert.equal(loadedFleet[2].name, '未知舰船');
assert.equal(loadedFleet[2].ship, undefined);
assert.deepEqual(
  currentFleetController.resolve({ type: 'exercise' }),
  [],
);
await currentFleetController.load();
assert.equal(currentFleetManifestLoads, 1);
await currentFleetController.load(true);
assert.equal(currentFleetManifestLoads, 2);

const failedCurrentFleetController = new CurrentFleetController({
  async getShipLibraryManifest() {
    throw new Error('资料库读取失败');
  },
});
await failedCurrentFleetController.load();
assert.equal(
  failedCurrentFleetController.resolve(currentFleetRequest)[0].ship,
  undefined,
);
});

await runScenario('方案管理标记引用关系并执行用户操作', async () => {
const managementResult = {
  bindings: [
    {
      planFile: 'bettle-system.yaml',
      planName: '系统计划',
      source: 'system',
      teamName: '共享舰队',
    },
    {
      planFile: 'bettle-missing.yaml',
      planName: '缺失舰队计划',
      source: 'user',
      teamName: '不存在舰队',
    },
    {
      planFile: 'bettle-empty.yaml',
      planName: '无需舰队计划',
      source: 'user',
      teamName: null,
    },
  ],
  battlePlans: [],
  teamPlans: [
    {
      file: 'team-shared-system.yaml',
      name: '共享舰队',
      source: 'system',
    },
    {
      file: 'team-shared-user.yaml',
      name: '共享舰队',
      source: 'user',
    },
    {
      file: 'team-orphan.yaml',
      name: '孤立舰队',
      source: 'user',
    },
  ],
  errors: [{
    file: 'bettle-broken.yaml',
    source: 'user',
    kind: 'battle',
    message: 'YAML 无法解析',
  }],
  ignoredUnlinkedPlans: [
    'battle/user/bettle-empty.yaml',
    'team/user/team-orphan.yaml',
  ],
};
const managementTaskGroups = [
  {
    name: '旧路径任务组',
    items: [{
      kind: 'plan',
      path: 'C:\\old\\system_battle_plans\\bettle-system.yaml',
    }],
  },
  {
    name: '受管任务组',
    items: [{
      kind: 'plan',
      managedSource: 'user',
      managedFile: 'bettle-missing.yaml',
    }],
  },
];
const managementViewObject = buildPlanManagementViewObject(
  managementResult,
  managementTaskGroups,
);
const managementRow = (kind, source, file) => (
  managementViewObject.rows.find(row => (
    row.kind === kind
    && row.source === source
    && row.file === file
  ))
);
assert.deepEqual(
  managementRow('battle', 'system', 'bettle-system.yaml').taskGroups,
  ['旧路径任务组'],
);
assert.deepEqual(
  managementRow('battle', 'user', 'bettle-missing.yaml').taskGroups,
  ['受管任务组'],
);
assert.deepEqual(
  managementRow(
    'battle',
    'user',
    'bettle-missing.yaml',
  ).missingRelations,
  ['不存在舰队'],
);
assert.equal(
  managementRow('battle', 'user', 'bettle-missing.yaml').attention,
  true,
);
assert.equal(
  managementRow('battle', 'user', 'bettle-empty.yaml').attention,
  false,
);
assert.equal(
  managementRow('team', 'user', 'team-orphan.yaml').attention,
  false,
);
assert.match(
  managementRow(
    'team',
    'user',
    'team-shared-user.yaml',
  ).deleteWarning,
  /仍会匹配另一份同名舰队方案/,
);
assert.equal(
  managementRow('battle', 'user', 'bettle-broken.yaml').invalid,
  true,
);
assert.equal(managementViewObject.errors.length, 1);

const managementRenders = [];
const managementViewErrors = [];
let managementLoadingCount = 0;
const managementView = {
  showLoading() {
    managementLoadingCount += 1;
  },
  showError(message) {
    managementViewErrors.push(message);
  },
  render(viewObject) {
    managementRenders.push(viewObject);
  },
};
const managementCalls = {
  exports: [],
  ignored: [],
  renames: [],
  battleDeletes: [],
  teamDeletes: [],
};
let managementLoads = 0;
const managementRepository = {
  async getPlanManagement() {
    managementLoads += 1;
    return managementResult;
  },
  async exportUserPlans(selections) {
    managementCalls.exports.push(selections);
    return { success: true, count: selections.length };
  },
  async setPlanUnlinkedIgnored(kind, source, file, ignored) {
    managementCalls.ignored.push({ kind, source, file, ignored });
    return ignored
      ? [`${kind}/${source}/${file}`]
      : [];
  },
  async renameUserCombatPlan(file, name) {
    managementCalls.renames.push({ file, name });
    return { success: true };
  },
  async deleteUserCombatPlan(file) {
    managementCalls.battleDeletes.push(file);
    return { success: true };
  },
  async deleteUserTeamPlan(file) {
    managementCalls.teamDeletes.push(file);
    return file === 'batch-fail.yaml'
      ? { success: false, error: '删除被拒绝' }
      : { success: true };
  },
};
const dialogCalls = {
  alerts: [],
  confirms: [],
  prompts: [],
  successes: [],
};
const managementDialogs = {
  async alert(title, message = '') {
    dialogCalls.alerts.push({ title, message });
  },
  async confirm(title, message = '') {
    dialogCalls.confirms.push({ title, message });
    return true;
  },
  async prompt(title, message = '', defaultValue = '') {
    dialogCalls.prompts.push({ title, message, defaultValue });
    return '重命名后';
  },
  success(message = '') {
    dialogCalls.successes.push(message);
  },
};
const managementController = new PlanManagementController(
  managementRepository,
  managementView,
  managementDialogs,
);
managementController.setTaskGroupsProvider(() => managementTaskGroups);
await managementController.load();
assert.equal(managementLoadingCount, 1);
assert.equal(managementRenders.length, 1);
assert.deepEqual(managementViewErrors, []);
assert.deepEqual(
  managementRenders[0].rows.find(row => (
    row.file === 'bettle-system.yaml'
  )).taskGroups,
  ['旧路径任务组'],
);

let openedManagementPlan = '';
managementController.onOpenBattlePlan = async (file, source) => {
  openedManagementPlan = `${source}:${file}`;
};
await managementView.onOpenBattlePlan('bettle-system.yaml', 'system');
assert.equal(openedManagementPlan, 'system:bettle-system.yaml');

await managementView.onExportPlans([
  { kind: 'battle', file: 'bettle-empty.yaml' },
]);
assert.equal(managementCalls.exports.length, 1);
assert.equal(
  dialogCalls.successes.at(-1),
  '已导出 1 个用户配置',
);

await managementView.onToggleUnlinked(
  'battle',
  'user',
  'bettle-empty.yaml',
  false,
);
assert.deepEqual(managementCalls.ignored.at(-1), {
  kind: 'battle',
  source: 'user',
  file: 'bettle-empty.yaml',
  ignored: false,
});
assert.equal(
  managementRenders.at(-1).rows.find(row => (
    row.file === 'bettle-empty.yaml'
  )).attention,
  true,
);

await managementView.onRenameCombatPlan('bettle-empty.yaml');
assert.deepEqual(managementCalls.renames.at(-1), {
  file: 'bettle-empty.yaml',
  name: '重命名后',
});

await managementView.onDeletePlans([
  { kind: 'battle', file: 'batch-ok.yaml' },
  { kind: 'team', file: 'batch-fail.yaml' },
]);
assert.equal(managementCalls.battleDeletes.at(-1), 'batch-ok.yaml');
assert.equal(managementCalls.teamDeletes.at(-1), 'batch-fail.yaml');
assert.equal(dialogCalls.alerts.at(-1).title, '批量删除未全部完成');
assert.match(dialogCalls.alerts.at(-1).message, /成功删除 1 个，失败 1 个/);

const sharedTeamRow = managementRenders.at(-1).rows.find(row => (
  row.file === 'team-shared-user.yaml'
));
await managementView.onDeleteTeamPlan(
  sharedTeamRow.file,
  sharedTeamRow.name,
  sharedTeamRow.deleteWarning,
);
assert.equal(
  managementCalls.teamDeletes.at(-1),
  'team-shared-user.yaml',
);
assert.match(
  dialogCalls.confirms.at(-1).message,
  /仍会匹配另一份同名舰队方案/,
);
assert.equal(managementLoads >= 4, true);
});

await runScenario('决战舰队草稿维护队列顺序与脏状态', () => {
const decisive = new DecisiveFleetDraft({
  chapter: 6,
  useQuickRepair: true,
  level1: ['U-47', 'U-81'],
  level2: ['U-96'],
});
assert.equal(decisive.dirty, false);
assert.equal(decisive.place('U-1206', 'level1', 1, 5), 1);
assert.deepEqual(decisive.queue('level1'), ['U-47', 'U-1206']);
assert.equal(decisive.dirty, true);
assert.equal(decisive.move('level1', 0, 'level2', 1), 1);
assert.deepEqual(decisive.queue('level1'), ['U-1206']);
assert.deepEqual(decisive.queue('level2'), ['U-96', 'U-47']);
assert.equal(decisive.remove('level2', 0), true);
assert.deepEqual(decisive.queue('level2'), ['U-47']);
decisive.load(decisive.toSettings());
assert.equal(decisive.dirty, false);
});

console.log(`fleet domain tests passed: ${passedScenarioCount} scenarios`);
