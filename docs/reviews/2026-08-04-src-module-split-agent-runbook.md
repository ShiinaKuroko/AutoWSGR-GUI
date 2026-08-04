# `src` TypeScript 模块拆分 Agent 执行任务书

## 1. 文档用途

本文件把 [`src` TypeScript 模块拆分方案](./2026-08-04-src-module-split-plan.md)
转换为可以逐项派发给编码 Agent 的执行队列。

两份文档的职责不同：

- 原方案说明为什么拆、最终边界和 77 个现有模块的去向。
- 本任务书规定谁先做什么、允许修改什么、如何验证和何时停止。

本任务书是完整架构治理队列，不是一次性最小修改。每个任务必须作为独立、
可验证、可回滚的行为单元完成。禁止一个 Agent 一次领取多个任务。

## 2. 队列启用门槛

队列管理员必须先填写：

```text
BASE_SHA=<待填写：当前全部已接受改动提交后的 commit SHA>
QUEUE_BRANCH=<待填写：例如 refactor/src-module-split>
CURRENT_TASK=A00
PATCH_LEVEL=L0
```

`BASE_SHA` 未填写时，任何 Agent 都不得修改代码。

当前共享工作树存在大量未提交改动，不能直接作为执行起点。管理员必须先：

1. 确认这些改动由谁负责。
2. 完成提交、备份或独立 worktree 隔离。
3. 记录队列基线 SHA。
4. 在干净 worktree 中执行 `git status --short --branch`。
5. 运行 A00，得到可复现的基线验证结果。

不得通过 `git reset --hard`、`git checkout --`、强制清理或 stash 他人改动来
制造“干净基线”。

## 3. Agent 通用执行协议

### 3.1 接单

Agent 只能接收一个任务 ID，例如 `D04`。接单后必须先完整读取：

1. `AGENTS.md`
2. `docs/engineering-standards.md`
3. `.editorconfig`
4. `.gitattributes`
5. `tsconfig.json`
6. `package.json`
7. `CONTRIBUTING.md`
8. 原拆分方案
9. 本任务书
10. 任务卡指定的架构文档和现有测试

### 3.2 修改前报告

Agent 在写代码前必须报告：

```text
任务 ID：
基线 SHA：
当前分支/worktree：
行为目标：
非目标：
允许修改的主要文件：
状态所有者：
当前数据流：
预期数据流：
Patch 等级：
计划执行的验证：
```

没有完成该报告，不得开始写代码。

### 3.3 修改范围

- 只修改任务卡的“主要范围”。
- 可以修改直接 import、barrel export、对应测试和对应架构文档。
- 需要进入未列出的业务模块时，立即停止并报告范围扩散。
- 不修改 IPC channel、API 字段、YAML/JSON 公共格式和用户目录。
- 不修改 UI 样式，除非任务卡明确允许。
- 不进行无关格式化、依赖升级、资源更新或命名清理。
- 不使用 `any`、类型断言、retry、sleep、fallback 或第二状态源绕过问题。

### 3.4 兼容迁移

拆文件时采用以下顺序：

1. 增加目标模块和最小接口。
2. 将现有逻辑原样迁入，先保持行为。
3. 原公共入口暂时改为 facade 或 re-export。
4. 修改调用方。
5. 运行验证。
6. 只有 F01 可以删除跨任务兼容出口。

禁止在同一个任务中一边迁移结构，一边修改业务语义。

### 3.5 每个任务的通用验证

所有 TypeScript 任务至少执行：

```powershell
npm run build
npm run test:api-contract
git diff --check
git status --short
```

`npm run build` 会生成 CSS/构建输出。没有样式变化时，不得把生成差异作为任务
成果提交。

任务卡列出的专项测试必须全部执行。无法执行时，任务不得标记完成，交付记录
必须写明阻塞原因和未验证风险。

### 3.6 强制停止条件

出现任一情况，Agent 必须停止，不得继续补代码：

