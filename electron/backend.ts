/**
 * 后端服务管理（启动 / 停止 / setup.bat）。
 * 从 main.ts 提取。
 */
import * as path from 'path';
import * as fs from 'fs';
import { execSync, spawn, ChildProcess } from 'child_process';
import type { BrowserWindow } from 'electron';
import { ensurePthFile, ensureSslCertForPython, findPython, localSitePackages } from './pythonEnv';
import { buildResourceEnvironment, SHIP_LIBRARY_ENV, shipLibraryRoot } from './resourcePaths';

// ════════════════════════════════════════
// Context — 由 main.ts 在启动时注入
// ════════════════════════════════════════

export interface BackendContext {
  appRoot: () => string;
  resourceRoot: () => string;
  BACKEND_PORT: number;
  getMainWindow: () => BrowserWindow | null;
}

let ctx: BackendContext;

export function initBackend(context: BackendContext): void {
  ctx = context;
}

// ════════════════════════════════════════
// 内部状态
// ════════════════════════════════════════

let backendProcess: ChildProcess | null = null;

export function getBackendProcess(): ChildProcess | null {
  return backendProcess;
}

type OcrGpuMode = 'auto' | 'cpu' | 'cuda';

function readGuiSettings(): Record<string, unknown> {
  try {
    const settingsPath = path.join(ctx.appRoot(), 'gui_settings.json');
    if (!fs.existsSync(settingsPath)) return {};
    return JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function readBackendRepoOverrideFromSettings(): string | null {
  const raw = readGuiSettings();
  const value = raw.backend_repo_path;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readOcrGpuModeFromSettings(): OcrGpuMode {
  const raw = readGuiSettings();
  const value = raw.ocr_gpu_mode;
  if (value === 'cpu' || value === 'cuda') return value;
  return 'auto';
}

function normalizeCudaRoot(candidate: string): string {
  const resolved = path.resolve(candidate.trim());
  if (isCudaRuntimeDirectory(resolved)) return resolved;
  return path.basename(resolved).toLowerCase() === 'bin' ? path.dirname(resolved) : resolved;
}

function isCudaRuntimeDirectory(candidate: string): boolean {
  try {
    const names = fs.readdirSync(candidate);
    return names.some(name => /^cudart64.*\.dll$/i.test(name))
      && names.some(name => /^cublas64.*\.dll$/i.test(name));
  } catch {
    return false;
  }
}

function readCudaPathFromSettings(): string | null {
  const raw = readGuiSettings();
  const value = raw.cuda_path;
  if (typeof value !== 'string' || !value.trim()) return null;
  const cudaRoot = normalizeCudaRoot(value);
  const binDir = path.join(cudaRoot, 'bin');
  const runtimeDir = isCudaRuntimeDirectory(cudaRoot)
    ? cudaRoot
    : isCudaRuntimeDirectory(binDir)
      ? binDir
      : null;
  if (!fs.existsSync(path.join(binDir, 'nvcc.exe')) && !runtimeDir) {
    console.warn(`[Backend] 忽略 cuda_path（未找到 Toolkit 或 CUDA Runtime DLL）: ${cudaRoot}`);
    return null;
  }
  return fs.existsSync(path.join(binDir, 'nvcc.exe')) ? cudaRoot : runtimeDir;
}

/** 构造后端 CUDA 环境；手动路径优先，留空保留系统自动检测。 */
export function buildCudaEnvironment(
  baseEnv: NodeJS.ProcessEnv,
  configuredCudaRoot: string | null,
): NodeJS.ProcessEnv {
  if (!configuredCudaRoot) return { ...baseEnv };
  const cudaRoot = normalizeCudaRoot(configuredCudaRoot);
  const isToolkit = fs.existsSync(path.join(cudaRoot, 'bin', 'nvcc.exe'));
  const cudaBin = isToolkit ? path.join(cudaRoot, 'bin') : cudaRoot;
  const existingPath = baseEnv.PATH || baseEnv.Path || '';
  const pathEntries = existingPath.split(path.delimiter).filter(Boolean);
  const withoutDuplicate = pathEntries.filter(entry => path.resolve(entry).toLowerCase() !== path.resolve(cudaBin).toLowerCase());
  const env: NodeJS.ProcessEnv = { ...baseEnv };
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === 'path') delete env[key];
  }
  if (isToolkit) {
    env.CUDA_PATH = cudaRoot;
    env.CUDA_HOME = cudaRoot;
  }
  env.PATH = [cudaBin, ...withoutDuplicate].join(path.delimiter);

  let version: string | null = null;
  try {
    const versionJson = path.join(cudaRoot, 'version.json');
    if (fs.existsSync(versionJson)) {
      const raw = JSON.parse(fs.readFileSync(versionJson, 'utf-8').replace(/^\uFEFF/, '')) as Record<string, any>;
      version = raw.cuda?.version ?? raw.cuda_cudart?.version ?? null;
    }
  } catch { /* use directory name fallback */ }
  version ??= path.basename(cudaRoot).match(/v(\d+(?:\.\d+)?)/i)?.[1] ?? null;
  const versionMatch = version?.match(/^(\d+)\.(\d+)/);
  if (isToolkit && versionMatch) {
    env[`CUDA_PATH_V${versionMatch[1]}_${versionMatch[2]}`] = cudaRoot;
  }
  return env;
}

function readSaveBackendScreenshotsFromSettings(): boolean {
  const raw = readGuiSettings();
  return raw.save_backend_screenshots === true;
}

function resolveLocalBackendRepoPath(): string | null {
  const fromEnv = process.env.AUTOWSGR_BACKEND_REPO?.trim();
  const fromSettings = readBackendRepoOverrideFromSettings();
  const candidate = fromEnv || fromSettings;
  if (!candidate) return null;

  let resolved = path.resolve(candidate);
  if (!fs.existsSync(resolved)) {
    console.warn(`[Backend] 忽略 backend_repo_path（路径不存在）: ${resolved}`);
    return null;
  }

  // 允许直接填写包目录 .../autowsgr
  const looksLikePkgDir = fs.existsSync(path.join(resolved, '__init__.py')) && fs.existsSync(path.join(resolved, 'server', 'main.py'));
  if (looksLikePkgDir && path.basename(resolved).toLowerCase() === 'autowsgr') {
    resolved = path.dirname(resolved);
  }

  if (!fs.existsSync(path.join(resolved, 'autowsgr', 'server', 'main.py'))) {
    console.warn(`[Backend] 忽略 backend_repo_path（未找到 autowsgr/server/main.py）: ${resolved}`);
    return null;
  }

  return resolved;
}

// ════════════════════════════════════════
// 后端服务
// ════════════════════════════════════════

/** 运行 setup.bat 安装环境 */
export function runSetupScript(): Promise<{ success: boolean; output: string }> {
  return new Promise((resolve) => {
    // 打包模式下 setup.bat 在 extraResources 里
    let setupPath = path.join(ctx.resourceRoot(), 'setup.bat');
    if (!fs.existsSync(setupPath)) {
      setupPath = path.join(ctx.appRoot(), 'setup.bat');
    }
    if (!fs.existsSync(setupPath)) {
      resolve({ success: false, output: '找不到 setup.bat' });
      return;
    }

    const proc = spawn('cmd.exe', ['/c', setupPath], {
      cwd: ctx.appRoot(),
      windowsHide: false,
      stdio: 'pipe',
    });

    let output = '';
    proc.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      output += text;
      ctx.getMainWindow()?.webContents.send('setup-log', text);
    });
    proc.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      output += text;
      ctx.getMainWindow()?.webContents.send('setup-log', text);
    });
    proc.on('close', (code) => {
      resolve({ success: code === 0, output: output.slice(-1000) });
    });
    proc.on('error', (err) => {
      resolve({ success: false, output: err.message });
    });
  });
}

