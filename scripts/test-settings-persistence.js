/**
 * 设置页持久化隔离测试。
 *
 * 测试流程：
 * 1. 使用隐藏的 Electron BrowserWindow 加载真实设置页 HTML。
 * 2. 拦截正式 renderer bundle，避免启动应用和后端。
 * 3. 实例化真实 ConfigView、ConfigModel 和 ConfigController。
 * 4. 向所有可保存表单字段写入一组测试值。
 * 5. 验证 ConfigView 渲染和收集结果完全一致。
 * 6. 通过模拟 Electron Bridge 执行真实控制器保存逻辑。
 * 7. 将 YAML 和 GUI JSON 写入系统临时目录。
 * 8. 从磁盘重新读取并验证全部字段。
 * 9. 验证主题、主色调和调试模式的 localStorage 写入。
 * 10. 验证非法延迟区间会被表单校验拒绝。
 * 11. 测试过程不读取或修改项目中的真实用户配置。
 * 12. 完成后删除临时目录并清理测试会话数据。
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  app,
  BrowserWindow,
  session,
} = require('electron');

app.commandLine.appendSwitch('disable-gpu');

const projectRoot = path.resolve(__dirname, '..');
const temporaryDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), 'autowsgr-settings-test-'),
);

/**
 * 在真实设置页 DOM 中执行设置保存测试。
 *
 * @param {string} root 项目根目录。
 * @param {string} tempDirectory 隔离配置输出目录。
 * @returns {Promise<Record<string, number>>} 测试覆盖统计。
 */