1. 当前工作树包含无法确认归属的修改。
2. 任务需要修改另一个未解锁任务的核心文件。
3. 需要新增第二份可写状态、同步标志、延时或 fallback。
4. 两次实现尝试仍未通过同一验证。
5. 旧测试与架构文档对当前行为给出冲突结论。
6. 无法证明 candidate-only、YAML 未知字段或任务生命周期保持不变。
7. 需要改变 IPC、API 或持久化格式才能完成结构拆分。

## 4. 状态所有权不变量

所有任务都必须遵守：

| 状态 | 唯一可写所有者 | 禁止行为 |
|---|---|---|
| 当前任务、运行状态 | `Scheduler` | 子策略保存镜像状态 |
| 就绪队列、延迟重试 | `TaskQueue` | Controller 保存第二份任务队列 |
| Cron 定时器、pending | `CronScheduler` | Store 决定触发行为 |
| 泡澡舰船集合 | `RepairManager` | View/Controller 维护影子集合 |
| 当前作战方案 | `PlanController` | 子 View 持有可独立修改副本 |
| 舰队编辑草稿 | 单个 `FleetDraft` | 多个子 View 各自保存草稿 |
| 决战舰队草稿 | 单个 `DecisiveFleetDraft` | 复用普通草稿后再加补偿字段 |

以下外部语义不得改变：

- 纯候选舰船槽位不得自动生成顶层 `name`。
- `candidates` 中每项仍必须有 `name`。
- YAML 未知字段、头部注释和旧字段迁移行为保持。
- 队列优先级、延迟重试、后触发和停止条件时序保持。
- IPC channel、参数、返回值和错误文本保持。
- REST/WebSocket 路径、请求和回调顺序保持。

## 5. 推荐执行顺序

严格串行时按照下列顺序执行：

```text
A00
→ A01 → A02
→ B01 → B02 → B03 → B04
→ C01 → C02 → C03 → C04
→ D01 → D02 → D03 → D04 → D05 → D06 → D07
→ E01 → E02 → E03 → E04 → E05 → E06
→ F01
```

即使依赖允许并行，也建议先串行。确需并行时，只允许队列管理员批准，并为每个
任务创建独立 worktree。涉及同一个现有文件的任务不得并行。

## 6. 队列总表

| ID | 任务 | 前置任务 | 主要状态 |
|---|---|---|---|
| A00 | 固定行为基线 | 基线 SHA | 阻塞，等待基线 |
| A01 | 拆 API/IPC Types | A00 | 未开始 |
| A02 | 拆 Model/View Types | A01 | 未开始 |
| B01 | 提取 Plan/Config YAML Codec | A02 | 未开始 |
| B02 | 提取 TaskGroup/Template JSON Codec | B01 | 未开始 |
| B03 | 提取 Renderer Repository/Store | B02 | 未开始 |
| B04 | 拆 ApiClient Transport | B03 | 未开始 |
| C01 | 收口 PlanModel/ConfigModel | B01、B03 | 未开始 |
| C02 | 收口 TaskGroupModel/TemplateModel | B02、B03 | 未开始 |
| C03 | 拆分 shipData 和舰队领域规则 | A02、C01 | 未开始 |
| C04 | 提取调度纯策略和状态 Store | B03、C03 | 未开始 |
| D01 | 拆 ConfigController | C01、B03 | 未开始 |
| D02 | 拆 AppController | D01、B04 | 未开始 |
| D03 | 收口 SchedulerBinder | C04、D02 | 未开始 |
| D04 | 拆 PlanController | C01、C03、B03 | 未开始 |
| D05 | 拆 TaskGroup/Queue Loader Controller | C02、C04 | 未开始 |
| D06 | 拆 TemplateController | C02、B03 | 未开始 |
| D07 | 拆 Startup 环境/更新编排 | D01、D02、B03 | 未开始 |
| E01 | 提取共享舰船 View | C03 | 未开始 |
| E02 | 拆 TaskListLoader/ContextMenu View | D05 | 未开始 |
| E03 | 拆 FleetPlanner 编辑核心 | D04、E01 | 未开始 |
| E04 | 拆 FleetPlanner 选择和计划管理 | E03、B03 | 未开始 |
| E05 | 拆 DecisivePlan/FleetPreset View | D04、E01、E04 | 未开始 |
| E06 | 拆 Config/PlanPreview View | D01、D04 | 未开始 |
| F01 | 删除兼容层、死代码并同步文档 | A00-E06 | 未开始 |

