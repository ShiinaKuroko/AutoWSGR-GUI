/** 绑定 Scheduler 回调并同步日志、进度、队列和连接状态。 */
/**
 * SchedulerBinder —— 调度器回调绑定子控制器。
 * 封装 Scheduler / CronScheduler 的回调绑定逻辑 + 关联的可变状态。
 */
import { TaskPriority, type Scheduler, type SchedulerStatus, type CronScheduler } from '../../model/scheduler';
import type { ApiClient } from '../../model/ApiClient';
import type { ConfigModel } from '../../model/ConfigModel';
import type { TemplateModel } from '../../model/TemplateModel';
import { PlanModel } from '../../model/PlanModel';
import type { NormalFightReq } from '../../types/api.js';
import {
  isLootPlanId,
  type LootPlanId,
} from '../../shared/lootPlans.js';
import { Logger } from '../../utils/Logger';
import { normalizeSelectedNodesForBackend } from '../plan/selectedNodes';
import { buildPlanQueueRequest } from '../taskGroup/queueLoader';

export interface SchedulerBinderHost {
  readonly scheduler: Scheduler;
  readonly cronScheduler: CronScheduler;
  readonly api: ApiClient;
  readonly templateModel: TemplateModel;
  readonly configModel: ConfigModel;
  renderMain(): void;
  updateOpsAvailability(connected: boolean): void;
}

export class SchedulerBinder {
  private static readonly DEFAULT_EXERCISE_TOTAL = 5;
  private static readonly LOG_DEDUP_WINDOW_MS = 1200;

  // ── 状态（从 AppController 迁移而来） ──
  private pendingExerciseTaskId: string | null = null;
  private pendingBattleTaskId: string | null = null;
  private pendingLootTaskId: string | null = null;
  private pendingNormalFightTaskIds = new Set<string>();
  private exerciseTotal = SchedulerBinder.DEFAULT_EXERCISE_TOTAL;
  private exerciseCurrent = 0;
  private exerciseRoundInProgress = false;
  private lastParsedLogMessage = '';
  private lastParsedLogTaskId = '';
  private lastParsedLogAt = 0;
  currentProgress = '';
  trackedLoot = '';
  trackedShip = '';
  wsConnected = false;
  expeditionTimerText = '--:--';

  constructor(private readonly host: SchedulerBinderHost) {}

  /** 绑定 Scheduler 回调 */
  bindSchedulerCallbacks(): void {
    this.host.scheduler.setCallbacks({
      onStatusChange: (_status: SchedulerStatus) => {
        this.host.renderMain();
      },

      onProgressUpdate: (_taskId, progress) => {
        if (this.host.scheduler.currentRunningTask?.type === 'exercise') {
          // 演习优先使用日志解析进度；若尚未解析到日志，先展示 0/默认总场次。
          if (!this.currentProgress) {
            this.currentProgress = `0/${this.exerciseTotal}`;
            this.host.renderMain();
          }
          return;
        }
        this.currentProgress = `${progress.current}/${progress.total}`;
        this.host.renderMain();
      },

      onTaskCompleted: (_taskId, _success, _result, _error) => {
        this.currentProgress = '';
        this.resetExerciseProgress();
        this.lastParsedLogMessage = '';
        this.lastParsedLogTaskId = '';
        this.lastParsedLogAt = 0;
        this.trackedLoot = '';
        this.trackedShip = '';
        this.host.renderMain();
      },

      onLogicalTaskCompleted: (logicalId, success) => {
        if (logicalId === this.pendingExerciseTaskId) {
          if (success) {
            this.host.cronScheduler.markExerciseCompleted();
          } else {
            this.host.cronScheduler.clearExercisePending();
          }
          this.pendingExerciseTaskId = null;
        }
        if (logicalId === this.pendingBattleTaskId) {
          this.host.cronScheduler.markBattleHandled();
          this.pendingBattleTaskId = null;
        }
        if (logicalId === this.pendingLootTaskId) {
          this.host.cronScheduler.markLootHandled();
          this.pendingLootTaskId = null;
        }
        if (this.pendingNormalFightTaskIds.delete(logicalId)
          && this.pendingNormalFightTaskIds.size === 0) {
          this.host.cronScheduler.markNormalFightHandled();
        }
        this.host.renderMain();
      },

      onLog: (msg) => {
        const changed = this.consumeRuntimeLogMessage(msg.message);
        if (changed) this.host.renderMain();
        Logger.logLevel(msg.level.toLowerCase(), msg.message, msg.channel);
      },

      onQueueChange: () => {
        this.host.renderMain();
      },

      onConnectionChange: (connected) => {
        this.wsConnected = connected;
        this.host.updateOpsAvailability(connected);
        if (connected) {
          this.host.api.health().then(res => {
            if (res.success && res.data) {
              const uptime = Math.floor(res.data.uptime_seconds);
              Logger.debug(`后端健康检查: 运行 ${uptime}s, 模拟器${res.data.emulator_connected ? '已连接' : '未连接'}`);
            }
          }).catch(() => {});
        }
        this.host.renderMain();
      },

      onExpeditionTimerTick: (seconds) => {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        this.expeditionTimerText = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        const el = document.getElementById('expedition-timer');
        if (el) el.textContent = this.expeditionTimerText;
      },
    });
  }