export async function startBackend(): Promise<void> {
  ensurePthFile();
  const pythonCmd = await findPython();
  if (!pythonCmd) {
    console.error('[Backend] 找不到 Python');
    return;
  }

  const certFile = await ensureSslCertForPython(pythonCmd);
  if (certFile) console.log(`[Backend] TLS cert: ${certFile}`);
  else console.warn('[Backend] WARNING 未检测到 TLS 根证书，HTTPS 请求可能失败');

  const cwd = ctx.appRoot();
  const localSite = localSitePackages();
  const guiSettings = readGuiSettings();
  const backendStartupMode = guiSettings.backend_startup_mode === 'external' ? 'external' : 'managed';
  const localBackendRepo = backendStartupMode === 'external' ? resolveLocalBackendRepoPath() : null;
  const ocrGpuMode = readOcrGpuModeFromSettings();
  const configuredCudaRoot = readCudaPathFromSettings();
  const saveBackendScreenshots = readSaveBackendScreenshotsFromSettings();

  const pyLiteral = (value: string): string => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  // 使用 -c 启动而非 -m uvicorn，以便：
  // 1. 显式注入 site-packages 到 sys.path
  // 2. 激活 setuptools 的 distutils 兼容层 (Python 3.12+ 需要)
  // 3. 绕过嵌入式 Python 的 ._pth/PYTHONPATH 限制
  const bootstrapParts = [
    `import sys, os, site`,
    `sp = r'${pyLiteral(localSite)}'`,
    `sys.path.insert(0, sp)`,
    `site.addsitedir(sp)`,  // 处理 .pth 文件，激活 _distutils_hack
    ...(localBackendRepo ? [`repo = r'${pyLiteral(localBackendRepo)}'`, `sys.path.insert(0, repo)`] : []),
    `GUI_OCR_GPU_MODE = '${ocrGpuMode}'`,
    `GUI_SAVE_IMAGES = ${saveBackendScreenshots ? 'True' : 'False'}`,
    `import autowsgr`,
    `print('[Bootstrap] autowsgr=' + getattr(autowsgr, '__file__', 'unknown'))`,
    `print('[Bootstrap] repo_override=' + (r'${pyLiteral(localBackendRepo ?? '')}' or '<none>'))`,
    `print('[Bootstrap] ocr_gpu_mode=' + GUI_OCR_GPU_MODE)`,
    `print('[Bootstrap] save_backend_screenshots=' + ('true' if GUI_SAVE_IMAGES else 'false'))`,
    `from pathlib import Path`,
    `import autowsgr.infra.logger as _aw_logger`,
    `from autowsgr.scheduler import launcher as _aw_launcher`,
    `import autowsgr.vision.ocr as _aw_ocr`,
    `_orig_load_config = _aw_launcher.Launcher.load_config`,
    `_orig_save_image = _aw_logger.save_image`,
    `_orig_create = _aw_ocr.OCREngine.create.__func__`,
    `_cuda_cache = None`,
    `def _detect_cuda():`,
    `    global _cuda_cache`,
    `    if _cuda_cache is not None:`,
    `        return _cuda_cache`,
    `    try:`,
    `        import torch`,
    `        print('[Bootstrap] torch=' + str(getattr(torch, '__version__', 'unknown')))`,
    `        print('[Bootstrap] torch_cuda_build=' + str(getattr(getattr(torch, 'version', None), 'cuda', None)))`,
    `        _cuda_cache = bool(torch.cuda.is_available())`,
    `    except Exception:`,
    `        _cuda_cache = False`,
    `    return _cuda_cache`,
    `def _resolve_gpu_mode():`,
    `    if GUI_OCR_GPU_MODE == 'cuda':`,
    `        if not _detect_cuda():`,
    `            raise RuntimeError('已强制使用 CUDA，但当前 PyTorch/驱动未检测到可用 CUDA；请检查 CUDA 路径、CUDA 版 PyTorch 与 NVIDIA 驱动')`,
    `        return True`,
    `    if GUI_OCR_GPU_MODE == 'cpu':`,
    `        return False`,
    `    return _detect_cuda()`,
    `if GUI_OCR_GPU_MODE == 'cpu':`,
    `    print('[Bootstrap] cuda_available=skipped(cpu mode)')`,
    `else:`,
    `    print('[Bootstrap] cuda_available=' + ('true' if _detect_cuda() else 'false'))`,
    `def _patched_create(cls, engine='easyocr', gpu=False, mirror='tencent'):`,
    `    use_gpu = gpu`,
    `    if str(engine).lower() == 'easyocr':`,
    `        use_gpu = _resolve_gpu_mode()`,
    `    return _orig_create(cls, engine=engine, gpu=use_gpu, mirror=mirror)`,
    `_aw_ocr.OCREngine.create = classmethod(_patched_create)`,
    `def _patched_load_config(self):`,
    `    cfg = _orig_load_config(self)`,
    `    if GUI_SAVE_IMAGES:`,
    `        try:`,
    `            log_dir = getattr(cfg.log, 'dir', None)`,
    `            if log_dir is not None:`,
    `                img_dir = Path(log_dir) / 'images'`,
    `                img_dir.mkdir(parents=True, exist_ok=True)`,
    `                _aw_logger._image_dir = img_dir`,
    `                _aw_logger.logger.info('[GUI] 截图保存目录: {}', img_dir)`,
    `        except Exception as _e:`,
    `            _aw_logger.logger.warning('[GUI] 截图目录初始化失败: {}', _e)`,
    `    else:`,
    `        _aw_logger._image_dir = None`,
    `    return cfg`,
    `_aw_launcher.Launcher.load_config = _patched_load_config`,
    `def _patched_save_image(image, tag='screenshot', img_dir=None):`,
    `    if not GUI_SAVE_IMAGES:`,
    `        return None`,
    `    target_dir = img_dir or getattr(_aw_logger, '_image_dir', None)`,
    `    if target_dir is None:`,
    `        return None`,
    `    return _orig_save_image(image, tag=tag, img_dir=target_dir)`,
    `_aw_logger.save_image = _patched_save_image`,
    `import uvicorn`,
    `uvicorn.run('autowsgr.server.main:app', host='127.0.0.1', port=${ctx.BACKEND_PORT})`,
  ];

  const bootstrap = bootstrapParts.join('\n');
  const mainWindow = ctx.getMainWindow();
  if (localBackendRepo) {
    console.log(`[Backend] 使用本地后端仓库: ${localBackendRepo}`);
    mainWindow?.webContents.send('backend-log', `[GUI] 使用本地后端仓库: ${localBackendRepo}`);
  } else {
    mainWindow?.webContents.send('backend-log', '[GUI] 未启用本地后端仓库覆盖，使用 site-packages 中的 autowsgr');
  }
  mainWindow?.webContents.send('backend-log', `[GUI] OCR 加速模式: ${ocrGpuMode}`);
  mainWindow?.webContents.send('backend-log', `[GUI] CUDA 路径: ${configuredCudaRoot ?? '系统自动检测'}`);
  mainWindow?.webContents.send('backend-log', `[GUI] 保存识别异常截图: ${saveBackendScreenshots ? '开启' : '关闭'}`);

  // 将内置 ADB 目录加入 PATH，使后端 shutil.which('adb') 能找到
  const adbDir = path.join(ctx.appRoot(), 'adb');
  const cudaEnv = buildCudaEnvironment(process.env, configuredCudaRoot);
  const backendEnv = buildResourceEnvironment(cudaEnv, ctx.resourceRoot());
  const envPath = cudaEnv.PATH || '';
  const pathWithAdb = fs.existsSync(adbDir) ? `${adbDir};${envPath}` : envPath;
  console.log(`[Backend] ${SHIP_LIBRARY_ENV}=${shipLibraryRoot(ctx.resourceRoot())}`);

  // 预连接 ADB 设备（MuMu 多开实例不会自动被 ADB 发现，需要主动 connect）
  try {
    const cfgPath = path.join(ctx.appRoot(), 'usersettings.yaml');
    if (fs.existsSync(cfgPath)) {
      const cfgText = fs.readFileSync(cfgPath, 'utf-8');
      const serialMatch = cfgText.match(/serial:\s*(\S+)/);
      if (serialMatch) {
        const serial = serialMatch[1];
        const adbExe = path.join(adbDir, 'adb.exe');
        const adbCmd = fs.existsSync(adbExe) ? adbExe : 'adb';
        execSync(`"${adbCmd}" connect ${serial}`, { windowsHide: true, timeout: 5000, stdio: 'pipe' });
        console.log(`[Backend] ADB connect ${serial} 完成`);
      }
    }
  } catch (e: any) {
    console.warn(`[Backend] ADB connect 失败 (非致命): ${e.message}`);
  }

  backendProcess = spawn(pythonCmd, [
    '-X', 'utf8',
    '-c', bootstrap,
  ], {
    cwd,
    windowsHide: true,
    stdio: 'pipe',
    env: {
      ...backendEnv,
      PYTHONUTF8: '1',
      PYTHONIOENCODING: 'utf-8',
      PATH: pathWithAdb,
    },
  });

  // ANSI 颜色码
  const CYAN = '\x1b[36m';
  const RED = '\x1b[31m';
  const YELLOW = '\x1b[33m';
  const GREEN = '\x1b[32m';
  const DIM = '\x1b[2m';
  const RESET = '\x1b[0m';

  const colorLine = (line: string): string => {
    if (/\bERROR\b/i.test(line)) return `${RED}${line}${RESET}`;
    if (/\bWARNING\b/i.test(line)) return `${YELLOW}${line}${RESET}`;
    if (/\bINFO\b/i.test(line)) return `${GREEN}${line}${RESET}`;
    if (/\bDEBUG\b/i.test(line)) return `${DIM}${line}${RESET}`;
    return `${CYAN}${line}${RESET}`;
  };

  // loguru 新日志行以 "HH:mm:ss.SSS |" 开头
  const LOGURU_LINE_RE = /^\d{2}:\d{2}:\d{2}\.\d{3}\s*\|/;
  let skipMultiline = false;

  const handleOutput = (data: Buffer) => {
    for (const line of data.toString('utf-8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      console.log(`${CYAN}[Backend]${RESET} ${colorLine(trimmed)}`);

      const isNewEntry = LOGURU_LINE_RE.test(trimmed);
      if (isNewEntry) {
        // 新日志条目：判断级别，决定是否跳过后续续行
        skipMultiline = /\bDEBUG\b/i.test(trimmed);
      }
      // 跳过 DEBUG 级别的日志（包括其多行续行）
      if (skipMultiline) continue;
      // 跳过 uvicorn access log
      if (/"(?:GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)\s+\//.test(trimmed)) continue;
      mainWindow?.webContents.send('backend-log', trimmed);
    }
  };
  backendProcess.stdout?.on('data', handleOutput);
  backendProcess.stderr?.on('data', handleOutput);
  backendProcess.on('error', (err) => {
    console.error('[Backend] 启动失败:', err.message);
    backendProcess = null;
  });
  backendProcess.on('close', (code) => {
    console.log(`[Backend] 进程退出, code=${code}`);
    backendProcess = null;
  });
}

export function stopBackend(): void {
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
  }
}
