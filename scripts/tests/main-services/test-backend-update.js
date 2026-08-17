/**
 * 后端独立增量更新服务测试。
 *
 * 网络、下载和解压全部注入替身，验证检查、基线重置、
 * 差异暂存、增量应用和完整安装状态机的行为。
 */
const context = require('./test-context');
const {
  assert,
  fs,
  path,
  AtomicFileStore,
  BackendUpdateService,
  temporaryDirectory,
} = context;

const {
  diffBackendPackage,
  isSafeRelativePath,
} = require('../../../dist/electron/services/BackendUpdateService.js');

const BASE_COMMIT = 'a'.repeat(40);
const LATEST_COMMIT = 'b'.repeat(40);
const NEWER_COMMIT = 'c'.repeat(40);
const ALPHA_DISTRIBUTION = {
  id: 'alpha',
  repository: 'ShiinaKuroko/AutoWSGR',
  ref: 'ShiinaKuroko',
  commit: BASE_COMMIT,
  forceUpdateOnInstall: true,
};

/** 构造带网络替身的后端更新服务。 */
function createService(options = {}) {
  const root = fs.mkdtempSync(
    path.join(temporaryDirectory, 'backend-update-'),
  );
  const stagingRoot = path.join(root, 'staging');
  const sitePackages = path.join(root, 'site-packages');
  const statePath = path.join(
    sitePackages,
    '.autowsgr-update-state.json',
  );
  const installedDir = path.join(sitePackages, 'autowsgr');
  const statusEvents = [];
  const logs = [];
  const resolveOption = value => (
    typeof value === 'function' ? value() : value
  );

  const service = new BackendUpdateService({
    getStagingRoot: () => stagingRoot,
    getStatePath: () => statePath,
    getInstalledPackageDir: () => installedDir,
    getAppVersion: () => resolveOption(options.appVersion)
      ?? '2.0.18-alpha.0',
    allowTestUpdates: () => resolveOption(options.allowTestUpdates) ?? true,
    backendStartupMode: () => (
      resolveOption(options.backendStartupMode) ?? 'managed'
    ),
    alphaDistribution: () => (
      resolveOption(options.alphaDistribution) ?? ALPHA_DISTRIBUTION
    ),
    atomicFiles: new AtomicFileStore(),
    sendStatus: status => statusEvents.push(status),
    chooseRestartTiming: options.chooseRestartTiming,
    restartApplication: options.restartApplication,
    log: message => logs.push(message),
    runtime: options.runtime,
    fetchJson: options.fetchJson ?? (async url => (
      url.includes('/compare/')
        ? (
            resolveOption(options.comparison)
            ?? { status: 'ahead', files: [] }
          )
        : { sha: resolveOption(options.latestCommit) ?? LATEST_COMMIT }
    )),
    downloadArchive: options.downloadArchive
      ?? (async (url, destination, onProgress) => {
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.writeFileSync(destination, `zip:${url}`);
        onProgress(100);
      }),
    extractArchive: async (zipPath, destination) => {
      const commit = path.basename(zipPath, '.zip');
      const sourceRoot = path.join(
        destination,
        `AutoWSGR-${commit.slice(0, 7)}`,
      );
      fs.mkdirSync(sourceRoot, { recursive: true });
      const sourceTree = resolveOption(options.sourceTree) ?? {};
      for (const [file, content] of Object.entries(sourceTree)) {
        const target = path.join(
          sourceRoot,
          ...file.split('/'),
        );
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content);
      }
    },
  });

  return {
    service,
    root,
    stagingRoot,
    statePath,
    sitePackages,
    installedDir,
    statusEvents,
    logs,
    readState: () => JSON.parse(fs.readFileSync(statePath, 'utf-8')),
  };
}

