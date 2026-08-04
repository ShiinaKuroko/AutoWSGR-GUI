# AutoWSGR-GUI Agent 项目约束

本文件是所有 AI 编码 Agent 进入本仓库时的统一入口。它负责规定阅读顺序和执行协议，不替代详细规范，也不得削弱详细规范中的任何要求。

适用范围包括人工辅助 Agent、自动化 Agent、代码生成工具、代码审查工具和 Issue 分析工具。

## 0. 首次接入协议

开始分析、修改文件或执行可能改变仓库状态的命令前，Agent 必须：

1. 执行 `git status --short --branch`，确认当前分支、worktree 和未提交修改。
2. 完整读取 `docs/engineering-standards.md`，不得只读取摘要、标题或局部章节。
3. 读取 `.editorconfig`、`.gitattributes`、`tsconfig.json` 和 `package.json`。
4. 读取 `CONTRIBUTING.md`。
5. 根据任务影响范围，读取第 2 节列出的相关架构文档和现有测试。
6. 搜索现有实现、相同领域规则、历史 workaround 和相关数据契约。
7. 在修改前明确行为目标、非目标、状态所有者、受影响架构层和验证方式。

如果无法读取强制规范，或者无法确认当前工作树是否包含他人修改，Agent 必须停止写入并报告阻塞原因。

## 1. 强制性规则

### 1.1 完整保留原则

`docs/engineering-standards.md` 是强制工程规则的唯一正文来源，其中全部规则均原样生效。

- `必须 / 不得（MUST / MUST NOT）` 是合并门槛。
- `应当 / 不应（SHOULD / SHOULD NOT）` 默认必须遵守；偏离时必须在 PR 中说明理由。
- 本文件中的概述不能替代原文。
- Agent 不得通过摘要、改写、选择性引用或工具限制忽略原文中的任何规则。
- 修改强制规范时，必须保留原有规则的完整语义；删除、降级或豁免必须经过维护者书面批准。

### 1.2 权威顺序

发生冲突时，严格按照以下顺序处理：

1. `package.json`、`tsconfig.json`、`.editorconfig`、`.gitattributes` 等可执行配置。
2. `docs/engineering-standards.md`。
3. `docs/architecture/` 中描述当前系统结构的文档。
4. `CONTRIBUTING.md`。
5. `docs/teaching/` 中的历史重构教学。

`AGENTS.md` 和各工具入口文件只负责加载上述规则，不形成更高优先级，也不能覆盖它们。

### 1.3 强制规则范围

Agent 必须完整执行 `docs/engineering-standards.md` 的全部章节，包括但不限于：

1. 文档权威顺序和现有技术债务处理。
2. 正确性证据、单一状态所有者、根因修复和可回滚行为单元。
3. MVC + ViewObject 架构边界，以及 View、Controller、Model、Types、Electron 和 Python 后端职责。
4. 公共数据契约、版本化迁移、用户目录、原子写入和 Electron 文件安全。
5. Python 环境一致性、后端进程树和更新生命周期。
6. Patch 失败计数、止损信号、L0-L4 升级和第三次修复门槛。
7. 干净基线重写、行为契约、旧代码复用清单和垂直切片。
8. AI Agent 修改前、修改中、强制暂停和交付记录要求。
9. PR 范围、提交粒度、Conventional Commits 和规模审查。
10. 构建、确定性验证、测试原则和文档同步。
11. 临时 containment 的例外条件、批准和移除要求。
12. 合并前审查清单。

### 1.4 不得弱化的核心约束

- 每份可变数据只能有一个权威所有者；不得用标志、影子集合或重复缓存掩盖所有权问题。
- 标准数据流是 `Model -> Controller -> ViewObject -> View`，用户意图由 View 返回 Controller。
- View 不得直接调用 Model、ApiClient、文件 IPC 或持久化能力。
- Controller 不得成为第二个 Model，也不得承载 parser、路径安全和环境发现等基础设施实现。
- Model 不得依赖具体 View、DOM、Electron 或 Node 文件系统实现。
- ViewObject、领域模型、API DTO 和 IPC DTO 必须区分；不得使用 `any` 或类型断言逃避契约设计。
- `electron/main.ts` 只负责生命周期、IPC 注册、模块初始化和依赖注入。
- GUI 只能依赖后端公开且版本化的接口；跨仓数据结构必须有契约测试或固定 fixture。
- 已发布的数据格式、目录、模板 ID、任务索引和默认行为属于兼容契约。
- 安装资源只读，用户数据写入系统用户目录；文件替换失败必须保留旧文件。
- renderer 不得通过通用 IPC 操作任意绝对路径；路径必须 canonicalize 并检查 containment。
- Bug 修复必须提供修复前失败、修复后通过的可复现证据。
- 已失败的 workaround 必须删除，不得在外围继续叠加 guard、retry、delay 或 fallback。
- 达到止损条件时必须暂停，Agent 不得自行批准 L2 以上继续实施。

