/**
 * Electron 主进程。
 * 负责创建窗口、注册 IPC handler。
 */
import { app, BrowserWindow, ipcMain, dialog, screen, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { pathToFileURL } from 'url';
import { exec, execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { autoUpdater, UpdateInfo, ProgressInfo } from 'electron-updater';
import * as yaml from 'js-yaml';
import {
  initPythonEnv, clearPythonCache,
  isAllowedPythonVersion, findPython, checkEnvironment,
  checkForUpdates, installDependencies, installPortablePython,
  pullUpdates,
} from './pythonEnv';
import { detectEmulator } from './emulatorDetect';
import {
  buildCudaEnvironment,
  initBackend,
  getBackendProcess,
  startBackend,
  stopBackend,
  runSetupScript,
} from './backend';

/** 启动终端关闭输出管道时，不让 EPIPE 终止 GUI 主进程。 */
function ignoreBrokenPipe(stream: NodeJS.WriteStream): void {
  stream.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code !== 'EPIPE') throw error;
  });
}

ignoreBrokenPipe(process.stdout);
ignoreBrokenPipe(process.stderr);

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

function adbExecutable(): string {
  const bundledAdb = path.join(appRoot(), 'adb', 'adb.exe');
  return fs.existsSync(bundledAdb) ? bundledAdb : 'adb';
}

async function listAdbDevices(): Promise<{ serial: string; status: string }[]> {
  const { stdout } = await execFileAsync(
    adbExecutable(),
    ['devices'],
    { windowsHide: true, timeout: 5000, encoding: 'utf8' },
  );
  return String(stdout)
    .split(/\r?\n/)
    .slice(1)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const [serial, status] = line.split(/\s+/);
      return { serial, status: status || 'unknown' };
    });
}

async function runAdbDeviceCommand(
  command: 'connect' | 'disconnect',
  rawSerial: string,
): Promise<{
  success: boolean;
  serial: string;
  status: string;
  message: string;
}> {
  const serial = String(rawSerial ?? '').trim();
  if (!serial || !/^[A-Za-z0-9._:[\]-]+$/.test(serial)) {
    return {
      success: false,
      serial,
      status: 'invalid',
      message: 'ADB 地址格式不正确',
    };
  }

  try {
    const { stdout, stderr } = await execFileAsync(
      adbExecutable(),
      [command, serial],
      { windowsHide: true, timeout: 10000, encoding: 'utf8' },
    );
    const devices = await listAdbDevices();
    const status = devices.find(device => device.serial === serial)?.status;
    const success = command === 'connect'
      ? status === 'device'
      : status === undefined;
    return {
      success,
      serial,
      status: status ?? 'disconnected',
      message: [stdout, stderr].map(value => String(value).trim()).filter(Boolean).join('\n')
        || (success ? '操作成功' : '操作后设备状态未达到预期'),
    };
  } catch (error) {
    const details = error as {
      message?: string;
      stdout?: string;
      stderr?: string;
    };
    return {
      success: false,
      serial,
      status: 'error',
      message: [details.stderr, details.stdout, details.message]
        .map(value => String(value ?? '').trim())
        .find(Boolean)
        || 'ADB 命令执行失败',
    };
  }
}

/** GUI 设置文件路径（延迟到 app ready 后才有效，先用函数） */
function guiSettingsPath(): string {
  return path.join(appRoot(), 'gui_settings.json');
}

/** 读取 GUI 设置 */
function readGuiSettings(): Record<string, unknown> {
  try {
    const p = guiSettingsPath();
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf-8'));
    }
  } catch { /* ignore */ }
  return {};
}

/** 写入 GUI 设置（合并） */
function writeGuiSettings(patch: Record<string, unknown>): void {
  const cur = readGuiSettings();
  Object.assign(cur, patch);
  fs.writeFileSync(guiSettingsPath(), JSON.stringify(cur, null, 2), 'utf-8');
}

interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface WindowPreferences {
  defaultWidth: number;
  defaultHeight: number;
  rememberBounds: boolean;
}

const DEFAULT_WINDOW_WIDTH = 1280;
const DEFAULT_WINDOW_HEIGHT = 720;
const MIN_WINDOW_WIDTH = 854;
const MIN_WINDOW_HEIGHT = 480;

function normalizeWindowSize(value: unknown, minimum: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.trunc(value));
}

/** 默认窗口大小与窗口状态记忆属于 GUI 设置，不写入后端 usersettings.yaml。 */
function getWindowPreferences(): WindowPreferences {
  const settings = readGuiSettings();
  return {
    defaultWidth: normalizeWindowSize(
      settings.default_window_width,
      MIN_WINDOW_WIDTH,
      DEFAULT_WINDOW_WIDTH,
    ),
    defaultHeight: normalizeWindowSize(
      settings.default_window_height,
      MIN_WINDOW_HEIGHT,
      DEFAULT_WINDOW_HEIGHT,
    ),
    rememberBounds: settings.remember_window_bounds === true,
  };
}

function readRememberedWindowBounds(): WindowBounds | null {
  const raw = readGuiSettings().window_bounds;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const bounds = raw as Record<string, unknown>;
  if (
    typeof bounds.x !== 'number'
    || typeof bounds.y !== 'number'
    || !Number.isFinite(bounds.x)
    || !Number.isFinite(bounds.y)
  ) {
    return null;
  }
  return {
    x: Math.trunc(bounds.x),
    y: Math.trunc(bounds.y),
    width: normalizeWindowSize(bounds.width, MIN_WINDOW_WIDTH, DEFAULT_WINDOW_WIDTH),
    height: normalizeWindowSize(bounds.height, MIN_WINDOW_HEIGHT, DEFAULT_WINDOW_HEIGHT),
  };
}

/** 至少保留一块可拖动区域，避免显示器变化后窗口完全落在屏幕外。 */
function isWindowBoundsVisible(bounds: WindowBounds): boolean {
  return screen.getAllDisplays().some(({ workArea }) => {
    const visibleWidth = Math.min(bounds.x + bounds.width, workArea.x + workArea.width)
      - Math.max(bounds.x, workArea.x);
    const visibleHeight = Math.min(bounds.y + bounds.height, workArea.y + workArea.height)
      - Math.max(bounds.y, workArea.y);
    return visibleWidth >= 160 && visibleHeight >= 80;
  });
}

/** 后端端口：环境变量 > gui_settings.json > 默认 8438 */
function getBackendPort(): number {
  if (process.env.AUTOWSGR_PORT) {
    return parseInt(process.env.AUTOWSGR_PORT, 10);
  }
  const settings = readGuiSettings();
  if (typeof settings.backend_port === 'number' && settings.backend_port > 0 && settings.backend_port < 65536) {
    return settings.backend_port;
  }
  return 8438;
}

const BACKEND_PORT = getBackendPort();

/** 用户配置的 Python 路径：gui_settings.json > null (自动检测) */
function getConfiguredPythonPath(): string | null {
  const settings = readGuiSettings();
  if (typeof settings.python_path === 'string' && settings.python_path.length > 0) {
    return settings.python_path;
  }
  return null;
}

function getUpdateMode(): 'auto' | 'manual' {
  const settings = readGuiSettings();
  return settings.update_mode === 'manual' ? 'manual' : 'auto';
}

type BackendStartupMode = 'managed' | 'external';
type OcrGpuMode = 'auto' | 'cpu' | 'cuda';

interface GuiAutomationSettings {
  expeditionInterval: number;
  battleTimes: number;
  autoLoot: boolean;
  lootPlanIndex: number;
  lootStopCount: number;
}

interface DecisivePlanSettings {
  chapter: number;
  useQuickRepair: boolean;
  level1: string[];
  level2: string[];
}

const DEFAULT_DECISIVE_PLAN: DecisivePlanSettings = {
  chapter: 6,
  useQuickRepair: true,
  level1: [
    'U-47',
    'U-1405',
    'U-1206',
    'U-2540',
    'U-81',
    'U-96',
  ],
  level2: [
    'U-505',
    '射水鱼',
    '大青花鱼',
    'M-296',
    '鹦鹉螺',
    'S-49',
    'IIIA',
    'K-21',
    'U-441',
    '潜甲',
    '潜乙',
    '伊-201',
    '伊-25',
    '鲃鱼',
    '伊-400',
    '激流',
    'U-4501',
    'U-459',
    'U-14',
    'U-35',
    'K1',
  ],
};

function normalizeDecisiveShips(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  return value
    .filter(item => typeof item === 'string')
    .map(item => item.trim())
    .filter((item, index, values) => (
      item.length > 0
      && item.length <= 80
      && values.indexOf(item) === index
    ));
}

function normalizeDecisivePlanSettings(value: unknown): DecisivePlanSettings {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const chapter = Math.trunc(Number(raw.chapter));
  const requestedMainShips = normalizeDecisiveShips(
    raw.level1,
    DEFAULT_DECISIVE_PLAN.level1,
  );
  const mainShips = requestedMainShips.slice(0, 6);
  const requestedBackupShips = normalizeDecisiveShips(
    raw.level2,
    DEFAULT_DECISIVE_PLAN.level2,
  );
  const legacyLevel3 = Array.isArray(raw.level3)
    ? normalizeDecisiveShips(raw.level3, [])
    : [];
  const backupShips: string[] = [];
  for (
    const name of [
      ...requestedMainShips.slice(6),
      ...requestedBackupShips,
      ...legacyLevel3,
    ]
  ) {
    if (!mainShips.includes(name) && !backupShips.includes(name)) {
      backupShips.push(name);
    }
  }
  return {
    chapter: Number.isFinite(chapter)
      ? Math.max(1, Math.min(6, chapter))
      : DEFAULT_DECISIVE_PLAN.chapter,
    useQuickRepair: typeof raw.use_quick_repair === 'boolean'
      ? raw.use_quick_repair
      : typeof raw.useQuickRepair === 'boolean'
        ? raw.useQuickRepair
        : DEFAULT_DECISIVE_PLAN.useQuickRepair,
    level1: mainShips,
    level2: backupShips,
  };
}

function getDecisivePlanSettings(): DecisivePlanSettings {
  const rawSettings = readGuiSettings();
  const rawPlan = rawSettings.decisive_plan;
  const normalized = normalizeDecisivePlanSettings(rawPlan);
  if (
    rawPlan
    && typeof rawPlan === 'object'
    && !Array.isArray(rawPlan)
    && (
      Object.prototype.hasOwnProperty.call(rawPlan, 'level3')
      || (
        Array.isArray((rawPlan as Record<string, unknown>).level1)
        && ((rawPlan as Record<string, unknown>).level1 as unknown[]).length > 6
      )
    )
  ) {
    writeGuiSettings({
      decisive_plan: {
        chapter: normalized.chapter,
        use_quick_repair: normalized.useQuickRepair,
        level1: normalized.level1,
        level2: normalized.level2,
      },
    });
  }
  return normalized;
}