/** 写入已安装包的初始文件树。 */
function writeInstalledFiles(installedDir, files) {
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(installedDir, ...file.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
}

/** 差异清单的纯函数行为。 */
function testDiffBackendPackage() {
  const root = fs.mkdtempSync(
    path.join(temporaryDirectory, 'backend-diff-'),
  );
  const installedDir = path.join(root, 'installed');
  const incomingDir = path.join(root, 'incoming');
  writeInstalledFiles(installedDir, {
    'keep.py': 'same',
    'modify.py': 'old',
    'nested/remove.py': 'gone',
    'todelete.py': 'bye',
    '__pycache__/runtime.pyc': 'generated',
  });
  writeInstalledFiles(incomingDir, {
    'keep.py': 'same',
    'modify.py': 'new',
    'nested/add.py': 'fresh',
    'added.py': 'new file',
  });

  const diff = diffBackendPackage(installedDir, incomingDir);
  assert.deepEqual(diff.add.sort(), ['added.py', 'nested/add.py']);
  assert.deepEqual(diff.modify, ['modify.py']);
  assert.deepEqual(diff.delete.sort(), ['nested/remove.py', 'todelete.py']);
}

/** 路径安全校验拒绝目录穿越和绝对路径。 */
function testIsSafeRelativePath() {
  assert.equal(isSafeRelativePath('autowsgr/main.py'), true);
  assert.equal(isSafeRelativePath('data/map/e1.json'), true);
  assert.equal(isSafeRelativePath('../escape.py'), false);
  assert.equal(isSafeRelativePath('a/../../escape.py'), false);
  assert.equal(isSafeRelativePath('C:/windows/system32/evil.py'), false);
  assert.equal(isSafeRelativePath('C:\\evil.py'), false);
  assert.equal(isSafeRelativePath(''), false);
  assert.equal(isSafeRelativePath('./relative.py'), false);
}

/** 检查门禁、基线重置和 up-to-date/available 分类。 */
async function testCheckAndBaseline() {
  // 非 alpha 渠道与 external 模式直接拒绝。
  const gated = createService({ allowTestUpdates: false });
  const gatedResult = await gated.service.check();
  assert.equal(gatedResult.status, 'error');

  const external = createService({ backendStartupMode: 'external' });
  const externalResult = await external.service.check();
  assert.equal(externalResult.status, 'error');

  // 首次检查以 GUI 绑定 commit 为基线。
  const first = createService();
  const firstResult = await first.service.check();
  assert.equal(firstResult.status, 'available');
  assert.equal(firstResult.commit, LATEST_COMMIT);
  assert.equal(first.readState().appliedCommit, BASE_COMMIT);
  assert.equal(first.readState().boundCommit, BASE_COMMIT);
  assert.equal(
    path.dirname(first.statePath),
    path.dirname(first.installedDir),
    '后端更新状态必须跟随后端安装目录',
  );

  // 已应用到最新 commit 时返回 up-to-date。
  const upToDate = createService({ latestCommit: BASE_COMMIT });
  const upToDateResult = await upToDate.service.check();
  assert.equal(upToDateResult.status, 'up-to-date');

  // GUI 版本变化时重置基线并丢弃旧暂存。
  let appVersion = '2.0.18-alpha.0';
  const upgraded = createService({
    appVersion: () => appVersion,
    sourceTree: {
      'autowsgr/main.py': 'v1',
      'pyproject.toml': 'dependencies = ["v1"]',
    },
  });
  await upgraded.service.prepare(LATEST_COMMIT);
  assert.ok(upgraded.readState().pending);

  appVersion = '2.0.19-alpha.0';
  await upgraded.service.check();
  const resetState = upgraded.readState();
  assert.equal(resetState.guiVersion, '2.0.19-alpha.0');
  assert.equal(resetState.appliedCommit, BASE_COMMIT);
  assert.equal(resetState.pending, null);
}

/** GUI 基线变化不能在固定后端安装成功前伪造已应用 commit。 */
async function testBaselineChangesOnlyAfterManagedInstall() {
  let appVersion = '2.0.18-alpha.0';
  let boundCommit = BASE_COMMIT;
  let latestCommit = LATEST_COMMIT;
  const harness = createService({
    appVersion: () => appVersion,
    latestCommit: () => latestCommit,
    alphaDistribution: () => ({
      ...ALPHA_DISTRIBUTION,
      commit: boundCommit,
    }),
    sourceTree: { 'autowsgr/main.py': 'new' },
  });
  writeInstalledFiles(harness.installedDir, { 'main.py': 'old' });
  await harness.service.prepare(LATEST_COMMIT);
  await harness.service.applyPendingUpdate(async () => true);
  assert.equal(harness.readState().appliedCommit, LATEST_COMMIT);

  appVersion = '2.0.19-alpha.0';
  boundCommit = NEWER_COMMIT;
  latestCommit = NEWER_COMMIT;
  await harness.service.check();
  const waitingForManagedInstall = harness.readState();
  assert.equal(waitingForManagedInstall.boundCommit, NEWER_COMMIT);
  assert.equal(waitingForManagedInstall.appliedCommit, LATEST_COMMIT);
  assert.equal(waitingForManagedInstall.pending, null);

  harness.service.clearStateAfterManagedInstall();
  await harness.service.check();
  assert.equal(harness.readState().appliedCommit, NEWER_COMMIT);
}

/** 暂存增量差异并写入 pending 状态。 */
async function testPrepareIncremental() {
  const harness = createService({
    sourceTree: {
      'autowsgr/keep.py': 'same',
      'autowsgr/modify.py': 'new',
      'autowsgr/added.py': 'fresh',
      'pyproject.toml': 'dependencies = ["existing"]',
    },
  });
  writeInstalledFiles(harness.installedDir, {
    'keep.py': 'same',
    'modify.py': 'old',
    'todelete.py': 'bye',
  });

  await harness.service.prepare(LATEST_COMMIT);
  const state = harness.readState();
  assert.equal(state.pending.type, 'incremental');
  assert.equal(state.pending.commit, LATEST_COMMIT);
  assert.deepEqual(state.pending.diff.add, ['added.py']);
  assert.deepEqual(state.pending.diff.modify, ['modify.py']);
  assert.deepEqual(state.pending.diff.delete, ['todelete.py']);

  const lastStatus = harness.statusEvents[harness.statusEvents.length - 1];
  assert.equal(lastStatus.status, 'downloaded');
  assert.equal(lastStatus.commit, LATEST_COMMIT);
}

/** 新提交准备失败时不得破坏已经可用的旧暂存。 */
async function testPrepareFailurePreservesPending() {
  let downloadCount = 0;
  const harness = createService({
    sourceTree: {
      'autowsgr/main.py': 'new',
    },
    downloadArchive: async (url, destination, onProgress) => {
      downloadCount += 1;
      if (downloadCount > 1) throw new Error('download failed');
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, `zip:${url}`);
      onProgress(100);
    },
  });
  writeInstalledFiles(harness.installedDir, { 'main.py': 'old' });

  await harness.service.prepare(LATEST_COMMIT);
  const originalPending = harness.readState().pending;
  assert.equal(fs.existsSync(originalPending.source), true);

  await assert.rejects(
    () => harness.service.prepare(NEWER_COMMIT),
    /download failed/,
  );
  const retainedPending = harness.readState().pending;
  assert.equal(retainedPending.commit, LATEST_COMMIT);
  assert.equal(retainedPending.source, originalPending.source);
  assert.equal(fs.existsSync(retainedPending.source), true);
}

