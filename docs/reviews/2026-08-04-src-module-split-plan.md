# `src` TypeScript 模块拆分方案

## 1. 范围和结论

本方案覆盖 `src/` 下现有的 77 个 TypeScript 文件：

| 目录 | 文件数 |
|---|---:|
| `controller` | 35 |
| `view` | 22 |
| `model` | 13 |
| `types` | 5 |
| `data` | 1 |
| `utils` | 1 |

拆分不以行数为唯一标准。只有出现以下情况才拆：

1. 一个文件包含多个独立变化原因。
2. View、Controller、Model 之间发生越层调用。
3. YAML、JSON、IPC、HTTP、WebSocket 或 `localStorage` 没有明确适配边界。
4. 多个界面重复实现同一套舰船筛选、拖拽或规则转换。
5. 可以提取纯策略，同时不产生第二份可写状态。

本次只调整 Renderer 的模块边界，不改变 IPC channel、HTTP API、YAML 格式、
任务队列行为、candidate-only 语义和用户数据目录。

## 2. 目标边界

```text
View
  只持有 DOM 引用、渲染 ViewObject、发出用户操作回调
  不直接调用 electronBridge、localStorage、js-yaml 或 Model

Controller
  持有页面/用例状态，协调 View、Model 和 Repository
  不直接解析 YAML，不使用 any 绕过 Host/Port 契约

Model
  持有领域状态和纯业务规则
  不直接访问 window、document、electronBridge 或 localStorage

Adapter
  负责 IPC、REST、WebSocket、YAML、JSON 和浏览器存储
  对 Controller/Model 暴露最小接口
```

状态所有权保持不变：

| 状态 | 唯一所有者 |
|---|---|
| 当前任务、调度状态 | `Scheduler` |
| 就绪队列、延迟重试队列 | `TaskQueue` |
| Cron 定时器和 pending 标记 | `CronScheduler` |
| 泡澡舰船集合 | `RepairManager` |
| 当前作战方案 | `PlanController` |
| 舰队编辑草稿 | `FleetPlannerController` + 单个 `FleetDraft` |
| 决战舰队草稿 | `DecisivePlanController` + 单个 `DecisiveFleetDraft` |

## 3. 目标目录

只列新增或需要重组的关键模块；未列出的保留文件继续位于原目录。

```text
src/
├─ adapter/
│  ├─ api/
│  │  ├─ HttpTransport.ts
│  │  ├─ WebSocketTransport.ts
│  │  └─ CombatPlanRequestMapper.ts
│  ├─ ipc/
│  │  ├─ ConfigRepository.ts
│  │  ├─ ManagedPlanRepository.ts
│  │  ├─ MapDataRepository.ts
│  │  ├─ ShipLibraryRepository.ts
│  │  ├─ TaskGroupRepository.ts
│  │  └─ TemplateRepository.ts
│  ├─ storage/
│  │  ├─ CronStateStore.ts
│  │  ├─ RepairStateStore.ts
│  │  └─ UiPreferencesStore.ts
│  ├─ json/
│  │  ├─ TaskGroupJsonCodec.ts
│  │  └─ TemplateJsonCodec.ts
│  └─ yaml/
│     ├─ ConfigYamlCodec.ts
│     ├─ PlanMetadataReader.ts
│     └─ PlanYamlCodec.ts
├─ controller/
│  ├─ app/
│  │  ├─ DeviceController.ts
│  │  ├─ EnvironmentSetupController.ts
│  │  ├─ HeartbeatController.ts
│  │  ├─ NavigationController.ts
│  │  ├─ OperationsController.ts
│  │  ├─ ShipLibraryController.ts
│  │  ├─ UpdateController.ts
│  │  ├─ RuntimeLogPresenter.ts
│  │  └─ CronTaskController.ts
│  ├─ plan/
│  │  ├─ DecisivePlanController.ts
│  │  ├─ FleetPlannerController.ts
│  │  ├─ FleetPresetController.ts
│  │  ├─ ManagedBattlePlanPickerController.ts
│  │  ├─ PlanExecutionController.ts
│  │  └─ PlanPersistenceController.ts
│  ├─ taskGroup/queue/
│  │  ├─ ManagedPlanTaskLoader.ts
│  │  ├─ TaskGroupTaskLoader.ts
│  │  └─ TemplateTaskLoader.ts
│  └─ template/
│     └─ TemplateWizardController.ts
├─ model/
│  ├─ config/ConfigDefaults.ts
│  ├─ fleet/
│  │  ├─ DecisiveFleetDraft.ts
│  │  ├─ FleetDraft.ts
│  │  ├─ FleetResolver.ts
│  │  ├─ FleetRuleMapper.ts
│  │  ├─ ShipMatcher.ts
│  │  ├─ ShipNameNormalizer.ts
│  │  └─ TeamPlanQuery.ts
│  └─ scheduler/
│     ├─ CronTriggerPolicy.ts
│     ├─ FleetPresetApplicator.ts
│     ├─ FollowUpTaskFactory.ts
│     ├─ RepairPolicy.ts
│     ├─ TaskRequestFactory.ts
│     └─ TaskResultPolicy.ts
├─ view/
│  ├─ config/
│  │  ├─ ConfigFormView.ts
│  │  └─ EnvironmentSettingsView.ts
│  ├─ plan/
│  │  ├─ BattlePlanPickerView.ts
│  │  ├─ PlanFormView.ts
│  │  ├─ decisive/DecisiveFleetView.ts
│  │  └─ fleetPlanner/
│  │     ├─ BackupCopyDialog.ts
│  │     ├─ FleetEditorView.ts
│  │     ├─ FleetRuleEditorView.ts
│  │     ├─ PlanManagementView.ts
│  │     └─ TeamPlanPickerView.ts
│  ├─ shared/
│  │  ├─ ShipArtwork.ts
│  │  ├─ ShipGalleryView.ts
│  │  └─ TeamPlanCard.ts
│  └─ taskGroup/
│     ├─ TaskContextMenuView.ts
│     └─ TaskListLoaderView.ts
└─ types/
   ├─ api/{common,game,system,task,websocket,index}.ts
   ├─ ipc/{configuration,device,environment,plans,shipLibrary,index}.ts
   ├─ model/{config,plan,repair,template,index}.ts
   └─ view/{config,main,plan,setup,template,index}.ts
```

