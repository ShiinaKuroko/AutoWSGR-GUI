/** 管理任务组选择、增删改和 Model 到 ViewObject 的映射。 */
/**
 * TaskGroupController —— 任务组控制器（瘦身版）。
 * 核心逻辑委托给 addItems / queueLoader / contextMenu / metaLoader 模块。
 */
import {
  TaskGroupModel,
  type TaskGroupItem,
} from '../../model/TaskGroupModel';
import { TaskGroupView } from '../../view/taskGroup/TaskGroupView';
import { TemplateModel } from '../../model/TemplateModel';
import type { TaskGroupItemViewObject } from '../../types/view.js';
import { showAlert, showSaveSuccess } from '../../view/shared/DialogHelper';
import type { TaskGroupHost } from '../contracts.js';
import {
  addCurrentPlanToGroup,
  addDailyPlanToGroup,
  addManagedPlanToGroup,
  addPresetToGroup,
} from './addItems';
import {
  loadDailyPlanToQueue,
  loadGroupToQueue,
  loadSingleItemToQueue,
} from './queueLoader';
import { showContextMenuForItem, hideContextMenu, handleContextMenuEdit, type ContextMenuTarget, type ContextMenuHost } from './contextMenu';
import { loadItemMetas } from './metaLoader';
import { TaskListLoaderController } from './TaskListLoaderController';
import { DailyTaskLoaderController } from './DailyTaskLoaderController';
import { DailyTaskLoaderView } from '../../view/taskGroup/DailyTaskLoaderView';

function toTaskGroupItemViewObject(
  item: TaskGroupItem,
): TaskGroupItemViewObject {
  return {
    path: item.path,
    managedSource: item.managedSource,
    managedFile: item.managedFile,
    dailySource: item.dailySource,
    dailyFile: item.dailyFile,
    dailyTaskType: item.dailyTaskType,
    templateId: item.templateId,
    kind: item.kind,
    times: item.times,
    label: item.label,
  };
}

export class TaskGroupController {
  private contextMenuTarget: ContextMenuTarget | null = null;
  private readonly taskListLoader: TaskListLoaderController;
  private readonly dailyTaskLoader: DailyTaskLoaderController;

  constructor(
    private readonly taskGroupModel: TaskGroupModel,
    private readonly taskGroupView: TaskGroupView,
    private readonly templateModel: TemplateModel,
    private readonly mainView: { onDropFromTaskGroup?: (index: number) => void; onEditQueueItem?: (taskId: string, x: number, y: number) => void },
    readonly host: TaskGroupHost,
  ) {
    this.taskListLoader = new TaskListLoaderController(
      this.taskGroupModel,
      () => this.render(),
    );
    this.dailyTaskLoader = new DailyTaskLoaderController(
      new DailyTaskLoaderView(),
      {
        addToList: selection => addDailyPlanToGroup(
          this.taskGroupModel,
          selection,
          () => this.render(),
        ),
        addToQueue: selection => loadDailyPlanToQueue(
          selection,
          this.host,
        ),
      },
    );
  }

