import assert from 'node:assert/strict';
import esbuild from 'esbuild';

const entries = [
  'src/model/scheduler/SchedulerTaskPolicy.ts',
  'src/model/scheduler/SchedulerRepairPolicy.ts',
  'src/model/scheduler/CronScheduler.ts',
  'src/controller/app/AutomaticDecisiveTask.ts',
  'src/controller/app/SchedulerBinder.ts',
  'src/model/scheduler/RepairManager.ts',
  'src/model/scheduler/Scheduler.ts',
  'src/controller/app/ScheduledTaskLoader.ts',
  'src/model/scheduler/StopConditionChecker.ts',
  'src/model/scheduler/TaskQueue.ts',
  'src/model/scheduler/NormalFightDailyQuota.ts',
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
const automaticDecisive = modules[3];
const schedulerBinderModule = modules[4];
const repairModule = modules[5];
const schedulerModule = modules[6];
const scheduledTaskLoaderModule = modules[7];
const stopConditionModule = modules[8];
const taskQueueModule = modules[9];
const normalFightQuotaModule = modules[10];

assert.equal(normalFightQuotaModule.normalFightDailyLimit(undefined), 1);
assert.equal(normalFightQuotaModule.normalFightDailyLimit(0), 1);
assert.equal(normalFightQuotaModule.normalFightDailyLimit(7.9), 7);
assert.equal(normalFightQuotaModule.normalFightDailyLimit(1000), 999);

const quotaValues = new Map();
const quotaStorage = {
  get: key => quotaValues.get(key) ?? null,
  set: (key, value) => quotaValues.set(key, value),
  remove: key => quotaValues.delete(key),
};
let quotaNow = new Date(2026, 7, 10, 12, 0, 0).getTime();
const quotaTask = {
  name: 'plans/daily.yaml',
  fleet_id: 2,
  fleet_preset_index: 1,
  times: 2,
};
const dailyQuota = new normalFightQuotaModule.NormalFightDailyQuota(
  quotaStorage,
  () => quotaNow,
);
assert.equal(dailyQuota.remaining(quotaTask), 2);
assert.equal(dailyQuota.markCompleted(quotaTask), 1);
const restoredDailyQuota =
  new normalFightQuotaModule.NormalFightDailyQuota(
    quotaStorage,
    () => quotaNow,
  );
assert.equal(
  restoredDailyQuota.remaining(quotaTask),
  1,
  '自动出征今日完成次数必须跨 GUI 重启保留',
);
assert.equal(
  restoredDailyQuota.totalRemaining([
    quotaTask,
    { ...quotaTask },
  ]),
  1,
  '重复的自动出征计划和舰队不得重复计算剩余次数',
);
quotaNow = new Date(2026, 7, 11, 0, 0, 1).getTime();
assert.equal(
  restoredDailyQuota.remaining(quotaTask),
  2,
  '本地日期变化后自动出征次数必须重置',
);

let disabledStopConditionApiCalls = 0;
const disabledStopConditionChecker =
  new stopConditionModule.StopConditionChecker(
    {
      gameAcquisition: async () => {
        disabledStopConditionApiCalls += 1;
        return {
          success: true,
          data: { loot_count: -1, ship_count: -1 },
        };
      },
      gameContext: async () => {
        disabledStopConditionApiCalls += 1;
        return {
          success: true,
          data: {
            dropped_loot_count: -1,
            dropped_ship_count: -1,
          },
        };
      },
    },
    () => {},
  );
disabledStopConditionChecker.updateTracked(-1, -1);
assert.equal(
  disabledStopConditionChecker.checkRunning({
    loot_count_ge: -1,
    ship_count_ge: -1,
  }),
  false,
  '关闭的停止条件不得被 -1 计数触发',
);
assert.equal(
  await disabledStopConditionChecker.preflightCheck(
    { loot_count_ge: -1, ship_count_ge: -1 },
    '关闭停止条件测试',
  ),
  false,
);
assert.equal(
  await disabledStopConditionChecker.checkCondition(
    { loot_count_ge: -1, ship_count_ge: -1 },
    '关闭停止条件测试',
  ),
  false,
);
assert.equal(
  disabledStopConditionApiCalls,
  0,
  '关闭的停止条件不得发起 OCR 或上下文检查',
);
disabledStopConditionChecker.updateTracked(0, 0);
assert.equal(
  disabledStopConditionChecker.checkRunning({ loot_count_ge: 0 }),
  true,
  '阈值 0 必须保持原有的立即满足语义',
);

for (const [type, request] of [
  ['normal_fight', { type: 'normal_fight', times: 4, gap: 0 }],
  ['event_fight', { type: 'event_fight', times: 4, gap: 0, fleet_id: 1 }],
  ['campaign', { type: 'campaign', campaign_name: '困难潜艇', times: 4 }],
]) {
  const normalized = taskQueueModule.normalizeRoundTask(type, request, 2);
  assert.equal(
    normalized.times,
    4,
    `${type} 应兼容旧请求中的总轮数`,
  );
  assert.equal(
    normalized.request.times,
    1,
    `${type} 后端请求必须固定为单轮`,
  );
  assert.equal(request.times, 4, `${type} 归一化不得修改原请求`);
}
const unlimitedRound = taskQueueModule.normalizeRoundTask(
  'normal_fight',
  { type: 'normal_fight', times: 10, gap: 0 },
  Number.POSITIVE_INFINITY,
);
assert.equal(unlimitedRound.times, Number.POSITIVE_INFINITY);
assert.equal(
  unlimitedRound.request.times,
  1,
  '无限任务也必须由 GUI 按单轮调度',
);
const invalidRound = taskQueueModule.normalizeRoundTask(
  'campaign',
  { type: 'campaign', campaign_name: '困难潜艇', times: Number.NaN },
  Number.NaN,
);
assert.equal(invalidRound.times, 1, '非法轮数必须回退为 1');
assert.equal(invalidRound.request.times, 1);

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
  autoNormalFight: false,
  autoDecisive: false, decisiveTemplateId: 'system_preset',
  autoLoot: false,
  lootPlanSource: 'system',
  lootPlanId: 'bettle-周常-9-2.yaml', lootStopCount: 0,
};
const cron = new cronModule.CronScheduler(cronConfig, storage);
cron.markBattleHandled();
const restoredCron = new cronModule.CronScheduler(cronConfig, storage);
restoredCron.start();
restoredCron.stop();
assert.ok(values.has('cron_lastBattleRun'));