### 1.5 最低验证

- TypeScript 或 SCSS 变更至少执行 `npm run build`。
- 打包、安装资源或发布流程变更应执行 `npm run pack`，无法执行时必须说明原因。
- 行为修改必须提供额外的确定性验证，不能只以 build、lint、截图或一次手工运行作为完成证据。
- Bug 修复测试必须证明旧实现失败、新实现通过。
- 修改架构、目录、命令、数据格式、后端契约或发布流程时，必须同步更新对应文档。

## 2. 约束性规则

约束性规则用于保持现有结构和团队协作方式。相关文件必须保留；偏离时必须说明理由并同步文档。

### 2.1 贡献和代码风格

完整规则见 `CONTRIBUTING.md`：

- 使用 UTF-8、LF 和文件末尾换行。
- TypeScript、SCSS、JSON、Markdown 和 YAML 默认使用 2 空格缩进；Python 使用 4 空格。
- TypeScript 使用 strict 模式，新代码不得利用 `noImplicitAny: false` 引入隐式 `any`。
- 类文件使用 PascalCase，工具和类型文件使用 camelCase。
- 样式使用 SCSS，并遵循现有 BEM 命名和目录结构。
- 分支使用 `feat/`、`fix/`、`chore/` 或 `docs/` 等语义前缀。
- Commit 使用 Conventional Commits，一个 commit 对应一个逻辑变更。

### 2.2 架构文档路由

任务开始时至少读取对应领域文档。跨领域任务必须读取所有受影响文档。

| 影响范围 | 必读文档 |
|---|---|
| 全局分层、目录、启动流程、Types | `docs/architecture/00-overview.md` |
| Controller、Host、依赖注入、启动编排 | `docs/architecture/01-controller-layer.md` |
| Scheduler、TaskQueue、定时任务、修理 | `docs/architecture/02-task-scheduling.md` |
| 用户配置、主题、设置持久化 | `docs/architecture/03-configuration.md` |
| 计划、地图、节点和舰队预设 | `docs/architecture/04-battle-plan.md` |
| 模板、任务组和队列加载 | `docs/architecture/05-template-and-taskgroup.md` |
| IPC、HTTP、WebSocket 和后端契约 | `docs/architecture/06-backend-communication.md` |
| Python、模拟器、后端和更新生命周期 | `docs/architecture/07-environment-management.md` |
| 环境搭建、构建、打包、SCSS | `docs/architecture/08-dev-setup.md` |

如果实现与架构文档不一致，必须修正实现或在同一变更中更新文档，不得无说明地选择其中一套。

### 2.3 教学文档

`docs/teaching/` 用于理解历史设计动机，不是合并规范。可以从中复用设计思路，但：

- 不得把历史文件数、行数或代码快照当作当前事实。
- 不得用教学示例覆盖强制规范或当前架构文档。
- 涉及拆分类、Host 接口、ViewObject、Electron、View、Model 或 Types 时，可以读取对应教学章节辅助理解。

### 2.4 变更范围

- 优先在现有模块和职责边界内完成最小行为闭环。
- 不得把无关重构、格式化、生成文件或资源更新混入行为修改。
- 同一功能自然涉及 Model、Controller、Types 和 View 时可以形成一个垂直切片，但必须保持依赖方向。
- 发现历史违规时，只处理与当前行为目标和风险相称的范围，并在 PR 中披露剩余技术债务。

## 3. 宽泛规则中的高风险约束

本节只把现有工具说明中的高风险操作提升为通用项目约束。其他工具规则仍按其原始适用范围执行。

### 3.1 Git 和工作区安全

