/**
 * 作战计划 Codec、Repository 和 Service 测试。
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
  TaskPresetCodec,
  ShipLibraryService,
  ShipLibraryUpdater,
  AdbService,
  CudaEnvironmentService,
  GuiConfigurationService,
  PythonEnvironmentService,
  temporaryDirectory,
} = context;

/** 验证出征计划格式、运行时展开和管理流程保持既有语义。 */
function testCombatPlanServices() {
  const projectRoot = path.join(temporaryDirectory, 'combat-project');
  const userData = path.join(temporaryDirectory, 'combat-user-data');
  const tempDirectory = path.join(temporaryDirectory, 'combat-temp');
  const appPaths = new AppPaths({
    moduleDirectory: path.join(projectRoot, 'dist', 'electron'),
    isPackaged: () => false,
    getPath: name => name === 'exe'
      ? path.join(projectRoot, 'AutoWSGR.exe')
      : userData,
    getResourcesPath: () => path.join(projectRoot, 'resources'),
  });
  const atomicFiles = new AtomicFileStore();
  const settings = new GuiSettingsStore(
    () => path.join(userData, 'gui_settings.json'),
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
  const runtimePlans = new RuntimePlanService(
    combatCodec,
    combatRepository,
    atomicFiles,
    {
      getTempDirectory: () => tempDirectory,
      processId: 42,
      now: () => 123456,
    },
  );
  const management = new PlanManagementService(
    combatCodec,
    combatRepository,
    runtimePlans,
    teamRepository,
    settings,
    new TaskPresetCodec(),
  );
  combatRepository.initializeSystemDirectory();
  combatRepository.initializeUserDirectory();
  teamRepository.initializeSystemDirectory();
  teamRepository.initializeUserDirectory();

  const split = combatCodec.normalizeFleetPresets({
    chapter: 1,
    map: 2,
    rootExtension: { preserved: true },
    fleet_presets: [{
      name: '内嵌舰队',
      ships: [{
        candidates: [{ name: 'U-47', customCandidate: true }],
      }],
    }],
  }, 'user', true);
  assert.equal(split.mapRoot.rootExtension.preserved, true);
  assert.deepEqual(split.mapRoot.fleet_presets, [{
    name: '内嵌舰队',
  }]);
  assert.equal(split.teams[0].ships[0].name, undefined);
  assert.equal(
    split.teams[0].ships[0].candidates[0].customCandidate,
    true,
  );

  const serialized = combatCodec.serialize(
    split.mapRoot,
    '# 保留注释\nchapter: 1\n',
  );
  assert.match(serialized, /^# 保留注释\n/);
  assert.equal(yaml.load(serialized).rootExtension.preserved, true);
  assert.equal(combatCodec.safeBaseName('bettle-测试?.yaml'), '测试_');

  assert.equal(
    combatRepository.safeUserPath('../outside.yaml'),
    null,
  );
  assert.equal(
    combatRepository.safeManagedPath('user', 'not-yaml.txt'),
    null,
  );
  assert.throws(
    () => runtimePlans.write(
      'chapter: 1\nmap: 2\nfleet_presets:\n  - name: 未展开\n',
      'unexpanded',
    ),
    /运行时出征计划包含尚未展开的舰队引用/,
  );

  const editableContent = [
    '# 编辑器注释',
    'chapter: 1',
    'map: 2',
    'times: 3',
    'selected_nodes: [A, B]',
    'customRoot: keep',
    'fleet_presets:',
    '  - name: 测试舰队',
    '    ships:',
    '      - name: 重庆',
    '        candidates:',
    '          - name: U-47',
    '',
  ].join('\n');
  const saved = management.saveManaged(
    '测试计划',
    editableContent,
    false,
  );
  assert.equal(saved.success, true);
  assert.deepEqual(saved.teamFiles, ['team-测试舰队.yaml']);
  const savedMap = combatRepository.read(saved.path);
  assert.match(savedMap, /^# 编辑器注释\n/);
  assert.equal(yaml.load(savedMap).customRoot, 'keep');
  assert.deepEqual(yaml.load(savedMap).fleet_presets, [{
    name: '测试舰队',
  }]);

  const prepared = management.readManaged(
    'user',
    'bettle-测试计划.yaml',
  );
  assert.equal(prepared.success, true);
  assert.equal(prepared.sourcePath, saved.path);
  assert.match(
    prepared.runtimePath,
    /测试计划-123456-1\.yaml$/,
  );
  assert.equal(
    yaml.load(prepared.content).fleet_presets[0].ships[0].name,
    '重庆',
  );

  const duplicate = management.saveManaged(
    '测试计划',
    editableContent.replace('重庆', '长春'),
    false,
  );
  assert.equal(duplicate.success, false);
  assert.equal(duplicate.exists, true);
  assert.equal(duplicate.error, '存在同名配置');
  assert.deepEqual(duplicate.conflicts, [
    '地图：bettle-测试计划.yaml',
    '舰队：测试舰队',
  ]);

  const localLegacyPlan = path.join(
    temporaryDirectory,
    'local-legacy-plan.yaml',
  );
  const legacyContent = [
    '# 本地旧计划',
    'chapter: 2',
    'map: 3',
    'customRoot: keep',
    'fleet_presets:',
    '  - name: 旧版导入舰队',
    '    ships:',
    '      - U-47',
    '      - priority: [U-96, U-81]',
    '        ship_type: [ss]',
    '      - ship_type: ss',
    '        min_level: 100',
    '',
  ].join('\n');
  fs.writeFileSync(localLegacyPlan, legacyContent, 'utf8');
  const imported = management.importLocal(localLegacyPlan);
  assert.equal(imported.success, true);
  assert.equal(imported.file, 'bettle-local-legacy-plan.yaml');
  assert.equal(fs.readFileSync(localLegacyPlan, 'utf8'), legacyContent);
  assert.deepEqual(
    yaml.load(fs.readFileSync(imported.path, 'utf8')).fleet_presets,
    [{ name: '旧版导入舰队' }],
  );
  const importedTeamPath = path.join(
    appPaths.userTeamPlansDir(),
    'team-旧版导入舰队.yaml',
  );
  assert.deepEqual(
    yaml.load(fs.readFileSync(importedTeamPath, 'utf8')).ships,
    [
      { name: 'U-47' },
      {
        name: 'U-96',
        ship_type: ['ss'],
        candidates: [{ name: 'U-81', ship_type: ['ss'] }],
      },
      {
        ship_type: ['ss'],
        min_level: 100,
      },
    ],
  );

  fs.writeFileSync(
    localLegacyPlan,
    legacyContent.replace('U-47', 'U-505'),
    'utf8',
  );
  const importConflict = management.importLocal(localLegacyPlan);
  assert.equal(importConflict.success, false);
  assert.equal(importConflict.exists, true);
  assert.deepEqual(importConflict.conflicts, [
    '地图：bettle-local-legacy-plan.yaml',
    '舰队：旧版导入舰队',
  ]);
  assert.equal(
    yaml.load(fs.readFileSync(importedTeamPath, 'utf8')).ships[0].name,
    'U-47',
  );
  const importedOverwrite = management.importLocal(
    localLegacyPlan,
    true,
  );
  assert.equal(importedOverwrite.success, true);
  assert.equal(
    yaml.load(fs.readFileSync(importedTeamPath, 'utf8')).ships[0].name,
    'U-505',
  );

  const taskPresetFixtures = [
    {
      file: '战役.yaml',
      type: 'campaign',
      content: 'task_type: campaign\ncampaign_name: 困难航母\ntimes: 8\n',
    },
    {
      file: '自动演习.yaml',
      type: 'exercise',
      content: 'task_type: exercise\nfleet_id: 4\n',
    },
    {
      file: '决战.yaml',
      type: 'decisive',
      content: [
        'task_type: decisive',
        'chapter: 6',
        'level1: [鲃鱼]',
        'level2: [巧言]',
        '',
      ].join('\n'),
    },
  ];
  taskPresetFixtures.forEach((fixture) => {
    const sourcePath = path.join(temporaryDirectory, fixture.file);
    fs.writeFileSync(sourcePath, fixture.content, 'utf8');
    const result = management.importLocal(sourcePath);
    assert.equal(result.success, true);
    assert.equal(result.kind, 'preset');
    assert.equal(fs.readFileSync(sourcePath, 'utf8'), fixture.content);
    const managed = management.readManaged('user', result.file);
    assert.equal(managed.success, true);
    assert.equal(managed.kind, 'preset');
    assert.equal(managed.runtimePath, undefined);
    assert.equal(yaml.load(managed.content).task_type, fixture.type);
    assert.deepEqual(
      management.deleteUserCombat(result.file),
      { success: true },
    );
  });

  assert.deepEqual(
    management.importLocal(path.join(temporaryDirectory, 'plan.txt')),
    { success: false, error: '本地出征计划路径不合法' },
  );
  assert.deepEqual(
    management.deleteUserCombat('bettle-local-legacy-plan.yaml'),
    { success: true },
  );
  assert.deepEqual(
    management.deleteUserTeam('team-旧版导入舰队.yaml'),
    { success: true },
  );

  assert.deepEqual(
    management.setUnlinkedIgnored(
      'battle',
      'user',
      'bettle-测试计划.yaml',
      true,
    ),
    ['battle/user/bettle-测试计划.yaml'],
  );
  const renamed = management.saveManaged(
    '重命名计划',
    [
      'chapter: 1',
      'map: 2',
      'fleet_presets:',
      '  - name: 测试舰队',
      '',
    ].join('\n'),
    false,
    'bettle-测试计划.yaml',
  );
  assert.equal(renamed.success, true);
  assert.equal(combatRepository.exists(saved.path), false);
  assert.deepEqual(
    settings.read().plan_management_ignored_unlinked,
    ['battle/user/bettle-重命名计划.yaml'],
  );

  teamRepository.write(
    path.join(
      appPaths.systemTeamPlansDir(),
      'team-系统舰队.yaml',
    ),
    [
      'name: 系统舰队',
      'ships:',
      '  - name: 系统舰',
      '',
    ].join('\n'),
  );
  combatRepository.write(
    path.join(
      appPaths.systemBattlePlansDir(),
      'bettle-系统计划.yaml',
    ),
    [
      'chapter: 3',
      'map: 4',
      'fleet_presets:',
      '  - name: 系统舰队',
      '',
    ].join('\n'),
  );
  const summary = management.get();
  assert.equal(summary.battlePlans.length, 2);
  const userSummary = summary.battlePlans.find(
    plan => plan.source === 'user',
  );
  const systemSummary = summary.battlePlans.find(
    plan => plan.source === 'system',
  );
  assert.equal(userSummary.name, '重命名计划');
  assert.equal(userSummary.chapter, 1);
  assert.equal(userSummary.map, 2);
  assert.equal(userSummary.fleetCount, 1);
  assert.equal(userSummary.fleets[0].primaryCount, 1);
  assert.equal(userSummary.fleets[0].backupCount, 1);
  assert.equal(systemSummary.name, '系统计划');
  assert.equal(systemSummary.chapter, 3);
  assert.equal(systemSummary.map, 4);
  assert.equal(
    summary.teamPlans.some(plan => plan.source === 'system'),
    true,
  );
  const preparedSystem = management.readManaged(
    'system',
    'bettle-系统计划.yaml',
  );
  assert.equal(preparedSystem.success, true);
  assert.equal(
    yaml.load(preparedSystem.content).fleet_presets[0].ships[0].name,
    '系统舰',
  );

  assert.deepEqual(
    management.deleteUserCombat('bettle-重命名计划.yaml'),
    { success: true },
  );
  assert.deepEqual(
    management.deleteUserTeam('team-测试舰队.yaml'),
    { success: true },
  );
}

module.exports = {
  testCombatPlanServices,
};
