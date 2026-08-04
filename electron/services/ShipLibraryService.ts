/**
 * 管理舰船资料库同步、状态和渲染清单。
 */
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { AppPaths } from './AppPaths';

export interface ShipLibraryStatus {
  exists: boolean;
  path: string;
  generatedAt?: string;
  shipCount: number;
  assetCount: number;
  missingAssets: number;
  error?: string;
}

export interface ShipLibraryManifest {
  schemaVersion: number;
  generatedAt: string;
  labels: Record<string, unknown>;
  typeGroups: Record<string, unknown>;
  ships: Array<Record<string, unknown>>;
}

export interface ShipLibraryDependencies {
  processId: number;
  now?(): number;
}

/** 管理舰船资料库目录、内置升级、状态和渲染清单。 */
export class ShipLibraryService {
  constructor(
    private readonly appPaths: AppPaths,
    private readonly dependencies: ShipLibraryDependencies,
  ) {}

  /** 返回当前可写的用户舰船资料库目录。 */
  directory(): string {
    return path.join(this.appPaths.userDataRoot(), 'ship-library');
  }

  /** 返回开发或打包模式下的资料库更新脚本。 */
  updaterPath(): string {
    const root = this.appPaths.isPackaged()
      ? this.appPaths.resourceRoot()
      : this.appPaths.appRoot();
    return path.join(
      root,
      'tools',
      'ship_library',
      'update_ship_library.py',
    );
  }

  /** 按清单版本把内置资料库安全同步到用户目录。 */
  initialize(): void {
    const bundledDir = path.join(
      this.appPaths.resourceRoot(),
      'resource',
      'ship-library',
    );
    const bundledManifestPath = path.join(
      bundledDir,
      'manifest.json',
    );
    const userManifestPath = path.join(
      this.directory(),
      'manifest.json',
    );
    if (!fs.existsSync(bundledManifestPath)) return;

    let shouldSync = !fs.existsSync(userManifestPath);
    if (!shouldSync) {
      try {
        const bundled = JSON.parse(
          fs.readFileSync(bundledManifestPath, 'utf-8'),
        ) as Record<string, unknown>;
        const user = JSON.parse(
          fs.readFileSync(userManifestPath, 'utf-8'),
        ) as Record<string, unknown>;
        shouldSync = Number(
          bundled.schema_version ?? bundled.schemaVersion ?? 0,
        ) > Number(
          user.schema_version ?? user.schemaVersion ?? 0,
        )
          || String(
            bundled.generated_at ?? bundled.generatedAt ?? '',
          ) > String(
            user.generated_at ?? user.generatedAt ?? '',
          );
      } catch {
        shouldSync = true;
      }
    }
    if (!shouldSync) return;

    const temporary = `${this.directory()}.${this.dependencies.processId}.${this.now()}.sync`;
    const backup = `${this.directory()}.${this.dependencies.processId}.${this.now()}.backup`;
    let movedExisting = false;
    try {
      fs.rmSync(temporary, { recursive: true, force: true });
      this.copyDirectoryNoOverwrite(bundledDir, temporary);
      if (fs.existsSync(this.directory())) {
        fs.renameSync(this.directory(), backup);
        movedExisting = true;
      }
      fs.renameSync(temporary, this.directory());
      if (movedExisting) {
        fs.rmSync(backup, { recursive: true, force: true });
      }
    } catch (error) {
      fs.rmSync(temporary, { recursive: true, force: true });
      if (
        movedExisting
        && !fs.existsSync(this.directory())
        && fs.existsSync(backup)
      ) {
        try {
          fs.renameSync(backup, this.directory());
        } catch {
          console.error(
            '[ShipLibrary] 资料库旧版本恢复失败:',
            backup,
          );
        }
      }
      console.error('[ShipLibrary] 资料库升级失败:', error);
    }
  }

