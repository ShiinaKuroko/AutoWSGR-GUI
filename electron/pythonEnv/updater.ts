/**
 * 通过依赖注入检查并更新 autowsgr。
 */
import * as path from 'path';
import * as fs from 'fs';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/** PyPI 2.2.2 尚未包含 2026-07-30 活动支持，临时固定到上游已合入提交。 */
const AUTOWSGR_REQUIREMENT = 'https://github.com/OpenWSGR/AutoWSGR/archive/a38252d3.zip';

export interface AutoUpdateDeps {
  sendProgress: (msg: string) => void;
  getTempDir: () => string;
  appRoot: () => string;
  localSitePackages: () => string;
  pipEnv: () => NodeJS.ProcessEnv;
  ensurePip: (pythonCmd: string) => Promise<boolean>;
}

/** 检查 PyPI 更新并返回最终安装版本。 */
export async function autoUpdateAutowsgr(pythonCmd: string, deps: AutoUpdateDeps): Promise<string | null> {
  try {
    deps.sendProgress('正在检查 autowsgr 更新…');

    // 单次 Python 调用同时获取本地和 PyPI 版本。
    const spFwd = deps.localSitePackages().replace(/\\/g, '\\\\');
    const checkScript = [
      'import json, sys',
      `sys.path.insert(0, r'${spFwd}')`,
      'result = {}',
      'try:',
      '    import autowsgr',
      '    from pathlib import Path',
      '    result["local"] = autowsgr.__version__',
      '    root = Path(autowsgr.__file__).resolve().parent',
      '    result["event20260730"] = (root / "data" / "map" / "event" / "20260730").is_dir()',
      'except:',
      '    result["local"] = None',
      '    result["event20260730"] = False',
      'try:',
      '    import urllib.request',
      '    data = json.loads(urllib.request.urlopen("https://pypi.org/pypi/autowsgr/json", timeout=10).read())',
      '    result["latest"] = data["info"]["version"]',
      'except: result["latest"] = None',
      'print(json.dumps(result))',
    ].join('\n');

    const scriptPath = path.join(deps.getTempDir(), 'autowsgr_update_check.py');
    fs.writeFileSync(scriptPath, checkScript, 'utf-8');

    const { stdout } = await execAsync(
      `"${pythonCmd}" "${scriptPath}"`,
      { windowsHide: true, timeout: 20000, env: deps.pipEnv() },
    );
    try { fs.unlinkSync(scriptPath); } catch { /* 忽略清理失败。 */ }

    const info = JSON.parse(stdout.trim());
    const localVer: string | null = info.local;
    const latestVer: string | null = info.latest;
    const supportsLatestEvent = info.event20260730 === true;

    if (!latestVer) {
      deps.sendProgress('autowsgr 更新检查跳过（无法获取最新版本信息）');
      return localVer;
    }

    if (localVer === latestVer && supportsLatestEvent) {
      deps.sendProgress(`autowsgr ${localVer} 已是最新版 ✓`);
      return localVer;
    }

    // PyPI 无更高版本时才使用活动热修复提交。
    const needsEventHotfix = !supportsLatestEvent && localVer === latestVer;
    if (!supportsLatestEvent) {
      deps.sendProgress('当前 autowsgr 缺少 20260730 活动支持，正在安装上游活动热修复…');
    } else {
      deps.sendProgress(`发现 autowsgr 更新: ${localVer ?? '未安装'} → ${latestVer}，正在自动升级…`);
    }
    const installRequirement = needsEventHotfix ? AUTOWSGR_REQUIREMENT : 'autowsgr';
    const targetDir = deps.localSitePackages();
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

    // 确保 pip 可用。
    if (!(await deps.ensurePip(pythonCmd))) {
      deps.sendProgress('WARNING pip 不可用，autowsgr 升级跳过');
      return localVer;
    }

    const buildDepsCode = await new Promise<number>((resolve) => {
      const proc = spawn(pythonCmd, [
        '-m', 'pip', 'install',
        '--upgrade',
        '--target', targetDir,
        'hatchling',
        'hatch-vcs',
      ], {
        cwd: deps.appRoot(),
        windowsHide: true,
        stdio: 'pipe',
        env: deps.pipEnv(),
      });
      proc.stdout?.on('data', (d: Buffer) => { for (const l of d.toString().split('\n')) { if (l.trim()) deps.sendProgress(l.trim()); } });
      proc.stderr?.on('data', (d: Buffer) => { for (const l of d.toString().split('\n')) { if (l.trim()) deps.sendProgress(l.trim()); } });
      proc.on('close', (code) => resolve(code ?? 1));
      proc.on('error', () => resolve(1));
    });
    if (buildDepsCode !== 0) {
      deps.sendProgress('WARNING 活动热修复构建依赖安装失败');
      return localVer;
    }

    const exitCode = await new Promise<number>((resolve) => {
      const proc = spawn(pythonCmd, [
        '-m', 'pip', 'install',
        '--upgrade',
        '--target', targetDir,
        '--no-build-isolation',
        '--no-deps',
        '-i', 'https://pypi.tuna.tsinghua.edu.cn/simple',
        '--trusted-host', 'pypi.tuna.tsinghua.edu.cn',
        installRequirement,
      ], {
        cwd: deps.appRoot(),
        windowsHide: true,
        stdio: 'pipe',
        env: deps.pipEnv(),
      });
      proc.stdout?.on('data', (d: Buffer) => { for (const l of d.toString().split('\n')) { if (l.trim()) deps.sendProgress(l.trim()); } });
      proc.stderr?.on('data', (d: Buffer) => { for (const l of d.toString().split('\n')) { if (l.trim()) deps.sendProgress(l.trim()); } });
      proc.on('close', (code) => resolve(code ?? 1));
      proc.on('error', () => resolve(1));
    });

    if (exitCode !== 0) {
      deps.sendProgress('WARNING autowsgr 升级失败，使用当前版本继续');
      return localVer;
    }

    // 升级后一次性验证版本和关键依赖。
    const postScript = path.join(deps.getTempDir(), 'autowsgr_post_upgrade.py');
    fs.writeFileSync(postScript, [
      'import json, sys, site',
      `sys.path.insert(0, r'${spFwd}')`,
      `site.addsitedir(r'${spFwd}')`,
      'r = {"version": "unknown", "missing": []}',
      'try:',
      '    import autowsgr',
      '    from pathlib import Path',
      '    r["version"] = autowsgr.__version__',
      '    root = Path(autowsgr.__file__).resolve().parent',
      '    r["event20260730"] = (root / "data" / "map" / "event" / "20260730").is_dir()',
      'except: pass',
      "for m in ['fastapi', 'uvicorn']:",
      '    try: __import__(m)',
      '    except Exception: r["missing"].append(m)',
      'print(json.dumps(r))',
    ].join('\n'), 'utf-8');

    try {
      const { stdout: postOut } = await execAsync(
        `"${pythonCmd}" "${postScript}"`,
        { windowsHide: true, timeout: 15000, env: deps.pipEnv() },
      );
      try { fs.unlinkSync(postScript); } catch { /* 忽略清理失败。 */ }
      const postResult = JSON.parse(postOut.trim());
      const actualVer: string = postResult.version;
      const missing: string[] = postResult.missing;
      const eventReady = postResult.event20260730 === true;

      if (needsEventHotfix && !eventReady) {
        deps.sendProgress('WARNING 活动热修复安装后仍未检测到 20260730 资源');
        return localVer;
      }

      if (missing.length > 0) {
        deps.sendProgress(`升级后缺少依赖: ${missing.join(', ')}，正在补装…`);
        const fixCode = await new Promise<number>((resolve) => {
          const proc = spawn(pythonCmd, [
            '-m', 'pip', 'install',
            '--target', targetDir,
            '--force-reinstall', '--no-deps',
            '-i', 'https://pypi.tuna.tsinghua.edu.cn/simple',
            '--trusted-host', 'pypi.tuna.tsinghua.edu.cn',
            ...missing,
          ], {
            cwd: deps.appRoot(),
            windowsHide: true,
            stdio: 'pipe',
            env: deps.pipEnv(),
          });
          proc.stdout?.on('data', (d: Buffer) => { for (const l of d.toString().split('\n')) { if (l.trim()) deps.sendProgress(l.trim()); } });
          proc.stderr?.on('data', (d: Buffer) => { for (const l of d.toString().split('\n')) { if (l.trim()) deps.sendProgress(l.trim()); } });
          proc.on('close', (code) => resolve(code ?? 1));
          proc.on('error', () => resolve(1));
        });

        if (fixCode !== 0) {
          await new Promise<void>((resolve) => {
            const proc = spawn(pythonCmd, [
              '-m', 'pip', 'install',
              '--target', targetDir,
              '-i', 'https://pypi.tuna.tsinghua.edu.cn/simple',
              '--trusted-host', 'pypi.tuna.tsinghua.edu.cn',
              ...missing,
            ], {
              cwd: deps.appRoot(),
              windowsHide: true,
              stdio: 'pipe',
              env: deps.pipEnv(),
            });
            proc.stdout?.on('data', (d: Buffer) => { for (const l of d.toString().split('\n')) { if (l.trim()) deps.sendProgress(l.trim()); } });
            proc.stderr?.on('data', (d: Buffer) => { for (const l of d.toString().split('\n')) { if (l.trim()) deps.sendProgress(l.trim()); } });
            proc.on('close', () => resolve());
            proc.on('error', () => resolve());
          });
        }
        deps.sendProgress(`依赖补装完成 ✓`);
      }

      if (actualVer !== 'unknown') {
        const expectedVersion = needsEventHotfix ? localVer : latestVer;
        const msg = actualVer === expectedVersion
          ? needsEventHotfix
            ? `autowsgr ${actualVer} 活动热修复已安装 ✓`
            : `autowsgr 已升级至 ${latestVer} ✓`
          : `autowsgr 已升级至 ${actualVer}（期望 ${expectedVersion}）`;
        deps.sendProgress(msg);
        return actualVer;
      }
    } catch {
      try { fs.unlinkSync(postScript); } catch { /* 忽略清理失败。 */ }
    }

    if (needsEventHotfix) {
      deps.sendProgress(`autowsgr ${localVer} 活动热修复已安装 ✓`);
      return localVer;
    }
    deps.sendProgress(`autowsgr 已升级至 ${latestVer} ✓`);
    return latestVer;
  } catch {
    deps.sendProgress('autowsgr 更新检查跳过（网络不可用或超时）');
    return null;
  }
}