- 不得覆盖、回退、删除或暂存不是当前任务产生的修改。
- 工作树存在无关修改时，使用独立 branch 或 worktree 隔离任务。
- 未经用户明确要求，不得执行 `git reset --hard`、`git checkout -- <path>`、强制清理或历史重写。
- 不得使用 `git push --force`、`--no-verify` 或其他绕过保护的参数。
- 不得使用 `git add .` 混入无关文件；必须按逻辑变更显式暂存。
- 推送前必须检查待推送 commit 范围和工作树状态。

### 3.2 发布和 Tag

- 只有用户明确要求发布时，才能修改版本、创建 Tag 或触发发布。
- 发布前必须确认功能修改已独立提交并推送，工作树干净。
- Release commit 只能包含版本和发布元数据，不得夹带功能代码。
- Tag、`package.json` 版本和发布产物版本必须一致。
- 不得修改、删除或覆盖已有远程 Tag 来掩盖发布错误。

### 3.3 安全和证据

- 不得提交密钥、Token、用户配置、日志、运行时数据或本地环境文件。
- 不得通过关闭 SSL、路径、类型、Schema、测试或权限校验绕过问题。
- 证据不足时必须区分已验证事实与推测，不得给出确定性根因结论。
- Issue 分析必须给出实现位置、行为链路、最小修复方案和验证步骤。
- 涉及数据迁移、文件 IPC、更新器、发布或跨仓契约时，必须优先验证失败路径和回滚路径。

### 3.4 生成文件、资源和依赖

- 不得手工修改可由构建生成的输出，除非仓库明确要求提交该输出。
- Lockfile 变更必须由明确的依赖变更产生，并与依赖修改一起说明。
- 大型资源、fixture、图片和机械生成内容必须与手写行为代码分别统计和说明。
- 安装资源和内置资源的兼容更新必须有 manifest、版本规则或迁移策略。

### 3.5 专用工具规则的边界

- `.github/agents/code-length-audit.agent.md` 仅在代码长度审计任务中生效，不自动成为所有 PR 的行数合并门槛。
- `.github/skills/commit-and-release/SKILL.md` 在提交、推送和发布任务中生效。
- `.claude/skills/generic-issue-log-analysis/SKILL.md` 在 Issue 和日志分析任务中生效。
- `.github/workflows/` 定义实际自动化行为；修改 workflow 前必须说明权限、Secret、触发条件和发布影响。

## 4. Agent 执行协议

### 4.1 修改前

Agent 必须报告或在工作记录中明确：

- 行为目标与非目标；
- 当前工作树和隔离方式；
- 读取过的强制规范和相关架构文档；
- 状态所有者和数据流；
- 当前 Patch 止损等级；
- 计划执行的验证。

### 4.2 修改中

- 声明当前修改是在替代旧尝试、删除旧 workaround，还是新增独立行为。
- 一旦出现新的状态源、跨层补偿或意外扩大范围，立即重新评估止损等级。
- 不得以“先跑起来”为由保留无法解释的 fallback。

### 4.3 交付前

- 检查 diff，只保留当前任务文件。
- 执行强制构建和与行为风险匹配的确定性验证。
- 更新受影响文档。
- 记录执行命令、测试结果、未验证路径、失败尝试、状态源变化和回滚方式。
- 对照 `docs/engineering-standards.md` 第 12 节完成审查清单。

## 5. 维护本文件

- 强制规范只在 `docs/engineering-standards.md` 维护正文，本文件通过引用完整继承。
- 架构变化先更新对应架构文档，再更新本文件的路由或摘要。
- 工具入口文件只能指向本文件，不得复制整套规则。
- 新增规则时必须明确属于强制性、约束性还是高风险宽泛规则。
- 如果本文件与权威来源冲突，以第 1.2 节顺序为准，并在同一变更中修复冲突。

## 6. ShiinaKuroko Fork 分支管理

本仓库的个人 Fork 为 `https://github.com/ShiinaKuroko/AutoWSGR-GUI.git`。后续 Agent
必须遵守以下分支职责：

### 6.1 本机仓库与 GitHub 网络路径