  /** 读取清单，为配置页提供当前资料库状态。 */
  getStatus(): ShipLibraryStatus {
    const directory = this.directory();
    const manifestPath = path.join(directory, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      return {
        exists: false,
        path: directory,
        shipCount: 0,
        assetCount: 0,
        missingAssets: 0,
      };
    }
    try {
      const manifest = JSON.parse(
        fs.readFileSync(manifestPath, 'utf-8'),
      ) as {
        generated_at?: unknown;
        counts?: Record<string, unknown>;
      };
      const counts = manifest.counts ?? {};
      return {
        exists: true,
        path: directory,
        generatedAt: typeof manifest.generated_at === 'string'
          ? manifest.generated_at
          : undefined,
        shipCount: typeof counts.ships === 'number'
          ? counts.ships
          : 0,
        assetCount: typeof counts.assets === 'number'
          ? counts.assets
          : 0,
        missingAssets: typeof counts.missing_assets === 'number'
          ? counts.missing_assets
          : 0,
      };
    } catch (error) {
      return {
        exists: false,
        path: directory,
        shipCount: 0,
        assetCount: 0,
        missingAssets: 0,
        error: `资料库清单读取失败: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  /** 返回舰队规划使用的清单字段和受限本地资源 URL。 */
  getManifest(): ShipLibraryManifest {
    const manifestPath = path.join(this.directory(), 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      throw new Error(
        '舰船资料库尚未建立，请先在配置页更新舰船数据库',
      );
    }
    const raw = JSON.parse(
      fs.readFileSync(manifestPath, 'utf-8'),
    ) as {
      schema_version?: unknown;
      generated_at?: unknown;
      labels?: unknown;
      type_groups?: unknown;
      ships?: unknown;
    };
    if (!Array.isArray(raw.ships)) {
      throw new Error('舰船资料库清单格式无效');
    }
    return {
      schemaVersion: typeof raw.schema_version === 'number'
        ? raw.schema_version
        : 0,
      generatedAt: typeof raw.generated_at === 'string'
        ? raw.generated_at
        : '',
      labels: raw.labels && typeof raw.labels === 'object'
        ? raw.labels as Record<string, unknown>
        : {},
      typeGroups: raw.type_groups && typeof raw.type_groups === 'object'
        ? raw.type_groups as Record<string, unknown>
        : {},
      ships: raw.ships.map((entry) => {
        const ship = entry && typeof entry === 'object'
          ? entry as Record<string, unknown>
          : {};
        return {
          ...ship,
          portraitUrl: this.assetUrl(ship.portrait),
          backgroundUrl: this.assetUrl(ship.background),
          frameUrl: this.assetUrl(ship.frame),
          typeIconUrl: this.assetUrl(ship.type_icon),
        };
      }),
    };
  }

  /** 将资料库内部相对路径转换为本地 file URL。 */
  assetUrl(relativePath: unknown): string {
    if (typeof relativePath !== 'string' || !relativePath) return '';
    const root = path.resolve(this.directory());
    const absolutePath = path.resolve(root, relativePath);
    if (
      absolutePath !== root
      && !absolutePath.startsWith(`${root}${path.sep}`)
    ) {
      return '';
    }
    return pathToFileURL(absolutePath).href;
  }

  /** 递归复制目录，并继续跳过已存在的文件。 */
  private copyDirectoryNoOverwrite(source: string, target: string): void {
    if (!fs.existsSync(target)) {
      fs.mkdirSync(target, { recursive: true });
    }
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
      const sourcePath = path.join(source, entry.name);
      const targetPath = path.join(target, entry.name);
      if (entry.isDirectory()) {
        this.copyDirectoryNoOverwrite(sourcePath, targetPath);
      } else if (!fs.existsSync(targetPath)) {
        fs.copyFileSync(sourcePath, targetPath);
      }
    }
  }

  /** 返回可注入的时间戳或当前系统时间。 */
  private now(): number {
    return this.dependencies.now?.() ?? Date.now();
  }
}