function getGuiAutomationSettings(): {
  exists: boolean;
  settings: Partial<GuiAutomationSettings>;
} {
  const raw = readGuiSettings().automation;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { exists: false, settings: {} };
  }
  const value = raw as Record<string, unknown>;
  const settings: Partial<GuiAutomationSettings> = {};
  if (Number.isFinite(Number(value.expeditionInterval))) {
    settings.expeditionInterval = Number(value.expeditionInterval);
  }
  if (Number.isFinite(Number(value.battleTimes))) {
    settings.battleTimes = Number(value.battleTimes);
  }
  if (typeof value.autoLoot === 'boolean') settings.autoLoot = value.autoLoot;
  if (Number.isFinite(Number(value.lootPlanIndex))) {
    settings.lootPlanIndex = Number(value.lootPlanIndex);
  }
  if (Number.isFinite(Number(value.lootStopCount))) {
    settings.lootStopCount = Number(value.lootStopCount);
  }
  return { exists: true, settings };
}

function getBackendStartupMode(): BackendStartupMode {
  const settings = readGuiSettings();
  return settings.backend_startup_mode === 'external' ? 'external' : 'managed';
}

function getBackendRepoPath(): string {
  const settings = readGuiSettings();
  if (typeof settings.backend_repo_path !== 'string') return '';
  return settings.backend_repo_path.trim();
}

function getOcrGpuMode(): OcrGpuMode {
  const settings = readGuiSettings();
  const value = typeof settings.ocr_gpu_mode === 'string' ? settings.ocr_gpu_mode : '';
  if (value === 'cpu' || value === 'cuda') return value;
  return 'auto';
}

function getCudaPath(): string {
  const settings = readGuiSettings();
  if (typeof settings.cuda_path !== 'string') return '';
  return settings.cuda_path.trim();
}

function normalizeCudaPath(candidate: string): string {
  const resolved = path.resolve(candidate.trim());
  if (findCudaRuntimeDll(resolved)) return resolved;
  return path.basename(resolved).toLowerCase() === 'bin' ? path.dirname(resolved) : resolved;
}

function findCudaRuntimeDll(directory: string): boolean {
  try {
    const names = fs.readdirSync(directory);
    return names.some(name => /^cudart64.*\.dll$/i.test(name))
      && names.some(name => /^cublas64.*\.dll$/i.test(name));
  } catch {
    return false;
  }
}

interface CudaValidationResult {
  valid: boolean;
  path: string;
  version: string | null;
  kind?: 'toolkit' | 'runtime';
  torchVersion?: string | null;
  device?: string | null;
  error?: string;
}

function validateCudaPath(candidate: string): CudaValidationResult {
  if (!candidate.trim()) return { valid: false, path: '', version: null, error: '路径为空' };
  const cudaRoot = normalizeCudaPath(candidate);
  if (!fs.existsSync(cudaRoot)) return { valid: false, path: cudaRoot, version: null, error: '目录不存在' };
  const binDir = path.join(cudaRoot, 'bin');
  const isToolkit = fs.existsSync(path.join(binDir, 'nvcc.exe'));
  const runtimeDir = findCudaRuntimeDll(cudaRoot)
    ? cudaRoot
    : findCudaRuntimeDll(binDir)
      ? binDir
      : null;
  if (!isToolkit && !runtimeDir) {
    return { valid: false, path: cudaRoot, version: null, error: '未找到 CUDA Toolkit（bin\\nvcc.exe）或 PyTorch CUDA Runtime DLL' };
  }

  let version: string | null = null;
  try {
    const versionJson = path.join(cudaRoot, 'version.json');
    if (fs.existsSync(versionJson)) {
      const raw = JSON.parse(fs.readFileSync(versionJson, 'utf-8').replace(/^\uFEFF/, '')) as Record<string, any>;
      version = raw.cuda?.version ?? raw.cuda_cudart?.version ?? null;
    }
  } catch { /* use directory name fallback */ }
  version ??= path.basename(cudaRoot).match(/v\d+(?:\.\d+)?/i)?.[0] ?? null;
  if (isToolkit) return { valid: true, path: cudaRoot, version, kind: 'toolkit' };

  let runtimeVersion: string | null = null;
  try {
    const cudart = fs.readdirSync(runtimeDir!).find(name => /^cudart64.*\.dll$/i.test(name));
    runtimeVersion = cudart?.match(/^cudart64[_-]?(\d+)/i)?.[1] ?? null;
    if (runtimeVersion?.length === 2) runtimeVersion = `${runtimeVersion[0]}.${runtimeVersion[1]}`;
    else if (runtimeVersion?.length === 3) runtimeVersion = `${runtimeVersion.slice(0, 2)}.${runtimeVersion[2]}`;
  } catch { /* version remains unknown */ }
  return { valid: true, path: runtimeDir!, version: runtimeVersion, kind: 'runtime' };
}

