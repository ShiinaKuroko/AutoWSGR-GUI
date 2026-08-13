# PR #1 更新桥接审查交接

## 结论

PR #1 `feat: add 2.1 Alpha-to-Stable update bridge` 当前不能直接合并。

主要原因不是功能方向错误，而是 PR 分支基线与当前仓库错位，并且混入了两个应独立审查的功能范围：

1. 1.4.3 计划降级备份。
2. Alpha 到 Stable 更新桥接。

本 PR 的任何功能提交都不得合入 `ShiinaSakuya`；如需处理，必须统一在 `ShiinaKuroko` 上逐笔审查、解决冲突和验证。Sakuya 仅保留本审查交接文档。

本次审查没有合并、cherry-pick 或修改 PR 代码。

## PR 元数据

- PR：`ShiinaKuroko/AutoWSGR-GUI#1`
- 标题：`feat: add 2.1 Alpha-to-Stable update bridge`
- 目标分支：`ShiinaKuroko`
- 来源分支：`feat/2.1-update-bridge-PR`
- Head：`f7bf2f27b62ad4818ee8b7b1b01e70be870800c8`
- GitHub 统计：43 个提交、1739 个文件、增加 149111 行、删除 24597 行
- 初次检查状态：`mergeable=false / dirty`
- 后续 API 检查状态：`mergeable=null / unknown`

1739 个文件不是本功能的真实改动范围，而是分支历史与目标分支没有正确对齐造成的差异。

## 真实功能范围

PR 顶部 3 笔提交是本次需要交接的实际功能改动：

| 提交 | 内容 | 文件 | 增加 | 删除 |
| --- | --- | ---: | ---: | ---: |
| `6f839ca` | 导出 1.4.3 降级计划备份 | 11 | 308 | 2 |
| `5fa6cb4` | 2.0 Alpha 到 2.1 Stable 更新桥接 | 21 | 525 | 79 |
| `f7bf2f2` | 分离发布验证与实际发布 | 2 | 24 | 5 |

合并统计为 32 个唯一文件、增加 852 行、删除 81 行。

### 发布与构建

- `.github/workflows/release.yml`
- `build/electron-builder.release.cjs`（新增）
- `build/electron-builder.stable.cjs`（删除）
- `package.json`
- `package-lock.json`

### Electron 主进程

- `electron/main.ts`
- `electron/preload.ts`
- `electron/ipc/CombatPlanIpc.ts`
- `electron/ipc/ConfigurationIpc.ts`
- `electron/ipc/UpdaterIpc.ts`
- `electron/services/GuiConfigurationService.ts`
- `electron/services/GuiUpdatePolicy.ts`
- `electron/services/PlanExportService.ts`

### Renderer

- `src/adapter/IpcAdapter.ts`
- `src/controller/app/ConfigController.ts`
- `src/controller/plan/PlanManagementController.ts`
- `src/types/ipc.ts`
- `src/types/view.ts`
- `src/view/config/ConfigView.ts`
- `src/view/plan/PlanManagementView.ts`
- `src/view/html/pages/config/system.html`
- `src/view/html/pages/plan/management.html`
- `src/view/index.html`（构建生成入口）

### 测试

- `scripts/tests/main-services/test-configuration-and-window.js`
- `scripts/tests/main-services/test-plan-export.js`
- `scripts/tests/main-services/test-updater-and-shutdown.js`
- `scripts/tests/test-backend-distribution.js`
- `scripts/tests/test-release-package.js`

### 文档

- `docs/architecture/07-environment-management.md`
- `docs/architecture/08-dev-setup.md`
- `docs/architecture/13-release-version-governance.md`（新增）
- `docs/architecture/README.md`

## 功能评估

### 1.4.3 计划降级备份

新增了从计划管理页面选择用户出征计划并导出 ZIP 的完整链路：

`PlanManagementView -> PlanManagementController -> IpcAdapter -> preload -> CombatPlanIpc -> PlanExportService`

导出包包含：

- `plans/`：转换后的 1.4.3 兼容出征计划。
- `original_2.0/user_battle_plans/`：未经转换的原始计划。
- `恢复说明.txt`：恢复步骤和备份范围。

当前转换只处理出征计划，不导出舰队计划。它将舰船槽位的 `candidates` 转为 `priority`，并移除 `search_name` 和 `relaxed`。功能边界相对独立，但需要单独确认 1.4.3 的实际读取兼容性。

### 自动更新设置

“允许测试版更新”开关的调用链完整：

`system.html -> ConfigView -> ConfigController -> ConfigurationGateway -> preload -> ConfigurationIpc -> GuiConfigurationService`

配置写入 `allow_test_updates`。Stable 默认只接收 `latest`；开启后选择 `alpha`，候选校验允许 `latest` 和 `alpha`。Beta 和 Dev 保持自己的频道。

### Release workflow

workflow 扩展为同时支持：

- `X.Y.Z` Stable，对应 `latest`。
- `X.Y.Z-alpha.N` Alpha，对应 `alpha`。
- 发布前目标仓库和版本检查。
- Stable 发布时附带 Alpha 兼容资产。
- 向个人仓库和 `yltx/AutoWSGR-GUI` 创建、发布 Release。

