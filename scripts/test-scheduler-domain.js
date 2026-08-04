import assert from 'node:assert/strict';
import esbuild from 'esbuild';

const entries = [
  'src/model/scheduler/SchedulerTaskPolicy.ts',
  'src/model/scheduler/SchedulerRepairPolicy.ts',
  'src/model/scheduler/CronScheduler.ts',
  'src/model/scheduler/RepairManager.ts',
];
const modules = await Promise.all(entries.map(async entry => {
  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    loader: { '.json': 'json' },
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}));
const taskPolicy = modules[0];
const repairPolicy = modules[1];
const cronModule = modules[2];
const repairModule = modules[3];

const task = taskPolicy.createSchedulerTask({
  id: 'task-1', name: 'test', type: 'normal_fight', request: { type: 'normal_fight' },
  priority: 10, times: 3, sortKey: 2,
});
const lower = { ...task, id: 'lower', priority: 0 };
const same = { ...task, id: 'same', sortKey: 3 };
assert.equal(taskPolicy.findPriorityInsertionIndex([lower, same], task), 1);
assert.equal(taskPolicy.findPriorityInsertionIndex([lower, same], task, true), 1);
const followUp = taskPolicy.buildFollowUpTask(task, 2, 'task-2');
assert.equal(followUp.logicalId, task.logicalId);
assert.equal(followUp.remainingTimes, 2);
assert.equal(followUp.retryCount, 0);
assert.equal(repairPolicy.calculateRepairWaitMs(new Map([['a', { repairEndTime: 110_000 }]]), 100_000), 15_000);
assert.equal(repairPolicy.calculateRepairWaitMs(new Map([['a', { repairEndTime: 0 }]]), 100_000), -1);

const values = new Map();
const storage = {
  get: key => values.get(key) ?? null,
  set: (key, value) => values.set(key, value),
  remove: key => values.delete(key),
};
const cronConfig = {
  autoExercise: false, exerciseFleetId: 1, autoBattle: false, battleType: '1-1', battleTimes: 1,
  autoNormalFight: false, autoLoot: false, lootPlanIndex: 0, lootStopCount: 0,
};
const cron = new cronModule.CronScheduler(cronConfig, storage);
cron.markBattleCompleted();
const restoredCron = new cronModule.CronScheduler(cronConfig, storage);
restoredCron.start();
restoredCron.stop();
assert.ok(values.has('cron_lastBattleRun'));

const repairData = JSON.stringify([{ key: 'ship', name: 'Ship', startTime: Date.now(), repairEndTime: Date.now() + 60_000, requestSent: true }]);
storage.set('autowsgr_bathing_ships', repairData);
const repair = new repairModule.RepairManager({}, storage);
assert.equal(repair.getBathingShips().size, 1);
assert.equal(repair.getBathingShips().get('ship').name, 'Ship');

console.log('scheduler domain tests passed');