/** 使用后端实际采用的 Python 环境检测 PyTorch、CUDA 和显卡。 */
async function detectCudaEnvironment(candidate: string): Promise<CudaValidationResult> {
  const rawPath = candidate.trim();
  const pathResult = rawPath ? validateCudaPath(rawPath) : null;
  if (pathResult && !pathResult.valid) return pathResult;

  const pythonCmd = await findPython();
  if (!pythonCmd) {
    return {
      valid: false,
      path: pathResult?.path ?? '',
      version: pathResult?.version ?? null,
      kind: pathResult?.kind,
      error: '未找到可用的 Python 3.12 或 3.13',
    };
  }

  const script = [
    'import json',
    'try:',
    '    import torch',
    '    available = bool(torch.cuda.is_available())',
    '    result = {',
    '        "available": available,',
    '        "torch_version": str(torch.__version__),',
    '        "cuda_version": getattr(torch.version, "cuda", None),',
    '        "device": torch.cuda.get_device_name(0) if available else None,',
    '    }',
    'except Exception as exc:',
    '    result = {"available": False, "error": str(exc)}',
    'print(json.dumps(result, ensure_ascii=False))',
  ].join('\n');

  try {
    const { stdout } = await execFileAsync(
      pythonCmd,
      ['-c', script],
      {
        windowsHide: true,
        timeout: 20000,
        encoding: 'utf8',
        env: buildCudaEnvironment(process.env, pathResult?.path ?? null),
      },
    );
    const output = String(stdout).trim().split(/\r?\n/).filter(Boolean).at(-1);
    if (!output) throw new Error('Python 未返回检测结果');
    const detected = JSON.parse(output) as {
      available?: boolean;
      torch_version?: string;
      cuda_version?: string | null;
      device?: string | null;
      error?: string;
    };
    const version = detected.cuda_version ?? pathResult?.version ?? null;
    if (!detected.available) {
      return {
        valid: false,
        path: pathResult?.path ?? '',
        version,
        kind: pathResult?.kind,
        torchVersion: detected.torch_version ?? null,
        device: null,
        error: detected.error
          ? `PyTorch 检测失败：${detected.error}`
          : `PyTorch ${detected.torch_version ?? ''} 未检测到可用 CUDA`.replace(/\s+/g, ' ').trim(),
      };
    }
    return {
      valid: true,
      path: pathResult?.path ?? '',
      version,
      kind: pathResult?.kind,
      torchVersion: detected.torch_version ?? null,
      device: detected.device ?? null,
    };
  } catch (error) {
    return {
      valid: false,
      path: pathResult?.path ?? '',
      version: pathResult?.version ?? null,
      kind: pathResult?.kind,
      error: `硬件检测失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function getSaveBackendScreenshots(): boolean {
  const settings = readGuiSettings();
  return settings.save_backend_screenshots === true;
}

let mainWindow: BrowserWindow | null = null;
let lastWindowBounds: WindowBounds | null = null;

/** 缓存最后一次正常窗口边界，供窗口销毁后的退出阶段使用。 */
function captureWindowBounds(win: BrowserWindow | null): void {
  if (!win || win.isDestroyed()) return;
  lastWindowBounds = win.getNormalBounds();
}

/** 仅在用户启用窗口记忆时写入最后一次正常窗口边界。 */
function persistWindowBounds(): void {
  if (getWindowPreferences().rememberBounds && lastWindowBounds) {
    writeGuiSettings({ window_bounds: lastWindowBounds });
  }
}

/** 是否处于打包后的生产模式 */
function isPackaged(): boolean {
  return app.isPackaged;
}

/**
 * 应用工作目录（外部可写文件：autowsgr/、usersettings.yaml 等）：
 * - 开发模式: 项目根目录
 * - 打包模式: exe 所在目录
 */
function appRoot(): string {
  if (isPackaged()) {
    return path.dirname(app.getPath('exe'));
  }
  return path.join(__dirname, '..', '..');
}

/** extraResources 目录 (resource/, setup.bat) */
function resourceRoot(): string {
  if (isPackaged()) {
    return process.resourcesPath;
  }
  return path.join(__dirname, '..', '..');
}

/** 将相对路径解析为绝对路径 */
function resolveAppPath(filePath: string): string {
  if (path.isAbsolute(filePath)) return filePath;
  // resource/ 在打包后位于 extraResources（只读）
  if (filePath.startsWith('resource')) {
    return path.join(resourceRoot(), filePath);
  }
  // 其他文件在 appRoot（可写，用户数据不会被安装覆盖）
  return path.join(appRoot(), filePath);
}

function systemBattlePlansDir(): string {
  return path.join(resourceRoot(), 'resource', 'system_battle_plans');
}

/** 用户出征方案统一存放在 resource/user_battle_plans。 */
function userBattlePlansDir(): string {
  return path.join(
    isPackaged() ? appRoot() : resourceRoot(),
    'resource',
    'user_battle_plans',
  );
}

/** 初始化用户出征方案目录。 */
function initUserBattlePlansDir(): void {
  fs.mkdirSync(userBattlePlansDir(), { recursive: true });
}

/** 递归复制目录，跳过已存在的文件 */
function copyDirNoOverwrite(src: string, dest: string): void {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirNoOverwrite(srcPath, destPath);
    } else if (!fs.existsSync(destPath)) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

interface ShipLibraryStatus {
  exists: boolean;
  path: string;
  generatedAt?: string;
  shipCount: number;
  assetCount: number;
  missingAssets: number;
  error?: string;
}

interface ShipLibraryUpdateResult {
  success: boolean;
  output?: string;
  generated_at?: string;
  ship_count?: number;
  asset_count?: number;
  added?: number;
  updated?: number;
  removed?: number;
  downloaded?: number;
  failed?: number;
  failures?: string[];
  error?: string;
}

interface ShipLibraryManifest {
  schemaVersion: number;
  generatedAt: string;
  labels: Record<string, unknown>;
  typeGroups: Record<string, unknown>;
  ships: Array<Record<string, unknown>>;
}

/** 当前可写的舰船资料库目录。 */
function shipLibraryDir(): string {
  if (isPackaged()) {
    return path.join(app.getPath('userData'), 'ship-library');
  }
  return path.join(resourceRoot(), 'resource', 'ship-library');
}

/** 打包后将内置资料库复制到用户目录，已有文件不覆盖。 */
function initUserShipLibraryDir(): void {
  if (!isPackaged()) return;
  const bundledDir = path.join(resourceRoot(), 'resource', 'ship-library');
  if (fs.existsSync(bundledDir)) {
    copyDirNoOverwrite(bundledDir, shipLibraryDir());
  }
}

const ALLOWED_FLEET_SHIP_TYPES = new Set([
  'dd',
  'cl',
  'ca',
  'cav',
  'clt',
  'bb',
  'bc',
  'bbv',
  'cv',
  'cvl',
  'av',
  'ss',
  'ssg',
  'cg',
  'cgaa',
  'ddg',
  'ddgaa',
  'bm',
  'cbg',
  'cf',
  'ss_or_ssg',
]);
const TEAM_FILE_PATTERN = /^team[-_][^\\/]+\.ya?ml$/i;
type PlanPresetSource = 'system' | 'user';
type ManagedBattleResult = 'D' | 'C' | 'B' | 'A' | 'S' | 'SS';

interface ManagedBattlePlanFleetSummary {
  name: string;
  source: PlanPresetSource | 'deleted';
  primaryCount: number;
  backupCount: number;
}

interface ManagedBattlePlanSummary {
  file: string;
  name: string;
  source: PlanPresetSource;
  modifiedAt: number;
  chapter: number | string;
  map: number | string;
  times: number;
  gap: number;
  fleetId: number;
  repairMode: number | number[];
  result: ManagedBattleResult | null;
  lootCountGe: number;
  shipCountGe: number;
  fleetCount: number;
  nodeCount: number;
  fleets: ManagedBattlePlanFleetSummary[];
}

interface PlanFileReadError {
  file: string;
  source: PlanPresetSource;
  kind: 'battle' | 'team';
  message: string;
}

interface UserTeamShipRule {
  name: string;
  search_name?: string;
  ship_type?: string[];
  min_level?: number;
  max_level?: number;
}

interface UserTeamPlanSlot {
  name?: string;
  search_name?: string;
  ship_type?: string[];
  min_level?: number;
  max_level?: number;
  candidates?: UserTeamShipRule[];
}

interface UserTeamPlan {
  file?: string;
  modifiedAt?: number;
  source?: PlanPresetSource;
  name: string;
  ships: UserTeamPlanSlot[];
}

interface LegacyPlanConversionResult {
  success: boolean;
  canceled?: boolean;
  exists?: boolean;
  inputPath?: string;
  file?: string;
  path?: string;
  source?: PlanPresetSource;
  teamFiles?: string[];
  conflicts?: string[];
  error?: string;
}

function systemTeamPlansDir(): string {
  return path.join(resourceRoot(), 'resource', 'system_team_plans');
}

/** 用户编队目录在开发模式下固定为 resource/user_team_plans。 */
function userTeamPlansDir(): string {
  return path.join(
    isPackaged() ? appRoot() : resourceRoot(),
    'resource',
    'user_team_plans',
  );
}

function initUserTeamPlansDir(): void {
  fs.mkdirSync(userTeamPlansDir(), { recursive: true });
}

function initSystemPlanDirs(): void {
  fs.mkdirSync(systemBattlePlansDir(), { recursive: true });
  fs.mkdirSync(systemTeamPlansDir(), { recursive: true });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function positiveInteger(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (!Number.isInteger(value) || Number(value) < 1) {
    throw new Error(`${field} 必须是大于或等于 1 的整数`);
  }
  return Number(value);
}

function normalizeUserTeamShipTypes(
  raw: unknown,
  field: string,
): string[] | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const values = typeof raw === 'string' ? [raw] : raw;
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(`${field} 必须是非空字符串列表`);
  }
  const result = values.map((value) => {
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`${field} 必须是非空字符串列表`);
    }
    const shipType = value.trim().toLowerCase();
    if (!ALLOWED_FLEET_SHIP_TYPES.has(shipType)) {
      throw new Error(`${field} 不符合后端接口: ${shipType}`);
    }
    return shipType;
  });
  return [...new Set(result)];
}

/** 校验一艘主选或备选舰船自己的规则。 */
function normalizeUserTeamShipRule(
  raw: unknown,
  field: string,
): UserTeamShipRule {
  if (!isPlainObject(raw)) throw new Error(`${field} 必须是对象`);
  const allowedKeys = new Set([
    'name',
    'search_name',
    'ship_type',
    'min_level',
    'max_level',
  ]);
  if (Object.keys(raw).some(key => !allowedKeys.has(key))) {
    throw new Error(`${field} 包含后端不支持的字段`);
  }

  if (typeof raw.name !== 'string' || !raw.name.trim()) {
    throw new Error(`${field}.name 必须是非空字符串`);
  }
  const result: UserTeamShipRule = { name: raw.name.trim() };
  if (raw.search_name !== undefined) {
    if (typeof raw.search_name !== 'string' || !raw.search_name.trim()) {
      throw new Error(`${field}.search_name 必须是非空字符串`);
    }
    result.search_name = raw.search_name.trim();
  }
  const shipTypes = normalizeUserTeamShipTypes(
    raw.ship_type,
    `${field}.ship_type`,
  );
  if (shipTypes) result.ship_type = shipTypes;
  const minLevel = positiveInteger(raw.min_level, `${field}.min_level`);
  const maxLevel = positiveInteger(raw.max_level, `${field}.max_level`);
  if (minLevel !== undefined) result.min_level = minLevel;
  if (maxLevel !== undefined) result.max_level = maxLevel;
  if (
    minLevel !== undefined
    && maxLevel !== undefined
    && maxLevel < minLevel
  ) {
    throw new Error(`${field}.max_level 必须大于或等于 min_level`);
  }
  return result;
}

/** 旧 candidates 字符串继承原槽位的舰种和等级限制。 */
function legacyCandidateRule(
  name: string,
  raw: Record<string, unknown>,
): UserTeamShipRule {
  return normalizeUserTeamShipRule({
    name,
    ship_type: raw.ship_type,
    min_level: raw.min_level,
    max_level: raw.max_level,
  }, `旧版候选 ${name}`);
}

/** 校验单个位置；主选可以为空，但位置必须至少包含一艘主选或备选。 */
function normalizeUserTeamSlot(raw: unknown): UserTeamPlanSlot | null {
  if (raw === null) return null;
  if (typeof raw === 'string') {
    const name = raw.trim();
    if (!name) throw new Error('ships 中的舰名不能为空');
    return { name };
  }
  if (!isPlainObject(raw)) throw new Error('ships 中的槽位必须是对象');
  const allowedKeys = new Set([
    'name',
    'candidates',
    'priority',
    'search_name',
    'ship_type',
    'min_level',
    'max_level',
  ]);
  if (Object.keys(raw).some(key => !allowedKeys.has(key))) {
    throw new Error('槽位包含后端不支持的字段');
  }

  if (raw.candidates !== undefined && !Array.isArray(raw.candidates)) {
    throw new Error('candidates 必须是列表');
  }
  if (raw.priority !== undefined && !Array.isArray(raw.priority)) {
    throw new Error('旧版 priority 必须是列表');
  }
  const rawCandidates = (
    raw.candidates ?? raw.priority
  ) as unknown[] | undefined;
  const legacyNames = rawCandidates?.every(
    value => typeof value === 'string',
  ) === true
    ? rawCandidates.map(value => String(value).trim())
    : null;

  let primaryRaw: Record<string, unknown> | null = (
    typeof raw.name === 'string' && raw.name.trim()
  )
    ? raw
    : null;
  let candidatesRaw = rawCandidates ?? [];
  if (
    primaryRaw === null
    && legacyNames
    && legacyNames.length > 0
    && legacyNames.every(Boolean)
  ) {
    primaryRaw = { ...raw, name: legacyNames[0] };
    candidatesRaw = legacyNames.slice(1);
  }

  const candidates = candidatesRaw.map((candidate, index) => {
    if (typeof candidate === 'string') {
      const name = candidate.trim();
      if (!name) throw new Error(`candidates[${index}] 舰名不能为空`);
      return legacyCandidateRule(name, raw);
    }
    return normalizeUserTeamShipRule(
      candidate,
      `candidates[${index}]`,
    );
  });

  if (primaryRaw === null) {
    if (
      raw.search_name !== undefined
      || raw.ship_type !== undefined
      || raw.min_level !== undefined
      || raw.max_level !== undefined
    ) {
      throw new Error('没有主选 name 时不能填写主选规则');
    }
    if (candidates.length === 0) {
      throw new Error('位置至少需要一艘主选或备选舰船');
    }
    return { candidates };
  }

  const {
    candidates: _ignoredCandidates,
    priority: _ignoredPriority,
    ...primaryFields
  } = primaryRaw;
  const result: UserTeamPlanSlot = {
    ...normalizeUserTeamShipRule(primaryFields, '主选'),
  };
  if (candidates.length > 0) {
    result.candidates = candidates;
  }
  return result;
}

/** 校验独立编队文件：一个名称对应一支最多六个位置的舰队。 */
function normalizeUserTeamPlan(raw: unknown): UserTeamPlan {
  if (!isPlainObject(raw)) throw new Error('编队 YAML 根节点必须是对象');
  const allowedKeys = new Set(['name', 'fleet_id', 'ships']);
  if (Object.keys(raw).some(key => !allowedKeys.has(key))) {
    throw new Error('编队 YAML 包含不支持的根字段');
  }
  if (typeof raw.name !== 'string' || !raw.name.trim()) {
    throw new Error('name 不能为空');
  }
  if (!Array.isArray(raw.ships) || raw.ships.length < 1 || raw.ships.length > 6) {
    throw new Error('ships 必须包含 1 到 6 个位置');
  }
  if (raw.fleet_id !== undefined && (
    !Number.isInteger(raw.fleet_id)
    || Number(raw.fleet_id) < 1
    || Number(raw.fleet_id) > 4
  )) {
    throw new Error('旧版 fleet_id 必须是 1 到 4');
  }
  const ships = raw.ships
    .map(normalizeUserTeamSlot)
    .filter((slot): slot is UserTeamPlanSlot => slot !== null);
  if (ships.length === 0) {
    throw new Error('ships 至少需要一个有效位置');
  }
  return { name: raw.name.trim(), ships };
}

/** 使用行内 YAML 表示列表或备选对象，避免备选较多时纵向膨胀。 */
function inlineYaml(value: unknown): string {
  return yaml.dump(value, {
    flowLevel: 0,
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
  }).trim();
}

/** 主选分行输出；纯备选位置不写 name，单个备选保持在同一行。 */
function serializeUserTeamPlan(plan: UserTeamPlan): string {
  const lines = [
    `name: ${inlineYaml(plan.name)}`,
    'ships:',
  ];
  for (const slot of plan.ships) {
    if (slot.name !== undefined) {
      lines.push(`  - name: ${inlineYaml(slot.name)}`);
      if (slot.search_name !== undefined) {
        lines.push(`    search_name: ${inlineYaml(slot.search_name)}`);
      }
      if (slot.ship_type !== undefined) {
        lines.push(`    ship_type: ${inlineYaml(slot.ship_type)}`);
      }
      if (slot.min_level !== undefined) {
        lines.push(`    min_level: ${slot.min_level}`);
      }
      if (slot.max_level !== undefined) {
        lines.push(`    max_level: ${slot.max_level}`);
      }
    }
    if (slot.candidates?.length) {
      lines.push(slot.name === undefined ? '  - candidates:' : '    candidates:');
      for (const candidate of slot.candidates) {
        lines.push(`      - ${inlineYaml(candidate)}`);
      }
    }
  }
  return `${lines.join('\n')}\n`;
}

function teamFileName(name: string): string {
  const safeName = name
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/[. ]+$/g, '')
    .slice(0, 80);
  if (!safeName) throw new Error('编队预设名称不能用于文件名');
  return `team-${safeName}.yaml`;
}

function atomicWrite(filePath: string, content: string): void {
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, content, 'utf-8');
  try {
    fs.renameSync(temporary, filePath);
  } catch {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    fs.renameSync(temporary, filePath);
  }
}

function readUserTeamPlan(filePath: string): UserTeamPlan {
  return normalizeUserTeamPlan(
    yaml.load(fs.readFileSync(filePath, 'utf-8')),
  );
}

function userTeamPlanMatches(
  filePath: string,
  plan: UserTeamPlan,
): boolean {
  if (!fs.existsSync(filePath)) return false;
  try {
    return JSON.stringify(readUserTeamPlan(filePath))
      === JSON.stringify(plan);
  } catch {
    return false;
  }
}

function buildTeamPlanWrites(
  teams: UserTeamPlan[],
  directory: string,
): Array<{
  name: string;
  file: string;
  path: string;
  content: string;
}> {
  const files = new Set<string>();
  return teams.map((team) => {
    const file = teamFileName(team.name);
    const normalizedFile = file.toLowerCase();
    if (files.has(normalizedFile)) {
      throw new Error(
        `舰队名称生成了重复文件名，请修改名称：${team.name}`,
      );
    }
    files.add(normalizedFile);
    return {
      name: team.name,
      file,
      path: path.join(directory, file),
      content: serializeUserTeamPlan(team),
    };
  });
}

/** 列出系统和用户目录中命名、内容均合法的编队文件。 */
function listTeamPlans(): {
  plans: UserTeamPlan[];
  errors: PlanFileReadError[];
} {
  const plans: UserTeamPlan[] = [];
  const errors: PlanFileReadError[] = [];
  const sources: Array<{
    directory: string;
    source: PlanPresetSource;
  }> = [
    { directory: systemTeamPlansDir(), source: 'system' },
    { directory: userTeamPlansDir(), source: 'user' },
  ];
  for (const { directory, source } of sources) {
    for (const file of yamlFiles(directory)) {
      if (!TEAM_FILE_PATTERN.test(file)) {
        errors.push({
          file,
          source,
          kind: 'team',
          message: '舰队文件名必须以 team- 或 team_ 开头',
        });
        continue;
      }
      try {
        const filePath = path.join(directory, file);
        const plan = readUserTeamPlan(filePath);
        plans.push({
          ...plan,
          file,
          modifiedAt: fs.statSync(filePath).mtimeMs,
          source,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push({ file, source, kind: 'team', message });
      }
    }
  }
  return { plans, errors };
}

function yamlFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory)
    .filter(file => /\.ya?ml$/i.test(file))
    .sort((left, right) => left.localeCompare(right, 'zh-CN'));
}

function serializeCombatPlan(
  root: Record<string, unknown>,
  originalContent = '',
): string {
  const leadingComments: string[] = [];
  for (const line of originalContent.split(/\r?\n/)) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith('#') || trimmed === '') {
      leadingComments.push(line);
      continue;
    }
    break;
  }
  const body = yaml.dump(root, {
    lineWidth: -1,
    noCompatMode: true,
    noRefs: true,
    sortKeys: false,
  });
  const prefix = leadingComments.some(line => line.trimStart().startsWith('#'))
    ? `${leadingComments.join('\n').replace(/\s+$/, '')}\n`
    : '';
  return `${prefix}${body}`;
}

function findTeamPlan(
  name: string,
  source: PlanPresetSource,
  plans = listTeamPlans().plans,
): UserTeamPlan | null {
  return plans.find(plan => (
    plan.name === name && plan.source === source
  )) ?? plans.find(plan => plan.name === name) ?? null;
}

function normalizeCombatPlanFleetPresets(
  root: Record<string, unknown>,
  source: PlanPresetSource,
  requireEmbeddedShips: boolean,
): {
  mapRoot: Record<string, unknown>;
  teams: UserTeamPlan[];
} {
  if (!('chapter' in root) || !('map' in root)) {
    throw new Error('出征计划必须包含 chapter 和 map');
  }
  if (root.fleet_presets === undefined) {
    return {
      mapRoot: structuredClone(root),
      teams: [],
    };
  }
  if (!Array.isArray(root.fleet_presets)) {
    throw new Error('fleet_presets 必须是列表');
  }

  const names = new Set<string>();
  const teams: UserTeamPlan[] = [];
  const references = root.fleet_presets.map((rawPreset, index) => {
    if (!isPlainObject(rawPreset)) {
      throw new Error(`fleet_presets[${index}] 必须是对象`);
    }
    const name = typeof rawPreset.name === 'string'
      ? rawPreset.name.trim()
      : '';
    if (!name) {
      throw new Error(`fleet_presets[${index}].name 不能为空`);
    }
    if (names.has(name)) {
      throw new Error(`fleet_presets 中存在重复舰队名称：${name}`);
    }
    names.add(name);

    if (Array.isArray(rawPreset.ships)) {
      teams.push(normalizeUserTeamPlan({
        name,
        ships: rawPreset.ships,
      }));
    } else {
      if (requireEmbeddedShips) {
        throw new Error(`旧计划中的舰队「${name}」缺少 ships`);
      }
      if (!findTeamPlan(name, source)) {
        throw new Error(`找不到舰队「${name}」的独立配置`);
      }
    }
    return { name };
  });

  return {
    mapRoot: {
      ...structuredClone(root),
      fleet_presets: references,
    },
    teams,
  };
}

function expandCombatPlanRoot(
  root: Record<string, unknown>,
  source: PlanPresetSource,
): Record<string, unknown> {
  if (!('chapter' in root) || !('map' in root)) {
    throw new Error('出征计划必须包含 chapter 和 map');
  }
  if (root.fleet_presets === undefined) {
    return structuredClone(root);
  }
  if (!Array.isArray(root.fleet_presets)) {
    throw new Error('fleet_presets 必须是列表');
  }

  const listedTeams = listTeamPlans().plans;
  const presets = root.fleet_presets.map((rawPreset, index) => {
    if (!isPlainObject(rawPreset)) {
      throw new Error(`fleet_presets[${index}] 必须是对象`);
    }
    const name = typeof rawPreset.name === 'string'
      ? rawPreset.name.trim()
      : '';
    if (!name) {
      throw new Error(`fleet_presets[${index}].name 不能为空`);
    }

    const sameSourceTeam = listedTeams.find(team => (
      team.name === name && team.source === source
    )) ?? null;
    const embeddedTeam = Array.isArray(rawPreset.ships)
      ? normalizeUserTeamPlan({
        name,
        ships: rawPreset.ships,
      })
      : null;
    const team = sameSourceTeam
      ?? embeddedTeam
      ?? findTeamPlan(name, source, listedTeams);
    if (!team) {
      throw new Error(`地图引用的舰队「${name}」不存在`);
    }
    return {
      ...structuredClone(rawPreset),
      name,
      ships: structuredClone(team.ships),
    };
  });

  return {
    ...structuredClone(root),
    fleet_presets: presets,
  };
}

let runtimePlanSequence = 0;

function runtimeBattlePlansDir(): string {
  return path.join(
    app.getPath('temp'),
    'AutoWSGR-GUI',
    'runtime_battle_plans',
    String(process.pid),
  );
}

function writeRuntimeCombatPlan(
  content: string,
  hint: string,
): string {
  const parsed = yaml.load(content);
  if (
    !isPlainObject(parsed)
    || !('chapter' in parsed)
    || !('map' in parsed)
  ) {
    throw new Error('运行时出征计划必须包含 chapter 和 map');
  }
  if (
    Array.isArray(parsed.fleet_presets)
    && parsed.fleet_presets.some(preset => (
      !isPlainObject(preset)
      || !Array.isArray(preset.ships)
    ))
  ) {
    throw new Error('运行时出征计划包含尚未展开的舰队引用');
  }
  const directory = runtimeBattlePlansDir();
  fs.mkdirSync(directory, { recursive: true });
  runtimePlanSequence++;
  const safeHint = safePlanBaseName(hint) || 'plan';
  const file = `${safeHint}-${Date.now()}-${runtimePlanSequence}.yaml`;
  const target = path.join(directory, file);
  atomicWrite(target, content);
  return target;
}

function prepareManagedCombatPlan(
  source: PlanPresetSource,
  file: string,
): {
  sourcePath: string;
  runtimePath: string;
  content: string;
} {
  const sourcePath = safeManagedBattlePlanPath(source, file);
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    throw new Error('出征计划不存在');
  }
  const originalContent = fs.readFileSync(sourcePath, 'utf-8');
  const parsed = yaml.load(originalContent);
  if (!isPlainObject(parsed)) {
    throw new Error('无效的出征计划');
  }
  const expanded = expandCombatPlanRoot(parsed, source);
  const content = serializeCombatPlan(expanded, originalContent);
  return {
    sourcePath,
    runtimePath: writeRuntimeCombatPlan(content, file),
    content,
  };
}

function managedBattlePlanFromPath(
  filePath: string,
): {
  source: PlanPresetSource;
  file: string;
} | null {
  const resolved = path.resolve(filePath);
  for (const source of ['system', 'user'] as const) {
    const directory = path.resolve(
      source === 'system'
        ? systemBattlePlansDir()
        : userBattlePlansDir(),
    );
    if (
      path.dirname(resolved).toLowerCase() === directory.toLowerCase()
      && /\.ya?ml$/i.test(path.basename(resolved))
    ) {
      return {
        source,
        file: path.basename(resolved),
      };
    }
  }
  return null;
}

function safeUserPlanPath(file: string): string | null {
  if (path.basename(file) !== file || !/\.ya?ml$/i.test(file)) return null;
  return path.join(userBattlePlansDir(), file);
}

function safeUserTeamPlanPath(file: string): string | null {
  if (path.basename(file) !== file || !TEAM_FILE_PATTERN.test(file)) return null;
  return path.join(userTeamPlansDir(), file);
}

function safeManagedBattlePlanPath(
  source: PlanPresetSource,
  file: string,
): string | null {
  if (
    (source !== 'system' && source !== 'user')
    || path.basename(file) !== file
    || !/\.ya?ml$/i.test(file)
  ) {
    return null;
  }
  return path.join(
    source === 'system' ? systemBattlePlansDir() : userBattlePlansDir(),
    file,
  );
}

function safeManagedTeamPlanPath(
  source: PlanPresetSource,
  file: string,
): string | null {
  if (
    (source !== 'system' && source !== 'user')
    || path.basename(file) !== file
    || !TEAM_FILE_PATTERN.test(file)
  ) {
    return null;
  }
  return path.join(
    source === 'system' ? systemTeamPlansDir() : userTeamPlansDir(),
    file,
  );
}

function ignoredUnlinkedPlanKey(
  kind: 'battle' | 'team',
  source: PlanPresetSource,
  file: string,
): string | null {
  const valid = kind === 'battle'
    ? safeManagedBattlePlanPath(source, file)
    : safeManagedTeamPlanPath(source, file);
  return valid
    ? `${kind}/${source}/${file}`
    : null;
}

function getIgnoredUnlinkedPlans(): string[] {
  const raw = readGuiSettings().plan_management_ignored_unlinked;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((value) => {
    if (typeof value !== 'string') return [];
    if (/^(battle|team)\/(system|user)\/[^/\\]+\.ya?ml$/i.test(value)) {
      return [value];
    }
    const legacy = /^(system|user)\/([^/\\]+\.ya?ml)$/i.exec(value);
    return legacy ? [`battle/${legacy[1]}/${legacy[2]}`] : [];
  });
}

function writeIgnoredUnlinkedPlans(values: Iterable<string>): string[] {
  const normalized = [...new Set(values)].sort((left, right) => (
    left.localeCompare(right, 'zh-CN')
  ));
  writeGuiSettings({ plan_management_ignored_unlinked: normalized });
  return normalized;
}

function safePlanBaseName(value: string): string {
  return value
    .trim()
    .replace(/\.ya?ml$/i, '')
    .replace(/^bettle-/i, '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/[. ]+$/g, '')
    .slice(0, 100);
}

/** 读取管理页所需的出征计划、舰队方案及名称关联。 */
function getPlanManagement(): {
  bindings: Array<{
    planFile: string;
    planName: string;
    source: PlanPresetSource;
    teamName: string | null;
  }>;
  battlePlans: ManagedBattlePlanSummary[];
  teamPlans: Array<{
    file: string;
    name: string;
    source: PlanPresetSource;
  }>;
  errors: PlanFileReadError[];
  ignoredUnlinkedPlans: string[];
} {
  const bindings: Array<{
    planFile: string;
    planName: string;
    source: PlanPresetSource;
    teamName: string | null;
  }> = [];
  const battlePlans: ManagedBattlePlanSummary[] = [];
  const errors: PlanFileReadError[] = [];
  const listedTeams = listTeamPlans();
  errors.push(...listedTeams.errors);
  const sources: Array<{
    directory: string;
    source: PlanPresetSource;
  }> = [
    {
      directory: systemBattlePlansDir(),
      source: 'system',
    },
    {
      directory: userBattlePlansDir(),
      source: 'user',
    },
  ];

  sources.forEach(({ directory, source }) => {
    yamlFiles(directory).forEach((file) => {
      try {
        const planPath = path.join(directory, file);
        const raw = yaml.load(
          fs.readFileSync(planPath, 'utf-8'),
        );
        if (!isPlainObject(raw)) {
          throw new Error('无效的方案文件');
        }
        const root = raw;
        const rootName = typeof root.name === 'string' ? root.name.trim() : '';
        const fileName = file.replace(/\.ya?ml$/i, '');
        const standardName = fileName.match(/^bettle-(.+)$/i)?.[1];
        const planName = standardName || rootName || fileName;
        const presets = Array.isArray(root.fleet_presets)
          ? root.fleet_presets
          : [];
        const selectedNodes = Array.isArray(root.selected_nodes)
          ? root.selected_nodes
          : [];
        const times = Number(root.times);
        const gap = Number(root.gap);
        const fleetId = Number(root.fleet_id);
        const repairModeValue = Number(root.repair_mode);
        const repairModeList = Array.isArray(root.repair_mode)
          ? root.repair_mode
            .map(value => Number(value))
            .filter(value => Number.isFinite(value))
          : [];
        const normalizedResult = typeof root.result === 'string'
          ? root.result.trim().toUpperCase()
          : '';
        const result = (
          ['D', 'C', 'B', 'A', 'S', 'SS'] as ManagedBattleResult[]
        ).includes(normalizedResult as ManagedBattleResult)
          ? normalizedResult as ManagedBattleResult
          : null;
        const stopCondition = isPlainObject(root.stop_condition)
          ? root.stop_condition
          : {};
        const lootCountGe = Number(stopCondition.loot_count_ge);
        const shipCountGe = Number(stopCondition.ship_count_ge);
        const fleets = presets.flatMap((preset, index) => {
          if (!isPlainObject(preset)) return [];
          const name = typeof preset.name === 'string' && preset.name.trim()
            ? preset.name.trim()
            : `编队 ${index + 1}`;
          const sameSourceTeam = listedTeams.plans.find(team => (
            team.name === name && team.source === source
          )) ?? null;
          const embeddedShips = Array.isArray(preset.ships)
            ? preset.ships
            : null;
          const matchingPlan = sameSourceTeam
            ?? (embeddedShips
              ? null
              : findTeamPlan(name, source, listedTeams.plans));
          const ships = matchingPlan?.ships ?? embeddedShips ?? [];
          return [{
            name,
            source: (
              matchingPlan?.source ?? 'deleted'
            ) as ManagedBattlePlanFleetSummary['source'],
            primaryCount: ships.filter(ship => (
              (typeof ship === 'string' && Boolean(ship.trim()))
              || (
                isPlainObject(ship)
                && typeof ship.name === 'string'
                && Boolean(ship.name.trim())
              )
            )).length,
            backupCount: ships.reduce((count, ship) => (
              count + (
                isPlainObject(ship) && Array.isArray(ship.candidates)
                  ? ship.candidates.length
                  : 0
              )
            ), 0),
          }];
        });
        battlePlans.push({
          file,
          name: planName,
          source,
          modifiedAt: fs.statSync(planPath).mtimeMs,
          chapter: typeof root.chapter === 'number' || typeof root.chapter === 'string'
            ? root.chapter
            : '?',
          map: typeof root.map === 'number' || typeof root.map === 'string'
            ? root.map
            : '?',
          times: Number.isFinite(times) && times > 0 ? times : 1,
          gap: Number.isFinite(gap) && gap >= 0 ? gap : 0,
          fleetId: Number.isFinite(fleetId) && fleetId > 0 ? fleetId : 1,
          repairMode: repairModeList.length > 0
            ? repairModeList
            : Number.isFinite(repairModeValue)
              ? repairModeValue
              : 1,
          result,
          lootCountGe: Number.isFinite(lootCountGe) && lootCountGe > 0
            ? lootCountGe
            : -1,
          shipCountGe: Number.isFinite(shipCountGe) && shipCountGe > 0
            ? shipCountGe
            : -1,
          fleetCount: fleets.length,
          nodeCount: selectedNodes.length,
          fleets,
        });
        if (presets.length === 0) {
          bindings.push({
            planFile: file,
            planName,
            source,
            teamName: null,
          });
          return;
        }
        presets.forEach((preset) => {
          const teamName = isPlainObject(preset) && typeof preset.name === 'string'
            ? preset.name.trim() || null
            : null;
          bindings.push({
            planFile: file,
            planName,
            source,
            teamName,
          });
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push({
          file,
          source,
          kind: 'battle',
          message,
        });
      }
    });
  });
  const teamPlans = listedTeams.plans.map(plan => ({
    file: plan.file ?? '',
    name: plan.name,
    source: plan.source ?? 'user',
  }));
  return {
    bindings,
    battlePlans,
    teamPlans,
    errors,
    ignoredUnlinkedPlans: getIgnoredUnlinkedPlans(),
  };
}

/** 读取清单，为配置页提供当前资料库状态。 */
function getShipLibraryStatus(): ShipLibraryStatus {
  const directory = shipLibraryDir();
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
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as {
      generated_at?: unknown;
      counts?: Record<string, unknown>;
    };
    const counts = manifest.counts ?? {};
    return {
      exists: true,
      path: directory,
      generatedAt: typeof manifest.generated_at === 'string' ? manifest.generated_at : undefined,
      shipCount: typeof counts.ships === 'number' ? counts.ships : 0,
      assetCount: typeof counts.assets === 'number' ? counts.assets : 0,
      missingAssets: typeof counts.missing_assets === 'number' ? counts.missing_assets : 0,
    };
  } catch (error) {
    return {
      exists: false,
      path: directory,
      shipCount: 0,
      assetCount: 0,
      missingAssets: 0,
      error: `资料库清单读取失败: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function shipAssetUrl(relativePath: unknown): string {
  if (typeof relativePath !== 'string' || !relativePath) return '';
  const root = path.resolve(shipLibraryDir());
  const absolutePath = path.resolve(root, relativePath);
  if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`)) return '';
  return pathToFileURL(absolutePath).href;
}

/** 只向渲染进程提供舰队规划需要的清单字段和本地资源 URL。 */
function getShipLibraryManifest(): ShipLibraryManifest {
  const manifestPath = path.join(shipLibraryDir(), 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error('舰船资料库尚未建立，请先在配置页更新舰船数据库');
  }
  const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as {
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
    schemaVersion: typeof raw.schema_version === 'number' ? raw.schema_version : 0,
    generatedAt: typeof raw.generated_at === 'string' ? raw.generated_at : '',
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
        portraitUrl: shipAssetUrl(ship.portrait),
        backgroundUrl: shipAssetUrl(ship.background),
        frameUrl: shipAssetUrl(ship.frame),
        typeIconUrl: shipAssetUrl(ship.type_icon),
      };
    }),
  };
}

function shipLibraryUpdaterPath(): string {
  const root = isPackaged() ? resourceRoot() : appRoot();
  return path.join(root, 'tools', 'ship_library', 'update_ship_library.py');
}

function sendShipLibraryProgress(message: string): void {
  mainWindow?.webContents.send('ship-library-update-progress', { message });
}

/** 使用当前 GUI Python 环境执行增量更新，并解析脚本的机器可读结果。 */
async function runShipLibraryUpdate(): Promise<ShipLibraryUpdateResult> {
  const pythonCmd = await findPython();
  if (!pythonCmd) {
    return { success: false, error: '找不到可用的 Python 3.12 或 3.13' };
  }
  const updaterPath = shipLibraryUpdaterPath();
  if (!fs.existsSync(updaterPath)) {
    return { success: false, error: `找不到舰船资料库更新程序: ${updaterPath}` };
  }

  return new Promise((resolve) => {
    const child = spawn(
      pythonCmd,
      [
        updaterPath,
        '--output',
        shipLibraryDir(),
        '--workers',
        '8',
        '--force-assets',
      ],
      { cwd: appRoot(), windowsHide: true },
    );
    let stdoutBuffer = '';
    let stderr = '';
    let result: ShipLibraryUpdateResult | null = null;

    const handleLine = (rawLine: string): void => {
      const line = rawLine.trim();
      if (!line) return;
      if (line.startsWith('PROGRESS sources')) {
        sendShipLibraryProgress('正在获取舰R百科数据…');
      } else {
        const records = line.match(/^PROGRESS records parsed=(\d+)$/);
        const assets = line.match(
          /^PROGRESS assets (\d+)\/(\d+) downloaded=(\d+) failed=(\d+)$/,
        );
        if (records) {
          sendShipLibraryProgress(`已读取 ${records[1]} 艘舰船，正在检查本地资源…`);
        } else if (assets) {
          sendShipLibraryProgress(
            `正在检查资源 ${assets[1]}/${assets[2]}，已下载 ${assets[3]}，失败 ${assets[4]}`,
          );
        }
      }
      if (line.startsWith('RESULT_JSON=')) {
        try {
          result = JSON.parse(line.slice('RESULT_JSON='.length)) as ShipLibraryUpdateResult;
        } catch {
          result = { success: false, error: '更新程序返回了无效结果' };
        }
      }
    };

    child.stdout.setEncoding('utf-8');
    child.stdout.on('data', (chunk: string) => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? '';
      lines.forEach(handleLine);
    });
    child.stderr.setEncoding('utf-8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', (error) => {
      resolve({ success: false, error: `更新程序启动失败: ${error.message}` });
    });
    child.once('close', (code) => {
      if (stdoutBuffer) handleLine(stdoutBuffer);
      resolve(result ?? {
        success: false,
        error: stderr.trim() || `更新程序异常退出（代码 ${code ?? 'unknown'}）`,
      });
    });
  });
}

function createWindow(): BrowserWindow {
  const preferences = getWindowPreferences();
  const rememberedBounds = preferences.rememberBounds
    ? readRememberedWindowBounds()
    : null;
  const initialBounds = rememberedBounds && isWindowBoundsVisible(rememberedBounds)
    ? rememberedBounds
    : null;
  const win = new BrowserWindow({
    width: initialBounds?.width ?? preferences.defaultWidth,
    height: initialBounds?.height ?? preferences.defaultHeight,
    x: initialBounds?.x,
    y: initialBounds?.y,
    center: initialBounds === null,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#1a1a2e',
    icon: path.join(isPackaged() ? process.resourcesPath : path.join(__dirname, '..', '..'), 'resource', 'images', 'logo.png'),
  });

  const appDir = app.getAppPath();
  const htmlPath = path.join(appDir, 'src', 'view', 'index.html');

  // 根据 BACKEND_PORT 动态注入 CSP
  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          `default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' file: data:; connect-src 'self' http://localhost:${BACKEND_PORT} ws://localhost:${BACKEND_PORT}`
        ],
      },
    });
  });

  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    const msg = `Page load failed!\nCode: ${errorCode}\nDesc: ${errorDescription}\nURL: ${validatedURL}\nPath: ${htmlPath}`;
    console.error('[Main]', msg);
    if (isPackaged()) {
      dialog.showMessageBox({ type: 'error', title: 'Load Error', message: msg });
    }
  });

  win.loadFile(htmlPath).catch(err => {
    console.error('[Main] loadFile failed:', err);
    if (isPackaged()) {
      dialog.showMessageBox({ type: 'error', title: 'loadFile Error', message: `${err.message}\nPath: ${htmlPath}` });
    }
  });

  mainWindow = win;
  captureWindowBounds(win);
  win.on('move', () => captureWindowBounds(win));
  win.on('resize', () => captureWindowBounds(win));
  win.on('close', () => {
    captureWindowBounds(win);
    persistWindowBounds();
  });
  win.on('closed', () => { mainWindow = null; });
  return win;
}

