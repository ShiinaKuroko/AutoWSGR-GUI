/**
 * 幂等迁移旧作战计划和对应任务组引用。
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { AppPaths } from './AppPaths';
import { AtomicFileStore } from './AtomicFileStore';
import {
  emptyLegacyMigrationSummary,
  type LegacyMigrationSummary,
} from './LegacyMigrationSummary';
import {
  USER_DATA_MIGRATION_VERSION,
  UserDataMigrationService,
} from './UserDataMigrationService';

/** 编队 Codec 为迁移生成的单个原子写入。 */
export interface LegacyTeamWrite {
  name: string;
  file: string;
  path: string;
  content: string;
}

/** 由现有计划 Codec 注入的迁移领域规则。 */
export interface LegacyPlanMigrationDependencies<TTeam> {
  yamlFiles(directory: string): string[];
  safePlanBaseName(value: string): string;
  normalizeUserTeamPlan(raw: unknown): TTeam;
  teamPlanMatches(filePath: string, team: TTeam): boolean;
  teamName?(team: TTeam): string;
  renameTeam?(team: TTeam, name: string): TTeam;
  normalizeCombatPlanFleetPresets(
    root: Record<string, unknown>,
    source: 'user',
    requireEmbeddedShips: boolean,
  ): {
    mapRoot: Record<string, unknown>;
    teams: TTeam[];
  };
  buildTeamPlanWrites(
    teams: TTeam[],
    directory: string,
  ): LegacyTeamWrite[];
  serializeCombatPlan(
    root: Record<string, unknown>,
    originalContent: string,
  ): string;
  isStandaloneTaskPreset?(
    root: Record<string, unknown>,
  ): boolean;
  normalizeTaskPreset?(
    root: Record<string, unknown>,
  ): Record<string, unknown>;
}

/** 编排旧计划迁移，不在本服务中重复任何计划格式规则。 */
export class LegacyPlanMigration<TTeam> {
  constructor(
    private readonly appPaths: AppPaths,
    private readonly atomicFiles: AtomicFileStore,
    private readonly userDataMigration: UserDataMigrationService,
    private readonly dependencies: LegacyPlanMigrationDependencies<TTeam>,
  ) {}

  /** 扫描旧安装中的有效 YAML，并返回本次实际迁移结果。 */
  migrate(): LegacyMigrationSummary {
    const detected = this.userDataMigration.hasLegacyInstallation();
    const summary = emptyLegacyMigrationSummary(detected);
    if (!detected) return summary;

    const state = this.userDataMigration.readState();
    const completed = new Set(state.completed);
    const fileMap = new Map<string, string>();
    const teamsFailed = this.migrateLegacyTeams(completed, summary);
    const plansFailed = this.migrateLegacyPlans(
      completed,
      fileMap,
      summary,
    );
    const additionalFailed = this.migrateAdditionalYaml(
      completed,
      fileMap,
      summary,
    );

    this.userDataMigration.migrateLegacyTaskGroupPlanPaths(fileMap);
    const nextState = {
      version: teamsFailed || plansFailed || additionalFailed
        ? 0
        : USER_DATA_MIGRATION_VERSION,
      completed: [...completed].sort(),
    };
    const currentCompleted = [...state.completed].sort();
    if (
      state.version !== nextState.version
      || JSON.stringify(currentCompleted) !== JSON.stringify(
        nextState.completed,
      )
    ) {
      this.userDataMigration.writeState(nextState);
    }
    return summary;
  }

  /** 先迁移旧版独立编队，供引用型旧计划继续使用。 */
  private migrateLegacyTeams(
    completed: Set<string>,
    summary: LegacyMigrationSummary,
  ): boolean {
    const targetDirectory = this.appPaths.userTeamPlansDir();
    let failed = false;
    for (
      const legacyDirectory of this.legacyDirectories(
        'user_team_plans',
        targetDirectory,
      )
    ) {
      for (
        const file of this.dependencies.yamlFiles(legacyDirectory)
      ) {
        const source = path.join(legacyDirectory, file);
        const content = fs.readFileSync(source, 'utf-8');
        const key = this.migrationKey('team', source, content);
        if (completed.has(key)) continue;
        summary.total += 1;
        try {
          const team = this.dependencies.normalizeUserTeamPlan(
            yaml.load(content),
          );
          const resolved = this.resolveTeamWrite(
            team,
            targetDirectory,
          );
          if (!fs.existsSync(resolved.write.path)) {
            this.atomicFiles.write(
              resolved.write.path,
              resolved.write.content,
            );
          }
          completed.add(key);
          summary.succeeded += 1;
        } catch (error) {
          failed = true;
          summary.failed += 1;
          summary.failedFiles.push(source);
          console.error(`[Migration] ${source} failed:`, error);
        }
      }
    }
    return failed;
  }

