/**
 * AppController —— 核心控制器（瘦身版）。
 * 协调 Model 和 View，委托子控制器与独立函数处理细分逻辑。
 */
import { MainView } from '../../view/main/MainView';
import { PlanPreviewView } from '../../view/plan/PlanPreviewView';
import { FleetPlannerView } from '../../view/plan/FleetPlannerView';
import { DecisivePlanView } from '../../view/plan/DecisivePlanView';
import { ConfigView } from '../../view/config/ConfigView';
import { TaskGroupView } from '../../view/taskGroup/TaskGroupView';
import { SetupWizardView } from '../../view/setup/SetupWizardView';
import { ConfigModel } from '../../model/ConfigModel';
import { ApiClient } from '../../model/ApiClient';
import type { ApiResponse } from '../../types/api';
import { Scheduler, CronScheduler } from '../../model/scheduler';
import { TaskGroupModel } from '../../model/TaskGroupModel';
import { TemplateModel } from '../../model/TemplateModel';
import { Logger } from '../../utils/Logger';
import { showConfirm, showAlert } from '../shared/DialogHelper';
import { TemplateController } from '../template/TemplateController';
import { TaskGroupController } from '../taskGroup/TaskGroupController';
import { PlanController } from '../plan/PlanController';
import { StartupController } from '../startup/StartupController';

import { SchedulerBinder } from './SchedulerBinder';
import { ConfigController } from './ConfigController';
import { applyTheme, getThemeMode } from './theme';
import { buildMainViewObject, type RenderingState } from './rendering';

export class AppController {
  private mainView: MainView;
  private planView: PlanPreviewView;
  private fleetPlannerView: FleetPlannerView;
  private decisivePlanView: DecisivePlanView;
  private configView: ConfigView;
  private taskGroupView: TaskGroupView;
  private setupView: SetupWizardView;

  private configModel: ConfigModel;
  private taskGroupModel: TaskGroupModel;
  private templateModel: TemplateModel;

  private api: ApiClient;
  private scheduler: Scheduler;
  private cronScheduler: CronScheduler;
  private schedulerBinder: SchedulerBinder;
  private configCtrl: ConfigController;

  private appRoot = '';
  private plansDir = '';
  private configDir = '';
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private shipLibraryUpdating = false;

  private templateCtrl!: TemplateController;
  private taskGroupCtrl!: TaskGroupController;
  private planCtrl!: PlanController;
  private startupCtrl!: StartupController;

  /** 待安装的 GUI 版本号 */
  pendingGuiVersion: string | null = null;

  constructor() {
    this.mainView = new MainView();
    this.planView = new PlanPreviewView();
    this.fleetPlannerView = new FleetPlannerView();
    this.decisivePlanView = new DecisivePlanView();
    this.configView = new ConfigView();
    this.taskGroupView = new TaskGroupView();
    this.setupView = new SetupWizardView();
    this.configModel = new ConfigModel();
    this.taskGroupModel = new TaskGroupModel();
    this.templateModel = new TemplateModel();
    this.fleetPlannerView.setTaskGroupsProvider(
      () => this.taskGroupModel.groups,
    );

    const rawPort = window.electronBridge?.getBackendPort?.();
    let port = Number(rawPort);
    if (!Number.isFinite(port) || port <= 0 || port > 65535) {
      port = 8438;
    }
    this.api = new ApiClient(`http://localhost:${port}`);
    this.scheduler = new Scheduler(this.api);

    const cfg = this.configModel.current.daily_automation;
    const gui = this.configModel.currentGuiAutomation;
    this.cronScheduler = new CronScheduler({
      autoExercise: cfg.auto_exercise,
      exerciseFleetId: cfg.exercise_fleet_id ?? 1,
      autoBattle: cfg.auto_battle,
      battleType: cfg.battle_type,
      battleTimes: gui.battleTimes,
      autoNormalFight: cfg.auto_normal_fight,
      autoLoot: gui.autoLoot,
      lootPlanIndex: gui.lootPlanIndex,
      lootStopCount: gui.lootStopCount,
    });

    this.schedulerBinder = new SchedulerBinder({
      scheduler: this.scheduler,
      cronScheduler: this.cronScheduler,
      api: this.api,
      templateModel: this.templateModel,
      configModel: this.configModel,
      renderMain: () => this.renderMain(),
      updateOpsAvailability: (c) => this.updateOpsAvailability(c),
    });

    // configCtrl 创建延迟到 init()（需要子控制器引用）
    this.configCtrl = null!;
  }

