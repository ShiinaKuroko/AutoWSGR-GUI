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