  /** 升级旧计划并写入 GUI 管理的用户计划目录。 */
  private migrateLegacyPlans(
    completed: Set<string>,
    fileMap: Map<string, string>,
    summary: LegacyMigrationSummary,
  ): boolean {
    const targetDirectory = this.appPaths.userBattlePlansDir();
    let failed = false;
    for (
      const legacyDirectory of [
        ...this.legacyDirectories('plans', targetDirectory),
        ...this.legacyDirectories(
          'user_battle_plans',
          targetDirectory,
        ),
      ]
    ) {
      for (
        const file of this.dependencies.yamlFiles(legacyDirectory)
      ) {
        const source = path.join(legacyDirectory, file);
        const content = fs.readFileSync(source, 'utf-8');
        const key = this.migrationKey('plan', source, content);
        if (completed.has(key)) {
          this.registerFileMapping(
            fileMap,
            source,
            this.completedPlanTarget(completed, key, file),
          );
          continue;
        }
        summary.total += 1;
        try {
          const parsed = yaml.load(content);
          if (!this.isPlainObject(parsed)) {
            throw new Error('旧计划根节点必须是对象');
          }
          const standalone = (
            this.dependencies.isStandaloneTaskPreset?.(parsed) === true
          );
          const split = standalone
            ? {
              mapRoot: this.dependencies.normalizeTaskPreset?.(parsed)
                ?? parsed,
              teams: [],
            }
            : this.dependencies.normalizeCombatPlanFleetPresets(
              parsed,
              'user',
              false,
            );
          const targetFile = this.writeMigratedPlan(
            file,
            content,
            split.mapRoot,
            split.teams,
          );
          this.registerFileMapping(fileMap, source, targetFile);
          this.rememberPlanTarget(completed, key, targetFile);
          completed.add(key);
          summary.succeeded += 1;
        } catch (error) {
          failed = true;
          summary.failed += 1;
          summary.failedFiles.push(source);
          console.error(`[Migration] ${source} failed:`, error);
        }
      }
    }
    return failed;
  }

  /** 递归扫描旧安装其余目录，只迁移能明确识别的计划 YAML。 */
  private migrateAdditionalYaml(
    completed: Set<string>,
    fileMap: Map<string, string>,
    summary: LegacyMigrationSummary,
  ): boolean {
    let failed = false;
    for (const source of this.recursiveLegacyYamlFiles()) {
      if (this.isHandledLegacyYaml(source)) continue;
      const content = fs.readFileSync(source, 'utf-8');
      let parsed: unknown;
      try {
        parsed = yaml.load(content);
      } catch {
        // 非计划目录中的普通 YAML 不属于用户迁移失败。
        continue;
      }
      if (!this.isPlainObject(parsed)) continue;

      const isTeam = (
        typeof parsed.name === 'string'
        && Array.isArray(parsed.ships)
      );
      const isPreset = (
        this.dependencies.isStandaloneTaskPreset?.(parsed) === true
      );
      const isPlan = 'chapter' in parsed && 'map' in parsed;
      if (!isTeam && !isPreset && !isPlan) continue;

      const kind = isTeam ? 'team' : 'plan';
      const key = this.migrationKey(kind, source, content);
      const file = path.basename(source);
      if (completed.has(key)) {
        if (!isTeam) {
          this.registerFileMapping(
            fileMap,
            source,
            this.completedPlanTarget(completed, key, file),
          );
        }
        continue;
      }

      summary.total += 1;
      try {
        if (isTeam) {
          this.migrateAdditionalTeam(parsed);
        } else {
          const targetFile = this.migrateAdditionalPlan(
            file,
            content,
            parsed,
            isPreset,
          );
          this.registerFileMapping(fileMap, source, targetFile);
          this.rememberPlanTarget(completed, key, targetFile);
        }
        completed.add(key);
        summary.succeeded += 1;
      } catch (error) {
        failed = true;
        summary.failed += 1;
        summary.failedFiles.push(source);
        console.error(`[Migration] ${source} failed:`, error);
      }
    }
    return failed;
  }

