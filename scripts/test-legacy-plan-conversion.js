/**
 * 旧出征计划转换隔离测试。
 *
 * 测试使用临时应用根目录加载已编译主进程，并截获真实 IPC handler。
 * 所有地图、舰队和运行时 YAML 都写入系统临时目录，不接触用户配置。
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const yaml = require('js-yaml');
const {
  app,
  ipcMain,
} = require('electron');

const projectRoot = path.resolve(__dirname, '..');
const fixtureRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), 'autowsgr-plan-conversion-test-'),
);
const compiledElectronDirectory = path.join(
  fixtureRoot,
  'dist',
  'electron',
);

/**
 * 读取一个 YAML 文件并断言根节点为对象。
 *
 * @param {string} filePath YAML 文件路径。
 * @returns {Record<string, any>} YAML 根对象。
 */
function readYaml(filePath) {
  const value = yaml.load(fs.readFileSync(filePath, 'utf8'));
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  return value;
}

/**
 * 写入测试 YAML。
 *
 * @param {string} filePath YAML 文件路径。
 * @param {unknown} value 待序列化内容。
 */
function writeYaml(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    yaml.dump(value, {
      lineWidth: -1,
      noRefs: true,
      sortKeys: false,
    }),
    'utf8',
  );
}

/**
 * 加载主进程模块并收集其 IPC handler，跳过真实窗口和后端初始化。
 *
 * @returns {Map<string, Function>} IPC handler 表。
 */
function captureMainProcessHandlers() {
  const handlers = new Map();
  const originalHandle = ipcMain.handle;
  const originalWhenReady = app.whenReady;
  const originalOn = app.on;
  const neverReady = new Promise(() => {});

  ipcMain.handle = (channel, listener) => {
    handlers.set(channel, listener);
  };
  app.whenReady = () => neverReady;
  app.on = () => app;

  try {
    require(path.join(compiledElectronDirectory, 'main.js'));
  } finally {
    ipcMain.handle = originalHandle;
    app.whenReady = originalWhenReady;
    app.on = originalOn;
  }
  return handlers;
}

/**
 * 运行真实转换、冲突检查和舰队展开链路。
 */