const decisiveTriggers = [];
const decisiveCron = new cronModule.CronScheduler({
  ...cronConfig,
  autoDecisive: true,
}, storage);
decisiveCron.setCallbacks({
  onDecisiveDue: templateId => decisiveTriggers.push(templateId),
});
decisiveCron.start();
decisiveCron.stop();
assert.deepEqual(decisiveTriggers, ['system_preset']);
decisiveCron.start();
decisiveCron.stop();
assert.equal(
  decisiveTriggers.length,
  1,
  '同一天存在 pending 时不得重复触发自动决战',
);
decisiveCron.clearDecisivePending();
decisiveCron.start();
decisiveCron.stop();
assert.equal(
  decisiveTriggers.length,
  2,
  '任务入队前失败并清除 pending 后应允许重试',
);
decisiveCron.markDecisiveHandled();
assert.ok(values.has('cron_lastDecisiveRun'));

let restoredDecisiveTriggers = 0;
const restoredDecisiveCron = new cronModule.CronScheduler({
  ...cronConfig,
  autoDecisive: true,
}, storage);
restoredDecisiveCron.setCallbacks({
  onDecisiveDue: () => {
    restoredDecisiveTriggers += 1;
  },
});
restoredDecisiveCron.start();
restoredDecisiveCron.stop();
assert.equal(
  restoredDecisiveTriggers,
  0,
  '自动决战已处理日期必须跨实例持久化',
);

const automationValues = new Map();
const automationStorage = {
  get: key => automationValues.get(key) ?? null,
  set: (key, value) => automationValues.set(key, value),
  remove: key => automationValues.delete(key),
};
const automationTriggers = {
  exercise: [],
  campaign: [],
  normalFight: 0,
  decisive: [],
  loot: [],
};
let automationIdle = true;
const automationCron = new cronModule.CronScheduler({
  ...cronConfig,
  autoExercise: true,
  exerciseFleetId: 3,
  autoBattle: true,
  battleType: '困难航母',
  battleTimes: 4,
  autoNormalFight: true,
  autoDecisive: true,
  autoLoot: true,
  lootPlanSource: 'user',
  lootPlanId: 'bettle-old-9-2ADGHM速刷胖次.yaml',
  lootStopCount: 21,
}, automationStorage);
automationCron.setCallbacks({
  canStartNormalFight: () => automationIdle,
  onExerciseDue: fleetId => automationTriggers.exercise.push(fleetId),
  onCampaignDue: (name, times) => {
    automationTriggers.campaign.push([name, times]);
  },
  onNormalFightDue: () => {
    automationTriggers.normalFight += 1;
  },
  onDecisiveDue: templateId => {
    automationTriggers.decisive.push(templateId);
  },
  onLootDue: (source, planId, stopCount) => {
    automationTriggers.loot.push([source, planId, stopCount]);
  },
});
automationCron.start();
automationCron.stop();
assert.deepEqual(automationTriggers, {
  exercise: [3],
  campaign: [['困难航母', 4]],
  normalFight: 1,
  decisive: ['system_preset'],
  loot: [[
    'user',
    'bettle-old-9-2ADGHM速刷胖次.yaml',
    21,
  ]],
});
automationCron.markNormalFightHandled();
automationIdle = false;
automationCron.tick();
assert.equal(
  automationTriggers.normalFight,
  1,
  '队列非空闲时不得触发自动出征',
);
automationIdle = true;
automationCron.tick();
assert.equal(
  automationTriggers.normalFight,
  2,
  '上一轮结束后，下一次空闲检查应重新触发自动出征',
);
automationCron.markExerciseCompleted();
automationCron.markBattleHandled();
automationCron.markNormalFightHandled();
automationCron.markDecisiveHandled();
automationCron.markLootHandled();

const restoredAutomationTriggers = [];
const restoredAutomationCron = new cronModule.CronScheduler({
  ...cronConfig,
  autoExercise: true,
  autoBattle: true,
  autoNormalFight: true,
  autoDecisive: true,
  autoLoot: true,
}, automationStorage);
restoredAutomationCron.setCallbacks({
  canStartNormalFight: () => true,
  onExerciseDue: () => restoredAutomationTriggers.push('exercise'),
  onCampaignDue: () => restoredAutomationTriggers.push('campaign'),
  onNormalFightDue: () => restoredAutomationTriggers.push('normal'),
  onDecisiveDue: () => restoredAutomationTriggers.push('decisive'),
  onLootDue: () => restoredAutomationTriggers.push('loot'),
});
restoredAutomationCron.start();
restoredAutomationCron.stop();
assert.deepEqual(
  restoredAutomationTriggers,
  ['normal'],
  '自动出征不受每日持久化标记限制，空闲时应再次触发',
);

const userDecisiveRequest =
  automaticDecisive.buildAutomaticDecisivePlanRequest(
    {
      chapter: 5,
      useQuickRepair: false,
      level1: [' 当前主力 ', ''],
      level2: ['当前替补'],
    },
  );
assert.deepEqual(userDecisiveRequest, {
  type: 'decisive',
  chapter: 5,
  decisive_rounds: 1,
  use_quick_repair: false,
  level1: ['当前主力'],
  level2: ['当前替补'],
});

