const assert = require('node:assert/strict');
const { PlanModel } = require('../dist/src/model/PlanModel.js');
const { TaskQueue } = require('../dist/src/model/scheduler/TaskQueue.js');
const { ALL_SHIPS } = require('../dist/src/model/fleet/ShipCatalog.js');
const {
  FLEET_SHIP_TYPE_CODES,
  NATIVE_FLEET_SHIP_TYPE_CODES,
  NATIVE_FLEET_SHIP_TYPE_LABELS,
  normalizeFleetShipTypeCode,
  SHIP_TYPE_FILTER_ORDER,
  TYPE_LABELS,
} = require('../dist/src/shared/fleetShipTypes.js');

const plan = PlanModel.fromYaml([
  'chapter: 1',
  'map: 1',
  'fleet_presets:',
  '  - name: 候选契约',
  '    ships:',
  '      - candidates:',
  '          - name: 胡德',
  '            ship_type: [bc]',
  '            min_level: 20',
  '          - name: 扶桑',
  '            ship_type: [bb]',
  '            max_level: 90',
  '      - name: 重庆',
  '        ship_type: [kp, cg, bg, bbg, asdg, aadg, ap]',
  '        candidates:',
  '          - name: 长春',
  '      - ship_type: [ss]',
  '        min_level: 100',
  '',
].join('\n'), 'candidate-only.yaml');

const request = {
  type: 'normal_fight',
  times: 2,
  plan: {
    chapter: plan.data.chapter,
    map: plan.data.map,
    fleet_id: 1,
    node_defaults: {
      formation: 4,
      night: true,
      long_missile_support: true,
      proceed_stop: [1, 2],
    },
  },
};

const task = {
  request,
  fleetId: 1,
  fleetPresets: plan.data.fleet_presets,
  currentPresetIndex: -1,
};
new TaskQueue().switchTaskPreset(task, 0);

const [candidateOnly, strictPrimary, anonymousFilter] =
  request.plan.fleet_rules;
assert.equal(
  Object.prototype.hasOwnProperty.call(candidateOnly, 'name'),
  false,
);
assert.deepEqual(candidateOnly.candidates, [
  { name: '胡德', ship_type: ['bc'], min_level: 20 },
  { name: '扶桑', ship_type: ['bb'], max_level: 90 },
]);
assert.equal(strictPrimary.name, '重庆');
assert.deepEqual(
  strictPrimary.ship_type,
  ['kp', 'cg', 'bg', 'bbg', 'asdg', 'aadg', 'ap'],
);
assert.deepEqual(strictPrimary.candidates, [{ name: '长春' }]);
assert.equal(typeof anonymousFilter.name, 'string');
assert.ok(anonymousFilter.name.length > 0);
assert.equal(anonymousFilter.search_name, anonymousFilter.name);
assert.deepEqual(anonymousFilter.ship_type, ['ss']);
assert.equal(anonymousFilter.min_level, 100);
assert.equal(
  Object.prototype.hasOwnProperty.call(request, 'fleet_id'),
  false,
);
assert.equal(request.plan.node_defaults.long_missile_support, true);
assert.deepEqual(request.plan.node_defaults.proceed_stop, [1, 2]);
assert.equal(TYPE_LABELS.kp, '导巡');
assert.equal(TYPE_LABELS.cg, '防巡');
assert.deepEqual(
  new Set(NATIVE_FLEET_SHIP_TYPE_CODES),
  new Set(Object.keys(NATIVE_FLEET_SHIP_TYPE_LABELS)),
);
assert.deepEqual(
  new Set(SHIP_TYPE_FILTER_ORDER),
  new Set(NATIVE_FLEET_SHIP_TYPE_CODES),
);
assert.deepEqual(
  new Set(FLEET_SHIP_TYPE_CODES),
  new Set([...NATIVE_FLEET_SHIP_TYPE_CODES, 'ss_or_ssg']),
);
const nativeShipTypes = new Set(NATIVE_FLEET_SHIP_TYPE_CODES);
assert.ok(ALL_SHIPS.length >= 875);
for (const ship of ALL_SHIPS) {
  assert.equal(
    nativeShipTypes.has(ship.ship_type),
    true,
    `${ship.name} 使用了非 canonical 舰种 ${ship.ship_type}`,
  );
}
for (const shipType of ['cg', 'bg', 'asdg', 'kp']) {
  assert.equal(normalizeFleetShipTypeCode(shipType), shipType);
}
for (const shipType of ['cgaa', 'cbg', 'ddg', 'ddgaa', 'cf']) {
  assert.equal(normalizeFleetShipTypeCode(shipType), null);
}
console.log('GUI/AutoWSGR API contract tests passed');