## 7. 任务卡

### A00 固定行为基线

**目标**

在不修改 `src` 行为的前提下，记录拆分前可复现的行为基线。

**主要范围**

- `scripts/`
- `package.json` 中测试命令
- `docs/reviews/` 中基线记录

**必须覆盖**

- Plan/Config YAML 解析、序列化、未知字段和注释。
- candidate-only 经 `PlanModel → TaskQueue → API request` 后无顶层 `name`。
- TaskQueue 优先级、延迟任务、重试和预设切换。
- Cron 完成状态恢复。
- RepairManager 泡澡状态恢复。
- TaskGroup/Template 旧数据迁移。

**验收**

```powershell
npm run build
npm run test:legacy-config-upgrade
npm run test:legacy-plan
npm run test:task-group-migration
npm run test:api-contract
npm run test:settings
npm run test:main-services
npm run test:main-ipc
git diff --check
```

交付基线 SHA、每个命令结果和环境相关未验证项。测试失败时只记录证据，不在 A00
顺手修业务。

### A01 拆 API/IPC Types

**目标**

把 `types/api.ts`、`types/electronBridge.ts` 按通信领域拆开，不改变任何运行时代码。

**主要范围**

- `src/types/api.ts`
- `src/types/electronBridge.ts`
- 新增 `src/types/api/`
- 新增 `src/types/ipc/`

**要求**

- 原文件保留为 re-export 兼容入口。
- ViewObject、领域类型、API DTO、IPC DTO 不混用。
- `FleetRuleReq.name` 继续可选，candidate 项的 `name` 继续必填。
- 不批量修改全项目 import。

**专项验收**

```powershell
npm run test:api-contract
```

### A02 拆 Model/View Types

**目标**

把 `types/model.ts`、`types/view.ts` 按领域拆开，保留兼容出口。

**主要范围**

- `src/types/model.ts`
- `src/types/view.ts`
- 新增 `src/types/model/`
- 新增 `src/types/view/`

**要求**

- `types/scheduler.ts` 不改。
- 不把默认值、迁移逻辑或 View 渲染逻辑移入 Types。
- 不批量修改调用方 import。

**专项验收**

```powershell
npm run test:legacy-plan
npm run test:settings
```

### B01 提取 Plan/Config YAML Codec

**目标**

让 Plan/Config 的 YAML 解析、序列化和迁移规则具有单一实现位置。

**主要范围**

- `src/model/PlanModel.ts`
- `src/model/ConfigModel.ts`
- 新增 `src/adapter/yaml/PlanYamlCodec.ts`
- 新增 `src/adapter/yaml/ConfigYamlCodec.ts`
- 对应测试

**要求**

- `PlanModel.fromYaml()`、`toYaml()` 等现有公共入口保持。
- 旧入口只委托 Codec，不复制解析规则。
- 保留未知字段、头部注释、活动图入口和旧字段迁移。
- 不修改方案保存目录和 IPC。

**专项验收**

```powershell
npm run test:legacy-config-upgrade
npm run test:legacy-plan
npm run test:api-contract
```

### B02 提取 TaskGroup/Template JSON Codec

**目标**

分离任务组和模板的 JSON 校验、版本迁移与领域 CRUD。

**主要范围**

