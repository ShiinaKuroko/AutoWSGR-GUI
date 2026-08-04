const assert = require('node:assert/strict');
const { PlanModel } = require('../dist/src/model/PlanModel.js');
const { TaskQueue } = require('../dist/src/model/scheduler/TaskQueue.js');

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
console.log('GUI/AutoWSGR API contract tests passed');
