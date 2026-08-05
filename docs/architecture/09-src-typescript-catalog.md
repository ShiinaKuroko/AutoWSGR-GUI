# `src` TypeScript 模块目录

当前 `src` 共有 117 个 TypeScript 文件。每个模块均有文件头职责说明；本目录由
这些说明汇总，用于快速定位功能所有者。

## 当前结构

```text
src/
├─ adapter/     6 个：API、IPC、JSON、YAML、Storage 边界
├─ controller/ 41 个：页面和用例编排
├─ model/      23 个：领域状态、Fleet、Scheduler 和统计规则
├─ view/       31 个：DOM 渲染、表单输入和 UI 意图
├─ types/       7 个：API、IPC、Model、View、Fleet、Scheduler、统计类型
├─ shared/      8 个：跨层无状态业务契约
├─ data/           舰船静态 JSON
└─ utils/       1 个：统一日志
```

## Adapter（6）

| 文件 | 职责 |
|---|---|
| `src/adapter/ApiAdapter.ts` | 封装后端 HTTP 请求和 WebSocket 连接，向 Model 提供传输能力。 |
| `src/adapter/index.ts` | 集中导出 Renderer 使用的 Adapter 实例和边界类型。 |
| `src/adapter/IpcAdapter.ts` | 封装 Electron IPC 文件与计划操作，提供 Renderer 侧仓储接口。 |
| `src/adapter/JsonAdapter.ts` | 统一 JSON 序列化、解析和对象类型校验。 |
| `src/adapter/StorageAdapter.ts` | 定义键值存储契约，并封装浏览器 localStorage 实现。 |
| `src/adapter/YamlAdapter.ts` | 统一 YAML 编解码及作战方案元数据读取。 |

## Controller（41）

