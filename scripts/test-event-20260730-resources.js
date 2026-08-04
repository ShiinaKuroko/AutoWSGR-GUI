const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const root = path.resolve(__dirname, '..');
const planFiles = ['E1炸鱼.yaml', 'E5夜战.yaml', 'H1炸鱼.yaml', 'H5夜战.yaml'];
const expected = new Map([
  ['E1炸鱼.yaml', ['E', '1a']],
  ['E5夜战.yaml', ['E', '5a']],
  ['H1炸鱼.yaml', ['H', '1a']],
  ['H5夜战.yaml', ['H', '5a']],
]);

for (const file of planFiles) {
  const filePath = path.join(root, 'resource', 'system_battle_plans', file);
  assert.equal(fs.existsSync(filePath), true, `missing activity plan: ${file}`);
  const plan = yaml.load(fs.readFileSync(filePath, 'utf8'));
  assert.equal(plan.event, '20260730');
  assert.deepEqual([plan.chapter, plan.map], expected.get(file));
}

const templates = JSON.parse(fs.readFileSync(
  path.join(root, 'resource', 'builtin_templates.json'),
  'utf8',
));
const template = templates.find(item => item.id === 'builtin_event_20260730');
assert.ok(template);
assert.deepEqual(template.planPaths, planFiles.map(file => (
  `resource/system_battle_plans/${file}`
)));
console.log('20260730 activity resources test passed');