/** 不同目标 commit 的准备请求必须串行并最终保留较新的目标。 */
async function testPrepareQueuesDifferentCommit() {
  let releaseFirstDownload;
  let notifyFirstDownload;
  let downloadCount = 0;
  const firstDownloadStarted = new Promise((resolve) => {
    notifyFirstDownload = resolve;
  });
  const firstDownloadReleased = new Promise((resolve) => {
    releaseFirstDownload = resolve;
  });
  const harness = createService({
    sourceTree: { 'autowsgr/main.py': 'new' },
    downloadArchive: async (url, destination, onProgress) => {
      downloadCount += 1;
      if (downloadCount === 1) {
        notifyFirstDownload();
        await firstDownloadReleased;
      }
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, `zip:${url}`);
      onProgress(100);
    },
  });
  writeInstalledFiles(harness.installedDir, { 'main.py': 'old' });

  const first = harness.service.prepare(LATEST_COMMIT);
  await firstDownloadStarted;
  const second = harness.service.prepare(NEWER_COMMIT);
  releaseFirstDownload();
  await Promise.all([first, second]);

  assert.equal(downloadCount, 2);
  assert.equal(harness.readState().pending.commit, NEWER_COMMIT);
}

/** 首次更新包含 pyproject 变化时直接升级为完整安装。 */
async function testPrepareFullOnPyprojectChange() {
  const harness = createService({
    comparison: {
      status: 'ahead',
      files: [{ filename: 'pyproject.toml' }],
    },
    sourceTree: {
      'autowsgr/main.py': 'v2',
      'pyproject.toml': 'dependencies = ["v2"]',
    },
  });
  writeInstalledFiles(harness.installedDir, { 'main.py': 'v1' });
  await harness.service.prepare(LATEST_COMMIT);
  const state = harness.readState();
  assert.equal(state.pending.type, 'full');
  assert.ok(state.pending.source.endsWith(`${LATEST_COMMIT}.zip`));
}

/** pyproject 被重命名时同样属于依赖定义变化。 */
async function testPrepareFullOnPyprojectRename() {
  const harness = createService({
    comparison: {
      status: 'ahead',
      files: [{
        filename: 'pyproject.previous.toml',
        previous_filename: 'pyproject.toml',
      }],
    },
    sourceTree: {
      'autowsgr/main.py': 'v2',
      'pyproject.previous.toml': 'dependencies = ["v2"]',
    },
  });
  writeInstalledFiles(harness.installedDir, { 'main.py': 'v1' });
  await harness.service.prepare(LATEST_COMMIT);
  assert.equal(harness.readState().pending.type, 'full');
}

/** 当前提交不再是目标提交祖先时必须完整安装。 */
async function testPrepareFullOnHistoryChange() {
  const harness = createService({
    comparison: {
      status: 'diverged',
      files: [{ filename: 'autowsgr/main.py' }],
    },
    sourceTree: {
      'autowsgr/main.py': 'forked',
    },
  });
  writeInstalledFiles(harness.installedDir, { 'main.py': 'old' });
  await harness.service.prepare(LATEST_COMMIT);
  assert.equal(harness.readState().pending.type, 'full');
  assert.equal(
    harness.logs.some(message => message.includes('提交历史已变化')),
    true,
  );
}

