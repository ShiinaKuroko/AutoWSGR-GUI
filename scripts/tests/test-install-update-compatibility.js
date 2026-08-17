const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
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

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function manifestEntry(relativePath, content = relativePath) {
  return {
    path: relativePath,
    sha256: sha256(content),
  };
}

function writeManifest(filePath, files, version) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify({
    schemaVersion: 2,
    version,
    files,
  }, null, 2)}\n`);
}

function runCleanup(
  installDirectory,
  currentManifestPath,
  nextManifestPath,
  {
    mode = 'Finalize',
    scriptPath = cleanupScript,
  } = {},
) {
  const backupDirectory = `${installDirectory}.autowsgr-update-backup`;
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPath,
      '-InstallDirectory',
      installDirectory,
      '-CurrentManifestPath',
      currentManifestPath,
      '-NextManifestPath',
      nextManifestPath,
      '-Mode',
      mode,
      '-BackupDirectory',
      backupDirectory,
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `cleanup failed (${result.status}): ${result.stderr.trim()}`,
    );
  }
  return {
    output: result.stdout,
    backupDirectory,
  };
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
    'resources/.autowsgr-next-install-manifest.json',
    'resources/.autowsgr-previous-install-manifest.json',
  ]) {
    writeFile(appOutDir, persistentFile);
  }

  const manifest = manifestBuilder.createInstallManifest(
    appOutDir,
    '2.1.0-alpha.3',
  );
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.version, '2.1.0-alpha.3');
  assert.deepEqual(manifest.files, [
    manifestEntry('AutoWSGR-GUI.exe'),
    manifestEntry('adb/adb.exe'),
    manifestEntry('python/python.exe'),
    manifestEntry('resources/app.asar'),
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
  writeFile(installDirectory, 'AutoWSGR-GUI.exe', 'same executable');
  writeFile(installDirectory, 'resources/app.asar', 'old application');
  writeFile(installDirectory, 'resources/obsolete/removed.dat', 'removed');
  writeFile(installDirectory, 'resources/obsolete/旧资源.dat', '旧资源');
  for (const userFile of [
    'logs/runtime.log',
    'notes/user-file.txt',
    'resources/obsolete/user-file.txt',
    'resources/obsolete/用户文件.txt',
  ]) {
    writeFile(installDirectory, userFile);
  }

  const currentFiles = [
    manifestEntry('AutoWSGR-GUI.exe', 'same executable'),
    manifestEntry('resources/app.asar', 'old application'),
    manifestEntry('resources/obsolete/removed.dat', 'removed'),
    manifestEntry('resources/obsolete/旧资源.dat', '旧资源'),
  ];
  const nextFiles = [
    manifestEntry('AutoWSGR-GUI.exe', 'same executable'),
    manifestEntry('resources/app.asar', 'new application'),
    manifestEntry('resources/new-file.dat', 'new file'),
  ];
  writeManifest(currentManifestPath, currentFiles, '2.1.0-alpha.3');
  writeManifest(nextManifestPath, nextFiles, '2.1.0-alpha.4');

  writeFile(installDirectory, 'AutoWSGR-GUI.exe', 'same executable');
  writeFile(installDirectory, 'resources/app.asar', 'new application');
  writeFile(installDirectory, 'resources/new-file.dat', 'new file');

  const result = runCleanup(
    installDirectory,
    currentManifestPath,
    nextManifestPath,
  );
  assert.match(
    result.output,
    /added=1, updated=1, unchanged=1, removed=2/,
  );
  assert.equal(fs.existsSync(result.backupDirectory), false);

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
  assert.equal(
    fs.readFileSync(
      path.join(installDirectory, 'resources', 'app.asar'),
      'utf8',
    ),
    'new application',
  );
}

function testValidationDoesNotMutateFiles(temporaryRoot) {
  const installDirectory = path.join(temporaryRoot, 'validate-only');
  const obsoleteFile = writeFile(
    installDirectory,
    'resources/obsolete.dat',
    'obsolete',
  );
  const currentManifestPath = path.join(
    installDirectory,
    'resources/.autowsgr-install-manifest.json',
  );
  const nextManifestPath = path.join(
    installDirectory,
    'resources/.autowsgr-next-install-manifest.json',
  );
  writeManifest(
    currentManifestPath,
    [manifestEntry('resources/obsolete.dat', 'obsolete')],
    '2.1.0-alpha.3',
  );
  writeManifest(
    nextManifestPath,
    [manifestEntry('resources/new.dat', 'new')],
    '2.1.0-alpha.4',
  );

  const result = runCleanup(
    installDirectory,
    currentManifestPath,
    nextManifestPath,
    { mode: 'Validate' },
  );
  assert.match(result.output, /Validated install manifests/);
  assert.equal(fs.existsSync(obsoleteFile), true);
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
    [
      manifestEntry('resources/old-file.dat'),
      manifestEntry('../outside-user-file.txt'),
    ],
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

function testHashMismatchFailsBeforeDeletion(temporaryRoot) {
  const installDirectory = path.join(temporaryRoot, 'hash-mismatch');
  const obsoleteFile = writeFile(
    installDirectory,
    'resources/obsolete.dat',
    'obsolete',
  );
  writeFile(installDirectory, 'resources/app.asar', 'tampered');
  const currentManifestPath = path.join(
    installDirectory,
    'resources/.autowsgr-install-manifest.json',
  );
  const nextManifestPath = path.join(
    installDirectory,
    'resources/.autowsgr-next-install-manifest.json',
  );
  writeManifest(
    currentManifestPath,
    [manifestEntry('resources/obsolete.dat', 'obsolete')],
    '2.1.0-alpha.3',
  );
  writeManifest(
    nextManifestPath,
    [manifestEntry('resources/app.asar', 'expected')],
    '2.1.0-alpha.4',
  );

  assert.throws(
    () => runCleanup(
      installDirectory,
      currentManifestPath,
      nextManifestPath,
    ),
    /Installed managed file hash/,
  );
  assert.equal(fs.existsSync(obsoleteFile), true);
}

function testCleanupFailureRollsBack(temporaryRoot) {
  const installDirectory = path.join(temporaryRoot, 'rollback-installed');
  const firstFile = writeFile(
    installDirectory,
    'resources/obsolete-a.dat',
    'obsolete a',
  );
  const secondFile = writeFile(
    installDirectory,
    'resources/obsolete-b.dat',
    'obsolete b',
  );
  const currentManifestPath = path.join(
    installDirectory,
    'resources/.autowsgr-install-manifest.json',
  );
  const nextManifestPath = path.join(
    installDirectory,
    'resources/.autowsgr-next-install-manifest.json',
  );
  writeManifest(
    currentManifestPath,
    [
      manifestEntry('resources/obsolete-a.dat', 'obsolete a'),
      manifestEntry('resources/obsolete-b.dat', 'obsolete b'),
    ],
    '2.1.0-alpha.3',
  );
  writeManifest(nextManifestPath, [], '2.1.0-alpha.4');

  const escapedCleanupScript = cleanupScript.replaceAll("'", "''");
  const failureWrapper = path.join(temporaryRoot, 'fail-second-move.ps1');
  fs.writeFileSync(failureWrapper, [
    'param(',
    '  [string]$InstallDirectory,',
    '  [string]$CurrentManifestPath,',
    '  [string]$NextManifestPath,',
    '  [string]$Mode,',
    '  [string]$BackupDirectory',
    ')',
    '$script:managedMoveCount = 0',
    'function Move-Item {',
    '  param([string]$LiteralPath, [string]$Destination)',
    '  $script:managedMoveCount += 1',
    '  if ($script:managedMoveCount -eq 2) {',
    "    throw 'simulated second move failure'",
    '  }',
    '  Microsoft.PowerShell.Management\\Move-Item `',
    '    -LiteralPath $LiteralPath -Destination $Destination',
    '}',
    `& '${escapedCleanupScript}' \``,
    '  -InstallDirectory $InstallDirectory `',
    '  -CurrentManifestPath $CurrentManifestPath `',
    '  -NextManifestPath $NextManifestPath `',
    '  -Mode $Mode `',
    '  -BackupDirectory $BackupDirectory',
    '',
  ].join('\r\n'));

  assert.throws(
    () => runCleanup(
      installDirectory,
      currentManifestPath,
      nextManifestPath,
      { scriptPath: failureWrapper },
    ),
    /simulated second move failure/,
  );
  assert.equal(fs.existsSync(firstFile), true);
  assert.equal(fs.existsSync(secondFile), true);
  assert.equal(
    fs.existsSync(`${installDirectory}.autowsgr-update-backup`),
    false,
  );
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
  assert.match(installer, /-Mode Validate/);
  assert.match(installer, /-Mode Finalize/);
  assert.match(
    installer,
    /PREVIOUS_INSTALL_MANIFEST[\s\S]*NEXT_INSTALL_MANIFEST/,
  );
  const updateCleanup = installer.match(
    /!macro customRemoveFiles([\s\S]*?)!macroend/,
  )[1];
  assert.doesNotMatch(
    updateCleanup,
    /Delete "\$INSTDIR\\\$\{UNINSTALL_FILENAME\}"/,
    '旧卸载器不得在新文件落盘前删除程序文件',
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
  testValidationDoesNotMutateFiles(temporaryRoot);
  testUnsafeManifestFailsBeforeDeletion(temporaryRoot);
  testHashMismatchFailsBeforeDeletion(temporaryRoot);
  testCleanupFailureRollsBack(temporaryRoot);
  testInstallerContract();
  console.log('incremental install compatibility test passed');
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