- `src/model/TaskGroupModel.ts`
- `src/model/TemplateModel.ts`
- 新增 `src/adapter/json/TaskGroupJsonCodec.ts`
- 新增 `src/adapter/json/TemplateJsonCodec.ts`
- 对应 fixture 和测试

**要求**

- 迁移幂等。
- 未知字段保留。
- 旧数据读取失败时不覆盖原文件。
- 不改变模板 ID 和任务项索引语义。

**专项验收**

```powershell
npm run test:task-group-migration
npm run test:legacy-plan
```

### B03 提取 Renderer Repository/Store

**目标**

把 Renderer 中的 IPC 和 `localStorage` 访问封装成可注入端口。

**主要范围**

- 新增 `src/adapter/ipc/`
- 新增 `src/adapter/storage/`
- `src/model/MapDataLoader.ts`
- `src/model/TaskGroupModel.ts`
- `src/model/TemplateModel.ts`
- `src/controller/app/theme.ts`
- 直接依赖这些能力的最小调用方

**要求**

- Repository 使用 preload 已有的面向用例能力，不增加通用文件 IPC。
- Model 不再出现 `(window as any).electronBridge`。
- Store 只保存/读取状态，不决定 Cron 或修理业务行为。
- 不改变 storage key 和数据结构。

**专项验收**

```powershell
npm run test:task-group-migration
npm run test:settings
npm run test:main-ipc
```

### B04 拆 ApiClient Transport

**目标**

保留 `ApiClient` 业务 facade，分离 REST 和 WebSocket 连接实现。

**主要范围**

- `src/model/ApiClient.ts`
- 新增 `src/adapter/api/HttpTransport.ts`
- 新增 `src/adapter/api/WebSocketTransport.ts`
- API 契约测试

**要求**

- 公共方法签名、路径、请求体、回调和重连时序保持。
- 不新增 fallback endpoint。
- WebSocket 不保存 Scheduler 状态。
- API DTO 继续使用 `src/types/api/`。

**专项验收**

```powershell
npm run test:api-contract
```

需要为 Transport 增加确定性测试；只有现有 API fixture 不足以验证 WebSocket 时序。

### C01 收口 PlanModel/ConfigModel

**目标**

完成 Codec 接入后，让两个 Model 只保留领域状态、默认值和业务更新。

**主要范围**

- `src/model/PlanModel.ts`
- `src/model/ConfigModel.ts`
- 新增 `src/model/config/ConfigDefaults.ts`
- B01 Codec

**要求**

- 不删除兼容公共入口。
- 默认值只有一个来源。
- Config 保存后对 Scheduler/Cron 的同步仍由 Controller 编排。
- 不新增 YAML 规则。

**专项验收**

```powershell
npm run test:legacy-config-upgrade
npm run test:legacy-plan
npm run test:settings
```

### C02 收口 TaskGroupModel/TemplateModel

**目标**

Model 只持有领域集合和 CRUD，文件读写与格式迁移全部委托 Adapter。

**主要范围**

- `src/model/TaskGroupModel.ts`
- `src/model/TemplateModel.ts`
- B02 Codec
- B03 Repository

**要求**

- 每个集合只有一个可写实例。
- 不在 Controller/View 保存可独立修改副本。
- 删除 `window` 和 `as any` 依赖。

**专项验收**

```powershell
npm run test:task-group-migration
npm run test:legacy-plan
```

### C03 拆分 shipData 和舰队领域规则

**目标**

把静态目录、显示标签、匹配、名称归一化、舰队解析和 API rule mapping 分开。

**主要范围**

- `src/data/shipData.ts`
- 新增 `src/data/shipCatalog.ts`
- 新增 `src/model/fleet/ShipNameNormalizer.ts`
- 新增 `src/model/fleet/ShipMatcher.ts`
- 新增 `src/model/fleet/FleetResolver.ts`
- 新增 `src/model/fleet/FleetRuleMapper.ts`
- 相关显示标签模块

**要求**