  private resetExerciseProgress(): void {
    this.exerciseCurrent = 0;
    this.exerciseTotal = SchedulerBinder.DEFAULT_EXERCISE_TOTAL;
    this.exerciseRoundInProgress = false;
  }

  /**
   * 后端回传战役剩余次数时，同步更新队列中战役任务的 remainingTimes。
   * 仅当后端报告的剩余次数小于当前任务记录的剩余次数时才更新（避免覆盖用户设置）。
   */
  private updateCampaignRemains(remains: number, _total: number): void {
    const scheduler = this.host.scheduler;
    const running = scheduler.currentRunningTask;
    const queue = scheduler.taskQueue;

    // 计算当前战役任务（运行中 + 队列中）的总待执行次数
    let campaignRemaining = 0;
    if (running?.type === 'campaign') {
      campaignRemaining += running.remainingTimes;
    }
    for (const task of queue) {
      if (task.type === 'campaign') {
        campaignRemaining += task.remainingTimes;
      }
    }

    // 仅当后端报告的剩余次数更小时才同步（说明有其他战役消耗了次数）
    if (remains < campaignRemaining) {
      let diff = campaignRemaining - remains;
      Logger.info(`战役次数同步: 后端报告剩余 ${remains}，前端队列待执行 ${campaignRemaining}，减少 ${diff} 次`);

      // 优先从队列末尾的战役任务扣减
      for (let i = queue.length - 1; i >= 0 && diff > 0; i--) {
        const task = queue[i];
        if (task.type !== 'campaign') continue;
        const deduct = Math.min(diff, task.remainingTimes);
        task.remainingTimes -= deduct;
        diff -= deduct;
        if (task.remainingTimes <= 0) {
          scheduler.removeTask(task.id);
        }
      }
      scheduler.notifyQueueChange();
    }
  }

