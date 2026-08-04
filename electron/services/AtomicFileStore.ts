/**
 * 通过临时文件和 Windows 回退完成原子写入。
 */
import * as fs from 'fs';

const WINDOWS_RETRY_DELAYS_MS = [20, 50, 100];
const WINDOWS_TRANSIENT_CODES = new Set(['EACCES', 'EBUSY', 'EPERM']);

/** 为需要失败回滚的持久化模块提供统一写入能力。 */
export class AtomicFileStore {
  /** 把 UTF-8 文本写入目标文件，并在失败时保留原文件。 */
  write(filePath: string, content: string): void {
    const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    const backup = `${filePath}.${process.pid}.${Date.now()}.bak`;
    let movedExisting = false;
    try {
      this.retryWindowsFileLock(() => {
        fs.writeFileSync(temporary, content, 'utf-8');
      });
      try {
        fs.renameSync(temporary, filePath);
      } catch (error) {
        if (process.platform !== 'win32' || !fs.existsSync(filePath)) {
          throw error;
        }
        fs.renameSync(filePath, backup);
        movedExisting = true;
        try {
          fs.renameSync(temporary, filePath);
        } catch (replaceError) {
          try {
            fs.renameSync(backup, filePath);
            movedExisting = false;
          } catch {
            throw new Error(
              `替换文件失败，旧文件保留在备份路径: ${backup}`,
            );
          }
          throw replaceError;
        }
      }
      if (movedExisting) fs.rmSync(backup, { force: true });
    } catch (error) {
      try {
        fs.rmSync(temporary, { force: true });
      } catch {
        // 清理失败不能覆盖最初的替换错误。
      }
      throw error;
    }
  }

  /** Windows 文件扫描或短暂占用时，等待后重试临时文件写入。 */
  private retryWindowsFileLock(operation: () => void): void {
    for (let attempt = 0; ; attempt += 1) {
      try {
        operation();
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        const delay = WINDOWS_RETRY_DELAYS_MS[attempt];
        if (
          process.platform !== 'win32'
          || !code
          || !WINDOWS_TRANSIENT_CODES.has(code)
          || delay === undefined
        ) {
          throw error;
        }
        Atomics.wait(
          new Int32Array(new SharedArrayBuffer(4)),
          0,
          0,
          delay,
        );
      }
    }
  }
}
