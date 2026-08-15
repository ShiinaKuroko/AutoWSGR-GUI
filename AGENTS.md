# AutoWSGR-GUI Agent 约束

本文件是所有人工辅助 Agent、自动化 Agent、代码生成/审查工具和 Issue 分析工具的统一入口。它规定加载顺序和项目特有约束；不得替代、改写或削弱权威规范。

## Alpha 自主实验边界

`alpha` 是面向用户反馈的自主产品实验分支，不是等待整体合入 `main` 的功能分支。Agent 可以优先追求快速试验，不要求保持 `main` 的架构、实现兼容性或常规质量门禁；本文件其余面向稳定主线的工程约束，在 `alpha` 上仅作为建议，除非同时属于下列硬性安全底线：

- 不得泄露、传输或提交密钥、凭据、Token、用户隐私数据、含隐私的日志或未经授权的本地配置。
- 不得执行破坏性系统或 Git 操作，不得改写或删除受保护分支历史，并须保留无关工作。
- 用户配置迁移前必须备份；迁移须可恢复，失败时保留此前可用数据，不得静默丢弃用户数据。
- 强化、解装、购买等不可逆或消耗舰船、货币、道具的游戏操作必须默认关闭，要求用户明确确认；目标、状态或确认不确定时必须 fail closed。
- 实验构建和发布必须显著标注 `alpha` 或“实验版”，不得让用户误认为稳定版本。
- 发布前至少必须成功构建并实际启动；无法完成启动验证时不得发布。

禁止将 `alpha` 整体 merge、squash 或 rebase 到 `main`。向 `main` 晋升功能时，只能独立选择有效资产或行为，在稳定基线上规范化、验证并以独立 PR 合入。

## 1. 接入协议

开始分析、写入文件或执行可能改变仓库状态的命令前，必须：

1. 执行 `git status --short --branch`，确认分支、worktree 和未提交修改。
2. 完整读取 `docs/engineering-standards.md`，以及 `.editorconfig`、`.gitattributes`、`tsconfig.json`、`package.json` 和 `CONTRIBUTING.md`。
3. 按任务范围读取第 3 节的架构文档和现有测试。
4. 搜索已有实现、同领域规则、历史 workaround 和相关数据契约。
5. 修改前明确行为目标/非目标、状态所有者、受影响架构层、当前止损等级和验证方式。

无法读取强制规范，或无法确认工作树是否含有他人修改时，必须停止写入并报告阻塞原因。

## 2. 权威规则与不可削弱要求

### 2.1 权威顺序

冲突按以下顺序处理：

1. `package.json`、`tsconfig.json`、`.editorconfig`、`.gitattributes` 等可执行配置；
2. `docs/engineering-standards.md`；
3. `docs/architecture/` 当前架构文档；
4. `CONTRIBUTING.md`；
5. `docs/teaching/` 历史教学。

本文件和工具入口文件只负责加载规则，不能覆盖上述来源。工程规范中的 `MUST/MUST NOT` 是合并门槛，`SHOULD/SHOULD NOT` 默认必须遵守，偏离须在 PR 说明理由。修改强制规范须保留完整语义；删除、降级或豁免须经维护者书面批准。

### 2.2 必须完整遵守

必须执行 `docs/engineering-standards.md` 全部章节，尤其是：文档权威顺序和技术债务、正确性证据、单一状态所有者、根因修复、最小充分实现与反堆积门禁、可回滚行为单元、MVC + ViewObject 边界、公共数据契约和迁移、用户目录/原子写入/文件 IPC 安全、Python 环境与进程树、Patch 止损及 L0-L4、第三次修复门槛、干净基线重写、AI Agent 协议、PR/提交/规模审查、构建和确定性验证、临时 containment 例外、合并审查清单。

不可弱化的核心检查：

