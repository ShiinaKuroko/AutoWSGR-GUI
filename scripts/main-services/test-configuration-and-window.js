/**
 * 窗口、设置存储和 GUI 配置服务测试。
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

/** 验证窗口偏好、创建参数和唯一窗口状态。 */
function testWindowService() {
  const settingsPath = path.join(temporaryDirectory, 'window-settings.json');
  const settings = new GuiSettingsStore(() => settingsPath);
  settings.write({
    default_window_width: 400,
    default_window_height: 'invalid',
    remember_window_bounds: true,
    window_bounds: {
      x: 20,
      y: 30,
      width: 1400,
      height: 800,
    },
  });

  let createdOptions = null;
  let loadedFile = null;
  let headersHandler = null;
  let normalBounds = { x: 20, y: 30, width: 1400, height: 800 };
  const windowHandlers = new Map();
  const webContentsHandlers = new Map();
  const fakeWindow = {
    isDestroyed: () => false,
    getNormalBounds: () => normalBounds,
    webContents: {
      session: {
        webRequest: {
          onHeadersReceived: handler => {
            headersHandler = handler;
          },
        },
      },
      on: (event, handler) => {
        webContentsHandlers.set(event, handler);
      },
    },
    loadFile: filePath => {
      loadedFile = filePath;
      return Promise.resolve();
    },
    on: (event, handler) => {
      windowHandlers.set(event, handler);
    },
  };
  const service = new WindowService(settings, {
    backendPort: 18438,
    moduleDirectory: path.join(temporaryDirectory, 'dist', 'electron'),
    createBrowserWindow: options => {
      createdOptions = options;
      return fakeWindow;
    },
    getDisplays: () => [{
      workArea: { x: 0, y: 0, width: 1920, height: 1080 },
    }],
    getAppPath: () => path.join(temporaryDirectory, 'app'),
    isPackaged: () => false,
    resourceRoot: () => path.join(temporaryDirectory, 'resources'),
    showMessageBox: () => {},
  });

  assert.deepEqual(service.getPreferences(), {
    defaultWidth: 854,
    defaultHeight: 720,
    rememberBounds: true,
  });
  service.createWindow();
  assert.equal(createdOptions.width, 1400);
  assert.equal(createdOptions.height, 800);
  assert.equal(createdOptions.x, 20);
  assert.equal(createdOptions.y, 30);
  assert.equal(createdOptions.center, false);
  assert.equal(
    createdOptions.webPreferences.preload,
    path.join(temporaryDirectory, 'dist', 'electron', 'preload.js'),
  );
  assert.equal(
    loadedFile,
    path.join(temporaryDirectory, 'app', 'src', 'view', 'index.html'),
  );
  assert.equal(service.getMainWindow(), fakeWindow);

  let responseHeaders = null;
  headersHandler(
    { responseHeaders: { existing: ['value'] } },
    response => {
      responseHeaders = response.responseHeaders;
    },
  );
  assert.match(
    responseHeaders['Content-Security-Policy'][0],
    /localhost:18438/,
  );

  normalBounds = { x: 40, y: 50, width: 1500, height: 900 };
  windowHandlers.get('close')();
  assert.deepEqual(settings.read().window_bounds, normalBounds);
  windowHandlers.get('closed')();
  assert.equal(service.getMainWindow(), null);

  assert.deepEqual(service.setPreferences({
    defaultWidth: 1440,
    defaultHeight: 810,
    rememberBounds: false,
  }), {
    defaultWidth: 1440,
    defaultHeight: 810,
    rememberBounds: false,
  });
  assert.equal(webContentsHandlers.has('did-fail-load'), true);
}