  /** 初始化：绑定事件、渲染初始状态、自动连接后端 */
  init(): void {
    applyTheme();
    this.bindNavigation();
    this.bindPlanNavigation();
    this.bindActions();
    this.schedulerBinder.bindSchedulerCallbacks();
    this.schedulerBinder.bindCronCallbacks();

    this.decisivePlanView.bindActions();
    void this.decisivePlanView.load();

    this.planCtrl = new PlanController(this.planView, {
      scheduler: this.scheduler,
      plansDir: '',
      renderMain: () => this.renderMain(),
      switchPage: (p) => this.switchPage(p, p === 'plan' ? 'scheme' : undefined),
    });
    this.fleetPlannerView.onOpenBattlePlan = async (file, source) => {
      await this.planCtrl.openManagedPlan(file, source);
    };
    this.planCtrl.bindActions();

    this.taskGroupCtrl = new TaskGroupController(
      this.taskGroupModel, this.taskGroupView, this.templateModel,
      this.mainView, {
        scheduler: this.scheduler,
        plansDir: '',
        renderMain: () => this.renderMain(),
        switchPage: (p) => this.switchPage(p, p === 'plan' ? 'scheme' : undefined),
        importTaskPreset: (preset, fp) => this.planCtrl.importTaskPreset(preset, fp),
        getCurrentPlan: () => this.planCtrl.getCurrentPlan(),
        setCurrentPlan: (plan, mapData) => this.planCtrl.setCurrentPlan(plan, mapData),
        renderPlanPreview: () => this.planCtrl.renderPlanPreview(),
        closePresetDetail: () => this.planCtrl.closePresetDetail(),
        executePreset: () => this.planCtrl.executePreset(),
        getCurrentPresetInfo: () => this.planCtrl.getCurrentPresetInfo(),
        pickManagedBattlePlan: () => this.planCtrl.pickManagedBattlePlan(),
        openManagedPlan: (file, source) => (
          this.planCtrl.openManagedPlan(file, source)
        ),
      },
    );
    this.taskGroupCtrl.bindActions();

    this.templateCtrl = new TemplateController(
      this.templateModel, this.taskGroupModel,
      () => this.taskGroupCtrl.render(), '', '',
    );
    this.templateCtrl.bindActions();

    // 现在可以创建 configCtrl（依赖 templateCtrl / startupCtrl 后续会赋值）
    this.configCtrl = new ConfigController({
      configModel: this.configModel,
      configView: this.configView,
      setupView: this.setupView,
      mainView: this.mainView,
      scheduler: this.scheduler,
      cronScheduler: this.cronScheduler,
      templateCtrl: this.templateCtrl,
      startupCtrl: null!, // 在 startupCtrl 创建后回填
      configDir: this.configDir,
    });

    this.bindOpsActions();
    this.renderMain();
    this.planView.render(null);

    // 显示版本号
    const bridge = window.electronBridge;
    if (bridge) {
      const v = bridge.getAppVersion();
      if (v) this.mainView.setVersion(`v${v}`);
    }

    // 监听系统主题变化
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (getThemeMode() === 'system') applyTheme();
    });

    // 窗口关闭时保存任务组状态并刷新日志
    window.addEventListener('beforeunload', () => {
      this.taskGroupModel.save();
      Logger.flush();
    });

    // 加载配置 → 检测模拟器 → 渲染 → 连接
    this.startupCtrl = new StartupController({
      scheduler: this.scheduler,
      cronScheduler: this.cronScheduler,
      configModel: this.configModel,
      appRoot: this.appRoot,
      plansDir: this.plansDir,
      configDir: this.configDir,
      pendingGuiVersion: this.pendingGuiVersion,
      syncPaths: (appRoot, plansDir, configDir) => {
        this.appRoot = appRoot;
        this.plansDir = plansDir;
        this.configDir = configDir;
        this.templateCtrl.appRoot = appRoot;
        this.templateCtrl.plansDir = plansDir;
        this.taskGroupCtrl.host.plansDir = plansDir;
        this.planCtrl.host.plansDir = plansDir;
        // 同步 configCtrl 的 configDir
        (this.configCtrl as any).host.configDir = configDir;
      },
      initLogger: (b) => {
        Logger.init({
          appendFile: b.appendFile.bind(b),
          uiCallback: (level, channel, message) => {
            const now = new Date();
            const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
            this.mainView.appendLog({ time, level, channel, message });
          },
          logDir: `${this.configDir}/log`,
        });
      },
      loadConfigAndSync: async () => {
        await this.configCtrl.loadConfig();
        const da = this.configModel.current.daily_automation;
        const gui = this.configModel.currentGuiAutomation;
        this.cronScheduler.updateConfig({
          autoExercise: da.auto_exercise,
          exerciseFleetId: da.exercise_fleet_id ?? 1,
          autoBattle: da.auto_battle,
          battleType: da.battle_type,
          battleTimes: gui.battleTimes,
          autoNormalFight: da.auto_normal_fight,
          autoLoot: gui.autoLoot,
          lootPlanIndex: gui.lootPlanIndex,
          lootStopCount: gui.lootStopCount,
        });
      },
      detectAndApplyEmulator: () => this.configCtrl.detectAndApplyEmulator(),
      showSetupWizard: () => this.configCtrl.showSetupWizard(),
      loadModelsAndRender: async (b) => {
        await this.templateModel.init(b);
        this.configCtrl.renderConfig();
        this.mainView.setDebugMode(localStorage.getItem('debugMode') === 'true');
        this.templateCtrl.renderLibrary();
        await this.taskGroupModel.load();
        this.taskGroupCtrl.render();
      },
      bindBackendLog: (b) => {
        if (b.onBackendLog) {
          b.onBackendLog((line) => {
            const clean = line.replace(/\x1b\[[0-9;]*m/g, '');
            if (!clean) return;
            let level = 'info';
            if (/\bERROR\b/i.test(clean)) level = 'error';
            else if (/\bWARNING\b/i.test(clean)) level = 'warn';
            const msgMatch = clean.match(/\|\s*(?:INFO|WARNING|ERROR)\s*\|\s*\S+\s*\|\s*(.+)/);
            const message = msgMatch ? msgMatch[1].trim() : clean;
            this.schedulerBinder.handleBackendRuntimeLog(message);
            Logger.logLevel(level, message);
            this.scheduler.processBackendLog(message);
          });
        }
      },
      renderMain: () => this.renderMain(),
      startHeartbeat: () => this.startHeartbeat(),
    });

    // 回填 startupCtrl 引用
    (this.configCtrl as any).host.startupCtrl = this.startupCtrl;

    this.startupCtrl.run().catch((e) => {
      console.error('初始化失败:', e);
      this.configCtrl.renderConfig();
    });
  }

  // ════════════════════════════════════════
  // 页面导航
  // ════════════════════════════════════════

  private bindNavigation(): void {
    document.querySelectorAll<HTMLElement>('.nav-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        const pageId = tab.dataset['page'];
        if (pageId) this.switchPage(pageId);
      });
    });
  }

  private bindPlanNavigation(): void {
    document.querySelectorAll<HTMLElement>('[data-plan-tab]').forEach((tab) => {
      tab.addEventListener('click', () => {
        const tabId = tab.dataset['planTab'];
        if (tabId) this.showPlanTab(tabId);
      });
    });
  }

  private showPlanTab(tabId: string): void {
    document.querySelectorAll<HTMLElement>('[data-plan-tab]').forEach((tab) => {
      const active = tab.dataset['planTab'] === tabId;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll<HTMLElement>('[data-plan-panel]').forEach((panel) => {
      const active = panel.dataset['planPanel'] === tabId;
      panel.classList.toggle('active', active);
      panel.hidden = !active;
    });
    if (tabId === 'fleet') {
      void this.fleetPlannerView.load();
    } else if (tabId === 'scheme') {
      void this.planCtrl.ensureDefaultPlan();
    } else if (tabId === 'manage') {
      void this.fleetPlannerView.loadManagement();
    }
  }

  private switchPage(pageId: string, planTab?: string): void {
    document.querySelectorAll('.nav-tab').forEach((t) => t.classList.remove('active'));
    document.querySelector(`.nav-tab[data-page="${pageId}"]`)?.classList.add('active');
    document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
    document.getElementById(`page-${pageId}`)?.classList.add('active');
    if (pageId === 'plan') {
      if (planTab) this.showPlanTab(planTab);
      const activeTab = document.querySelector<HTMLElement>('[data-plan-tab].active')
        ?.dataset['planTab'] ?? 'fleet';
      if (activeTab === 'fleet') void this.fleetPlannerView.load();
    }
    if (pageId === 'config') {
      this.refreshAdbStatus();
      void this.refreshShipLibraryStatus();
    }
  }

  // ════════════════════════════════════════
  // 用户操作绑定
  // ════════════════════════════════════════

  private bindActions(): void {
    window.electronBridge?.onShipLibraryUpdateProgress?.((progress) => {
      if (this.shipLibraryUpdating) {
        this.configView.setShipLibraryStatus(progress.message, 'unknown');
      }
    });

    document.getElementById('btn-save-config')?.addEventListener('click', () => this.configCtrl.saveConfig());
    document.getElementById('btn-open-config-dir')?.addEventListener('click', () => this.openFolder(this.appRoot));

    document.getElementById('btn-browse-emu')?.addEventListener('click', async () => {
      const bridge = window.electronBridge;
      if (!bridge) return;
      const dir = await bridge.openDirectoryDialog('选择模拟器安装目录');
      if (dir) this.configView.setEmulatorPath(dir);
    });

    document.getElementById('btn-browse-python')?.addEventListener('click', async () => {
      const bridge = window.electronBridge;
      if (!bridge) return;
      const result = await bridge.openFileDialog([{ name: 'Python', extensions: ['exe'] }]);
      if (result) this.configView.setPythonPath(result.path);
    });

    document.getElementById('btn-browse-backend-repo')?.addEventListener('click', async () => {
      const bridge = window.electronBridge;
      if (!bridge) return;
      const dir = await bridge.openDirectoryDialog('选择本地后端仓库目录');
      if (dir) this.configView.setBackendRepoPath(dir);
    });

    document.getElementById('btn-browse-cuda')?.addEventListener('click', async () => {
      const bridge = window.electronBridge;
      if (!bridge) return;
      const dir = await bridge.openDirectoryDialog('选择 CUDA Toolkit 根目录/bin 或 PyTorch torch\\lib 目录');
      if (dir) this.configView.setCudaPath(dir);
    });

    document.getElementById('btn-browse-log-root')?.addEventListener('click', async () => {
      const dir = await window.electronBridge?.openDirectoryDialog('选择后端日志目录');
      if (dir) this.configView.setLogRoot(dir);
    });

    document.getElementById('btn-browse-plan-root')?.addEventListener('click', async () => {
      const dir = await window.electronBridge?.openDirectoryDialog('选择后端作战方案根目录');
      if (dir) this.configView.setPlanRoot(dir);
    });

    document.getElementById('btn-add-normal-fight-task')?.addEventListener('click', async () => {
      const selected = await this.planCtrl.pickManagedBattlePlanForAutomation();
      if (!selected) return;
      try {
        const result = await window.electronBridge?.readManagedCombatPlan(
          selected.plan.source,
          selected.plan.file,
        );
        if (!result?.success || !result.path) {
          throw new Error(result?.error || '无法读取所选出征计划');
        }
        const fleetName = selected.plan.fleets[selected.fleetPresetIndex]?.name;
        if (!fleetName) {
          throw new Error('所选使用舰队不存在');
        }
        this.configView.setNormalFightPlan(
          result.path,
          selected.fleetPresetIndex,
          fleetName,
        );
      } catch (error) {
        await showAlert(
          '无法加载出征计划',
          error instanceof Error ? error.message : String(error),
        );
      }
    });

    document.getElementById('btn-check-backend')?.addEventListener('click', async () => {
      const button = document.getElementById('btn-check-backend') as HTMLButtonElement;
      const port = this.configView.getBackendPort();
      button.disabled = true;
      button.textContent = '检测中…';
      this.configView.setBackendStatus('正在连接', 'unknown');
      try {
        const result = await new ApiClient(`http://127.0.0.1:${port}`).health();
        this.configView.setBackendStatus(
          result.success ? '接口正常' : (result.error || result.message || '接口异常'),
          result.success ? 'ok' : 'error',
        );
      } catch {
        this.configView.setBackendStatus('无法连接', 'error');
      } finally {
        button.disabled = false;
        button.textContent = '检测';
      }
    });

    document.getElementById('btn-validate-cuda')?.addEventListener('click', async () => {
      const bridge = window.electronBridge;
      if (!bridge?.validateCudaPath) return;
      const cudaPath = this.configView.getCudaPath();
      this.configView.setCudaValidateLoading(true);
      this.configView.setCudaStatus('检测中', 'unknown', '正在检测 PyTorch、CUDA 和显卡');
      try {
        const result = await bridge.validateCudaPath(cudaPath);
        if (result.valid) {
          if (result.path) this.configView.setCudaPath(result.path);
          const details = [
            result.device ?? 'CUDA 可用',
            result.version ? `CUDA ${result.version}` : null,
            result.torchVersion ? `PyTorch ${result.torchVersion}` : null,
          ].filter(Boolean);
          this.configView.setCudaStatus(
            result.version ? `CUDA ${result.version}` : 'GPU 可用',
            'ok',
            details.join('；'),
          );
        } else {
          const error = result.error ?? '未检测到可用 CUDA';
          const shortStatus = (
            result.torchVersion?.includes('+cpu')
            || error.includes('未检测到可用 CUDA')
          )
            ? '仅 CPU'
            : error.includes('路径') || error.includes('目录') || error.includes('Runtime DLL')
              ? '路径无效'
              : '检测失败';
          this.configView.setCudaStatus(shortStatus, 'error', error);
        }
      } catch {
        this.configView.setCudaStatus('检测失败', 'error', '硬件检测失败');
      } finally {
        this.configView.setCudaValidateLoading(false);
      }
    });

    document.getElementById('btn-validate-python')?.addEventListener('click', async () => {
      const bridge = window.electronBridge;
      if (!bridge?.validatePython) return;
      const pythonPath = this.configView.getPythonPath();
      if (!pythonPath) { this.configView.setPythonStatus('"留空"将自动检测', 'unknown'); return; }
      this.configView.setPythonValidateLoading(true);
      try {
        const result = await bridge.validatePython(pythonPath);
        this.configView.setPythonStatus(result.valid ? '✓ ' + result.version : (result.error ?? '不兼容'), result.valid ? 'ok' : 'error');
      } catch { this.configView.setPythonStatus('检测失败', 'error'); }
      finally { this.configView.setPythonValidateLoading(false); }
    });

    document.getElementById('btn-check-updates')?.addEventListener('click', async () => {
      await this.checkUpdatesManually();
    });

    document.getElementById('btn-update-ship-library')?.addEventListener('click', async () => {
      await this.updateShipLibrary();
    });

    document.getElementById('btn-connect-adb')?.addEventListener('click', async () => {
      await this.changeAdbConnection('connect');
    });

    document.getElementById('btn-disconnect-adb')?.addEventListener('click', async () => {
      await this.changeAdbConnection('disconnect');
    });

    document.getElementById('btn-check-adb')?.addEventListener('click', async () => {
      const bridge = window.electronBridge;
      if (!bridge?.checkAdbDevices) return;
      const btn = document.getElementById('btn-check-adb') as HTMLButtonElement;
      btn.disabled = true; btn.textContent = '检测中…';
      try {
        const devices = await bridge.checkAdbDevices();
        const online = devices.filter(d => d.status === 'device');
        if (online.length === 0) {
          await showAlert('ADB 检测', '未发现在线设备。\n请确认模拟器已启动。');
        } else if (online.length === 1) {
          this.configView.setEmulatorSerial(online[0].serial);
          this.configView.setAdbStatus(`在线 (${online[0].serial})`, 'online');
          Logger.info(`ADB 检测到在线设备: ${online[0].serial}，已自动填入`);
        } else {
          const list = online.map(d => d.serial).join('\n');
          const ok = await showConfirm('ADB 检测', `发现 ${online.length} 个在线设备：\n\n${list}\n\n是否将第一个设备填入 serial？`);
          if (ok) {
            this.configView.setEmulatorSerial(online[0].serial);
            this.configView.setAdbStatus(`在线 (${online[0].serial})`, 'online');
          }
        }
      } catch (e: any) { await showAlert('ADB 检测失败', e.message || String(e)); }
      finally { btn.disabled = false; btn.textContent = '检测 ADB'; }
    });

    document.getElementById('btn-stop-task')?.addEventListener('click', async () => {
      await this.scheduler.stopRunning();
      this.schedulerBinder.currentProgress = '';
      this.schedulerBinder.trackedLoot = '';
      this.schedulerBinder.trackedShip = '';
      this.renderMain();
      Logger.info('已停止当前任务（任务已保留在队列中）');
    });
    document.getElementById('btn-clear-queue')?.addEventListener('click', () => {
      this.scheduler.clearQueue(); this.renderMain();
    });
    document.getElementById('btn-start-queue')?.addEventListener('click', () => {
      this.scheduler.startConsuming(); this.renderMain();
    });

    this.mainView.onRemoveQueueItem = (taskId) => { this.scheduler.removeTask(taskId); this.renderMain(); };
    this.mainView.onMoveQueueItem = (from, to) => { this.scheduler.moveTask(from, to); this.renderMain(); };

    document.getElementById('btn-reset-accent')?.addEventListener('click', () => {
      this.configView.resetAccentColor('#0f7dff');
      localStorage.setItem('accentColor', '#0f7dff');
      applyTheme();
    });
    document.getElementById('cfg-theme-mode')?.addEventListener('change', (e) => {
      localStorage.setItem('themeMode', (e.target as HTMLSelectElement).value);
      applyTheme();
    });
    document.getElementById('cfg-accent-color')?.addEventListener('input', (e) => {
      localStorage.setItem('accentColor', (e.target as HTMLInputElement).value);
      applyTheme();
    });
  }

  // ════════════════════════════════════════
  // 日常操作按钮
  // ════════════════════════════════════════

  private bindOpsActions(): void {
    const wrap = (btnId: string, label: string, action: () => Promise<ApiResponse>) => {
      document.getElementById(btnId)?.addEventListener('click', async () => {
        const btn = document.getElementById(btnId) as HTMLButtonElement;
        btn.disabled = true;
        this.mainView.setOpsStatus(`${label}中…`);
        try {
          const res = await action();
          if (res.success) { Logger.info(`${label}完成`); this.mainView.setOpsStatus(`${label}完成`); }
          else { Logger.warn(`${label}失败: ${res.message ?? '未知错误'}`); this.mainView.setOpsStatus(`${label}失败`); }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          Logger.error(`${label}异常: ${msg}`); this.mainView.setOpsStatus(`${label}异常`);
        } finally {
          btn.disabled = false;
          setTimeout(() => { this.mainView.setOpsStatus(''); }, 3000);
        }
      });
    };
    wrap('btn-ops-expedition', '收取远征', () => this.api.expeditionCheck());
    wrap('btn-ops-reward', '收取奖励', () => this.api.rewardCollect());
    wrap('btn-ops-build-collect', '收取建造', () => this.api.buildCollect());
    wrap('btn-ops-cook', '食堂烹饪', () => this.api.cook());
    wrap('btn-ops-repair', '浴室修理', () => this.api.repairBath());
  }

  private updateOpsAvailability(connected: boolean): void {
    this.mainView.setOpsAvailability(connected);
  }

  // ════════════════════════════════════════
  // 渲染
  // ════════════════════════════════════════

  private renderMain(): void {
    const state: RenderingState = {
      scheduler: this.scheduler,
      currentProgress: this.schedulerBinder.currentProgress,
      trackedLoot: this.schedulerBinder.trackedLoot,
      trackedShip: this.schedulerBinder.trackedShip,
      wsConnected: this.schedulerBinder.wsConnected,
      expeditionTimerText: this.schedulerBinder.expeditionTimerText,
    };
    const vo = buildMainViewObject(state);
    this.mainView.render(vo);
  }

  // ════════════════════════════════════════
  // ADB / 心跳 / 辅助
  // ════════════════════════════════════════

  private async changeAdbConnection(action: 'connect' | 'disconnect'): Promise<void> {
    const bridge = window.electronBridge;
    const method = action === 'connect'
      ? bridge?.connectAdbDevice
      : bridge?.disconnectAdbDevice;
    if (!method) return;

    const serial = this.configView.getEmulatorSerial();
    if (!serial) {
      await showAlert('ADB 地址为空', '请先填写 ADB 地址，例如 127.0.0.1:16384。');
      return;
    }

    const buttonId = action === 'connect' ? 'btn-connect-adb' : 'btn-disconnect-adb';
    const button = document.getElementById(buttonId) as HTMLButtonElement | null;
    const originalText = button?.textContent ?? '';
    if (button) {
      button.disabled = true;
      button.textContent = action === 'connect' ? '连接中…' : '断开中…';
    }
    this.configView.setAdbStatus(
      action === 'connect' ? '正在连接' : '正在断开',
      'unknown',
    );

    try {
      const result = await method(serial);
      if (result.success) {
        const connected = action === 'connect';
        this.configView.setAdbStatus(
          connected ? `在线 (${serial})` : '已断开',
          connected ? 'online' : 'offline',
        );
        Logger.info(`ADB ${connected ? '连接' : '断开'}成功: ${serial}`);
      } else {
        this.configView.setAdbStatus(
          `${action === 'connect' ? '连接' : '断开'}失败`,
          'offline',
        );
        await showAlert(
          `ADB ${action === 'connect' ? '连接' : '断开'}失败`,
          result.message,
        );
      }
    } catch (error) {
      this.configView.setAdbStatus('ADB 命令执行失败', 'offline');
      await showAlert(
        'ADB 操作失败',
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = originalText;
      }
    }
  }

  private async refreshAdbStatus(): Promise<void> {
    this.configView.setAdbStatus('检测中…', 'unknown');
    const bridge = window.electronBridge;
    if (!bridge?.checkAdbDevices) {
      this.configView.setAdbStatus('ADB 功能不可用', 'offline');
      return;
    }
    try {
      const devices = await bridge.checkAdbDevices();
      const online = devices.filter(device => device.status === 'device');
      const configuredSerial = this.configView.getEmulatorSerial();
      if (
        configuredSerial
        && online.some(device => device.serial === configuredSerial)
      ) {
        this.configView.setAdbStatus(
          `在线 (${configuredSerial})`,
          'online',
        );
      } else if (online.length > 0) {
        this.configView.setAdbStatus(
          `当前地址未连接（发现 ${online.map(device => device.serial).join(', ')}）`,
          'offline',
        );
      } else {
        this.configView.setAdbStatus('未发现在线设备', 'offline');
      }
    } catch {
      this.configView.setAdbStatus('ADB 检测失败', 'offline');
    }
  }

  private async refreshShipLibraryStatus(): Promise<void> {
    if (this.shipLibraryUpdating) return;
    const bridge = window.electronBridge;
    if (!bridge?.getShipLibraryStatus) return;
    try {
      const status = await bridge.getShipLibraryStatus();
      if (status.error) {
        this.configView.setShipLibraryStatus(status.error, 'error');
      } else if (!status.exists) {
        this.configView.setShipLibraryStatus('尚未建立本地资料库', 'unknown');
      } else if (status.missingAssets > 0) {
        this.configView.setShipLibraryStatus(
          `已收录 ${status.shipCount} 艘，缺少 ${status.missingAssets} 个资源`,
          'error',
        );
      } else {
        const updatedAt = status.generatedAt
          ? new Date(status.generatedAt).toLocaleString('zh-CN', { hour12: false })
          : '时间未知';
        this.configView.setShipLibraryStatus(
          `已收录 ${status.shipCount} 艘 · ${updatedAt}`,
          'ok',
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.configView.setShipLibraryStatus(`状态读取失败: ${message}`, 'error');
    }
  }

  private async updateShipLibrary(): Promise<void> {
    const bridge = window.electronBridge;
    if (!bridge?.updateShipLibrary || this.shipLibraryUpdating) return;
    this.shipLibraryUpdating = true;
    this.configView.setShipLibraryUpdateLoading(true);
    this.configView.setShipLibraryStatus('正在准备更新…', 'unknown');
    try {
      const result = await bridge.updateShipLibrary();
      if (!result.success) {
        const message = result.error || result.failures?.[0] || '未知错误';
        this.configView.setShipLibraryStatus(`更新失败: ${message}`, 'error');
        Logger.error(`舰船资料库更新失败: ${message}`);
        return;
      }
      const summary = [
        `${result.ship_count ?? 0} 艘`,
        `新增 ${result.added ?? 0}`,
        `变化 ${result.updated ?? 0}`,
        `下载 ${result.downloaded ?? 0}`,
      ].join('，');
      this.configView.setShipLibraryStatus(`更新完成：${summary}`, 'ok');
      Logger.info(`舰船资料库更新完成：${summary}`);
      await this.fleetPlannerView.load(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.configView.setShipLibraryStatus(`更新失败: ${message}`, 'error');
      Logger.error(`舰船资料库更新异常: ${message}`);
    } finally {
      this.shipLibraryUpdating = false;
      this.configView.setShipLibraryUpdateLoading(false);
    }
  }

  private async checkUpdatesManually(): Promise<void> {
    const bridge = window.electronBridge;
    if (!bridge) return;
    const updateMode = bridge.getUpdateMode?.() ?? 'auto';

    const btn = document.getElementById('btn-check-updates') as HTMLButtonElement | null;
    if (btn) {
      btn.disabled = true;
      btn.textContent = '检查中…';
    }

    try {
      /*
       * 测试期接口（后端源码更新）已停用，逻辑保留便于回滚恢复。
      try {
        const updates = await bridge.checkUpdates();
        if (updates.hasUpdates) {
          const confirmed = await showConfirm(
            '后端更新',
            `发现后端可更新，是否立即拉取并更新？`,
          );
          if (confirmed) {
            const pull = await bridge.pullUpdates();
            if (pull.success) {
              Logger.info('后端更新完成');
            } else {
              Logger.warn(`后端更新失败: ${pull.output || '未知错误'}`);
            }
          } else {
            Logger.info('已取消后端更新');
          }
        } else {
          Logger.info('后端已是最新版本');
        }
      } catch {
        Logger.warn('后端更新检查失败');
      }
      */
      Logger.info('已跳过后端源码更新检查（测试接口已停用）');

      try {
        const guiUpdate = await bridge.checkGuiUpdates?.();
        if (updateMode === 'auto') {
          if (guiUpdate?.version) {
            Logger.info(`检测到 GUI 新版本 v${guiUpdate.version}，自动模式下将自动下载`);
          } else {
            Logger.info('GUI 已是最新版本');
          }
          return;
        }
        if (guiUpdate?.version) {
          const confirmed = await showConfirm(
            'GUI 更新',
            `发现 GUI 新版本 v${guiUpdate.version}，是否立即下载？`,
          );
          if (confirmed) {
            const result = await bridge.downloadGuiUpdate?.();
            if (result?.success) {
              Logger.info(`GUI 更新下载开始: v${guiUpdate.version}`);
            } else {
              Logger.warn(`GUI 更新下载失败: ${result?.message || '未知错误'}`);
            }
          } else {
            Logger.info('已取消 GUI 更新下载');
          }
        } else {
          Logger.info('GUI 已是最新版本');
        }
      } catch {
        Logger.warn('GUI 更新检查失败');
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '立即检查更新';
      }
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    let consecutiveFails = 0;
    this.heartbeatTimer = setInterval(async () => {
      try {
        const alive = await this.scheduler.ping();
        if (alive) { consecutiveFails = 0; } else { consecutiveFails++; }
      } catch { consecutiveFails++; }
      if (consecutiveFails >= 3) {
        Logger.error('后端连续 3 次心跳失败，尝试自动重启…');
        this.stopHeartbeat();
        const bridge = window.electronBridge;
        if (bridge?.startBackend) {
          await bridge.startBackend();
          this.startupCtrl.waitForBackendAndConnect();
        }
      }
    }, 30_000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
  }

  private openFolder(folderPath: string): void {
    if (!folderPath) return;
    const bridge = window.electronBridge;
    if (bridge?.openFolder) bridge.openFolder(folderPath);
  }
}

// ── 入口：实例化并初始化 ──
const app = new AppController();
app.init();