// ════════════════════════════════════════
// IPC Handlers
// ════════════════════════════════════════

ipcMain.handle('open-directory-dialog', async (_event, title?: string) => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: title || '选择文件夹',
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('open-file-dialog', async (_event, filters: Electron.FileFilter[], defaultDir?: string) => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    defaultPath: defaultDir || undefined,
    filters,
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const filePath = result.filePaths[0];
  const content = fs.readFileSync(filePath, 'utf-8');
  return { path: filePath, content };
});

ipcMain.handle('save-file', async (_event, filePath: string, content: string) => {
  const resolved = resolveAppPath(filePath);
  const dir = path.dirname(resolved);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(resolved, content, 'utf-8');
});

ipcMain.handle('save-file-dialog', async (_event, defaultName: string, content: string, filters: Electron.FileFilter[]) => {
  const result = await dialog.showSaveDialog({
    defaultPath: defaultName,  // caller can pass full path (dir + filename)
    filters,
  });
  if (result.canceled || !result.filePath) return null;
  fs.writeFileSync(result.filePath, content, 'utf-8');
  return result.filePath;
});

ipcMain.handle('read-file', async (_event, filePath: string) => {
  const resolved = resolveAppPath(filePath);
  if (!fs.existsSync(resolved)) return '';
  return fs.readFileSync(resolved, 'utf-8');
});