  private migrateAdditionalTeam(raw: Record<string, unknown>): void {
    const team = this.dependencies.normalizeUserTeamPlan(raw);
    const resolved = this.resolveTeamWrite(
      team,
      this.appPaths.userTeamPlansDir(),
    );
    if (!fs.existsSync(resolved.write.path)) {
      this.atomicFiles.write(
        resolved.write.path,
        resolved.write.content,
      );
    }
  }

  private migrateAdditionalPlan(
    file: string,
    content: string,
    parsed: Record<string, unknown>,
    standalone: boolean,
  ): string {
    const split = standalone
      ? {
        mapRoot: this.dependencies.normalizeTaskPreset?.(parsed)
          ?? parsed,
        teams: [],
      }
      : this.dependencies.normalizeCombatPlanFleetPresets(
        parsed,
        'user',
        false,
      );
    return this.writeMigratedPlan(
      file,
      content,
      split.mapRoot,
      split.teams,
    );
  }

  private writeMigratedPlan(
    file: string,
    content: string,
    mapRoot: Record<string, unknown>,
    teams: TTeam[],
  ): string {
    const defaultTargetFile = this.migratedUserPlanFileName(file);
    const originalPlan = this.dependencies.serializeCombatPlan(
      mapRoot,
      content,
    );
    const existingOriginal = this.matchingPlanTarget(
      defaultTargetFile,
      originalPlan,
    );
    if (existingOriginal) {
      this.writeMissingOriginalTeams(teams);
      return existingOriginal.file;
    }

    const resolved = this.resolvePlanTeams(mapRoot, teams);
    const serializedPlan = this.dependencies.serializeCombatPlan(
      resolved.mapRoot,
      content,
    );
    const planTarget = this.resolvePlanTarget(
      defaultTargetFile,
      serializedPlan,
    );
    const createdTeams: string[] = [];
    try {
      for (const team of resolved.writes) {
        if (!fs.existsSync(team.path)) {
          this.atomicFiles.write(team.path, team.content);
          createdTeams.push(team.path);
        }
      }
      if (!planTarget.matches) {
        this.atomicFiles.write(planTarget.path, serializedPlan);
      }
    } catch (error) {
      for (const teamPath of createdTeams) {
        try {
          fs.rmSync(teamPath, { force: true });
        } catch {
          // 清理失败不能覆盖最初的迁移错误。
        }
      }
      throw error;
    }
    return planTarget.file;
  }

  /** 已有同内容计划表示曾迁移过，只补缺失编队而不覆盖现有编队。 */
  private writeMissingOriginalTeams(teams: TTeam[]): void {
    const writes = this.dependencies.buildTeamPlanWrites(
      teams,
      this.appPaths.userTeamPlansDir(),
    );
    for (const write of writes) {
      if (!fs.existsSync(write.path)) {
        this.atomicFiles.write(write.path, write.content);
      }
    }
  }

  private matchingPlanTarget(
    defaultFile: string,
    content: string,
  ): { file: string; path: string } | null {
    for (let suffix = 0; ; suffix += 1) {
      const file = this.legacyPlanFileName(defaultFile, suffix);
      const target = path.join(
        this.appPaths.userBattlePlansDir(),
        file,
      );
      if (!fs.existsSync(target)) return null;
      if (fs.readFileSync(target, 'utf-8') === content) {
        return { file, path: target };
      }
    }
  }

  private resolvePlanTarget(
    defaultFile: string,
    content: string,
  ): { file: string; path: string; matches: boolean } {
    for (let suffix = 0; ; suffix += 1) {
      const file = this.legacyPlanFileName(defaultFile, suffix);
      const target = path.join(
        this.appPaths.userBattlePlansDir(),
        file,
      );
      if (!fs.existsSync(target)) {
        return { file, path: target, matches: false };
      }
      if (fs.readFileSync(target, 'utf-8') === content) {
        return { file, path: target, matches: true };
      }
    }
  }