## 阻断问题

### 1. 分支基线错位

PR 必须先基于正确目标分支重建。不能在当前 43 个提交、1739 个文件的差异上解决冲突后直接合并，否则无法可靠区分功能代码和旧分支历史。

### 2. 版本方案与当前规则不一致

PR 把 `package.json` 和 `package-lock.json` 改为 `2.1.0-alpha.1`，并在 workflow 中硬编码 `2.0.16-alpha -> 2.1.0-alpha.1 -> 2.1.0`。

当前项目确认的协作桥接规则是以维护者提供的版本为基线，只递增最后一位；本轮使用 `2.0.17-alpha.* -> 2.0.17`。不得直接采用 PR 中的 `2.1.0` 版本变更。重新处理前仍须执行 `AGENTS.md` 规定的双仓库版本与 Release 检查，并取得用户明确确认。

### 3. 越过主库发布权限边界

workflow 使用 `LEGACY_RELEASE_TOKEN` 直接在 `yltx/AutoWSGR-GUI`：

- 检查 Release。
- 创建 Draft Release。
- 上传安装包和更新清单。
- 将 Release 从 Draft 改为正式发布。

这不符合当前仓库规则：主库只允许读取、同步和提交 PR，禁止直接 push、创建 Tag 或发布 Release。相关步骤必须移除，或改为只生成并校验交付物，由主库维护者在主库侧发布。

### 4. Alpha 到 Stable 的自动桥接尚未成立

Stable workflow 下载旧 Alpha Release 的 `alpha.yml` 和旧 Alpha 安装包，再原样附加到 Stable Release。该 `alpha.yml` 仍描述旧 Alpha 版本，不会自然变成目标 Stable 版本的更新清单。

同时，预发布客户端默认 `allow_test_updates=true`，更新器选择 `alpha` 频道。`acceptedChannels=['latest', 'alpha']` 只参与下载结果校验，不会让 electron-updater 同时请求 `latest.yml`。因此 Alpha 客户端可能继续读取旧 `alpha.yml`，无法发现 Stable。

必须重新设计目标 Stable 的 Alpha 兼容清单，并用真实 Release feed 或可控模拟器验证完整升级链路。

### 5. 设置频道会重新允许降级

`UpdaterIpc.ts` 先执行：

```ts
autoUpdater.allowDowngrade = false;
```

随后 `applyUpdatePolicy()` 设置 `autoUpdater.channel`。当前 `electron-updater` 的 `AppUpdater.channel` setter 会自动执行：

```ts
this.allowDowngrade = true;
```

而且每次检查更新前都会再次设置频道。因此 PR 实际上重新开启了降级，与“不允许降级”的目标相反。应在每次设置频道后显式恢复 `autoUpdater.allowDowngrade = false`，并增加行为测试。

## 非阻断观察

- `恢复说明.txt` 写死“2.0.1 -> 1.4.3”，但 PR 包版本是 `2.1.0-alpha.1`，文案来源版本不一致。
- 计划降级转换已有单元测试，但仍需要使用真实 1.4.3 程序读取导出文件，确认字段兼容性。
- `src/view/index.html` 随 HTML partial 一起修改，符合生成入口需要提交的规则；重建分支后仍应通过 `npm run build` 重新生成，不能手工搬运。
- 更新开关的 preload、IPC、Adapter、Controller 和配置持久化链路已经补齐，静态检查未发现缺失边界。

## 本次已完成工作

1. 建立隔离审查 worktree，固定 PR head `f7bf2f2`，未污染开发工作区。
2. 核对 PR 元数据、提交历史、真实文件范围和逐提交统计。
3. 静态审查计划导出、更新策略、配置 IPC、打包配置和 Release workflow。
4. 对顶部 3 笔提交执行 `git diff --check`，结果通过。
5. 确认 `electron-updater` 当前依赖实现中，设置 `channel` 会自动开启 `allowDowngrade`。
6. 创建远端长期分支 `ShiinaSakuya`，基线来自当时的 `ShiinaKuroko@3391cc2`。
7. 更新 `AGENTS.md` 的分支职责，并以提交 `77e2085` 同时推送到 `ShiinaSakuya` 和 `ShiinaKuroko`。
8. 未合并、cherry-pick、修改或关闭 PR #1。

本交接不声明 PR 自动化测试已经通过。由于原 PR 基线无效，应在拆分并重建提交后重新运行对应测试。

## 建议处理顺序

1. 以最新 `ShiinaKuroko` 为唯一目标，逐笔处理 3 个真实功能提交；不得将其中任何代码合入 `ShiinaSakuya`。
2. 分别审查“1.4.3 计划降级备份”和“Stable 更新桥接”，避免把两个功能范围作为一个整体验收。
3. 删除或重写直接发布 `yltx/AutoWSGR-GUI` 的 workflow 步骤。
4. 按用户确认的版本基线重做版本与频道配置，不沿用硬编码的 `2.1.0-alpha.1`。
5. 修复 `allowDowngrade` 被频道 setter 重新开启的问题。
6. 重新设计 Alpha 兼容清单，并完成真实升级链路验证。
7. 分别运行直接相关的 main service、renderer contract、build 和 release package 测试。
