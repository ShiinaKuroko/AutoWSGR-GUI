const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..', '..');
const {
  resolveGuiUpdateChannelPolicy,
} = require(path.join(root, 'dist', 'electron', 'guiUpdateChannel.js'));

assert.deepEqual(resolveGuiUpdateChannelPolicy(false), {
  channel: 'latest',
  allowPrerelease: false,
  repository: {
    owner: 'yltx',
    repo: 'AutoWSGR-GUI',
  },
});
assert.deepEqual(resolveGuiUpdateChannelPolicy(true), {
  channel: 'alpha',
  allowPrerelease: true,
  repository: {
    owner: 'ShiinaKuroko',
    repo: 'AutoWSGR-GUI',
  },
});

const mainSource = fs.readFileSync(
  path.join(root, 'electron', 'main.ts'),
  'utf8',
);
assert.match(mainSource, /allow_test_updates/);
assert.match(mainSource, /autoUpdater\.allowDowngrade = false/);
assert.match(
  mainSource,
  /applyGuiUpdateChannelPolicy\(\);\s*const result = await autoUpdater\.checkForUpdates\(\)/,
);

const html = fs.readFileSync(
  path.join(root, 'src', 'view', 'index.html'),
  'utf8',
);
assert.equal(
  (html.match(/id="cfg-allow-test-updates"/g) || []).length,
  1,
);

console.log('preview update toggle contract passed');
