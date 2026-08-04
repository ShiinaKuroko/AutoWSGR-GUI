# 出击计划系统

> 涉及文件：`src/model/PlanModel.ts` · `src/controller/plan/` · `src/view/plan/` · `src/model/MapDataLoader.ts` · `electron/services/CombatPlanCodec.ts` · `electron/services/CombatPlanRepository.ts` · `electron/services/PlanManagementService.ts` · `electron/services/RuntimePlanService.ts` · `electron/ipc/CombatPlanIpc.ts` · `resource/system_battle_plans/` · `resource/maps/`

## 概述

出击计划（Plan）是 AutoWSGR-GUI 的核心数据结构，定义了一次战斗出击的完整策略：打哪张地图、经过哪些节点、每个节点用什么阵型、是否夜战、迂回规则、修理策略等。

计划以 YAML 文件存储，可通过 GUI 的可视化地图编辑器进行查看和修改。

---

## 数据结构

### PlanData — 方案主体

```typescript
interface PlanData {
  chapter: number;          // 章节号
  map: number;              // 地图号
  selected_nodes: string[]; // 选中的节点列表，如 ["A", "D", "G", "H"]
  fight_condition?: 1|2|3|4|5;  // 出击条件
  repair_mode?: number | number[]; // 修理策略（单值或按舰位数组）
  fleet_id?: number;        // 编队号 (1-4)
  node_defaults?: NodeArgs; // 节点默认参数
  node_args?: Record<string, NodeArgs>; // 按节点覆盖的参数
  fleet_presets?: FleetPreset[];  // 内嵌的编队预设
  times?: number;           // 执行次数
  stop_condition?: StopCondition; // 停止条件
}
```

### NodeArgs — 节点参数

```typescript
interface NodeArgs {
  formation?: 1|2|3|4|5;   // 阵型
  night?: boolean;          // 是否夜战
  proceed?: boolean;        // 是否继续前进
  enemy_rules?: [string, string|number][];  // 索敌规则
}
```

**阵型映射**：`1=单纵阵` `2=复纵阵` `3=轮形阵` `4=梯形阵` `5=单横阵`

**出击条件**：`1=稳步前进` `2=火力万岁` `3=全速前进` `4=跛行前进` `5=连续作战`

**索敌规则**示例：
```yaml
enemy_rules:
  - [AP >= 1, 4]      # 有补给舰 → 梯形阵
  - [AP < 1, detour]   # 无补给舰 → 迂回
```

### FleetPreset — 编队预设

```typescript
interface FleetPreset {
  name: string;
  ships: (string | ShipFilter)[];  // 6 个舰位：具体舰名或模糊筛选
}

interface ShipFilter {
  nation?: string;     // 国籍筛选
  ship_type?: string;  // 舰型筛选
}
```

编队预设支持**具体舰名**（如 `"85工程"`）和**模糊筛选**（如 `{nation: "苏联", ship_type: "dd"}`），后者在执行时由 `resolveFleetPreset()` 解析为实际舰船。

没有顶层 `name` 的槽位可以只包含结构化 `candidates`。此时候选项是平等
替代项，GUI 不得把第一个候选提升为主选；只有旧版字符串候选列表才按旧
格式推断第一项为主选。

---

## YAML 示例

```yaml
# 捞胖次 9-2
chapter: 9
map: 2
selected_nodes: [A, D, G, H, M, O, E, K]
fight_condition: 1
repair_mode: 2
fleet_id: 1
node_defaults:
  formation: 4
  night: false
  proceed: true
node_args:
  A:
    enemy_rules:
      - [AP >= 1, 4]
      - [AP < 1, detour]
fleet_presets:
  - name: 三响岛风
    ships: [85工程, AIII, 岛风, 科罗廖夫, 列宁格勒, 伏尔加格勒]
```

---

## 方案类型

| 类型 | `task_type` | 说明 |
|------|-------------|------|
| 常规出击 | 无 / `normal_fight` | 标准章节出击 |
| 战役 | `campaign` | 战役任务 |
| 演习 | `exercise` | 自动演习 |
| 决战 | `decisive` | 决战模式，含 `level1` / `level2` 目标舰队 |
| 活动 | `event_fight` | 活动地图出击 |

---

## 核心组件

### PlanModel — 方案解析器

| 方法 | 说明 |
|------|------|
| `fromYaml(yamlStr)` | 解析 YAML → `PlanData` 对象 |
| `toYaml(plan)` | 序列化 `PlanData` → YAML 字符串 |
| `getNodeArgs(plan, node)` | 获取指定节点的合并后参数（node_args 覆盖 node_defaults） |
| `mergeFleetPreset(plan, presetIndex)` | 将编队预设合并到方案的 fleet_id 中 |

### MapDataLoader — 地图数据加载

地图 JSON 存放在 `resource/maps/` 目录，包含节点坐标、类型、连线等信息。

| 方法 | 说明 |
|------|------|
| `load(chapter, map)` | 通过 IPC 加载地图 JSON，返回 `MapData`，结果缓存 |
| `loadEx(chapter)` | 加载 Ex 章节地图 |

```typescript
interface MapData {
  nodes: MapNode[];   // 节点列表
  edges: MapEdge[];   // 连线列表
}

interface MapNode {
  id: string;         // 节点标识，如 "A", "B"
  x: number;          // 坐标 X
  y: number;          // 坐标 Y
  type: string;       // 节点类型（战斗、资源、Boss）
  detour?: boolean;   // 是否可迂回
  night?: boolean;    // 是否夜战节点
}
```