const presetDecisiveRequest =
  automaticDecisive.buildAutomaticDecisivePresetRequest(
    {
      id: 'custom-decisive',
      name: '自定义决战',
      type: 'decisive',
      chapter: 4,
      level1: ['模板主力'],
      level2: ['模板替补'],
      flagship_priority: ['旗舰优先'],
      use_quick_repair: true,
    },
  );
assert.deepEqual(presetDecisiveRequest, {
  type: 'decisive',
  chapter: 4,
  decisive_rounds: 1,
  use_quick_repair: true,
  level1: ['模板主力'],
  level2: ['模板替补'],
  flagship_priority: ['旗舰优先'],
});

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

let cronCallbacks = {};
let schedulerCallbacks = {};
let decisiveTemplate = {
  id: 'builtin_decisive_6',
  name: '决战',
  type: 'decisive',
  chapter: 6,
  level1: ['系统主力'],
  level2: ['系统替补'],
  use_quick_repair: true,
};
const decisiveQueueCalls = [];
let decisivePlanReads = 0;
let decisiveStartCalls = 0;
let decisivePendingClears = 0;
let decisiveHandledCalls = 0;
let normalFightPendingClears = 0;
let normalFightHandledCalls = 0;
let normalFightQuotaAvailable = true;
let normalFightQuotaMarks = 0;
let normalFightRemainingRefreshes = 0;
let lootPendingClears = 0;
let lootHandledCalls = 0;
let binderRunningTask = null;
const managedPlanReads = [];
let managedPlanWrites = 0;
const expeditionTimerUpdates = [];
const managedLootYaml = [
  'chapter: 9',
  'map: 2',
  'selected_nodes: [A]',
  'endpoint_nodes: [A]',
  'result: S',
  'fleet_id: 3',
  'gap: 4',
  'stop_condition:',
  '  loot_count_ge: 48',
  '  ship_count_ge: 7',
  '',
].join('\n');
const automaticSortieCalls = [];
let automaticSortieIdle = true;
let automaticSortieStarts = 0;
let automaticSortieRemaining = 99;
const automaticSortieLoader =
  new scheduledTaskLoaderModule.ScheduledTaskLoader(
    {
      scheduler: {
        get isCompletelyIdle() {
          return automaticSortieIdle;
        },
        addTask: (...args) => {
          automaticSortieCalls.push(args);
          return `automatic-sortie-${automaticSortieCalls.length}`;
        },
        startConsuming: () => {
          automaticSortieStarts += 1;
        },
      },
      templateModel: {},
      normalFightDailyQuota: {
        remaining: () => automaticSortieRemaining,
      },
      configModel: {
        current: {
          daily_automation: {
            normal_fight_tasks: [{
              name: 'idle-plan',
              fleet_id: 2,
              times: 99,
            }],
          },
          ocr: { ship_name_aliases: {} },
        },
      },
    },
    {
      readCombatPlanFile: async path => ({
        success: true,
        path,
        runtimePath: `runtime://${path}`,
        content: managedLootYaml,
      }),
    },
  );
const automaticSortieResult =
  await automaticSortieLoader.loadNormalFightTasks();
assert.equal(automaticSortieResult.status, 'queued');
assert.equal(automaticSortieCalls.length, 1);
assert.equal(
  automaticSortieCalls[0][2].times,
  1,
  '自动出征提交给后端的 YAML 任务必须只执行一次',
);
assert.equal(
  automaticSortieCalls[0][4],
  1,
  '自动出征逻辑任务不得使用 YAML 中遗留的重复次数',
);
assert.deepEqual(
  automaticSortieCalls[0][12],
  ['A'],
  '自动出征必须把计划终点传给 Scheduler',
);
assert.equal(
  automaticSortieCalls[0][13],
  'S',
  '自动出征必须把计划战果要求传给 Scheduler',
);
assert.equal(
  automaticSortieResult.tasks[0].config.times,
  99,
  '加载器必须返回任务 ID 对应的每日额度配置',
);
assert.equal(
  automaticSortieStarts,
  0,
  '加载器返回任务 ID 前不得提前启动，避免完成回调丢失',
);
automaticSortieIdle = false;
const busyAutomaticSortieResult =
  await automaticSortieLoader.loadNormalFightTasks();
assert.equal(busyAutomaticSortieResult.status, 'retry');
assert.equal(
  automaticSortieCalls.length,
  1,
  '计划加载期间队列变为忙碌时不得追加自动出征',
);
automaticSortieIdle = true;
automaticSortieRemaining = 0;
const exhaustedAutomaticSortieResult =
  await automaticSortieLoader.loadNormalFightTasks();
assert.equal(exhaustedAutomaticSortieResult.status, 'handled');
assert.equal(
  automaticSortieCalls.length,
  1,
  '今日额度用完后不得再追加自动出征',
);
automaticSortieRemaining = 99;
automaticSortieLoader.host.configModel.current
  .daily_automation.normal_fight_tasks.push({
    name: 'idle-plan',
    fleet_id: 2,
    times: 99,
  });
const duplicateAutomaticSortieResult =
  await automaticSortieLoader.loadNormalFightTasks();
