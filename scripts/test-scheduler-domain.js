import assert from 'node:assert/strict';
import esbuild from 'esbuild';

const entries = [
  'src/model/scheduler/SchedulerTaskPolicy.ts',
  'src/model/scheduler/SchedulerRepairPolicy.ts',
  'src/model/scheduler/CronScheduler.ts',
  'src/model/scheduler/RepairManager.ts',
  'src/model/scheduler/Scheduler.ts',
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
const schedulerModule = modules[4];

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
  autoNormalFight: false, autoLoot: false,
  lootPlanId: 'bettle-周常-9-2.yaml', lootStopCount: 0,
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

globalThis.localStorage = {
  getItem: key => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value),
  removeItem: key => values.delete(key),
};

function createSchedulerApi(overrides = {}) {
  let callbacks = {};
  return {
    setCallbacks(next) {
      callbacks = next;
    },
    get callbacks() {
      return callbacks;
    },
    systemStart: async () => ({ success: true }),
    connectWebSockets() {},
    expeditionCheck: async () => ({ success: true }),
    taskStart: async () => ({
      success: true,
      data: { task_id: 'backend-task-1', status: 'running' },
    }),
    taskStop: async () => ({ success: true }),
    taskStatus: async () => ({
      success: true,
      data: {
        task_id: 'backend-task-1',
        status: 'running',
        progress: null,
        result: null,
      },
    }),
    ...overrides,
  };
}

async function createRunningScheduler(api) {
  const scheduler = new schedulerModule.Scheduler(api);
  scheduler.setAutoExpedition(false);
  assert.equal(await scheduler.start(), true);
  const taskId = scheduler.addTask(
    '停止测试',
    'normal_fight',
    { type: 'normal_fight' },
    10,
    1,
  );
  scheduler.startConsuming();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(scheduler.currentRunningTask?.id, taskId);
  return { scheduler, taskId };
}

let workerRunning = true;
const stopApi = createSchedulerApi({
  taskStatus: async () => ({
    success: true,
    data: {
      task_id: workerRunning ? 'backend-task-1' : null,
      status: workerRunning ? 'running' : 'stopped',
      progress: null,
      result: null,
    },
  }),
});
const { scheduler: stoppingScheduler, taskId: stoppedTaskId } =
  await createRunningScheduler(stopApi);
let stopSettled = false;
const stopPromise = stoppingScheduler.stopRunning().finally(() => {
  stopSettled = true;
});
await new Promise(resolve => setTimeout(resolve, 20));
assert.equal(stopSettled, false);
assert.equal(stoppingScheduler.status, 'stopping');
assert.equal(stoppingScheduler.currentRunningTask?.id, stoppedTaskId);
assert.equal(stoppingScheduler.taskQueue.length, 0);

workerRunning = false;
await stopPromise;
assert.equal(stoppingScheduler.status, 'idle');
assert.equal(stoppingScheduler.currentRunningTask, null);
assert.equal(stoppingScheduler.taskQueue.length, 1);
assert.equal(stoppingScheduler.taskQueue[0].id, stoppedTaskId);
assert.equal(stoppingScheduler.taskQueue[0].backendTaskId, undefined);

const wsStopApi = createSchedulerApi();
const { scheduler: wsStoppingScheduler, taskId: wsStoppedTaskId } =
  await createRunningScheduler(wsStopApi);
const wsStopPromise = wsStoppingScheduler.stopRunning();
await new Promise(resolve => setTimeout(resolve, 20));
wsStopApi.callbacks.onTaskCompleted({
  type: 'task_completed',
  success: false,
  result: null,
  error: null,
});
await wsStopPromise;
assert.equal(wsStoppingScheduler.status, 'idle');
assert.equal(wsStoppingScheduler.currentRunningTask, null);
assert.equal(wsStoppingScheduler.taskQueue.length, 1);
assert.equal(wsStoppingScheduler.taskQueue[0].id, wsStoppedTaskId);

const failedStopApi = createSchedulerApi({
  taskStop: async () => ({ success: false, error: '拒绝停止' }),
});
const { scheduler: failedStopScheduler, taskId: failedTaskId } =
  await createRunningScheduler(failedStopApi);
await assert.rejects(
  failedStopScheduler.stopRunning(),
  /拒绝停止/,
);
assert.equal(failedStopScheduler.status, 'running');
assert.equal(failedStopScheduler.currentRunningTask?.id, failedTaskId);
assert.equal(failedStopScheduler.taskQueue.length, 0);

console.log('scheduler domain tests passed');