### PlanController — 方案控制器

方案控制器位于 `src/controller/plan/`，拆分为多个模块：

| 文件 | 职责 |
|------|------|
| `PlanController.ts` | 主控制器：持有当前方案状态，协调下属模块 |
| `presetFlow.ts` | 任务预设的导入/查看/关闭/执行流程 |
| `nodeEditor.ts` | 从 UI 收集节点阵型/夜战/索敌规则并写回 PlanData |
| `rendering.ts` | 构建 `PlanPreviewViewObject`，协调地图数据和方案数据的合并 |

### PlanPreviewView — 方案预览视图 (Facade)

`PlanPreviewView` 作为 Facade 持有三个子视图，Controller 只与 Facade 交互：

| 子视图 | 文件 | 职责 |
|--------|------|------|
| `MapView` | `view/plan/MapView.ts` | 地图节点/连线渲染、节点类型图标/名称常量 |
| `NodeEditorView` | `view/plan/NodeEditorView.ts` | 节点详细编辑器（阵形、夜战、继续条件） |
| `FleetPresetView` | `view/plan/FleetPresetView.ts` | 编队预设列表管理（添加、编辑、删除） |
| `FleetEditDialog` | `view/plan/FleetEditDialog.ts` | 编队预设编辑弹窗（支持舰船自动补全） |

---

## 主进程计划流水线

作战计划在主进程按职责拆分，IPC Adapter 不直接解析或写 YAML：

| 模块 | 职责 |
|------|------|
| `CombatPlanIpc` | 处理本地 YAML 选择、冲突确认及受管计划 IPC 边界 |
| `PlanManagementService` | 管理页汇总、导入升级、保存、重命名、删除和运行时准备 |
| `LegacyPlanMigration` | 启动时升级旧计划、拆分舰队并迁移任务组引用 |
| `CombatPlanCodec` | YAML 根校验、未知字段保留、编队引用拆分与展开 |
| `CombatPlanRepository` | 系统/用户目录、受管路径和原子文件操作 |
| `RuntimePlanService` | 展开舰队引用并写入当前进程的临时执行目录 |

系统计划从只读 `resource/system_battle_plans/` 读取，用户计划写入 Electron
`userData/user_battle_plans/`，用户舰队写入
`userData/user_team_plans/`。两类计划均通过 GUI 统一清单加载和管理。
执行前生成的临时计划位于
`<temp>/AutoWSGR-GUI/runtime_battle_plans/<pid>/`，文件序号只由
`RuntimePlanService` 持有。

保存计划时，内嵌 `fleet_presets` 被拆成独立编队文件；运行时再按来源优先级
展开引用。YAML 根对象、文件开头注释和不认识的字段必须保留。

v5 迁移会扫描旧 `plans/`、`resource/user_*`，并递归识别安装目录中的有效
计划 YAML。旧 YAML 经当前 Codec 升级并按 `bettle-*`、`team-*` 规范重命名
后写入用户目录，源文件保留。不同内容的同名计划或舰队保存为“（旧版）”
副本，计划中的舰队引用和旧任务组的受管文件名同步更新。完成项按旧来源路径
和内容哈希记录，实际输出文件名也写入迁移状态；第二次启动不会重复处理或把
引用改回默认文件名。若同名目标与升级结果一致，则直接复用目标，并保留用户
之后修改的编队。

计划加载浮窗提供“添加本地 YAML”。用户显式选择的 YAML 会经过同一套
Codec 升级、拆分舰队并按规范命名后写入用户受管目录，源文件保持不变；
同名目标必须由用户确认后才会覆盖。外部文件路径不会进入任务队列，运行时
仍只读取受管计划。计划页不再提供独立的手工转换入口。

---

## 数据流

```mermaid
flowchart TB
  subgraph Input["输入"]
    YAML["方案 YAML 文件"]
    Builtin["系统方案<br/>resource/system_battle_plans/"]
  end

  subgraph Parse["解析"]
    PM["PlanModel.fromYaml()"]
    ML["MapDataLoader.load()"]
  end

  subgraph Edit["编辑 & 预览"]
    PC["PlanController"]
    PV["PlanPreviewView"]
  end

  subgraph Execute["执行"]
    REQ["构建 TaskRequest"]
    SCHED["Scheduler.addTask()"]
  end

  YAML --> PM
  Builtin --> PM
  PM --> PC
  PC --> ML
  ML --> PC
  PC -->|"ViewObject"| PV
  PV -->|"用户编辑节点"| PC
  PC -->|"更新 PlanData"| PM
  PM -->|"toYaml()"| YAML

  PC -->|"executePreset()"| REQ
  REQ --> SCHED
```

---

## 系统方案

`resource/system_battle_plans/` 当前包含 10 个周常预制方案：

| 分类 | 数量 | 示例 |
|------|------|------|
| 周常 | 10 | `bettle-周常-1-1.yaml` ~ `bettle-周常-10-1.yaml` |

---

## 与其他系统的关系

- **任务调度**：方案通过 `controller/plan/presetFlow.ts` 的 `executePresetFlow()` 构建 `TaskRequest` 后交给 `Scheduler`
- **模板与任务组**：模板的 `planPaths` 引用方案文件；任务组 item 可以是 `kind: "plan"` 类型
- **配置系统**：方案中的 `fleet_id` 和 `repair_mode` 可被配置页覆盖
- **共享组件**：`view/shared/ShipAutocomplete.ts` 提供舰船名自动补全，被 `FleetEditDialog` 使用