assert.equal(duplicateAutomaticSortieResult.status, 'queued');
assert.equal(
  duplicateAutomaticSortieResult.tasks.length,
  1,
  '相同计划和舰队的重复配置只能生成一个自动出征任务',
);
assert.equal(
  automaticSortieCalls.length,
  2,
  '旧配置中的重复自动出征项不得重复加入队列',
);
globalThis.window = {
  electronBridge: {
    getDecisivePlanSettings: async () => {
      decisivePlanReads += 1;
      return {
        chapter: 5,
        useQuickRepair: false,
        level1: ['当前主力'],
        level2: ['当前替补'],
      };
    },
    readManagedCombatPlan: async (source, file) => {
      managedPlanReads.push([source, file]);
      return {
        success: true,
        path: `managed://${source}/${file}`,
        runtimePath: `runtime://${source}/${file}`,
        content: managedLootYaml,
      };
    },
    saveFile: async () => {
      managedPlanWrites += 1;
    },
  },
};
const binder = new schedulerBinderModule.SchedulerBinder({
  scheduler: {
    setCallbacks: callbacks => {
      schedulerCallbacks = callbacks;
    },
    addTask: (...args) => {
      decisiveQueueCalls.push(args);
      return 'automatic-decisive-task';
    },
    startConsuming: () => {
      decisiveStartCalls += 1;
    },
    get currentRunningTask() {
      return binderRunningTask;
    },
    get isCompletelyIdle() {
      return binderRunningTask === null;
    },
    taskQueue: [],
    waitingTaskList: [],
  },
  cronScheduler: {
    setCallbacks: callbacks => {
      cronCallbacks = callbacks;
    },
    clearDecisivePending: () => {
      decisivePendingClears += 1;
    },
    markDecisiveHandled: () => {
      decisiveHandledCalls += 1;
    },
    clearNormalFightPending: () => {
      normalFightPendingClears += 1;
    },
    markNormalFightHandled: () => {
      normalFightHandledCalls += 1;
    },
    clearLootPending: () => {
      lootPendingClears += 1;
    },
    markLootHandled: () => {
      lootHandledCalls += 1;
    },
  },
  api: {},
  templateModel: {
    get: () => decisiveTemplate,
  },
  configModel: {
    current: {
      daily_automation: {
        normal_fight_tasks: [],
      },
    },
  },
  normalFightDailyQuota: {
    hasRemaining: () => normalFightQuotaAvailable,
    remaining: () => normalFightQuotaAvailable ? 1 : 0,
    markCompleted: () => {
      normalFightQuotaMarks += 1;
      return 0;
    },
  },
  renderMain: () => {},
  refreshNormalFightRemaining: () => {
    normalFightRemainingRefreshes += 1;
  },
  updateOpsAvailability: () => {},
  updateExpeditionTimer: text => {
    expeditionTimerUpdates.push(text);
  },
});
binder.bindCronCallbacks();
binder.bindSchedulerCallbacks();
assert.equal(
  cronCallbacks.canStartNormalFight(),
  true,
  '空闲自动出征必须使用调度器的完整空闲状态',
);
normalFightQuotaAvailable = false;
assert.equal(
  cronCallbacks.canStartNormalFight(),
  false,
  '今日额度用完后不得触发自动出征',
);
normalFightQuotaAvailable = true;
cronCallbacks.onDecisiveDue('user_plan');
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(decisiveQueueCalls.length, 1);
assert.deepEqual(decisiveQueueCalls[0].slice(0, 6), [
  '自动决战·用户计划',
  'decisive',
  {
    type: 'decisive',
    chapter: 5,
    decisive_rounds: 1,
    use_quick_repair: false,
    level1: ['当前主力'],
    level2: ['当前替补'],
  },
  20,
  1,
]);
assert.equal(decisivePlanReads, 1);
assert.equal(decisiveStartCalls, 1);
schedulerCallbacks.onLogicalTaskCompleted(
  'automatic-decisive-task',
  false,
);
assert.equal(
  decisiveHandledCalls,
  1,
  '自动决战实际任务结束后，无论结果均应标记当天已处理',
);

cronCallbacks.onDecisiveDue('system_preset');
await new Promise(resolve => setTimeout(resolve, 0));
assert.deepEqual(decisiveQueueCalls[1].slice(0, 6), [
  '自动决战·系统预设',
  'decisive',
  {
    type: 'decisive',
    chapter: 6,
    decisive_rounds: 1,
    use_quick_repair: true,
    level1: ['系统主力'],
    level2: ['系统替补'],
  },
  20,
  1,
]);
assert.equal(
  decisivePlanReads,
  1,
  '系统预设不得读取或混入用户决战计划',
);
schedulerCallbacks.onLogicalTaskCanceled(
  'automatic-decisive-task',
  'queue_cleared',
);
assert.equal(
  decisiveHandledCalls,
  2,
  '用户清空自动任务后应结算父任务，避免同日立即重复加入',
);

cronCallbacks.onDecisiveDue('system_preset');
await new Promise(resolve => setTimeout(resolve, 0));
schedulerCallbacks.onLogicalTaskCanceled(
  'automatic-decisive-task',
  'system_stopped',
);
assert.equal(
  decisivePendingClears,
  1,
  '系统停止只释放 pending，重启后仍应允许自动任务再次触发',
);

decisiveTemplate = undefined;
cronCallbacks.onDecisiveDue('system_preset');
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(decisiveQueueCalls.length, 3);
assert.equal(
  decisivePendingClears,
  2,
  '自动决战入队前失败必须清除 pending',
);

cronCallbacks.onLootDue(
  'user',
  'bettle-用户胖次测试.yaml',
  23,
);
await new Promise(resolve => setTimeout(resolve, 0));
assert.deepEqual(managedPlanReads, [[
  'user',
  'bettle-用户胖次测试.yaml',
]]);
assert.equal(
  managedPlanWrites,
  0,
  '自动胖次只能读取受管 YAML，不得修改原文件',
);
assert.equal(decisiveQueueCalls.length, 4);
const automaticLootCall = decisiveQueueCalls[3];
assert.deepEqual(automaticLootCall.slice(0, 6), [
  '自动刷胖次·9-2',
  'normal_fight',
  {
    type: 'normal_fight',
    plan_id: 'runtime://user/bettle-用户胖次测试.yaml',
    times: 1,
    gap: 4,
    plan: {
      selected_nodes: ['A', '0'],
      node_defaults: {},
      node_args: {
        A: { proceed: false },
      },
      fleet_id: 3,
    },
  },
  20,
  99,
  { loot_count_ge: 23 },
]);
assert.equal(
  Object.hasOwn(automaticLootCall[5], 'ship_count_ge'),
  false,
  '自动胖次默认不得启用舰船掉落停止检测',
);
schedulerCallbacks.onLogicalTaskCompleted(
  'automatic-decisive-task',
  true,
);
assert.equal(lootHandledCalls, 1);
assert.equal(lootPendingClears, 0);

