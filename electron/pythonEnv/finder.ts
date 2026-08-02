/**
 * Python 可执行文件查找逻辑。
 * 优先级: 用户配置 > 本地便携版 > 系统全局。
 */
import * as path from 'path';
import * as fs from 'fs';
import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import { getCtx, getCachedPythonCmd, setCachedPythonCmd } from './context';

const execAsync = promisify(exec);

/** 检查 Python 版本是否为 3.12.x 或 3.13.x */
export function isAllowedPythonVersion(versionOutput: string): boolean {
  const m = versionOutput.match(/(\d+)\.(\d+)/);
  if (!m) return false;
  const major = parseInt(m[1], 10);
  const minor = parseInt(m[2], 10);
  return major === 3 && (minor === 12 || minor === 13);
}

/** 查找可用的 Python 可执行文件 (用户配置 > 本地便携版 > 系统, 仅接受 3.12/3.13, 结果会缓存) */
export async function findPython(): Promise<string | null> {
  if (getCachedPythonCmd() !== undefined) return getCachedPythonCmd()!;

  const ctx = getCtx();
  let found: string | null = null;

  // 最高优先级：用户在配置页指定的 Python 路径
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

  // 优先使用本地便携版 Python
  const localPython = path.join(ctx.appRoot(), 'python', 'python.exe');
  if (!found && fs.existsSync(localPython)) {
    try {
      const { stdout, stderr } = await execAsync(`"${localPython}" --version`, { windowsHide: true });
      const verStr = stdout || stderr;
      if (isAllowedPythonVersion(verStr)) found = localPython;
      else ctx.sendProgress(`WARNING 本地 Python 版本不兼容: ${verStr.trim()}（需要 3.12 或 3.13）`);
    } catch { /* local Python broken */ }
  }

  if (!found) {  // 用户配置和本地 Python 均不可用时回退系统 Python
    // 回退到系统全局 Python
    // 注意: 必须解析出真实的 .exe 绝对路径，因为 pyenv 等工具使用 .bat shim，
    // 而 Node.js spawn() 不经过 shell，无法执行 .bat 文件。
    for (const cmd of ['python', 'python3']) {
      try {
        const { stdout: verOut, stderr: verErr } = await execAsync(`${cmd} --version`, { windowsHide: true });
        if (!isAllowedPythonVersion(verOut || verErr)) continue;
        // 通过 Python 自身获取真实可执行文件路径 (解决 pyenv/.bat shim 问题)
        const { stdout } = await execAsync(
          `${cmd} -c "import sys; print(sys.executable)"`,
          { windowsHide: true },
        );
        const resolved = stdout.trim();
        found = (resolved && fs.existsSync(resolved)) ? resolved : cmd;
        break;
      } catch { /* continue */ }
    }
  }

  setCachedPythonCmd(found);
  return found;
}

/** 同步检查 Python 版本是否被允许 (shell 重定向以同时捕获 stdout/stderr) */
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

/** 同步查找 Python (用于非 async 上下文) */
export function findPythonSync(): string | null {
  if (getCachedPythonCmd() !== undefined) return getCachedPythonCmd()!;
  const ctx = getCtx();
  // 最高优先级：用户配置的 Python 路径
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
      // 解析真实路径 (pyenv/.bat shim 兼容)
      const resolved = execSync(
        `${cmd} -c "import sys; print(sys.executable)"`,
        { windowsHide: true, encoding: 'utf-8' },
      ).trim();
      const result = (resolved && fs.existsSync(resolved)) ? resolved : cmd;
      setCachedPythonCmd(result);
      return result;
    } catch { /* continue */ }
  }
  return null;
}