| 文件 | 职责 |
|---|---|
| `src/controller/app/AppController.ts` | 作为 Renderer 组合根，初始化并协调页面、模型和功能控制器。 |
| `src/controller/app/AutomaticDecisiveTask.ts` | 分别从用户决战计划和系统预设构造自动决战请求。 |
| `src/controller/app/ConfigController.ts` | 编排设置加载、环境检测、表单保存和配置持久化。 |
| `src/controller/app/constants.ts` | 维护任务优先级、状态文案和修理模式等界面常量。 |
| `src/controller/app/CurrentFleetController.ts` | 加载舰船资料并把当前任务中的舰队规则转换为主页 ViewObject。 |
| `src/controller/app/NavigationController.ts` | 处理主页面导航、标签切换和当前页面状态。 |
| `src/controller/app/OperationsController.ts` | 编排远征收取、奖励领取等常用自动化操作。 |
| `src/controller/app/rendering.ts` | 把调度器和游戏状态转换为主页面 ViewObject。 |
| `src/controller/app/SchedulerBinder.ts` | 绑定 Scheduler 回调并同步日志、进度、队列和连接状态。 |
| `src/controller/app/SettingsController.ts` | 编排设置页的环境检测、设备连接、资料库更新和主题交互。 |
| `src/controller/app/theme.ts` | 读取并应用主题、强调色和系统主题变化。 |
| `src/controller/contracts.ts` | 定义跨 Controller 流程共享的最小 Host 契约，避免反向依赖主 Controller。 |
| `src/controller/migration/MigrationConflictController.ts` | 协调迁移冲突弹窗与主进程安全文件操作。 |
| `src/controller/plan/BattlePlanLoaderController.ts` | 管理受管作战方案选择器的加载、筛选、选择和结果返回流程。 |
| `src/controller/plan/DecisivePlanController.ts` | 独立持有决战舰队草稿并协调加载、编辑和保存。 |
| `src/controller/plan/FleetPlannerController.ts` | 持有普通舰队草稿并协调舰船库、规则编辑和计划管理。 |
| `src/controller/plan/fleetViewObjects.ts` | 将舰队持久化 DTO 和领域预设转换为只读展示对象。 |
| `src/controller/plan/nodeEditor.ts` | 编排节点编辑表单与 PlanModel 节点规则更新。 |
| `src/controller/plan/PlanController.ts` | 协调作战方案加载、预览、编辑和保存。 |
| `src/controller/plan/PlanFleetPresetController.ts` | 管理计划页舰队目录，并把添加、移除意图转换为新的预设列表。 |
| `src/controller/plan/PlanManagementController.ts` | 管理计划目录状态，并把页面操作转换为受控仓储调用。 |
| `src/controller/plan/planManagementViewObjects.ts` | 将计划目录和任务组引用转换为只读计划管理行。 |
| `src/controller/plan/presetFlow.ts` | 把任务预设和舰队预设转换为可调度的作战任务。 |
| `src/controller/plan/rendering.ts` | 把作战方案、地图和节点数据转换为预览 ViewObject。 |
| `src/controller/plan/selectedNodes.ts` | 维护地图节点选择顺序并同步方案的选中节点。 |
| `src/controller/startup/connection.ts` | 检测后端可用性并管理启动阶段的连接等待。 |
| `src/controller/startup/envAndUpdates.ts` | 编排运行环境准备、依赖安装和 GUI 更新检查。 |
| `src/controller/startup/StartupController.ts` | 统一协调应用启动、后端连接、环境检查和资源释放。 |
| `src/controller/taskGroup/addItems.ts` | 将方案、模板和预设添加为任务组条目。 |
| `src/controller/taskGroup/contextMenu.ts` | 处理任务组条目的右键菜单、编辑、复制和删除。 |
| `src/controller/taskGroup/DailyTaskLoaderController.ts` | 管理日常任务浮窗的加载、分类、参数和提交动作。 |
| `src/controller/taskGroup/managedPlanReader.ts` | 读取受管作战方案并统一返回内容和来源信息。 |
| `src/controller/taskGroup/metaLoader.ts` | 批量读取任务条目元数据并生成界面展示摘要。 |
| `src/controller/taskGroup/queueLoader.ts` | 把任务组条目解析为 Scheduler 可执行任务并加入队列。 |
| `src/controller/taskGroup/TaskGroupController.ts` | 管理任务组选择、增删改和 Model 到 ViewObject 的映射。 |
| `src/controller/taskGroup/TaskListLoaderController.ts` | 协调任务列表文件选择、解析和批量载入。 |
| `src/controller/template/crud.ts` | 实现模板创建、编辑、删除、导入和导出用例。 |
| `src/controller/template/selectors.ts` | 提供方案、舰队和任务参数的模板选择流程。 |
| `src/controller/template/TemplateController.ts` | 协调模板库、模板向导和任务组添加流程。 |
| `src/controller/template/useTemplate.ts` | 把模板参数实例化为可加入任务组的任务条目。 |
| `src/controller/template/wizard.ts` | 维护模板向导步骤、预填数据和表单提交。 |

## Model（23）