- `shipData.ts` 暂时保留为兼容 re-export。
- candidate-only 规则只在 `FleetRuleMapper` 实现一次。
- 显示名和后端名转换保持。
- 舰种 whitelist 保持后端契约。

**专项验收**

```powershell
npm run test:api-contract
npm run test:legacy-plan
```

### C04 提取调度纯策略和状态 Store

**目标**

从 Scheduler、TaskQueue、CronScheduler、RepairManager 中只提取纯策略和持久化端口。

**主要范围**

- `src/model/scheduler/Scheduler.ts`
- `src/model/scheduler/TaskQueue.ts`
- `src/model/scheduler/CronScheduler.ts`
- `src/model/scheduler/RepairManager.ts`
- 新增 `TaskResultPolicy.ts`
- 新增 `FollowUpTaskFactory.ts`
- 新增 `FleetPresetApplicator.ts`
- 新增 `CronTriggerPolicy.ts`
- 新增 `RepairPolicy.ts`
- B03 中的 Cron/Repair Store

**要求**

- `Scheduler` 继续唯一持有 `currentTask/status`。
- `TaskQueue` 继续持有就绪和延迟任务。
- `CronScheduler` 继续持有 timer/pending。
- `RepairManager` 继续持有 `bathingShips`。
- 新模块必须是纯函数或无业务状态端口。

**专项验收**

新增调度契约测试并覆盖：

- 优先级稳定排序。
- 延迟任务恢复。
- 重试上限。
- 后触发副本。
- candidate-only 预设切换。
- Cron 重启补发。
- 泡澡状态恢复。

### D01 拆 ConfigController

**目标**

ConfigController 只协调配置加载/保存和 Model 同步。

**主要范围**

- `src/controller/app/ConfigController.ts`
- 新增 `EnvironmentSetupController.ts`
- B03 `ConfigRepository`/`UiPreferencesStore`
- 对应 Host 接口

**要求**

- 环境检测和向导进入独立控制器。
- 不通过 `(controller as any).host` 注入依赖。
- ConfigModel、Scheduler、CronScheduler 的更新顺序保持。
- 不改变 GUI 配置和 usersettings 路径。

**专项验收**

```powershell
npm run test:settings
npm run test:python-environment
```

### D02 拆 AppController

**目标**

让 AppController 只作为唯一组合根、全局协调器和生命周期入口。

**主要范围**

- `src/controller/app/AppController.ts`
- 新增 `NavigationController.ts`
- 新增 `OperationsController.ts`
- 新增 `DeviceController.ts`
- 新增 `ShipLibraryController.ts`
- 新增 `UpdateController.ts`
- 新增 `HeartbeatController.ts`
- `src/controller/app/index.ts`

**要求**

- 子控制器只接收最小 Host/Port。
- 子控制器之间不直接调用具体实现。
- 不创建新的全局状态或重复定时器。
- 启动顺序和销毁顺序保持。

**专项验收**

```powershell
npm run test:settings
npm run test:main-services
npm run test:main-ipc
npm run test:python-environment
```

### D03 收口 SchedulerBinder

**目标**

保留架构文档规定的 Binder facade，只迁出日志/进度解释和 Cron 任务构造。

**主要范围**

- `src/controller/app/SchedulerBinder.ts`
- 新增 `RuntimeLogPresenter.ts`
- 新增 `CronTaskController.ts`
- `src/controller/app/constants.ts`

**要求**

- Binder 仍统一绑定 Scheduler/CronScheduler 回调。
- 等待中任务 ID 的唯一所有者不变。
- 日志正则输出保持。
- 只删除重新检索后仍无引用的 `resolveRepairModeLabel()`。

**专项验收**

使用固定日志 fixture 验证演习、战役、战斗结束和进度转换。

### D04 拆 PlanController

**目标**

PlanController 只持有当前方案和协调下属用例。

**主要范围**

