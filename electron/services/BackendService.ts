/**
 * 管理 Python 后端的环境、进程和日志。
 */
import * as path from 'path';
import * as fs from 'fs';
import { execSync, spawn, ChildProcess } from 'child_process';
import type { BrowserWindow } from 'electron';
import {
  buildCudaEnvironment,
  buildPythonProcessEnv,
  ensurePthFile,
  ensureSslCertForPython,
  findPython,
  resolveConfiguredCudaRoot,
  resolvePythonEnvironment,
} from '../pythonEnv';

export interface BackendContext {
  appRoot: () => string;
  userDataRoot: () => string;
  resourceRoot: () => string;
  BACKEND_PORT: number;
  getMainWindow: () => BrowserWindow | null;
}

let ctx: BackendContext;
let backendProcess: ChildProcess | null = null;

/** 注入 Electron 运行时能力。 */
export function initBackend(context: BackendContext): void {
  ctx = context;
}

/** 返回当前后端进程；未启动或已退出时返回 null。 */
export function getBackendProcess(): ChildProcess | null {
  return backendProcess;
}

/** 将 Python 包环境与 CUDA 环境合并为后端实际启动环境。 */
export function buildBackendRuntimeEnvironment(
  environment: ReturnType<typeof resolvePythonEnvironment>,
  configuredCudaRoot: string | null,
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return buildCudaEnvironment(
    buildPythonProcessEnv(environment, baseEnv),
    configuredCudaRoot,
  );
}

type OcrGpuMode = 'auto' | 'cpu' | 'cuda';