  /**
   * 从后端运行日志更新界面追踪状态（演习进度 + 战利品/舰船计数 + 战役次数）。
   * 返回 true 表示有可视状态变化，需要触发 renderMain。
   */
  private consumeRuntimeLogMessage(message: string): boolean {
    let changed = false;

    const lootMatch = message.match(/\[UI\] 战利品数量: (\d+\/\d+)/);
    if (lootMatch && lootMatch[1] !== this.trackedLoot) {
      this.trackedLoot = lootMatch[1];
      changed = true;
    }

    const shipMatch = message.match(/\[UI\] 舰船数量: (\d+\/\d+)/);
    if (shipMatch && shipMatch[1] !== this.trackedShip) {
      this.trackedShip = shipMatch[1];
      changed = true;
    }

    const campaignRemainsMatch = message.match(/\[OPS\] 战役次数: (\d+)\/(\d+)/);
    if (campaignRemainsMatch) {
      const remains = parseInt(campaignRemainsMatch[1], 10);
      const total = parseInt(campaignRemainsMatch[2], 10);
      this.updateCampaignRemains(remains, total);
      changed = true;
    }

    const running = this.host.scheduler.currentRunningTask;
    if (running?.type !== 'exercise') return changed;

    const normalized = message.trim();
    const now = Date.now();
    const duplicate =
      this.lastParsedLogTaskId === running.id
      && this.lastParsedLogMessage === normalized
      && (now - this.lastParsedLogAt) < SchedulerBinder.LOG_DEDUP_WINDOW_MS;

    if (duplicate) return changed;

    const progressChanged = this.updateExerciseProgressFromLog(normalized);
    this.lastParsedLogTaskId = running.id;
    this.lastParsedLogMessage = normalized;
    this.lastParsedLogAt = now;
    return changed || progressChanged;
  }

  /**
   * 处理后端 stdout 日志（用于 WS 日志延迟/缺失时的进度兜底）。
   */
  handleBackendRuntimeLog(message: string): void {
    if (this.consumeRuntimeLogMessage(message)) {
      this.host.renderMain();
    }
  }

  private updateExerciseProgressFromLog(message: string): boolean {
    let changed = false;
    const normalized = message.trim();

    if (/(?:\[[^\]]+\]\s*)?开始演习流程/.test(normalized)) {
      this.exerciseCurrent = 0;
      this.exerciseRoundInProgress = false;
      this.currentProgress = `0/${this.exerciseTotal}`;
      return true;
    }