- 每份可变数据只有一个权威所有者；不得用标志、影子集合或重复缓存掩盖所有权。
- 数据流为 `Model -> Controller -> ViewObject -> View`，用户意图由 View 返回 Controller。
- View 不得直接调用 Model、ApiClient、文件 IPC 或持久化；Controller 不得成为第二个 Model 或实现 parser、路径安全、环境发现；Model 不得依赖具体 View、DOM、Electron 或 Node 文件系统。
- ViewObject、领域模型、API DTO、IPC DTO 必须区分；不得用 `any` 或类型断言逃避契约。
- `electron/main.ts` 只负责生命周期、IPC 注册、模块初始化和依赖注入。
- GUI 只能依赖后端公开、版本化接口；跨仓结构必须有契约测试或固定 fixture。
- 已发布格式、目录、模板 ID、任务索引和默认行为属于兼容契约；安装资源只读，用户数据写入系统用户目录，原子替换失败须保留旧文件。
- renderer 不得通过通用 IPC 操作任意绝对路径；路径必须 canonicalize 并检查 containment。
- Bug 修复须有修复前失败、修复后通过的可复现证据；已失败 workaround 必须删除，不得外围叠加 guard、retry、delay 或 fallback。
- 达到止损条件必须暂停；Agent 不得自行批准 L2 以上工作继续实施。

### 2.3 最低验证

- TypeScript/SCSS 变更至少执行 `npm run build`。
- 打包、安装资源或发布流程变更应执行 `npm run pack`；无法执行须说明原因。
- 行为变更还须有确定性验证，不能只依赖 build、lint、截图或一次手工运行。
- 已有专项测试必须按行为风险选择；涉及 Electron、端口、`userData`、临时目录、进程或共享缓存时默认串行执行，除非已证明资源隔离。
- Bug 测试须证明旧实现失败、新实现通过。
- 架构、目录、命令、数据格式、后端契约或发布流程变更须同步文档。

## 3. 架构文档路由

任务开始至少读取受影响领域文档；跨领域任务读取全部相关文档。实现与文档不一致时，修正实现或在同一变更更新文档，不得无说明地二选一。

| 影响范围 | 必读文档 |
|---|---|
| 分层、目录、启动、Types | `docs/architecture/00-overview.md` |
| Controller、Host、依赖注入、启动 | `docs/architecture/01-controller-layer.md` |
| Scheduler、TaskQueue、定时任务、修理 | `docs/architecture/02-task-scheduling.md` |
| 配置、主题、设置持久化 | `docs/architecture/03-configuration.md` |
| 计划、地图、节点、舰队预设 | `docs/architecture/04-battle-plan.md` |
| 模板、任务组、队列加载 | `docs/architecture/05-template-and-taskgroup.md` |
| IPC、HTTP、WebSocket、后端契约 | `docs/architecture/06-backend-communication.md` |
| Python、模拟器、后端、更新生命周期 | `docs/architecture/07-environment-management.md` |
| 环境、构建、打包、SCSS | `docs/architecture/08-dev-setup.md` |

`docs/teaching/` 只用于理解历史动机；不得把历史文件数、行数或快照当作当前事实，也不得覆盖强制规范或架构文档。修改应优先在现有职责边界内形成最小行为闭环；不得混入无关重构、格式化、生成文件或资源。跨 Model、Controller、Types、View 的自然功能可形成垂直切片，但必须保持依赖方向；历史违规只处理与当前目标和风险相称的范围，并在 PR 披露剩余债务。

## 4. 风格、工具与执行记录

- 使用 UTF-8、LF、文件末尾换行；TS/SCSS/JSON/Markdown/YAML 2 空格，Python 4 空格。
- TypeScript 使用 strict；新代码不得借 `noImplicitAny: false` 引入隐式 `any`。类文件 PascalCase，工具/类型文件 camelCase；样式用 SCSS，遵循现有 BEM 和目录结构。
- 分支使用 `feat/`、`fix/`、`chore/`、`docs/` 等语义前缀；Commit 使用 Conventional Commits，一个 commit 一个逻辑变更。
- 不得手工修改构建生成物，除非仓库明确要求提交；lockfile 变更须由明确依赖变更产生。大型资源、fixture、图片和机械生成内容须与手写行为代码分别统计说明。
- 不得提交密钥、Token、用户配置、日志、运行时数据或本地环境文件；不得关闭 SSL、路径、类型、Schema、测试或权限校验来绕过问题。
- 证据不足时区分事实与推测；Issue 分析须给出实现位置、行为链路、最小修复和验证步骤。数据迁移、文件 IPC、更新器、发布或跨仓契约须优先验证失败和回滚路径。

