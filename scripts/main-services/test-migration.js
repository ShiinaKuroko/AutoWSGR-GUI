/**
 * 用户数据和旧计划迁移服务测试。
 *
 * 复用同一隔离临时目录，不读取或修改真实用户数据。
 */
const context = require('./test-context');
const {
  buildLegacyMigrationNotice,
} = require('../../dist/electron/services/LegacyMigrationNotice.js');
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
  TaskPresetCodec,
  ShipLibraryService,
  ShipLibraryUpdater,
  AdbService,
  CudaEnvironmentService,
  GuiConfigurationService,
  PythonEnvironmentService,
  temporaryDirectory,
} = context;

/** 验证旧配置、旧计划和任务组引用迁移保持幂等。 */
function testUserDataMigration() {
  const migrationRoot = path.join(temporaryDirectory, 'migration');
  const projectRoot = path.join(migrationRoot, 'project');
  const moduleDirectory = path.join(projectRoot, 'dist', 'electron');
  const userData = path.join(migrationRoot, 'user-data');
  const appPaths = new AppPaths({
    moduleDirectory,
    isPackaged: () => false,
    getPath: name => name === 'exe'
      ? path.join(projectRoot, 'AutoWSGR.exe')
      : userData,
    getResourcesPath: () => path.join(projectRoot, 'resources'),
  });
  const atomicFiles = new AtomicFileStore();
  const userDataMigration = new UserDataMigrationService(
    appPaths,
    atomicFiles,
  );

  fs.mkdirSync(path.join(projectRoot, 'templates'), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, 'plans'), { recursive: true });
  fs.mkdirSync(
    path.join(projectRoot, 'resource', 'user_battle_plans'),
    { recursive: true },
  );
  fs.mkdirSync(
    path.join(projectRoot, 'resource', 'user_team_plans'),
    { recursive: true },
  );
  fs.mkdirSync(appPaths.userBattlePlansDir(), { recursive: true });
  fs.mkdirSync(appPaths.userTeamPlansDir(), { recursive: true });
  fs.writeFileSync(
    path.join(userData, 'usersettings.yaml'),
    [
      'legacy: false',
      'new_setting: keep',
      'nested:',
      '  new_only: 1',
      '',
    ].join('\n'),
    'utf8',
  );
  fs.writeFileSync(
    path.join(userData, 'gui_settings.json'),
    JSON.stringify({
      legacy: false,
      new_setting: 'keep',
      nested: { new_only: 1 },
    }),
    'utf8',
  );
  fs.writeFileSync(
    path.join(projectRoot, 'usersettings.yaml'),
    [
      'legacy: true',
      'nested:',
      '  old_value: 2',
      '',
    ].join('\n'),
    'utf8',
  );
  fs.writeFileSync(
    path.join(projectRoot, 'gui_settings.json'),
    JSON.stringify({
      legacy: true,
      nested: { old_value: 2 },
    }),
    'utf8',
  );
  fs.writeFileSync(
    path.join(projectRoot, 'templates', 'legacy.json'),
    '{"template":true}',
    'utf8',
  );
  fs.writeFileSync(
    path.join(projectRoot, 'task_groups.json'),
    JSON.stringify({
      rootExtension: { preserved: true },
      groups: [{
        name: 'legacy',
        groupExtension: 'keep',
        items: [{
          path: 'plans/legacy.yaml',
          itemExtension: { preserved: true },
        }],
      }],
    }),
    'utf8',
  );
  fs.writeFileSync(
    path.join(projectRoot, 'plans', 'legacy.yaml'),
    [
      'chapter: 1',
      'map: 2',
      'fleet_presets:',
      '  - name: Legacy Team',
      '    ships:',
      '      - U-47',
      '      - priority: [U-96, U-81]',
      '        ship_type: [ss]',
      '',
    ].join('\n'),
    'utf8',
  );
  fs.writeFileSync(
    path.join(
      projectRoot,
      'resource',
      'user_team_plans',
      'old-reference.yaml',
    ),
    [
      'name: Referenced Team',
      'ships:',
      '  - candidates:',
      '      - name: U-505',
      '',
    ].join('\n'),
    'utf8',
  );
  fs.writeFileSync(
    path.join(
      projectRoot,
      'resource',
      'user_battle_plans',
      'weekly.yml',
    ),
    [
      'chapter: 2',
      'map: 3',
      'fleet_presets:',
      '  - name: Referenced Team',
      '',
    ].join('\n'),
    'utf8',
  );
  const recursivePreset = path.join(
    projectRoot,
    'python',
    'site-packages',
    'autowsgr',
    'data',
    'plan',
    '自动演习.yaml',
  );
  fs.mkdirSync(path.dirname(recursivePreset), { recursive: true });
  fs.writeFileSync(
    recursivePreset,
    'task_type: exercise\nfleet_id: 4\ntimes: 1\n',
    'utf8',
  );
  const unrelatedYaml = path.join(
    projectRoot,
    'python',
    'unrelated.yaml',
  );
  fs.mkdirSync(path.dirname(unrelatedYaml), { recursive: true });
  fs.writeFileSync(unrelatedYaml, 'package: metadata\n', 'utf8');

  const userDataResult = (
    userDataMigration.migrateLegacyUserDataFiles()
  );
  assert.deepEqual(
    {
      total: userDataResult.total,
      succeeded: userDataResult.succeeded,
      failed: userDataResult.failed,
    },
    { total: 4, succeeded: 4, failed: 0 },
  );
  assert.deepEqual(
    yaml.load(
      fs.readFileSync(path.join(userData, 'usersettings.yaml'), 'utf8'),
    ),
    {
      legacy: true,
      new_setting: 'keep',
      nested: {
        new_only: 1,
        old_value: 2,
      },
    },
  );
  assert.deepEqual(
    JSON.parse(
      fs.readFileSync(path.join(userData, 'gui_settings.json'), 'utf8'),
    ),
    {
      legacy: true,
      new_setting: 'keep',
      nested: {
        new_only: 1,
        old_value: 2,
      },
    },
  );
  assert.equal(
    fs.readFileSync(
      path.join(userData, 'templates', 'legacy.json'),
      'utf8',
    ),
    '{"template":true}',
  );
  assert.equal(
    userDataMigration.migrateLegacyUserDataFiles().total,
    0,
  );

  userDataMigration.writeState({
    version: 2,
    completed: [
      `plan:${path.join(projectRoot, 'plans')}:legacy.yaml`,
    ],
  });

  const teamCodec = new TeamPlanCodec();
  const teamRepository = new TeamPlanRepository(
    appPaths,
    atomicFiles,
    teamCodec,
  );
  const combatCodec = new CombatPlanCodec(
    teamCodec,
    teamRepository,
  );
  const combatRepository = new CombatPlanRepository(
    appPaths,
    atomicFiles,
  );
  const taskPresetCodec = new TaskPresetCodec();
  const legacyMigration = new LegacyPlanMigration(
    appPaths,
    atomicFiles,
    userDataMigration,
    {
      yamlFiles: directory => combatRepository.yamlFiles(directory),
      safePlanBaseName: value => combatCodec.safeBaseName(value),
      normalizeUserTeamPlan: raw => teamCodec.normalize(raw),
      teamPlanMatches: (filePath, team) => (
        teamRepository.matches(filePath, team)
      ),
      teamName: team => team.name,
      renameTeam: (team, name) => ({
        ...structuredClone(team),
        name,
      }),
      normalizeCombatPlanFleetPresets: (
        root,
        source,
        requireEmbeddedShips,
      ) => combatCodec.normalizeFleetPresets(
        root,
        source,
        requireEmbeddedShips,
      ),
      buildTeamPlanWrites: (teams, directory) => (
        teamRepository.buildWrites(teams, directory)
      ),
      serializeCombatPlan: (root, originalContent) => (
        combatCodec.serialize(root, originalContent)
      ),
      isStandaloneTaskPreset: root => (
        taskPresetCodec.isStandalone(root)
      ),
      normalizeTaskPreset: root => taskPresetCodec.normalize(root),
    },
  );
  const planResult = legacyMigration.migrate();
  assert.deepEqual(
    {
      total: planResult.total,
      succeeded: planResult.succeeded,
      failed: planResult.failed,
    },
    { total: 4, succeeded: 4, failed: 0 },
  );

  const migratedPlanPath = path.join(
    appPaths.userBattlePlansDir(),
    'bettle-legacy.yaml',
  );
  const migratedTeamPath = path.join(
    appPaths.userTeamPlansDir(),
    'team-Legacy Team.yaml',
  );
  const referencedPlanPath = path.join(
    appPaths.userBattlePlansDir(),
    'bettle-weekly.yaml',
  );
  const referencedTeamPath = path.join(
    appPaths.userTeamPlansDir(),
    'team-Referenced Team.yaml',
  );
  assert.equal(fs.existsSync(migratedPlanPath), true);
  assert.equal(fs.existsSync(migratedTeamPath), true);
  assert.equal(fs.existsSync(referencedPlanPath), true);
  assert.equal(fs.existsSync(referencedTeamPath), true);
  assert.equal(
    fs.existsSync(path.join(
      appPaths.userBattlePlansDir(),
      'bettle-自动演习.yaml',
    )),
    true,
  );
  assert.equal(
    fs.existsSync(path.join(
      appPaths.userBattlePlansDir(),
      'bettle-unrelated.yaml',
    )),
    false,
  );
  assert.deepEqual(
    yaml.load(fs.readFileSync(migratedPlanPath, 'utf8')).fleet_presets,
    [{ name: 'Legacy Team' }],
  );
  assert.deepEqual(
    yaml.load(fs.readFileSync(migratedTeamPath, 'utf8')).ships,
    [
      { name: 'U-47' },
      {
        name: 'U-96',
        ship_type: ['ss'],
        candidates: [{ name: 'U-81', ship_type: ['ss'] }],
      },
    ],
  );
  assert.deepEqual(
    yaml.load(fs.readFileSync(referencedPlanPath, 'utf8')).fleet_presets,
    [{ name: 'Referenced Team' }],
  );
  assert.equal(
    fs.existsSync(path.join(projectRoot, 'plans', 'legacy.yaml')),
    true,
  );
  assert.equal(
    fs.existsSync(path.join(
      projectRoot,
      'resource',
      'user_battle_plans',
      'weekly.yml',
    )),
    true,
  );
  const taskGroups = JSON.parse(
    fs.readFileSync(path.join(userData, 'task_groups.json'), 'utf8'),
  );
  assert.equal(taskGroups.version, 2);
  assert.equal(taskGroups.rootExtension.preserved, true);
  assert.equal(taskGroups.groups[0].groupExtension, 'keep');
  assert.equal(
    taskGroups.groups[0].items[0].itemExtension.preserved,
    true,
  );
  assert.equal(taskGroups.groups[0].items[0].path, 'plans/legacy.yaml');
  assert.equal(taskGroups.groups[0].items[0].managedSource, 'user');
  assert.equal(
    taskGroups.groups[0].items[0].managedFile,
    'bettle-legacy.yaml',
  );
  assert.equal(userDataMigration.readState().version, 5);

  const planBeforeSecondRun = fs.readFileSync(migratedPlanPath, 'utf8');
  assert.equal(legacyMigration.migrate().total, 0);
  assert.equal(
    fs.readFileSync(migratedPlanPath, 'utf8'),
    planBeforeSecondRun,
  );
  testLegacyMigrationNotice();
  testLegacyPlanConflictRetry();
  testExistingUserDataCompatibility();
  testLegacyLootPlanIndexMigration();
}