async function runRendererTest(root, tempDirectory) {
  const rendererAssert = require('node:assert/strict');
  const rendererFs = require('node:fs');
  const rendererPath = require('node:path');
  const yaml = require('js-yaml');
  const {
    ConfigView,
  } = require(rendererPath.join(
    root,
    'dist/src/view/config/ConfigView.js',
  ));
  const {
    ConfigModel,
  } = require(rendererPath.join(
    root,
    'dist/src/model/ConfigModel.js',
  ));
  const {
    ConfigController,
  } = require(rendererPath.join(
    root,
    'dist/src/controller/app/ConfigController.js',
  ));

  const shipNameAliases = {
    测试别名: 'U-47',
  };
  const shipNameCorrections = {
    测试错字: 'U-81',
  };
  const sample = {
    emulatorType: '蓝叠',
    emulatorPath: 'C:\\SettingsTest\\Emulator.exe',
    emulatorSerial: '127.0.0.1:26555',
    gameApp: '小米',
    updateMode: 'manual',
    autoExpedition: false,
    expeditionInterval: 23,
    autoBattle: true,
    battleType: '困难航母',
    autoExercise: true,
    exerciseFleetId: 3,
    battleTimes: 7,
    autoNormalFight: true,
    normalFightTasks: [
      {
        name: 'C:\\SettingsTest\\battle.yaml',
        fleet_id: 3,
        fleet_preset_index: 1,
        times: 2,
      },
    ],
    autoLoot: true,
    lootPlanIndex: 2,
    lootStopCount: 17,
    logLevel: 'WARNING',
    logRoot: 'C:\\SettingsTest\\logs',
    themeMode: 'light',
    accentColor: '#123456',
    debugMode: true,
    backendPort: 18438,
    backendStartupMode: 'external',
    backendRepoPath: 'C:\\SettingsTest\\AutoWSGR',
    ocrGpuMode: 'cuda',
    ocrGpu: true,
    ocrMirror: 'github',
    ocrConfidence: 0.73,
    shipNameAliasesText: '测试别名: U-47',
    shipNameCorrectionsText: '测试错字: U-81',
    cudaPath: 'C:\\SettingsTest\\CUDA',
    saveBackendScreenshots: true,
    pythonPath: 'C:\\SettingsTest\\python.exe',
    defaultWindowWidth: 1440,
    defaultWindowHeight: 810,
    rememberWindowBounds: true,
    operationDelayMin: 0.4,
    operationDelayMax: 1.6,
    dockFullDestroy: false,
    repairManually: true,
    bathroomCount: 6,
    destroyShipWorkMode: 2,
    destroyShipTypes: ['驱逐', '潜艇'],
    removeEquipmentMode: false,
    planRoot: 'C:\\SettingsTest\\plans',
  };

  const view = new ConfigView();
  view.render(sample);

  const collected = view.collect();
  rendererAssert.deepStrictEqual(
    collected,
    sample,
    '设置页渲染后收集的数据与输入不一致',
  );

  const delayMinimum = document.getElementById('cfg-delay-min');
  const delayMaximum = document.getElementById('cfg-delay-max');
  delayMinimum.value = '2';
  delayMaximum.value = '1';
  rendererAssert.throws(
    () => view.collect(),
    /最小值不能大于最大值/,
    '非法延迟区间未被拦截',
  );
  view.render(sample);

  const model = new ConfigModel();
  model.loadFromYaml([
    'emulator:',
    '  type: 雷电',
    '  backend_options:',
    '    transport:',
    '      retry: 7',
    'account:',
    '  game_app: 官服',
    '  backend_identity:',
    '    region:',
    '      code: cn',
    'ocr:',
    '  ship_name_corrections:',
    '    stale_correction: stale',
    '    backend_metadata:',
    '      source: backend',
    '  ship_name_aliases:',
    '    stale_alias: stale',
    '    backend_metadata:',
    '      source: backend',
    '  backend_options:',
    '    detector:',
    '      timeout: 30',
    'log:',
    '  channels:',
    '    stale.channel: DEBUG',
    '    backend_metadata:',
    '      sink:',
    '        name: audit',
    '  backend_options:',
    '    rotation:',
    '      compress: true',
    'daily_automation:',
    '  auto_gain_bonus: true',
    '  auto_bath_repair: true',
    '  backend_options:',
    '    scheduler:',
    '      jitter: 3',
    'custom_unknown:',
    '  keep: true',
    '',
  ].join('\n'));

  const guiSettings = {
    preserved_key: 'keep',
  };
  const writeGuiSettings = patch => {
    Object.assign(guiSettings, patch);
    rendererFs.writeFileSync(
      rendererPath.join(tempDirectory, 'gui_settings.json'),
      JSON.stringify(guiSettings, null, 2),
      'utf8',
    );
  };

  window.electronBridge = {
    saveFile: async (name, content) => {
      rendererFs.writeFileSync(
        rendererPath.join(tempDirectory, name),
        content,
        'utf8',
      );
    },
    setGuiAutomationSettings: async settings => {
      writeGuiSettings({
        automation: structuredClone(settings),
      });
      return settings;
    },
    setBackendPort: async backendPort => {
      writeGuiSettings({
        backend_port: backendPort,
      });
    },
    setBackendStartupMode: async mode => {
      writeGuiSettings({
        backend_startup_mode: mode,
      });
    },
    setBackendRepoPath: async repoPath => {
      writeGuiSettings({
        backend_repo_path: repoPath ?? '',
      });
    },
    setOcrGpuMode: async mode => {
      writeGuiSettings({
        ocr_gpu_mode: mode,
      });
    },
    setCudaPath: async cudaPath => {
      writeGuiSettings({
        cuda_path: cudaPath ?? '',
      });
    },
    setSaveBackendScreenshots: async enabled => {
      writeGuiSettings({
        save_backend_screenshots: enabled === true,
      });
    },
    setPythonPath: async pythonPath => {
      writeGuiSettings({
        python_path: pythonPath ?? '',
      });
    },
    setUpdateMode: async mode => {
      writeGuiSettings({
        update_mode: mode,
      });
    },
    setWindowPreferences: async preferences => {
      writeGuiSettings({
        default_window_width: preferences.defaultWidth,
        default_window_height: preferences.defaultHeight,
        remember_window_bounds: preferences.rememberBounds,
      });
      return preferences;
    },
  };

  const host = {
    configModel: model,
    configView: view,
    setupView: {},
    mainView: {
      setDebugMode: () => {},
    },
    scheduler: {
      status: 'connected',
      setAutoExpedition: () => {},
      setExpeditionInterval: () => {},
    },
    cronScheduler: {
      updateConfig: () => {},
    },
    templateCtrl: {},
    startupCtrl: {
      startSystem: () => {},
    },
    configDir: tempDirectory,
  };

  const controller = new ConfigController(host);
  await controller.saveConfig();

  const savedYaml = yaml.load(rendererFs.readFileSync(
    rendererPath.join(tempDirectory, 'usersettings.yaml'),
    'utf8',
  ));
  const savedGui = JSON.parse(rendererFs.readFileSync(
    rendererPath.join(tempDirectory, 'gui_settings.json'),
    'utf8',
  ));

  rendererAssert.deepStrictEqual(savedYaml.emulator, {
    type: sample.emulatorType,
    path: sample.emulatorPath,
    serial: sample.emulatorSerial,
    backend_options: {
      transport: {
        retry: 7,
      },
    },
  });
  rendererAssert.deepStrictEqual(savedYaml.account, {
    game_app: sample.gameApp,
    backend_identity: {
      region: {
        code: 'cn',
      },
    },
  });
  rendererAssert.deepStrictEqual(savedYaml.daily_automation, {
    auto_expedition: sample.autoExpedition,
    auto_battle: sample.autoBattle,
    battle_type: sample.battleType,
    auto_exercise: sample.autoExercise,
    exercise_fleet_id: sample.exerciseFleetId,
    auto_normal_fight: sample.autoNormalFight,
    auto_gain_bonus: true,
    auto_bath_repair: true,
    auto_set_support: false,
    bath_repair_blacklist: [],
    normal_fight_tasks: sample.normalFightTasks,
    stop_max_ship: false,
    stop_max_loot: false,
    backend_options: {
      scheduler: {
        jitter: 3,
      },
    },
  });
  rendererAssert.deepStrictEqual(savedYaml.ocr, {
    gpu: sample.ocrGpu,
    mirror: sample.ocrMirror,
    ship_name_match_confidence: sample.ocrConfidence,
    ship_name_corrections: {
      ...shipNameCorrections,
      backend_metadata: {
        source: 'backend',
      },
    },
    ship_name_aliases: {
      ...shipNameAliases,
      backend_metadata: {
        source: 'backend',
      },
    },
    backend_options: {
      detector: {
        timeout: 30,
      },
    },
  });
  rendererAssert.deepStrictEqual(savedYaml.log, {
    level: sample.logLevel,
    root: sample.logRoot,
    channels: {
      'stale.channel': 'DEBUG',
      backend_metadata: {
        sink: {
          name: 'audit',
        },
      },
    },
    backend_options: {
      rotation: {
        compress: true,
      },
    },
  });
  rendererAssert.equal(
    savedYaml.operation_delay_min,
    sample.operationDelayMin,
  );
  rendererAssert.equal(
    savedYaml.operation_delay_max,
    sample.operationDelayMax,
  );
  rendererAssert.equal(
    savedYaml.dock_full_destroy,
    sample.dockFullDestroy,
  );
  rendererAssert.equal(
    savedYaml.repair_manually,
    sample.repairManually,
  );
  rendererAssert.equal(
    savedYaml.bathroom_count,
    sample.bathroomCount,
  );
  rendererAssert.equal(
    savedYaml.destroy_ship_work_mode,
    sample.destroyShipWorkMode,
  );
  rendererAssert.deepStrictEqual(
    savedYaml.destroy_ship_types,
    sample.destroyShipTypes,
  );
  rendererAssert.equal(
    savedYaml.remove_equipment_mode,
    sample.removeEquipmentMode,
  );
  rendererAssert.equal(savedYaml.plan_root, sample.planRoot);
  rendererAssert.deepStrictEqual(savedYaml.custom_unknown, {
    keep: true,
  });

  rendererAssert.deepStrictEqual(savedGui.automation, {
    expeditionInterval: sample.expeditionInterval,
    battleTimes: sample.battleTimes,
    autoLoot: sample.autoLoot,
    lootPlanIndex: sample.lootPlanIndex,
    lootStopCount: sample.lootStopCount,
  });
  rendererAssert.equal(savedGui.backend_port, sample.backendPort);
  rendererAssert.equal(
    savedGui.backend_startup_mode,
    sample.backendStartupMode,
  );
  rendererAssert.equal(
    savedGui.backend_repo_path,
    sample.backendRepoPath,
  );
  rendererAssert.equal(savedGui.ocr_gpu_mode, sample.ocrGpuMode);
  rendererAssert.equal(savedGui.cuda_path, sample.cudaPath);
  rendererAssert.equal(
    savedGui.save_backend_screenshots,
    sample.saveBackendScreenshots,
  );
  rendererAssert.equal(savedGui.python_path, sample.pythonPath);
  rendererAssert.equal(savedGui.update_mode, sample.updateMode);
  rendererAssert.equal(
    savedGui.default_window_width,
    sample.defaultWindowWidth,
  );
  rendererAssert.equal(
    savedGui.default_window_height,
    sample.defaultWindowHeight,
  );
  rendererAssert.equal(
    savedGui.remember_window_bounds,
    sample.rememberWindowBounds,
  );
  rendererAssert.equal(savedGui.preserved_key, 'keep');

  rendererAssert.equal(
    localStorage.getItem('themeMode'),
    sample.themeMode,
  );
  rendererAssert.equal(
    localStorage.getItem('accentColor'),
    sample.accentColor,
  );
  rendererAssert.equal(
    localStorage.getItem('debugMode'),
    String(sample.debugMode),
  );
  rendererAssert.equal(
    localStorage.getItem('updateMode'),
    sample.updateMode,
  );

  const controlIds = Array.from(document.querySelectorAll(
    '[data-config-panel] input[id], '
      + '[data-config-panel] select[id], '
      + '[data-config-panel] textarea[id]',
  ))
    .filter(element => !element.closest('[aria-hidden="true"]'))
    .map(element => element.id);
  const expectedControlIds = [
    'cfg-emu-type',
    'cfg-emu-path',
    'cfg-emu-serial',
    'cfg-game-app',
    'cfg-auto-expedition',
    'cfg-auto-battle',
    'cfg-battle-type',
    'cfg-auto-exercise',
    'cfg-exercise-fleet',
    'cfg-auto-normal-fight',
    'cfg-auto-loot',
    'cfg-loot-plan',
    'cfg-loot-stop-count',
    'cfg-log-level',
    'cfg-log-root',
    'cfg-debug-mode',
    'cfg-python-path',
    'cfg-backend-port',
    'cfg-save-backend-screenshots',
    'cfg-use-external-backend',
    'cfg-backend-repo-path',
    'cfg-window-width',
    'cfg-window-height',
    'cfg-remember-window-bounds',
    'cfg-update-mode',
    'cfg-theme-mode',
    'cfg-accent-color',
    'cfg-delay-min-range',
    'cfg-delay-min',
    'cfg-delay-max-range',
    'cfg-delay-max',
    'cfg-ocr-mirror',
    'cfg-ocr-gpu-mode',
    'cfg-cuda-path',
    'cfg-ocr-gpu',
    'cfg-ocr-confidence-range',
    'cfg-ocr-confidence',
    'cfg-ship-name-aliases',
    'cfg-ship-name-corrections',
    'cfg-dock-full-destroy',
    'cfg-repair-manually',
    'cfg-bathroom-count',
    'cfg-destroy-ship-mode',
    'cfg-remove-equipment-mode',
    'cfg-plan-root',
  ];
  rendererAssert.deepStrictEqual(
    [...controlIds].sort(),
    [...expectedControlIds].sort(),
    '设置页出现未纳入测试的表单控件',
  );

  return {
    viewFields: Object.keys(collected).length,
    visibleControls: controlIds.length,
    yamlTopLevelFields: Object.keys(savedYaml).length,
    guiTopLevelFields: Object.keys(savedGui).length,
  };
}