- GUI 仓库固定为 `C:\ShiinaKuroko\01.Project\AutoWSGR-GUI`，后端仓库固定为 `C:\ShiinaKuroko\01.Project\AutoWSGR`。
- GUI 个人远端为 `https://github.com/ShiinaKuroko/AutoWSGR-GUI.git`，后端个人远端为 `https://github.com/ShiinaKuroko/AutoWSGR.git`，发布分支均为 `ShiinaKuroko`。
- 本机开启代理时，Git CLI 不会自动继承 Windows 系统代理。执行 GitHub `fetch`、`pull` 或 `push` 前，应读取 `HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings` 的 `ProxyServer`；当前代理为 `127.0.0.1:7897`。
- `127.0.0.1:7897` 正在监听时，GitHub 命令应优先通过临时参数使用代理，例如 `git -c http.proxy=http://127.0.0.1:7897 -c https.proxy=http://127.0.0.1:7897 push origin ShiinaKuroko`。不得为此修改全局 Git 配置。
- 代理未启用或端口未监听时，允许使用正常直连路径；连接失败时应根据实际错误区分网络、认证和远端冲突问题。

- `main` 只用于同步 `OpenWSGR/AutoWSGR-GUI:main`，禁止在该分支直接开发、提交或推送功能代码。
- `ShiinaKuroko` 是个人 Fork 的最新开发分支，经过验证的最新 GUI 代码才允许推送到这里。
- 本地独立分支或 worktree 只能用于编码、测试和审查，禁止直接推送到 Fork 的发布分支。
- 本地独立分支完成后，必须将已验证提交合并、`cherry-pick` 或 rebase 整理到本地 `ShiinaKuroko` 分支；只有本地 `ShiinaKuroko` 分支允许执行 `git push origin ShiinaKuroko`。
- 不得执行 `git push origin <local-feature-branch>` 作为发布流程；远程临时分支如确有协作需要，必须获得维护者明确授权，并不得替代 `ShiinaKuroko` 发布入口。
- `backup/YYYYMMDD-<short-sha>` 是版本备份分支。每次更新 `ShiinaKuroko` 前创建更新前稳定提交的备份，完成更新后创建新版本备份，最多保留两个。
- 备份分支一旦创建不得移动、覆盖或追加提交。超过两个备份时只删除最旧备份，不删除当前备份和上一版本备份。
- 推送前必须确认当前分支为本地 `ShiinaKuroko`，并检查 `git status --short --branch`、`git diff --check`、`git log --oneline -5` 以及 `git log origin/ShiinaKuroko..ShiinaKuroko`。
- 推送最新代码前必须先创建备份，并使用 `git push --force-with-lease` 更新 `ShiinaKuroko`，禁止无条件 `--force`。
- 任何删除远程分支的操作都必须先列出分支、提交和原因；禁止删除 `main`、`ShiinaKuroko` 或未明确授权的分支。

## 7. GUI 2.0 合并协作边界

我这边已经梳理过 GUI 2.0 和当前稳定分支的差异。为了避免我们分别修改 Scheduler、配置模型和舰队语义，后续按下面的边界协作。

### 你在合并前需要完成的范围

你负责把 GUI 2.0 当前已经实现的功能收敛到“可合并、不会破坏已有数据”的状态，重点是现有功能和基础架构，不需要替我实现自动强化。

#### 1. 先解决当前 review 中会造成数据损坏、安全问题或兼容性破坏的阻塞项

- 给主进程文件 IPC 加严格的路径边界校验，禁止路径穿越和访问受管目录以外的文件。
- 修复 AtomicFileStore：写入失败时必须保留原文件，不能出现旧文件先被删除、临时文件又未成功替换的情况。
- 统一外部 Python 环境的依赖安装目录和实际启动目录。
- 保持 v1.4.1 及当前稳定版计划格式兼容，不能要求用户手工重写旧计划。
- 完成旧 path-form 任务组迁移，迁移失败时要保留原数据并给出明确错误。
- 设置 YAML round-trip 时保留 GUI 尚不认识的字段，尤其是未知嵌套字段。
- 修复 candidate-only 语义：槽位没有顶层 `name` 时，所有 `candidates` 都是平等备选，不能把第一个 candidate 自动提升成 primary。

#### 2. 稳定 GUI 2.0 已经引入的核心契约

- 舰队方案与出征计划保持分离。
- 编辑态计划可以引用独立舰队 YAML。
- 运行前由 `RuntimePlanService` 展开为后端可执行的完整 YAML。
- 系统计划与用户计划有明确的读写边界。
- `SchedulerRepairPolicy`、`SchedulerTaskPolicy`、`RepairManager`、`TaskQueue.switchTaskPreset()` 的责任边界保持清晰。
- 编队轮换继续使用统一 Scheduler，不再增加另一套并行状态机。

