import * as fs from 'fs';
import * as path from 'path';
import { AtomicFileStore } from './AtomicFileStore';

const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/;
const BACKEND_UPDATE_STATE_KEY = 'backendUpdate';

export interface BackendDiffPlan {
  add: string[];
  modify: string[];
  delete: string[];
}

export interface BackendPendingUpdate {
  type: 'incremental' | 'full';
  commit: string;
  /** incremental: 解压后的 autowsgr 包目录；full: 本地 zip 路径。 */
  source: string;
  diff?: BackendDiffPlan;
}

export interface BackendUpdateState {
  guiVersion: string;
  repository: string;
  boundCommit: string;
  appliedCommit: string;
  pending: BackendPendingUpdate | null;
  applying?: boolean;
}

export interface BackendUpdateCandidate {
  zipPath: string;
  extractDir: string;
}

export interface BackendUpdateRollback {
  restore(): void;
  clear(): void;
}

export interface BackendUpdateRepositoryDependencies {
  getStagingRoot(): string;
  getStatePath(): string;
  getLegacyStatePath?(): string;
  getInstalledPackageDir(): string;
  atomicFiles: Pick<AtomicFileStore, 'write'>;
  log(message: string): void;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

export function isCommitSha(value: string): boolean {
  return COMMIT_SHA_PATTERN.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** 收集目录内全部文件的相对路径（正斜杠分隔）。 */
function listRelativeFiles(root: string, base = ''): string[] {
  const output: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(path.join(root, base), {
      withFileTypes: true,
    });
  } catch {
    return output;
  }
  for (const entry of entries) {
    const relative = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (entry.name === '__pycache__') continue;
      output.push(...listRelativeFiles(root, relative));
    } else if (entry.isFile()) {
      if (/\.(?:pyc|pyo)$/i.test(entry.name)) continue;
      output.push(relative);
    }
  }
  return output;
}

export function diffPlanSize(diff: BackendDiffPlan): number {
  return diff.add.length + diff.modify.length + diff.delete.length;
}

/** 拒绝绝对路径、盘符、反斜杠和目录穿越。 */
export function isSafeRelativePath(relative: string): boolean {
  if (!relative || relative.includes('\\')) return false;
  if (path.isAbsolute(relative)) return false;
  if (/^[A-Za-z]:/.test(relative)) return false;
  return relative.split('/').every(part => (
    part.length > 0 && part !== '.' && part !== '..'
  ));
}

function isPathInside(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return (
    relative === ''
    || (
      !path.isAbsolute(relative)
      && relative !== '..'
      && !relative.startsWith(`..${path.sep}`)
    )
  );
}

/** 拒绝通过安装目录中的符号链接或目录联接跳出受管目录。 */
function assertUnlinkedPath(root: string, target: string): void {
  if (!isPathInside(root, target)) {
    throw new Error(`后端更新路径越界: ${target}`);
  }
  const relative = path.relative(path.resolve(root), path.resolve(target));
  const parts = relative ? relative.split(path.sep) : [];
  let current = path.resolve(root);
  for (const part of ['', ...parts]) {
    if (part) current = path.join(current, part);
    if (!fs.existsSync(current)) break;
    if (fs.lstatSync(current).isSymbolicLink()) {
      throw new Error(`后端更新路径包含符号链接: ${current}`);
    }
  }
}

function resolveManagedPath(root: string, relative: string): string {
  if (!isSafeRelativePath(relative)) {
    throw new Error(`后端更新包含不安全路径: ${relative}`);
  }
  const target = path.resolve(root, ...relative.split('/'));
  assertUnlinkedPath(root, target);
  return target;
}

function assertSafeDiffPlan(diff: BackendDiffPlan): void {
  const affected = [...diff.add, ...diff.modify, ...diff.delete];
  const normalized = new Set<string>();
  for (const file of affected) {
    if (!isSafeRelativePath(file)) {
      throw new Error(`后端更新包含不安全路径: ${file}`);
    }
    const key = file.toLowerCase();
    if (normalized.has(key)) {
      throw new Error(`后端更新差异清单包含重复路径: ${file}`);
    }
    normalized.add(key);
  }
}