  private legacyPlanFileName(defaultFile: string, suffix: number): string {
    if (suffix === 0) return defaultFile;
    const extension = path.extname(defaultFile);
    const base = defaultFile.slice(0, -extension.length);
    const label = suffix === 1
      ? '（旧版）'
      : `（旧版 ${suffix}）`;
    return `${base}${label}${extension}`;
  }

  private resolvePlanTeams(
    mapRoot: Record<string, unknown>,
    teams: TTeam[],
  ): {
    mapRoot: Record<string, unknown>;
    teams: TTeam[];
    writes: LegacyTeamWrite[];
  } {
    const resolvedRoot = structuredClone(mapRoot);
    const resolvedTeams: TTeam[] = [];
    const writes: LegacyTeamWrite[] = [];
    const reservedPaths = new Set<string>();
    for (const team of teams) {
      const resolved = this.resolveTeamWrite(
        team,
        this.appPaths.userTeamPlansDir(),
        reservedPaths,
      );
      const oldName = this.dependencies.teamName?.(team);
      const newName = this.dependencies.teamName?.(resolved.team);
      if (oldName && newName && oldName !== newName) {
        this.replaceTeamReference(resolvedRoot, oldName, newName);
      }
      reservedPaths.add(this.pathKey(resolved.write.path));
      resolvedTeams.push(resolved.team);
      writes.push(resolved.write);
    }
    return {
      mapRoot: resolvedRoot,
      teams: resolvedTeams,
      writes,
    };
  }

  private resolveTeamWrite(
    team: TTeam,
    directory: string,
    reservedPaths = new Set<string>(),
  ): { team: TTeam; write: LegacyTeamWrite } {
    const originalName = this.dependencies.teamName?.(team);
    let candidate = team;
    let suffix = 1;
    for (;;) {
      const [write] = this.dependencies.buildTeamPlanWrites(
        [candidate],
        directory,
      );
      if (!write) throw new Error('旧舰队未生成迁移文件');
      const reserved = reservedPaths.has(this.pathKey(write.path));
      const conflicts = (
        fs.existsSync(write.path)
        && !this.dependencies.teamPlanMatches(write.path, candidate)
      );
      if (!reserved && !conflicts) {
        return { team: candidate, write };
      }
      if (
        !originalName
        || !this.dependencies.renameTeam
      ) {
        throw new Error(`迁移目标已存在，未覆盖：${write.path}`);
      }
      const name = suffix === 1
        ? `${originalName}（旧版）`
        : `${originalName}（旧版 ${suffix}）`;
      candidate = this.dependencies.renameTeam(team, name);
      suffix += 1;
    }
  }

  private replaceTeamReference(
    mapRoot: Record<string, unknown>,
    oldName: string,
    newName: string,
  ): void {
    if (!Array.isArray(mapRoot.fleet_presets)) return;
    mapRoot.fleet_presets = mapRoot.fleet_presets.map(preset => (
      this.isPlainObject(preset) && preset.name === oldName
        ? { ...preset, name: newName }
        : preset
    ));
  }

  private recursiveLegacyYamlFiles(): string[] {
    const files: string[] = [];
    this.collectYamlFiles(this.appPaths.appRoot(), files);
    return files.sort((left, right) => left.localeCompare(right));
  }

