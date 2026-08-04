const assert = require('node:assert/strict');
const { TaskGroupModel } = require('../dist/src/model/TaskGroupModel.js');

const legacy = JSON.stringify({
  activeGroup: '旧组',
  rootExtension: { preserved: true },
  groups: [{
    name: '旧组',
    groupExtension: 'keep',
    items: [{
      path: 'resource/system_battle_plans/bettle-weekly.yaml',
      kind: 'plan',
      times: 2,
      label: '周常',
      autoFleetFallback: true,
      itemExtension: { preserved: true },
    }],
  }],
});

let stored = legacy;
let saves = 0;
global.window = {
  electronBridge: {
    readFile: async () => stored,
    saveFile: async (_file, content) => {
      stored = content;
      saves += 1;
    },
  },
};

async function run() {
  const model = new TaskGroupModel();
  await model.load();
  const first = model.toJSON();
  assert.equal(first.version, 2);
  assert.equal(first.rootExtension.preserved, true);
  assert.equal(first.groups[0].groupExtension, 'keep');
  assert.equal(first.groups[0].items[0].itemExtension.preserved, true);
  assert.equal(first.groups[0].items[0].managedSource, 'system');
  assert.equal(first.groups[0].items[0].managedFile, 'bettle-weekly.yaml');
  assert.equal(first.groups[0].items[0].autoFleetFallback, true);
  assert.equal(saves, 1);

  const second = new TaskGroupModel();
  await second.load();
  assert.deepEqual(second.toJSON(), first);
  assert.equal(saves, 1);
  console.log('任务组 v1→v2 round-trip 测试通过');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