/** 强推导致旧提交不可比较时，必须按历史分叉执行完整安装。 */
async function testPrepareFullWhenComparisonIsMissing() {
  const harness = createService({
    fetchJson: async url => {
      if (url.includes('/compare/')) {
        throw new Error('GitHub API 请求失败 (404)');
      }
      return { sha: LATEST_COMMIT };
    },
    sourceTree: {
      'autowsgr/main.py': 'force-pushed',
    },
  });
  writeInstalledFiles(harness.installedDir, { 'main.py': 'old' });

  await harness.service.prepare(LATEST_COMMIT);
  assert.equal(harness.readState().pending.type, 'full');
}

/** 文件与目录形态互换时必须降级为完整安装。 */
async function testPrepareFullOnPathShapeChange() {
  const harness = createService({
    sourceTree: {
      'autowsgr/node/new.py': 'new',
    },
  });
  writeInstalledFiles(harness.installedDir, { node: 'old file' });
  await harness.service.prepare(LATEST_COMMIT);
  assert.equal(harness.readState().pending.type, 'full');
}

/** 应用增量差异后更新基线并清理暂存。 */
async function testApplyIncremental() {
  const harness = createService({
    sourceTree: {
      'autowsgr/keep.py': 'same',
      'autowsgr/modify.py': 'new',
      'autowsgr/nested/added.py': 'fresh',
    },
  });
  writeInstalledFiles(harness.installedDir, {
    'keep.py': 'same',
    'modify.py': 'old',
    'todelete.py': 'bye',
  });
  await harness.service.prepare(LATEST_COMMIT);

  const applied = await harness.service.applyPendingUpdate(async () => true);
  assert.equal(applied, true);
  assert.equal(
    fs.readFileSync(path.join(harness.installedDir, 'modify.py'), 'utf-8'),
    'new',
  );
  assert.equal(
    fs.readFileSync(
      path.join(harness.installedDir, 'nested', 'added.py'),
      'utf-8',
    ),
    'fresh',
  );
  assert.equal(
    fs.existsSync(path.join(harness.installedDir, 'todelete.py')),
    false,
  );

  const state = harness.readState();
  assert.equal(state.appliedCommit, LATEST_COMMIT);
  assert.equal(state.pending, null);
  assert.equal(fs.existsSync(harness.stagingRoot), false);
}

/** 增量替换中途失败时恢复已覆盖文件并保留 pending。 */
async function testIncrementalRollback() {
  const harness = createService({
    sourceTree: {
      'autowsgr/a.py': 'new',
      'autowsgr/blocked/new.py': 'fresh',
    },
  });
  writeInstalledFiles(harness.installedDir, { 'a.py': 'old' });
  await harness.service.prepare(LATEST_COMMIT);
  fs.writeFileSync(
    path.join(harness.installedDir, 'blocked'),
    'blocks directory creation',
  );

  await assert.rejects(
    () => harness.service.applyPendingUpdate(async () => true),
  );
  assert.equal(
    fs.readFileSync(path.join(harness.installedDir, 'a.py'), 'utf-8'),
    'old',
  );
  assert.equal(harness.readState().pending.commit, LATEST_COMMIT);
}

/** 增量文件落盘后运行契约验证失败时恢复旧文件。 */
async function testIncrementalValidationRollback() {
  const harness = createService({
    sourceTree: { 'autowsgr/main.py': 'broken' },
  });
  writeInstalledFiles(harness.installedDir, { 'main.py': 'working' });
  await harness.service.prepare(LATEST_COMMIT);

  await assert.rejects(
    () => harness.service.applyPendingUpdate(async () => false),
    /运行契约验证失败/,
  );
  assert.equal(
    fs.readFileSync(path.join(harness.installedDir, 'main.py'), 'utf-8'),
    'working',
  );
  assert.equal(harness.readState().pending.commit, LATEST_COMMIT);
  assert.equal(harness.readState().applying, false);
}

