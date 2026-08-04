/** 编排设置页的环境检测、设备连接、资料库更新和主题交互。 */
import type { ConfigView } from '../../view/config/ConfigView';
import type { ManagedBattlePlanSelection } from '../../types/ipc.js';
import { ApiClient } from '../../model/ApiClient';
import { Logger } from '../../utils/Logger';
import { showAlert, showConfirm } from '../shared/DialogHelper';
import { applyTheme } from './theme';

export interface SettingsControllerHost {
  readonly configView: ConfigView;
  getConfigDir(): string;
  saveConfig(): Promise<void>;
  pickAutomationPlan(): Promise<ManagedBattlePlanSelection | null>;
  reloadShipLibrary(): Promise<void>;
}

export class SettingsController {
  private shipLibraryUpdating = false;

  constructor(private readonly host: SettingsControllerHost) {}

  bindActions(): void {
    const { configView } = this.host;
    window.electronBridge?.onShipLibraryUpdateProgress?.((progress) => {
      if (this.shipLibraryUpdating) {
        configView.setShipLibraryStatus(progress.message, 'unknown');
      }
    });

    document.getElementById('btn-save-config')?.addEventListener(
      'click',
      () => void this.host.saveConfig(),
    );
    document.getElementById('btn-open-config-dir')?.addEventListener(
      'click',
      () => this.openFolder(this.host.getConfigDir()),
    );
    document.getElementById('btn-browse-emu')?.addEventListener(
      'click',
      () => void this.browseDirectory(
        '选择模拟器安装目录',
        path => configView.setEmulatorPath(path),
      ),
    );
    document.getElementById('btn-browse-python')?.addEventListener(
      'click',
      () => void this.browsePython(),
    );
    document.getElementById('btn-browse-backend-repo')?.addEventListener(
      'click',
      () => void this.browseDirectory(
        '选择本地后端仓库目录',
        path => configView.setBackendRepoPath(path),
      ),
    );
    document.getElementById('btn-browse-cuda')?.addEventListener(
      'click',
      () => void this.browseDirectory(
        '选择 CUDA Toolkit 根目录/bin 或 PyTorch torch\\lib 目录',
        path => configView.setCudaPath(path),
      ),
    );
    document.getElementById('btn-browse-log-root')?.addEventListener(
      'click',
      () => void this.browseDirectory(
        '选择后端日志目录',
        path => configView.setLogRoot(path),
      ),
    );
    document.getElementById('btn-browse-plan-root')?.addEventListener(
      'click',
      () => void this.browseDirectory(
        '选择后端作战方案根目录',
        path => configView.setPlanRoot(path),
      ),
    );
    document.getElementById('btn-add-normal-fight-task')?.addEventListener(
      'click',
      () => void this.selectAutomationPlan(),
    );
    document.getElementById('btn-check-backend')?.addEventListener(
      'click',
      () => void this.checkBackend(),
    );
    document.getElementById('btn-validate-cuda')?.addEventListener(
      'click',
      () => void this.validateCuda(),
    );
    document.getElementById('btn-validate-python')?.addEventListener(
      'click',
      () => void this.validatePython(),
    );
    document.getElementById('btn-check-updates')?.addEventListener(
      'click',
      () => void this.checkUpdatesManually(),
    );
    document.getElementById('btn-update-ship-library')?.addEventListener(
      'click',
      () => void this.updateShipLibrary(),
    );
    document.getElementById('btn-connect-adb')?.addEventListener(
      'click',
      () => void this.changeAdbConnection('connect'),
    );
    document.getElementById('btn-disconnect-adb')?.addEventListener(
      'click',
      () => void this.changeAdbConnection('disconnect'),
    );
    document.getElementById('btn-check-adb')?.addEventListener(
      'click',
      () => void this.checkAdbDevices(),
    );
    document.getElementById('btn-reset-accent')?.addEventListener(
      'click',
      () => {
        configView.resetAccentColor('#0f7dff');
        localStorage.setItem('accentColor', '#0f7dff');
        applyTheme();
      },
    );
    document.getElementById('cfg-theme-mode')?.addEventListener(
      'change',
      (event) => {
        localStorage.setItem(
          'themeMode',
          (event.target as HTMLSelectElement).value,
        );
        applyTheme();
      },
    );
    document.getElementById('cfg-accent-color')?.addEventListener(
      'input',
      (event) => {
        localStorage.setItem(
          'accentColor',
          (event.target as HTMLInputElement).value,
        );
        applyTheme();
      },
    );
  }

