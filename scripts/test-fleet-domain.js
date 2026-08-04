import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import esbuild from 'esbuild';

const require = createRequire(import.meta.url);
const result = esbuild.buildSync({
  entryPoints: ['src/model/fleet/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  loader: { '.json': 'json' },
});
const module = { exports: {} };
new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, module, module.exports);
const {
  DecisiveFleetDraft,
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
  removeFleetPrimary,
  resolveFleetSlotPosition,
  resolveGalleryFormationAssignment,
  resolveGalleryFormationDropTarget,
  resolveFleetPresetRules,
  resolveFleetPreset,
  toBackendName,
} = module.exports;

assert.equal(toBackendName('岛风(岛风型驱逐舰)·改'), '岛风');

const testShip = (id, name) => ({
  id,
  name,
  search_name: name,
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

const resolved = resolveFleetPreset(['海伦娜', { ship_type: ['cl'] }]);
assert.equal(resolved[0], '海伦娜');
assert.equal(resolved.length, 2);
assert.notEqual(resolved[1], '海伦娜');

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

console.log('fleet domain tests passed');