/** 暂存后出现目录联接时，应用和恢复都不得触碰安装目录外文件。 */
async function testLinkedPathIsRejected() {
  const harness = createService({
    sourceTree: { 'autowsgr/linked/victim.py': 'new' },
  });
  writeInstalledFiles(harness.installedDir, { 'main.py': 'old' });
  await harness.service.prepare(LATEST_COMMIT);

  const outside = path.join(harness.root, 'outside');
  writeInstalledFiles(outside, { 'victim.py': 'keep' });
  fs.symlinkSync(
    outside,
    path.join(harness.installedDir, 'linked'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );

  await assert.rejects(
    () => harness.service.applyPendingUpdate(async () => true),
    /符号链接/,
  );
  assert.equal(
    fs.readFileSync(path.join(outside, 'victim.py'), 'utf-8'),
    'keep',
  );

  const state = harness.readState();
  fs.mkdirSync(
    path.join(harness.stagingRoot, 'rollback-incremental'),
    { recursive: true },
  );
  fs.writeFileSync(harness.statePath, JSON.stringify({
    ...state,
    applying: true,
  }));
  assert.throws(
    () => harness.service.recoverInterruptedApply(),
    /符号链接/,
  );
  assert.equal(
    fs.readFileSync(path.join(outside, 'victim.py'), 'utf-8'),
    'keep',
  );
}

/** 进程中断留下 applying 状态时，启动恢复旧的增量文件。 */
async function testRecoverInterruptedIncremental() {
  const harness = createService({
    sourceTree: {
      'autowsgr/modify.py': 'new',
      'autowsgr/added.py': 'new',
    },
  });
  writeInstalledFiles(harness.installedDir, {
    'modify.py': 'old',
    'deleted.py': 'old',
  });
  await harness.service.prepare(LATEST_COMMIT);
  const state = harness.readState();
  const backupRoot = path.join(harness.stagingRoot, 'rollback-incremental');
  writeInstalledFiles(backupRoot, {
    'modify.py': 'old',
    'deleted.py': 'old',
  });
  writeInstalledFiles(harness.installedDir, {
    'modify.py': 'new',
    'added.py': 'new',
  });
  fs.rmSync(path.join(harness.installedDir, 'deleted.py'));
  fs.writeFileSync(harness.statePath, JSON.stringify({
    ...state,
    applying: true,
  }));

  assert.equal(harness.service.recoverInterruptedApply(), true);
  assert.equal(
    fs.readFileSync(path.join(harness.installedDir, 'modify.py'), 'utf-8'),
    'old',
  );
  assert.equal(fs.existsSync(path.join(harness.installedDir, 'added.py')), false);
  assert.equal(
    fs.readFileSync(path.join(harness.installedDir, 'deleted.py'), 'utf-8'),
    'old',
  );
  assert.equal(harness.readState().applying, false);
}

/** 损坏状态中的越界路径不得在恢复阶段触碰安装目录外文件。 */
async function testUnsafeRecoveryStateIsRejected() {
  const harness = createService();
  await harness.service.check();
  const victim = path.join(harness.root, 'victim.txt');
  fs.writeFileSync(victim, 'keep');
  fs.mkdirSync(
    path.join(harness.stagingRoot, 'rollback-incremental'),
    { recursive: true },
  );
  fs.writeFileSync(harness.statePath, JSON.stringify({
    ...harness.readState(),
    pending: {
      type: 'incremental',
      commit: LATEST_COMMIT,
      source: path.join(harness.stagingRoot, 'source'),
      diff: {
        add: [],
        modify: [],
        delete: ['../../victim.txt'],
      },
    },
    applying: true,
  }));

  assert.equal(harness.service.recoverInterruptedApply(), false);
  assert.equal(fs.readFileSync(victim, 'utf-8'), 'keep');
}

/** 完整安装被强制中断时，启动恢复安装前的 site-packages。 */
async function testRecoverInterruptedFull() {
  const harness = createService({
    comparison: {
      status: 'ahead',
      files: [{ filename: 'pyproject.toml' }],
    },
    sourceTree: { 'autowsgr/main.py': 'new' },
  });
  writeInstalledFiles(harness.installedDir, { 'main.py': 'old' });
  await harness.service.prepare(LATEST_COMMIT);
  const state = harness.readState();
  const backupRoot = path.join(harness.stagingRoot, 'rollback-full');
  fs.cpSync(harness.sitePackages, backupRoot, { recursive: true });
  fs.rmSync(
    path.join(backupRoot, path.basename(harness.statePath)),
    { force: true },
  );
  fs.writeFileSync(path.join(harness.installedDir, 'main.py'), 'broken');
  writeInstalledFiles(
    path.join(harness.sitePackages, 'new_dependency'),
    { '__init__.py': 'partial' },
  );
  fs.writeFileSync(harness.statePath, JSON.stringify({
    ...state,
    applying: true,
  }));

  assert.equal(harness.service.recoverInterruptedApply(), true);
  assert.equal(
    fs.readFileSync(path.join(harness.installedDir, 'main.py'), 'utf-8'),
    'old',
  );
  assert.equal(
    fs.existsSync(path.join(harness.sitePackages, 'new_dependency')),
    false,
  );
  assert.equal(harness.readState().pending.commit, LATEST_COMMIT);
  assert.equal(harness.readState().applying, false);
  assert.equal(harness.service.recoverInterruptedApply(), false);
}

/** 退出会等待已经开始的下载完成，并在后端停止后应用该更新。 */
async function testExitWaitsForPreparation() {
  let releaseDownload;
  let notifyDownloadStarted;
  const downloadStarted = new Promise((resolve) => {
    notifyDownloadStarted = resolve;
  });
  const downloadReleased = new Promise((resolve) => {
    releaseDownload = resolve;
  });
  const harness = createService({
    sourceTree: { 'autowsgr/main.py': 'new' },
    downloadArchive: async (url, destination, onProgress) => {
      notifyDownloadStarted();
      await downloadReleased;
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, `zip:${url}`);
      onProgress(100);
    },
    runtime: {
      findPython: async () => 'python',
      validateBackend: async () => true,
      installArchive: async () => true,
    },
  });
  writeInstalledFiles(harness.installedDir, { 'main.py': 'old' });

  const preparing = harness.service.prepare(LATEST_COMMIT);
  await downloadStarted;
  let exitCompleted = false;
  const exiting = harness.service.applyBeforeExit().then(() => {
    exitCompleted = true;
  });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(exitCompleted, false);

  releaseDownload();
  await Promise.all([preparing, exiting]);
  assert.equal(exitCompleted, true);
  assert.equal(
    fs.readFileSync(path.join(harness.installedDir, 'main.py'), 'utf-8'),
    'new',
  );
  assert.equal(harness.readState().appliedCommit, LATEST_COMMIT);
}