/** 后端独立更新的本地状态、暂存文件和回滚 Repository。 */
export class BackendUpdateRepository {
  constructor(
    private readonly dependencies: BackendUpdateRepositoryDependencies,
  ) {}

  stateExists(): boolean {
    const document = this.readStateDocument();
    if (
      document
      && this.isValidState(document[BACKEND_UPDATE_STATE_KEY])
    ) {
      return true;
    }
    const legacyPath = this.dependencies.getLegacyStatePath?.();
    return !!legacyPath && fs.existsSync(legacyPath);
  }

  readState(initialState: () => BackendUpdateState): BackendUpdateState {
    const document = this.readStateDocument();
    if (document) {
      const embedded = document[BACKEND_UPDATE_STATE_KEY];
      if (this.isValidState(embedded)) return embedded;
      if (
        Object.prototype.hasOwnProperty.call(
          document,
          BACKEND_UPDATE_STATE_KEY,
        )
      ) {
        delete document[BACKEND_UPDATE_STATE_KEY];
        this.writeStateDocument(document);
        this.dependencies.log('后端更新状态已损坏，按 GUI 绑定版本重置');
      }
    }

    const legacyPath = this.dependencies.getLegacyStatePath?.();
    if (legacyPath && fs.existsSync(legacyPath)) {
      try {
        const value = JSON.parse(fs.readFileSync(legacyPath, 'utf-8'));
        if (this.isValidState(value)) {
          this.writeState(value);
          fs.rmSync(legacyPath, { force: true });
          this.dependencies.log('已迁移旧版后端更新状态到 .env_ready');
          return value;
        }
      } catch {
        // 损坏的旧状态按首次基线处理。
      }
      try {
        fs.rmSync(legacyPath, { force: true });
      } catch {
        // 无法删除时仍按首次基线处理。
      }
      this.dependencies.log('旧版后端更新状态已损坏，按 GUI 绑定版本重置');
    }
    return initialState();
  }

  writeState(state: BackendUpdateState): void {
    const document = this.readStateDocument() ?? {};
    document[BACKEND_UPDATE_STATE_KEY] = state;
    this.writeStateDocument(document);
  }

