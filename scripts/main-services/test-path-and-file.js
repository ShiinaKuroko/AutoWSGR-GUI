/**
 * 路径、文件安全和原子写入服务测试。
 *
 * 复用同一隔离临时目录，不读取或修改真实用户数据。
 */
const context = require('./test-context');
const {
  assert,
  EventEmitter,
  fs,
  os,
  path,
  PassThrough,
  yaml,
  AppPaths,
  AtomicFileStore,
  GuiSettingsStore,
  SafePathService,
  SecureFileService,
  WindowService,
  UserDataMigrationService,
  LegacyPlanMigration,
  TeamPlanCodec,
  TeamPlanRepository,
  TeamPlanService,
  CombatPlanCodec,
  CombatPlanRepository,
  RuntimePlanService,
  PlanManagementService,
  ShipLibraryService,
  ShipLibraryUpdater,
  AdbService,
  CudaEnvironmentService,
  GuiConfigurationService,
  PythonEnvironmentService,
  temporaryDirectory,
} = context;

/** 验证 AppPaths 不依赖真实 Electron app 对象。 */
function testAppPaths() {
  const projectRoot = path.join(temporaryDirectory, 'project');
  const moduleDirectory = path.join(projectRoot, 'dist', 'electron');
  const userData = path.join(temporaryDirectory, 'user-data');
  const executable = path.join(temporaryDirectory, 'install', 'AutoWSGR.exe');
  const resources = path.join(temporaryDirectory, 'install', 'resources');
  const packaged = { value: false };
  const paths = new AppPaths({
    moduleDirectory,
    isPackaged: () => packaged.value,
    getPath: name => name === 'exe' ? executable : userData,
    getResourcesPath: () => resources,
  });
  const safePaths = new SafePathService(paths);

  assert.equal(paths.appRoot(), projectRoot);
  assert.equal(paths.resourceRoot(), projectRoot);
  assert.equal(paths.userDataRoot(), userData);
  assert.equal(
    paths.systemBattlePlansDir(),
    path.join(projectRoot, 'resource', 'system_battle_plans'),
  );
  assert.equal(
    paths.userBattlePlansDir(),
    path.join(userData, 'user_battle_plans'),
  );
  assert.equal(
    paths.systemTeamPlansDir(),
    path.join(projectRoot, 'resource', 'system_team_plans'),
  );
  assert.equal(
    paths.userTeamPlansDir(),
    path.join(userData, 'user_team_plans'),
  );
  assert.equal(
    safePaths.resolveAppPath('usersettings.yaml'),
    path.join(userData, 'usersettings.yaml'),
  );
  assert.equal(
    safePaths.resolveAppPath(path.join(userData, 'absolute.yaml')),
    path.join(userData, 'absolute.yaml'),
  );
  assert.equal(
    safePaths.resolveAppPath(path.join('resource', 'maps', '1.json')),
    path.join(projectRoot, 'resource', 'maps', '1.json'),
  );
  assert.throws(
    () => safePaths.resolveAppPath(''),
    /文件路径不能为空/,
  );
  assert.throws(
    () => safePaths.resolveAppPath(path.join(temporaryDirectory, 'outside.yaml')),
    /文件路径超出应用允许目录/,
  );
  assert.throws(
    () => safePaths.resolveAppPath('nested/../settings.json'),
    /文件路径不允许包含 \.\./,
  );
  assert.throws(
    () => safePaths.resolveAppPath('C:relative.yaml'),
    /不允许使用盘符相对路径/,
  );
  assert.throws(
    () => safePaths.resolveAppPath('Z:\\outside\\plan.yaml'),
    /不允许切换路径根目录|文件路径超出应用允许目录/,
  );
  assert.throws(
    () => safePaths.resolveAppPath('\\\\server\\share\\plan.yaml'),
    /不允许使用 UNC 路径/,
  );

  packaged.value = true;
  assert.equal(paths.appRoot(), path.dirname(executable));
  assert.equal(paths.resourceRoot(), resources);
}