binder.pendingNormalFightTaskIds.add('normal-parent-cleared');
schedulerCallbacks.onLogicalTaskCanceled(
  'normal-parent-cleared',
  'queue_cleared',
);
assert.equal(
  normalFightHandledCalls,
  1,
  '用户清空本轮自动出征后，cron 不得保留 pending 或立即重新加入',
);

binder.pendingNormalFightTaskIds.add('normal-parent-system-stop');
schedulerCallbacks.onLogicalTaskCanceled(
  'normal-parent-system-stop',
  'system_stopped',
);
assert.equal(
  normalFightPendingClears,
  1,
  '系统停止本轮自动出征后应释放 cron pending，允许重启后重试',
);
const quotaRefreshBaseline = normalFightRemainingRefreshes;
const pendingQuotaConfig = {
  name: 'daily-plan.yaml',
  fleet_preset_index: 0,
  times: 3,
};
binder.pendingNormalFightTaskIds.add('normal-not-counted');
binder.pendingNormalFightConfigs.set(
  'normal-not-counted',
  pendingQuotaConfig,
);
schedulerCallbacks.onLogicalTaskCompleted(
  'normal-not-counted',
  true,
  null,
  false,
);
assert.equal(
  normalFightQuotaMarks,
  0,
  '停止条件等非有效轮次结束不得扣每日额度',
);
binder.pendingNormalFightTaskIds.add('normal-counted');
binder.pendingNormalFightConfigs.set(
  'normal-counted',
  pendingQuotaConfig,
);
schedulerCallbacks.onLogicalTaskCompleted(
  'normal-counted',
  true,
  null,
  true,
);
assert.equal(
  normalFightQuotaMarks,
  1,
  '仅 Scheduler 确认有效完成的轮次才扣每日额度',
);
assert.equal(
  normalFightRemainingRefreshes,
  quotaRefreshBaseline + 1,
  '扣除额度后必须刷新设置页剩余次数',
);
binderRunningTask = {
  id: 'running-round',
  logicalId: 'running-parent',
  type: 'normal_fight',
};
schedulerCallbacks.onProgressUpdate(
  'running-round',
  { current: 2, total: 5, node: null },
);
schedulerCallbacks.onLogicalTaskCanceled(
  'other-queued-parent',
  'removed',
);
assert.equal(
  binder.runtimeState.currentProgress,
  '2/5',
  '取消其他排队任务不得清空当前运行任务的进度',
);
binder.handleBackendRuntimeLog('[UI] 战利品数量: 3/10');
binder.handleBackendRuntimeLog('[UI] 舰船数量: 2/8');
assert.equal(binder.runtimeState.trackedLoot, '3/10');
assert.equal(binder.runtimeState.trackedShip, '2/8');
schedulerCallbacks.onExpeditionTimerTick(65);
assert.deepEqual(expeditionTimerUpdates, ['01:05']);
assert.equal(binder.runtimeState.expeditionTimerText, '01:05');

binderRunningTask = {
  id: 'exercise-round',
  logicalId: 'exercise-parent',
  type: 'exercise',
};
binder.handleBackendRuntimeLog('开始演习流程');
binder.handleBackendRuntimeLog('正在挑战对手 1');
binder.handleBackendRuntimeLog('正在挑战对手 1');
assert.equal(
  binder.runtimeState.currentProgress,
  '1/5',
  '同一轮演习的重复日志不得重复增加进度',
);
binderRunningTask = null;
binder.dispose();

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
    systemStop: async () => ({ success: true }),
    connectWebSockets() {},
    disconnectWebSockets() {},
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

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

const readySystemScheduler = new schedulerModule.Scheduler(
  createSchedulerApi({
    systemStatus: async () => ({
      success: true,
      data: { emulator_connected: true },
    }),
  }),
);
assert.equal(await readySystemScheduler.isSystemReady(), true);
const unavailableSystemScheduler = new schedulerModule.Scheduler(
  createSchedulerApi({
    systemStatus: async () => ({
      success: true,
      data: { emulator_connected: false },
    }),
  }),
);
assert.equal(
  await unavailableSystemScheduler.isSystemReady(),
  false,
  '后端接口可达但模拟器未连接时不能恢复为空闲状态',
);

// 手动重连成功后必须恢复任务通道，并能继续发送 GUI 队列任务。
let reconnectWebSocketCalls = 0;
const reconnectedTaskRequests = [];
const reconnectApi = createSchedulerApi({
  connectWebSockets: () => {
    reconnectWebSocketCalls += 1;
  },
  taskStart: async (request) => {
    reconnectedTaskRequests.push(request);
    return {
      success: true,
      data: {
        task_id: 'reconnected-backend-task',
        status: 'running',
      },
    };
  },
});
const reconnectScheduler = new schedulerModule.Scheduler(reconnectApi);
reconnectScheduler.setAutoExpedition(false);
assert.equal(await reconnectScheduler.start(), true);
assert.equal(reconnectScheduler.status, 'idle');
assert.equal(
  reconnectScheduler.isCompletelyIdle,
  true,
  '系统已启动且没有任何任务时应判定为完全空闲',
);
assert.equal(
  reconnectWebSocketCalls,
  1,
  '重连成功后没有恢复任务和日志 WebSocket',
);
const reconnectTaskRequest = {
  type: 'normal_fight',
  plan_id: 'reconnect-test-plan',
};
reconnectScheduler.addTask(
  '重连后发送任务测试',
  'normal_fight',
  reconnectTaskRequest,
);
assert.equal(
  reconnectScheduler.isCompletelyIdle,
  false,
  '队列中已有任务时不得判定为空闲',
);
reconnectScheduler.startConsuming();
await wait(0);
assert.deepEqual(
  reconnectedTaskRequests,
  [{ ...reconnectTaskRequest, times: 1 }],
  '重连成功后 GUI 队列任务没有发送到后端',
);
assert.equal(reconnectScheduler.status, 'running');
assert.equal(
  reconnectScheduler.currentRunningTask?.backendTaskId,
  'reconnected-backend-task',
);
await reconnectScheduler.stop();