function readGuiSettings(): Record<string, unknown> {
  try {
    const settingsPath = path.join(
      ctx.userDataRoot(),
      'gui_settings.json',
    );
    if (!fs.existsSync(settingsPath)) return {};
    return JSON.parse(
      fs.readFileSync(settingsPath, 'utf-8'),
    ) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function readOcrGpuModeFromSettings(): OcrGpuMode {
  const value = readGuiSettings().ocr_gpu_mode;
  if (value === 'cpu' || value === 'cuda') return value;
  return 'auto';
}

function readCudaPathFromSettings(): string | null {
  const value = readGuiSettings().cuda_path;
  const cudaRoot = resolveConfiguredCudaRoot(value);
  if (
    typeof value === 'string'
    && value.trim()
    && !cudaRoot
  ) {
    console.warn(
      `[Backend] 忽略 cuda_path（未找到 Toolkit 或 CUDA Runtime DLL）: ${path.resolve(value.trim())}`,
    );
  }
  return cudaRoot;
}

function readSaveBackendScreenshotsFromSettings(): boolean {
  return readGuiSettings().save_backend_screenshots === true;
}

/** 运行 setup.bat 安装环境。 */
export function runSetupScript(): Promise<{
  success: boolean;
  output: string;
}> {
  return new Promise((resolve) => {
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
    proc.on('error', (error) => {
      resolve({ success: false, output: error.message });
    });
  });
}

/** 使用当前唯一 Python 环境启动 AutoWSGR 后端。 */
export async function startBackend(): Promise<void> {
  const pythonCmd = await findPython();
  if (!pythonCmd) {
    throw new Error('找不到兼容的 Python（需要 3.12 或 3.13）');
  }
  const environment = resolvePythonEnvironment(pythonCmd);
  if (environment.useLocalSite) ensurePthFile();

  const certFile = await ensureSslCertForPython(pythonCmd);
  if (certFile) console.log(`[Backend] TLS cert: ${certFile}`);
  else {
    console.warn(
      '[Backend] WARNING 未检测到 TLS 根证书，HTTPS 请求可能失败',
    );
  }

  const cwd = ctx.appRoot();
  const localSite = environment.localSite;
  const localBackendRepo = environment.backendRoot;
  const useLocalSite = environment.useLocalSite;
  const ocrGpuMode = readOcrGpuModeFromSettings();
  const configuredCudaRoot = readCudaPathFromSettings();
  const saveBackendScreenshots = readSaveBackendScreenshotsFromSettings();

  const pyLiteral = (value: string): string => value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'");

  // 通过 bootstrap 显式控制源码和依赖优先级，并应用 GUI 运行设置。
  const bootstrapParts = [
    'import sys, os, site',
    ...(useLocalSite
      ? [
          `sp = r'${pyLiteral(localSite)}'`,
          'sys.path.insert(0, sp)',
          'site.addsitedir(sp)',
        ]
      : []),
    ...(localBackendRepo
      ? [
          `repo = r'${pyLiteral(localBackendRepo)}'`,
          'sys.path.insert(0, repo)',
        ]
      : []),
    `GUI_OCR_GPU_MODE = '${ocrGpuMode}'`,
    `GUI_SAVE_IMAGES = ${saveBackendScreenshots ? 'True' : 'False'}`,
    'from pathlib import Path',
    'import autowsgr',
    ...(!localBackendRepo
      ? [
          '_autowsgr_file = Path(autowsgr.__file__).resolve()',
          'if not _autowsgr_file.is_relative_to(Path(sp).resolve()):',
          "    raise RuntimeError('GUI 后端来源错误: ' + str(_autowsgr_file))",
        ]
      : []),
    "print('[Bootstrap] autowsgr=' + getattr(autowsgr, '__file__', 'unknown'))",
    `print('[Bootstrap] repo_override=' + (r'${pyLiteral(localBackendRepo ?? '')}' or '<none>'))`,
    "print('[Bootstrap] ocr_gpu_mode=' + GUI_OCR_GPU_MODE)",
    "print('[Bootstrap] save_backend_screenshots=' + ('true' if GUI_SAVE_IMAGES else 'false'))",
    'import autowsgr.infra.logger as _aw_logger',
    'from autowsgr.scheduler import launcher as _aw_launcher',
    'import autowsgr.vision.ocr as _aw_ocr',
    '_orig_load_config = _aw_launcher.Launcher.load_config',
    '_orig_save_image = _aw_logger.save_image',
    '_orig_create = _aw_ocr.OCREngine.create.__func__',
    '_cuda_cache = None',
    'def _detect_cuda():',
    '    global _cuda_cache',
    '    if _cuda_cache is not None:',
    '        return _cuda_cache',
    '    try:',
    '        import torch',
    "        print('[Bootstrap] torch=' + str(getattr(torch, '__version__', 'unknown')))",
    "        print('[Bootstrap] torch_cuda_build=' + str(getattr(getattr(torch, 'version', None), 'cuda', None)))",
    '        _cuda_cache = bool(torch.cuda.is_available())',
    '    except Exception:',
    '        _cuda_cache = False',
    '    return _cuda_cache',
    'def _resolve_gpu_mode():',
    "    if GUI_OCR_GPU_MODE == 'cuda':",
    '        if not _detect_cuda():',
    "            raise RuntimeError('已强制使用 CUDA，但当前 PyTorch/驱动未检测到可用 CUDA；请检查 CUDA 路径、CUDA 版 PyTorch 与 NVIDIA 驱动')",
    '        return True',
    "    if GUI_OCR_GPU_MODE == 'cpu':",
    '        return False',
    '    return _detect_cuda()',
    "if GUI_OCR_GPU_MODE == 'cpu':",
    "    print('[Bootstrap] cuda_available=skipped(cpu mode)')",
    'else:',
    "    print('[Bootstrap] cuda_available=' + ('true' if _detect_cuda() else 'false'))",
    "def _patched_create(cls, engine='easyocr', gpu=False, mirror='tencent'):",
    '    use_gpu = gpu',
    "    if str(engine).lower() == 'easyocr':",
    '        use_gpu = _resolve_gpu_mode()',
    '    return _orig_create(cls, engine=engine, gpu=use_gpu, mirror=mirror)',
    '_aw_ocr.OCREngine.create = classmethod(_patched_create)',
    'def _patched_load_config(self):',
    '    cfg = _orig_load_config(self)',
    '    if GUI_SAVE_IMAGES:',
    '        try:',
    "            log_dir = getattr(cfg.log, 'dir', None)",
    '            if log_dir is not None:',
    "                img_dir = Path(log_dir) / 'images'",
    '                img_dir.mkdir(parents=True, exist_ok=True)',
    '                _aw_logger._image_dir = img_dir',
    "                _aw_logger.logger.info('[GUI] 截图保存目录: {}', img_dir)",
    '        except Exception as _e:',
    "            _aw_logger.logger.warning('[GUI] 截图目录初始化失败: {}', _e)",
    '    else:',
    '        _aw_logger._image_dir = None',
    '    return cfg',
    '_aw_launcher.Launcher.load_config = _patched_load_config',
    "def _patched_save_image(image, tag='screenshot', img_dir=None):",
    '    if not GUI_SAVE_IMAGES:',
    '        return None',
    "    target_dir = img_dir or getattr(_aw_logger, '_image_dir', None)",
    '    if target_dir is None:',
    '        return None',
    '    return _orig_save_image(image, tag=tag, img_dir=target_dir)',
    '_aw_logger.save_image = _patched_save_image',
    'import uvicorn',
    `uvicorn.run('autowsgr.server.main:app', host='127.0.0.1', port=${ctx.BACKEND_PORT})`,
  ];

  const bootstrap = bootstrapParts.join('\n');
  const mainWindow = ctx.getMainWindow();
  if (localBackendRepo) {
    console.log(`[Backend] 使用本地后端仓库: ${localBackendRepo}`);
    mainWindow?.webContents.send(
      'backend-log',
      `[GUI] 使用本地后端仓库: ${localBackendRepo}`,
    );
  } else {
    mainWindow?.webContents.send(
      'backend-log',
      '[GUI] 未启用本地后端仓库覆盖，使用 site-packages 中的 autowsgr',
    );
  }
  mainWindow?.webContents.send(
    'backend-log',
    `[GUI] OCR 加速模式: ${ocrGpuMode}`,
  );
  mainWindow?.webContents.send(
    'backend-log',
    `[GUI] CUDA 路径: ${configuredCudaRoot ?? '系统自动检测'}`,
  );
  mainWindow?.webContents.send(
    'backend-log',
    `[GUI] 保存识别异常截图: ${saveBackendScreenshots ? '开启' : '关闭'}`,
  );

  const adbDir = path.join(ctx.appRoot(), 'adb');
  const cudaEnv = buildBackendRuntimeEnvironment(
    environment,
    configuredCudaRoot,
  );
  const envPath = cudaEnv.PATH || '';
  const pathWithAdb = fs.existsSync(adbDir)
    ? `${adbDir}${path.delimiter}${envPath}`
    : envPath;

  // MuMu 多开实例不会自动被 ADB 发现，因此启动前主动连接。
  try {
    const cfgPath = path.join(ctx.userDataRoot(), 'usersettings.yaml');
    if (fs.existsSync(cfgPath)) {
      const cfgText = fs.readFileSync(cfgPath, 'utf-8');
      const serialMatch = cfgText.match(/serial:\s*(\S+)/);
      if (serialMatch) {
        const serial = serialMatch[1];
        const adbExe = path.join(adbDir, 'adb.exe');
        const adbCmd = fs.existsSync(adbExe) ? adbExe : 'adb';
        execSync(`"${adbCmd}" connect ${serial}`, {
          windowsHide: true,
          timeout: 5000,
          stdio: 'pipe',
        });
        console.log(`[Backend] ADB connect ${serial} 完成`);
      }
    }
  } catch (error: any) {
    console.warn(`[Backend] ADB connect 失败 (非致命): ${error.message}`);
  }

  backendProcess = spawn(
    pythonCmd,
    ['-X', 'utf8', '-c', bootstrap],
    {
      cwd,
      windowsHide: true,
      stdio: 'pipe',
      env: {
        ...cudaEnv,
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
        PATH: pathWithAdb,
      },
    },
  );

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

  const LOGURU_LINE_RE = /^\d{2}:\d{2}:\d{2}\.\d{3}\s*\|/;
  let skipMultiline = false;

  const handleOutput = (data: Buffer) => {
    for (const line of data.toString('utf-8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      console.log(`${CYAN}[Backend]${RESET} ${colorLine(trimmed)}`);

      const isNewEntry = LOGURU_LINE_RE.test(trimmed);
      if (isNewEntry) {
        skipMultiline = /\bDEBUG\b/i.test(trimmed);
      }
      if (skipMultiline) continue;
      if (
        /"(?:GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)\s+\//.test(trimmed)
      ) {
        continue;
      }
      mainWindow?.webContents.send('backend-log', trimmed);
    }
  };
  backendProcess.stdout?.on('data', handleOutput);
  backendProcess.stderr?.on('data', handleOutput);
  backendProcess.on('error', (error) => {
    console.error('[Backend] 启动失败:', error.message);
    backendProcess = null;
  });
  backendProcess.on('close', (code) => {
    console.log(`[Backend] 进程退出, code=${code}`);
    backendProcess = null;
  });
}

/** 优雅停止后端；五秒内未退出则强制终止。 */
export async function stopBackend(): Promise<void> {
  const process = backendProcess;
  if (!process) return;

  backendProcess = null;
  if (process.killed || process.exitCode !== null) return;

  process.kill('SIGTERM');
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (process.exitCode === null) {
        try {
          process.kill('SIGKILL');
        } catch {
          // 进程已自行退出。
        }
      }
      resolve();
    }, 5000);
    process.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