| 文件 | 职责 |
|---|---|
| `src/model/ApiClient.ts` | 提供后端业务 API、任务控制和 WebSocket 事件客户端。 |
| `src/model/ConfigModel.ts` | 持有用户配置状态并负责默认值、迁移和 YAML 转换。 |
| `src/model/fleet/DecisiveFleetDraft.ts` | 维护决战舰队独立草稿及决战配置转换规则。 |
| `src/model/fleet/FleetDraft.ts` | 定义普通舰队槽位、候选舰和规则草稿结构。 |
| `src/model/fleet/FleetDraftEditor.ts` | 在 Controller 持有的唯一舰队草稿上应用显式编辑意图。 |
| `src/model/fleet/FleetPresetIdentity.ts` | 统一编队规则格式并生成稳定的预设身份标识。 |
| `src/model/fleet/FleetRuleMapper.ts` | 在舰队槽位规则和后端 fleet_rules 请求之间转换。 |
| `src/model/fleet/index.ts` | 导出舰队草稿、匹配、名称和规则映射等领域能力。 |
| `src/model/fleet/ShipMatcher.ts` | 解析舰队预设、匹配舰船规则并生成槽位显示文本。 |
| `src/model/MapDataLoader.ts` | 加载、缓存并查询地图节点、连线和位置信息。 |
| `src/model/PlanModel.ts` | 持有作战方案状态并处理节点规则、迁移和 YAML 往返。 |
| `src/model/scheduler/CronScheduler.ts` | 维护定时任务触发器、最后执行时间和 pending 状态。 |
| `src/model/scheduler/ExpeditionTimer.ts` | 根据远征状态计算并发布下一次收取倒计时。 |
| `src/model/scheduler/index.ts` | 导出调度器、任务队列、定时器和修理管理器公共接口。 |
| `src/model/scheduler/RepairManager.ts` | 跟踪泡澡舰船并编排修理、替换和状态恢复。 |
| `src/model/scheduler/Scheduler.ts` | 持有当前任务和运行状态，驱动任务消费、重试与后续任务。 |
| `src/model/scheduler/SchedulerRepairPolicy.ts` | 提供舰船损伤阈值、替换候选和修理时长的纯规则。 |
| `src/model/scheduler/SchedulerTaskPolicy.ts` | 提供任务完成、重试、轮询和后续任务构造的纯规则。 |
| `src/model/scheduler/StopConditionChecker.ts` | 读取游戏统计并判断掉落、舰船上限等停止条件。 |
| `src/model/scheduler/TaskQueue.ts` | 唯一持有就绪与延迟队列，并实现优先级和轮询排序。 |
| `src/model/statistics/DailySortieStats.ts` | 从后端成功日志维护可持久化的今日出征统计。 |
| `src/model/TaskGroupModel.ts` | 持有任务组及条目状态，并负责 JSON 迁移和持久化。 |
| `src/model/TemplateModel.ts` | 管理内置与用户模板，负责校验、CRUD 和持久化。 |

## View（31）

| 文件 | 职责 |
|---|---|
| `src/view/config/ConfigView.ts` | 渲染设置页面、收集表单输入并发出保存和检测意图。 |
| `src/view/main/FleetPreviewView.ts` | 渲染当前舰队舰船、等级和损伤状态预览。 |
| `src/view/main/LogView.ts` | 追加、筛选并滚动展示运行日志。 |
| `src/view/main/MainView.ts` | 组合主页面状态栏、舰队、队列和日志子视图。 |
| `src/view/main/StatusBar.ts` | 渲染连接、运行状态、当前任务和远征倒计时。 |
| `src/view/main/TaskQueueView.ts` | 渲染任务队列进度并发出删除和停止操作意图。 |
| `src/view/migration/MigrationConflictView.ts` | 渲染迁移 YAML 冲突的双列表选择弹窗并上报保留意图。 |
| `src/view/plan/BattlePlanLoaderView.ts` | 渲染受管作战方案选择器，并收集搜索、筛选和舰队选择操作。 |
| `src/view/plan/DecisivePlanView.ts` | 渲染决战舰队配置并向 Controller 提交编辑意图。 |
| `src/view/plan/FleetEditorView.ts` | 渲染舰队槽位并处理选择、清空和拖拽排序意图。 |
| `src/view/plan/FleetGalleryView.ts` | 展示舰船图鉴并管理筛选、排序和选择等 UI 状态。 |
| `src/view/plan/FleetPlannerView.ts` | 组合舰队编辑、规则、图鉴、计划管理和编队加载视图。 |
| `src/view/plan/FleetPresetView.ts` | 渲染方案内舰队预设并提供应用、编辑和任务创建入口。 |
| `src/view/plan/FleetRuleView.ts` | 渲染主选、候选、舰种和等级规则编辑区。 |
| `src/view/plan/MapView.ts` | 绘制作战地图节点与连线并发出节点选择意图。 |
| `src/view/plan/NodeEditorView.ts` | 渲染节点属性和敌舰规则编辑对话框。 |
| `src/view/plan/PlanManagementView.ts` | 渲染本地方案列表并发出导入、导出、重命名和删除意图。 |
| `src/view/plan/PlanPreviewView.ts` | 组合地图、节点编辑、舰队预设和方案参数预览。 |
| `src/view/plan/ShipArtwork.ts` | 创建舰船立绘元素并处理资源路径和加载失败回退。 |
| `src/view/plan/TeamPlanListUi.ts` | 渲染编队方案卡片并实现搜索、筛选和排序。 |
| `src/view/plan/TeamPlanLoaderView.ts` | 展示编队方案选择器并发出加载方案意图。 |
| `src/view/setup/SetupWizardView.ts` | 渲染首次启动向导并收集模拟器和 Python 配置。 |
| `src/view/shared/AnimatedSelect.ts` | 在不改变原生表单数据源的前提下提供统一动画下拉面板。 |
| `src/view/shared/DialogHelper.ts` | 封装 Renderer 通用确认、提示、输入对话框和保存成功提示。 |
| `src/view/shared/scrollPosition.ts` | 保存和恢复可滚动容器的界面位置。 |
| `src/view/shared/ShipAutocomplete.ts` | 为舰名输入框提供搜索建议、键盘选择和补全。 |
| `src/view/taskGroup/DailyTaskLoaderView.ts` | 渲染日常任务浮窗并上报页签、参数和提交意图。 |
| `src/view/taskGroup/TaskGroupView.ts` | 渲染任务组和任务条目，并发出选择、排序和菜单意图。 |
| `src/view/template/SelectorDialog.ts` | 渲染通用选项对话框并返回用户选择。 |
| `src/view/template/TemplateLibraryView.ts` | 渲染模板库卡片并发出使用、编辑和删除意图。 |
| `src/view/template/TemplateWizardView.ts` | 渲染模板创建向导、计划列表和分步表单。 |

