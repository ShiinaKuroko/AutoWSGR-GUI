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
  previousManifestPath,
  currentManifestPath,
  options = {},
) {
  const args = [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    cleanupScript,
    '-InstallDirectory',
    installDirectory,
    '-PreviousManifestPath',
    previousManifestPath,
    '-CurrentManifestPath',
    currentManifestPath,
  ];
  if (options.mode) args.push('-Mode', options.mode);
  if (options.shapeBackupDirectory) {
    args.push(
      '-ShapeBackupDirectory',
      options.shapeBackupDirectory,
    );
  }
  const result = spawnSync(
    'powershell.exe',
    args,
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
    'log/debug.log',
    'logs/runtime.log',
    'python/site-packages/autowsgr.pyd',
    'resources/.autowsgr-previous-install-manifest.json',
  ]) {
    writeFile(appOutDir, persistentFile);
  }

  const manifest = manifestBuilder.createInstallManifest(
    appOutDir,
    '2.1.0-alpha.3',
  );
  assert.deepEqual(manifest, {
    schemaVersion: 1,
    version: '2.1.0-alpha.3',
    files: [
      'AutoWSGR-GUI.exe',
      'adb/adb.exe',
      'python/python.exe',
      'resources/app.asar',
      'resources/elevate.exe',
    ],
  });
}

