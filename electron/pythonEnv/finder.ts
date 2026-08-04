/**
 * 按用户配置、便携版、系统全局的顺序查找 Python。
 */
import * as path from 'path';
import * as fs from 'fs';
import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import { getCtx, getCachedPythonCmd, setCachedPythonCmd } from './context';

const execAsync = promisify(exec);

/** 判断 Python 版本是否为 3.12 或 3.13。 */
export function isAllowedPythonVersion(versionOutput: string): boolean {
  const m = versionOutput.match(/(\d+)\.(\d+)/);
  if (!m) return false;
  const major = parseInt(m[1], 10);
  const minor = parseInt(m[2], 10);
  return major === 3 && (minor === 12 || minor === 13);
}

/** 异步查找并缓存兼容的 Python 可执行文件。 */
export async function findPython(): Promise<string | null> {
  if (getCachedPythonCmd() !== undefined) return getCachedPythonCmd()!;

  const ctx = getCtx();
  let found: string | null = null;

  // 优先使用配置页指定的 Python。
  const configured = ctx.getConfiguredPythonPath();
  if (configured && fs.existsSync(configured)) {
    try {
      const { stdout, stderr } = await execAsync(`"${configured}" --version`, { windowsHide: true });
      const verStr = stdout || stderr;
      if (isAllowedPythonVersion(verStr)) found = configured;
      else ctx.sendProgress(`WARNING 用户配置的 Python 版本不兼容: ${verStr.trim()}（需要 3.12 或 3.13），回退自动检测`);
    } catch {
      ctx.sendProgress('WARNING 用户配置的 Python 路径无法执行，回退自动检测');
    }
  } else if (configured) {
    ctx.sendProgress('WARNING 用户配置的 Python 路径不存在，回退自动检测');
  }

  // 其次使用本地便携版 Python。
  const localPython = path.join(ctx.appRoot(), 'python', 'python.exe');
  if (!found && fs.existsSync(localPython)) {
    try {
      const { stdout, stderr } = await execAsync(`"${localPython}" --version`, { windowsHide: true });
      const verStr = stdout || stderr;
      if (isAllowedPythonVersion(verStr)) found = localPython;
      else ctx.sendProgress(`WARNING 本地 Python 版本不兼容: ${verStr.trim()}（需要 3.12 或 3.13）`);
    } catch { /* 本地 Python 不可用时继续查找。 */ }
  }

  if (!found) {  // 用户配置和本地 Python 均不可用时回退系统 Python
    // 最后回退到系统 Python；需解析真实 exe，避免 spawn 无法执行 .bat shim。
    for (const cmd of ['python', 'python3']) {
      try {
        const { stdout: verOut, stderr: verErr } = await execAsync(`${cmd} --version`, { windowsHide: true });
        if (!isAllowedPythonVersion(verOut || verErr)) continue;
        // 通过 Python 自身解析真实可执行文件。
        const { stdout } = await execAsync(
          `${cmd} -c "import sys; print(sys.executable)"`,
          { windowsHide: true },
        );
        const resolved = stdout.trim();
        found = (resolved && fs.existsSync(resolved)) ? resolved : cmd;
        break;
      } catch { /* 当前命令不可用时继续查找。 */ }
    }
  }

  setCachedPythonCmd(found);
  return found;
}

/** 同步判断 Python 版本是否兼容。 */
function isAllowedPythonVersionSync(pythonCmd: string): boolean {
  try {
    const output = execSync(
      `"${pythonCmd}" --version 2>&1`,
      { encoding: 'utf-8', windowsHide: true, shell: 'cmd.exe' },
    );
    return isAllowedPythonVersion(output);
  } catch {
    return false;
  }
}

/** 为同步调用方查找并缓存 Python。 */
export function findPythonSync(): string | null {
  if (getCachedPythonCmd() !== undefined) return getCachedPythonCmd()!;
  const ctx = getCtx();
  // 优先使用用户配置的 Python。
  const configured = ctx.getConfiguredPythonPath();
  if (configured && fs.existsSync(configured) && isAllowedPythonVersionSync(configured)) {
    setCachedPythonCmd(configured);
    return configured;
  }
  const localPython = path.join(ctx.appRoot(), 'python', 'python.exe');
  if (fs.existsSync(localPython) && isAllowedPythonVersionSync(localPython)) {
    setCachedPythonCmd(localPython);
    return localPython;
  }
  for (const cmd of ['python', 'python3']) {
    try {
      if (!isAllowedPythonVersionSync(cmd)) continue;
      // 解析 pyenv 或 .bat shim 指向的真实路径。
      const resolved = execSync(
        `${cmd} -c "import sys; print(sys.executable)"`,
        { windowsHide: true, encoding: 'utf-8' },
      ).trim();
      const result = (resolved && fs.existsSync(resolved)) ? resolved : cmd;
      setCachedPythonCmd(result);
      return result;
    } catch { /* 当前命令不可用时继续查找。 */ }
  }
  return null;
}