async function run() {
  fs.cpSync(
    path.join(projectRoot, 'dist', 'electron'),
    compiledElectronDirectory,
    { recursive: true },
  );

  process.env.NODE_PATH = [
    path.join(projectRoot, 'node_modules'),
    process.env.NODE_PATH,
  ].filter(Boolean).join(path.delimiter);
  Module.Module._initPaths();

  const handlers = captureMainProcessHandlers();
  const convert = handlers.get('convert-legacy-combat-plan');
  const readManaged = handlers.get('read-managed-combat-plan');
  const readFile = handlers.get('read-combat-plan-file');
  const prepareExecution = handlers.get('prepare-combat-plan-execution');
  assert.equal(typeof convert, 'function');
  assert.equal(typeof readManaged, 'function');
  assert.equal(typeof readFile, 'function');
  assert.equal(typeof prepareExecution, 'function');

  const oldPlanPath = path.join(fixtureRoot, 'legacy-sample.yaml');
  writeYaml(oldPlanPath, {
    chapter: 9,
    map: 2,
    repair_mode: 2,
    fleet_presets: [
      {
        name: 'Alpha',
        ships: [
          'U-47',
          {
            name: 'U-96',
            candidates: [
              'U-81',
              { name: 'U-505', min_level: 10 },
            ],
          },
          {
            priority: ['M-296', '鹦鹉螺'],
            ship_type: ['ss'],
          },
        ],
      },
      {
        name: 'Beta',
        ships: [
          {
            candidates: [
              { name: 'IIIA' },
              { name: 'K-21' },
            ],
          },
        ],
      },
    ],
  });

  const converted = await convert({}, false, oldPlanPath);
  assert.equal(converted.success, true);
  assert.equal(converted.file, 'bettle-legacy-sample.yaml');
  assert.deepEqual(
    converted.teamFiles,
    ['team-Alpha.yaml', 'team-Beta.yaml'],
  );

  const userBattleDirectory = path.join(
    fixtureRoot,
    'resource',
    'user_battle_plans',
  );
  const userTeamDirectory = path.join(
    fixtureRoot,
    'resource',
    'user_team_plans',
  );
  const systemTeamDirectory = path.join(
    fixtureRoot,
    'resource',
    'system_team_plans',
  );
  const convertedMapPath = path.join(
    userBattleDirectory,
    converted.file,
  );

  const storedMap = readYaml(convertedMapPath);
  assert.equal(storedMap.chapter, 9);
  assert.equal(storedMap.map, 2);
  assert.equal(storedMap.repair_mode, 2);
  assert.deepEqual(storedMap.fleet_presets, [
    { name: 'Alpha' },
    { name: 'Beta' },
  ]);

  const alphaTeam = readYaml(
    path.join(userTeamDirectory, 'team-Alpha.yaml'),
  );
  assert.deepEqual(alphaTeam, {
    name: 'Alpha',
    ships: [
      { name: 'U-47' },
      {
        name: 'U-96',
        candidates: [
          { name: 'U-81' },
          { name: 'U-505', min_level: 10 },
        ],
      },
      {
        name: 'M-296',
        ship_type: ['ss'],
        candidates: [
          { name: '鹦鹉螺', ship_type: ['ss'] },
        ],
      },
    ],
  });
  const betaTeam = readYaml(
    path.join(userTeamDirectory, 'team-Beta.yaml'),
  );
  assert.deepEqual(betaTeam, {
    name: 'Beta',
    ships: [
      {
        candidates: [
          { name: 'IIIA' },
          { name: 'K-21' },
        ],
      },
    ],
  });

  writeYaml(
    path.join(systemTeamDirectory, 'team-Alpha.yaml'),
    {
      name: 'Alpha',
      ships: [{ name: '系统同名舰船' }],
    },
  );
  const loaded = await readManaged({}, 'user', converted.file);
  assert.equal(loaded.success, true);
  assert.equal(loaded.sourcePath, convertedMapPath);
  assert.notEqual(loaded.runtimePath, convertedMapPath);
  assert.equal(fs.existsSync(loaded.runtimePath), true);

  const loadedPlan = yaml.load(loaded.content);
  assert.equal(
    loadedPlan.fleet_presets[0].ships[0].name,
    'U-47',
  );
  assert.deepEqual(
    readYaml(convertedMapPath).fleet_presets,
    [{ name: 'Alpha' }, { name: 'Beta' }],
  );
  const runtimePlan = readYaml(loaded.runtimePath);
  assert.ok(
    runtimePlan.fleet_presets.every(
      preset => Array.isArray(preset.ships),
    ),
  );

  const readByPath = await readFile({}, convertedMapPath);
  assert.equal(readByPath.success, true);
  assert.equal(readByPath.sourcePath, convertedMapPath);
  assert.notEqual(readByPath.runtimePath, convertedMapPath);
  assert.equal(
    yaml.load(readByPath.content).fleet_presets[0].ships[0].name,
    'U-47',
  );

  writeYaml(
    path.join(systemTeamDirectory, 'team-Embedded.yaml'),
    {
      name: 'Embedded',
      ships: [{ name: '系统内嵌同名舰船' }],
    },
  );
  writeYaml(
    path.join(userBattleDirectory, 'bettle-embedded.yaml'),
    {
      chapter: 1,
      map: 1,
      fleet_presets: [
        {
          name: 'Embedded',
          ships: [{ name: '地图内嵌舰船' }],
        },
      ],
    },
  );
  const embedded = await readManaged(
    {},
    'user',
    'bettle-embedded.yaml',
  );
  assert.equal(embedded.success, true);
  assert.equal(
    yaml.load(embedded.content).fleet_presets[0].ships[0].name,
    '地图内嵌舰船',
  );

  writeYaml(
    path.join(systemTeamDirectory, 'team-SystemOnly.yaml'),
    {
      name: 'SystemOnly',
      ships: [{ name: '系统回退舰船' }],
    },
  );
  writeYaml(
    path.join(userBattleDirectory, 'bettle-system-fallback.yaml'),
    {
      chapter: 1,
      map: 2,
      fleet_presets: [{ name: 'SystemOnly' }],
    },
  );
  const crossSource = await readManaged(
    {},
    'user',
    'bettle-system-fallback.yaml',
  );
  assert.equal(crossSource.success, true);
  assert.equal(
    yaml.load(crossSource.content).fleet_presets[0].ships[0].name,
    '系统回退舰船',
  );

  const conflict = await convert({}, false, oldPlanPath);
  assert.equal(conflict.success, false);
  assert.equal(conflict.exists, true);
  assert.deepEqual(conflict.conflicts, [
    '地图：bettle-legacy-sample.yaml',
    '舰队：Alpha',
    '舰队：Beta',
  ]);
  const overwritten = await convert({}, true, oldPlanPath);
  assert.equal(overwritten.success, true);

  const rejectedReference = await prepareExecution(
    {},
    yaml.dump({
      chapter: 9,
      map: 2,
      fleet_presets: [{ name: 'Alpha' }],
    }),
    'unexpanded',
  );
  assert.equal(rejectedReference.success, false);
  assert.match(
    rejectedReference.error,
    /尚未展开的舰队引用/,
  );

  const directRuntime = await prepareExecution(
    {},
    loaded.content,
    'expanded',
  );
  assert.equal(directRuntime.success, true);
  assert.equal(fs.existsSync(directRuntime.path), true);

  return {
    convertedTeams: converted.teamFiles.length,
    mapReferences: storedMap.fleet_presets.length,
    runtimeFleets: runtimePlan.fleet_presets.length,
    conflicts: conflict.conflicts.length,
  };
}

run()
  .then((result) => {
    console.log(
      [
        '旧计划转换测试通过',
        `拆分舰队 ${result.convertedTeams}`,
        `地图关联 ${result.mapReferences}`,
        `运行时舰队 ${result.runtimeFleets}`,
        `冲突项 ${result.conflicts}`,
      ].join(' | '),
    );
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
    app.exit(1);
  });