### 4.1 最小充分实现原则

在不降低正确性、安全性、可维护性、类型约束和验证完整性的前提下，Agent 必须用满足目标所需的最少代码完成任务：

- 能通过修改现有代码实现的，不得新增重复代码、包装层、状态源或辅助模块。
- 优先合理复用职责、输入输出、生命周期和副作用均匹配的现有模块、函数、类型、组件、测试工具和数据契约；不得为表面复用强行扩大原模块职责。
- 遵循最小拆分原则：仅在职责独立、生命周期不同、复用价值明确或现有模块违反职责边界时拆分；不得为减少单文件行数、追求形式分层或制造抽象而拆分。
- 不得为实现小功能顺手重构无关代码、引入无必要抽象、重复已有规则或堆积防御性分支。
- 新增的每个函数、类型、模块、状态源、依赖和测试都必须能说明必要性；无法说明必要性的代码不得加入。
- 实现前必须搜索现有实现和调用链，并明确可直接复用的代码、只能复用思路的代码、必须新增的主要符号及不能采用更小修改范围的原因。
- 当最小实现与架构边界、公共契约、安全要求或可验证性冲突时，优先满足后者，并在交付记录中说明增加代码的原因。

### 4.2 Agent 编码门禁

Agent 必须按以下顺序工作，不能跳过“最小方案”直接堆积实现：

1. **先搜索再设计**：搜索现有调用链、同领域规则、类型、适配器、组件、测试和失败 workaround。
2. **先写最小方案**：明确唯一行为目标、非目标、可复用代码、最少修改文件、计划新增符号及其必要性；默认方案是修改现有实现。
3. **先做最小闭环**：只实现能证明行为的最小路径，不先搭目录、接口、Facade、Factory、Manager、Registry、EventBus、兼容层或未来扩展点。
4. **逐项批准新增物**：每新增函数、类型、文件、依赖、状态源、缓存或错误分支，都必须说明当前调用方/测试证据、不能复用的原因和不能采用更小修改的原因。
5. **发现堆积立即停**：出现无独立职责的 wrapper/helper、无调用方的预留代码、形式拆分、重复转换/校验/状态、或为未来扩展增加的代码时，停止继续写入并回到最小方案。
6. **交付前删减**：检查是否能删除新增代码而不影响目标；能删除的必须删除。新增文件必须有真实调用方、独立职责或独立行为契约。

以下理由不得用于增加代码：“以后可能扩展”“方便复用”“先搭起来再整理”“这样更规范”“文件太长”“以后可能会用到”。

修改前记录目标、非目标、工作树/隔离方式、已读规范、状态所有者/数据流、止损等级和验证计划。修改中说明是在替代旧尝试、删除 workaround 还是新增行为；出现新状态源、跨层补偿或范围扩散立即重新评估，不得用“先跑起来”保留无法解释的 fallback。交付前检查 diff 仅含任务文件，执行强制构建和风险匹配的确定性验证，更新文档，并记录命令、结果、未验证路径、失败尝试、状态源变化、回滚方式和工程规范第 12 节审查结果。

## 5. Git、发布与专用规则

### 5.1 工作区安全

- 不得覆盖、回退、删除或暂存非当前任务修改；有无关修改时用独立 branch/worktree 隔离。
- 未经用户明确要求，不得 `git reset --hard`、`git checkout -- <path>`、强制清理或历史重写；不得 `git push --force`、`--no-verify` 或其他绕过保护参数。
- 不得 `git add .`；按逻辑变更显式暂存。推送前检查待推送 commit 范围和工作树状态。

### 5.2 发布

只有用户明确要求发布时，才能改版本、创建 Tag 或触发发布。发布前须确认功能修改已独立提交并推送且工作树干净；Release commit 只含版本/发布元数据；Tag、`package.json` 版本和产物版本一致；不得修改、删除或覆盖已有远程 Tag。

