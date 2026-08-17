const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const manifestBuilder = require(
  path.join(root, 'build', 'generate-install-manifest.cjs'),
);
const cleanupScript = path.join(
  root,
  'build',
  'remove-managed-install-files.ps1',
);

function writeFile(rootDirectory, relativePath, content = relativePath) {
  const filePath = path.join(rootDirectory, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return filePath;
}

function writeManifest(filePath, files, version) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify({
    schemaVersion: 1,
    version,
    files,
  }, null, 2)}\n`);
}

function runCleanup(
  installDirectory,
  currentManifestPath,
  nextManifestPath,
) {
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      cleanupScript,
      '-InstallDirectory',
      installDirectory,
      '-CurrentManifestPath',
      currentManifestPath,
      '-NextManifestPath',
      nextManifestPath,
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `cleanup failed (${result.status}): ${result.stderr.trim()}`,
    );
  }
  return result.stdout;
}

function testManifestBuilder(temporaryRoot) {
  const appOutDir = path.join(temporaryRoot, 'win-unpacked');
  for (const file of [
    'AutoWSGR-GUI.exe',
    'resources/app.asar',
    'python/python.exe',
    'adb/adb.exe',
  ]) {
    writeFile(appOutDir, file);
  }
  for (const persistentFile of [
    '.env_ready',
    'logs/runtime.log',
    'python/site-packages/autowsgr.pyd',
    'resources/.autowsgr-next-install-manifest.json',
  ]) {
    writeFile(appOutDir, persistentFile);
  }

  const manifest = manifestBuilder.createInstallManifest(
    appOutDir,
    '2.1.0-alpha.3',
  );
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.version, '2.1.0-alpha.3');
  assert.deepEqual(manifest.files, [
    'AutoWSGR-GUI.exe',
    'adb/adb.exe',
    'python/python.exe',
    'resources/.autowsgr-install-manifest.json',
    'resources/app.asar',
  ]);
}

function testManagedCleanup(temporaryRoot) {
  const installDirectory = path.join(temporaryRoot, 'installed');
  const currentManifestPath = writeFile(
    installDirectory,
    'resources/.autowsgr-install-manifest.json',
  );
  const nextManifestPath = writeFile(
    installDirectory,
    'resources/.autowsgr-next-install-manifest.json',
  );
  for (const file of [
    'AutoWSGR-GUI.exe',
    'resources/app.asar',
    'resources/obsolete/removed.dat',
    'resources/obsolete/旧资源.dat',
  ]) {
    writeFile(installDirectory, file);
  }
  for (const userFile of [
    'logs/runtime.log',
    'notes/user-file.txt',
    'resources/obsolete/user-file.txt',
    'resources/obsolete/用户文件.txt',
  ]) {
    writeFile(installDirectory, userFile);
  }

  const currentFiles = [
    'AutoWSGR-GUI.exe',
    'resources/.autowsgr-install-manifest.json',
    'resources/app.asar',
    'resources/obsolete/removed.dat',
    'resources/obsolete/旧资源.dat',
  ];
  const nextFiles = [
    'AutoWSGR-GUI.exe',
    'resources/.autowsgr-install-manifest.json',
    'resources/app.asar',
    'resources/new-file.dat',
  ];
  writeManifest(currentManifestPath, currentFiles, '2.1.0-alpha.3');
  writeManifest(nextManifestPath, nextFiles, '2.1.0-alpha.4');

  runCleanup(installDirectory, currentManifestPath, nextManifestPath);

  assert.equal(
    fs.existsSync(path.join(
      installDirectory,
      'resources',
      'obsolete',
      'removed.dat',
    )),
    false,
    '新版本已删除的受管文件必须清理',
  );
  assert.equal(
    fs.existsSync(path.join(
      installDirectory,
      'resources',
      'obsolete',
      '旧资源.dat',
    )),
    false,
    '中文路径的旧版受管文件必须清理',
  );
  for (const preservedFile of [
    'AutoWSGR-GUI.exe',
    'resources/app.asar',
    'logs/runtime.log',
    'notes/user-file.txt',
    'resources/obsolete/user-file.txt',
    'resources/obsolete/用户文件.txt',
  ]) {
    assert.equal(
      fs.existsSync(path.join(
        installDirectory,
        ...preservedFile.split('/'),
      )),
      true,
      `升级清理不得删除保留文件: ${preservedFile}`,
    );
  }
}

function testUnsafeManifestFailsBeforeDeletion(temporaryRoot) {
  const installDirectory = path.join(temporaryRoot, 'unsafe-installed');
  const removableFile = writeFile(
    installDirectory,
    'resources/old-file.dat',
  );
  const outsideFile = writeFile(temporaryRoot, 'outside-user-file.txt');
  const currentManifestPath = writeFile(
    installDirectory,
    'resources/.autowsgr-install-manifest.json',
  );
  const nextManifestPath = writeFile(
    installDirectory,
    'resources/.autowsgr-next-install-manifest.json',
  );
  writeManifest(
    currentManifestPath,
    ['resources/old-file.dat', '../outside-user-file.txt'],
    '2.1.0-alpha.3',
  );
  writeManifest(nextManifestPath, [], '2.1.0-alpha.4');

  assert.throws(
    () => runCleanup(
      installDirectory,
      currentManifestPath,
      nextManifestPath,
    ),
    /cleanup failed/,
  );
  assert.equal(fs.existsSync(removableFile), true);
  assert.equal(fs.existsSync(outsideFile), true);
}

function testInstallerContract() {
  const installer = fs.readFileSync(
    path.join(root, 'build', 'installer.nsh'),
    'utf8',
  );
  assert.match(
    installer,
    /File \/oname=\$PLUGINSDIR\\autowsgr-next-install-manifest\.json/,
  );
  assert.match(
    installer,
    /\$\{ElseIf\} \$\{FileExists\} "\$INSTDIR\\\$\{UNINSTALL_FILENAME\}"[\s\S]*StrCpy \$R4 "1"/,
    '手动覆盖安装也必须进入清单升级路径',
  );
  assert.match(installer, /!macro customRemoveFiles/);
  assert.match(
    installer,
    /remove-managed-install-files\.ps1[\s\S]*-CurrentManifestPath[\s\S]*-NextManifestPath/,
  );
  assert.match(
    installer,
    /\$\{Else\}\s+RMDir \/r "\$INSTDIR"\s+\$\{EndIf\}/,
    '只有主动卸载可以完整删除安装目录',
  );
}

const temporaryRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), 'autowsgr-install-update-'),
);
try {
  testManifestBuilder(temporaryRoot);
  testManagedCleanup(temporaryRoot);
  testUnsafeManifestFailsBeforeDeletion(temporaryRoot);
  testInstallerContract();
  console.log('incremental install compatibility test passed');
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
