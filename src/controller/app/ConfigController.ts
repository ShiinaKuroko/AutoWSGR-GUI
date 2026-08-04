/** 编排设置加载、环境检测、表单保存和配置持久化。 */
/**
 * ConfigController —— 配置管理子控制器。
 * 负责 loadConfig / saveConfig / renderConfig / detectAndApplyEmulator / showSetupWizard
 */
import type { ConfigModel } from '../../model/ConfigModel';
import type { ConfigView } from '../../view/config/ConfigView';
import type { SetupWizardView } from '../../view/setup/SetupWizardView';
import type { MainView } from '../../view/main/MainView';
import type { Scheduler, CronScheduler } from '../../model/scheduler';
import type { TemplateController } from '../template/TemplateController';
import type { StartupController } from '../startup/StartupController';
import type { EmulatorConfig } from '../../types/model.js';
import type { ConfigViewObject } from '../../types/view.js';
import { yamlCodec } from '../../adapter/YamlAdapter';
import { Logger } from '../../utils/Logger';
import { getThemeMode, getAccentColor, applyTheme } from './theme';
import { showAlert, showSaveSuccess } from '../shared/DialogHelper';

export interface ConfigControllerHost {
  readonly configModel: ConfigModel;
  readonly configView: ConfigView;
  readonly setupView: SetupWizardView;
  readonly mainView: MainView;
  readonly scheduler: Scheduler;
  readonly cronScheduler: CronScheduler;
  templateCtrl: TemplateController;
  startupCtrl: StartupController | null;
  configDir: string;
}

export class ConfigController {
  constructor(private readonly host: ConfigControllerHost) {}

  setConfigDir(configDir: string): void {
    this.host.configDir = configDir;
  }

  setStartupController(startupCtrl: StartupController): void {
    this.host.startupCtrl = startupCtrl;
  }

  /** 从磁盘加载 usersettings.yaml */
  async loadConfig(): Promise<void> {
    const bridge = window.electronBridge;
    if (!bridge) return;
    try {
      const yamlStr = await bridge.readFile('usersettings.yaml');
      if (!yamlStr.trim()) {
        Logger.debug('usersettings.yaml 未找到，自动创建默认配置');
        const defaultYaml = this.host.configModel.toYaml();
        await bridge.saveFile('usersettings.yaml', defaultYaml);
        Logger.info(`已创建默认配置文件: ${this.host.configDir}\\usersettings.yaml`);
      } else {
        this.host.configModel.loadFromYaml(yamlStr);
        Logger.debug('usersettings.yaml 已加载');
      }
    } catch {
      Logger.debug('usersettings.yaml 未找到，自动创建默认配置');
      const defaultYaml = this.host.configModel.toYaml();
      await bridge.saveFile('usersettings.yaml', defaultYaml);
      Logger.info(`已创建默认配置文件: ${this.host.configDir}\\usersettings.yaml`);
    }

    const stored = await bridge.getGuiAutomationSettings?.();
    const migrated = this.host.configModel.migratedGuiAutomation;
    if (stored?.exists) {
      this.host.configModel.updateGuiAutomation(stored.settings);
    } else {
      this.host.configModel.updateGuiAutomation(migrated);
      if (Object.keys(migrated).length > 0) {
        await bridge.setGuiAutomationSettings?.(
          this.host.configModel.currentGuiAutomation,
        );
        Logger.info('已将旧版 GUI 调度字段迁移到 gui_settings.json');
      }
    }
    if (Object.keys(migrated).length > 0) {
      await bridge.saveFile('usersettings.yaml', this.host.configModel.toYaml());
    }
  }