/** 验证文件服务只在允许目录内保存、读取和追加。 */
function testSecureFileService() {
  const userData = path.join(temporaryDirectory, 'secure-user-data');
  const resources = path.join(temporaryDirectory, 'secure-resources');
  const bundledResources = path.join(resources, 'resource');
  const outside = path.join(temporaryDirectory, 'secure-outside');
  fs.mkdirSync(path.join(bundledResources, 'maps'), { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(
    path.join(bundledResources, 'maps', '1.json'),
    '{"map":1}',
    'utf8',
  );
  const appPaths = new AppPaths({
    moduleDirectory: path.join(temporaryDirectory, 'dist', 'electron'),
    isPackaged: () => true,
    getPath: name => name === 'exe'
      ? path.join(temporaryDirectory, 'AutoWSGR.exe')
      : userData,
    getResourcesPath: () => resources,
  });
  const service = new SecureFileService(new SafePathService(appPaths));

  service.save(path.join('nested', 'settings.txt'), 'first');
  assert.equal(
    service.read(path.join('nested', 'settings.txt')),
    'first',
  );
  service.append(path.join('nested', 'settings.txt'), '-second');
  assert.equal(
    service.read(path.join('nested', 'settings.txt')),
    'first-second',
  );
  assert.equal(service.read('missing.txt'), '');
  assert.equal(service.read('resource/maps/1.json'), '{"map":1}');
  assert.throws(
    () => service.save(
      path.join(temporaryDirectory, 'outside.txt'),
      'rejected',
    ),
    /文件路径超出应用允许目录/,
  );
  assert.throws(
    () => service.append(
      path.join(temporaryDirectory, 'outside.log'),
      'rejected',
    ),
    /文件路径超出应用允许目录/,
  );
  assert.throws(
    () => service.save('resource/maps/1.json', 'changed'),
    /安装资源目录为只读/,
  );
  assert.throws(
    () => service.save(
      path.join(bundledResources, 'maps', '1.json'),
      'changed',
    ),
    /文件路径超出应用允许目录/,
  );
  assert.equal(
    fs.readFileSync(path.join(bundledResources, 'maps', '1.json'), 'utf8'),
    '{"map":1}',
  );

  const linkedDirectory = path.join(userData, 'outside-link');
  fs.symlinkSync(
    outside,
    linkedDirectory,
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  assert.throws(
    () => service.save(
      path.join('outside-link', 'escaped.txt'),
      'rejected',
    ),
    /文件路径超出应用允许目录/,
  );
  assert.throws(
    () => service.read(path.join('outside-link', 'secret.txt')),
    /文件路径超出应用允许目录/,
  );
  assert.equal(fs.existsSync(path.join(outside, 'escaped.txt')), false);

  const danglingTarget = path.join(
    temporaryDirectory,
    'secure-dangling-target',
  );
  const danglingLink = path.join(userData, 'dangling-link');
  fs.mkdirSync(danglingTarget, { recursive: true });
  fs.symlinkSync(
    danglingTarget,
    danglingLink,
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  fs.rmSync(danglingTarget, { recursive: true, force: true });
  assert.throws(
    () => service.save(
      path.join('dangling-link', 'escaped.txt'),
      'rejected',
    ),
    /文件路径包含无法解析的符号链接/,
  );
}

/** 验证普通写入、覆盖写入和 Windows 失败回滚。 */
function testAtomicFileStore() {
  const store = new AtomicFileStore();
  const target = path.join(temporaryDirectory, 'atomic.txt');

  store.write(target, 'first');
  assert.equal(fs.readFileSync(target, 'utf8'), 'first');
  store.write(target, 'second');
  assert.equal(fs.readFileSync(target, 'utf8'), 'second');

  if (process.platform === 'win32') {
    const retryTarget = path.join(temporaryDirectory, 'atomic-retry.txt');
    const originalWrite = fs.writeFileSync;
    let writeCall = 0;
    fs.writeFileSync = (...args) => {
      if (
        String(args[0]).startsWith(`${retryTarget}.`)
        && writeCall === 0
      ) {
        writeCall += 1;
        const error = new Error('simulated temporary file lock');
        error.code = 'EPERM';
        throw error;
      }
      writeCall += 1;
      return originalWrite(...args);
    };
    try {
      store.write(retryTarget, 'retry-success');
    } finally {
      fs.writeFileSync = originalWrite;
    }
    assert.equal(writeCall, 2);
    assert.equal(fs.readFileSync(retryTarget, 'utf8'), 'retry-success');

    const originalRename = fs.renameSync;
    let renameCall = 0;
    fs.renameSync = (source, destination) => {
      renameCall += 1;
      if (renameCall === 1 || renameCall === 3) {
        const error = new Error('simulated replacement failure');
        error.code = 'EPERM';
        throw error;
      }
      return originalRename(source, destination);
    };
    try {
      assert.throws(
        () => store.write(target, 'must-not-replace-old-content'),
        /simulated replacement failure/,
      );
    } finally {
      fs.renameSync = originalRename;
    }
    assert.equal(fs.readFileSync(target, 'utf8'), 'second');
  }

  assert.deepEqual(
    fs.readdirSync(temporaryDirectory)
      .filter(name => name.startsWith('atomic.txt.')),
    [],
  );
}

module.exports = {
  testAppPaths,
  testSecureFileService,
  testAtomicFileStore,
};