- `src/controller/plan/PlanController.ts`
- `src/controller/plan/presetFlow.ts`
- 新增 `ManagedBattlePlanPickerController.ts`
- 新增 `PlanPersistenceController.ts`
- 新增 `PlanExecutionController.ts`
- 新增 `src/adapter/api/CombatPlanRequestMapper.ts`
- 对应 Host 和测试

**要求**

- 当前 PlanModel 只有一个权威实例。
- 选择弹窗状态不进入 PlanModel。
- 保存、加载、执行公共行为和错误文本保持。
- API mapper 保留 node decision、fleet、fleet_rules 和 candidate-only。

**专项验收**

```powershell
npm run test:legacy-plan
npm run test:api-contract
npm run test:main-services
```

### D05 拆 TaskGroup/Queue Loader Controller

**目标**

分离任务组页面协调、元数据加载和不同来源的入队用例。

**主要范围**

- `src/controller/taskGroup/TaskGroupController.ts`
- `src/controller/taskGroup/TaskListLoaderController.ts`
- `src/controller/taskGroup/queueLoader.ts`
- `src/controller/taskGroup/metaLoader.ts`
- `src/controller/taskGroup/managedPlanReader.ts`
- 新增 `src/controller/taskGroup/queue/`
- 新增 `src/model/scheduler/TaskRequestFactory.ts`

**要求**

- `buildPlanQueueRequest()` 不再位于页面功能目录。
- managed/group/template Loader 各自独立。
- Scheduler 是唯一入队入口。
- 不改变任务顺序、次数、优先级或停止条件。

**专项验收**

```powershell
npm run test:task-group-migration
npm run test:api-contract
```

新增 managed plan、task group、template 三种来源生成同等 TaskRequest 的测试。

### D06 拆 TemplateController

**目标**

TemplateController 只协调模板库，向导状态和选择流程独立。

**主要范围**

- `src/controller/template/TemplateController.ts`
- `src/controller/template/crud.ts`
- `src/controller/template/selectors.ts`
- `src/controller/template/useTemplate.ts`
- `src/controller/template/wizard.ts`
- 新增 `TemplateWizardController.ts`

**要求**

- 删除 `as any` ref-wrapper，改用明确状态接口。
- Controller 不直接解析 YAML 或读写文件。
- 模板 ID、默认值、批量导入和使用流程保持。

**专项验收**

新增模板创建、重命名、删除、导入和三种使用去向的契约测试。

### D07 拆 Startup 环境/更新编排

**目标**

分离环境准备与更新检查，同时保留 StartupController 的启动时序。

**主要范围**

- `src/controller/startup/StartupController.ts`
- `src/controller/startup/envAndUpdates.ts`
- `src/controller/startup/connection.ts`
- 新增 `environmentBootstrap.ts`
- 新增 `updateStartup.ts`

**要求**

- StartupController 继续唯一编排启动顺序。
- Python 环境检查、安装、CUDA/OCR 和启动使用同一环境描述。
- 更新检查不改变后端启动模式。
- 删除前重新确认 `runSetupScript()` 是否无调用。

**专项验收**

```powershell
npm run test:python-environment
npm run test:settings
npm run test:main-services
```

### E01 提取共享舰船 View

**目标**

建立 FleetPlanner 和 DecisivePlan 可共用的纯 View 组件。

**主要范围**

- `src/view/plan/ShipArtwork.ts`
- `src/view/plan/TeamPlanListUi.ts`
- 新增 `src/view/shared/ShipArtwork.ts`
- 新增 `src/view/shared/ShipGalleryView.ts`
- 新增 `src/view/shared/TeamPlanCard.ts`
- 新增 `src/model/fleet/TeamPlanQuery.ts`

**要求**

- View 只渲染传入数据和上报意图。
- 不调用 IPC、Model 或持久化。
- 查询/过滤/排序在 `TeamPlanQuery`，不在多个 View 复制。
- 原文件暂时兼容 re-export。

**专项验收**

