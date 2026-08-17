/**
 * 后端发行来源回归测试。
 *
 * 模拟安装包 resources 目录，验证 Stable/Alpha 分别读取主库和个人仓库
 * 的固定提交，并确认安装后会清除环境标记以触发后端更新。
 */
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const modulePath = path.join(
  root,
  'dist',
  'electron',
  'pythonEnv',
  'backendRequirement.js',
);
const resources = fs.mkdtempSync(
  path.join(os.tmpdir(), 'autowsgr-backend-distribution-'),
);

try {
  fs.copyFileSync(
    path.join(root, 'build', 'backend-distribution.json'),
    path.join(resources, 'backend-distribution.json'),
  );
  const script = [
    "Object.defineProperty(process, 'resourcesPath', {",
    '  value: process.argv[1],',
    '});',
    'const requirement = require(process.argv[2]);',
    'const stable = requirement.resolveBackendDistribution(false);',
    'const alpha = requirement.resolveBackendDistribution(true);',
    "const sharedCommit = '0'.repeat(40);",
    'process.stdout.write(JSON.stringify({',
    '  stable,',
    '  alpha,',
    '  stableRequirement:',
    '    requirement.buildManagedAutowsgrRequirement(stable),',
    '  alphaRequirement:',
    '    requirement.buildManagedAutowsgrRequirement(alpha),',
    '  sameCommitStableRequirement:',
    '    requirement.buildManagedAutowsgrRequirement({',
    '      ...stable, commit: sharedCommit,',
    '    }),',
    '  sameCommitAlphaRequirement:',
    '    requirement.buildManagedAutowsgrRequirement({',
    '      ...alpha, commit: sharedCommit,',
    '    }),',
    '}));',
  ].join('\n');
  const result = JSON.parse(execFileSync(
    process.execPath,
    ['-e', script, resources, modulePath],
    { encoding: 'utf8' },
  ));

  assert.equal(result.stable.id, 'stable');
  assert.equal(
    result.stable.repository,
    'OpenWSGR/AutoWSGR',
  );
  assert.equal(result.stable.ref, 'main');
  assert.equal(result.stable.forceUpdateOnInstall, true);
  assert.match(result.stableRequirement, /OpenWSGR\/AutoWSGR/);
  assert.equal(result.alpha.id, 'alpha');
  assert.equal(result.alpha.repository, 'ShiinaKuroko/AutoWSGR');
  assert.equal(result.alpha.ref, 'ShiinaKuroko');
  assert.equal(result.alpha.forceUpdateOnInstall, true);
  assert.match(result.alphaRequirement, /ShiinaKuroko\/AutoWSGR/);
  assert.notEqual(
    result.sameCommitStableRequirement,
    result.sameCommitAlphaRequirement,
    '相同提交位于不同仓库时仍必须视为不同后端来源',
  );

  const installer = fs.readFileSync(
    path.join(root, 'build', 'installer.nsh'),
    'utf8',
  );
  assert.match(installer, /Delete "\$INSTDIR\\\.env_ready"/);
  assert.match(installer, /!macro customCheckAppRunning/);
  assert.match(installer, /\/F \/T \/IM/);
  assert.match(installer, /\$R1 < 20/);
  assert.match(
    installer,
    /Get-Process -Name adb[\s\S]*\$\$_.Path[\s\S]*\$INSTDIR\\adb\\adb\.exe/,
    '覆盖安装前只能停止安装目录内置的 ADB server',
  );
  assert.doesNotMatch(
    installer,
    /adb\\adb\.exe" kill-server/,
    '安装器不得通过共享 ADB 端口关闭其他工具的 server',
  );
  assert.match(
    installer,
    /!insertmacro PreserveLegacyDirectory\s+\\\s+"\$INSTDIR\\python\\site-packages"\s+\\\s+"\$\{LEGACY_SITE_PACKAGES_BACKUP\}"/,
    '覆盖安装前必须临时保留已有后端依赖',
  );
  assert.match(
    installer,
    /!insertmacro RestoreLegacyDirectory\s+\\\s+"\$\{LEGACY_SITE_PACKAGES_BACKUP\}"\s+\\\s+"\$INSTDIR\\python\\site-packages"/,
    '写入新前端后必须恢复已有后端依赖',
  );
  assert.match(installer, /!macro customUnInstall/);
  assert.match(
    installer,
    /\$\{ifNot\} \$\{isUpdated\}/,
    '覆盖升级调用旧卸载器时不能删除后端依赖',
  );
  assert.match(
    installer,
    /!macro customRemoveFiles[\s\S]*\$\{ifNot\} \$\{isUpdated\}[\s\S]*RMDir \/r "\$INSTDIR"/,
    '主动卸载时必须删除后端依赖',
  );
  assert.match(
    installer,
    /\$\{If\} \$\{isUpdated\}[\s\S]*\$\{FileExists\} "\$newDesktopLink"[\s\S]*addDesktopLink "false"[\s\S]*\$\{FileExists\} "\$newStartMenuLink"[\s\S]*addStartMenuLink "false"/,
    '覆盖升级必须刷新已有快捷方式',
  );
  console.log('backend distribution test passed');
} finally {
  fs.rmSync(resources, { recursive: true, force: true });
}