## 4. Controller 逐文件映射

| 现有文件 | 处理 | 目标 |
|---|---|---|
| `controller/app/AppController.ts` | 拆分 | 只保留组合、初始化和销毁；导航、常用操作、ADB、舰船库、更新、心跳分别进入 6 个子控制器 |
| `controller/app/ConfigController.ts` | 拆分 | 保留配置用例协调；环境检测/向导进入 `EnvironmentSetupController`，IPC 和偏好读写进入 Repository/Store |
| `controller/app/SchedulerBinder.ts` | 内部拆分 | 保留文档规定的 Binder facade；日志/进度解析进入 `RuntimeLogPresenter`，Cron 任务装载进入 `CronTaskController` |
| `controller/app/constants.ts` | 保留并清理 | 保留优先级和状态文案；删除无引用的 `resolveRepairModeLabel()` |
| `controller/app/index.ts` | 保留 | 更新聚合导出 |
| `controller/app/rendering.ts` | 保留 | 继续作为纯 ViewObject 构造模块 |
| `controller/app/theme.ts` | 保留并注入 | DOM 主题应用保留，`localStorage` 改由 `UiPreferencesStore` 提供 |
| `controller/plan/PlanController.ts` | 拆分 | 保留当前方案状态；选择弹窗、持久化、执行分别进入三个控制器 |
| `controller/plan/index.ts` | 保留 | 更新聚合导出 |
| `controller/plan/nodeEditor.ts` | 保留 | 节点编辑用例集中，无需再拆 |
| `controller/plan/presetFlow.ts` | 保留并收口 | 保留预设用例；API DTO 转换迁到 `CombatPlanRequestMapper` |
| `controller/plan/rendering.ts` | 保留 | 继续作为纯 ViewObject mapper |
| `controller/plan/selectedNodes.ts` | 保留 | 单一纯规则 |
| `controller/shared/ControllerHost.ts` | 删除确认 | 当前只有 barrel 导出、无实际使用；各控制器继续使用最小 Host |
| `controller/shared/DialogHelper.ts` | 保留 | 集中的对话框适配层 |
| `controller/shared/index.ts` | 保留并清理 | 删除 `ControllerHost` 导出 |
| `controller/startup/StartupController.ts` | 保留并清理 | 保留启动编排；删除无调用的 `runSetupScript()` 代理后再验证 |
| `controller/startup/connection.ts` | 保留 | 后端连接启动流程集中 |
| `controller/startup/envAndUpdates.ts` | 拆分后删除 | 拆为 `environmentBootstrap.ts` 和 `updateStartup.ts` |
| `controller/startup/index.ts` | 保留 | 更新聚合导出 |
| `controller/taskGroup/TaskListLoaderController.ts` | 拆分 | Controller 只持有选择/草稿；DOM 渲染和拖拽进入 `TaskListLoaderView` |
| `controller/taskGroup/TaskGroupController.ts` | 保留并瘦身 | 继续协调任务组；固定 DOM 事件迁到 View 回调 |
| `controller/taskGroup/addItems.ts` | 保留并收口 | 保留添加条目用例；删除无引用的 `addFileToGroup()`，文件/YAML 处理走 Adapter |
| `controller/taskGroup/contextMenu.ts` | 拆分 | 编辑动作保留；菜单 DOM 进入 `TaskContextMenuView` |
| `controller/taskGroup/importExport.ts` | 删除确认 | 当前无调用方；若产品仍需要导入导出，先恢复入口并改走 Repository |
| `controller/taskGroup/index.ts` | 保留 | 更新聚合导出 |
| `controller/taskGroup/managedPlanReader.ts` | 迁出后删除 | 读取职责进入 `ManagedPlanRepository` |
| `controller/taskGroup/metaLoader.ts` | 保留并收口 | 保留批量元数据编排；解析交给 `PlanMetadataReader` |
| `controller/taskGroup/queueLoader.ts` | 拆分后删除 | 请求构造进 `TaskRequestFactory`；按 managed/group/template 拆成三个 Loader |
| `controller/template/TemplateController.ts` | 拆分 | 保留模板页协调；向导状态和事件进入 `TemplateWizardController`，不再直接 IPC/YAML |
| `controller/template/crud.ts` | 保留并收口 | 保留 CRUD 用例，持久化交给 `TemplateRepository` |
| `controller/template/index.ts` | 保留 | 更新聚合导出 |
| `controller/template/selectors.ts` | 保留并收口 | 保留选择用例，使用强类型和 `PlanMetadataReader`，移除 `any`/直接 YAML |
| `controller/template/useTemplate.ts` | 保留 | 用例单一 |
| `controller/template/wizard.ts` | 保留并改契约 | 保留步骤规则；用明确状态接口替代 `as any` ref-wrapper |

