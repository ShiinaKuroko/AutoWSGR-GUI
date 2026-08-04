/**
 * 在路径能力边界内读写主进程文本文件。
 */
import * as fs from 'fs';
import * as path from 'path';
import { SafePathService } from './SafePathService';

/** 集中管理主进程对普通文本文件的现有访问规则。 */
export class SecureFileService {
  constructor(private readonly safePaths: SafePathService) {}

  /** 在允许目录内覆盖保存 UTF-8 文本。 */
  save(filePath: string, content: string): void {
    let resolved = this.safePaths.resolveWritablePath(filePath);
    const directory = path.dirname(resolved);
    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory, { recursive: true });
    }
    resolved = this.safePaths.resolveWritablePath(resolved);
    fs.writeFileSync(resolved, content, 'utf-8');
  }

  /** 在允许目录内读取 UTF-8 文本，不存在时返回空字符串。 */
  read(filePath: string): string {
    const resolved = this.safePaths.resolveReadablePath(filePath);
    if (!fs.existsSync(resolved)) return '';
    return fs.readFileSync(resolved, 'utf-8');
  }

  /** 在允许目录内追加 UTF-8 文本。 */
  append(filePath: string, content: string): void {
    let resolved = this.safePaths.resolveWritablePath(filePath);
    const directory = path.dirname(resolved);
    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory, { recursive: true });
    }
    resolved = this.safePaths.resolveWritablePath(resolved);
    fs.appendFileSync(resolved, content, 'utf-8');
  }

  /** 读取用户通过系统文件对话框显式选择的文件。 */
  readSelectedFile(filePath: string): string {
    return fs.readFileSync(filePath, 'utf-8');
  }

  /** 写入用户通过系统保存对话框显式选择的文件。 */
  writeSelectedFile(filePath: string, content: string): void {
    fs.writeFileSync(filePath, content, 'utf-8');
  }
}
