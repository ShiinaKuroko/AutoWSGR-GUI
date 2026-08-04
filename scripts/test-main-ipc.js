/**
 * Electron 主进程 IPC 契约测试。
 *
 * 测试流程：
 * 1. 加载不依赖 Electron 运行时的 IPC Adapter。
 * 2. 使用内存注册器收集 handle 和 on 通道。
 * 3. 拒绝 Adapter 之间的重复通道注册。
 * 4. 从 UpdaterIpc 源码收集三个更新通道。
 * 5. 从 preload 源码收集 invoke 和 sendSync 通道。
 * 6. 验证所有 sendSync 通道仍由 ipcMain.on 注册。
 * 7. 验证所有启用的 invoke 通道仍由 ipcMain.handle 注册。
 * 8. 验证主进程没有 preload 未暴露的额外业务通道。
 * 9. 测试不启动 Electron，也不访问真实用户数据。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  registerBackendIpc,
} = require('../dist/electron/ipc/BackendIpc.js');
const {
  registerCombatPlanIpc,
} = require('../dist/electron/ipc/CombatPlanIpc.js');
const {
  registerConfigurationIpc,
} = require('../dist/electron/ipc/ConfigurationIpc.js');
const {
  registerDeviceIpc,
} = require('../dist/electron/ipc/DeviceIpc.js');
const {
  registerDailyPlanIpc,
} = require('../dist/electron/ipc/DailyPlanIpc.js');
const {
  registerEnvironmentIpc,
} = require('../dist/electron/ipc/EnvironmentIpc.js');
const {
  registerFileIpc,
} = require('../dist/electron/ipc/FileIpc.js');
const {
  registerMigrationConflictIpc,
} = require('../dist/electron/ipc/MigrationConflictIpc.js');
const {
  registerShipLibraryIpc,
} = require('../dist/electron/ipc/ShipLibraryIpc.js');
const {
  registerTeamPlanIpc,
} = require('../dist/electron/ipc/TeamPlanIpc.js');

class MemoryIpcRegistrar {
  constructor() {
    this.handles = new Map();
    this.listeners = new Map();
  }

  handle(channel, listener) {
    assert.equal(
      this.handles.has(channel) || this.listeners.has(channel),
      false,
      `重复 IPC 通道: ${channel}`,
    );
    this.handles.set(channel, listener);
  }

  on(channel, listener) {
    assert.equal(
      this.handles.has(channel) || this.listeners.has(channel),
      false,
      `重复 IPC 通道: ${channel}`,
    );
    this.listeners.set(channel, listener);
    return this;
  }
}

/** 从 TypeScript 源码提取指定调用的字符串通道。 */
function sourceChannels(source, expression) {
  const channels = [];
  const pattern = new RegExp(
    `${expression}\\(\\s*['"]([^'"]+)['"]`,
    'g',
  );
  for (const match of source.matchAll(pattern)) {
    channels.push(match[1]);
  }
  return channels;
}

/** 返回排序后的集合差异。 */
function difference(left, right) {
  return [...left]
    .filter(value => !right.has(value))
    .sort();
}

const ipc = new MemoryIpcRegistrar();
registerFileIpc(ipc, {});
registerMigrationConflictIpc(ipc, {});
registerDeviceIpc(ipc, {});
registerDailyPlanIpc(ipc, {});
registerConfigurationIpc(ipc, {});
registerEnvironmentIpc(ipc, {});
registerTeamPlanIpc(ipc, {});
registerCombatPlanIpc(ipc, {});
registerShipLibraryIpc(ipc, {});
registerBackendIpc(ipc, {});

const projectRoot = path.resolve(__dirname, '..');
const preloadSource = fs.readFileSync(
  path.join(projectRoot, 'electron', 'preload.ts'),
  'utf8',
);
const updaterSource = fs.readFileSync(
  path.join(projectRoot, 'electron', 'ipc', 'UpdaterIpc.ts'),
  'utf8',
);

const preloadInvoke = new Set(sourceChannels(
  preloadSource,
  'ipcRenderer\\.invoke',
));
const preloadSync = new Set(sourceChannels(
  preloadSource,
  'ipcRenderer\\.sendSync',
));
const updaterHandles = sourceChannels(
  updaterSource,
  'ipc\\.handle',
);
const mainHandles = new Set([
  ...ipc.handles.keys(),
  ...updaterHandles,
]);
const mainSync = new Set(ipc.listeners.keys());

