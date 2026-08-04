const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const root = path.resolve(__dirname, '..');
const planFiles = [
  'bettle-E1炸鱼.yaml',
  'bettle-E5夜战.yaml',
  'bettle-H1炸鱼.yaml',
  'bettle-H5夜战.yaml',
];
const expected = new Map([
  ['bettle-E1炸鱼.yaml', {
    event: '20260730',
    chapter: 'E',
    map: '1a',
    selected_nodes: ['B'],
    node_defaults: { proceed: false, formation: 5 },
  }],
  ['bettle-E5夜战.yaml', {
    event: '20260730',
    chapter: 'E',
    map: '5a',
    selected_nodes: ['A', 'B', 'C', 'D', 'F'],
    node_defaults: { night: true, proceed: true, formation: 4 },
    node_args: {
      C: { proceed: false },
      D: { proceed: false },
      F: { proceed: false },
    },
  }],
  ['bettle-H1炸鱼.yaml', {
    event: '20260730',
    chapter: 'H',
    map: '1a',
    selected_nodes: ['B'],
    node_defaults: { proceed: false, formation: 5 },
  }],
  ['bettle-H5夜战.yaml', {
    event: '20260730',
    chapter: 'H',
    map: '5a',
    selected_nodes: ['A', 'B', 'C', 'D', 'F'],
    node_defaults: { night: true, proceed: true, formation: 4 },
    node_args: {
      C: { proceed: false },
      D: { proceed: false },
      F: { proceed: false },
    },
  }],
]);

for (const file of planFiles) {
  const filePath = path.join(root, 'resource', 'system_battle_plans', file);
  assert.equal(fs.existsSync(filePath), true, `missing activity plan: ${file}`);
  const plan = yaml.load(fs.readFileSync(filePath, 'utf8'));
  assert.deepEqual(plan, expected.get(file));
}

const templates = JSON.parse(fs.readFileSync(
  path.join(root, 'resource', 'builtin_templates.json'),
  'utf8',
));
const template = templates.find(item => item.id === 'builtin_event_20260730');
assert.ok(template);
assert.equal(template.forceRetry, true);
assert.deepEqual(template.planPaths, planFiles.map(file => (
  `resource/system_battle_plans/${file}`
)));
console.log('20260730 activity resources test passed');