新增纯查询测试；手工验证舰船图片 fallback、筛选和滚动加载。

### E02 拆 TaskListLoader/ContextMenu View

**目标**

把任务列表弹窗和右键菜单 DOM 从 Controller 移到 View。

**主要范围**

- `src/controller/taskGroup/TaskListLoaderController.ts`
- `src/controller/taskGroup/contextMenu.ts`
- 新增 `src/view/taskGroup/TaskListLoaderView.ts`
- 新增 `src/view/taskGroup/TaskContextMenuView.ts`

**要求**

- Controller 持有选择和草稿状态。
- View 只持有 DOM 和回调。
- 拖拽排序、编辑、复制和删除行为保持。

**专项验收**

手工验证打开、筛选、多选、拖拽、右键操作、确认和取消。

### E03 拆 FleetPlanner 编辑核心

**目标**

从 `FleetPlannerView` 提取单一舰队草稿、共享图鉴和编辑/规则子 View。

**主要范围**

- `src/view/plan/FleetPlannerView.ts`
- 新增 `src/controller/plan/FleetPlannerController.ts`
- 新增 `src/model/fleet/FleetDraft.ts`
- 新增 `src/view/plan/fleetPlanner/FleetEditorView.ts`
- 新增 `src/view/plan/fleetPlanner/FleetRuleEditorView.ts`
- E01 共享 View

**明确不包含**

- 计划管理。
- 批量导出。
- 编队选择弹窗。
- 备选复制弹窗。

**要求**

- 一个 `FleetDraft` 是唯一草稿状态。
- 子 View 不保存业务副本。
- 主选、备选、拖拽、舰种和等级规则保持。
- candidate-only 不被提升为顶层 `name`。

**专项验收**

新增 FleetDraft 纯测试；手工验证添加、替换、拖拽、清空、规则编辑和保存前预览。

### E04 拆 FleetPlanner 选择和计划管理

**目标**

完成 FleetPlanner 的编队选择、备选复制、计划管理和持久化拆分。

**主要范围**

- `src/view/plan/FleetPlannerView.ts`
- `src/controller/plan/FleetPlannerController.ts`
- 新增 `TeamPlanPickerView.ts`
- 新增 `BackupCopyDialog.ts`
- 新增 `PlanManagementView.ts`
- 对应 Repository 调用

**要求**

- View 不直接调用 `window.electronBridge`。
- 同名保存继续要求确认覆盖。
- 系统预设不得批量导出。
- 没有用户预设时不得展示系统预设编队。
- 原文件最终只作为 facade。

**专项验收**

```powershell
npm run test:main-services
npm run test:main-ipc
```

手工验证保存、覆盖、重命名、删除、筛选、导入、批量导出和空用户预设。

### E05 拆 DecisivePlan/FleetPreset View

**目标**

复用共享舰船组件，移除两个 View 中的 IPC 和业务状态。

**主要范围**

- `src/view/plan/DecisivePlanView.ts`
- `src/view/plan/FleetPresetView.ts`
- 新增 `src/controller/plan/DecisivePlanController.ts`
- 新增 `src/controller/plan/FleetPresetController.ts`
- 新增 `src/model/fleet/DecisiveFleetDraft.ts`
- 新增 `src/view/plan/decisive/DecisiveFleetView.ts`

**要求**

- 决战草稿只有一个状态所有者。
- FleetPresetView 只渲染并发出修改意图。
- 两者不直接 IPC。
- 决战章节、主选/备选和配置持久化语义保持。

**专项验收**

```powershell
npm run test:settings
npm run test:api-contract
```

手工验证决战方案保存、重载、拖拽及编队预览修改。

### E06 拆 Config/PlanPreview View

**目标**

让 ConfigView 和 PlanPreviewView 只负责表单与 View facade。

**主要范围**

