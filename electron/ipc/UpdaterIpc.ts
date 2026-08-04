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

export interface UpdaterContext {
  getMainWindow(): BrowserWindow | null;
  getAppVersion(): string;
  hasBackendProcess(): boolean;
  stopBackend(): Promise<void>;
}

/** 注册 GUI 更新事件和 IPC。 */
export function registerUpdaterIpc(
  ipc: IpcRegistrar,
  context: UpdaterContext,
): void {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = context
    .getAppVersion()
    .includes('-');

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    context.getMainWindow()?.webContents.send('update-status', {
      status: 'available',
      version: info.version,
      releaseNotes: typeof info.releaseNotes === 'string'
        ? info.releaseNotes
        : '',
    });
  });
  autoUpdater.on('update-not-available', () => {
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
    context.getMainWindow()?.webContents.send('update-status', {
      status: 'downloaded',
      version: info.version,
    });
  });
  autoUpdater.on('error', (error: Error) => {
    context.getMainWindow()?.webContents.send('update-status', {
      status: 'error',
      message: error.message,
    });
  });

  ipc.handle('check-gui-updates', async () => {
    try {
      const result = await autoUpdater.checkForUpdates();
      return result?.updateInfo
        ? {
            status: 'available',
            version: result.updateInfo.version,
          }
        : { status: 'up-to-date' };
    } catch (error) {
      return {
        status: 'error',
        message: error instanceof Error
          ? error.message
          : String(error),
      };
    }
  });

  ipc.handle('download-gui-update', async () => {
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
    context.getMainWindow()?.webContents.send('update-status', {
      status: 'installing',
      message: '正在停止后端并准备安装更新',
    });
    if (context.hasBackendProcess()) {
      await context.stopBackend();
    }
    autoUpdater.quitAndInstall(false, true);
    return { success: true };
  });
}
