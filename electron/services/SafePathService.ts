/**
 * 解析应用路径并阻止越界、穿越和链接逃逸。
 */
import * as fs from 'fs';
import * as path from 'path';
import { AppPaths } from './AppPaths';

type FileCapability = 'read' | 'write';

/** 统一执行主进程文件能力的目录边界检查。 */
export class SafePathService {
  constructor(private readonly appPaths: AppPaths) {}

  /** 为兼容现有调用方解析一个可读取的应用路径。 */
  resolveAppPath(filePath: string): string {
    return this.resolve(filePath, 'read');
  }

  /** 解析只允许读取的 userData 或打包资源路径。 */
  resolveReadablePath(filePath: string): string {
    return this.resolve(filePath, 'read');
  }

  /** 解析只允许写入的 userData 路径。 */
  resolveWritablePath(filePath: string): string {
    return this.resolve(filePath, 'write');
  }

  private resolve(filePath: string, capability: FileCapability): string {
    const raw = typeof filePath === 'string' ? filePath.trim() : '';
    if (!raw) throw new Error('文件路径不能为空');
    if (raw.includes('\0')) throw new Error('文件路径包含非法字符');
    if (/^[\\/]{2}/.test(raw)) throw new Error('不允许使用 UNC 路径');

    const hasDrivePrefix = /^[a-zA-Z]:/.test(raw);
    const nativeAbsolute = path.isAbsolute(raw);
    const portableAbsolute = path.win32.isAbsolute(raw)
      || path.posix.isAbsolute(raw);
    if (hasDrivePrefix && !nativeAbsolute) {
      throw new Error('不允许使用盘符相对路径');
    }
    if (portableAbsolute && !nativeAbsolute) {
      throw new Error('不允许切换路径根目录');
    }
    const pathWithoutDrive = hasDrivePrefix ? raw.slice(2) : raw;
    if (pathWithoutDrive.includes(':')) {
      throw new Error('文件路径包含非法字符');
    }

    const segments = raw.split(/[\\/]+/);
    if (segments.includes('..')) {
      throw new Error('文件路径不允许包含 ..');
    }

    const resourceDirectory = path.join(
      this.appPaths.resourceRoot(),
      'resource',
    );
    const isResourceRelative = !nativeAbsolute
      && segments[0]?.toLowerCase() === 'resource';
    if (capability === 'write' && isResourceRelative) {
      throw new Error('安装资源目录为只读');
    }

    const relativeSegments = isResourceRelative
      ? segments.slice(1)
      : segments;
    const relativeRoot = isResourceRelative
      ? resourceDirectory
      : this.appPaths.userDataRoot();
    const candidate = nativeAbsolute
      ? path.resolve(raw)
      : path.resolve(relativeRoot, ...relativeSegments);
    const roots = capability === 'read'
      ? [this.appPaths.userDataRoot(), resourceDirectory]
      : [this.appPaths.userDataRoot()];
    const allowed = roots.some(root => this.isContained(candidate, root));
    if (!allowed) throw new Error('文件路径超出应用允许目录');
    return candidate;
  }

  /** 展开现有链接后验证目标仍位于允许根目录。 */
  private isContained(candidate: string, root: string): boolean {
    const canonicalCandidate = this.canonicalizePotentialPath(candidate);
    const canonicalRoot = this.canonicalizePotentialPath(root);
    const normalizedCandidate = this.normalizeForComparison(
      canonicalCandidate,
    );
    const normalizedRoot = this.normalizeForComparison(canonicalRoot);
    const relative = path.relative(normalizedRoot, normalizedCandidate);
    return relative === ''
      || (
        relative !== '..'
        && !relative.startsWith(`..${path.sep}`)
        && !path.isAbsolute(relative)
      );
  }

  /** 展开最近存在的祖先，阻止新路径通过目录链接逃逸。 */
  private canonicalizePotentialPath(value: string): string {
    let current = path.resolve(value);
    const missingSegments: string[] = [];
    while (!this.pathEntryExists(current)) {
      const parent = path.dirname(current);
      if (parent === current) {
        return path.resolve(current, ...missingSegments);
      }
      missingSegments.unshift(path.basename(current));
      current = parent;
    }
    let canonicalExisting: string;
    try {
      canonicalExisting = fs.realpathSync.native(current);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        throw new Error('文件路径包含无法解析的符号链接');
      }
      throw error;
    }
    return path.resolve(canonicalExisting, ...missingSegments);
  }

  /** lstat 不跟随链接，因此悬空链接也会被视为现有路径节点。 */
  private pathEntryExists(value: string): boolean {
    try {
      fs.lstatSync(value);
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') return false;
      throw error;
    }
  }

  /** Windows 文件系统路径按不区分大小写规则比较。 */
  private normalizeForComparison(value: string): string {
    const resolved = path.resolve(value);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  }
}