## 5. View 逐文件映射

| 现有文件 | 处理 | 目标 |
|---|---|---|
| `view/config/ConfigView.ts` | 拆分 | facade + `ConfigFormView` + `EnvironmentSettingsView`；YAML 只作为原始文本上交 Controller |
| `view/main/FleetPreviewView.ts` | 保留并注入 | 由 Controller 传入舰船库 manifest，移除直接 IPC |
| `view/main/LogView.ts` | 保留 | 日志渲染职责集中 |
| `view/main/MainView.ts` | 保留 | 继续作为主页面 facade |
| `view/main/StatusBar.ts` | 保留 | 状态栏职责集中 |
| `view/main/TaskQueueView.ts` | 保留 | 队列渲染和拖拽回调集中 |
| `view/plan/DecisivePlanView.ts` | 拆分 | facade + `DecisiveFleetView` + 共享 `ShipGalleryView`；保存/加载进入 Controller |
| `view/plan/FleetEditDialog.ts` | 保留并提取规则 | 对话框保留，舰种匹配和推荐候选进入 `ShipMatcher` |
| `view/plan/FleetPlannerView.ts` | 重点拆分 | facade + 舰队编辑、规则编辑、编队选择、备选复制、计划管理五个子 View；状态和 IPC 全部移出 |
| `view/plan/FleetPresetView.ts` | 拆分职责 | 文件保留为纯渲染；加载、转换、绑定修改进入 `FleetPresetController` |
| `view/plan/MapView.ts` | 保留 | 地图渲染职责集中 |
| `view/plan/NodeEditorView.ts` | 保留 | 节点编辑表单职责集中 |
| `view/plan/PlanPreviewView.ts` | 保留 facade 并拆分 | 继续组合三个子 View；通用方案字段表单进入 `PlanFormView` |
| `view/plan/ShipArtwork.ts` | 移动 | 移到 `view/shared/ShipArtwork.ts`，因为主页面和计划页共同使用 |
| `view/plan/TeamPlanListUi.ts` | 拆分后删除 | 查询/排序进 `TeamPlanQuery`，卡片 DOM 进 `view/shared/TeamPlanCard.ts` |
| `view/setup/SetupWizardView.ts` | 保留 | 向导渲染职责集中 |
| `view/shared/ShipAutocomplete.ts` | 保留 | 通用自动补全组件 |
| `view/shared/scrollPosition.ts` | 保留 | 通用纯 DOM 工具 |
| `view/taskGroup/TaskGroupView.ts` | 保留 | 任务组面板渲染职责集中 |
| `view/template/SelectorDialog.ts` | 保留 | 通用选择弹窗 |
| `view/template/TemplateLibraryView.ts` | 保留 | 模板列表渲染职责集中 |
| `view/template/TemplateWizardView.ts` | 保留并收口 | 继续负责向导 DOM；固定事件通过回调交给 Controller |