/** 验证不同旧版本的数字索引都迁移为原地图的稳定文件名。 */
function testLegacyLootPlanIndexMigration() {
  const legacyFivePlanPaths = [
    'resource/builtin_plans/9-4胖次6SS.yaml',
    'resource/builtin_plans/周常9章-9-2.yaml',
    'resource/builtin_plans/周常7章-7-4.yaml',
    'resource/builtin_plans/8-5胖次.yaml',
    'resource/builtin_plans/周常2章-2-1.yaml',
  ];
  const cases = [
    {
      name: 'fallback-four-item-layout',
      index: 2,
      expected: 'bettle-捞胖次-8-5.yaml',
    },
    {
      name: 'installed-five-item-index-zero',
      index: 0,
      planPaths: legacyFivePlanPaths,
      expected: 'bettle-捞胖次-9-4-6SS.yaml',
    },
    {
      name: 'installed-five-item-index-two',
      index: 2,
      planPaths: legacyFivePlanPaths,
      expected: 'bettle-周常-7-4.yaml',
    },
    {
      name: 'installed-template-with-unknown-path',
      index: 0,
      planPaths: ['resource/builtin_plans/未知地图.yaml'],
      expected: 'bettle-周常-9-2.yaml',
      expectedAutoLoot: false,
    },
    {
      name: 'invalid-null-index',
      index: null,
      expected: 'bettle-周常-9-2.yaml',
      expectedAutoLoot: false,
    },
  ];

  for (const migrationCase of cases) {
    const root = path.join(
      temporaryDirectory,
      `loot-index-${migrationCase.name}`,
    );
    const projectRoot = path.join(root, 'project');
    const userData = path.join(root, 'user-data');
    const appPaths = new AppPaths({
      moduleDirectory: path.join(projectRoot, 'dist', 'electron'),
      isPackaged: () => false,
      getPath: name => name === 'exe'
        ? path.join(projectRoot, 'AutoWSGR.exe')
        : userData,
      getResourcesPath: () => path.join(projectRoot, 'resources'),
    });
    const source = path.join(projectRoot, 'usersettings.yaml');
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.writeFileSync(source, [
      'daily_automation:',
      '  auto_loot: true',
      `  loot_plan_index: ${migrationCase.index}`,
      '',
    ].join('\n'), 'utf8');

    if (migrationCase.planPaths) {
      const templateFile = path.join(
        projectRoot,
        'resources',
        'resource',
        'builtin_templates.json',
      );
      fs.mkdirSync(path.dirname(templateFile), { recursive: true });
      fs.writeFileSync(templateFile, JSON.stringify([{
        id: 'builtin_farm_loot',
        planPaths: migrationCase.planPaths,
      }]), 'utf8');
    }

    const migration = new UserDataMigrationService(
      appPaths,
      new AtomicFileStore(),
    );
    const result = migration.migrateLegacyUserDataFiles();
    assert.equal(result.failed, 0);
    const migrated = yaml.load(fs.readFileSync(
      path.join(userData, 'usersettings.yaml'),
      'utf8',
    ));
    assert.equal(
      migrated.daily_automation.loot_plan_id,
      migrationCase.expected,
    );
    assert.equal(
      migrated.daily_automation.auto_loot,
      migrationCase.expectedAutoLoot ?? true,
    );
    assert.equal(
      Object.hasOwn(
        migrated.daily_automation,
        'loot_plan_index',
      ),
      false,
    );
    assert.equal(
      yaml.load(fs.readFileSync(source, 'utf8'))
        .daily_automation.loot_plan_index,
      migrationCase.index,
      '旧安装源配置不应被修改',
    );
  }

  const root = path.join(
    temporaryDirectory,
    'loot-index-already-moved-to-gui-json',
  );
  const projectRoot = path.join(root, 'project');
  const userData = path.join(root, 'user-data');
  const appPaths = new AppPaths({
    moduleDirectory: path.join(projectRoot, 'dist', 'electron'),
    isPackaged: () => false,
    getPath: name => name === 'exe'
      ? path.join(projectRoot, 'AutoWSGR.exe')
      : userData,
    getResourcesPath: () => path.join(projectRoot, 'resources'),
  });
  const source = path.join(projectRoot, 'usersettings.yaml');
  const templateFile = path.join(
    projectRoot,
    'resources',
    'resource',
    'builtin_templates.json',
  );
  const guiSettingsFile = path.join(userData, 'gui_settings.json');
  fs.mkdirSync(path.dirname(templateFile), { recursive: true });
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(source, [
    'daily_automation:',
    '  auto_loot: true',
    '  loot_plan_index: 2',
    '',
  ].join('\n'), 'utf8');
  fs.writeFileSync(templateFile, JSON.stringify([{
    id: 'builtin_farm_loot',
    planPaths: legacyFivePlanPaths,
  }]), 'utf8');
  fs.writeFileSync(guiSettingsFile, JSON.stringify({
    automation: {
      autoLoot: true,
      lootPlanIndex: 2,
    },
  }), 'utf8');

  const migration = new UserDataMigrationService(
    appPaths,
    new AtomicFileStore(),
  );
  assert.equal(migration.migrateLegacyUserDataFiles().failed, 0);
  const migratedGui = JSON.parse(fs.readFileSync(guiSettingsFile, 'utf8'));
  assert.equal(
    migratedGui.automation.lootPlanId,
    'bettle-周常-7-4.yaml',
    '已搬到 GUI JSON 的旧五项索引没有恢复原地图',
  );
  assert.equal(
    Object.hasOwn(migratedGui.automation, 'lootPlanIndex'),
    false,
  );
  migration.migrateLegacyUserDataFiles();
  assert.equal(
    JSON.parse(fs.readFileSync(guiSettingsFile, 'utf8'))
      .automation.lootPlanId,
    'bettle-周常-7-4.yaml',
    '稳定标识不应在再次启动时被重复解释',
  );

  const retryRoot = path.join(
    temporaryDirectory,
    'loot-index-reconcile-retry',
  );
  const retryProjectRoot = path.join(retryRoot, 'project');
  const retryUserData = path.join(retryRoot, 'user-data');
  const retryAppPaths = new AppPaths({
    moduleDirectory: path.join(retryProjectRoot, 'dist', 'electron'),
    isPackaged: () => false,
    getPath: name => name === 'exe'
      ? path.join(retryProjectRoot, 'AutoWSGR.exe')
      : retryUserData,
    getResourcesPath: () => path.join(retryProjectRoot, 'resources'),
  });
  const retryGuiSettings = path.join(
    retryUserData,
    'gui_settings.json',
  );
  const retryTemplate = path.join(
    retryProjectRoot,
    'resources',
    'resource',
    'builtin_templates.json',
  );
  fs.mkdirSync(path.dirname(retryTemplate), { recursive: true });
  fs.mkdirSync(retryUserData, { recursive: true });
  fs.writeFileSync(
    path.join(retryProjectRoot, 'usersettings.yaml'),
    'daily_automation:\n  loot_plan_index: 2\n',
    'utf8',
  );
  fs.writeFileSync(retryTemplate, JSON.stringify([{
    id: 'builtin_farm_loot',
    planPaths: legacyFivePlanPaths,
  }]), 'utf8');
  fs.writeFileSync(retryGuiSettings, JSON.stringify({
    automation: { autoLoot: true, lootPlanIndex: 2 },
  }), 'utf8');

  const realAtomicFiles = new AtomicFileStore();
  let failReconcileWrite = true;
  const retryMigration = new UserDataMigrationService(
    retryAppPaths,
    {
      write(file, content) {
        if (
          failReconcileWrite
          && file === retryGuiSettings
          && content.includes('"lootPlanId"')
        ) {
          failReconcileWrite = false;
          throw new Error('模拟 GUI 索引纠正写入失败');
        }
        realAtomicFiles.write(file, content);
      },
    },
  );
  const originalConsoleError = console.error;
  let migrationFailureLogged = false;
  let failed;
  console.error = (...args) => {
    migrationFailureLogged = String(args[0]).startsWith('[Migration]');
  };
  try {
    failed = retryMigration.migrateLegacyUserDataFiles();
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(failed.failed, 1);
  assert.equal(migrationFailureLogged, true);
  assert.equal(failed.failedFiles.includes(retryGuiSettings), true);
  assert.equal(
    JSON.parse(fs.readFileSync(retryGuiSettings, 'utf8'))
      .automation.lootPlanIndex,
    2,
  );

  const retried = retryMigration.migrateLegacyUserDataFiles();
  assert.equal(retried.failed, 0);
  assert.equal(
    JSON.parse(fs.readFileSync(retryGuiSettings, 'utf8'))
      .automation.lootPlanId,
    'bettle-周常-7-4.yaml',
    '纠正失败后必须在下次启动重试',
  );
}

/** 验证迁移提示展示真实计数、失败文件和源文件保留说明。 */
function testLegacyMigrationNotice() {
  assert.equal(
    buildLegacyMigrationNotice({
      detected: false,
      total: 1,
      succeeded: 1,
      failed: 0,
      failedFiles: [],
    }),
    null,
  );
  assert.equal(
    buildLegacyMigrationNotice({
      detected: true,
      total: 0,
      succeeded: 0,
      failed: 0,
      failedFiles: [],
    }),
    null,
  );
  const successNotice = buildLegacyMigrationNotice({
    detected: true,
    total: 3,
    succeeded: 3,
    failed: 0,
    failedFiles: [],
  });
  assert.ok(successNotice);
  assert.equal(successNotice.type, 'info');
  assert.match(successNotice.message, /成功：3 项/);
  assert.match(successNotice.message, /失败：0 项/);
  const notice = buildLegacyMigrationNotice({
    detected: true,
    total: 5,
    succeeded: 4,
    failed: 1,
    failedFiles: ['C:\\old\\broken.yaml'],
  });
  assert.ok(notice);
  assert.equal(notice.type, 'warning');
  assert.match(notice.message, /当前已迁移旧版数据：5 项/);
  assert.match(notice.message, /成功：4 项/);
  assert.match(notice.message, /失败：1 项/);
  assert.match(notice.detail, /旧版本原始目录/);
  assert.match(notice.detail, /broken\.yaml/);
}

/** 验证同名计划保留为旧版副本，并在下次启动恢复实际引用。 */
function testLegacyPlanConflictRetry() {
  const root = path.join(temporaryDirectory, 'migration-conflict');
  const projectRoot = path.join(root, 'project');
  const userData = path.join(root, 'user-data');
  const appPaths = new AppPaths({
    moduleDirectory: path.join(projectRoot, 'dist', 'electron'),
    isPackaged: () => false,
    getPath: name => name === 'exe'
      ? path.join(projectRoot, 'AutoWSGR.exe')
      : userData,
    getResourcesPath: () => path.join(projectRoot, 'resources'),
  });
  const atomicFiles = new AtomicFileStore();
  const userDataMigration = new UserDataMigrationService(
    appPaths,
    atomicFiles,
  );
  const teamCodec = new TeamPlanCodec();
  const teamRepository = new TeamPlanRepository(
    appPaths,
    atomicFiles,
    teamCodec,
  );
  const combatRepository = new CombatPlanRepository(
    appPaths,
    atomicFiles,
  );
  const combatCodec = new CombatPlanCodec(
    teamCodec,
    teamRepository,
  );
  const migration = new LegacyPlanMigration(
    appPaths,
    atomicFiles,
    userDataMigration,
    {
      yamlFiles: directory => combatRepository.yamlFiles(directory),
      safePlanBaseName: value => combatCodec.safeBaseName(value),
      normalizeUserTeamPlan: raw => teamCodec.normalize(raw),
      teamPlanMatches: (filePath, team) => (
        teamRepository.matches(filePath, team)
      ),
      teamName: team => team.name,
      renameTeam: (team, name) => ({
        ...structuredClone(team),
        name,
      }),
      normalizeCombatPlanFleetPresets: (
        planRoot,
        source,
        requireEmbeddedShips,
      ) => combatCodec.normalizeFleetPresets(
        planRoot,
        source,
        requireEmbeddedShips,
      ),
      buildTeamPlanWrites: (teams, directory) => (
        teamRepository.buildWrites(teams, directory)
      ),
      serializeCombatPlan: (planRoot, originalContent) => (
        combatCodec.serialize(planRoot, originalContent)
      ),
    },
  );
  const source = path.join(projectRoot, 'plans', 'conflict.yaml');
  const target = path.join(
    appPaths.userBattlePlansDir(),
    'bettle-conflict.yaml',
  );
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(source, 'chapter: 1\nmap: 1\n', 'utf8');
  fs.writeFileSync(target, 'chapter: 9\nmap: 9\n', 'utf8');
  fs.writeFileSync(
    path.join(userData, 'task_groups.json'),
    JSON.stringify({
      groups: [{
        name: '旧任务',
        items: [{ path: 'plans/conflict.yaml' }],
      }],
    }),
    'utf8',
  );

  const result = migration.migrate();
  const legacyTarget = path.join(
    appPaths.userBattlePlansDir(),
    'bettle-conflict（旧版）.yaml',
  );
  assert.deepEqual(
    {
      total: result.total,
      succeeded: result.succeeded,
      failed: result.failed,
    },
    { total: 1, succeeded: 1, failed: 0 },
  );
  assert.equal(fs.readFileSync(target, 'utf8'), 'chapter: 9\nmap: 9\n');
  assert.equal(fs.existsSync(source), true);
  assert.equal(yaml.load(fs.readFileSync(legacyTarget, 'utf8')).chapter, 1);
  assert.equal(userDataMigration.readState().version, 5);
  assert.equal(
    userDataMigration.readState().completed.some(
      value => value.startsWith('plan-output-v5:'),
    ),
    true,
  );
  let taskGroups = JSON.parse(
    fs.readFileSync(path.join(userData, 'task_groups.json'), 'utf8'),
  );
  assert.equal(
    taskGroups.groups[0].items[0].managedFile,
    'bettle-conflict（旧版）.yaml',
  );

  assert.equal(migration.migrate().total, 0);
  taskGroups = JSON.parse(
    fs.readFileSync(path.join(userData, 'task_groups.json'), 'utf8'),
  );
  assert.equal(
    taskGroups.groups[0].items[0].managedFile,
    'bettle-conflict（旧版）.yaml',
  );
}

/** 验证已有 userData 时仍会合并另一安装目录的旧队列和计划。 */
function testExistingUserDataCompatibility() {
  const root = path.join(temporaryDirectory, 'migration-existing-data');
  const projectRoot = path.join(root, 'old-install');
  const userData = path.join(root, 'user-data');
  const appPaths = new AppPaths({
    moduleDirectory: path.join(projectRoot, 'dist', 'electron'),
    isPackaged: () => false,
    getPath: name => name === 'exe'
      ? path.join(projectRoot, 'AutoWSGR.exe')
      : userData,
    getResourcesPath: () => path.join(projectRoot, 'resources'),
  });
  const atomicFiles = new AtomicFileStore();
  const userDataMigration = new UserDataMigrationService(
    appPaths,
    atomicFiles,
  );
  const teamCodec = new TeamPlanCodec();
  const teamRepository = new TeamPlanRepository(
    appPaths,
    atomicFiles,
    teamCodec,
  );
  const combatRepository = new CombatPlanRepository(
    appPaths,
    atomicFiles,
  );
  const combatCodec = new CombatPlanCodec(
    teamCodec,
    teamRepository,
  );
  const sourceTaskGroups = path.join(projectRoot, 'task_groups.json');
  const targetTaskGroups = path.join(userData, 'task_groups.json');
  const sourcePlan = path.join(projectRoot, 'plans', 'old.yaml');
  const migratedPlan = path.join(
    appPaths.userBattlePlansDir(),
    'bettle-old.yaml',
  );
  const sourcePlanContent = [
    'chapter: 9',
    'map: 3',
    'fleet_presets:',
    '  - name: Legacy Team',
    '    ships:',
    '      - Old Ship',
    '',
  ].join('\n');

  fs.mkdirSync(path.dirname(sourcePlan), { recursive: true });
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(appPaths.userBattlePlansDir(), { recursive: true });
  fs.mkdirSync(appPaths.userTeamPlansDir(), { recursive: true });
  fs.writeFileSync(sourcePlan, sourcePlanContent, 'utf8');
  const split = combatCodec.normalizeFleetPresets(
    yaml.load(sourcePlanContent),
    'user',
    false,
  );
  fs.writeFileSync(
    migratedPlan,
    combatCodec.serialize(split.mapRoot, sourcePlanContent),
    'utf8',
  );
  const [existingTeam] = teamRepository.buildWrites(
    [{
      name: 'Legacy Team',
      ships: [{ name: 'Current Ship' }],
    }],
    appPaths.userTeamPlansDir(),
  );
  assert.ok(existingTeam);
  fs.writeFileSync(existingTeam.path, existingTeam.content, 'utf8');
  fs.writeFileSync(
    sourceTaskGroups,
    JSON.stringify({
      activeGroup: '默认',
      groups: [
        {
          name: '默认',
          items: [{
            path: 'plans/old.yaml',
            kind: 'plan',
            times: 2,
            label: '旧计划',
          }],
        },
        { name: '决战', items: [] },
      ],
    }),
    'utf8',
  );
  fs.writeFileSync(
    targetTaskGroups,
    JSON.stringify({
      version: 2,
      activeGroup: '默认',
      groups: [{
        name: '默认',
        items: [{
          managedSource: 'system',
          managedFile: 'weekly.yaml',
          kind: 'plan',
          times: 1,
          label: '当前计划',
        }],
      }],
    }),
    'utf8',
  );
  userDataMigration.writeState({
    version: 3,
    completed: ['existing-install-complete'],
  });

  userDataMigration.migrateLegacyUserDataFiles();
  let taskGroups = JSON.parse(
    fs.readFileSync(targetTaskGroups, 'utf8'),
  );
  assert.deepEqual(
    taskGroups.groups.map(group => group.name),
    ['默认', '默认（旧版）', '决战'],
  );
  assert.equal(taskGroups.activeGroup, '默认');

  const migration = new LegacyPlanMigration(
    appPaths,
    atomicFiles,
    userDataMigration,
    {
      yamlFiles: directory => combatRepository.yamlFiles(directory),
      safePlanBaseName: value => combatCodec.safeBaseName(value),
      normalizeUserTeamPlan: raw => teamCodec.normalize(raw),
      teamPlanMatches: (filePath, team) => (
        teamRepository.matches(filePath, team)
      ),
      teamName: team => team.name,
      renameTeam: (team, name) => ({
        ...structuredClone(team),
        name,
      }),
      normalizeCombatPlanFleetPresets: (
        planRoot,
        source,
        requireEmbeddedShips,
      ) => combatCodec.normalizeFleetPresets(
        planRoot,
        source,
        requireEmbeddedShips,
      ),
      buildTeamPlanWrites: (teams, directory) => (
        teamRepository.buildWrites(teams, directory)
      ),
      serializeCombatPlan: (planRoot, originalContent) => (
        combatCodec.serialize(planRoot, originalContent)
      ),
    },
  );
  migration.migrate();

  taskGroups = JSON.parse(fs.readFileSync(targetTaskGroups, 'utf8'));
  const legacyGroup = taskGroups.groups.find(
    group => group.name === '默认（旧版）',
  );
  assert.equal(fs.existsSync(migratedPlan), true);
  assert.equal(fs.existsSync(sourcePlan), true);
  assert.equal(
    legacyGroup.items[0].managedFile,
    'bettle-old.yaml',
  );
  assert.equal(legacyGroup.items[0].managedSource, 'user');
  assert.equal(
    fs.readFileSync(existingTeam.path, 'utf8'),
    existingTeam.content,
  );
  assert.equal(userDataMigration.readState().version, 5);

  userDataMigration.migrateLegacyUserDataFiles();
  migration.migrate();
  taskGroups = JSON.parse(fs.readFileSync(targetTaskGroups, 'utf8'));
  assert.equal(taskGroups.groups.length, 3);
}

module.exports = {
  testUserDataMigration,
};
