/**
 * managed Alpha 后端独立增量更新：检查、暂存和应用。
 *
 * 基线规则：每个 GUI 版本以打包清单绑定的 alpha 后端 commit 为基线，
 * GUI 版本变化时重置基线；同一 GUI 版本内基于已应用 commit 做增量更新。
 * 暂存目录在 userData，版本状态与环境信息统一存储在 .env_ready。
 */
import {
  BackendUpdateRepository,
  diffPlanSize,
  isCommitSha,
  type BackendUpdateRepositoryDependencies,
  type BackendUpdateState,
} from './BackendUpdateRepository';
import {
  BackendUpdateRemoteRepository,
  type BackendUpdateRemoteDependencies,
} from './BackendUpdateRemoteRepository';
import type { BackendDistribution } from '../pythonEnv/backendRequirement';
import type {
  BackendUpdateCheckResult,
  BackendUpdateStatus,
} from '../../src/types/ipc';

/** 差异文件总数超过阈值时放弃增量，改走完整安装。 */
export const FULL_REINSTALL_FILE_THRESHOLD = 400;

export {
  isSafeRelativePath,
} from './BackendUpdateRepository';
export type {
  BackendDiffPlan,
  BackendPendingUpdate,
  BackendUpdateState,
} from './BackendUpdateRepository';

interface BackendCommitComparison {
  status: 'ahead' | 'behind' | 'diverged' | 'identical';
  files: BackendChangedFile[] | null;
}

type BackendChangedFileStatus =
  | 'added'
  | 'modified'
  | 'removed'
  | 'renamed'
  | 'copied'
  | 'changed';

interface BackendChangedFile {
  filename: string;
  status: BackendChangedFileStatus;
  previousFilename?: string;
}

type BackendUpdateGateError = Extract<
  BackendUpdateCheckResult,
  { status: 'error' }
>;

function backendRelativePath(filename: string): string | null {
  const prefix = 'autowsgr/';
  return filename.startsWith(prefix) && filename.length > prefix.length
    ? filename.slice(prefix.length)
    : null;
}

/** 将 GitHub Compare 文件状态转换为仅覆盖 autowsgr/** 的净差异。 */
export function buildBackendDiffPlan(
  files: BackendChangedFile[],
): import('./BackendUpdateRepository').BackendDiffPlan | null {
  const plan = { add: [] as string[], modify: [] as string[], delete: [] as string[] };
  const affected = new Set<string>();
  const append = (target: string[], filename: string | undefined): boolean => {
    if (!filename) return true;
    const relative = backendRelativePath(filename);
    if (!relative) return true;
    const key = relative.toLowerCase();
    if (affected.has(key)) return false;
    affected.add(key);
    target.push(relative);
    return true;
  };

  for (const file of files) {
    let valid = true;
    switch (file.status) {
      case 'added':
      case 'copied':
        valid = append(plan.add, file.filename);
        break;
      case 'modified':
      case 'changed':
        valid = append(plan.modify, file.filename);
        break;
      case 'removed':
        valid = append(plan.delete, file.filename);
        break;
      case 'renamed':
        valid = append(plan.delete, file.previousFilename)
          && append(plan.add, file.filename);
        break;
    }
    if (!valid) return null;
  }
  return plan;
}

export interface BackendUpdateRuntimeDependencies {
  findPython(): Promise<string | null>;
  validateBackend(pythonCmd: string): Promise<boolean>;
  installArchive(pythonCmd: string, zipPath: string): Promise<boolean>;
}

export interface BackendUpdateServiceDependencies
  extends
    BackendUpdateRemoteDependencies,
    BackendUpdateRepositoryDependencies {
  getAppVersion(): string;
  allowTestUpdates(): boolean;
  backendStartupMode(): 'managed' | 'external';
  alphaDistribution(): BackendDistribution;
  sendStatus(status: BackendUpdateStatus): void;
  chooseRestartTiming?(
    commit: string,
  ): Promise<'restart' | 'next-launch'>;
  restartApplication?(): void;
  runtime?: BackendUpdateRuntimeDependencies;
}

/** managed Alpha 后端独立更新的检查、暂存与应用编排。 */
export class BackendUpdateService {
  private preparing: Promise<void> | null = null;
  private preparingCommit: string | null = null;
  private managedInstallQueue: Promise<void> = Promise.resolve();
  private managedInstallReservations = 0;
  private completeManagedInstall: (() => void) | null = null;
  private shuttingDown = false;
  private choosingRestartTiming = false;
  private readonly repository: BackendUpdateRepository;
  private readonly remoteRepository: BackendUpdateRemoteRepository;