ipcMain.handle('append-file', async (_event, filePath: string, content: string) => {
  const resolved = resolveAppPath(filePath);
  const dir = path.dirname(resolved);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(resolved, content, 'utf-8');
});


ipcMain.handle('detect-emulator', async () => {
  return detectEmulator();
});

ipcMain.handle('check-adb-devices', async () => {
  try {
    return await listAdbDevices();
  } catch {
    return [];
  }
});

ipcMain.handle('connect-adb-device', async (_event, serial: string) => {
  return runAdbDeviceCommand('connect', serial);
});

ipcMain.handle('disconnect-adb-device', async (_event, serial: string) => {
  return runAdbDeviceCommand('disconnect', serial);
});

ipcMain.on('get-app-version-sync', (event) => {
  event.returnValue = app.getVersion();
});

ipcMain.on('get-backend-port-sync', (event) => {
  event.returnValue = BACKEND_PORT;
});

ipcMain.on('get-backend-startup-mode-sync', (event) => {
  event.returnValue = getBackendStartupMode();
});

ipcMain.on('get-backend-repo-path-sync', (event) => {
  event.returnValue = getBackendRepoPath();
});

ipcMain.on('get-ocr-gpu-mode-sync', (event) => {
  event.returnValue = getOcrGpuMode();
});

