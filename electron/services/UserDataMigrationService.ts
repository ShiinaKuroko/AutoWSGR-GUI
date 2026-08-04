/**
 * 迁移旧用户配置并维护迁移状态。
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { isDeepStrictEqual } from 'util';
import {
  DEFAULT_LOOT_PLAN_ID,
  LEGACY_LOOT_PLAN_IDS,
  lootPlanIdFromIndex,
  lootPlanIdFromLegacyPath,
  type LootPlanId,
} from '../../src/shared/lootPlans';
import { AppPaths } from './AppPaths';
import { AtomicFileStore } from './AtomicFileStore';
import {
  emptyLegacyMigrationSummary,
  type LegacyMigrationSummary,
} from './LegacyMigrationSummary';

/** 当前用户数据迁移状态格式。 */
export interface UserDataMigrationState {
  version: number;
  completed: string[];
}

/** 当前旧用户数据迁移版本。 */
export const USER_DATA_MIGRATION_VERSION = 5;

/** 管理迁移状态、旧配置复制和任务组路径更新。 */
export class UserDataMigrationService {
  constructor(
    private readonly appPaths: AppPaths,
    private readonly atomicFiles: AtomicFileStore,
  ) {}

  /** 读取当前迁移状态；无效文件按未迁移处理。 */
  readState(): UserDataMigrationState {
    try {
      const raw = JSON.parse(
        fs.readFileSync(this.statePath(), 'utf-8'),
      ) as Partial<UserDataMigrationState>;
      return {
        version: typeof raw.version === 'number' ? raw.version : 0,
        completed: Array.isArray(raw.completed)
          ? raw.completed.filter(value => typeof value === 'string')
          : [],
      };
    } catch {
      return { version: 0, completed: [] };
    }
  }

  /** 原子写入当前迁移状态。 */
  writeState(state: UserDataMigrationState): void {
    this.atomicFiles.write(
      this.statePath(),
      JSON.stringify(state, null, 2),
    );
  }

  /** 判断 EXE 目录是否包含旧版用户数据。 */
  hasLegacyInstallation(): boolean {
    const legacyRoot = this.appPaths.appRoot();
    return [
      'usersettings.yaml',
      'gui_settings.json',
      'task_groups.json',
      'plans',
      'templates',
      path.join('resource', 'user_battle_plans'),
      path.join('resource', 'user_team_plans'),
    ].some(relativePath => fs.existsSync(
      path.join(legacyRoot, relativePath),
    ));
  }

  /** 合并旧设置、任务组和模板，并保留旧目录中的源文件。 */
  migrateLegacyUserDataFiles(): LegacyMigrationSummary {
    const detected = this.hasLegacyInstallation();
    const summary = emptyLegacyMigrationSummary(detected);
    if (!detected) return summary;

    const legacyRoot = this.appPaths.appRoot();
    const targetRoot = this.appPaths.userDataRoot();
    for (
      const [file, format] of [
        ['usersettings.yaml', 'yaml'],
        ['gui_settings.json', 'json'],
      ] as const
    ) {
      this.recordResult(
        summary,
        path.join(legacyRoot, file),
        () => this.migrateStructuredFile(
          path.join(legacyRoot, file),
          path.join(targetRoot, file),
          format,
        ),
      );
    }
    this.reconcilePreviouslyMigratedLootPlanSelection();
    this.recordResult(
      summary,
      path.join(legacyRoot, 'task_groups.json'),
      () => this.migrateLegacyTaskGroups(
        path.join(legacyRoot, 'task_groups.json'),
        path.join(targetRoot, 'task_groups.json'),
      ),
    );
    const legacyTemplates = path.join(legacyRoot, 'templates');
    if (fs.existsSync(legacyTemplates)) {
      for (const source of this.regularFiles(legacyTemplates)) {
        this.recordResult(
          summary,
          source,
          () => this.migrateTemplate(
            source,
            path.join(
              targetRoot,
              'templates',
              path.relative(legacyTemplates, source),
            ),
          ),
        );
      }
    }
    return summary;
  }