/** 固定后端安装会取消并等待并发的独立更新准备。 */
async function testManagedInstallSerializesPreparation() {
  let releaseDownload;
  let notifyDownloadStarted;
  const downloadStarted = new Promise((resolve) => {
    notifyDownloadStarted = resolve;
  });
  const downloadReleased = new Promise((resolve) => {
    releaseDownload = resolve;
  });
  const harness = createService({
    sourceTree: { 'autowsgr/main.py': 'new' },
    downloadArchive: async (url, destination, onProgress) => {
      notifyDownloadStarted();
      await downloadReleased;
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, `zip:${url}`);
      onProgress(100);
    },
  });
  writeInstalledFiles(harness.installedDir, { 'main.py': 'old' });

  const preparing = harness.service.prepare(LATEST_COMMIT);
  await downloadStarted;
  const beginningInstall = harness.service.beginManagedBackendInstall();
  releaseDownload();
  await assert.rejects(preparing, /后端环境正在安装/);
  await beginningInstall;
  harness.service.clearStateAfterManagedInstall();
  harness.service.endManagedBackendInstall();

  assert.equal(harness.service.hasPendingUpdate(), false);
  assert.equal(fs.existsSync(harness.stagingRoot), false);
}

/** 两个 managed/pip 安装请求必须按进入顺序逐个取得操作权。 */
async function testManagedInstallsAreQueued() {
  const harness = createService();
  await harness.service.beginManagedBackendInstall();

  let secondStarted = false;
  const second = harness.service.beginManagedBackendInstall().then(() => {
    secondStarted = true;
  });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(secondStarted, false);

  harness.service.endManagedBackendInstall();
  await second;
  assert.equal(secondStarted, true);
  harness.service.endManagedBackendInstall();
}

/** 退出必须等待正在进行的 managed/pip 安装，不能并发修改后端。 */
async function testExitWaitsForManagedInstall() {
  let validationCount = 0;
  const harness = createService({
    sourceTree: { 'autowsgr/main.py': 'new' },
    runtime: {
      findPython: async () => 'python',
      validateBackend: async () => {
        validationCount += 1;
        return true;
      },
      installArchive: async () => true,
    },
  });
  writeInstalledFiles(harness.installedDir, { 'main.py': 'old' });
  await harness.service.prepare(LATEST_COMMIT);
  await harness.service.beginManagedBackendInstall();

  let exitCompleted = false;
  const exiting = harness.service.applyBeforeExit().then(() => {
    exitCompleted = true;
  });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(exitCompleted, false);
  assert.equal(validationCount, 0);
  assert.equal(
    fs.readFileSync(path.join(harness.installedDir, 'main.py'), 'utf-8'),
    'old',
  );

  harness.service.endManagedBackendInstall();
  await exiting;
  assert.equal(exitCompleted, true);
  assert.equal(validationCount, 1);
  assert.equal(
    fs.readFileSync(path.join(harness.installedDir, 'main.py'), 'utf-8'),
    'new',
  );
}

/** 暂存源码被清理后丢弃 pending，允许相同 commit 重新下载。 */
async function testMissingPendingIsPreparedAgain() {
  const harness = createService({
    sourceTree: { 'autowsgr/main.py': 'new' },
  });
  writeInstalledFiles(harness.installedDir, { 'main.py': 'old' });
  await harness.service.prepare(LATEST_COMMIT);
  fs.rmSync(harness.readState().pending.source, {
    recursive: true,
    force: true,
  });

  assert.equal(harness.service.hasPendingUpdate(), false);
  assert.equal(harness.readState().pending, null);
  await harness.service.prepare(LATEST_COMMIT);
  assert.equal(harness.readState().pending.commit, LATEST_COMMIT);
  assert.equal(fs.existsSync(harness.readState().pending.source), true);
}