function testManagedCleanup(temporaryRoot) {
  const installDirectory = path.join(temporaryRoot, 'installed');
  const previousManifestPath = path.join(
    installDirectory,
    'resources/.autowsgr-previous-install-manifest.json',
  );
  const currentManifestPath = path.join(
    installDirectory,
    'resources/.autowsgr-install-manifest.json',
  );
  for (const file of [
    'AutoWSGR-GUI.exe',
    'resources/app.asar',
    'resources/new-file.dat',
    'resources/obsolete/removed.dat',
    'resources/obsolete/旧资源.dat',
    'logs/runtime.log',
    'notes/user-file.txt',
    'resources/obsolete/user-file.txt',
    'resources/obsolete/用户文件.txt',
  ]) {
    writeFile(installDirectory, file);
  }

  writeManifest(previousManifestPath, [
    'AutoWSGR-GUI.exe',
    'resources/app.asar',
    'resources/obsolete/removed.dat',
    'resources/obsolete/旧资源.dat',
  ], '2.1.0-alpha.3');
  writeManifest(currentManifestPath, [
    'AutoWSGR-GUI.exe',
    'resources/app.asar',
    'resources/new-file.dat',
  ], '2.1.0-alpha.4');

  const output = runCleanup(
    installDirectory,
    previousManifestPath,
    currentManifestPath,
  );
  assert.match(output, /removed=2, missing=0/);

  for (const removedFile of [
    'resources/obsolete/removed.dat',
    'resources/obsolete/旧资源.dat',
  ]) {
    assert.equal(
      fs.existsSync(path.join(
        installDirectory,
        ...removedFile.split('/'),
      )),
      false,
      `新版本下架的受管文件必须清理: ${removedFile}`,
    );
  }
  for (const preservedFile of [
    'AutoWSGR-GUI.exe',
    'resources/app.asar',
    'resources/new-file.dat',
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

function testMissingManagedFileIsIdempotent(temporaryRoot) {
  const installDirectory = path.join(temporaryRoot, 'retry-installed');
  const previousManifestPath = path.join(
    installDirectory,
    'resources/.autowsgr-previous-install-manifest.json',
  );
  const currentManifestPath = path.join(
    installDirectory,
    'resources/.autowsgr-install-manifest.json',
  );
  writeManifest(
    previousManifestPath,
    ['resources/already-removed.dat'],
    '2.1.0-alpha.3',
  );
  writeManifest(currentManifestPath, [], '2.1.0-alpha.4');

  const output = runCleanup(
    installDirectory,
    previousManifestPath,
    currentManifestPath,
  );
  assert.match(output, /removed=0, missing=1/);
}

function testUnsafeManifestFailsBeforeDeletion(temporaryRoot) {
  const installDirectory = path.join(temporaryRoot, 'unsafe-installed');
  const removableFile = writeFile(
    installDirectory,
    'resources/old-file.dat',
  );
  const outsideFile = writeFile(temporaryRoot, 'outside-user-file.txt');
  const previousManifestPath = path.join(
    installDirectory,
    'resources/.autowsgr-previous-install-manifest.json',
  );
  const currentManifestPath = path.join(
    installDirectory,
    'resources/.autowsgr-install-manifest.json',
  );
  writeManifest(previousManifestPath, [
    'resources/old-file.dat',
    '../outside-user-file.txt',
  ], '2.1.0-alpha.3');
  writeManifest(currentManifestPath, [], '2.1.0-alpha.4');

  assert.throws(
    () => runCleanup(
      installDirectory,
      previousManifestPath,
      currentManifestPath,
    ),
    /cleanup failed/,
  );
  assert.equal(fs.existsSync(removableFile), true);
  assert.equal(fs.existsSync(outsideFile), true);
}

function testDuplicateManifestPathFailsBeforeDeletion(temporaryRoot) {
  const installDirectory = path.join(temporaryRoot, 'duplicate-installed');
  const removableFile = writeFile(
    installDirectory,
    'resources/old-file.dat',
  );
  const previousManifestPath = path.join(
    installDirectory,
    'resources/.autowsgr-previous-install-manifest.json',
  );
  const currentManifestPath = path.join(
    installDirectory,
    'resources/.autowsgr-install-manifest.json',
  );
  writeManifest(previousManifestPath, [
    'resources/old-file.dat',
    'RESOURCES/OLD-FILE.DAT',
  ], '2.1.0-alpha.3');
  writeManifest(currentManifestPath, [], '2.1.0-alpha.4');

  assert.throws(
    () => runCleanup(
      installDirectory,
      previousManifestPath,
      currentManifestPath,
    ),
    /Install manifest contains a dupl[\s\S]*icate path/,
  );
  assert.equal(fs.existsSync(removableFile), true);
}

function testFileToDirectoryShapeChange(temporaryRoot) {
  const installDirectory = path.join(temporaryRoot, 'file-to-directory');
  const previousManifestPath = path.join(temporaryRoot, 'file-to-dir-old.json');
  const currentManifestPath = path.join(temporaryRoot, 'file-to-dir-new.json');
  const backupDirectory = `${installDirectory}.autowsgr-shape-update`;
  const oldFile = writeFile(installDirectory, 'app/node', 'old');
  writeManifest(previousManifestPath, ['app/node'], '1.0.0');
  writeManifest(currentManifestPath, ['app/node/new.dat'], '1.0.1');

  runCleanup(installDirectory, previousManifestPath, currentManifestPath, {
    mode: 'PrepareShape',
    shapeBackupDirectory: backupDirectory,
  });
  assert.equal(fs.existsSync(oldFile), false);
  assert.equal(fs.existsSync(path.join(backupDirectory, 'app/node')), true);

  const newFile = writeFile(installDirectory, 'app/node/new.dat', 'new');
  runCleanup(installDirectory, previousManifestPath, currentManifestPath, {
    shapeBackupDirectory: backupDirectory,
  });
  assert.equal(fs.readFileSync(newFile, 'utf8'), 'new');
  assert.equal(fs.existsSync(backupDirectory), false);
}

function testDirectoryToFileShapeChange(temporaryRoot) {
  const installDirectory = path.join(temporaryRoot, 'directory-to-file');
  const previousManifestPath = path.join(temporaryRoot, 'dir-to-file-old.json');
  const currentManifestPath = path.join(temporaryRoot, 'dir-to-file-new.json');
  const backupDirectory = `${installDirectory}.autowsgr-shape-update`;
  writeFile(installDirectory, 'app/node/old.dat', 'old');
  writeManifest(previousManifestPath, ['app/node/old.dat'], '1.0.0');
  writeManifest(currentManifestPath, ['app/node'], '1.0.1');

  runCleanup(installDirectory, previousManifestPath, currentManifestPath, {
    mode: 'PrepareShape',
    shapeBackupDirectory: backupDirectory,
  });
  assert.equal(fs.existsSync(path.join(installDirectory, 'app/node')), false);

  const newFile = writeFile(installDirectory, 'app/node', 'new');
  runCleanup(installDirectory, previousManifestPath, currentManifestPath, {
    shapeBackupDirectory: backupDirectory,
  });
  assert.equal(fs.readFileSync(newFile, 'utf8'), 'new');
  assert.equal(fs.existsSync(backupDirectory), false);
}

function testUnknownFileBlocksDirectoryToFileChange(temporaryRoot) {
  const installDirectory = path.join(temporaryRoot, 'shape-with-user-file');
  const previousManifestPath = path.join(temporaryRoot, 'shape-user-old.json');
  const currentManifestPath = path.join(temporaryRoot, 'shape-user-new.json');
  const backupDirectory = `${installDirectory}.autowsgr-shape-update`;
  const oldFile = writeFile(installDirectory, 'app/node/old.dat', 'old');
  const userFile = writeFile(installDirectory, 'app/node/user.dat', 'user');
  writeManifest(previousManifestPath, ['app/node/old.dat'], '1.0.0');
  writeManifest(currentManifestPath, ['app/node'], '1.0.1');

  assert.throws(
    () => runCleanup(
      installDirectory,
      previousManifestPath,
      currentManifestPath,
      {
        mode: 'PrepareShape',
        shapeBackupDirectory: backupDirectory,
      },
    ),
    /unmanaged file/,
  );
  assert.equal(fs.existsSync(oldFile), true);
  assert.equal(fs.existsSync(userFile), true);
  assert.equal(fs.existsSync(backupDirectory), false);
}

function testShapeRestoreAfterFailedInstall(temporaryRoot) {
  const installDirectory = path.join(temporaryRoot, 'shape-restore');
  const previousManifestPath = path.join(temporaryRoot, 'shape-restore-old.json');
  const currentManifestPath = path.join(temporaryRoot, 'shape-restore-new.json');
  const backupDirectory = `${installDirectory}.autowsgr-shape-update`;
  const oldFile = writeFile(installDirectory, 'app/node', 'old');
  writeManifest(previousManifestPath, ['app/node'], '1.0.0');
  writeManifest(currentManifestPath, ['app/node/new.dat'], '1.0.1');

  runCleanup(installDirectory, previousManifestPath, currentManifestPath, {
    mode: 'PrepareShape',
    shapeBackupDirectory: backupDirectory,
  });
  writeFile(installDirectory, 'app/node/new.dat', 'partial');
  runCleanup(installDirectory, previousManifestPath, currentManifestPath, {
    mode: 'RestoreShape',
    shapeBackupDirectory: backupDirectory,
  });

  assert.equal(fs.readFileSync(oldFile, 'utf8'), 'old');
  assert.equal(fs.existsSync(backupDirectory), false);
}

function testInstallerContract() {
  const installer = fs.readFileSync(
    path.join(root, 'build', 'installer.nsh'),
    'utf8',
  );
  assert.match(
    installer,
    /\$\{ElseIf\} \$\{FileExists\} "\$INSTDIR\\\$\{UNINSTALL_FILENAME\}"[\s\S]*StrCpy \$R4 "1"/,
    '手动覆盖安装也必须进入清单升级路径',
  );
  assert.match(
    installer,
    /CopyFiles \/SILENT[\s\S]*INSTALL_MANIFEST[\s\S]*PREVIOUS_INSTALL_MANIFEST/,
    '新版落盘前必须保留旧版程序文件清单',
  );
  assert.match(installer, /LEGACY_SITE_PACKAGES_BACKUP/);
  assert.match(installer, /LEGACY_LOG_BACKUP/);
  assert.match(installer, /LEGACY_LOGS_BACKUP/);

  const updateCleanup = installer.match(
    /!macro customRemoveFiles([\s\S]*?)!macroend/,
  )[1];
  assert.match(
    updateCleanup,
    /\$\{ifNot\} \$\{isUpdated\}[\s\S]*RMDir \/r "\$INSTDIR"/,
    '只有主动卸载可以完整删除安装目录',
  );
  assert.doesNotMatch(
    updateCleanup,
    /remove-managed-install-files|INSTALL_MANIFEST/,
    '旧卸载器升级阶段不得提前删除或校验程序文件',
  );

  const finalCleanup = installer.match(
    /!macro customInstall([\s\S]*?)!macroend/,
  )[1];
  assert.match(finalCleanup, /-PreviousManifestPath/);
  assert.match(finalCleanup, /-CurrentManifestPath/);
  assert.match(installer, /-Mode PrepareShape/);
  assert.match(installer, /-Mode RestoreShape/);
  assert.match(installer, /generated\\install-manifest\.json/);
  const shapePrepareFailure = installer.match(
    /InstallShapePrepareFailed:[\s\S]*?InstallShapePrepared:/,
  )[0];
  assert.doesNotMatch(shapePrepareFailure, /Delete/);
  assert.match(
    installer,
    /Function \.onInstFailed[\s\S]*RestoreLegacyDataOrStop InstallFailed[\s\S]*FunctionEnd/,
    '安装失败时必须恢复已搬走的持久目录',
  );
  assert.match(
    installer,
    /!define MUI_CUSTOMFUNCTION_ABORT RestoreManagedInstallShapeOnUserAbort/,
  );
  assert.match(
    installer,
    /Function RestoreManagedInstallShapeOnUserAbort[\s\S]*RestoreLegacyDataOrStop UserAbort[\s\S]*FunctionEnd/,
    '用户取消安装时必须恢复已搬走的持久目录',
  );
  assert.doesNotMatch(installer, /Function \.onUserAbort/);
  assert.match(
    installer,
    /ManagedUninstallLaunchFailed:[\s\S]*RestoreLegacyDataOrStop UninstallLaunchFailed/,
    '旧卸载器无法启动时必须恢复已搬走的持久目录',
  );
  assert.match(
    installer,
    /ManagedUninstallExitChecked:[\s\S]*RestoreLegacyDataOrStop UninstallFailed/,
    '旧卸载器执行失败时必须恢复已搬走的持久目录',
  );
  assert.match(
    shapePrepareFailure,
    /RestoreLegacyDataOrStop ShapePrepareFailed/,
    '文件形态准备失败时必须恢复已搬走的持久目录',
  );
  assert.match(
    finalCleanup,
    /ManagedFileCleanupFailed:[\s\S]*RestoreLegacyDataOrStop ManagedFileCleanupFailed[\s\S]*RestoreManagedInstallShape/,
    '落盘后清理失败时必须同时恢复持久目录和文件形态',
  );
  assert.doesNotMatch(installer, /NEXT_INSTALL_MANIFEST|-Mode Validate/);
}

const temporaryRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), 'autowsgr-install-update-'),
);
try {
  testManifestBuilder(temporaryRoot);
  testManagedCleanup(temporaryRoot);
  testMissingManagedFileIsIdempotent(temporaryRoot);
  testUnsafeManifestFailsBeforeDeletion(temporaryRoot);
  testDuplicateManifestPathFailsBeforeDeletion(temporaryRoot);
  testFileToDirectoryShapeChange(temporaryRoot);
  testDirectoryToFileShapeChange(temporaryRoot);
  testUnknownFileBlocksDirectoryToFileChange(temporaryRoot);
  testShapeRestoreAfterFailedInstall(temporaryRoot);
  testInstallerContract();
  console.log('incremental install compatibility test passed');
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
