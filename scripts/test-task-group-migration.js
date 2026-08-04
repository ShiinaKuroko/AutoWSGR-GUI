const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { TaskGroupModel } = require('../dist/src/model/TaskGroupModel.js');

const activityPlans = [
  ['活动20260730-E1炸鱼.yaml', 'bettle-E1炸鱼.yaml'],
  ['活动20260730-E5夜战.yaml', 'bettle-E5夜战.yaml'],
  ['活动20260730-H1炸鱼.yaml', 'bettle-H1炸鱼.yaml'],
  ['活动20260730-H5夜战.yaml', 'bettle-H5夜战.yaml'],
];
const legacy = JSON.stringify({
  activeGroup: '旧组',
  rootExtension: { preserved: true },
  groups: [{
    name: '旧组',
    groupExtension: 'keep',
    items: activityPlans.map(([legacyFile], index) => ({
      path: `resource/builtin_plans/${legacyFile}`,
      kind: 'plan',
      times: index + 1,
      label: `旧活动计划 ${index + 1}`,
      forceRetry: true,
      autoFleetFallback: true,
      itemExtension: { preserved: true },
    })),
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
  assert.equal(first.version, 3);
  assert.equal(first.rootExtension.preserved, true);
  assert.equal(first.groups[0].groupExtension, 'keep');
  first.groups[0].items.forEach((item, index) => {
    const [legacyFile, managedFile] = activityPlans[index];
    assert.equal(item.itemExtension.preserved, true);
    assert.equal(item.managedSource, 'system');
    assert.equal(item.managedFile, managedFile);
    assert.equal(
      item.path,
      `resource/builtin_plans/${legacyFile}`,
    );
    assert.equal(item.forceRetry, true);
    assert.equal(item.autoFleetFallback, true);
    assert.equal(
      fs.existsSync(path.join(
        __dirname,
        '..',
        'resource',
        'system_battle_plans',
        managedFile,
      )),
      true,
      `迁移后的系统活动计划不存在: ${managedFile}`,
    );
  });
  assert.equal(saves, 1);

  const second = new TaskGroupModel();
  await second.load();
  assert.deepEqual(second.toJSON(), first);
  assert.equal(saves, 1);

  stored = JSON.stringify({
    version: 2,
    activeGroup: '中间版本',
    groups: [{
      name: '中间版本',
      items: [{
        path: 'resource/system_battle_plans/E1炸鱼.yaml',
        managedSource: 'system',
        managedFile: 'E1炸鱼.yaml',
        kind: 'plan',
        times: 1,
        label: 'E1炸鱼',
      }],
    }],
  });
  const interim = new TaskGroupModel();
  await interim.load();
  assert.equal(interim.toJSON().version, 3);
  assert.equal(
    interim.toJSON().groups[0].items[0].managedFile,
    'bettle-E1炸鱼.yaml',
  );
  assert.equal(saves, 2);
  console.log('任务组 v1/v2→v3 活动计划迁移测试通过');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