/** 完整安装的成功与失败状态转换。 */
async function testApplyFull() {
  const harness = createService({
    comparison: {
      status: 'ahead',
      files: [{ filename: 'pyproject.toml' }],
    },
    sourceTree: {
      'autowsgr/main.py': 'v2',
      'pyproject.toml': 'dependencies = ["v2"]',
    },
  });
  writeInstalledFiles(harness.installedDir, { 'main.py': 'v1' });
  writeInstalledFiles(
    path.join(harness.sitePackages, 'autowsgr-1.0.dist-info'),
    { METADATA: 'old metadata' },
  );
  writeInstalledFiles(
    path.join(harness.sitePackages, 'shared_dependency'),
    { '__init__.py': 'old dependency' },
  );
  await harness.service.prepare(LATEST_COMMIT);
  assert.equal(harness.readState().pending.type, 'full');

  // 安装失败时恢复整个受管环境，并保留暂存。
  const failed = await harness.service.applyFullUpdateWith(async () => {
    writeInstalledFiles(harness.installedDir, { 'main.py': 'broken' });
    fs.rmSync(
      path.join(harness.sitePackages, 'autowsgr-1.0.dist-info'),
      { recursive: true, force: true },
    );
    writeInstalledFiles(
      path.join(harness.sitePackages, 'shared_dependency'),
      { '__init__.py': 'broken dependency' },
    );
    writeInstalledFiles(
      path.join(harness.sitePackages, 'new_dependency'),
      { '__init__.py': 'new dependency' },
    );
    return false;
  });
  assert.equal(failed, false);
  assert.equal(harness.readState().pending === null, false);
  assert.equal(harness.readState().applying, false);
  assert.equal(
    fs.readFileSync(path.join(harness.installedDir, 'main.py'), 'utf-8'),
    'v1',
  );
  assert.equal(
    fs.readFileSync(
      path.join(
        harness.sitePackages,
        'autowsgr-1.0.dist-info',
        'METADATA',
      ),
      'utf-8',
    ),
    'old metadata',
  );
  assert.equal(
    fs.readFileSync(
      path.join(
        harness.sitePackages,
        'shared_dependency',
        '__init__.py',
      ),
      'utf-8',
    ),
    'old dependency',
  );
  assert.equal(
    fs.existsSync(path.join(harness.sitePackages, 'new_dependency')),
    false,
  );

  // 安装成功后更新基线并清理暂存。
  const succeeded = await harness.service.applyFullUpdateWith(async () => {
    writeInstalledFiles(harness.installedDir, { 'main.py': 'v2' });
    return true;
  });
  assert.equal(succeeded, true);
  assert.equal(
    fs.readFileSync(path.join(harness.installedDir, 'main.py'), 'utf-8'),
    'v2',
  );
  const state = harness.readState();
  assert.equal(state.appliedCommit, LATEST_COMMIT);
  assert.equal(state.pending, null);
  assert.equal(fs.existsSync(harness.stagingRoot), false);
}

/** 暂存后切换 Stable 或 external 时不得应用 Alpha 更新。 */
async function testApplyGateAfterSettingsChange() {
  let allowTestUpdates = true;
  let backendStartupMode = 'managed';
  const harness = createService({
    allowTestUpdates: () => allowTestUpdates,
    backendStartupMode: () => backendStartupMode,
    sourceTree: {
      'autowsgr/main.py': 'new',
    },
  });
  writeInstalledFiles(harness.installedDir, { 'main.py': 'old' });
  await harness.service.prepare(LATEST_COMMIT);

  allowTestUpdates = false;
  assert.equal(
    await harness.service.applyPendingUpdate(async () => true),
    false,
  );
  assert.equal(
    fs.readFileSync(path.join(harness.installedDir, 'main.py'), 'utf-8'),
    'old',
  );
  assert.equal(harness.readState().pending.commit, LATEST_COMMIT);

  allowTestUpdates = true;
  backendStartupMode = 'external';
  assert.equal(
    await harness.service.applyPendingUpdate(async () => true),
    false,
  );
  assert.equal(
    fs.readFileSync(path.join(harness.installedDir, 'main.py'), 'utf-8'),
    'old',
  );
}

