/**
 * 读取、归一化并保存 GUI 业务设置。
 */
import { GuiSettingsStore } from './GuiSettingsStore';

export type BackendStartupMode = 'managed' | 'external';
export type OcrGpuMode = 'auto' | 'cpu' | 'cuda';
export type UpdateMode = 'auto' | 'manual';

export interface GuiAutomationSettings {
  expeditionInterval: number;
  battleTimes: number;
  autoLoot: boolean;
  lootPlanIndex: number;
  lootStopCount: number;
}

export interface DecisivePlanSettings {
  chapter: number;
  useQuickRepair: boolean;
  level1: string[];
  level2: string[];
}

export interface GuiConfigurationDependencies {
  clearPythonCache(): void;
  normalizeCudaPath(candidate: string): string;
  environmentPort?(): string | undefined;
}

const DEFAULT_DECISIVE_PLAN: DecisivePlanSettings = {
  chapter: 6,
  useQuickRepair: true,
  level1: [
    'U-47',
    'U-1405',
    'U-1206',
    'U-2540',
    'U-81',
    'U-96',
  ],
  level2: [
    'U-505',
    '射水鱼',
    '大青花鱼',
    'M-296',
    '鹦鹉螺',
    'S-49',
    'IIIA',
    'K-21',
    'U-441',
    '潜甲',
    '潜乙',
    '伊-201',
    '伊-25',
    '鲃鱼',
    '伊-400',
    '激流',
    'U-4501',
    'U-459',
    'U-14',
    'U-35',
    'K1',
  ],
};

/** 解释 GUI 设置字段并执行原有归一化和迁移规则。 */
export class GuiConfigurationService {
  constructor(
    private readonly store: GuiSettingsStore,
    private readonly dependencies: GuiConfigurationDependencies,
  ) {}

  /** 返回启动时使用的后端端口。 */
  backendPort(): number {
    const environmentPort = this.dependencies.environmentPort?.();
    if (environmentPort) {
      return parseInt(environmentPort, 10);
    }
    const settings = this.store.read();
    if (
      typeof settings.backend_port === 'number'
      && settings.backend_port > 0
      && settings.backend_port < 65536
    ) {
      return settings.backend_port;
    }
    return 8438;
  }

  /** 仅在端口是合法有限整数时写入。 */
  setBackendPort(port: number): void {
    if (typeof port !== 'number' || !Number.isFinite(port)) return;
    const normalized = Math.trunc(port);
    if (normalized < 1 || normalized > 65535) return;
    this.store.write({ backend_port: normalized });
  }

  /** 返回用户指定的 Python 路径；空值表示自动检测。 */
  configuredPythonPath(): string | null {
    const settings = this.store.read();
    if (
      typeof settings.python_path === 'string'
      && settings.python_path.length > 0
    ) {
      return settings.python_path;
    }
    return null;
  }

  /** 保存 Python 路径并清除 Python 发现缓存。 */
  setPythonPath(pythonPath: string | null): void {
    this.store.write({ python_path: pythonPath ?? '' });
    this.dependencies.clearPythonCache();
  }

  /** 返回 autowsgr 更新模式。 */
  updateMode(): UpdateMode {
    return this.store.read().update_mode === 'manual'
      ? 'manual'
      : 'auto';
  }

  /** 保存归一化后的 autowsgr 更新模式。 */
  setUpdateMode(mode: UpdateMode): void {
    this.store.write({
      update_mode: mode === 'manual' ? 'manual' : 'auto',
    });
  }

  /** 返回 managed 或 external 后端启动模式。 */
  backendStartupMode(): BackendStartupMode {
    return this.store.read().backend_startup_mode === 'external'
      ? 'external'
      : 'managed';
  }

  /** 保存归一化后的后端启动模式。 */
  setBackendStartupMode(mode: BackendStartupMode): void {
    this.store.write({
      backend_startup_mode: mode === 'external'
        ? 'external'
        : 'managed',
    });
  }

  /** 返回去除首尾空白的 external 后端仓库路径。 */
  backendRepoPath(): string {
    const value = this.store.read().backend_repo_path;
    return typeof value === 'string' ? value.trim() : '';
  }

  /** 保存去除首尾空白的 external 后端仓库路径。 */
  setBackendRepoPath(repoPath: string | null): void {
    this.store.write({
      backend_repo_path: typeof repoPath === 'string'
        ? repoPath.trim()
        : '',
    });
  }

  /** 返回 OCR GPU 模式。 */
  ocrGpuMode(): OcrGpuMode {
    const value = this.store.read().ocr_gpu_mode;
    return value === 'cpu' || value === 'cuda' ? value : 'auto';
  }

  /** 保存归一化后的 OCR GPU 模式。 */
  setOcrGpuMode(mode: OcrGpuMode): void {
    this.store.write({
      ocr_gpu_mode: mode === 'cpu' || mode === 'cuda'
        ? mode
        : 'auto',
    });
  }

  /** 返回去除首尾空白的 CUDA 配置路径。 */
  cudaPath(): string {
    const value = this.store.read().cuda_path;
    return typeof value === 'string' ? value.trim() : '';
  }

  /** 保存空路径或统一归一化后的 CUDA 路径。 */
  setCudaPath(cudaPath: string | null): void {
    const raw = typeof cudaPath === 'string'
      ? cudaPath.trim()
      : '';
    this.store.write({
      cuda_path: raw
        ? this.dependencies.normalizeCudaPath(raw)
        : '',
    });
  }

  /** 返回是否保存后端异常截图。 */
  saveBackendScreenshots(): boolean {
    return this.store.read().save_backend_screenshots === true;
  }