### 5.3 专用入口边界

- `.github/agents/code-length-audit.agent.md` 只在代码长度审计中生效，不是所有 PR 的行数门槛。
- `.github/skills/commit-and-release/SKILL.md` 仅在提交、推送、发布任务中生效。
- `.claude/skills/generic-issue-log-analysis/SKILL.md` 仅在 Issue/日志分析中生效。
- `.github/workflows/` 定义实际自动化；修改 workflow 前说明权限、Secret、触发条件和发布影响。

### 5.4 ShiinaKuroko Fork

- GUI：`C:\ShiinaKuroko\01.Project\AutoWSGR-GUI`，远端 `https://github.com/ShiinaKuroko/AutoWSGR-GUI.git`；后端：`C:\ShiinaKuroko\01.Project\AutoWSGR`，远端 `https://github.com/ShiinaKuroko/AutoWSGR.git`；两者发布分支均为 `ShiinaKuroko`。
- GitHub fetch/pull/push 前读取 `HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings` 的 `ProxyServer`。当前代理为 `127.0.0.1:7897`；端口监听时优先临时使用 `git -c http.proxy=http://127.0.0.1:7897 -c https.proxy=http://127.0.0.1:7897 ...`，不得改全局 Git 配置；未启用时可直连，并按实际错误区分网络、认证和远端冲突。
- `main` 只同步 `OpenWSGR/AutoWSGR-GUI:main`，不得在其直接开发、提交或推送功能。`ShiinaKuroko` 是唯一允许 `git push origin ShiinaKuroko` 的本地发布入口；独立分支/worktree 只编码、测试、审查，完成后合并、cherry-pick 或 rebase 到本地发布分支。不得推送 `origin <local-feature-branch>`，除非维护者明确授权。
- 每次更新发布分支前创建 `backup/YYYYMMDD-<short-sha>`：更新前稳定提交和更新后新版本各备份，最多保留两个；备份不得移动、覆盖或追加，只删除最旧备份，不删除当前/上一版本备份。
- 推送前确认当前为本地 `ShiinaKuroko`，检查 `git status --short --branch`、`git diff --check`、`git log --oneline -5`、`git log origin/ShiinaKuroko..ShiinaKuroko`；先备份，再以 `git push --force-with-lease` 更新，禁止无条件 `--force`。删除远程分支前列出分支、提交和原因；不得删除 `main`、`ShiinaKuroko` 或未授权分支。

## 6. GUI 2.0 合并边界

### 6.1 合并前负责范围

目标是让 GUI 2.0 现有功能安全、兼容、可合并，不实现自动强化。优先修复：

- 主进程文件 IPC 路径 containment，禁止穿越和受管目录外访问；AtomicFileStore 失败保留旧文件。
- 外部 Python 安装目录与启动目录统一。
- 兼容 v1.4.1 和当前稳定版计划格式，不要求手工重写；完成旧 path-form 任务组迁移，失败保留原数据并给出明确错误。
- 设置 YAML round-trip 保留未知字段，尤其未知嵌套字段。
- candidate-only：无顶层 `name` 时所有 `candidates` 平等，不得将第一个提升为 primary。

必须保持：舰队方案与出征计划分离；编辑态计划可引用独立舰队 YAML；运行前由 `RuntimePlanService` 展开为后端可执行 YAML；系统计划与用户计划读写边界明确；`SchedulerRepairPolicy`、`SchedulerTaskPolicy`、`RepairManager`、`TaskQueue.switchTaskPreset()` 职责清晰；编队轮换只用统一 Scheduler，不得新增并行状态机。

旧目录中的活动计划不得靠删除以下文件并放置相似文件来宣称迁移完成：

- `resource/builtin_plans/活动20260730-E1炸鱼.yaml`
- `resource/builtin_plans/活动20260730-E5夜战.yaml`
- `resource/builtin_plans/活动20260730-H1炸鱼.yaml`
- `resource/builtin_plans/活动20260730-H5夜战.yaml`

