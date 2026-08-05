# 05 — View 层组织

> **前置阅读**：[03-viewobject-flow](03-viewobject-flow.md)  
> **核心原则**：View 按功能页面分子目录；复杂视图用 Facade 模式对外暴露统一 API；View 层零 Model 依赖。

---

## 目录结构

```
src/view/
├── main/                    # 主页面
│   ├── MainView.ts          (Facade)
│   ├── LogView.ts           (日志面板)
│   ├── TaskQueueView.ts     (任务队列)
│   ├── StatusBar.ts         (状态栏)
│   └── FleetPreviewView.ts  (当前舰队)
├── plan/                    # 方案预览
│   ├── PlanPreviewView.ts   (Facade)
│   ├── MapView.ts           (地图可视化)
│   ├── NodeEditorView.ts    (节点编辑器)
│   ├── FleetPresetView.ts   (编队预设)
│   ├── FleetPlannerView.ts  (舰队规划 Facade)
│   └── PlanManagementView.ts(计划管理)
├── migration/
│   └── MigrationConflictView.ts (迁移冲突)
├── template/                # 模板库
│   ├── TemplateWizardView.ts(向导)
│   ├── TemplateLibraryView.ts(库列表)
│   └── SelectorDialog.ts   (选择器对话框)
├── config/
│   └── ConfigView.ts        (配置页)
├── setup/
│   └── SetupWizardView.ts   (首次配置向导)
├── taskGroup/
│   └── TaskGroupView.ts     (任务组面板)
└── shared/
    ├── AnimatedSelect.ts    (统一下拉框)
    ├── DialogHelper.ts      (通用对话框)
    ├── scrollPosition.ts    (滚动位置)
    └── ShipAutocomplete.ts  (舰船自动补全)
```

---

## Facade 模式：MainView

`MainView` 内部由 3 个子视图组成，但 Controller 只看到一个统一入口：

```typescript
// src/view/main/MainView.ts

export class MainView {
  private logView: LogView;
  private taskQueueView: TaskQueueView;
  private statusBar: StatusBar;
  private fleetPreviewView: FleetPreviewView;

  constructor() {
    this.logView = new LogView();
    this.taskQueueView = new TaskQueueView();
    this.statusBar = new StatusBar();
    this.fleetPreviewView = new FleetPreviewView();
  }

  // ── 渲染：Controller 只调这一个方法 ──
  render(vo: MainViewObject): void {
    this.statusBar.render(vo);
    this.taskQueueView.render(vo);
    this.fleetPreviewView.render(
      vo.currentFleet,
      vo.currentTask !== null,
      vo.dailySortieStats,
    );
  }

  appendLog(entry: LogEntryVO): void {
    this.logView.appendLog(entry);
  }

  // ── 回调转发：用 setter 传递给内部子视图 ──
  set onRemoveQueueItem(fn: ((taskId: string) => void) | undefined) {
    this.taskQueueView.onRemoveQueueItem = fn;
  }
  set onMoveQueueItem(fn: ((from: number, to: number) => void) | undefined) {
    this.taskQueueView.onMoveQueueItem = fn;
  }
}
```

Controller 的使用方式：

```typescript
// AppController 中
this.mainView.render(vo);           // 不需要知道内部有几个子视图
this.mainView.appendLog(logEntry);
this.mainView.onRemoveQueueItem = (id) => this.scheduler.removeTask(id);
```

---

## Facade 模式：PlanPreviewView

同样的模式用在方案预览页：

```typescript
// src/view/plan/PlanPreviewView.ts

export class PlanPreviewView {
  private mapView: MapView;
  private nodeEditor: NodeEditorView;
  private fleetPresetView: FleetPresetView;

  render(vo: PlanPreviewViewObject | null): void {
    // 统一渲染，内部协调三个子视图
  }

  renderFleetPresets(vo: PlanFleetPresetSelectorViewObject): void {
    // 只接收 Controller 生成的只读目录和绑定快照
  }
}
```

---

## Facade 的价值

| 不用 Facade | 用 Facade |
|-------------|-----------|
| Controller 要知道 `LogView` / `TaskQueueView` / `StatusBar` | Controller 只知道 `MainView` |
| 新增子视图需改 Controller | 新增子视图只改 `MainView` 内部 |
| Controller import 列表膨胀 | 只 import 一个 Facade |

---

## 共享组件

跨多个视图复用的 UI 组件放在 `shared/`：

```
src/view/shared/
├── AnimatedSelect.ts      (统一动画下拉框)
├── DialogHelper.ts        (确认、提示、输入和保存成功提示)
├── scrollPosition.ts      (动态列表滚动位置)
└── ShipAutocomplete.ts    (舰船名自动补全输入框)
```

舰队规划、模板向导和受管计划选择器复用这些组件，不各自实现对话框、
滚动恢复或舰船检索。

---

View 可以导入：

- `../../types/view` 和其他 `types/*` 中的只读类型。
- `../../shared/*` 中不访问持久化状态的纯契约或纯函数。
- `../shared/*` 中的共享 UI 组件。
- 同目录的子视图。
- `../shared/*` — 共享 UI 组件
View **禁止**：


- `../../adapter/*`
- `../../controller/*`
- Repository 或 Electron bridge
- 文件读写、业务关系推导和可写领域状态

View 只接收 Controller 生成的 ViewObject，并通过回调发送明确用户意图。例如
`FleetEditorView` 发送 `FleetDraftEditIntent`，`PlanManagementView` 发送导出、
重命名和删除意图；实际修改由 Controller 和 Repository 完成。
- `../../types/model`
这通过依赖扫描和类型系统共同保障，详见
[03-viewobject-flow](03-viewobject-flow.md) 与 [07-type-system](07-type-system.md)。