  /** 渲染配置视图 */
  renderConfig(): void {
    const cfg = this.host.configModel.current;
    const gui = this.host.configModel.currentGuiAutomation;
    const windowPreferences = window.electronBridge?.getWindowPreferences?.() ?? {
      defaultWidth: 1280,
      defaultHeight: 720,
      rememberBounds: false,
    };
    const vo: ConfigViewObject = {
      emulatorType: cfg.emulator.type,
      emulatorPath: cfg.emulator.path || '',
      emulatorSerial: cfg.emulator.serial || '',
      gameApp: cfg.account.game_app,
      updateMode: window.electronBridge?.getUpdateMode?.()
        ?? (localStorage.getItem('updateMode') === 'manual' ? 'manual' : 'auto'),
      autoExpedition: cfg.daily_automation.auto_expedition,
      expeditionInterval: gui.expeditionInterval,
      autoBattle: cfg.daily_automation.auto_battle,
      battleType: cfg.daily_automation.battle_type,
      autoExercise: cfg.daily_automation.auto_exercise,
      exerciseFleetId: cfg.daily_automation.exercise_fleet_id ?? 1,
      battleTimes: gui.battleTimes,
      autoNormalFight: cfg.daily_automation.auto_normal_fight,
      normalFightTasks: cfg.daily_automation.normal_fight_tasks,
      autoLoot: gui.autoLoot,
      lootPlanIndex: gui.lootPlanIndex,
      lootStopCount: gui.lootStopCount,
      logLevel: cfg.log.level,
      logRoot: cfg.log.root,
      themeMode: getThemeMode(),
      accentColor: getAccentColor(),
      debugMode: localStorage.getItem('debugMode') === 'true',
      backendPort: window.electronBridge?.getBackendPort?.() ?? 8438,
      backendStartupMode: window.electronBridge?.getBackendStartupMode?.() ?? 'managed',
      backendRepoPath: window.electronBridge?.getBackendRepoPath?.() ?? '',
      ocrGpuMode: window.electronBridge?.getOcrGpuMode?.() ?? 'auto',
      ocrGpu: cfg.ocr.gpu,
      ocrMirror: cfg.ocr.mirror,
      ocrConfidence: cfg.ocr.ship_name_match_confidence,
      shipNameAliasesText: this.formatStringMap(
        cfg.ocr.ship_name_aliases,
      ),
      shipNameCorrectionsText: this.formatStringMap(
        cfg.ocr.ship_name_corrections,
      ),
      cudaPath: window.electronBridge?.getCudaPath?.() ?? '',
      saveBackendScreenshots: window.electronBridge?.getSaveBackendScreenshots?.() ?? false,
      pythonPath: window.electronBridge?.getPythonPath?.() ?? '',
      defaultWindowWidth: windowPreferences.defaultWidth,
      defaultWindowHeight: windowPreferences.defaultHeight,
      rememberWindowBounds: windowPreferences.rememberBounds,
      operationDelayMin: cfg.operation_delay_min,
      operationDelayMax: cfg.operation_delay_max,
      dockFullDestroy: cfg.dock_full_destroy,
      repairManually: cfg.repair_manually,
      bathroomCount: cfg.bathroom_count,
      destroyShipWorkMode: cfg.destroy_ship_work_mode,
      destroyShipTypes: cfg.destroy_ship_types,
      removeEquipmentMode: cfg.remove_equipment_mode,
      planRoot: cfg.plan_root ?? '',
    };
    this.host.configView.render(vo);
  }