assert.deepEqual(
  difference(preloadSync, mainSync),
  [],
  'preload 存在未注册的同步通道',
);
assert.deepEqual(
  difference(mainSync, preloadSync),
  [],
  '主进程存在 preload 未暴露的同步通道',
);
assert.deepEqual(
  difference(preloadInvoke, mainHandles),
  [],
  'preload 异步通道与主进程注册不一致',
);
assert.deepEqual(
  difference(mainHandles, preloadInvoke),
  [],
  '主进程存在 preload 未暴露的异步通道',
);

/** 验证本地计划导入取消、冲突拒绝和确认覆盖流程。 */
async function testLocalCombatPlanImport() {
  const importIpc = new MemoryIpcRegistrar();
  const importCalls = [];
  let selectionCanceled = true;
  let confirmationResponse = 0;
  registerCombatPlanIpc(importIpc, {
    dialog: {
      showOpenDialog: async () => ({
        canceled: selectionCanceled,
        filePaths: selectionCanceled ? [] : ['C:\\plans\\legacy.yaml'],
      }),
      showMessageBox: async (options) => {
        assert.equal(options.title, '覆盖用户配置');
        assert.equal(options.detail, '地图：bettle-legacy.yaml\n舰队：旧舰队');
        return { response: confirmationResponse };
      },
    },
    plans: {
      importLocal: (filePath, overwrite) => {
        importCalls.push([filePath, overwrite]);
        return overwrite
          ? { success: true, file: 'bettle-legacy.yaml' }
          : {
            success: false,
            exists: true,
            conflicts: [
              '地图：bettle-legacy.yaml',
              '舰队：旧舰队',
            ],
          };
      },
    },
  });
  const importHandler = importIpc.handles.get(
    'import-local-combat-plan',
  );

  assert.deepEqual(
    await importHandler({}),
    { success: false, canceled: true },
  );
  assert.deepEqual(importCalls, []);

  selectionCanceled = false;
  assert.deepEqual(
    await importHandler({}),
    { success: false, canceled: true },
  );
  assert.deepEqual(importCalls, [
    ['C:\\plans\\legacy.yaml', false],
  ]);

  confirmationResponse = 1;
  assert.deepEqual(
    await importHandler({}),
    { success: true, file: 'bettle-legacy.yaml' },
  );
  assert.deepEqual(importCalls, [
    ['C:\\plans\\legacy.yaml', false],
    ['C:\\plans\\legacy.yaml', false],
    ['C:\\plans\\legacy.yaml', true],
  ]);
}

/** 验证批量导出取消、默认文件名和 ZIP 写入流程。 */
async function testUserPlanExport() {
  const exportIpc = new MemoryIpcRegistrar();
  const createCalls = [];
  const writeCalls = [];
  let selectionCanceled = true;
  registerCombatPlanIpc(exportIpc, {
    dialog: {
      showSaveDialog: async (options) => {
        assert.equal(options.title, '批量导出用户配置');
        assert.match(options.defaultPath, /^\d{4}-\d{2}-\d{2}-plans\.zip$/);
        assert.deepEqual(options.filters, [{
          name: 'ZIP 压缩包',
          extensions: ['zip'],
        }]);
        return {
          canceled: selectionCanceled,
          filePath: selectionCanceled
            ? undefined
            : 'C:\\exports\\2026-08-04-plans.zip',
        };
      },
    },
    planExports: {
      createArchive: async selections => {
        createCalls.push(selections);
        return { content: Buffer.from('zip'), count: selections.length };
      },
      archiveFileName: () => '2026-08-04-plans.zip',
      writeArchive: (filePath, archive) => {
        writeCalls.push([filePath, archive.count]);
      },
    },
  });
  const handler = exportIpc.handles.get('export-user-plans');
  const selections = [
    { kind: 'battle', file: 'bettle-test.yaml' },
    { kind: 'team', file: 'team-test.yaml' },
  ];

  assert.deepEqual(
    await handler({}, selections),
    { success: false, canceled: true },
  );
  assert.deepEqual(writeCalls, []);

  selectionCanceled = false;
  assert.deepEqual(
    await handler({}, selections),
    {
      success: true,
      path: 'C:\\exports\\2026-08-04-plans.zip',
      count: 2,
    },
  );
  assert.deepEqual(createCalls, [selections, selections]);
  assert.deepEqual(writeCalls, [[
    'C:\\exports\\2026-08-04-plans.zip',
    2,
  ]]);
}

async function main() {
  await testLocalCombatPlanImport();
  await testUserPlanExport();
}

main()
  .then(() => console.log('main IPC contract tests passed'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