  clearManagedState(): void {
    this.cleanupStaging();
    const document = this.readStateDocument();
    if (
      document
      && Object.prototype.hasOwnProperty.call(
        document,
        BACKEND_UPDATE_STATE_KEY,
      )
    ) {
      delete document[BACKEND_UPDATE_STATE_KEY];
      this.writeStateDocument(document);
    }
    const legacyPath = this.dependencies.getLegacyStatePath?.();
    if (!legacyPath) return;
    try {
      fs.rmSync(legacyPath, { force: true });
    } catch (error) {
      this.dependencies.log(
        `后端更新状态清理失败: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  cleanupStaging(): void {
    try {
      fs.rmSync(this.dependencies.getStagingRoot(), {
        recursive: true,
        force: true,
      });
    } catch {
      // 暂存清理失败不阻塞流程，下次准备会覆盖。
    }
  }

  createCandidate(commit: string): BackendUpdateCandidate {
    const candidateRoot = path.join(
      this.dependencies.getStagingRoot(),
      `candidate-${commit}`,
    );
    fs.rmSync(candidateRoot, { recursive: true, force: true });
    return {
      zipPath: path.join(candidateRoot, `${commit}.zip`),
      extractDir: path.join(candidateRoot, 'extracted'),
    };
  }

  resolveIncomingPackage(sourceRoot: string): string {
    const incomingPackage = path.join(sourceRoot, 'autowsgr');
    if (
      !fs.existsSync(incomingPackage)
      || !fs.lstatSync(incomingPackage).isDirectory()
    ) {
      throw new Error('后端源码包缺少 autowsgr 包目录');
    }
    return incomingPackage;
  }

  canApplyIncrementally(
    incomingPackage: string,
    diff: BackendDiffPlan,
  ): boolean {
    const installedDir = this.dependencies.getInstalledPackageDir();
    if (!fs.existsSync(installedDir)) return false;
    try {
      assertSafeDiffPlan(diff);
      for (const file of [...diff.add, ...diff.modify]) {
        const source = resolveManagedPath(incomingPackage, file);
        if (!fs.existsSync(source) || !fs.lstatSync(source).isFile()) {
          return false;
        }
      }
      return !this.hasPathShapeConflict(installedDir, diff);
    } catch {
      return false;
    }
  }

  discardUnavailablePending(
    state: BackendUpdateState,
  ): BackendUpdateState {
    if (!state.pending || this.pendingSourceAvailable(state.pending)) {
      return state;
    }
    const reset = { ...state, pending: null };
    this.cleanupStaging();
    this.writeState(reset);
    this.dependencies.log('后端更新暂存不完整，已清除并等待重新下载');
    return reset;
  }

  recoverInterrupted(state: BackendUpdateState): BackendPendingUpdate | null {
    if (!state.applying) return null;
    const pending = state.pending;
    if (!pending) throw new Error('中断的后端更新缺少 pending 状态');
    if (pending.type === 'incremental') {
      if (!pending.diff) {
        throw new Error('中断的后端增量更新缺少差异清单');
      }
      assertSafeDiffPlan(pending.diff);
      this.restoreIncremental(pending.diff);
    } else {
      this.restoreFull();
    }
    this.writeState({ ...state, applying: false });
    this.clearRollback(pending.type);
    return pending;
  }

  applyDiff(
    incomingPackage: string,
    diff: BackendDiffPlan | undefined,
    state: BackendUpdateState,
  ): BackendUpdateRollback {
    if (!diff) throw new Error('增量更新缺少差异清单');
    assertSafeDiffPlan(diff);
    const installedDir = this.dependencies.getInstalledPackageDir();
    const copies = [...diff.add, ...diff.modify];
    const affected = [...copies, ...diff.delete];
    for (const file of copies) {
      const source = resolveManagedPath(incomingPackage, file);
      if (!fs.existsSync(source) || !fs.lstatSync(source).isFile()) {
        throw new Error(`后端更新源文件不存在: ${file}`);
      }
    }

    fs.mkdirSync(installedDir, { recursive: true });
    const backupRoot = this.rollbackRoot('incremental');
    fs.rmSync(backupRoot, { recursive: true, force: true });
    fs.mkdirSync(backupRoot, { recursive: true });
    for (const file of affected) {
      const target = resolveManagedPath(installedDir, file);
      if (!fs.existsSync(target)) continue;
      if (!fs.lstatSync(target).isFile()) {
        throw new Error(`后端更新目标不是普通文件: ${file}`);
      }
      const backup = path.join(backupRoot, ...file.split('/'));
      fs.mkdirSync(path.dirname(backup), { recursive: true });
      fs.copyFileSync(target, backup);
    }
    this.writeState({ ...state, applying: true });

    const snapshot: BackendUpdateRollback = {
      restore: () => this.restoreIncremental(diff),
      clear: () => {
        this.writeState({ ...state, applying: false });
        this.clearRollback('incremental');
      },
    };
    try {
      for (const file of copies) {
        const target = resolveManagedPath(installedDir, file);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(
          resolveManagedPath(incomingPackage, file),
          target,
        );
      }
      for (const file of diff.delete) {
        fs.rmSync(resolveManagedPath(installedDir, file), { force: true });
      }
    } catch (error) {
      this.restoreOrThrow(snapshot, error);
    }
    return snapshot;
  }

  snapshotInstalledBackend(
    state: BackendUpdateState,
  ): BackendUpdateRollback {
    const sitePackages = path.dirname(
      this.dependencies.getInstalledPackageDir(),
    );
    const backupRoot = this.rollbackRoot('full');
    fs.rmSync(backupRoot, { recursive: true, force: true });
    fs.cpSync(sitePackages, backupRoot, { recursive: true });
    const backupStatePath = this.mirroredStatePath(
      sitePackages,
      backupRoot,
      this.dependencies.getStatePath(),
    );
    if (backupStatePath) fs.rmSync(backupStatePath, { force: true });
    this.writeState({ ...state, applying: true });
    return {
      restore: () => this.restoreFull(),
      clear: () => {
        this.writeState({ ...state, applying: false });
        this.clearRollback('full');
      },
    };
  }

  resetInstalledEnvironment(): void {
    const installedDir = this.dependencies.getInstalledPackageDir();
    const sitePackages = path.dirname(installedDir);
    const statePath = path.resolve(this.dependencies.getStatePath());
    if (isPathInside(sitePackages, statePath)) {
      this.removeContentsExcept(sitePackages, statePath);
    } else {
      fs.rmSync(sitePackages, { recursive: true, force: true });
      fs.mkdirSync(sitePackages, { recursive: true });
    }
  }

  finishApply(
    state: BackendUpdateState,
    pending: BackendPendingUpdate,
  ): void {
    this.writeState({
      ...state,
      appliedCommit: pending.commit,
      pending: null,
      applying: false,
    });
    this.cleanupStaging();
  }

  restoreOrThrow(
    snapshot: BackendUpdateRollback,
    originalError: unknown,
  ): never {
    const message = originalError instanceof Error
      ? originalError.message
      : String(originalError);
    try {
      snapshot.restore();
      snapshot.clear();
    } catch (restoreError) {
      throw new Error(
        `${message}；恢复原后端失败: ${
          restoreError instanceof Error
            ? restoreError.message
            : String(restoreError)
        }`,
      );
    }
    throw originalError instanceof Error
      ? originalError
      : new Error(message);
  }

  private pendingSourceAvailable(pending: BackendPendingUpdate): boolean {
    const stagingRoot = path.resolve(this.dependencies.getStagingRoot());
    const source = path.resolve(pending.source);
    const relative = path.relative(stagingRoot, source);
    if (
      !relative
      || path.isAbsolute(relative)
      || relative.split(path.sep)[0] === '..'
    ) {
      return false;
    }
    try {
      assertUnlinkedPath(stagingRoot, source);
    } catch {
      return false;
    }
    if (pending.type === 'full') {
      return fs.existsSync(source) && fs.lstatSync(source).isFile();
    }
    if (!fs.existsSync(source) || !fs.lstatSync(source).isDirectory()) {
      return false;
    }
    if (!pending.diff) return false;
    try {
      assertSafeDiffPlan(pending.diff);
    } catch {
      return false;
    }
    const copies = [
      ...pending.diff.add,
      ...pending.diff.modify,
    ];
    return copies.every(file => {
      if (!isSafeRelativePath(file)) return false;
      const target = path.join(source, ...file.split('/'));
      return fs.existsSync(target) && fs.lstatSync(target).isFile();
    });
  }

  private restoreIncremental(diff: BackendDiffPlan): void {
    assertSafeDiffPlan(diff);
    const installedDir = this.dependencies.getInstalledPackageDir();
    const affected = [...diff.add, ...diff.modify, ...diff.delete];
    const backupRoot = this.rollbackRoot('incremental');
    if (!fs.existsSync(backupRoot)) {
      throw new Error('后端增量更新备份缺失');
    }
    for (const file of affected) {
      fs.rmSync(resolveManagedPath(installedDir, file), { force: true });
    }
    for (const file of listRelativeFiles(backupRoot)) {
      const target = resolveManagedPath(installedDir, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(backupRoot, ...file.split('/')), target);
    }
  }

  private restoreFull(): void {
    const sitePackages = path.dirname(
      this.dependencies.getInstalledPackageDir(),
    );
    const backupRoot = this.rollbackRoot('full');
    if (!fs.existsSync(backupRoot)) {
      throw new Error('后端完整更新备份缺失');
    }
    const statePath = this.dependencies.getStatePath();
    if (isPathInside(sitePackages, statePath)) {
      this.removeContentsExcept(sitePackages, path.resolve(statePath));
    } else {
      fs.rmSync(sitePackages, { recursive: true, force: true });
    }
    fs.cpSync(backupRoot, sitePackages, { recursive: true });
  }

  private clearRollback(type: 'incremental' | 'full'): void {
    fs.rmSync(this.rollbackRoot(type), { recursive: true, force: true });
  }

  private rollbackRoot(type: 'incremental' | 'full'): string {
    return path.join(
      this.dependencies.getStagingRoot(),
      `rollback-${type}`,
    );
  }

  private mirroredStatePath(
    sourceRoot: string,
    targetRoot: string,
    statePath: string,
  ): string | null {
    if (!isPathInside(sourceRoot, statePath)) return null;
    const relative = path.relative(
      path.resolve(sourceRoot),
      path.resolve(statePath),
    );
    return path.join(targetRoot, relative);
  }

  private removeContentsExcept(root: string, preservedPath: string): void {
    fs.mkdirSync(root, { recursive: true });
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      const target = path.join(root, entry.name);
      if (path.resolve(target) === preservedPath) continue;
      if (isPathInside(target, preservedPath)) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) {
          throw new Error('后端更新状态路径包含符号链接');
        }
        this.removeContentsExcept(target, preservedPath);
        continue;
      }
      fs.rmSync(target, { recursive: true, force: true });
    }
  }

  private hasPathShapeConflict(
    installedDir: string,
    diff: BackendDiffPlan,
  ): boolean {
    return [...diff.add, ...diff.modify, ...diff.delete].some(file => {
      const parts = file.split('/');
      for (let length = 1; length < parts.length; length += 1) {
        const ancestor = path.join(installedDir, ...parts.slice(0, length));
        if (fs.existsSync(ancestor) && !fs.lstatSync(ancestor).isDirectory()) {
          return true;
        }
      }
      const target = path.join(installedDir, ...parts);
      return fs.existsSync(target) && !fs.lstatSync(target).isFile();
    });
  }

  private readStateDocument(): Record<string, unknown> | null {
    const target = this.dependencies.getStatePath();
    if (!fs.existsSync(target)) return {};
    try {
      const value = JSON.parse(fs.readFileSync(target, 'utf-8'));
      return isRecord(value) ? value : null;
    } catch {
      return null;
    }
  }

  private writeStateDocument(document: Record<string, unknown>): void {
    const target = this.dependencies.getStatePath();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    this.dependencies.atomicFiles.write(
      target,
      `${JSON.stringify(document, null, 2)}\n`,
    );
  }

  private isValidState(value: unknown): value is BackendUpdateState {
    if (!value || typeof value !== 'object') return false;
    const state = value as Partial<BackendUpdateState>;
    if (
      typeof state.guiVersion !== 'string'
      || typeof state.repository !== 'string'
      || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(state.repository)
      || typeof state.boundCommit !== 'string'
      || !isCommitSha(state.boundCommit)
      || typeof state.appliedCommit !== 'string'
      || !isCommitSha(state.appliedCommit)
    ) {
      return false;
    }
    return (state.applying === undefined || typeof state.applying === 'boolean')
      && (state.pending === null || this.isValidPending(state.pending));
  }

  private isValidPending(value: unknown): value is BackendPendingUpdate {
    if (!value || typeof value !== 'object') return false;
    const pending = value as Partial<BackendPendingUpdate>;
    if (
      (pending.type !== 'incremental' && pending.type !== 'full')
      || typeof pending.commit !== 'string'
      || !isCommitSha(pending.commit)
      || typeof pending.source !== 'string'
    ) {
      return false;
    }
    if (pending.type === 'full') return true;
    const diff = pending.diff as Partial<BackendDiffPlan> | undefined;
    if (!diff || typeof diff !== 'object') return false;
    const validShape = (
      Array.isArray(diff.add) && diff.add.every(isString)
      && Array.isArray(diff.modify) && diff.modify.every(isString)
      && Array.isArray(diff.delete) && diff.delete.every(isString)
    );
    if (!validShape) return false;
    try {
      assertSafeDiffPlan(diff as BackendDiffPlan);
      return true;
    } catch {
      return false;
    }
  }
}
