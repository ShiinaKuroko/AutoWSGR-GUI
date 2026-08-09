/**
 * 连接 GUI 自动更新 IPC 与 electron-updater。
 */
import {
  autoUpdater,
  type ProgressInfo,
  type UpdateInfo,
} from 'electron-updater';
import type { IpcRegistrar } from './IpcRegistrar';
import {
  classifyGuiUpdateCheck,
  resolveGuiReleasePolicy,
  validateGuiUpdateCandidate,
} from '../services/GuiUpdatePolicy';

export interface UpdaterContext {
  sendToRenderer(channel: string, ...args: unknown[]): boolean;
  getAppVersion(): string;
  getUpdateMode(): 'auto' | 'manual';
  chooseInstallTiming(
    version: string,
  ): Promise<'now' | 'next-launch'>;
  prepareForUpdateInstall(): Promise<void>;
}

/** 注册 GUI 更新事件和 IPC。 */
export function registerUpdaterIpc(
  ipc: IpcRegistrar,
  context: UpdaterContext,
): void {
  const releasePolicy = resolveGuiReleasePolicy(context.getAppVersion());
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.channel = releasePolicy.channel;
  autoUpdater.allowPrerelease = releasePolicy.allowPrerelease;
  autoUpdater.allowDowngrade = false;

  let approvedUpdateVersion: string | null = null;
  let downloadedUpdateVersion: string | null = null;
  let installingUpdate = false;
  let choosingInstallTiming = false;
  const reportError = (message: string): void => {
    context.sendToRenderer('update-status', {
      status: 'error',
      message,
    });
  };
  const installDownloadedUpdate = async (): Promise<{
    success: boolean;
    message?: string;
  }> => {
    if (!downloadedUpdateVersion) {
      return {
        success: false,
        message: '没有已下载并通过频道校验的更新',
      };
    }
    if (installingUpdate) return { success: true };

    installingUpdate = true;
    autoUpdater.autoInstallOnAppQuit = false;
    context.sendToRenderer('update-status', {
      status: 'installing',
      message: '正在停止当前任务并准备安装更新',
    });
    try {
      await context.prepareForUpdateInstall();
      autoUpdater.quitAndInstall(false, true);
      return { success: true };
    } catch (error) {
      installingUpdate = false;
      autoUpdater.autoInstallOnAppQuit = true;
      const message = error instanceof Error
        ? error.message
        : String(error);
      reportError(`无法安全停止后端，将在下次打开前更新：${message}`);
      return { success: false, message };
    }
  };
  const chooseInstallTiming = async (version: string): Promise<void> => {
    if (choosingInstallTiming || installingUpdate) return;
    choosingInstallTiming = true;
    try {
      const timing = await context.chooseInstallTiming(version);
      if (timing === 'now') {
        await installDownloadedUpdate();
        return;
      }
      autoUpdater.autoInstallOnAppQuit = true;
      context.sendToRenderer('update-status', {
        status: 'deferred',
        version,
      });
    } catch (error) {
      autoUpdater.autoInstallOnAppQuit = true;
      const message = error instanceof Error
        ? error.message
        : String(error);
      reportError(`无法显示更新时间选择，将在下次打开前更新：${message}`);
    } finally {
      choosingInstallTiming = false;
    }
  };

  autoUpdater.on('checking-for-update', () => {
    context.sendToRenderer('update-status', {
      status: 'checking',
    });
  });
  autoUpdater.on('update-available', (info: UpdateInfo) => {
    const mismatch = validateGuiUpdateCandidate(
      releasePolicy,
      info.version,
    );
    if (mismatch) {
      approvedUpdateVersion = null;
      reportError(mismatch);
      return;
    }
    approvedUpdateVersion = info.version;
    context.sendToRenderer('update-status', {
      status: 'available',
      version: info.version,
      releaseNotes: typeof info.releaseNotes === 'string'
        ? info.releaseNotes
        : '',
    });
  });
  autoUpdater.on('update-not-available', () => {
    approvedUpdateVersion = null;
    downloadedUpdateVersion = null;
    context.sendToRenderer('update-status', {
      status: 'up-to-date',
    });
  });
  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    context.sendToRenderer('update-status', {
      status: 'downloading',
      percent: Math.round(progress.percent),
      transferred: progress.transferred,
      total: progress.total,
    });
  });
  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    const mismatch = validateGuiUpdateCandidate(
      releasePolicy,
      info.version,
    );
    if (mismatch) {
      downloadedUpdateVersion = null;
      reportError(mismatch);
      return;
    }
    downloadedUpdateVersion = info.version;
    // electron-updater 会在本事件返回后决定是否注册退出安装钩子。
    // 先启用以保证“下一次打开”可用；选择“现在更新”时会立即关闭。
    autoUpdater.autoInstallOnAppQuit = true;
    context.sendToRenderer('update-status', {
      status: 'downloaded',
      version: info.version,
    });
    void chooseInstallTiming(info.version);
  });
  autoUpdater.on('error', (error: Error) => {
    approvedUpdateVersion = null;
    downloadedUpdateVersion = null;
    reportError(error.message);
  });

  ipc.handle('check-gui-updates', async () => {
    try {
      // 自动下载由主进程直接控制，避免依赖渲染进程收到事件后再次发起 IPC。
      autoUpdater.autoDownload = context.getUpdateMode() === 'auto';
      const result = await autoUpdater.checkForUpdates();
      const classified = classifyGuiUpdateCheck(
        releasePolicy,
        result,
      );
      approvedUpdateVersion = classified.status === 'available'
        ? classified.version
        : null;
      return classified;
    } catch (error) {
      approvedUpdateVersion = null;
      const message = error instanceof Error
        ? error.message
        : String(error);
      reportError(message);
      return {
        status: 'error',
        message,
      };
    }
  });

  ipc.handle('download-gui-update', async () => {
    if (!approvedUpdateVersion) {
      return {
        success: false,
        message: '当前频道没有已确认可下载的更新',
      };
    }
    try {
      await autoUpdater.downloadUpdate();
      return { success: true };
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : String(error);
      reportError(message);
      return {
        success: false,
        message,
      };
    }
  });

  ipc.handle('install-gui-update', async () => {
    return installDownloadedUpdate();
  });
}