## Types（7）

| 文件 | 职责 |
|---|---|
| `src/types/api.ts` | 定义 Renderer 与后端 HTTP/WebSocket 通信使用的请求、响应和事件类型。 |
| `src/types/fleetEditor.ts` | 定义 Fleet 编辑器跨层意图、选择位置和编辑结果。 |
| `src/types/ipc.ts` | 定义 Renderer 与 Electron 主进程之间的桥接方法、文件结果和资源契约。 |
| `src/types/model.ts` | 定义配置、作战方案、舰队规则、模板和修理等领域数据结构。 |
| `src/types/scheduler.ts` | 定义任务队列、调度状态及 Scheduler 对外回调契约。 |
| `src/types/statistics.ts` | 定义今日出征统计、战斗评级和掉落提示结构。 |
| `src/types/view.ts` | 定义 Controller 交给各页面渲染的 ViewObject、表单值和展示状态。 |

## Shared（8）

| 文件 | 职责 |
|---|---|
| `src/shared/decisiveAutomation.ts` | 定义自动决战的用户计划、系统预设来源和稳定标识。 |
| `src/shared/fleetShipTypes.ts` | 提供 22 种规范舰种代码、标签、映射和契约校验。 |
| `src/shared/legacyDecisiveAutomation.ts` | 定义旧决战自动化配置的无损迁移结构。 |
| `src/shared/lootPlans.ts` | 定义刷胖次稳定计划标识、来源和旧数字索引映射。 |
| `src/shared/migrationConflicts.ts` | 定义迁移后需要用户确认的 YAML 冲突契约。 |
| `src/shared/nativeFleetShipTypes.generated.ts` | 保存由 autowsgr_native 生成的舰种代码，供前端漂移检查。 |
| `src/shared/shipCatalog.ts` | 加载静态舰船资料并提供舰名和国籍只读目录。 |
| `src/shared/shipNameNormalizer.ts` | 统一舰名别名、后端标准名和搜索名转换。 |

## Utils（1）

| 文件 | 职责 |
|---|---|
| `src/utils/Logger.ts` | 提供统一日志级别、频道和控制台输出格式。 |