  /** 根据旧计划文件名映射更新任务组的受管计划引用。 */
  migrateLegacyTaskGroupPlanPaths(
    fileMap: Map<string, string>,
  ): void {
    const taskGroupsPath = path.join(
      this.appPaths.userDataRoot(),
      'task_groups.json',
    );
    if (!fs.existsSync(taskGroupsPath) || fileMap.size === 0) return;
    const raw = JSON.parse(
      fs.readFileSync(taskGroupsPath, 'utf-8'),
    ) as Record<string, unknown>;
    if (!Array.isArray(raw.groups)) return;
    let changed = false;
    const groups = raw.groups.map(group => {
      if (!this.isPlainObject(group) || !Array.isArray(group.items)) {
        return group;
      }
      return {
        ...group,
        items: group.items.map(item => {
          if (!this.isPlainObject(item)) return item;
          const oldPath = typeof item.path === 'string' ? item.path : '';
          const oldFile = oldPath.split(/[\\/]/).pop() ?? '';
          const newFile = fileMap.get(
            this.planReferenceKey(oldPath),
          ) ?? fileMap.get(this.planReferenceKey(oldFile));
          if (!newFile) return item;
          changed = true;
          return {
            ...item,
            managedSource: 'user',
            managedFile: newFile,
            path: oldPath,
          };
        }),
      };
    });
    if (changed) {
      this.atomicFiles.write(
        taskGroupsPath,
        JSON.stringify({
          ...raw,
          version: 2,
          groups,
        }, null, 2),
      );
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

  /** 复制或合并旧任务组，同名但内容不同的组保留为旧版副本。 */
  private migrateLegacyTaskGroups(source: string, target: string): boolean {
    if (!fs.existsSync(source) || this.pathKey(source) === this.pathKey(target)) {
      return false;
    }
    const sourceContent = fs.readFileSync(source, 'utf-8');
    this.parseTaskGroups(sourceContent, '旧任务组');
    const state = this.readState();
    const completed = new Set(state.completed);
    const key = this.taskGroupMigrationKey(source, sourceContent);
    if (completed.has(key)) return false;

    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (!fs.existsSync(target)) {
      this.atomicFiles.write(target, sourceContent);
    } else {
      this.mergeTaskGroupFiles(sourceContent, target);
    }
    completed.add(key);
    this.writeState({
      version: state.version,
      completed: [...completed].sort(),
    });
    return true;
  }

  private mergeTaskGroupFiles(sourceContent: string, target: string): void {
    const source = this.parseTaskGroups(sourceContent, '旧任务组');
    const targetContent = fs.readFileSync(target, 'utf-8');
    const current = this.parseTaskGroups(targetContent, '当前任务组');
    const groups = [...current.groups];
    let changed = false;

    for (const rawGroup of source.groups) {
      if (!this.isPlainObject(rawGroup)) continue;
      const group = {
        ...rawGroup,
        name: this.taskGroupName(rawGroup),
      };
      const sameName = groups.filter(candidate => (
        this.isPlainObject(candidate)
        && this.taskGroupName(candidate) === group.name
      ));
      if (sameName.some(candidate => this.sameJson(candidate, group))) {
        continue;
      }
      if (sameName.length > 0) {
        group.name = this.uniqueLegacyTaskGroupName(group.name, groups);
      }
      groups.push(group);
      changed = true;
    }
    if (!changed) return;

    const activeGroup = (
      typeof current.activeGroup === 'string'
      && groups.some(group => (
        this.isPlainObject(group)
        && this.taskGroupName(group) === current.activeGroup
      ))
    )
      ? current.activeGroup
      : (
        typeof source.activeGroup === 'string'
          ? source.activeGroup
          : this.firstTaskGroupName(groups)
      );
    this.atomicFiles.write(
      target,
      JSON.stringify({
        ...current,
        version: 1,
        activeGroup,
        groups,
      }, null, 2),
    );
  }

  private parseTaskGroups(
    content: string,
    label: string,
  ): Record<string, unknown> & { groups: unknown[] } {
    const parsed = JSON.parse(content) as unknown;
    if (!this.isPlainObject(parsed) || !Array.isArray(parsed.groups)) {
      throw new Error(`${label}文件格式无效`);
    }
    return {
      ...parsed,
      groups: parsed.groups,
    };
  }

  private taskGroupName(group: Record<string, unknown>): string {
    return typeof group.name === 'string' && group.name.trim()
      ? group.name.trim()
      : '默认';
  }

  private uniqueLegacyTaskGroupName(
    name: string,
    groups: unknown[],
  ): string {
    const usedNames = new Set(groups.flatMap(group => (
      this.isPlainObject(group) ? [this.taskGroupName(group)] : []
    )));
    let candidate = `${name}（旧版）`;
    let suffix = 2;
    while (usedNames.has(candidate)) {
      candidate = `${name}（旧版 ${suffix})`;
      suffix += 1;
    }
    return candidate;
  }

  private firstTaskGroupName(groups: unknown[]): string {
    const first = groups.find(group => this.isPlainObject(group));
    return first && this.isPlainObject(first)
      ? this.taskGroupName(first)
      : '';
  }

  private taskGroupMigrationKey(source: string, content: string): string {
    const hash = crypto
      .createHash('sha256')
      .update(content)
      .digest('hex');
    return `task-groups-v5:${this.pathKey(source)}:${hash}`;
  }

  private pathKey(value: string): string {
    const resolved = path.resolve(value);
    return process.platform === 'win32'
      ? resolved.toLowerCase()
      : resolved;
  }

  private sameJson(left: unknown, right: unknown): boolean {
    return isDeepStrictEqual(left, right);
  }

  private statePath(): string {
    return path.join(
      this.appPaths.userDataRoot(),
      '.migration-state.json',
    );
  }

  private migrateStructuredFile(
    source: string,
    target: string,
    format: 'yaml' | 'json',
  ): boolean {
    if (!fs.existsSync(source) || this.pathKey(source) === this.pathKey(target)) {
      return false;
    }
    const sourceContent = fs.readFileSync(source, 'utf-8');
    const state = this.readState();
    const completed = new Set(state.completed);
    const key = this.contentMigrationKey(format, source, sourceContent);
    if (completed.has(key)) return false;

    const legacy = this.parseStructuredContent(
      sourceContent,
      format,
      `旧版 ${path.basename(source)}`,
    );
    if (format === 'yaml' && path.basename(source) === 'usersettings.yaml') {
      this.migrateLegacyLootPlanSelection(legacy, source);
    }
    const current = fs.existsSync(target)
      ? this.parseStructuredContent(
        fs.readFileSync(target, 'utf-8'),
        format,
        `当前 ${path.basename(target)}`,
      )
      : {};
    const merged = this.deepMerge(current, legacy);
    const content = format === 'yaml'
      ? yaml.dump(merged, {
        lineWidth: -1,
        noCompatMode: true,
        noRefs: true,
        sortKeys: false,
      })
      : JSON.stringify(merged, null, 2);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    this.atomicFiles.write(target, content);
    completed.add(key);
    this.writeState({
      version: state.version,
      completed: [...completed].sort(),
    });
    return true;
  }

  /**
   * 把旧数字索引转换为稳定计划文件名。
   *
   * 完整旧安装优先使用其 builtin_templates.json 解释真实数组顺序；
   * 找不到模板资源时，才按 PR 前四项布局迁移。
   */
  private migrateLegacyLootPlanSelection(
    settings: Record<string, unknown>,
    source: string,
  ): void {
    const daily = settings.daily_automation;
    if (!this.isPlainObject(daily)) return;
    if (typeof daily.loot_plan_id === 'string') return;
    if (!Number.isFinite(Number(daily.loot_plan_index))) return;

    const index = Math.trunc(Number(daily.loot_plan_index));
    const resolved = this.resolveLegacyLootPlanId(
      index,
      path.dirname(source),
    );
    daily.loot_plan_id = resolved ?? DEFAULT_LOOT_PLAN_ID;
    if (!resolved) daily.auto_loot = false;
    delete daily.loot_plan_index;
  }

  /**
   * 纠正已由中间版本搬到 GUI JSON、但尚未解释语义的旧索引。
   * 两边索引不一致说明用户后来改过选择，此时保留 GUI JSON 的新布局语义。
   */
  private reconcilePreviouslyMigratedLootPlanSelection(): void {
    const legacyRoot = this.appPaths.appRoot();
    const source = path.join(legacyRoot, 'usersettings.yaml');
    const target = path.join(
      this.appPaths.userDataRoot(),
      'gui_settings.json',
    );
    if (!fs.existsSync(source) || !fs.existsSync(target)) return;

    try {
      const settings = this.parseStructuredContent(
        fs.readFileSync(source, 'utf-8'),
        'yaml',
        '旧版 usersettings.yaml',
      );
      const daily = settings.daily_automation;
      if (!this.isPlainObject(daily)) return;
      if (!Number.isFinite(Number(daily.loot_plan_index))) return;

      const gui = this.parseStructuredContent(
        fs.readFileSync(target, 'utf-8'),
        'json',
        '当前 gui_settings.json',
      );
      const automation = gui.automation;
      if (!this.isPlainObject(automation)) return;
      if (typeof automation.lootPlanId === 'string') return;
      if (!Number.isFinite(Number(automation.lootPlanIndex))) return;

      const sourceIndex = Math.trunc(Number(daily.loot_plan_index));
      const targetIndex = Math.trunc(Number(automation.lootPlanIndex));
      if (sourceIndex !== targetIndex) return;

      const resolved = this.resolveLegacyLootPlanId(
        sourceIndex,
        legacyRoot,
      );
      const migrated: Record<string, unknown> = {
        ...automation,
        lootPlanId: resolved ?? DEFAULT_LOOT_PLAN_ID,
      };
      delete migrated.lootPlanIndex;
      if (!resolved) migrated.autoLoot = false;
      this.atomicFiles.write(
        target,
        JSON.stringify({ ...gui, automation: migrated }, null, 2),
      );
    } catch {
      // 损坏文件沿用各自读取服务的既有回退，不覆盖原文件。
    }
  }

  /** 按旧安装自己的模板顺序解释刷取计划索引。 */
  private resolveLegacyLootPlanId(
    index: number,
    legacyRoot: string,
  ): LootPlanId | null {
    const legacyPath = this.legacyLootPlanPaths(legacyRoot)[index];
    return lootPlanIdFromLegacyPath(legacyPath)
      ?? lootPlanIdFromIndex(index, LEGACY_LOOT_PLAN_IDS);
  }

  /** 读取旧安装自己保存的刷胖次模板顺序。 */
  private legacyLootPlanPaths(legacyRoot: string): string[] {
    const candidates = [
      path.join(
        legacyRoot,
        'resources',
        'resource',
        'builtin_templates.json',
      ),
      path.join(legacyRoot, 'resource', 'builtin_templates.json'),
    ];
    for (const file of candidates) {
      try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as unknown;
        if (!Array.isArray(parsed)) continue;
        const template = parsed.find(item => (
          this.isPlainObject(item)
          && item.id === 'builtin_farm_loot'
          && Array.isArray(item.planPaths)
        ));
        if (!this.isPlainObject(template) || !Array.isArray(template.planPaths)) {
          continue;
        }
        return template.planPaths.filter(
          (value): value is string => typeof value === 'string',
        );
      } catch {
        // 旧模板缺失或损坏时使用已知四项布局。
      }
    }
    return [];
  }

  private migrateTemplate(source: string, target: string): boolean {
    const content = fs.readFileSync(source);
    const state = this.readState();
    const completed = new Set(state.completed);
    const key = this.contentMigrationKey(
      'template',
      source,
      content,
    );
    if (completed.has(key)) return false;

    let destination = target;
    if (
      fs.existsSync(destination)
      && !fs.readFileSync(destination).equals(content)
    ) {
      destination = this.uniqueLegacyPath(destination);
    }
    if (!fs.existsSync(destination)) {
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      this.atomicFiles.write(destination, content.toString('utf-8'));
    }
    completed.add(key);
    this.writeState({
      version: state.version,
      completed: [...completed].sort(),
    });
    return true;
  }

  private recordResult(
    summary: LegacyMigrationSummary,
    source: string,
    operation: () => boolean,
  ): void {
    if (!fs.existsSync(source)) return;
    try {
      if (!operation()) return;
      summary.total += 1;
      summary.succeeded += 1;
    } catch (error) {
      summary.total += 1;
      summary.failed += 1;
      summary.failedFiles.push(source);
      console.error(`[Migration] ${source} failed:`, error);
    }
  }

  private parseStructuredContent(
    content: string,
    format: 'yaml' | 'json',
    label: string,
  ): Record<string, unknown> {
    const parsed = format === 'yaml'
      ? yaml.load(content)
      : JSON.parse(content);
    if (!this.isPlainObject(parsed)) {
      throw new Error(`${label}根节点必须是对象`);
    }
    return parsed;
  }

  private deepMerge(
    defaults: Record<string, unknown>,
    legacy: Record<string, unknown>,
  ): Record<string, unknown> {
    const result = structuredClone(defaults);
    for (const [key, value] of Object.entries(legacy)) {
      const current = result[key];
      result[key] = this.isPlainObject(current) && this.isPlainObject(value)
        ? this.deepMerge(current, value)
        : structuredClone(value);
    }
    return result;
  }

  private contentMigrationKey(
    kind: string,
    source: string,
    content: string | Buffer,
  ): string {
    const hash = crypto
      .createHash('sha256')
      .update(content)
      .digest('hex');
    return `${kind}-v5:${this.pathKey(source)}:${hash}`;
  }

  private regularFiles(directory: string): string[] {
    const files: string[] = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        files.push(...this.regularFiles(target));
      } else if (entry.isFile()) {
        files.push(target);
      }
    }
    return files;
  }

  private uniqueLegacyPath(target: string): string {
    const extension = path.extname(target);
    const base = target.slice(0, -extension.length);
    let candidate = `${base}（旧版）${extension}`;
    let suffix = 2;
    while (fs.existsSync(candidate)) {
      candidate = `${base}（旧版 ${suffix}）${extension}`;
      suffix += 1;
    }
    return candidate;
  }

  private isPlainObject(
    value: unknown,
  ): value is Record<string, unknown> {
    return Boolean(value)
      && typeof value === 'object'
      && !Array.isArray(value);
  }
}