#### 3. 处理旧活动计划兼容性

当前旧目录中有用户正在使用的活动计划，不能仅通过删除：

- `resource/builtin_plans/活动20260730-E1炸鱼.yaml`
- `resource/builtin_plans/活动20260730-E5夜战.yaml`
- `resource/builtin_plans/活动20260730-H1炸鱼.yaml`
- `resource/builtin_plans/活动20260730-H5夜战.yaml`

并在 `resource/system_battle_plans` 放几个相似文件，就认为迁移完成。

合并前需要验证：

- 旧计划仍可读取、执行或显式迁移。
- 新旧计划行为等价。
- 用户修改过的旧文件不会被安装、升级或迁移流程静默覆盖。
- 无法迁移时保留原文件，并显示可理解的错误。

#### 4. 合并前最低验收程度

- `npm run build` 通过。
- `git diff --check` 通过。
- 至少覆盖以下回归测试：
  - legacy plan 读取和迁移；
  - candidate-only 舰队槽位；
  - 设置 YAML 未知字段保留；
  - 原子写入失败恢复；
  - 文件 IPC 路径越界拒绝；
  - 任务组旧格式迁移；
  - 四个活动计划的兼容性；
  - 舰队引用展开后的运行时 YAML 合法性。
- 把 PR 中尚未接到 UI 的执行入口明确处理：要么接通，要么删除死入口，要么明确标记为暂不支持，不能保留一个看似可用但实际没有调用方的链路。
- 最好按领域拆分提交，至少让 Electron 服务、舰队 YAML、运行时计划、Scheduler 规则、UI 和舰船资源可以分别审查。

### 可以在合并后交给我处理的内容

以下内容不要求你在 GUI 2.0 合并前完成：

- 自动强化的业务实现。
- 自动强化后端 API 和设备独占租约。
- intensify Scheduler 任务类型。
- 自动强化的保护舰集合计算。
- 自动强化与轮换、泡澡、战斗任务之间的优先级。
- 自动强化设置 UI 和最终 Scheduler 接线。
- 自动强化运行日志、失败重试和任务状态展示。
- 将后端唯一舰船 ID 引入自动强化保护规则；在后端尚未提供 ID 时先兼容舰名。

但请预留正常的扩展边界，不要把 Scheduler task type、API 请求或设置 schema 写成无法扩展的封闭分支。

### 我这边会负责什么

我负责自动强化以及它与稳定分支公共调度层的最终集成：

- 后端定义并实现自动强化 API。
- 所有强化设备操作使用全局 device lease，不能与战斗、泡澡或解装并发。
- 自动强化只作为统一 Scheduler 的正式任务执行，不启动独立后台定时器。
- 强化前重新读取保护集合，至少保护：
  - 当前游戏编队；
  - 所有启用轮换预设；
  - 正在泡澡的舰船；
  - 收藏或锁定舰；
  - 强化目标舰；
  - 用户自定义保护名单。
- 设计素材舰筛选、上限、失败和重试规则。
- 接入 `ApiClient`、API types、Scheduler types、`ConfigModel`、`ConfigController` 和 `SchedulerBinder`。
- 最终处理自动强化与 GUI 2.0 合并后的公共文件冲突。

### 我在 GUI 2.0 合并前会做到的程度

我会优先在后端和独立领域层工作，避免现在修改你的舰队编辑器、计划管理 UI 和 Scheduler 核心：

- 先稳定自动强化的 HTTP contract。
- 接入后端全局设备租约。
- 建立 ops 层和 UI controller 的责任边界。
- 定义目标舰、允许的素材舰种、素材数量上限和保护名单。
- 编写无设备单元测试和 route contract 测试。
- 未完成真实设备坐标与 OCR 标定前，功能必须 fail closed，不能尝试点击或消耗任何舰船。
- GUI 2.0 合并后，我再基于你的最终 Scheduler 和配置架构完成 GUI 任务接线，避免双方同时修改同一套状态机。

总体原则是：你负责让 GUI 2.0 已有功能安全、兼容、可合并；我负责自动强化及合并后的公共调度集成。编队轮换核心继续以你的 GUI 2.0 实现为准，我不会另写一套。