ipcMain.on('get-cuda-path-sync', (event) => {
  event.returnValue = getCudaPath();
});

ipcMain.on('get-save-backend-screenshots-sync', (event) => {
  event.returnValue = getSaveBackendScreenshots();
});

ipcMain.on('get-window-preferences-sync', (event) => {
  event.returnValue = getWindowPreferences();
});

ipcMain.handle('set-window-preferences', (_event, preferences: Partial<WindowPreferences>) => {
  const current = getWindowPreferences();
  writeGuiSettings({
    default_window_width: normalizeWindowSize(
      preferences?.defaultWidth,
      MIN_WINDOW_WIDTH,
      current.defaultWidth,
    ),
    default_window_height: normalizeWindowSize(
      preferences?.defaultHeight,
      MIN_WINDOW_HEIGHT,
      current.defaultHeight,
    ),
    remember_window_bounds: preferences?.rememberBounds === true,
  });
  return getWindowPreferences();
});

ipcMain.handle('get-gui-automation-settings', () => {
  return getGuiAutomationSettings();
});

ipcMain.handle(
  'set-gui-automation-settings',
  (_event, settings: GuiAutomationSettings) => {
    const normalized: GuiAutomationSettings = {
      expeditionInterval: Math.max(
        1,
        Math.min(120, Math.trunc(Number(settings?.expeditionInterval) || 15)),
      ),
      battleTimes: Math.max(1, Math.trunc(Number(settings?.battleTimes) || 3)),
      autoLoot: settings?.autoLoot === true,
      lootPlanIndex: Math.max(0, Math.trunc(Number(settings?.lootPlanIndex) || 0)),
      lootStopCount: Math.max(
        1,
        Math.min(50, Math.trunc(Number(settings?.lootStopCount) || 50)),
      ),
    };
    writeGuiSettings({ automation: normalized });
    return normalized;
  },
);

ipcMain.handle('get-decisive-plan-settings', () => {
  return getDecisivePlanSettings();
});