/** 自动模式检查入口在手动模式下不触发。 */
async function testAutoCheckGating() {
  const manual = createService({ latestCommit: NEWER_COMMIT });
  await manual.service.autoCheckIfEnabled('manual');
  assert.equal(manual.statusEvents.length, 0);
  assert.equal(
    fs.existsSync(manual.statePath),
    false,
    '手动模式不应创建后端更新状态',
  );

  const auto = createService({
    latestCommit: NEWER_COMMIT,
    sourceTree: {
      'autowsgr/main.py': 'v2',
      'pyproject.toml': 'dependencies = ["v1"]',
    },
  });
  writeInstalledFiles(auto.installedDir, { 'main.py': 'v1' });
  await auto.service.autoCheckIfEnabled('auto');
  assert.equal(auto.readState().pending === null, false);

  const failed = createService({
    latestCommit: NEWER_COMMIT,
    downloadArchive: async () => {
      throw new Error('auto download failed');
    },
  });
  await failed.service.autoCheckIfEnabled('auto');
  assert.deepEqual(
    failed.statusEvents[failed.statusEvents.length - 1],
    { status: 'error', message: 'auto download failed' },
  );
}

/** 生命周期入口保留启动增量、退出完整安装的既定分工。 */
async function testLifecycleOrchestration() {
  let incrementalValidationCount = 0;
  let incrementalInstallCount = 0;
  const incremental = createService({
    sourceTree: { 'autowsgr/main.py': 'new' },
    runtime: {
      findPython: async () => 'python',
      validateBackend: async () => {
        incrementalValidationCount += 1;
        return true;
      },
      installArchive: async () => {
        incrementalInstallCount += 1;
        return true;
      },
    },
  });
  writeInstalledFiles(incremental.installedDir, { 'main.py': 'old' });
  await incremental.service.prepare(LATEST_COMMIT);
  await incremental.service.recoverAndApplyOnStartup();
  assert.equal(incrementalValidationCount, 1);
  assert.equal(incrementalInstallCount, 0);
  assert.equal(incremental.readState().appliedCommit, LATEST_COMMIT);

  let fullInstallCount = 0;
  const full = createService({
    comparison: {
      status: 'ahead',
      files: [{ filename: 'pyproject.toml' }],
    },
    sourceTree: { 'autowsgr/main.py': 'new' },
    runtime: {
      findPython: async () => 'python',
      validateBackend: async () => true,
      installArchive: async () => {
        fullInstallCount += 1;
        return true;
      },
    },
  });
  writeInstalledFiles(full.installedDir, { 'main.py': 'old' });
  await full.service.prepare(LATEST_COMMIT);
  await full.service.recoverAndApplyOnStartup();
  assert.equal(fullInstallCount, 0);
  assert.equal(full.readState().pending.type, 'full');
  await full.service.applyBeforeExit();
  assert.equal(fullInstallCount, 1);
  assert.equal(full.readState().appliedCommit, LATEST_COMMIT);
}

/** 下载完成后必须记录“下次启动”或触发立即重启。 */
async function testPreparedRestartChoice() {
  const deferred = createService({
    sourceTree: { 'autowsgr/main.py': 'new' },
    chooseRestartTiming: async () => 'next-launch',
  });
  writeInstalledFiles(deferred.installedDir, { 'main.py': 'old' });
  await deferred.service.prepare(LATEST_COMMIT);
  assert.deepEqual(
    deferred.statusEvents[deferred.statusEvents.length - 1],
    { status: 'deferred', commit: LATEST_COMMIT },
  );

  let restartCount = 0;
  const immediate = createService({
    sourceTree: { 'autowsgr/main.py': 'new' },
    chooseRestartTiming: async () => 'restart',
    restartApplication: () => {
      restartCount += 1;
    },
  });
  writeInstalledFiles(immediate.installedDir, { 'main.py': 'old' });
  await immediate.service.prepare(LATEST_COMMIT);
  assert.equal(restartCount, 1);
}

async function testBackendUpdateService() {
  testDiffBackendPackage();
  testIsSafeRelativePath();
  await testCheckAndBaseline();
  await testBaselineChangesOnlyAfterManagedInstall();
  await testPrepareIncremental();
  await testPrepareFailurePreservesPending();
  await testPrepareQueuesDifferentCommit();
  await testPrepareFullOnPyprojectChange();
  await testPrepareFullOnPyprojectRename();
  await testPrepareFullOnHistoryChange();
  await testPrepareFullWhenComparisonIsMissing();
  await testPrepareFullOnPathShapeChange();
  await testApplyIncremental();
  await testIncrementalRollback();
  await testIncrementalValidationRollback();
  await testLinkedPathIsRejected();
  await testRecoverInterruptedIncremental();
  await testUnsafeRecoveryStateIsRejected();
  await testRecoverInterruptedFull();
  await testExitWaitsForPreparation();
  await testManagedInstallSerializesPreparation();
  await testManagedInstallsAreQueued();
  await testExitWaitsForManagedInstall();
  await testMissingPendingIsPreparedAgain();
  await testApplyFull();
  await testApplyGateAfterSettingsChange();
  await testAutoCheckGating();
  await testLifecycleOrchestration();
  await testPreparedRestartChoice();
}

module.exports = { testBackendUpdateService };
