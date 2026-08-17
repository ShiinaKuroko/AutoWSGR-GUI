import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface BackendUpdateRemoteDependencies {
  fetchJson?: (url: string) => Promise<unknown>;
  downloadArchive?: (
    url: string,
    destination: string,
    onProgress: (percent: number) => void,
  ) => Promise<void>;
  extractArchive?: (zipPath: string, destination: string) => Promise<void>;
}

/** GitHub 后端源码及归档的远端来源 Repository。 */
export class BackendUpdateRemoteRepository {
  constructor(
    private readonly dependencies: BackendUpdateRemoteDependencies,
  ) {}

  async fetchJson(url: string): Promise<unknown> {
    if (this.dependencies.fetchJson) {
      return this.dependencies.fetchJson(url);
    }
    const response = await fetch(url, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) {
      throw new Error(`GitHub API 请求失败 (${response.status})`);
    }
    return response.json();
  }

  async downloadArchive(
    url: string,
    destination: string,
    onProgress: (percent: number) => void,
  ): Promise<void> {
    if (this.dependencies.downloadArchive) {
      return this.dependencies.downloadArchive(
        url,
        destination,
        onProgress,
      );
    }
    const response = await fetch(url, {
      signal: AbortSignal.timeout(300000),
    });
    if (!response.ok) {
      throw new Error(`后端源码包下载失败 (${response.status})`);
    }
    const total = Number(response.headers.get('content-length') ?? 0);
    let received = 0;
    const reader = response.body?.getReader();
    if (!reader) throw new Error('后端源码包下载流不可用');
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const partial = `${destination}.part`;
    try {
      const handle = fs.openSync(partial, 'w');
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          fs.writeSync(handle, value);
          received += value.byteLength;
          if (total > 0) onProgress(Math.floor((received / total) * 100));
        }
      } finally {
        fs.closeSync(handle);
      }
      fs.renameSync(partial, destination);
    } catch (error) {
      fs.rmSync(partial, { force: true });
      throw error;
    }
    onProgress(100);
  }

  async extractArchive(
    zipPath: string,
    destination: string,
  ): Promise<void> {
    if (this.dependencies.extractArchive) {
      return this.dependencies.extractArchive(zipPath, destination);
    }
    fs.mkdirSync(destination, { recursive: true });
    await execAsync(
      `powershell -NoProfile -Command "Expand-Archive -Path '${zipPath.replace(/'/g, "''")}'`
      + ` -DestinationPath '${destination.replace(/'/g, "''")}' -Force"`,
      { windowsHide: true, timeout: 120000 },
    );
  }

  /** GitHub 归档解压后必须只有一个仓库根目录。 */
  locateSourceRoot(extractDir: string): string {
    const entries = fs.readdirSync(extractDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory());
    if (entries.length !== 1) {
      throw new Error('后端源码包结构异常');
    }
    return path.join(extractDir, entries[0].name);
  }
}