- `src/view/config/ConfigView.ts`
- `src/view/plan/PlanPreviewView.ts`
- 新增 `ConfigFormView.ts`
- 新增 `EnvironmentSettingsView.ts`
- 新增 `PlanFormView.ts`

**要求**

- ConfigView 不再导入 `js-yaml`。
- View 上报原始文本或结构化输入，由 Controller/Codec 校验。
- PlanPreviewView 继续作为子 View facade。
- 错误提示和字段默认值保持。

**专项验收**

```powershell
npm run test:settings
npm run test:legacy-config-upgrade
npm run test:legacy-plan
```

手工验证配置保存错误、复杂 YAML 字段、地图选择和节点编辑。

### F01 删除兼容层、死代码并同步文档

**目标**

在所有调用方迁移完成后，删除临时出口和确认无引用的历史代码。

**主要范围**

- 兼容 `types/*.ts` facade
- `src/data/shipData.ts` facade
- 旧 View re-export
- `controller/shared/ControllerHost.ts`
- `controller/taskGroup/importExport.ts`
- 无引用方法和 barrel export
- `docs/architecture/`
- 原方案和本任务书的最终状态

**要求**

- 每个删除项先用 `rg` 证明无引用。
- 架构文档必须与实际目录一致。
- 不能因为目标目录存在就删除仍被外部入口依赖的 facade。
- 不做额外业务重构。

**最终验证**

```powershell
npm run build
npm run test:legacy-config-upgrade
npm run test:legacy-plan
npm run test:task-group-migration
npm run test:api-contract
npm run test:settings
npm run test:main-services
npm run test:main-ipc
npm run test:python-environment
rg -n "window\.electronBridge|\(window as any\)" src/model src/view
rg -n "localStorage" src/model src/view
rg -n "js-yaml|yaml\.load|yaml\.dump" src/controller src/model src/view
rg -n "\bas any\b" src/controller src/model
git diff --check
```

前三个静态边界检索应无结果。`as any` 只允许有注释说明的第三方边界；业务代码
应无结果。

## 8. Agent 交付格式

每个 Agent 完成任务后必须按以下格式交付：

```text
任务 ID：
基线 SHA：
完成 SHA：

行为目标：
实际修改：
明确未修改：

修改文件：
新增文件：
删除文件：

状态所有者变化：
外部契约变化：无 / 具体说明
兼容层：新增 / 保留 / 删除

执行命令及结果：
1.
2.

手工验证：
未验证路径：
失败尝试次数：
当前 Patch 等级：
回滚方式：

git status --short：
下一项已解锁任务：
```

交付中只说“构建通过”不算完成。必须列出专项测试和业务不变量的验证证据。

## 9. 可直接派发的提示词

队列管理员可以复制以下内容，只替换任务 ID 和 SHA：

```text
请执行 C:\ShiinaKuroko\01.Project\AutoWSGR-GUI\docs\reviews\2026-08-04-src-module-split-agent-runbook.md 中的任务 <TASK_ID>。

基线 SHA：<BASE_SHA>
前置任务完成 SHA：<PREVIOUS_SHA>

你只能执行该任务，不得开始下一项。修改前先按任务书提交预检报告。
使用独立分支/worktree，保护现有未提交修改。完成后执行通用验证和任务卡
专项验证，并按“Agent 交付格式”报告。出现强制停止条件时停止写代码并报告，
不得自行扩大范围。
```

## 10. 管理员验收

管理员合并每个任务前必须确认：

- [ ] Agent 使用了正确的基线。
- [ ] 只完成一个任务 ID。
- [ ] 没有混入共享工作树的旧改动。
- [ ] 状态所有者没有复制。
- [ ] 外部契约没有变化，或已获得单独批准。
- [ ] 通用验证和专项验证均有结果。
- [ ] 失败尝试和 Patch 等级已披露。
- [ ] 文档与实现没有互相矛盾。
- [ ] 回滚该任务不会要求同时回滚未关联功能。
- [ ] 下一任务基于本任务合并后的新 SHA。