## 6. Model、Types、Data、Utils 逐文件映射

| 现有文件 | 处理 | 目标 |
|---|---|---|
| `model/ApiClient.ts` | 拆分 | 保留业务 API facade；REST 和 WebSocket 进入两个 Transport |
| `model/ConfigModel.ts` | 拆分 | 保留配置状态/更新；默认值、迁移和 YAML codec 分离 |
| `model/MapDataLoader.ts` | 注入式拆分 | 保留缓存和地图查询；文件读取进入 `MapDataRepository`，地图类型进入 model types |
| `model/PlanModel.ts` | 拆分 | 保留方案状态和节点规则；YAML 解析、未知字段合并和序列化进入 `PlanYamlCodec` |
| `model/TaskGroupModel.ts` | 拆分 | 保留任务组权威状态/CRUD；JSON 迁移与 IPC 持久化分别进入 Codec/Repository |
| `model/TemplateModel.ts` | 拆分 | 保留模板 CRUD；JSON 校验/迁移和文件读写进入 Codec/Repository |
| `model/scheduler/CronScheduler.ts` | 策略/存储提取 | 保留定时器和 pending 状态；时间规则与 `localStorage` 分离 |
| `model/scheduler/ExpeditionTimer.ts` | 保留 | 单一定时职责 |
| `model/scheduler/RepairManager.ts` | 策略/存储提取 | 保留 `bathingShips`；阈值判断与持久化分离 |
| `model/scheduler/Scheduler.ts` | 提取纯策略 | 保留 `currentTask/status`、消费和 API 回调；结果判断、后触发构造提取 |
| `model/scheduler/StopConditionChecker.ts` | 保留 | 停止条件职责集中 |
| `model/scheduler/TaskQueue.ts` | 小范围提取 | 保留就绪/延迟队列；编队请求修改进入 `FleetPresetApplicator` |
| `model/scheduler/index.ts` | 保留 | 继续作为调度系统公共出口 |
| `types/api.ts` | 拆分后改为兼容出口 | 拆成 common/system/game/task/websocket，迁移完成后删除旧文件 |
| `types/electronBridge.ts` | 拆分后改为兼容出口 | 按 IPC capability 拆成 environment/shipLibrary/plans/device/configuration |
| `types/model.ts` | 拆分后改为兼容出口 | 拆成 plan/config/template/repair |
| `types/scheduler.ts` | 保留 | 调度类型内聚且规模合理 |
| `types/view.ts` | 拆分后改为兼容出口 | 按 main/plan/config/template/setup 拆分 |
| `data/shipData.ts` | 拆分后删除 facade | 静态目录、名称规范化、匹配、解析、API rule mapper、显示标签分别归位 |
| `utils/Logger.ts` | 保留 | 日志格式、级别和输出职责集中 |

## 7. 重点模块的实际拆法

### 7.1 `FleetPlannerView.ts`

不能只把 3482 行机械切成几个类。正确顺序是：

1. 先建立 `FleetDraft`，集中主选、备选、规则和拖拽变换。
2. 提取共享 `ShipGalleryView`，由 Controller 提供过滤后的舰船和选择回调。
3. 提取 `FleetEditorView`、`FleetRuleEditorView`。
4. 提取 `TeamPlanPickerView`、`BackupCopyDialog`。
5. 最后提取 `PlanManagementView` 和 Repository 调用。
6. 原文件只作为 facade，目标控制在约 200 至 300 行。

`FleetDraft` 必须保留 candidate-only：没有明确 `name` 的槽位不能把第一个
candidate 提升为主选。

### 7.2 `Scheduler.ts`

不把执行流程拆成多个可写对象。只提取纯函数：

- `TaskResultPolicy`：战果等级、终点和完成轮次判断。
- `FollowUpTaskFactory`：后触发任务复制。
- `FleetPresetApplicator`：向请求写入编队和 `fleet_rules`。