    const rivalMatch = normalized.match(/(?:\[[^\]]+\]\s*)?(?:当前可挑战对手|演习对手状态):\s*ExerciseRivalStatus\(\[([^\]]*)\]\)/);
    if (rivalMatch) {
      const flags = rivalMatch[1]
        .split(',')
        .map(s => s.trim().toUpperCase())
        .filter(Boolean);
      if (flags.length > 0) {
        const available = flags.filter(f => f === 'Y').length;
        const nextTotal = available > 0 ? available : flags.length;
        if (nextTotal > 0 && nextTotal !== this.exerciseTotal) {
          this.exerciseTotal = nextTotal;
          changed = true;
        }
        if (!this.currentProgress) {
          this.currentProgress = `0/${this.exerciseTotal}`;
          changed = true;
        }
      }
    }

    // 每轮演习可能出现多条相关日志（正在挑战/选择对手/开始战斗）。
    // 这里使用“单轮状态位”避免重复计数。
    const hasRoundStartSignal =
      /(?:\[[^\]]+\]\s*)?正在挑战对手\s*\d+/.test(normalized)
      || /(?:\[[^\]]+\]\s*)?选择对手\s*\d+/.test(normalized)
      || /(?:\[[^\]]+\]\s*)?演习\s*[->→]\s*开始战斗/.test(normalized);

    if (hasRoundStartSignal && !this.exerciseRoundInProgress) {
      this.exerciseRoundInProgress = true;
      this.exerciseCurrent += 1;
      if (this.exerciseCurrent > this.exerciseTotal) {
        this.exerciseTotal = this.exerciseCurrent;
      }
      const next = `${this.exerciseCurrent}/${this.exerciseTotal}`;
      if (next !== this.currentProgress) {
        this.currentProgress = next;
        changed = true;
      }
    }

    if (/(?:\[[^\]]+\]\s*)?战斗结束:\s*/.test(normalized)) {
      // 兜底：若某些后端版本缺失“挑战/选择/开始战斗”日志，则在战斗结束时补计一轮。
      if (!this.exerciseRoundInProgress) {
        this.exerciseCurrent += 1;
        if (this.exerciseCurrent > this.exerciseTotal) {
          this.exerciseTotal = this.exerciseCurrent;
        }
        const next = `${this.exerciseCurrent}/${this.exerciseTotal}`;
        if (next !== this.currentProgress) {
          this.currentProgress = next;
          changed = true;
        }
      }
      this.exerciseRoundInProgress = false;
    }

    const finishedMatch = normalized.match(/(?:\[[^\]]+\]\s*)?演习流程结束,\s*共完成\s*(\d+)\s*场/);
    if (finishedMatch) {
      const done = parseInt(finishedMatch[1], 10);
      if (Number.isFinite(done) && done >= 0) {
        this.exerciseCurrent = done;
        this.exerciseRoundInProgress = false;
        if (done > this.exerciseTotal) this.exerciseTotal = done;
        const next = `${this.exerciseCurrent}/${this.exerciseTotal}`;
        if (next !== this.currentProgress) {
          this.currentProgress = next;
          changed = true;
        }
      }
    }

    return changed;
  }

  /** 绑定定时调度器回调 */
  bindCronCallbacks(): void {
    this.host.cronScheduler.setCallbacks({
      onExerciseDue: (fleetId) => {
        const id = this.host.scheduler.addTask(
          '自动演习',
          'exercise',
          { type: 'exercise', fleet_id: fleetId },
          TaskPriority.DAILY,
          1,
        );
        this.pendingExerciseTaskId = id;
        Logger.info(`自动演习已加入队列 (舰队 ${fleetId})`);
        this.host.scheduler.startConsuming();
      },

      onCampaignDue: (campaignName, times) => {
        const id = this.host.scheduler.addTask(
          `自动战役·${campaignName}`,
          'campaign',
          { type: 'campaign', campaign_name: campaignName, times: 1 },
          TaskPriority.DAILY,
          times,
        );
        this.pendingBattleTaskId = id;
        Logger.info(`自动战役已加入队列 (${campaignName} ×${times})`);
        this.host.scheduler.startConsuming();
      },

      onScheduledTaskDue: (taskKey) => {
        Logger.info(`定时任务「${taskKey}」已触发`);
      },

      onLootDue: (planId, stopCount) => {
        this.autoLoadLootTask(planId, stopCount);
      },

      onNormalFightDue: () => {
        void this.autoLoadNormalFightTasks();
      },

      onLog: (level, message) => {
        Logger.logLevel(level, message);
      },
    });
  }

  /** 自动出征：按照 usersettings.yaml 中的顺序加载并加入队列。 */
  private async autoLoadNormalFightTasks(): Promise<void> {
    const queuedTasks = [
      this.host.scheduler.currentRunningTask,
      ...this.host.scheduler.taskQueue,
    ];
    if (queuedTasks.some(task => (
      task?.unlimited === true
      && task.name.startsWith('自动出征·')
    ))) {
      this.host.cronScheduler.markNormalFightHandled();
      Logger.info('已有无限自动出征任务在运行，本次不重复加入');
      return;
    }

    const tasks = this.host.configModel.current.daily_automation.normal_fight_tasks;
    if (tasks.length === 0) {
      Logger.warn('自动出征已启用，但任务列表为空');
      this.host.cronScheduler.markNormalFightHandled();
      return;
    }
    const bridge = window.electronBridge;
    if (!bridge) {
      this.host.cronScheduler.clearNormalFightPending();
      return;
    }

    let loaded = 0;
    for (const task of tasks) {
      try {
        const resolved = await this.resolveNormalFightPlan(task.name);
        if (!resolved) throw new Error(`找不到出征计划: ${task.name}`);
        const plan = PlanModel.fromYaml(resolved.content, resolved.path);
        const { req: request, selectedFleetId } = buildPlanQueueRequest(
          {
            path: resolved.path,
            kind: 'plan',
            times: task.times ?? 1,
            label: plan.mapName,
            fleet_id: task.fleet_id,
            fleetPresetIndex: task.fleet_preset_index,
          },
          plan,
          resolved.path,
        );
        const id = this.host.scheduler.addTask(
          `自动出征·${plan.mapName}`,
          plan.isEvent ? 'event_fight' : 'normal_fight',
          request,
          TaskPriority.DAILY,
          task.times ?? Number.POSITIVE_INFINITY,
          plan.data.stop_condition,
          undefined,
          selectedFleetId,
          undefined,
          undefined,
          undefined,
          true,
        );
        this.pendingNormalFightTaskIds.add(id);
        loaded++;
      } catch (error) {
        Logger.error(
          `自动出征加载「${task.name}」失败: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    if (loaded === 0) {
      this.host.cronScheduler.clearNormalFightPending();
      return;
    }
    Logger.info(`自动出征已按顺序加入 ${loaded} 个任务`);
    this.host.scheduler.startConsuming();
  }

  /** 支持绝对路径、plan_root 目录和 GUI 自带后端数据目录。 */
  private async resolveNormalFightPlan(
    name: string,
  ): Promise<{ path: string; content: string } | null> {
    const bridge = window.electronBridge;
    if (!bridge) return null;
    const root = this.host.configModel.current.plan_root?.replace(/[\\/]$/, '');
    const suffixes = /\.ya?ml$/i.test(name) ? [name] : [name, `${name}.yaml`];
    const candidates = new Set<string>(suffixes);
    for (const category of ['normal_fight', 'event']) {
      for (const suffix of suffixes) {
        if (root) candidates.add(`${root}/${category}/${suffix}`);
        candidates.add(`autowsgr/data/plan/${category}/${suffix}`);
      }
    }
    for (const candidate of candidates) {
      if (bridge.readCombatPlanFile) {
        const result = await bridge.readCombatPlanFile(candidate);
        if (
          result.success
          && result.content?.trim()
          && result.path
        ) {
          return {
            path: result.runtimePath ?? result.path,
            content: result.content,
          };
        }
        continue;
      }
      const content = await bridge.readFile(candidate);
      if (content.trim()) return { path: candidate, content };
    }
    return null;
  }

  /** 自动战利品：按稳定系统计划标识加载方案并加入队列。 */
  private async autoLoadLootTask(
    planId: LootPlanId,
    stopCount: number,
  ): Promise<void> {
    if (!isLootPlanId(planId)) {
      Logger.error(`自动战利品加载失败: 未知计划 ${String(planId)}`);
      this.host.cronScheduler.clearLootPending();
      return;
    }
    const managedFile = planId;
    const bridge = window.electronBridge;
    if (!bridge) {
      this.host.cronScheduler.clearLootPending();
      return;
    }
    try {
      const loaded = await bridge.readManagedCombatPlan(
        'system',
        managedFile,
      );
      if (!loaded.success || !loaded.content || !loaded.path) {
        throw new Error(loaded.error || `无法读取 ${managedFile}`);
      }
      const planPath = loaded.runtimePath ?? loaded.path;
      const content = loaded.content;
      const plan = PlanModel.fromYaml(content, planPath);
      const req: NormalFightReq = {
        type: 'normal_fight',
        plan_id: planPath,
        times: 1,
        gap: plan.data.gap ?? 0,
      };
      if (plan.data.selected_nodes.length > 0) {
        req.plan = req.plan ?? {};
        req.plan.selected_nodes = normalizeSelectedNodesForBackend(plan.data.selected_nodes);
        // 与普通出击一致：避免后端把 plan.fleet_id 默认成 1 覆盖 YAML 内舰队。
        if (plan.data.fleet_id != null) {
          req.plan.fleet_id = plan.data.fleet_id;
        }
      }
      const stopCondition = { loot_count_ge: stopCount };
      const id = this.host.scheduler.addTask(
        `自动刷胖次·${plan.mapName}`,
        'normal_fight',
        req,
        TaskPriority.DAILY,
        99,
        stopCondition,
      );
      this.pendingLootTaskId = id;
      Logger.info(`自动战利品已加入队列 (${plan.mapName}, 战利品≥${stopCount}时停止)`);
      this.host.scheduler.startConsuming();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      Logger.error(`自动战利品加载失败: ${msg}`);
      this.host.cronScheduler.clearLootPending();
    }
  }
}