ipcMain.handle(
  'set-decisive-plan-settings',
  (_event, settings: DecisivePlanSettings) => {
    const normalized = normalizeDecisivePlanSettings(settings);
    writeGuiSettings({
      decisive_plan: {
        chapter: normalized.chapter,
        use_quick_repair: normalized.useQuickRepair,
        level1: normalized.level1,
        level2: normalized.level2,
      },
    });
    return normalized;
  },
);

ipcMain.handle('set-backend-port', (_event, port: number) => {
  // 防御性校验：仅在端口为有限数值且位于合法范围时才写入设置
  if (typeof port !== 'number' || !Number.isFinite(port)) {
    return;
  }
  const normalizedPort = Math.trunc(port);
  if (normalizedPort < 1 || normalizedPort > 65535) {
    return;
  }
  writeGuiSettings({ backend_port: normalizedPort });
});

ipcMain.handle('set-backend-startup-mode', (_event, mode: BackendStartupMode) => {
  const normalized = mode === 'external' ? 'external' : 'managed';
  writeGuiSettings({ backend_startup_mode: normalized });
});

ipcMain.handle('set-backend-repo-path', (_event, repoPath: string | null) => {
  const normalized = typeof repoPath === 'string' ? repoPath.trim() : '';
  writeGuiSettings({ backend_repo_path: normalized });
});

ipcMain.handle('set-ocr-gpu-mode', (_event, mode: OcrGpuMode) => {
  const normalized: OcrGpuMode = mode === 'cpu' || mode === 'cuda' ? mode : 'auto';
  writeGuiSettings({ ocr_gpu_mode: normalized });
});

ipcMain.handle('set-cuda-path', (_event, cudaPath: string | null) => {
  const raw = typeof cudaPath === 'string' ? cudaPath.trim() : '';
  const normalized = raw ? normalizeCudaPath(raw) : '';
  writeGuiSettings({ cuda_path: normalized });
});

ipcMain.handle('validate-cuda-path', async (_event, cudaPath: string) => {
  return detectCudaEnvironment(cudaPath);
});

ipcMain.handle('set-save-backend-screenshots', (_event, enabled: boolean) => {
  writeGuiSettings({ save_backend_screenshots: enabled === true });
});

ipcMain.on('get-python-path-sync', (event) => {
  event.returnValue = getConfiguredPythonPath();
});

ipcMain.on('get-update-mode-sync', (event) => {
  event.returnValue = getUpdateMode();
});

ipcMain.handle('set-update-mode', (_event, mode: 'auto' | 'manual') => {
  const normalized = mode === 'manual' ? 'manual' : 'auto';
  writeGuiSettings({ update_mode: normalized });
});

ipcMain.handle('set-python-path', (_event, pythonPath: string | null) => {
  writeGuiSettings({ python_path: pythonPath ?? '' });
  clearPythonCache(); // 清除缓存，下次查找时使用新路径
});

ipcMain.handle('validate-python', async (_event, pythonPath: string) => {
  if (!pythonPath) return { valid: false, version: null, error: '路径为空' };
  if (!fs.existsSync(pythonPath)) return { valid: false, version: null, error: '文件不存在' };
  try {
    const { stdout } = await execAsync(`"${pythonPath}" --version`, { windowsHide: true, timeout: 10000 });
    const version = stdout.trim();
    if (!isAllowedPythonVersion(version)) {
      return { valid: false, version, error: `版本不兼容: ${version}（需要 3.12 或 3.13）` };
    }
    return { valid: true, version };
  } catch (e) {
    return { valid: false, version: null, error: `执行失败: ${e instanceof Error ? e.message : String(e)}` };
  }
});

ipcMain.handle('get-app-root', () => {
  return appRoot();
});

ipcMain.handle('resolve-app-path', (_event, filePath: string) => {
  return resolveAppPath(filePath);
});

ipcMain.handle('get-plans-dir', () => {
  return userBattlePlansDir();
});

ipcMain.handle('list-plan-files', () => {
  const dir = userBattlePlansDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => /\.ya?ml$/i.test(f))
    .map(f => ({ name: f.replace(/\.ya?ml$/i, ''), file: f }));
});

ipcMain.handle('get-config-dir', () => {
  return appRoot();
});

ipcMain.handle('open-folder', async (_event, folderPath: string) => {
  if (fs.existsSync(folderPath)) {
    await shell.openPath(folderPath);
  }
});

ipcMain.handle('check-environment', async () => {
  return await checkEnvironment();
});

ipcMain.handle('get-ship-library-status', () => {
  return getShipLibraryStatus();
});

ipcMain.handle('get-ship-library-manifest', () => {
  return getShipLibraryManifest();
});