`consumeNext()`、重试时序、`currentTask` 和状态切换继续留在 `Scheduler`。

### 7.3 `PlanModel.ts` 和 `ConfigModel.ts`

Model 不再直接依赖 `js-yaml`，但兼容期保留原公共方法：

```typescript
PlanModel.fromYaml(content)
plan.toYaml()
config.loadFromYaml(content)
config.toYaml()
```

这些方法先委托新 Codec，调用方迁移完成后再决定是否移除。这样每一步都能
独立回滚，并保持 YAML 未知字段、头部注释和旧字段迁移行为。

## 8. 实施阶段

### 阶段 0：行为基线

- 固化 77 个文件清单和依赖扫描。
- 为 YAML round-trip、candidate-only、队列优先级/重试、Cron 状态恢复、
  泡澡状态恢复补最小特征测试。
- 当前工作区改动较多，实施应在这些改动稳定后从目标分支创建独立分支或 worktree。

### 阶段 1：Types 拆分

- 只拆 `types/api.ts`、`types/electronBridge.ts`、`types/model.ts`、`types/view.ts`。
- 旧文件暂时 re-export，调用方分批改 import。
- 不改运行时代码。

### 阶段 2：Adapter 边界

- 引入 YAML/JSON Codec、IPC Repository、Storage Store 和 API Transport。
- 现有 Model/Controller API 暂时不变，内部改为委托或注入。
- 完成后 `src/model` 和 `src/view` 中不再出现 `window.electronBridge`。

### 阶段 3：Model 和共享领域规则

- 拆 `PlanModel`、`ConfigModel`、`TaskGroupModel`、`TemplateModel`、`shipData`。
- 提取 Scheduler/Cron/Repair 的纯策略，不转移可写状态。
- 建立共享 `FleetDraft`、`DecisiveFleetDraft`、`ShipMatcher`、`FleetRuleMapper`。

### 阶段 4：Controller

- 先拆 `AppController` 和 `SchedulerBinder`。
- 再拆 `PlanController`、`queueLoader`、`TaskListLoaderController`。
- 最后处理 Template 和 Startup。
- 每个子控制器只接收最小 Host/Port，不传整个 `AppController`。

### 阶段 5：View

- 先移除 View 中 IPC/YAML/localStorage。
- 再提取共享 `ShipGalleryView` 和 `ShipArtwork`。
- 按 FleetPlanner 编辑、选择、管理三个独立提交拆分。
- 再复用共享组件拆 `DecisivePlanView` 和 `FleetPresetView`。
- 最后拆 `ConfigView` 和 `PlanPreviewView` 的表单子 View。

### 阶段 6：清理

- 删除兼容出口、无引用文件和无引用导出。
- 更新架构文档及模块依赖图。
- 最终确认 `AppController` 仍是唯一 Renderer 组合根。

## 9. 每阶段验收

每个提交至少执行：

```powershell
npm run build
npm run test:api-contract
git diff --check
```

按改动范围追加：

```powershell
npm run test:task-group-migration
npm run test:legacy-plan
npm run test:settings
npm run test:main-services
npm run test:main-ipc
```

最终静态边界检查：

```powershell
rg -n "window\.electronBridge|\(window as any\)" src/model src/view
rg -n "localStorage" src/model src/view
rg -n "js-yaml|yaml\.load|yaml\.dump" src/controller src/model src/view
rg -n "\bas any\b" src/controller src/model
```

预期前 3 条无结果；`as any` 只允许有明确注释的第三方边界，业务代码无结果。

最终手工回归：

1. 启动、ADB 连接、心跳和后端停止。
2. 配置加载/保存、外部 Python、CUDA/OCR、更新检查。
3. 作战方案加载、修改、保存、执行和 candidate-only 请求。
4. 编队创建、备选拖拽、覆盖确认、计划管理和批量导出。
5. 任务组保存、加载、排序、单项/整组入队和旧数据迁移。
6. Cron、重试、停止条件、泡澡轮换和远征任务。
7. 模板创建、编辑、导入和加入任务组。

## 10. 明确不做

- 不在拆分提交中修改 IPC channel、接口字段或用户文件格式。
- 不同时重写 UI 样式。
- 不把 `Scheduler`、`CronScheduler`、`RepairManager` 的状态复制到新对象。
- 不以“文件超过多少行”为理由继续细拆单一职责文件。
- 不在当前脏工作区直接进行全目录搬迁。