合并前须验证旧计划可读取、执行或显式迁移；新旧行为等价；用户修改不会被静默覆盖；迁移失败保留原文件并显示可理解错误。

### 6.2 合并验收

须通过 `npm run build` 和 `git diff --check`，并覆盖：legacy plan 读取/迁移、candidate-only 舰队槽位、设置未知字段保留、原子写入失败恢复、文件 IPC 越界拒绝、旧任务组迁移、四个活动计划兼容性、舰队引用展开后的运行时 YAML 合法性。未接 UI 的执行入口必须接通、删除死入口或明确标记暂不支持，不得保留看似可用的无调用链路。提交应尽量按 Electron 服务、舰队 YAML、运行时计划、Scheduler 规则、UI、舰船资源拆分，至少可分别审查。

### 6.3 自动强化边界

合并前不要求自动强化业务、后端 API/设备 lease、`intensify` 任务类型、保护舰集合、与轮换/泡澡/战斗优先级、设置 UI/最终接线、日志/重试/状态展示，或后端唯一舰船 ID（未提供时可先用舰名）。但 Scheduler task type、API 请求和设置 schema 必须预留扩展边界，不能封闭设计。

自动强化由另一协作方负责：后端 API；全局 device lease（不得与战斗、泡澡、解装并发）；统一 Scheduler 正式任务（不得独立定时器）；强化前重新读取并保护当前编队、启用轮换预设、泡澡舰、收藏/锁定舰、强化目标舰和用户名单；素材筛选/上限/失败/重试；接入 `ApiClient`、API/ Scheduler types、`ConfigModel`、`ConfigController`、`SchedulerBinder`；真实坐标/OCR 未完成前 fail closed，不点击或消耗舰船；GUI 2.0 合并后再接最终 Scheduler 和配置架构，避免双方修改同一状态机。

## 7. Windows 打包约束

### 7.1 winCodeSign

无 Windows 开发者模式或符号链接权限时，Electron Builder 解压 `winCodeSign-2.6.0.7z` 会因 `darwin/10.12/lib/libcrypto.dylib`、`libssl.dylib` 创建失败而阻断，即使文件属于 macOS 也不能忽略。打包前检查开发者模式或当前终端权限；确认缺失后不得重复相同命令/下载。

正式解决方式是启用开发者模式或使用有权限终端执行 `npm run dist`；不得把本地工具路径覆盖当正式解决。启用后用 Electron Builder 自带 `7za.exe` 和 `winCodeSign-2.6.0.7z` 做一次带 `-snld` 的解压探针，确认两个 `.dylib` 符号链接可创建后直接执行原始 `npm run dist`。PowerShell 5 的 `New-Item -ItemType SymbolicLink` 可能误报，不作为唯一前置检查。

不得用 `--config.win.signAndEditExecutable=false` 生成正式包；`ELECTRON_BUILDER_RCEDIT_PATH` 单独设置，或与 `SIGNTOOL_PATH` 同时设置，均不足以完成 NSIS 打包，不得重复尝试。失败后不得以重试、延时或运行时文件写入 fallback 掩盖问题，须先区分工具权限错误和应用持久化错误。

### 7.2 单 EXE 交付

用户要求“只有 EXE”时目标是 NSIS 安装程序而非 `--dir`：关闭所有 `release/win-unpacked` GUI；确认 `package.json` 与 `package-lock.json` 版本一致；用完整 `winCodeSign` 权限执行 `npm run dist`；从 `release/` 单独取出 `AutoWSGR-GUI-Setup-<version>.exe`，不得混入 `win-unpacked`、更新清单或 blockmap；检查版本、哈希、签名并实际启动安装后的 GUI。安装包、`release/` 和本地 Electron Builder 缓存不得提交。

## 8. 维护

- 强制规范正文只维护于 `docs/engineering-standards.md`；架构变化先更新架构文档，再更新本文件路由/摘要。
- 工具入口只应指向本文件，不得复制整套规则。新增规则须标明属于强制、约束或高风险宽泛规则。
- 本文件与权威来源冲突时按第 2.1 节处理，并在同一变更修复冲突。