ipcMain.handle('save-user-team-plan', (
  _event,
  rawPlan: unknown,
  overwrite: boolean,
  currentFile?: string,
  rawSource?: PlanPresetSource,
) => {
  try {
    const plan = normalizeUserTeamPlan(rawPlan);
    const source: PlanPresetSource = rawSource === 'system' ? 'system' : 'user';
    const directory = source === 'system'
      ? systemTeamPlansDir()
      : userTeamPlansDir();
    const file = teamFileName(plan.name);
    const filePath = path.join(directory, file);
    let currentPath: string | null = null;
    if (currentFile !== undefined) {
      if (
        typeof currentFile !== 'string'
        || path.basename(currentFile) !== currentFile
        || !TEAM_FILE_PATTERN.test(currentFile)
      ) {
        throw new Error('当前编队文件名不符合规则');
      }
      currentPath = path.join(directory, currentFile);
    }
    const updatesCurrentFile = currentPath !== null
      && path.resolve(currentPath).toLowerCase()
        === path.resolve(filePath).toLowerCase();
    if (
      fs.existsSync(filePath)
      && !updatesCurrentFile
      && overwrite !== true
    ) {
      return {
        success: false,
        exists: true,
        file,
        error: '存在同名配置',
      };
    }
    const content = serializeUserTeamPlan(plan);
    atomicWrite(filePath, content);
    if (
      currentPath
      && !updatesCurrentFile
      && fs.existsSync(currentPath)
    ) {
      fs.unlinkSync(currentPath);
    }
    return { success: true, file, plan: { ...plan, file, source } };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

ipcMain.handle('pick-user-team-plan', async () => {
  const directory = userTeamPlansDir();
  const result = await dialog.showOpenDialog({
    title: '加载编队预设',
    defaultPath: directory,
    properties: ['openFile'],
    filters: [{ name: '编队 YAML', extensions: ['yaml', 'yml'] }],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, canceled: true };
  }

  const filePath = path.resolve(result.filePaths[0]);
  const file = path.basename(filePath);
  if (
    path.dirname(filePath).toLowerCase() !== path.resolve(directory).toLowerCase()
    || !TEAM_FILE_PATTERN.test(file)
  ) {
    return { success: false, error: '当前yaml格式不符合规则' };
  }
  try {
    const plan = readUserTeamPlan(filePath);
    return {
      success: true,
      file,
      plan: { ...plan, file, source: 'user' },
    };
  } catch {
    return { success: false, error: '当前yaml格式不符合规则' };
  }
});

ipcMain.handle('list-team-plans', () => {
  return listTeamPlans();
});

ipcMain.handle('get-plan-management', () => {
  return getPlanManagement();
});

ipcMain.handle(
  'set-plan-unlinked-ignored',
  (
    _event,
    kind: 'battle' | 'team',
    source: PlanPresetSource,
    file: string,
    ignored: boolean,
  ) => {
    const key = ignoredUnlinkedPlanKey(kind, source, file);
    if (!key) return getIgnoredUnlinkedPlans();
    const values = new Set(getIgnoredUnlinkedPlans());
    if (ignored === true) values.add(key);
    else values.delete(key);
    return writeIgnoredUnlinkedPlans(values);
  },
);

ipcMain.handle(
  'read-managed-combat-plan',
  (_event, source: PlanPresetSource, file: string) => {
    try {
      const prepared = prepareManagedCombatPlan(source, file);
      return {
        success: true,
        path: prepared.sourcePath,
        sourcePath: prepared.sourcePath,
        runtimePath: prepared.runtimePath,
        content: prepared.content,
        source,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
);

ipcMain.handle(
  'read-combat-plan-file',
  (_event, rawPath: string) => {
    try {
      if (typeof rawPath !== 'string' || !rawPath.trim()) {
        throw new Error('出征计划路径不能为空');
      }
      const resolved = resolveAppPath(rawPath);
      const managed = managedBattlePlanFromPath(resolved);
      if (managed) {
        const prepared = prepareManagedCombatPlan(
          managed.source,
          managed.file,
        );
        return {
          success: true,
          path: prepared.runtimePath,
          sourcePath: prepared.sourcePath,
          runtimePath: prepared.runtimePath,
          content: prepared.content,
          source: managed.source,
        };
      }
      if (!fs.existsSync(resolved)) {
        throw new Error('出征计划不存在');
      }
      return {
        success: true,
        path: resolved,
        sourcePath: resolved,
        content: fs.readFileSync(resolved, 'utf-8'),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
);

ipcMain.handle(
  'prepare-combat-plan-execution',
  (_event, content: string, hint: string) => {
    try {
      if (typeof content !== 'string') {
        throw new Error('出征计划内容不合法');
      }
      return {
        success: true,
        path: writeRuntimeCombatPlan(
          content,
          typeof hint === 'string' ? hint : 'plan',
        ),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
);

ipcMain.handle(
  'convert-legacy-combat-plan',
  async (
    _event,
    overwrite: boolean,
    existingInputPath?: string,
  ): Promise<LegacyPlanConversionResult> => {
    let inputPath = existingInputPath;
    if (!inputPath) {
      const result = await dialog.showOpenDialog({
        title: '选择要转换的旧出征计划',
        properties: ['openFile'],
        filters: [{
          name: '出征计划 YAML',
          extensions: ['yaml', 'yml'],
        }],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, canceled: true };
      }
      [inputPath] = result.filePaths;
    }

    try {
      const resolvedInput = path.resolve(inputPath);
      if (!/\.ya?ml$/i.test(resolvedInput) || !fs.existsSync(resolvedInput)) {
        throw new Error('旧出征计划文件不存在或格式不正确');
      }
      const originalContent = fs.readFileSync(resolvedInput, 'utf-8');
      const parsed = yaml.load(originalContent);
      if (!isPlainObject(parsed)) {
        throw new Error('旧出征计划根节点必须是对象');
      }
      const split = normalizeCombatPlanFleetPresets(
        parsed,
        'user',
        true,
      );
      if (split.teams.length === 0) {
        throw new Error('旧出征计划必须包含至少一支内嵌舰队');
      }

      const name = safePlanBaseName(path.basename(resolvedInput));
      if (!name) throw new Error('旧出征计划文件名不合法');
      const file = `bettle-${name}.yaml`;
      const target = safeUserPlanPath(file);
      if (!target) throw new Error('转换后的出征计划名称不合法');

      const teamWrites = buildTeamPlanWrites(
        split.teams,
        userTeamPlansDir(),
      );
      const conflicts = [
        ...(fs.existsSync(target) ? [`地图：${file}`] : []),
        ...teamWrites
          .filter(item => fs.existsSync(item.path))
          .map(item => `舰队：${item.name}`),
      ];
      if (conflicts.length > 0 && overwrite !== true) {
        return {
          success: false,
          exists: true,
          inputPath: resolvedInput,
          file,
          source: 'user',
          teamFiles: teamWrites.map(item => item.file),
          conflicts,
          error: '用户配置中存在同名文件',
        };
      }

      initUserBattlePlansDir();
      initUserTeamPlansDir();
      for (const item of teamWrites) {
        atomicWrite(item.path, item.content);
      }
      atomicWrite(
        target,
        serializeCombatPlan(split.mapRoot, originalContent),
      );
      return {
        success: true,
        inputPath: resolvedInput,
        file,
        path: target,
        source: 'user',
        teamFiles: teamWrites.map(item => item.file),
      };
    } catch (error) {
      return {
        success: false,
        inputPath,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
);

ipcMain.handle(
  'save-managed-combat-plan',
  (
    _event,
    rawName: string,
    content: string,
    overwrite: boolean,
    currentFile?: string,
    rawSource?: PlanPresetSource,
  ) => {
    try {
      const name = typeof rawName === 'string'
        ? safePlanBaseName(rawName)
        : '';
      if (!name) throw new Error('请先填写预设名称');
      if (typeof content !== 'string') {
        throw new Error('出征计划内容不合法');
      }
      const parsed = yaml.load(content);
      if (!isPlainObject(parsed)) {
        throw new Error('出征计划根节点必须是对象');
      }

      const source: PlanPresetSource = rawSource === 'system'
        ? 'system'
        : 'user';
      const split = normalizeCombatPlanFleetPresets(
        parsed,
        source,
        false,
      );
      const file = `bettle-${name}.yaml`;
      const target = safeManagedBattlePlanPath(source, file);
      if (!target) throw new Error('出征计划名称不合法');
      fs.mkdirSync(path.dirname(target), { recursive: true });

      let currentPath: string | null = null;
      if (currentFile !== undefined) {
        currentPath = safeManagedBattlePlanPath(source, currentFile);
        if (!currentPath) {
          throw new Error('当前出征计划文件名不符合规则');
        }
      }
      const updatesCurrentFile = currentPath !== null
        && path.resolve(currentPath).toLowerCase()
          === path.resolve(target).toLowerCase();
      const mapConflict = (
        fs.existsSync(target)
        && !updatesCurrentFile
      );
      const teamDirectory = source === 'system'
        ? systemTeamPlansDir()
        : userTeamPlansDir();
      const teamWrites = buildTeamPlanWrites(
        split.teams,
        teamDirectory,
      ).map((item, index) => ({
        ...item,
        unchanged: userTeamPlanMatches(
          item.path,
          split.teams[index],
        ),
      }));
      const conflicts = [
        ...(mapConflict ? [`地图：${file}`] : []),
        ...teamWrites
          .filter(item => fs.existsSync(item.path) && !item.unchanged)
          .map(item => `舰队：${item.name}`),
      ];
      if (conflicts.length > 0 && overwrite !== true) {
        return {
          success: false,
          exists: true,
          file,
          source,
          conflicts,
          error: '存在同名配置',
        };
      }

      fs.mkdirSync(teamDirectory, { recursive: true });
      for (const item of teamWrites) {
        if (!item.unchanged) {
          atomicWrite(item.path, item.content);
        }
      }
      atomicWrite(
        target,
        serializeCombatPlan(split.mapRoot, content),
      );
      if (
        currentPath
        && !updatesCurrentFile
        && fs.existsSync(currentPath)
      ) {
        fs.unlinkSync(currentPath);
      }

      if (currentFile && currentFile !== file) {
        const oldKey = ignoredUnlinkedPlanKey(
          'battle',
          source,
          currentFile,
        );
        const newKey = ignoredUnlinkedPlanKey('battle', source, file);
        const ignored = new Set(getIgnoredUnlinkedPlans());
        if (oldKey && newKey && ignored.delete(oldKey)) {
          ignored.add(newKey);
          writeIgnoredUnlinkedPlans(ignored);
        }
      }
      return {
        success: true,
        file,
        path: target,
        source,
        teamFiles: teamWrites.map(item => item.file),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
);

ipcMain.handle(
  'rename-user-combat-plan',
  (_event, file: string, newName: string) => {
    const source = safeUserPlanPath(file);
    const safeName = safePlanBaseName(newName);
    if (!source || !fs.existsSync(source) || !safeName) {
      return { success: false, error: '出征计划名称或文件不合法' };
    }
    const targetFile = `bettle-${safeName}.yaml`;
    const target = safeUserPlanPath(targetFile);
    if (!target) return { success: false, error: '出征计划名称不合法' };
    if (source.toLowerCase() !== target.toLowerCase() && fs.existsSync(target)) {
      return { success: false, error: '同名出征计划已存在' };
    }
    try {
      fs.renameSync(source, target);
      const oldKey = ignoredUnlinkedPlanKey('battle', 'user', file);
      const newKey = ignoredUnlinkedPlanKey('battle', 'user', targetFile);
      const ignored = new Set(getIgnoredUnlinkedPlans());
      if (oldKey && newKey && ignored.delete(oldKey)) {
        ignored.add(newKey);
        writeIgnoredUnlinkedPlans(ignored);
      }
      return { success: true, file: targetFile };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
);

ipcMain.handle('delete-user-combat-plan', (_event, file: string) => {
  const target = safeUserPlanPath(file);
  if (!target || !fs.existsSync(target)) {
    return { success: false, error: '用户出征计划不存在' };
  }
  try {
    fs.unlinkSync(target);
    const key = ignoredUnlinkedPlanKey('battle', 'user', file);
    if (key) {
      const ignored = new Set(getIgnoredUnlinkedPlans());
      if (ignored.delete(key)) writeIgnoredUnlinkedPlans(ignored);
    }
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

ipcMain.handle('delete-user-team-plan', (_event, file: string) => {
  const target = safeUserTeamPlanPath(file);
  if (!target || !fs.existsSync(target)) {
    return { success: false, error: '用户舰队方案不存在' };
  }
  try {
    fs.unlinkSync(target);
    const key = ignoredUnlinkedPlanKey('team', 'user', file);
    if (key) {
      const ignored = new Set(getIgnoredUnlinkedPlans());
      if (ignored.delete(key)) writeIgnoredUnlinkedPlans(ignored);
    }
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

let shipLibraryUpdateRunning = false;
ipcMain.handle('update-ship-library', async () => {
  if (shipLibraryUpdateRunning) {
    return { success: false, error: '舰船资料库正在更新，请稍候' };
  }
  shipLibraryUpdateRunning = true;
  try {
    return await runShipLibraryUpdate();
  } finally {
    shipLibraryUpdateRunning = false;
  }
});

/*
 * 测试期接口（后端源码更新）已停用，逻辑保留便于回滚恢复。
ipcMain.handle('check-updates', async () => {
  return await checkForUpdates();
});
*/

ipcMain.handle('install-deps', async () => {
  const pythonCmd = await findPython();
  if (!pythonCmd) return { success: false, output: '找不到 Python' };
  return installDependencies(pythonCmd);
});

ipcMain.handle('run-setup', async () => {
  return runSetupScript();
});

ipcMain.handle('install-portable-python', async () => {
  return installPortablePython();
});

/*
 * 测试期接口（后端源码更新）已停用，逻辑保留便于回滚恢复。
ipcMain.handle('pull-updates', async () => {
  return pullUpdates();
});
*/

ipcMain.handle('start-backend', async () => {
  if (getBackendProcess()) return { success: true, message: '后端已在运行' };
  await startBackend();
  return { success: true, message: '后端启动中' };
});

// ════════════════════════════════════════
// GUI 自动更新 (electron-updater)
// ════════════════════════════════════════

/** 初始化自动更新 */
function initAutoUpdater(): void {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    mainWindow?.webContents.send('update-status', {
      status: 'available',
      version: info.version,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : '',
    });
  });

  autoUpdater.on('update-not-available', () => {
    mainWindow?.webContents.send('update-status', { status: 'up-to-date' });
  });

  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    mainWindow?.webContents.send('update-status', {
      status: 'downloading',
      percent: Math.round(progress.percent),
      transferred: progress.transferred,
      total: progress.total,
    });
  });

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    mainWindow?.webContents.send('update-status', {
      status: 'downloaded',
      version: info.version,
    });
  });

  autoUpdater.on('error', (err: Error) => {
    mainWindow?.webContents.send('update-status', {
      status: 'error',
      message: err.message,
    });
  });
}

ipcMain.handle('check-gui-updates', async () => {
  try {
    const result = await autoUpdater.checkForUpdates();
    return result?.updateInfo ? { version: result.updateInfo.version } : null;
  } catch {
    return null;
  }
});

ipcMain.handle('download-gui-update', async () => {
  try {
    await autoUpdater.downloadUpdate();
    return { success: true };
  } catch (err: any) {
    return { success: false, message: err.message };
  }
});

ipcMain.handle('install-gui-update', () => {
  autoUpdater.quitAndInstall(false, true);
});

/** 向渲染进程发送环境检查进度 */
function sendProgress(msg: string): void {
  mainWindow?.webContents.send('backend-log', msg);
}

// ════════════════════════════════════════
// App Lifecycle
// ════════════════════════════════════════

app.whenReady().then(() => {
  initPythonEnv({
    appRoot,
    sendProgress,
    getConfiguredPythonPath,
    getUpdateMode,
    getBackendStartupMode,
    getBackendRepoPath,
    getTempDir: () => app.getPath('temp'),
  });
  initBackend({
    appRoot,
    resourceRoot,
    BACKEND_PORT,
    getMainWindow: () => mainWindow,
  });
  initUserBattlePlansDir();
  initUserShipLibraryDir();
  initUserTeamPlansDir();
  initSystemPlanDirs();
  initAutoUpdater();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('before-quit', () => {
  captureWindowBounds(mainWindow);
  persistWindowBounds();
  stopBackend();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
