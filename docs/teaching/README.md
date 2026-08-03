# 重构实践教学系列

> **目标读者**：编写 `main` 分支原始代码的初级工程师  
> **文档定位**：循序渐进的教学，用架构图 + 关键代码片段讲清楚"为什么改、怎么改"

> **规范说明**：本目录包含历史重构案例和教学快照，不是合并规范。当前强制要求以[工程与代码规范](../engineering-standards.md)为准。

## 阅读顺序

| # | 文档 | 内容 | 建议用时 |
|---|------|------|---------|
| 0 | [全局概览](00-overview.md) | 重构前后数据对比 + 完整架构图 | 10 min |
| 1 | [Extract Class — 拆分大文件](01-extract-class.md) | 按职责边界拆分 3000 行巨型文件 | 15 min |
| 2 | [Host 接口与依赖注入](02-host-interface.md) | 用最小接口替代隐式耦合 | 15 min |
| 3 | [ViewObject 单向数据流](03-viewobject-flow.md) | Model → Controller 拼装 → View 纯渲染 | 10 min |
| 4 | [Electron 主进程拆分](04-electron-split.md) | main.ts → backend / pythonEnv / emulatorDetect | 10 min |
| 5 | [View 层组织](05-view-layer.md) | Facade 模式 + 按功能域分子目录 | 10 min |
| 6 | [Model 层组织](06-model-layer.md) | Scheduler 子系统 + 独立领域模型 | 10 min |
| 7 | [类型系统分层](07-type-system.md) | model / view / api / scheduler 类型隔离 | 10 min |

**建议路线**：先读 00 → 01 → 02 → 03 了解核心理念，再按需阅读 04-07。