// 终点最低战果按 D < C < B < A < S < SS 判断。
const endpointResultScheduler = new schedulerModule.Scheduler(
  createSchedulerApi(),
);
const resultGrades = ['D', 'C', 'B', 'A', 'S', 'SS'];
for (const [actualIndex, actual] of resultGrades.entries()) {
  for (const [requiredIndex, required] of resultGrades.entries()) {
    assert.equal(
      endpointResultScheduler.roundMeetsEndpointResult(
        {
          round: 1,
          success: true,
          nodes: ['C', 'F', 'I'],
          grade: 'D',
          events: [
            { type: 'RESULT', node: 'I', result: actual },
          ],
        },
        ['I'],
        required,
      ),
      actualIndex >= requiredIndex,
      `实际 ${actual}、要求 ${required} 的计数结果错误`,
    );
  }
}
const endpointTask = {
  type: 'normal_fight',
  request: { type: 'normal_fight' },
  endpointNodes: ['I'],
  endpointResult: 'S',
};
const endpointRoundResult = actual => ({
  details: [{
    round: 1,
    success: true,
    nodes: ['C', 'F', 'I'],
    grade: actual,
    events: [{ type: 'RESULT', node: 'I', result: actual }],
  }],
});
assert.equal(
  endpointResultScheduler.shouldCountAsCompletedRound(
    endpointTask,
    endpointRoundResult('A'),
  ),
  false,
  '启用终点战果判断时，未达标轮次不得计数',
);
assert.equal(
  endpointResultScheduler.shouldCountAsCompletedRound(
    endpointTask,
    endpointRoundResult('S'),
  ),
  true,
  '启用终点战果判断时，达标轮次必须计数',
);
assert.equal(
  endpointResultScheduler.shouldCountAsCompletedRound(
    { ...endpointTask, endpointResult: undefined },
    endpointRoundResult('D'),
  ),
  true,
  '未启用战果判断时，到达终点后不得比较战果等级',
);

// 决战完成一轮后必须继续执行用户设置的剩余轮次。
let decisiveTaskStarts = 0;
const decisiveApi = createSchedulerApi({
  taskStart: async () => {
    decisiveTaskStarts += 1;
    return {
      success: true,
      data: {
        task_id: `decisive-backend-${decisiveTaskStarts}`,
        status: 'running',
      },
    };
  },
});
const decisiveScheduler = new schedulerModule.Scheduler(decisiveApi);
decisiveScheduler.setAutoExpedition(false);
const decisiveLogicalEvents = [];
decisiveScheduler.setCallbacks({
  onLogicalTaskCompleted: logicalId => {
    decisiveLogicalEvents.push(logicalId);
  },
});
assert.equal(await decisiveScheduler.start(), true);
const decisiveParentId = decisiveScheduler.addTask(
  '决战十轮测试',
  'decisive',
  { type: 'decisive', chapter: 6 },
  10,
  10,
);
decisiveScheduler.startConsuming();
await wait(0);
decisiveApi.callbacks.onTaskCompleted({
  type: 'task_completed',
  success: true,
  result: null,
  error: null,
});
await wait(0);
assert.equal(decisiveTaskStarts, 2);
assert.equal(decisiveScheduler.currentRunningTask?.remainingTimes, 9);
assert.equal(decisiveScheduler.currentRunningTask?.totalTimes, 10);
assert.equal(
  decisiveScheduler.currentRunningTask?.logicalId,
  decisiveParentId,
);
assert.deepEqual(decisiveLogicalEvents, []);
await decisiveScheduler.stop();

// 无限任务每轮使用新物理 ID，但父 logicalId 必须稳定。
let gapTaskStarts = 0;
const gapApi = createSchedulerApi({
  taskStart: async () => {
    gapTaskStarts += 1;
    return {
      success: true,
      data: {
        task_id: `gap-backend-${gapTaskStarts}`,
        status: 'running',
      },
    };
  },
});
const gapScheduler = new schedulerModule.Scheduler(gapApi);
gapScheduler.setAutoExpedition(false);
const gapRoundEvents = [];
const gapLogicalEvents = [];
const gapCanceledEvents = [];
gapScheduler.setCallbacks({
  onTaskCompleted: taskId => gapRoundEvents.push(taskId),
  onLogicalTaskCompleted: logicalId => {
    gapLogicalEvents.push(logicalId);
  },
  onLogicalTaskCanceled: (logicalId, reason) => {
    gapCanceledEvents.push([logicalId, reason]);
  },
});
assert.equal(await gapScheduler.start(), true);
const gapParentId = gapScheduler.addTask(
  '无限间隔测试',
  'normal_fight',
  { type: 'normal_fight', gap: 0.08 },
  10,
  Number.POSITIVE_INFINITY,
);
gapScheduler.startConsuming();
await wait(0);
gapApi.callbacks.onTaskCompleted({
  type: 'task_completed',
  success: true,
  result: null,
  error: null,
});
await wait(0);
assert.deepEqual(gapRoundEvents, [gapParentId]);
assert.deepEqual(
  gapLogicalEvents,
  [],
  '无限任务单轮完成不得报告整个父任务完成',
);
assert.equal(gapScheduler.currentRunningTask, null);
assert.equal(gapScheduler.taskQueue.length, 0);
assert.equal(gapScheduler.waitingTaskList.length, 1);
assert.equal(gapScheduler.waitingTaskList[0].reason, 'gap');
assert.notEqual(gapScheduler.waitingTaskList[0].task.id, gapParentId);
assert.equal(
  gapScheduler.waitingTaskList[0].task.logicalId,
  gapParentId,
);
assert.equal(gapScheduler.status, 'idle');
const gapFollowUpId = gapScheduler.waitingTaskList[0].task.id;
assert.equal(gapScheduler.removeTask(gapFollowUpId), true);
assert.deepEqual(
  gapCanceledEvents,
  [[gapParentId, 'removed']],
  '删除 gap 等待项必须取消其父任务',
);
await wait(100);
assert.equal(
  gapTaskStarts,
  1,
  '被删除的 gap 等待项不得在计时结束后重新启动',
);
await gapScheduler.stop();