  async refreshAdbStatus(): Promise<void> {
    const { configView } = this.host;
    configView.setAdbStatus('检测中…', 'unknown');
    const bridge = window.electronBridge;
    if (!bridge?.checkAdbDevices) {
      configView.setAdbStatus('ADB 功能不可用', 'offline');
      return;
    }
    try {
      const devices = await bridge.checkAdbDevices();
      const online = devices.filter(device => device.status === 'device');
      const configuredSerial = configView.getEmulatorSerial();
      if (
        configuredSerial
        && online.some(device => device.serial === configuredSerial)
      ) {
        configView.setAdbStatus(
          `在线 (${configuredSerial})`,
          'online',
        );
      } else if (online.length > 0) {
        configView.setAdbStatus(
          `当前地址未连接（发现 ${online.map(device => device.serial).join(', ')}）`,
          'offline',
        );
      } else {
        configView.setAdbStatus('未发现在线设备', 'offline');
      }
    } catch {
      configView.setAdbStatus('ADB 检测失败', 'offline');
    }
  }

  async refreshShipLibraryStatus(): Promise<void> {
    if (this.shipLibraryUpdating) return;
    const bridge = window.electronBridge;
    if (!bridge?.getShipLibraryStatus) return;
    try {
      const status = await bridge.getShipLibraryStatus();
      if (status.error) {
        this.host.configView.setShipLibraryStatus(status.error, 'error');
      } else if (!status.exists) {
        this.host.configView.setShipLibraryStatus(
          '尚未建立本地资料库',
          'unknown',
        );
      } else if (status.missingAssets > 0) {
        this.host.configView.setShipLibraryStatus(
          `已收录 ${status.shipCount} 艘，缺少 ${status.missingAssets} 个资源`,
          'error',
        );
      } else {
        const updatedAt = status.generatedAt
          ? new Date(status.generatedAt).toLocaleString(
            'zh-CN',
            { hour12: false },
          )
          : '时间未知';
        this.host.configView.setShipLibraryStatus(
          `已收录 ${status.shipCount} 艘 · ${updatedAt}`,
          'ok',
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.host.configView.setShipLibraryStatus(
        `状态读取失败: ${message}`,
        'error',
      );
    }
  }

  private async browseDirectory(
    title: string,
    applyPath: (path: string) => void,
  ): Promise<void> {
    const path = await window.electronBridge?.openDirectoryDialog(title);
    if (path) applyPath(path);
  }

  private async browsePython(): Promise<void> {
    const bridge = window.electronBridge;
    if (!bridge) return;
    const result = await bridge.openFileDialog([
      { name: 'Python', extensions: ['exe'] },
    ]);
    if (result) this.host.configView.setPythonPath(result.path);
  }

  private async selectAutomationPlan(): Promise<void> {
    const selected = await this.host.pickAutomationPlan();
    if (!selected) return;
    try {
      const result = await window.electronBridge?.readManagedCombatPlan(
        selected.plan.source,
        selected.plan.file,
      );
      if (!result?.success || !result.path) {
        throw new Error(result?.error || '无法读取所选出征计划');
      }
      const fleetPresetIndex = selected.fleetPresetIndex;
      if (fleetPresetIndex === undefined) {
        throw new Error('自动出征计划必须选择使用舰队');
      }
      const fleetName = selected.plan.fleets[fleetPresetIndex]?.name;
      if (!fleetName) throw new Error('所选使用舰队不存在');
      this.host.configView.setNormalFightPlan(
        result.path,
        fleetPresetIndex,
        fleetName,
      );
    } catch (error) {
      await showAlert(
        '无法加载出征计划',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private async checkBackend(): Promise<void> {
    const button = document.getElementById(
      'btn-check-backend',
    ) as HTMLButtonElement | null;
    if (!button) return;
    const port = this.host.configView.getBackendPort();
    button.disabled = true;
    button.textContent = '检测中…';
    this.host.configView.setBackendStatus('正在连接', 'unknown');
    try {
      const result = await new ApiClient(
        `http://localhost:${port}`,
      ).health();
      this.host.configView.setBackendStatus(
        result.success
          ? '接口正常'
          : (result.error || result.message || '接口异常'),
        result.success ? 'ok' : 'error',
      );
    } catch {
      this.host.configView.setBackendStatus('无法连接', 'error');
    } finally {
      button.disabled = false;
      button.textContent = '检测';
    }
  }

  private async validateCuda(): Promise<void> {
    const bridge = window.electronBridge;
    if (!bridge?.validateCudaPath) return;
    const { configView } = this.host;
    const cudaPath = configView.getCudaPath();
    configView.setCudaValidateLoading(true);
    configView.setCudaStatus(
      '检测中',
      'unknown',
      '正在检测 PyTorch、CUDA 和显卡',
    );
    try {
      const result = await bridge.validateCudaPath(cudaPath);
      if (result.valid) {
        if (result.path) configView.setCudaPath(result.path);
        const details = [
          result.device ?? 'CUDA 可用',
          result.version ? `CUDA ${result.version}` : null,
          result.torchVersion ? `PyTorch ${result.torchVersion}` : null,
        ].filter(Boolean);
        configView.setCudaStatus(
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
          : error.includes('路径')
            || error.includes('目录')
            || error.includes('Runtime DLL')
            ? '路径无效'
            : '检测失败';
        configView.setCudaStatus(shortStatus, 'error', error);
      }
    } catch {
      configView.setCudaStatus('检测失败', 'error', '硬件检测失败');
    } finally {
      configView.setCudaValidateLoading(false);
    }
  }

  private async validatePython(): Promise<void> {
    const bridge = window.electronBridge;
    if (!bridge?.validatePython) return;
    const { configView } = this.host;
    const pythonPath = configView.getPythonPath();
    if (!pythonPath) {
      configView.setPythonStatus('"留空"将自动检测', 'unknown');
      return;
    }
    configView.setPythonValidateLoading(true);
    try {
      const result = await bridge.validatePython(pythonPath);
      configView.setPythonStatus(
        result.valid ? `✓ ${result.version}` : (result.error ?? '不兼容'),
        result.valid ? 'ok' : 'error',
      );
    } catch {
      configView.setPythonStatus('检测失败', 'error');
    } finally {
      configView.setPythonValidateLoading(false);
    }
  }

  private async checkAdbDevices(): Promise<void> {
    const bridge = window.electronBridge;
    if (!bridge?.checkAdbDevices) return;
    const button = document.getElementById(
      'btn-check-adb',
    ) as HTMLButtonElement | null;
    if (!button) return;
    button.disabled = true;
    button.textContent = '检测中…';
    try {
      const devices = await bridge.checkAdbDevices();
      const online = devices.filter(device => device.status === 'device');
      if (online.length === 0) {
        await showAlert(
          'ADB 检测',
          '未发现在线设备。\n请确认模拟器已启动。',
        );
      } else if (online.length === 1) {
        this.host.configView.setEmulatorSerial(online[0].serial);
        this.host.configView.setAdbStatus(
          `在线 (${online[0].serial})`,
          'online',
        );
        Logger.info(`ADB 检测到在线设备: ${online[0].serial}，已自动填入`);
      } else {
        const list = online.map(device => device.serial).join('\n');
        const confirmed = await showConfirm(
          'ADB 检测',
          `发现 ${online.length} 个在线设备：\n\n${list}\n\n是否将第一个设备填入 serial？`,
        );
        if (confirmed) {
          this.host.configView.setEmulatorSerial(online[0].serial);
          this.host.configView.setAdbStatus(
            `在线 (${online[0].serial})`,
            'online',
          );
        }
      }
    } catch (error) {
      await showAlert(
        'ADB 检测失败',
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      button.disabled = false;
      button.textContent = '检测 ADB';
    }
  }

  private async changeAdbConnection(
    action: 'connect' | 'disconnect',
  ): Promise<void> {
    const bridge = window.electronBridge;
    const method = action === 'connect'
      ? bridge?.connectAdbDevice
      : bridge?.disconnectAdbDevice;
    if (!method) return;

    const serial = this.host.configView.getEmulatorSerial();
    if (!serial) {
      await showAlert(
        'ADB 地址为空',
        '请先填写 ADB 地址，例如 127.0.0.1:16384。',
      );
      return;
    }

    const buttonId = action === 'connect'
      ? 'btn-connect-adb'
      : 'btn-disconnect-adb';
    const button = document.getElementById(
      buttonId,
    ) as HTMLButtonElement | null;
    const originalText = button?.textContent ?? '';
    if (button) {
      button.disabled = true;
      button.textContent = action === 'connect' ? '连接中…' : '断开中…';
    }
    this.host.configView.setAdbStatus(
      action === 'connect' ? '正在连接' : '正在断开',
      'unknown',
    );

    try {
      const result = await method(serial);
      if (result.success) {
        const connected = action === 'connect';
        this.host.configView.setAdbStatus(
          connected ? `在线 (${serial})` : '已断开',
          connected ? 'online' : 'offline',
        );
        Logger.info(`ADB ${connected ? '连接' : '断开'}成功: ${serial}`);
      } else {
        this.host.configView.setAdbStatus(
          `${action === 'connect' ? '连接' : '断开'}失败`,
          'offline',
        );
        await showAlert(
          `ADB ${action === 'connect' ? '连接' : '断开'}失败`,
          result.message,
        );
      }
    } catch (error) {
      this.host.configView.setAdbStatus('ADB 命令执行失败', 'offline');
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

  private async updateShipLibrary(): Promise<void> {
    const bridge = window.electronBridge;
    if (!bridge?.updateShipLibrary || this.shipLibraryUpdating) return;
    this.shipLibraryUpdating = true;
    this.host.configView.setShipLibraryUpdateLoading(true);
    this.host.configView.setShipLibraryStatus(
      '正在准备更新…',
      'unknown',
    );
    try {
      const result = await bridge.updateShipLibrary();
      if (!result.success) {
        const message = result.error || result.failures?.[0] || '未知错误';
        this.host.configView.setShipLibraryStatus(
          `更新失败: ${message}`,
          'error',
        );
        Logger.error(`舰船资料库更新失败: ${message}`);
        return;
      }
      const summary = [
        `${result.ship_count ?? 0} 艘`,
        `新增 ${result.added ?? 0}`,
        `变化 ${result.updated ?? 0}`,
        `下载 ${result.downloaded ?? 0}`,
      ].join('，');
      this.host.configView.setShipLibraryStatus(
        `更新完成：${summary}`,
        'ok',
      );
      Logger.info(`舰船资料库更新完成：${summary}`);
      await this.host.reloadShipLibrary();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.host.configView.setShipLibraryStatus(
        `更新失败: ${message}`,
        'error',
      );
      Logger.error(`舰船资料库更新异常: ${message}`);
    } finally {
      this.shipLibraryUpdating = false;
      this.host.configView.setShipLibraryUpdateLoading(false);
    }
  }

  private async checkUpdatesManually(): Promise<void> {
    const bridge = window.electronBridge;
    if (!bridge) return;
    const updateMode = bridge.getUpdateMode?.() ?? 'auto';
    const button = document.getElementById(
      'btn-check-updates',
    ) as HTMLButtonElement | null;
    if (button) {
      button.disabled = true;
      button.textContent = '检查中…';
    }

    try {
      Logger.info('已跳过后端源码更新检查（测试接口已停用）');
      try {
        const guiUpdate = await bridge.checkGuiUpdates?.();
        if (guiUpdate?.status === 'error') {
          Logger.warn(`GUI 更新检查失败: ${guiUpdate.message}`);
          return;
        }
        if (updateMode === 'auto') {
          if (guiUpdate?.status === 'available') {
            Logger.info(
              `检测到 GUI 新版本 v${guiUpdate.version}，自动模式下将自动下载`,
            );
          } else {
            Logger.info('GUI 已是最新版本');
          }
          return;
        }
        if (guiUpdate?.status === 'available') {
          const confirmed = await showConfirm(
            'GUI 更新',
            `发现 GUI 新版本 v${guiUpdate.version}，是否立即下载？`,
          );
          if (confirmed) {
            const result = await bridge.downloadGuiUpdate?.();
            if (result?.success) {
              Logger.info(`GUI 更新下载开始: v${guiUpdate.version}`);
            } else {
              Logger.warn(
                `GUI 更新下载失败: ${result?.message || '未知错误'}`,
              );
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
      if (button) {
        button.disabled = false;
        button.textContent = '立即检查更新';
      }
    }
  }

  private openFolder(folderPath: string): void {
    if (!folderPath) return;
    window.electronBridge?.openFolder?.(folderPath);
  }
}