/** 验证 GUI 设置读取、损坏回退和浅合并格式。 */
function testGuiSettingsStore() {
  const settingsPath = path.join(temporaryDirectory, 'gui_settings.json');
  const store = new GuiSettingsStore(() => settingsPath);

  assert.deepEqual(store.read(), {});
  fs.writeFileSync(settingsPath, '{invalid', 'utf8');
  assert.deepEqual(store.read(), {});

  fs.writeFileSync(
    settingsPath,
    JSON.stringify({
      preserved: 'keep',
      nested: { old: true },
    }),
    'utf8',
  );
  store.write({
    backend_port: 18438,
    nested: { current: true },
  });
  assert.equal(
    fs.readFileSync(settingsPath, 'utf8'),
    JSON.stringify({
      preserved: 'keep',
      nested: { current: true },
      backend_port: 18438,
    }, null, 2),
  );
}

/** 验证 GUI 配置字段保持既有默认值、边界和迁移规则。 */
function testGuiConfigurationService() {
  const settingsPath = path.join(
    temporaryDirectory,
    'gui_configuration.json',
  );
  const store = new GuiSettingsStore(() => settingsPath);
  const environmentPort = { value: undefined };
  let clearPythonCacheCalls = 0;
  const service = new GuiConfigurationService(store, {
    clearPythonCache: () => {
      clearPythonCacheCalls += 1;
    },
    normalizeCudaPath: candidate => candidate.replaceAll('/', '\\'),
    environmentPort: () => environmentPort.value,
  });

  assert.equal(service.backendPort(), 8438);
  service.setBackendPort(18438.9);
  assert.equal(service.backendPort(), 18438);
  service.setBackendPort(0);
  service.setBackendPort(Number.NaN);
  assert.equal(service.backendPort(), 18438);
  environmentPort.value = '28438';
  assert.equal(service.backendPort(), 28438);
  environmentPort.value = undefined;

  assert.equal(service.configuredPythonPath(), null);
  service.setPythonPath('C:\\Python313\\python.exe');
  assert.equal(
    service.configuredPythonPath(),
    'C:\\Python313\\python.exe',
  );
  service.setPythonPath(null);
  assert.equal(service.configuredPythonPath(), null);
  assert.equal(clearPythonCacheCalls, 2);

  assert.equal(service.updateMode(), 'auto');
  service.setUpdateMode('manual');
  assert.equal(service.updateMode(), 'manual');
  service.setUpdateMode('invalid');
  assert.equal(service.updateMode(), 'auto');

  assert.equal(service.backendStartupMode(), 'managed');
  service.setBackendStartupMode('external');
  assert.equal(service.backendStartupMode(), 'external');
  service.setBackendStartupMode('invalid');
  assert.equal(service.backendStartupMode(), 'managed');

  service.setBackendRepoPath('  C:\\AutoWSGR  ');
  assert.equal(service.backendRepoPath(), 'C:\\AutoWSGR');
  service.setBackendRepoPath(null);
  assert.equal(service.backendRepoPath(), '');

  assert.equal(service.ocrGpuMode(), 'auto');
  service.setOcrGpuMode('cuda');
  assert.equal(service.ocrGpuMode(), 'cuda');
  service.setOcrGpuMode('invalid');
  assert.equal(service.ocrGpuMode(), 'auto');

  service.setCudaPath('  C:/CUDA/v12.8  ');
  assert.equal(service.cudaPath(), 'C:\\CUDA\\v12.8');
  service.setCudaPath(null);
  assert.equal(service.cudaPath(), '');

  assert.equal(service.saveBackendScreenshots(), false);
  service.setSaveBackendScreenshots(true);
  assert.equal(service.saveBackendScreenshots(), true);
  service.setSaveBackendScreenshots('true');
  assert.equal(service.saveBackendScreenshots(), false);

  assert.deepEqual(service.automation(), {
    exists: false,
    settings: {},
  });
  store.write({
    automation: {
      expeditionInterval: 20,
      battleTimes: 4,
      autoLoot: true,
      lootPlanIndex: 2,
      lootStopCount: 16,
    },
  });
  assert.deepEqual(service.automation(), {
    exists: true,
    settings: {
      expeditionInterval: 20,
      battleTimes: 4,
      autoLoot: true,
      lootPlanId: 'bettle-周常-8-2.yaml',
      lootStopCount: 16,
    },
  });
  assert.equal(
    Object.hasOwn(store.read().automation, 'lootPlanIndex'),
    false,
  );
  store.write({
    automation: {
      autoLoot: true,
      lootPlanId: 'bettle-不存在.yaml',
    },
  });
  assert.deepEqual(service.automation(), {
    exists: true,
    settings: {
      autoLoot: false,
      lootPlanId: 'bettle-周常-9-2.yaml',
    },
  });
  assert.deepEqual(store.read().automation, {
    autoLoot: false,
    lootPlanId: 'bettle-周常-9-2.yaml',
  });
  for (const invalidIndex of [99, null, '', false, 2.5]) {
    store.write({
      automation: {
        autoLoot: true,
        lootPlanIndex: invalidIndex,
      },
    });
    assert.deepEqual(service.automation(), {
      exists: true,
      settings: {
        autoLoot: false,
        lootPlanId: 'bettle-周常-9-2.yaml',
      },
    });
    assert.equal(
      Object.hasOwn(store.read().automation, 'lootPlanIndex'),
      false,
    );
  }
  store.write({ automation: { autoLoot: true } });
  assert.deepEqual(service.automation(), {
    exists: true,
    settings: {
      autoLoot: false,
      lootPlanId: 'bettle-周常-9-2.yaml',
    },
  });
  assert.deepEqual(service.setAutomation({
    expeditionInterval: 999,
    battleTimes: 0,
    autoLoot: true,
    lootPlanId: 'bettle-捞胖次-8-5.yaml',
    lootStopCount: 0,
  }), {
    expeditionInterval: 120,
    battleTimes: 3,
    autoLoot: true,
    lootPlanId: 'bettle-捞胖次-8-5.yaml',
    lootStopCount: 50,
  });
  assert.deepEqual(service.automation(), {
    exists: true,
    settings: {
      expeditionInterval: 120,
      battleTimes: 3,
      autoLoot: true,
      lootPlanId: 'bettle-捞胖次-8-5.yaml',
      lootStopCount: 50,
    },
  });

  store.write({
    preserved: 'keep',
    decisive_plan: {
      chapter: 9,
      use_quick_repair: false,
      level1: [' A ', 'B', 'C', 'D', 'E', 'F', 'G'],
      level2: ['B', 'H'],
      level3: ['I', 'H'],
    },
  });
  assert.deepEqual(service.decisivePlan(), {
    chapter: 6,
    useQuickRepair: false,
    level1: ['A', 'B', 'C', 'D', 'E', 'F'],
    level2: ['G', 'H', 'I'],
  });
  assert.deepEqual(store.read(), {
    backend_port: 18438,
    python_path: '',
    update_mode: 'auto',
    backend_startup_mode: 'managed',
    backend_repo_path: '',
    ocr_gpu_mode: 'auto',
    cuda_path: '',
    save_backend_screenshots: false,
    automation: {
      expeditionInterval: 120,
      battleTimes: 3,
      autoLoot: true,
      lootPlanId: 'bettle-捞胖次-8-5.yaml',
      lootStopCount: 50,
    },
    preserved: 'keep',
    decisive_plan: {
      chapter: 6,
      use_quick_repair: false,
      level1: ['A', 'B', 'C', 'D', 'E', 'F'],
      level2: ['G', 'H', 'I'],
    },
  });

  fs.rmSync(settingsPath, { force: true });
  const defaults = service.decisivePlan();
  assert.equal(defaults.chapter, 6);
  assert.equal(defaults.useQuickRepair, true);
  assert.equal(defaults.level1.length, 6);
  assert.ok(defaults.level2.length > 0);
}

module.exports = {
  testWindowService,
  testGuiSettingsStore,
  testGuiConfigurationService,
};