  /** 保存后端异常截图开关。 */
  setSaveBackendScreenshots(enabled: boolean): void {
    this.store.write({
      save_backend_screenshots: enabled === true,
    });
  }

  /** 读取已有的 GUI 自动化字段，不为缺失字段补默认值。 */
  automation(): {
    exists: boolean;
    settings: Partial<GuiAutomationSettings>;
  } {
    const raw = this.store.read().automation;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { exists: false, settings: {} };
    }
    const value = raw as Record<string, unknown>;
    const settings: Partial<GuiAutomationSettings> = {};
    if (Number.isFinite(Number(value.expeditionInterval))) {
      settings.expeditionInterval = Number(
        value.expeditionInterval,
      );
    }
    if (Number.isFinite(Number(value.battleTimes))) {
      settings.battleTimes = Number(value.battleTimes);
    }
    if (typeof value.autoLoot === 'boolean') {
      settings.autoLoot = value.autoLoot;
    }
    if (Number.isFinite(Number(value.lootPlanIndex))) {
      settings.lootPlanIndex = Number(value.lootPlanIndex);
    }
    if (Number.isFinite(Number(value.lootStopCount))) {
      settings.lootStopCount = Number(value.lootStopCount);
    }
    return { exists: true, settings };
  }

  /** 归一化并保存 GUI 自动化字段。 */
  setAutomation(
    settings: GuiAutomationSettings,
  ): GuiAutomationSettings {
    const normalized: GuiAutomationSettings = {
      expeditionInterval: Math.max(
        1,
        Math.min(
          120,
          Math.trunc(Number(settings?.expeditionInterval) || 15),
        ),
      ),
      battleTimes: Math.max(
        1,
        Math.trunc(Number(settings?.battleTimes) || 3),
      ),
      autoLoot: settings?.autoLoot === true,
      lootPlanIndex: Math.max(
        0,
        Math.trunc(Number(settings?.lootPlanIndex) || 0),
      ),
      lootStopCount: Math.max(
        1,
        Math.min(
          50,
          Math.trunc(Number(settings?.lootStopCount) || 50),
        ),
      ),
    };
    this.store.write({ automation: normalized });
    return normalized;
  }

  /** 读取决战计划，并在发现旧字段时原地迁移。 */
  decisivePlan(): DecisivePlanSettings {
    const rawPlan = this.store.read().decisive_plan;
    const normalized = this.normalizeDecisivePlan(rawPlan);
    if (
      rawPlan
      && typeof rawPlan === 'object'
      && !Array.isArray(rawPlan)
      && (
        Object.prototype.hasOwnProperty.call(rawPlan, 'level3')
        || (
          Array.isArray(
            (rawPlan as Record<string, unknown>).level1,
          )
          && (
            (rawPlan as Record<string, unknown>)
              .level1 as unknown[]
          ).length > 6
        )
      )
    ) {
      this.writeDecisivePlan(normalized);
    }
    return normalized;
  }

  /** 归一化并保存决战计划。 */
  setDecisivePlan(
    settings: DecisivePlanSettings,
  ): DecisivePlanSettings {
    const normalized = this.normalizeDecisivePlan(settings);
    this.writeDecisivePlan(normalized);
    return normalized;
  }

  /** 归一化决战章节、修理设置和两级舰船列表。 */
  private normalizeDecisivePlan(
    value: unknown,
  ): DecisivePlanSettings {
    const raw = value
      && typeof value === 'object'
      && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
    const chapter = Math.trunc(Number(raw.chapter));
    const requestedMainShips = this.normalizeDecisiveShips(
      raw.level1,
      DEFAULT_DECISIVE_PLAN.level1,
    );
    const mainShips = requestedMainShips.slice(0, 6);
    const requestedBackupShips = this.normalizeDecisiveShips(
      raw.level2,
      DEFAULT_DECISIVE_PLAN.level2,
    );
    const legacyLevel3 = Array.isArray(raw.level3)
      ? this.normalizeDecisiveShips(raw.level3, [])
      : [];
    const backupShips: string[] = [];
    for (
      const name of [
        ...requestedMainShips.slice(6),
        ...requestedBackupShips,
        ...legacyLevel3,
      ]
    ) {
      if (
        !mainShips.includes(name)
        && !backupShips.includes(name)
      ) {
        backupShips.push(name);
      }
    }
    return {
      chapter: Number.isFinite(chapter)
        ? Math.max(1, Math.min(6, chapter))
        : DEFAULT_DECISIVE_PLAN.chapter,
      useQuickRepair: typeof raw.use_quick_repair === 'boolean'
        ? raw.use_quick_repair
        : typeof raw.useQuickRepair === 'boolean'
          ? raw.useQuickRepair
          : DEFAULT_DECISIVE_PLAN.useQuickRepair,
      level1: mainShips,
      level2: backupShips,
    };
  }

  /** 清理舰船名、长度和重复项。 */
  private normalizeDecisiveShips(
    value: unknown,
    fallback: string[],
  ): string[] {
    if (!Array.isArray(value)) return [...fallback];
    return value
      .filter(item => typeof item === 'string')
      .map(item => item.trim())
      .filter((item, index, values) => (
        item.length > 0
        && item.length <= 80
        && values.indexOf(item) === index
      ));
  }

  /** 使用兼容的 snake_case 结构写回决战计划。 */
  private writeDecisivePlan(settings: DecisivePlanSettings): void {
    this.store.write({
      decisive_plan: {
        chapter: settings.chapter,
        use_quick_repair: settings.useQuickRepair,
        level1: settings.level1,
        level2: settings.level2,
      },
    });
  }
}