// 启动失败后的重试倒计时同样必须可见、可删除。
const retryApi = createSchedulerApi({
  taskStart: async () => ({
    success: false,
    error: '模拟启动失败',
  }),
});
const retryScheduler = new schedulerModule.Scheduler(retryApi);
retryScheduler.setAutoExpedition(false);
const retryCanceledEvents = [];
retryScheduler.setCallbacks({
  onLogicalTaskCanceled: (logicalId, reason) => {
    retryCanceledEvents.push([logicalId, reason]);
  },
});
assert.equal(await retryScheduler.start(), true);
const retryParentId = retryScheduler.addTask(
  '失败重试等待测试',
  'normal_fight',
  { type: 'normal_fight' },
);
retryScheduler.startConsuming();
await wait(0);
assert.equal(retryScheduler.waitingTaskList.length, 1);
assert.equal(retryScheduler.waitingTaskList[0].reason, 'retry');
assert.equal(
  retryScheduler.waitingTaskList[0].task.logicalId,
  retryParentId,
);
const retryWaitingId =
  retryScheduler.waitingTaskList[0].task.id;
assert.equal(retryScheduler.removeTask(retryWaitingId), true);
assert.deepEqual(
  retryCanceledEvents,
  [[retryParentId, 'removed']],
  '删除失败重试等待项必须取消其父任务',
);
await retryScheduler.stop();

const exhaustedRetryApi = createSchedulerApi({
  taskStart: async () => ({
    success: false,
    error: '舰名与数据库不一致',
  }),
});
const exhaustedRetryScheduler =
  new schedulerModule.Scheduler(exhaustedRetryApi);
exhaustedRetryScheduler.setAutoExpedition(false);
const exhaustedRetryLogs = [];
exhaustedRetryScheduler.setCallbacks({
  onLog: message => exhaustedRetryLogs.push(message),
});
assert.equal(await exhaustedRetryScheduler.start(), true);
const exhaustedRetryTask = taskPolicy.createSchedulerTask({
  id: 'exhausted-retry',
  name: '重试耗尽日志测试',
  type: 'normal_fight',
  request: { type: 'normal_fight' },
  priority: 10,
  times: 1,
});
exhaustedRetryTask.retryCount = exhaustedRetryTask.maxRetries;
exhaustedRetryScheduler.currentTask = exhaustedRetryTask;
await exhaustedRetryScheduler.executeTaskStart(exhaustedRetryTask);
assert.ok(
  exhaustedRetryLogs.some(
    message => (
      message.level === 'error'
      && message.message.includes('舰名与数据库不一致')
    ),
  ),
  '重试耗尽后必须记录后端返回的失败原因',
);
await exhaustedRetryScheduler.stop();

// 清空和系统停止必须给每个父任务发送明确的取消原因。
const clearApi = createSchedulerApi();
const clearScheduler = new schedulerModule.Scheduler(clearApi);
clearScheduler.setAutoExpedition(false);
const clearCanceledEvents = [];
clearScheduler.setCallbacks({
  onLogicalTaskCanceled: (logicalId, reason) => {
    clearCanceledEvents.push([logicalId, reason]);
  },
});
assert.equal(await clearScheduler.start(), true);
const clearIdA = clearScheduler.addTask(
  '清空测试 A',
  'normal_fight',
  { type: 'normal_fight' },
);
const clearIdB = clearScheduler.addTask(
  '清空测试 B',
  'normal_fight',
  { type: 'normal_fight' },
);
clearScheduler.clearQueue();
assert.deepEqual(clearCanceledEvents, [
  [clearIdA, 'queue_cleared'],
  [clearIdB, 'queue_cleared'],
]);
const stopId = clearScheduler.addTask(
  '系统停止测试',
  'normal_fight',
  { type: 'normal_fight' },
);
await clearScheduler.stop();
assert.deepEqual(
  clearCanceledEvents.at(-1),
  [stopId, 'system_stopped'],
);