  constructor(
    private readonly dependencies: BackendUpdateServiceDependencies,
  ) {
    this.repository = new BackendUpdateRepository(dependencies);
    this.remoteRepository = new BackendUpdateRemoteRepository(dependencies);
  }

  /** 读取并校验状态；缺失或损坏时按首次基线初始化。 */
  readState(): BackendUpdateState {
    return this.repository.readState(() => this.initialState());
  }

  /** 检查 alpha 后端分支是否有新提交；先执行 GUI 升级基线重置。 */
  async check(): Promise<BackendUpdateCheckResult> {
    const gate = this.checkAvailability();
    if (gate) return gate;
    const state = this.ensureBaseline();
    try {
      const latest = await this.fetchLatestCommit();
      if (latest === state.appliedCommit) {
        return { status: 'up-to-date', commit: latest };
      }
      return { status: 'available', commit: latest };
    } catch (error) {
      return {
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** 下载目标 commit 源码包，生成差异计划并写入暂存状态。 */
  async prepare(commit: string): Promise<void> {
    if (!isCommitSha(commit)) {
      throw new Error('后端更新目标 commit 无效');
    }
    this.assertCanPrepare();
    if (this.preparing) {
      if (this.preparingCommit === commit) return this.preparing;
      try {
        await this.preparing;
      } catch {
        // 前一个目标失败不阻塞新的 commit 重新准备。
      }
      return this.prepare(commit);
    }
    this.preparingCommit = commit;
    this.preparing = this.prepareInternal(commit)
      .finally(() => {
        this.preparing = null;
        this.preparingCommit = null;
      });
    return this.preparing;
  }

  /** 是否存在等待应用的暂存更新。 */
  hasPendingUpdate(): boolean {
    return this.repository.discardUnavailablePending(
      this.readState(),
    ).pending !== null;
  }

  /** 启动时恢复上次被强制中断的应用操作。 */
  recoverInterruptedApply(): boolean {
    const state = this.readState();
    const pending = this.repository.recoverInterrupted(state);
    if (!pending) return false;
    this.dependencies.log(`已恢复中断的后端更新: ${pending.commit.slice(0, 7)}`);
    return true;
  }

  /**
   * 应用增量暂存更新；full 类型返回 false（完整安装由退出流程
   * 通过 applyFullUpdateWith 在后端停止后执行）。
   */
  async applyPendingUpdate(
    validate: () => Promise<boolean>,
  ): Promise<boolean> {
    if (this.checkGate() || this.managedInstallReservations > 0) return false;
    const state = this.repository.discardUnavailablePending(
      this.ensureBaseline(),
    );
    const pending = state.pending;
    if (!pending || pending.type !== 'incremental') return false;

    const snapshot = this.repository.applyDiff(
      pending.source,
      pending.diff,
      state,
    );
    try {
      if (!(await validate())) {
        throw new Error('后端增量更新运行契约验证失败');
      }
      this.repository.finishApply(state, pending);
    } catch (error) {
      this.repository.restoreOrThrow(snapshot, error);
    }
    this.dependencies.log(
      `后端增量更新已应用: ${pending.commit.slice(0, 7)}`,
    );
    return true;
  }

  /** 应用完整安装暂存包；由退出流程在后端停止后调用。 */
  async applyFullUpdateWith(
    installer: (zipPath: string) => Promise<boolean>,
  ): Promise<boolean> {
    if (this.checkGate() || this.managedInstallReservations > 0) return false;
    const state = this.repository.discardUnavailablePending(
      this.ensureBaseline(),
    );
    const pending = state.pending;
    if (!pending || pending.type !== 'full') return false;
    const snapshot = this.repository.snapshotInstalledBackend(state);
    let success: boolean;
    try {
      this.repository.resetInstalledEnvironment();
      success = await installer(pending.source);
    } catch (error) {
      this.repository.restoreOrThrow(snapshot, error);
    }
    if (!success) {
      snapshot.restore();
      snapshot.clear();
      this.dependencies.log('后端完整安装失败，已恢复原版本并保留暂存');
      return false;
    }
    try {
      this.repository.finishApply(state, pending);
    } catch (error) {
      this.repository.restoreOrThrow(snapshot, error);
    }
    this.dependencies.log(
      `后端完整更新已应用: ${pending.commit.slice(0, 7)}`,
    );
    return true;
  }

  /** 启动后端前恢复中断操作，并只重试已暂存的增量更新。 */
  async recoverAndApplyOnStartup(): Promise<void> {
    try {
      this.recoverInterruptedApply();
    } catch (error) {
      this.logFailure('恢复中断更新失败', error);
      return;
    }
    if (!this.hasPendingUpdate()) return;
    const runtime = this.requireRuntime();
    const pythonCmd = await runtime.findPython();
    if (!pythonCmd) return;
    try {
      await this.applyPendingUpdate(
        () => runtime.validateBackend(pythonCmd),
      );
    } catch (error) {
      this.logFailure('启动时应用增量更新失败', error);
    }
  }

  /** 后端停止后应用暂存更新；失败保留暂存供下次重试。 */
  async applyBeforeExit(): Promise<void> {
    this.shuttingDown = true;
    if (this.preparing) {
      try {
        await this.preparing;
      } catch (error) {
        this.logFailure('退出时等待后端更新下载失败', error);
      }
    }
    if (this.managedInstallReservations > 0) {
      this.dependencies.log('退出时等待正在进行的后端环境安装');
      await this.managedInstallQueue;
    }
    if (!this.hasPendingUpdate()) return;
    try {
      const runtime = this.requireRuntime();
      const pythonCmd = await runtime.findPython();
      if (!pythonCmd) {
        this.dependencies.log('未找到 Python，跳过后端更新');
        return;
      }
      if (
        await this.applyPendingUpdate(
          () => runtime.validateBackend(pythonCmd),
        )
      ) {
        return;
      }
      await this.applyFullUpdateWith(
        zipPath => runtime.installArchive(pythonCmd, zipPath),
      );
    } catch (error) {
      this.logFailure('退出时应用更新失败，暂存保留', error);
    }
  }

  /** 固定后端被 GUI/频道覆盖安装后，清除独立更新状态。 */
  clearStateAfterManagedInstall(): void {
    this.repository.clearManagedState();
  }

  /** 固定后端安装开始前阻止新准备任务，并等待已有任务退出。 */
  async beginManagedBackendInstall(): Promise<void> {
    let releaseReservation!: () => void;
    const reservation = new Promise<void>((resolve) => {
      releaseReservation = resolve;
    });
    const previousReservations = this.managedInstallQueue;
    this.managedInstallReservations += 1;
    this.managedInstallQueue = previousReservations.then(() => reservation);
    await previousReservations;

    if (this.shuttingDown) {
      this.managedInstallReservations -= 1;
      releaseReservation();
      throw new Error('GUI 正在退出，已停止后端环境安装');
    }
    this.completeManagedInstall = releaseReservation;
    if (!this.preparing) return;
    try {
      await this.preparing;
    } catch (error) {
      this.logFailure('固定后端安装已取消并发更新准备', error);
    }
    if (this.shuttingDown) {
      this.endManagedBackendInstall();
      throw new Error('GUI 正在退出，已停止后端环境安装');
    }
  }

  /** 固定后端安装结束后恢复独立更新入口。 */
  endManagedBackendInstall(): void {
    const complete = this.completeManagedInstall;
    this.completeManagedInstall = null;
    if (!complete) return;
    this.managedInstallReservations -= 1;
    complete();
  }

  /** 自动模式下的启动检查入口；手动模式不触发。 */
  async autoCheckIfEnabled(
    backendUpdateMode: 'auto' | 'manual',
  ): Promise<void> {
    if (backendUpdateMode !== 'auto') return;
    const gate = this.checkAvailability();
    if (gate) return;
    const state = this.repository.discardUnavailablePending(
      this.ensureBaseline(),
    );
    if (state.pending) {
      await this.notifyPrepared(state.pending.commit);
      return;
    }
    try {
      const latest = await this.fetchLatestCommit();
      if (latest === state.appliedCommit) return;
      this.dependencies.log(
        `检测到后端更新 ${latest.slice(0, 7)}，正在后台准备`,
      );
      await this.prepare(latest);
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : String(error);
      this.dependencies.log(
        `后端自动更新检查失败: ${message}`,
      );
      this.dependencies.sendStatus({ status: 'error', message });
    }
  }

  private async prepareInternal(commit: string): Promise<void> {
    const state = this.repository.discardUnavailablePending(
      this.ensureBaseline(),
    );
    if (state.pending?.commit === commit) {
      await this.notifyPrepared(commit);
      return;
    }

    const distribution = this.dependencies.alphaDistribution();
    const comparison = await this.fetchComparison(
      state.appliedCommit,
      commit,
    );
    const historyChanged = comparison.status !== 'ahead'
      && comparison.status !== 'identical';
    const pyprojectChanged = comparison.files === null
      || comparison.files.some(file => (
        file.filename === 'pyproject.toml'
        || file.previousFilename === 'pyproject.toml'
      ));
    const diff = comparison.files === null
      ? null
      : buildBackendDiffPlan(comparison.files);
    let needsFull = pyprojectChanged
      || historyChanged
      || diff === null
      || diffPlanSize(diff) > FULL_REINSTALL_FILE_THRESHOLD;
    const { zipPath, extractDir } = this.repository.createCandidate(commit);

    this.dependencies.sendStatus({ status: 'downloading', progress: 0 });
    await this.remoteRepository.downloadArchive(
      `https://github.com/${distribution.repository}/archive/${commit}.zip`,
      zipPath,
      progress => {
        this.dependencies.sendStatus({
          status: 'downloading',
          progress: Math.max(0, Math.min(100, progress)),
        });
      },
    );

    let incomingPackage: string | null = null;
    if (!needsFull && diff) {
      await this.remoteRepository.extractArchive(
        zipPath,
        extractDir,
      );
      const sourceRoot = this.remoteRepository.locateSourceRoot(extractDir);
      incomingPackage = this.repository.resolveIncomingPackage(sourceRoot);
      needsFull = !this.repository.canApplyIncrementally(
        incomingPackage,
        diff,
      );
    }

    this.assertCanFinishPrepare();
    if (needsFull) {
      this.repository.writeState({
        ...state,
        pending: {
          type: 'full',
          commit,
          source: zipPath,
        },
      });
      this.dependencies.log(
        historyChanged
          ? '后端提交历史已变化，将在重启 GUI 时完整安装'
          : '后端更新依赖或差异过大，将在重启 GUI 时完整安装',
      );
    } else {
      if (!diff || !incomingPackage) {
        throw new Error('后端增量更新缺少 Commit 差异或源码目录');
      }
      this.repository.writeState({
        ...state,
        pending: {
          type: 'incremental',
          commit,
          source: incomingPackage,
          diff,
        },
      });
      this.dependencies.log(
        `后端更新已暂存: 新增 ${diff.add.length}、`
        + `修改 ${diff.modify.length}、删除 ${diff.delete.length}`,
      );
    }

    await this.notifyPrepared(commit);
  }

  /** 首次运行、GUI 升级或发行仓库变化时重置基线并落盘。 */
  private ensureBaseline(): BackendUpdateState {
    const state = this.readState();
    const appVersion = this.dependencies.getAppVersion();
    const distribution = this.dependencies.alphaDistribution();
    if (
      this.repository.stateExists()
      && state.guiVersion === appVersion
      && state.repository === distribution.repository
      && state.boundCommit === distribution.commit
    ) {
      return state;
    }
    const reset: BackendUpdateState = {
      guiVersion: appVersion,
      repository: distribution.repository,
      boundCommit: distribution.commit,
      appliedCommit: state.appliedCommit,
      pending: null,
      applying: false,
    };
    this.repository.cleanupStaging();
    this.repository.writeState(reset);
    this.dependencies.log(
      `GUI 后端基线已变更为 ${reset.boundCommit.slice(0, 7)}，`
      + `等待固定后端安装成功后重置更新状态`,
    );
    return reset;
  }

  private async fetchLatestCommit(): Promise<string> {
    const distribution = this.dependencies.alphaDistribution();
    const data = await this.remoteRepository.fetchJson(
      `https://api.github.com/repos/${distribution.repository}`
      + `/commits/${distribution.ref}`,
    ) as { sha?: unknown };
    if (typeof data.sha !== 'string' || !isCommitSha(data.sha)) {
      throw new Error('GitHub API 返回了无效的 commit');
    }
    return data.sha;
  }

  private async fetchComparison(
    base: string,
    head: string,
  ): Promise<BackendCommitComparison> {
    const distribution = this.dependencies.alphaDistribution();
    let data: { status?: unknown; files?: unknown };
    try {
      data = await this.remoteRepository.fetchJson(
        `https://api.github.com/repos/${distribution.repository}`
        + `/compare/${base}...${head}`,
      ) as { status?: unknown; files?: unknown };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('(404)')) {
        return { status: 'diverged', files: null };
      }
      throw error;
    }
    if (
      data.status !== 'ahead'
      && data.status !== 'behind'
      && data.status !== 'diverged'
      && data.status !== 'identical'
    ) {
      throw new Error('GitHub Compare API 返回了无效的提交关系');
    }
    const validStatuses = new Set<BackendChangedFileStatus>([
      'added',
      'modified',
      'removed',
      'renamed',
      'copied',
      'changed',
    ]);
    const files = Array.isArray(data.files)
      && data.files.length < 300
      && data.files.every(file => {
        if (!file || typeof file !== 'object') return false;
        const changed = file as {
          filename?: unknown;
          status?: unknown;
          previous_filename?: unknown;
        };
        return typeof changed.filename === 'string'
          && typeof changed.status === 'string'
          && validStatuses.has(changed.status as BackendChangedFileStatus)
          && (
            changed.status !== 'renamed'
            || typeof changed.previous_filename === 'string'
          );
      })
      ? data.files.map(file => {
          const changed = file as {
            filename: string;
            status: BackendChangedFileStatus;
            previous_filename?: string;
          };
          return {
            filename: changed.filename,
            status: changed.status,
            previousFilename: changed.previous_filename,
          };
        })
      : null;
    return { status: data.status, files };
  }

  private checkGate(): BackendUpdateGateError | null {
    if (!this.dependencies.allowTestUpdates()) {
      return {
        status: 'error',
        message: '后端独立更新仅在预览版更新渠道下可用',
      };
    }
    if (this.dependencies.backendStartupMode() !== 'managed') {
      return {
        status: 'error',
        message: '使用本地后端源码时由仓库自行管理更新',
      };
    }
    return null;
  }

  private checkAvailability(): BackendUpdateGateError | null {
    const gate = this.checkGate();
    if (gate) return gate;
    if (this.managedInstallReservations > 0) {
      return {
        status: 'error',
        message: '后端环境正在安装，请稍后再检查更新',
      };
    }
    if (this.shuttingDown) {
      return {
        status: 'error',
        message: 'GUI 正在退出，已停止准备后端更新',
      };
    }
    return null;
  }

  private assertCanPrepare(): void {
    const gate = this.checkAvailability();
    if (gate) throw new Error(gate.message);
  }

  private assertCanFinishPrepare(): void {
    const gate = this.checkGate();
    if (gate) throw new Error(gate.message);
    if (this.managedInstallReservations > 0) {
      throw new Error('后端环境正在安装，请稍后再检查更新');
    }
  }

  private async notifyPrepared(commit: string): Promise<void> {
    this.dependencies.sendStatus({ status: 'downloaded', commit });
    if (
      this.shuttingDown
      || this.choosingRestartTiming
      || !this.dependencies.chooseRestartTiming
    ) {
      return;
    }
    this.choosingRestartTiming = true;
    try {
      const timing = await this.dependencies.chooseRestartTiming(commit);
      if (timing === 'restart') {
        this.dependencies.restartApplication?.();
        return;
      }
      this.dependencies.sendStatus({ status: 'deferred', commit });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logFailure('后端更新重启时间选择失败', error);
      this.dependencies.sendStatus({ status: 'error', message });
    } finally {
      this.choosingRestartTiming = false;
    }
  }

  private requireRuntime(): BackendUpdateRuntimeDependencies {
    if (!this.dependencies.runtime) {
      throw new Error('后端更新运行环境未配置');
    }
    return this.dependencies.runtime;
  }

  private logFailure(context: string, error: unknown): void {
    this.dependencies.log(
      `${context}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  private initialState(): BackendUpdateState {
    const distribution = this.dependencies.alphaDistribution();
    return {
      guiVersion: this.dependencies.getAppVersion(),
      repository: distribution.repository,
      boundCommit: distribution.commit,
      appliedCommit: distribution.commit,
      pending: null,
      applying: false,
    };
  }
}
