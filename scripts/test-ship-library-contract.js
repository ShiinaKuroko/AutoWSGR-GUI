const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const {
  buildResourceEnvironment,
  SHIP_LIBRARY_ENV,
  shipLibraryRoot,
} = require(path.join(projectRoot, 'dist', 'electron', 'resourcePaths.js'));

const developmentRoot = path.join(projectRoot, 'dist', 'electron', '..', '..');
const packagedRoot = path.join(projectRoot, 'release-fixture', 'resources');
assert.equal(shipLibraryRoot(developmentRoot), path.join(projectRoot, 'resource', 'ship-library'));
assert.equal(shipLibraryRoot(packagedRoot), path.join(packagedRoot, 'resource', 'ship-library'));

const baseEnv = { PATH: 'fixture-path', KEEP_ME: 'yes' };
const childEnv = buildResourceEnvironment(baseEnv, packagedRoot);
assert.notEqual(childEnv, baseEnv);
assert.equal(baseEnv[SHIP_LIBRARY_ENV], undefined);
assert.equal(childEnv.KEEP_ME, 'yes');
assert.equal(childEnv[SHIP_LIBRARY_ENV], path.join(packagedRoot, 'resource', 'ship-library'));

const libraryRoot = shipLibraryRoot(projectRoot);
const manifestPath = path.join(libraryRoot, 'manifest.json');
assert.ok(fs.existsSync(manifestPath), 'canonical ship manifest is missing');

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
assert.equal(manifest.ships.length, 894);
assert.equal(manifest.counts.ships, 894);
assert.equal(manifest.counts.missing_assets, 0);

for (const ship of manifest.ships) {
  for (const assetPath of [ship.portrait, ship.background, ship.frame, ship.type_icon]) {
    assert.equal(typeof assetPath, 'string', `ship ${ship.id} has an invalid asset path`);
    assert.ok(fs.existsSync(path.join(libraryRoot, assetPath)), `missing ship asset: ${assetPath}`);
  }
}

const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const resourceEntry = packageJson.build.extraResources.find(entry => entry.from === 'resource');
assert.ok(resourceEntry, 'electron-builder must include the resource directory');
assert.equal(resourceEntry.to, 'resource');
assert.deepEqual(resourceEntry.filter, ['**/*']);

console.log(`ship library contract verified: ${manifest.ships.length} ships at ${libraryRoot}`);
