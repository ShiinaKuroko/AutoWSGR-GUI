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
  resolveFleetPresetRules,
  resolveFleetPreset,
  toBackendName,
} = module.exports;

assert.equal(toBackendName('岛风(岛风型驱逐舰)·改'), '岛风');

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