// 实时停止条件结束父任务，不复用手动暂停的重新入队语义。
let conditionStopCalls = 0;
const conditionApi = createSchedulerApi({
  taskStop: async () => {
    conditionStopCalls += 1;
    return { success: true };
  },
});
const conditionScheduler = new schedulerModule.Scheduler(conditionApi);
conditionScheduler.setAutoExpedition(false);
const conditionRoundEvents = [];
const conditionLogicalEvents = [];
conditionScheduler.setCallbacks({
  onTaskCompleted: taskId => conditionRoundEvents.push(taskId),
  onLogicalTaskCompleted: (logicalId, success) => {
    conditionLogicalEvents.push([logicalId, success]);
  },
});
assert.equal(await conditionScheduler.start(), true);
const conditionParentId = conditionScheduler.addTask(
  '实时停止条件测试',
  'normal_fight',
  { type: 'normal_fight' },
  10,
  Number.POSITIVE_INFINITY,
  { loot_count_ge: 5 },
);
conditionScheduler.startConsuming();
await wait(0);
conditionScheduler.processBackendLog('[UI] 战利品数量: 5/5');
await wait(0);
assert.equal(conditionStopCalls, 1);
assert.equal(conditionScheduler.status, 'stopping');
conditionApi.callbacks.onTaskCompleted({
  type: 'task_completed',
  success: false,
  result: null,
  error: null,
});
await wait(0);
assert.deepEqual(
  conditionRoundEvents,
  [],
  '被停止条件中断的物理轮次不得伪报为单轮完成',
);
assert.deepEqual(
  conditionLogicalEvents,
  [[conditionParentId, true]],
);
assert.equal(conditionScheduler.currentRunningTask, null);
assert.equal(conditionScheduler.taskQueue.length, 0);
assert.equal(conditionScheduler.waitingTaskList.length, 0);
assert.equal(conditionScheduler.status, 'idle');
await conditionScheduler.stop();

let expeditionChecks = 0;
const expeditionApi = createSchedulerApi({
  expeditionCheck: async () => {
    expeditionChecks += 1;
    return { success: true };
  },
});
const expeditionScheduler = new schedulerModule.Scheduler(expeditionApi);
expeditionScheduler.setAutoExpedition(true);
expeditionScheduler.setExpeditionInterval(1);
assert.equal(await expeditionScheduler.start(), true);
assert.equal(
  expeditionChecks,
  1,
  '系统启动后应立即执行一次远征检查',
);
expeditionScheduler.handleExpeditionTrigger();
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(
  expeditionChecks,
  2,
  '远征定时器触发后应通过 EXPEDITION 任务执行检查',
);
expeditionScheduler.setAutoExpedition(false);

// 远征定时触发后应等待当前单轮自然结束，再检查并恢复剩余轮次。
const expeditionQueueEvents = [];
const expeditionQueueRequestTimes = [];
let expeditionQueueStarts = 0;
let expeditionQueueStops = 0;
const expeditionQueueApi = createSchedulerApi({
  taskStart: async (request) => {
    expeditionQueueStarts += 1;
    expeditionQueueEvents.push('task');
    expeditionQueueRequestTimes.push(request.times);
    return {
      success: true,
      data: {
        task_id: `expedition-queue-${expeditionQueueStarts}`,
        status: 'running',
      },
    };
  },
  taskStop: async () => {
    expeditionQueueStops += 1;
    return { success: true };
  },
  expeditionCheck: async () => {
    expeditionQueueEvents.push('expedition');
    return { success: true };
  },
});
const expeditionQueueScheduler =
  new schedulerModule.Scheduler(expeditionQueueApi);
expeditionQueueScheduler.setAutoExpedition(false);
assert.equal(await expeditionQueueScheduler.start(), true);
const queuedTaskId = expeditionQueueScheduler.addTask(
  '远征安全插队测试',
  'normal_fight',
  { type: 'normal_fight', times: 5 },
  10,
  2,
);
expeditionQueueScheduler.addTask(
  '远征后的排队任务',
  'normal_fight',
  { type: 'normal_fight' },
  10,
  2,
);
expeditionQueueScheduler.startConsuming();
await wait(0);
const queuedLogicalId =
  expeditionQueueScheduler.currentRunningTask?.logicalId;
expeditionQueueScheduler.setAutoExpedition(true);
expeditionQueueScheduler.handleExpeditionTrigger();
expeditionQueueScheduler.handleExpeditionTrigger();
await wait(0);
assert.deepEqual(
  expeditionQueueEvents,
  ['task'],
  '远征触发时不得打断尚未完成的当前轮',
);
assert.equal(
  expeditionQueueStops,
  0,
  '远征插队不得向后端发送 taskStop',
);
assert.equal(
  expeditionQueueScheduler.currentRunningTask?.id,
  queuedTaskId,
  '远征排队期间当前任务必须继续运行',
);
assert.equal(
  expeditionQueueScheduler.currentRunningTask?.remainingTimes,
  5,
  '旧请求中的总轮数必须迁移到 GUI 队列',
);
assert.deepEqual(
  expeditionQueueRequestTimes,
  [1],
  '远征等待期间后端只能执行当前单轮',
);
expeditionQueueApi.callbacks.onTaskCompleted({
  type: 'task_completed',
  success: true,
  result: null,
  error: null,
});
await wait(20);
assert.deepEqual(
  expeditionQueueEvents,
  ['task', 'expedition', 'task'],
  '当前轮完成后应先执行远征，再恢复原逻辑任务',
);
assert.equal(
  expeditionQueueScheduler.currentRunningTask?.logicalId,
  queuedLogicalId,
  '远征检查不得改变父任务身份',
);
assert.equal(
  expeditionQueueScheduler.currentRunningTask?.remainingTimes,
  4,
  '当前轮自然完成后应只扣减本轮一次',
);
assert.deepEqual(
  expeditionQueueRequestTimes,
  [1, 1],
  '远征后的后续任务仍必须按单轮发送',
);
assert.equal(
  expeditionQueueScheduler.taskQueue.reduce(
    (total, task) => total + task.remainingTimes,
    expeditionQueueScheduler.currentRunningTask?.remainingTimes ?? 0,
  ),
  6,
  '远征检查后必须保留已完成轮次之外的全部任务次数',
);
expeditionQueueScheduler.setAutoExpedition(false);
await expeditionQueueScheduler.stop();

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