  bindActions(): void {
    this.dailyTaskLoader.bindActions();
    this.taskGroupView.onNewGroup = async () => {
      const baseName = '新任务列表';
      let name = baseName;
      let suffix = 2;
      while (this.taskGroupModel.getGroup(name)) {
        name = `${baseName} ${suffix}`;
        suffix += 1;
      }
      this.taskGroupModel.upsertGroup(name);
      this.taskGroupModel.setActiveGroup(name);
      await this.taskGroupModel.save();
      this.render();
    };

    this.taskGroupView.onSaveGroup = async () => {
      const active = this.taskGroupModel.getActiveGroup();
      const name = this.taskGroupView.getGroupName();
      if (!name) {
        await showAlert('提示', '请输入任务列表名称。');
        return;
      }
      if (!active) {
        this.taskGroupModel.upsertGroup(name);
        this.taskGroupModel.setActiveGroup(name);
      } else if (active.name !== name) {
        if (!this.taskGroupModel.renameGroup(active.name, name)) {
          await showAlert('提示', `名称「${name}」已被占用。`);
          return;
        }
      }
      const saved = await this.taskGroupModel.save();
      if (!saved) {
        await showAlert('保存失败', '任务列表未能写入本地文件。');
        return;
      }
      this.render();
      showSaveSuccess(`任务列表「${name}」保存成功`);
    };
    this.taskGroupView.onOpenGroupLoader = () => {
      this.taskListLoader.open();
    };

    this.taskGroupView.onRemoveItem = (index) => {
      const active = this.taskGroupModel.getActiveGroup();
      if (!active) return;
      this.taskGroupModel.removeItem(active.name, index);
      this.taskGroupModel.save();
      this.render();
    };

    this.taskGroupView.onTimesChange = (index, times) => {
      const active = this.taskGroupModel.getActiveGroup();
      if (!active) return;
      this.taskGroupModel.updateItemTimes(active.name, index, times);
      this.taskGroupModel.save();
    };

    this.taskGroupView.onMoveItem = (from, to) => {
      const active = this.taskGroupModel.getActiveGroup();
      if (!active) return;
      this.taskGroupModel.moveItem(active.name, from, to);
      this.taskGroupModel.save();
      this.render();
    };

    this.taskGroupView.onLoadAll = () => loadGroupToQueue(this.taskGroupModel, this.templateModel, this.host);
    this.taskGroupView.onAddManagedPlan = async () => {
      const selection = await this.host.pickManagedBattlePlan();
      if (!selection) return;
      addManagedPlanToGroup(
        this.taskGroupModel,
        selection.plan,
        selection.fleetPresetIndex,
        () => this.render(),
      );
    };
    this.taskGroupView.onAddDailyPlan = () => {
      this.dailyTaskLoader.open();
    };
    this.taskGroupView.onDropToQueue = () => {};
    this.taskGroupView.onLoadItem = (index) => {
      void loadSingleItemToQueue(
        index,
        this.taskGroupModel,
        this.templateModel,
        this.host,
      );
    };
    this.mainView.onDropFromTaskGroup = (index) => loadSingleItemToQueue(index, this.taskGroupModel, this.templateModel, this.host);

    this.taskGroupView.onEditItem = (index, x, y) => {
      this.contextMenuTarget = showContextMenuForItem('taskgroup', index, x, y);
    };
    this.mainView.onEditQueueItem = (taskId, x, y) => {
      this.contextMenuTarget = showContextMenuForItem('queue', taskId, x, y);
    };

    document.addEventListener('click', () => hideContextMenu());
    document.getElementById('ctx-edit')?.addEventListener('click', () => {
      handleContextMenuEdit(this.contextMenuTarget, this.taskGroupModel, this.host as ContextMenuHost);
      this.contextMenuTarget = null;
    });

    document.getElementById('btn-add-to-group')?.addEventListener('click', () => {
      addCurrentPlanToGroup(
        this.taskGroupModel,
        () => this.host.getCurrentPlan(),
        this.host.plansDir,
        () => this.render(),
      ).catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        void showAlert('加入任务组失败', msg);
      });
    });

    document.getElementById('btn-close-preset')?.addEventListener('click', () => this.host.closePresetDetail());
    document.getElementById('btn-tp-add-queue')?.addEventListener('click', () => this.host.executePreset());
    document.getElementById('btn-tp-add-group')?.addEventListener('click', () =>
      addPresetToGroup(this.taskGroupModel, () => this.host.getCurrentPresetInfo(), () => this.render()));

    document.getElementById('tp-fleet-enable-ex')?.addEventListener('change', (e) => {
      const checked = (e.target as HTMLInputElement).checked;
      document.getElementById('tp-fleet-grid-ex')!.style.display = checked ? '' : 'none';
    });
  }

  render(): void {
    const groups = this.taskGroupModel.groups;
    const active = this.taskGroupModel.getActiveGroup();
    const items = active?.items ?? [];
    const itemViews = items.map(toTaskGroupItemViewObject);

    this.taskGroupView.render({
      groups: groups.map(g => ({ name: g.name, itemCount: g.items.length })),
      activeGroupName: this.taskGroupModel.activeGroupName,
      items: itemViews,
    });

    if (items.length > 0) {
      loadItemMetas(items, this.templateModel).then(metas => {
        if (this.taskGroupModel.getActiveGroup()?.name !== active?.name) return;
        this.taskGroupView.render({
          groups: groups.map(g => ({ name: g.name, itemCount: g.items.length })),
          activeGroupName: this.taskGroupModel.activeGroupName,
          items: itemViews,
          itemMetas: metas,
        });
      });
    }
  }
}
