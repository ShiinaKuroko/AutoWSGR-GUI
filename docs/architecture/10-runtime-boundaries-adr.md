# ADR-001：当前运行时边界与生命周期

- **状态**：已接受
- **日期**：2026-08-05
- **适用范围**：当前 AutoWSGR-GUI 主进程、渲染进程、用户数据迁移、任务调度和 GUI 更新

## 背景

GUI 已完成大规模模块拆分。为了防止实现继续演进而工程文档停留在旧结构，本
决策记录固定当前版本的所有权和生命周期边界。代码是最终契约；相关变更必须
同时更新本 ADR 和对应专题文档。

## 决策

### 1. 渲染进程遵循单向边界

标准数据流为：

```text
Model / Repository → Controller → ViewObject → View
View → 用户意图 → Controller
```

View 不读取 Electron bridge，不拼装持久化 DTO，也不拥有文件 identity。
`FleetPlannerController` 负责舰船库和编队计划读取、保存覆盖、DTO 映射及
`file/source`；`FleetDraft` 负责草稿与 `UserTeamPlan` 的双向转换和规则校验。
View 只看到 ViewObject 和不透明计划 ID。`DecisivePlanController` 以同样方式
拥有设置 Repository 和 `DecisiveFleetDraft`。

### 2. `electron/main.ts` 只做组合根

`main.ts` 可以创建 Service、注入依赖、注册 IPC、编排启动迁移和处理 Electron
生命周期，不实现文件策略、YAML 规则、计划归一化、资料库升级、环境检测或
更新策略。业务边界分别由以下模块承担：

| 边界 | 所有者 |
|------|--------|
| 普通文件能力 | `SafePathService`、`SecureFileService` |
| GUI 设置 | `GuiSettingsStore`、`GuiConfigurationService` |
| 迁移状态账本 | `MigrationStateStore` |
| 作战计划 | `CombatPlanCodec`、`CombatPlanRepository`、计划 Service |
| 编队计划 | `TeamPlanCodec`、`TeamPlanRepository`、`TeamPlanService` |
| 舰船资料库 | `ShipLibraryService`、`ShipLibraryUpdater` |
| Python/CUDA/ADB | `pythonEnv/*`、环境 Service |
| 后端进程 | `BackendService`、`BackendShutdownService` |
| GUI 更新 | `UpdaterIpc`、`GuiUpdatePolicy` |

### 3. 安装资源只读，用户数据写入 `userData`

| 数据 | 运行时位置 |
|------|------------|
| 系统作战/舰队/日常计划、地图、内置模板 | `resource/`，只读 |
| 已下架系统计划的迁移快照 | `resource/migrations/v6/`，只读 |
| 用户作战计划 | `userData/user_battle_plans/` |
| 用户舰队计划 | `userData/user_team_plans/` |
| 用户日常计划 | `userData/user_daily_plans/` |
| 设置、任务组、模板 | `userData/` |
| 舰船资料库工作副本 | `userData/ship-library/` |
| 迁移状态 | `userData/.migration-state.json` |
| 临时展开计划 | 系统 temp 下的进程专属目录 |

舰船资料库按 manifest 的 schema 版本和生成时间升级，通过临时目录、备份和
重命名切换，失败时恢复旧目录。

通用文件 IPC 只允许读取 `userData` 和 `resource`，只允许写入 `userData`。
路径验证拒绝 `..`、UNC、盘符跳转和 NTFS ADS，并通过 `realpath` 检查符号链接
或 junction 的真实目标。系统文件对话框授予的单次外部文件能力不扩展通用 IPC。

### 4. 迁移是可重试的版本状态机

`MigrationStateStore` 独占 `.migration-state.json` 的解析、合并和原子写入。
`UserDataMigrationService` 负责旧来源和 v6 库存迁移，
`LegacyPlanMigration` 负责 v7 计划分类迁移。迁移遵循：

1. 源文件不修改、不删除。
2. 同名不同内容保存为“（旧版）”副本，并同步受管引用。
3. 设置按字段深度合并，未知扩展字段保留。
4. 完成项包含来源和内容摘要，重复启动不重复迁移。
5. 每一阶段全部成功后才写入完成键并推进版本；失败项下次启动重试。
6. 实际发生迁移时显示总数、成功数、失败数和失败文件。

### 5. 调度器区分轮次与逻辑任务

`SchedulerTask.id` 只标识当前物理轮次；`logicalId` 在所有后触发、重试、间隔
等待和无限轮次之间保持稳定。事件分为：

- `onTaskCompleted(id)`：单轮完成。
- `onLogicalTaskCompleted(logicalId)`：整个任务不再有后续轮次。
- `onLogicalTaskCanceled(logicalId, reason)`：删除、清空或系统停止。

`SchedulerBinder` 只根据逻辑事件更新 cron/pending。系统停止允许下次重新触发，
用户删除或清空表示主动放弃。

### 6. 模板兼容链路暂时保留

`TemplateModel`、`TemplateController`、用户模板文件和
`kind: "template"` 仍是旧任务组及系统决战预设的执行依赖。当前计划页没有
独立模板库入口；新入口按后续界面方案实现。在完成数据和执行迁移之前，不得
删除或停止初始化兼容链路。

### 7. 发布和安装使用严格生命周期

版本只允许 `X.Y.Z`、`X.Y.Z-beta.N`、`X.Y.Z-dev` 或 `X.Y.Z-dev.N`，
分别对应 `latest`、`beta`、`dev`。发布工作流和客户端使用同一解析规则，
产物不得混入其他频道清单。

更新检查必须返回有更新、已是最新或失败三态。安装前调用
`BackendShutdownService`：后端正式停止接口、进程树终止、等待 `close`、超时
强制回退。无法确认退出时阻止 `quitAndInstall()`。

## 后果

- 新功能需要明确状态所有者，不能把 Repository 或 Electron bridge 重新放回 View。
- 新的用户可变文件必须先定义 `userData` 位置和 IPC 能力，不能写安装目录。
- 调度回调不能用单轮 `id` 清理逻辑任务状态。
- 修改迁移、频道或关闭顺序时，必须补对应 Service 测试和旧版本 fixture。
