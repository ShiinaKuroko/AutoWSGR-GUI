# 04 — Electron 主进程拆分

> **前置阅读**：[00-overview](00-overview.md)  
> **核心原则**：`main.ts` 是组合根，只负责组装服务、注册 IPC 和应用生命周期；
> 文件、配置、计划、环境和后端进程逻辑由独立 Service 承担。

---

## 重构前后

**重构前**：

```
electron/
├── main.ts      (1192 行 — 窗口 + IPC + Python + 后端 + 模拟器全在一起)
└── preload.ts
```

**重构后**：

```
electron/
├── main.ts                 (服务组装 + IPC 注册 + 生命周期)
├── preload.ts              (受限渲染进程桥接)
├── emulatorDetect.ts       (模拟器检测)
├── ipc/                    (薄 IPC 适配器)
│   ├── BackendIpc.ts
│   ├── EnvironmentIpc.ts
│   └── ...
├── services/               (主进程业务用例)
│   ├── BackendService.ts
│   ├── BackendShutdownService.ts
│   ├── PythonEnvironmentService.ts
│   └── ...
└── pythonEnv/              (Python 环境领域实现)
    ├── index.ts            (barrel re-export)
    ├── context.ts          (共享运行上下文)
    ├── environment.ts      (统一环境描述)
    ├── finder.ts           (Python 查找)
    ├── envCheck.ts         (环境检查)
    ├── installer.ts        (依赖安装)
    ├── updater.ts          (managed 后端契约更新)
    └── utils.ts            (底层工具)
```

---

## 模式：组合根 + 依赖注入

子模块不通过 `import` 读取 `main.ts` 的全局变量。长期运行的后端和 Python
领域模块通过 Context 接收 Electron 能力；普通用例 Service 通过构造函数接收
文件系统、Repository 或底层函数；IPC 层只转换通道输入输出。

### services/BackendService.ts

```typescript
// electron/services/BackendService.ts

export interface BackendContext {
  appRoot: () => string;
  userDataRoot: () => string;
  resourceRoot: () => string;
  BACKEND_PORT: number;
  getMainWindow: () => BrowserWindow | null;
}

let ctx: BackendContext;

export function initBackend(context: BackendContext): void {
  ctx = context;
}

export function getBackendProcess(): ChildProcess | null {
  return backendProcess;
}

// startBackend()、stopBackend() 通过 ctx 访问路径和窗口能力。
```

### pythonEnv/context.ts

```typescript
// electron/pythonEnv/context.ts

export interface PythonEnvContext {
  appRoot: () => string;
  sendProgress: (msg: string) => void;
  getConfiguredPythonPath: () => string | null;
  getUpdateMode: () => 'auto' | 'manual';
  getBackendStartupMode: () => 'managed' | 'external';
  getBackendRepoPath: () => string | null;
  getTempDir: () => string;
}

let ctx: PythonEnvContext;

export function initPythonEnv(context: PythonEnvContext): void {
  ctx = context;
}

export function getCtx(): PythonEnvContext {
  return ctx;
}
```

### services/PythonEnvironmentService.ts

无状态用例 Service 使用构造函数依赖，不持有第二份 Python 发现缓存：

```typescript
export class PythonEnvironmentService {
  constructor(
    private readonly dependencies: PythonEnvironmentDependencies,
  ) {}

  check(): Promise<EnvCheckResult> {
    return this.dependencies.checkEnvironment();
  }
}
```

### main.ts 的组装流程

```typescript
app.whenReady().then(() => {
  initPythonEnv({
    appRoot,
    sendProgress,
    getConfiguredPythonPath: () =>
      guiConfigurationService.configuredPythonPath(),
    getUpdateMode: () => guiConfigurationService.updateMode(),
    getBackendStartupMode: () =>
      guiConfigurationService.backendStartupMode(),
    getBackendRepoPath: () =>
      guiConfigurationService.backendRepoPath(),
    getTempDir: () => app.getPath('temp'),
  });
  initBackend({
    appRoot,
    userDataRoot,
    resourceRoot,
    BACKEND_PORT,
    getMainWindow: () => mainWindow,
  });

  // 初始化用户目录、执行迁移、注册更新 IPC。
  createWindow();
});
```

### ipc/ 薄适配器

IPC 文件只处理通道和错误边界，实际行为由注入依赖负责：

```typescript
registerBackendIpc(ipcMain, {
  getBackendProcess,
  startBackend,
  runSetupScript,
});

registerEnvironmentIpc(
  ipcMain,
  pythonEnvironmentService,
);
```

---

## emulatorDetect.ts — 零依赖纯函数

最简单的提取案例：模拟器检测逻辑完全独立，不需要任何 Context：

```typescript
// electron/emulatorDetect.ts

export interface EmulatorDetectResult {
  type: string;
  path: string;
  serial: string;
  adbPath: string;
}

export function detectEmulator(): EmulatorDetectResult[] { /* ... */ }
```

---

## pythonEnv/ — barrel re-export

提取多个文件后，外部导入路径保持不变：

```typescript
// electron/pythonEnv/index.ts

export { initPythonEnv, clearPythonCache } from './context';
export { findPython } from './finder';
export { checkEnvironment } from './envCheck';
export { installPortablePython, installDependencies } from './installer';
export { autoUpdateAutowsgr } from './updater';
```

`main.ts` 中的 `import { findPython } from './pythonEnv'` 无需改动。

---

## 要点

| 规则 | 说明 |
|------|------|
| `main.ts` 只做三件事 | 创建窗口、注册 IPC、管理生命周期 |
| 子模块通过 `init()` 接收上下文 | 不直接 import main.ts 的全局变量 |
| 纯函数优先 | 如 `emulatorDetect.ts`，不需要上下文就不用 |
| barrel re-export | 外部导入路径不变，内部自由拆分 |