async function main() {
  await app.whenReady();

  const testSession = session.fromPartition(
    `settings-persistence-test-${Date.now()}`,
  );
  testSession.webRequest.onBeforeRequest(
    {
      urls: ['file:///*'],
    },
    (details, callback) => {
      callback({
        cancel: details.url.endsWith('/dist/renderer.bundle.js'),
      });
    },
  );

  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
      session: testSession,
    },
  });
  await window.loadFile(
    path.join(projectRoot, 'src/view/index.html'),
  );

  const expression = `(${runRendererTest.toString()})(`
    + `${JSON.stringify(projectRoot)},`
    + `${JSON.stringify(temporaryDirectory)})`;
  const result = await window.webContents.executeJavaScript(expression);

  assert.equal(
    fs.existsSync(path.join(temporaryDirectory, 'usersettings.yaml')),
    true,
  );
  assert.equal(
    fs.existsSync(path.join(temporaryDirectory, 'gui_settings.json')),
    true,
  );
  console.log(`设置页隔离持久化测试通过: ${JSON.stringify(result)}`);

  window.destroy();
  await testSession.clearStorageData();
}

main()
  .then(() => {
    fs.rmSync(temporaryDirectory, {
      force: true,
      recursive: true,
    });
    app.exit(0);
  })
  .catch(error => {
    console.error(error);
    fs.rmSync(temporaryDirectory, {
      force: true,
      recursive: true,
    });
    app.exit(1);
  });