  /** 保存配置并同步各组件 */
  async saveConfig(): Promise<void> {
    let collected: ConfigViewObject;
    let shipNameAliases: Record<string, string>;
    let shipNameCorrections: Record<string, string>;
    try {
      collected = this.host.configView.collect();
      shipNameAliases = this.parseStringMap(
        collected.shipNameAliasesText,
        '自定义舰名映射',
      );
      shipNameCorrections = this.parseStringMap(
        collected.shipNameCorrectionsText,
        '识别纠错规则',
      );
    } catch (error) {
      await showAlert(
        '设置格式错误',
        error instanceof Error ? error.message : String(error),
      );
      return;
    }
    const bridge = window.electronBridge;
    const saveApis = bridge && [
      bridge.saveFile,
      bridge.setUpdateMode,
      bridge.setBackendPort,
      bridge.setBackendStartupMode,
      bridge.setBackendRepoPath,
      bridge.setOcrGpuMode,
      bridge.setCudaPath,
      bridge.setSaveBackendScreenshots,
      bridge.setPythonPath,
      bridge.setWindowPreferences,
      bridge.setGuiAutomationSettings,
    ];
    if (!bridge || !saveApis || saveApis.some(api => typeof api !== 'function')) {
      await showAlert(
        '保存失败',
        '设置保存接口不完整，请完整重启 GUI 后再操作。',
      );
      return;
    }

    if (collected.backendStartupMode === 'external' && !collected.backendRepoPath.trim()) {
      await showAlert('请配置本地后端路径', '启用“使用本地后端”时必须选择本地后端仓库路径。');
      return;
    }

    try {
    // 界面设置 → localStorage
    localStorage.setItem('themeMode', collected.themeMode);
    localStorage.setItem('accentColor', collected.accentColor);
    localStorage.setItem('debugMode', String(collected.debugMode));
    localStorage.setItem('updateMode', collected.updateMode);
    this.host.mainView.setDebugMode(collected.debugMode);
    applyTheme();

    if (bridge?.setUpdateMode) {
      await bridge.setUpdateMode(collected.updateMode);
    }

    // 后端端口 / Python 路径（修改后需重启）
    if (bridge?.setBackendPort) {
      await bridge.setBackendPort(collected.backendPort);
    }
    if (bridge?.setBackendStartupMode) {
      await bridge.setBackendStartupMode(collected.backendStartupMode);
    }
    if (bridge?.setBackendRepoPath) {
      await bridge.setBackendRepoPath(collected.backendRepoPath || null);
    }
    if (bridge?.setOcrGpuMode) {
      await bridge.setOcrGpuMode(collected.ocrGpuMode);
    }
    if (bridge?.setCudaPath) {
      await bridge.setCudaPath(collected.cudaPath || null);
    }
    if (bridge?.setSaveBackendScreenshots) {
      await bridge.setSaveBackendScreenshots(collected.saveBackendScreenshots);
    }
    if (bridge?.setPythonPath) {
      await bridge.setPythonPath(collected.pythonPath || null);
    }
    if (bridge?.setWindowPreferences) {
      await bridge.setWindowPreferences({
        defaultWidth: collected.defaultWindowWidth,
        defaultHeight: collected.defaultWindowHeight,
        rememberBounds: collected.rememberWindowBounds,
      });
    }

    this.host.configModel.update({
      emulator: {
        type: collected.emulatorType,
        path: collected.emulatorPath || undefined,
        serial: collected.emulatorSerial || undefined,
      },
      account: { game_app: collected.gameApp },
      ocr: {
        ...this.host.configModel.current.ocr,
        gpu: collected.ocrGpu,
        mirror: collected.ocrMirror,
        ship_name_match_confidence: collected.ocrConfidence,
        ship_name_aliases: shipNameAliases,
        ship_name_corrections: shipNameCorrections,
      },
      log: {
        ...this.host.configModel.current.log,
        level: collected.logLevel,
        root: collected.logRoot,
      },
      daily_automation: {
        ...this.host.configModel.current.daily_automation,
        auto_expedition: collected.autoExpedition,
        auto_battle: collected.autoBattle,
        battle_type: collected.battleType,
        auto_exercise: collected.autoExercise,
        exercise_fleet_id: collected.exerciseFleetId,
        auto_normal_fight: collected.autoNormalFight,
        normal_fight_tasks: collected.normalFightTasks,
      },
      operation_delay_min: collected.operationDelayMin,
      operation_delay_max: collected.operationDelayMax,
      dock_full_destroy: collected.dockFullDestroy,
      repair_manually: collected.repairManually,
      bathroom_count: collected.bathroomCount,
      destroy_ship_work_mode: collected.destroyShipWorkMode,
      destroy_ship_types: collected.destroyShipTypes,
      remove_equipment_mode: collected.removeEquipmentMode,
      plan_root: collected.planRoot || undefined,
    });

    this.host.configModel.updateGuiAutomation({
      expeditionInterval: collected.expeditionInterval,
      battleTimes: collected.battleTimes,
      autoLoot: collected.autoLoot,
      lootPlanIndex: collected.lootPlanIndex,
      lootStopCount: collected.lootStopCount,
    });
    await bridge?.setGuiAutomationSettings?.(
      this.host.configModel.currentGuiAutomation,
    );

    // 同步 CronScheduler
    const da = this.host.configModel.current.daily_automation;
    const gui = this.host.configModel.currentGuiAutomation;
    this.host.cronScheduler.updateConfig({
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

    // 自动远征开关与检查间隔
    this.host.scheduler.setAutoExpedition(da.auto_expedition);
    this.host.scheduler.setExpeditionInterval(gui.expeditionInterval);

    const yamlStr = this.host.configModel.toYaml();
    if (collected.debugMode) {
      Logger.debug(`保存配置:\n${yamlStr}`, 'config');
    }

    await bridge.saveFile('usersettings.yaml', yamlStr);

    Logger.info('设置已保存，后端启动项将在重启后生效');
    } catch (error) {
      await showAlert(
        '保存失败',
        error instanceof Error ? error.message : String(error),
      );
      return;
    }
    showSaveSuccess('设置保存成功');

    // 未连接 → 尝试重连
    if (this.host.scheduler.status === 'not_connected') {
      const alive = await this.host.scheduler.ping();
      if (alive) {
        Logger.info('配置已更新，正在重新连接模拟器…');
        this.host.startupCtrl?.startSystem();
      } else {
        Logger.warn('后端未运行，请重启应用');
      }
    }
  }

  /** 自动检测模拟器信息，仅在配置为空时填充 */
  async detectAndApplyEmulator(): Promise<void> {
    const bridge = window.electronBridge;
    if (!bridge?.detectEmulator) return;

    const cfg = this.host.configModel.current;
    if (cfg.emulator.path && cfg.emulator.serial) return;

    try {
      const result = await bridge.detectEmulator();
      if (!result) return;

      const patch: Partial<EmulatorConfig> = {};
      if (!cfg.emulator.path && result.path) patch.path = result.path;
      if (!cfg.emulator.serial && result.serial) patch.serial = result.serial;
      if (result.type) patch.type = result.type;

      if (Object.keys(patch).length > 0) {
        this.host.configModel.update({
          emulator: { ...cfg.emulator, ...patch },
        });
        const yamlStr = this.host.configModel.toYaml();
        await bridge.saveFile('usersettings.yaml', yamlStr);
        Logger.debug(`自动检测到模拟器: type=${result.type} path=${result.path} serial=${result.serial}`);
      }
    } catch (e) {
      Logger.debug(`模拟器自动检测失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** 首次运行引导向导 */
  showSetupWizard(): Promise<void> {
    const cfg = this.host.configModel.current;
    this.host.setupView.show({
      emuType: cfg.emulator.type || '雷电',
      serial: cfg.emulator.serial || '',
      pythonPath: '',
    });

    return new Promise<void>((resolve) => {
      this.host.setupView.onCheckAdb = async () => {
        const bridge = window.electronBridge;
        if (!bridge?.checkAdbDevices) return;
        this.host.setupView.setCheckAdbLoading(true);
        try {
          const devices = await bridge.checkAdbDevices();
          const online = devices.filter(d => d.status === 'device');
          if (online.length > 0) {
            this.host.setupView.setSerialValue(online[0].serial);
            this.host.setupView.setSerialHint(`已检测到设备: ${online.map(d => d.serial).join(', ')}`, 'info');
          } else {
            this.host.setupView.setSerialHint('未发现在线设备，请确认模拟器已启动。', 'error');
          }
        } catch {
          this.host.setupView.setSerialHint('检测失败，请手动填写。', 'error');
        } finally {
          this.host.setupView.setCheckAdbLoading(false);
        }
      };

      this.host.setupView.onConfirm = async () => {
        const vals = this.host.setupView.collectValues();
        if (!vals.serial) {
          this.host.setupView.setSerialHint('请填写 ADB serial（不能为空）', 'error');
          this.host.setupView.focusSerial();
          return;
        }

        this.host.configModel.update({
          emulator: {
            type: vals.emuType,
            serial: vals.serial,
          },
        });

        const pyPath = vals.pythonPath || null;
        if (window.electronBridge?.setPythonPath) {
          await window.electronBridge.setPythonPath(pyPath);
        }

        const bridge = window.electronBridge;
        if (bridge) {
          await bridge.saveFile('usersettings.yaml', this.host.configModel.toYaml());
        }

        localStorage.setItem('setupComplete', 'true');
        this.host.setupView.hide();
        Logger.info(`初始配置完成: 模拟器=${vals.emuType}, serial=${vals.serial}`);
        resolve();
      };
    });
  }

  private formatStringMap(value: Record<string, string>): string {
    if (Object.keys(value).length === 0) return '';
    return yamlCodec.stringify(
      value,
      { lineWidth: -1, noRefs: true },
    ).trim();
  }

  private parseStringMap(
    source: string,
    label: string,
  ): Record<string, string> {
    if (!source.trim()) return {};
    let parsed: unknown;
    try {
      parsed = yamlCodec.parse<unknown>(source);
    } catch (error) {
      throw new Error(
        `${label}不是合法 YAML: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`${label}必须使用“识别名称: 标准名称”的映射格式`);
    }
    const output: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (!key.trim() || typeof value !== 'string' || !value.trim()) {
        throw new Error(`${label}中的键和值都必须是非空文字`);
      }
      output[key.trim()] = value.trim();
    }
    return output;
  }
}
