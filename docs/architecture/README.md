# 架构文档

面向 AutoWSGR-GUI 开发者的架构参考文档。

> 本目录描述当前系统结构。强制性的依赖方向、状态所有权、迁移、验证和 Patch 止损要求见[工程与代码规范](../engineering-standards.md)。

## 目录

| # | 文档 | 说明 |
|---|------|------|
| 0 | [总架构文档](00-overview.md) | 项目简介、主进程组合根/IPC/Service 分层、渲染进程架构、启动流程 |
| 1 | [Controller 层](01-controller-layer.md) | ControllerHost/DI 模式、6 个子目录结构、StartupController 启动编排 |
| 2 | [任务调度系统](02-task-scheduling.md) | Scheduler、TaskQueue、CronScheduler、远征轮询、停止条件、修理轮换 |
| 3 | [配置系统](03-configuration.md) | ConfigModel、ConfigController、ConfigView、usersettings.yaml、gui_settings.json |
| 4 | [出击计划系统](04-battle-plan.md) | PlanModel、PlanController(拆分)、PlanPreviewView(Facade)、MapDataLoader |
| 5 | [模板与任务组](05-template-and-taskgroup.md) | TemplateController(拆分)、TaskGroupController(拆分)、模板视图、队列加载 |
| 6 | [后端通信](06-backend-communication.md) | IPC Bridge、ApiClient、REST API、WebSocket 事件 |
| 7 | [环境管理](07-environment-management.md) | pythonEnv/ 子模块(9 文件)、Python/CUDA/ADB 服务、后端进程生命周期 |
| 8 | [开发环境搭建](08-dev-setup.md) | 依赖安装、开发/构建/打包命令、SCSS 架构、调试技巧 |

## 阅读建议

- **新上手**：从 [总架构文档](00-overview.md) 开始，了解整体结构和启动流程
- **改某个功能**：直接跳到对应的子模块文档；Controller 层组织参见 [Controller 层](01-controller-layer.md)
- **搭建开发环境**：参见 [开发环境搭建](08-dev-setup.md)
