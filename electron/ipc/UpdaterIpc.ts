/**
 * 连接 GUI 自动更新 IPC 与 electron-updater。
 */
import type { BrowserWindow } from 'electron';
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
  getMainWindow(): BrowserWindow | null;
  getAppVersion(): string;
  stopBackend(): Promise<void>;
}

/** 注册 GUI 更新事件和 IPC。 */
export function registerUpdaterIpc(
  ipc: IpcRegistrar,
  context: UpdaterContext,
): void {
  const releasePolicy = resolveGuiReleasePolicy(context.getAppVersion());
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.channel = releasePolicy.channel;
  autoUpdater.allowPrerelease = releasePolicy.allowPrerelease;
  autoUpdater.allowDowngrade = false;

  let approvedUpdateVersion: string | null = null;
  let downloadedUpdateVersion: string | null = null;
  const reportError = (message: string): void => {
    context.getMainWindow()?.webContents.send('update-status', {
      status: 'error',
      message,
    });
  };

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
    context.getMainWindow()?.webContents.send('update-status', {
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
    context.getMainWindow()?.webContents.send('update-status', {
      status: 'up-to-date',
    });
  });
  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    context.getMainWindow()?.webContents.send('update-status', {
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
    context.getMainWindow()?.webContents.send('update-status', {
      status: 'downloaded',
      version: info.version,
    });
  });
  autoUpdater.on('error', (error: Error) => {
    approvedUpdateVersion = null;
    downloadedUpdateVersion = null;
    reportError(error.message);
  });

  ipc.handle('check-gui-updates', async () => {
    try {
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
      return {
        status: 'error',
        message: error instanceof Error
          ? error.message
          : String(error),
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
      return {
        success: false,
        message: error instanceof Error
          ? error.message
          : String(error),
      };
    }
  });

  ipc.handle('install-gui-update', async () => {
    if (!downloadedUpdateVersion) {
      return {
        success: false,
        message: '没有已下载并通过频道校验的更新',
      };
    }
    context.getMainWindow()?.webContents.send('update-status', {
      status: 'installing',
      message: '正在停止后端并准备安装更新',
    });
    try {
      await context.stopBackend();
      autoUpdater.quitAndInstall(false, true);
      return { success: true };
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : String(error);
      reportError(`无法安全停止后端，已取消更新安装：${message}`);
      return { success: false, message };
    }
  });
}