  private collectYamlFiles(directory: string, files: string[]): void {
    if (!fs.existsSync(directory) || this.isExcludedDirectory(directory)) {
      return;
    }
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        this.collectYamlFiles(target, files);
      } else if (
        entry.isFile()
        && /\.ya?ml$/i.test(entry.name)
      ) {
        files.push(target);
      }
    }
  }

  private isExcludedDirectory(directory: string): boolean {
    const name = path.basename(directory).toLowerCase();
    if (new Set([
      '.git',
      '.venv',
      'venv',
      'node_modules',
      'dist',
      'dist-electron',
    ]).has(name)) {
      return true;
    }
    return [
      this.appPaths.userBattlePlansDir(),
      this.appPaths.userTeamPlansDir(),
      this.appPaths.systemBattlePlansDir(),
      this.appPaths.systemTeamPlansDir(),
    ].some(excluded => this.pathWithin(directory, excluded));
  }

  private isHandledLegacyYaml(source: string): boolean {
    const handledDirectories = [
      ...this.legacyDirectories(
        'plans',
        this.appPaths.userBattlePlansDir(),
      ),
      ...this.legacyDirectories(
        'user_battle_plans',
        this.appPaths.userBattlePlansDir(),
      ),
      ...this.legacyDirectories(
        'user_team_plans',
        this.appPaths.userTeamPlansDir(),
      ),
    ];
    return handledDirectories.some(directory => (
      this.pathWithin(source, directory)
    ));
  }

  private pathWithin(candidate: string, root: string): boolean {
    const relative = path.relative(
      path.resolve(root),
      path.resolve(candidate),
    );
    return relative === ''
      || (
        relative !== '..'
        && !relative.startsWith(`..${path.sep}`)
        && !path.isAbsolute(relative)
      );
  }

  private migrationKey(
    kind: 'plan' | 'team',
    source: string,
    content: string,
  ): string {
    const hash = crypto
      .createHash('sha256')
      .update(content)
      .digest('hex');
    return `${kind}-v5:${this.pathKey(source)}:${hash}`;
  }

  private rememberPlanTarget(
    completed: Set<string>,
    migrationKey: string,
    targetFile: string,
  ): void {
    const prefix = this.planTargetMarkerPrefix(migrationKey);
    for (const value of completed) {
      if (value.startsWith(prefix)) completed.delete(value);
    }
    completed.add(`${prefix}${encodeURIComponent(targetFile)}`);
  }

  private completedPlanTarget(
    completed: Set<string>,
    migrationKey: string,
    sourceFile: string,
  ): string {
    const prefix = this.planTargetMarkerPrefix(migrationKey);
    const marker = [...completed].find(value => value.startsWith(prefix));
    if (marker) {
      try {
        const targetFile = decodeURIComponent(marker.slice(prefix.length));
        if (
          targetFile
          && !/[\\/]/.test(targetFile)
          && /\.ya?ml$/i.test(targetFile)
        ) {
          return targetFile;
        }
      } catch {
        // 无效输出记录回退到旧版本默认目标文件名。
      }
    }
    return this.migratedUserPlanFileName(sourceFile);
  }

  private planTargetMarkerPrefix(migrationKey: string): string {
    const hash = crypto
      .createHash('sha256')
      .update(migrationKey)
      .digest('hex');
    return `plan-output-v5:${hash}:`;
  }

  private registerFileMapping(
    fileMap: Map<string, string>,
    source: string,
    targetFile: string,
  ): void {
    const relative = path.relative(this.appPaths.appRoot(), source);
    for (const value of [source, relative, path.basename(source)]) {
      const key = this.planReferenceKey(value);
      if (key && !fileMap.has(key)) fileMap.set(key, targetFile);
    }
  }

  private planReferenceKey(value: string): string {
    const normalized = value
      .trim()
      .replace(/\\/g, '/')
      .replace(/^\.\/+/, '');
    return process.platform === 'win32'
      ? normalized.toLowerCase()
      : normalized;
  }

  /** 返回去重后的旧目录，并排除当前 userData 目标目录。 */
  private legacyDirectories(
    directoryName: 'plans' | 'user_battle_plans' | 'user_team_plans',
    targetDirectory: string,
  ): string[] {
    const candidates = directoryName === 'plans'
      ? [
        path.join(this.appPaths.appRoot(), 'plans'),
        path.join(this.appPaths.userDataRoot(), 'plans'),
      ]
      : [
        path.join(
          this.appPaths.appRoot(),
          'resource',
          directoryName,
        ),
        path.join(
          this.appPaths.resourceRoot(),
          'resource',
          directoryName,
        ),
      ];
    const targetKey = this.pathKey(targetDirectory);
    const unique = new Map<string, string>();
    for (const candidate of candidates) {
      const key = this.pathKey(candidate);
      if (key !== targetKey && !unique.has(key)) {
        unique.set(key, candidate);
      }
    }
    return [...unique.values()];
  }

  private pathKey(value: string): string {
    const resolved = path.resolve(value);
    return process.platform === 'win32'
      ? resolved.toLowerCase()
      : resolved;
  }

  private migratedUserPlanFileName(file: string): string {
    const baseName = this.dependencies.safePlanBaseName(file);
    if (!baseName) {
      throw new Error(`旧计划文件名不合法: ${file}`);
    }
    return `bettle-${baseName}.yaml`;
  }

  private isPlainObject(
    value: unknown,
  ): value is Record<string, unknown> {
    return Boolean(value)
      && typeof value === 'object'
      && !Array.isArray(value);
  }
}
