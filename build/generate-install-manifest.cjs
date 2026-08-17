const fs = require('node:fs');
const path = require('node:path');

const manifestRelativePath = 'resources/.autowsgr-install-manifest.json';
const generatedManifestPath = path.join(
  __dirname,
  'generated',
  'install-manifest.json',
);
const installerGeneratedPaths = [
  'resources/elevate.exe',
];
const persistentPaths = [
  '.env_ready',
  'log',
  'logs',
  'python/site-packages',
  'resources/.autowsgr-previous-install-manifest.json',
];

function normalizeRelativePath(appOutDir, filePath) {
  return path.relative(appOutDir, filePath).replaceAll('\\', '/');
}

function isPersistentPath(relativePath) {
  const normalized = relativePath.toLowerCase();
  return persistentPaths.some(candidate => (
    normalized === candidate
    || normalized.startsWith(`${candidate}/`)
  ));
}

function collectPackagedFiles(appOutDir, directory = appOutDir) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectPackagedFiles(appOutDir, target));
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`安装产物包含不支持的文件类型: ${target}`);
    }
    const relativePath = normalizeRelativePath(appOutDir, target);
    if (
      relativePath !== manifestRelativePath
      && !isPersistentPath(relativePath)
    ) {
      files.push(relativePath);
    }
  }
  return files;
}

function comparePaths(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function createInstallManifest(appOutDir, version) {
  const files = [
    ...new Set([
      ...collectPackagedFiles(appOutDir),
      ...installerGeneratedPaths,
    ]),
  ];
  files.sort(comparePaths);
  return {
    schemaVersion: 1,
    version,
    files,
  };
}

function writeInstallManifest(appOutDir, version) {
  const manifest = createInstallManifest(appOutDir, version);
  const content = `${JSON.stringify(manifest, null, 2)}\n`;
  const packagedManifestPath = path.join(
    appOutDir,
    ...manifestRelativePath.split('/'),
  );
  fs.mkdirSync(path.dirname(packagedManifestPath), { recursive: true });
  fs.writeFileSync(packagedManifestPath, content, 'utf8');
  fs.mkdirSync(path.dirname(generatedManifestPath), { recursive: true });
  fs.writeFileSync(generatedManifestPath, content, 'utf8');
  return manifest;
}

async function generateInstallManifest(context) {
  if (context.electronPlatformName !== 'win32') return;
  writeInstallManifest(
    context.appOutDir,
    context.packager.appInfo.version,
  );
}

module.exports = generateInstallManifest;
module.exports.createInstallManifest = createInstallManifest;
module.exports.manifestRelativePath = manifestRelativePath;
module.exports.persistentPaths = persistentPaths;
module.exports.writeInstallManifest = writeInstallManifest;
