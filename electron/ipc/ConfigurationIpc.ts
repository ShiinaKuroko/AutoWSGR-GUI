/**
 * 连接 GUI 配置 IPC 与配置、环境和窗口服务。
 */
import type { CudaEnvironmentService } from '../services/CudaEnvironmentService';
import type {
  BackendStartupMode,
  GuiAutomationSettings,
  GuiConfigurationService,
  OcrGpuMode,
  UpdateMode,
} from '../services/GuiConfigurationService';
import type { PythonEnvironmentService } from '../services/PythonEnvironmentService';
import type {
  WindowPreferences,
  WindowService,
} from '../services/WindowService';
import type {
  LegacyDecisiveAutomationSettings,
} from '../../src/shared/legacyDecisiveAutomation';
import type {
  DecisivePlanSettings,
} from '../../src/shared/decisivePlan';
import type {
  GuiSettingsCommitRequest,
  GuiSettingsCommitResult,
} from '../../src/types/ipc';
import type { SecureFileService } from '../services/SecureFileService';
import type { IpcRegistrar } from './IpcRegistrar';

export interface ConfigurationIpcDependencies {
  getAppVersion(): string;
  backendPort: number;
  configuration: GuiConfigurationService;
  cudaEnvironment: CudaEnvironmentService;
  pythonEnvironment: PythonEnvironmentService;
  secureFiles: SecureFileService;
  windows: WindowService;
}

/** 注册同步配置 getter 和异步配置操作。 */
export function registerConfigurationIpc(
  ipc: IpcRegistrar,
  dependencies: ConfigurationIpcDependencies,
): void {
  const configuration = dependencies.configuration;

  ipc.on('get-app-version-sync', (event) => {
    event.returnValue = dependencies.getAppVersion();
  });

  ipc.on('get-backend-port-sync', (event) => {
    event.returnValue = dependencies.backendPort;
  });

  ipc.on('get-backend-startup-mode-sync', (event) => {
    event.returnValue = configuration.backendStartupMode();
  });

  ipc.on('get-backend-repo-path-sync', (event) => {
    event.returnValue = configuration.backendRepoPath();
  });

  ipc.on('get-ocr-gpu-mode-sync', (event) => {
    event.returnValue = configuration.ocrGpuMode();
  });

  ipc.on('get-cuda-path-sync', (event) => {
    event.returnValue = configuration.cudaPath();
  });

  ipc.on('get-save-backend-screenshots-sync', (event) => {
    event.returnValue = configuration.saveBackendScreenshots();
  });

  ipc.on('get-window-preferences-sync', (event) => {
    event.returnValue = dependencies.windows.getPreferences();
  });

  ipc.handle(
    'set-window-preferences',
    (_event, preferences: Partial<WindowPreferences>) => {
      return dependencies.windows.setPreferences(preferences);
    },
  );

  ipc.handle('get-gui-automation-settings', () => {
    return configuration.automation();
  });

  ipc.handle(
    'set-gui-automation-settings',
    (_event, settings: GuiAutomationSettings) => {
      return configuration.setAutomation(settings);
    },
  );

  ipc.handle(
    'commit-gui-settings',
    (
      _event,
      settings: GuiSettingsCommitRequest,
    ): GuiSettingsCommitResult => {
      if (
        !settings
        || typeof settings !== 'object'
        || typeof settings.usersettingsYaml !== 'string'
      ) {
        throw new Error('设置提交内容无效');
      }
      const preparedWindow = dependencies.windows.preparePreferences(
        settings.windowPreferences,
      );
      const yamlSnapshot = dependencies.secureFiles.snapshot(
        'usersettings.yaml',
      );
      dependencies.secureFiles.save(
        'usersettings.yaml',
        settings.usersettingsYaml,
      );
      try {
        const automation = configuration.commitSettings(
          settings,
          preparedWindow.settingsPatch,
        );
        return {
          automation,
          windowPreferences: preparedWindow.preferences,
        };
      } catch (error) {
        try {
          dependencies.secureFiles.restore(
            'usersettings.yaml',
            yamlSnapshot,
          );
        } catch (rollbackError) {
          throw new Error(
            `设置提交失败，且 usersettings.yaml 恢复失败: ${
              rollbackError instanceof Error
                ? rollbackError.message
                : String(rollbackError)
            }；原始错误: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
        throw error;
      }
    },
  );

  ipc.handle(
    'migrate-legacy-decisive-automation',
    (_event, settings: LegacyDecisiveAutomationSettings) => {
      return configuration.migrateLegacyDecisiveAutomation(settings);
    },
  );

  ipc.handle('get-decisive-plan-settings', () => {
    return configuration.decisivePlan();
  });

  ipc.handle(
    'set-decisive-plan-settings',
    (_event, settings: DecisivePlanSettings) => {
      return configuration.setDecisivePlan(settings);
    },
  );

  ipc.handle('set-backend-port', (_event, port: number) => {
    configuration.setBackendPort(port);
  });

  ipc.handle(
    'set-backend-startup-mode',
    (_event, mode: BackendStartupMode) => {
      configuration.setBackendStartupMode(mode);
    },
  );

  ipc.handle(
    'set-backend-repo-path',
    (_event, repoPath: string | null) => {
      configuration.setBackendRepoPath(repoPath);
    },
  );

  ipc.handle(
    'set-ocr-gpu-mode',
    (_event, mode: OcrGpuMode) => {
      configuration.setOcrGpuMode(mode);
    },
  );

  ipc.handle(
    'set-cuda-path',
    (_event, cudaPath: string | null) => {
      configuration.setCudaPath(cudaPath);
    },
  );

  ipc.handle(
    'validate-cuda-path',
    async (_event, cudaPath: string) => {
      return dependencies.cudaEnvironment.detect(cudaPath);
    },
  );

  ipc.handle(
    'set-save-backend-screenshots',
    (_event, enabled: boolean) => {
      configuration.setSaveBackendScreenshots(enabled);
    },
  );

  ipc.on('get-python-path-sync', (event) => {
    event.returnValue = configuration.configuredPythonPath();
  });

  ipc.on('get-update-mode-sync', (event) => {
    event.returnValue = configuration.updateMode();
  });

  ipc.handle(
    'set-update-mode',
    (_event, mode: UpdateMode) => {
      configuration.setUpdateMode(mode);
    },
  );

  ipc.handle(
    'set-python-path',
    (_event, pythonPath: string | null) => {
      configuration.setPythonPath(pythonPath);
    },
  );

  ipc.handle(
    'validate-python',
    async (_event, pythonPath: string) => {
      return dependencies.pythonEnvironment.validate(pythonPath);
    },
  );
}
