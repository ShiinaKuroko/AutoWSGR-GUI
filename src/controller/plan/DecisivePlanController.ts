/** 独立持有决战舰队草稿并协调加载、编辑和保存。 */
import {
  decisivePlanRepository,
} from '../../adapter/IpcAdapter';
import type {
  DecisivePlanRepository,
} from '../../adapter/IpcAdapter';
import {
  DecisiveFleetDraft,
  DEFAULT_DECISIVE_PLAN_SETTINGS,
} from '../../model/fleet/DecisiveFleetDraft';
import {
  DecisivePlanView,
} from '../../view/plan/DecisivePlanView';
import type {
  DecisivePlanSaveResult,
  DecisivePlanViewState,
} from '../../view/plan/DecisivePlanView';

export class DecisivePlanController {
  private readonly draft = new DecisiveFleetDraft();
  private readonly view: DecisivePlanView;

  constructor(
    private readonly repository: DecisivePlanRepository =
      decisivePlanRepository,
  ) {
    this.view = new DecisivePlanView({
      getState: () => this.getViewState(),
      setChapter: chapter => this.draft.setChapter(chapter),
      setUseQuickRepair: useQuickRepair => (
        this.draft.setUseQuickRepair(useQuickRepair)
      ),
      findShip: name => this.draft.find(name),
      placeShip: (name, level, requestedIndex, maxIndex) => (
        this.draft.place(name, level, requestedIndex, maxIndex)
      ),
      removeShip: (level, index) => this.draft.remove(level, index),
      moveShip: (
        sourceLevel,
        sourceIndex,
        targetLevel,
        targetIndex,
      ) => this.draft.move(
        sourceLevel,
        sourceIndex,
        targetLevel,
        targetIndex,
      ),
      resetTeams: () => this.draft.resetTeams(),
      save: () => this.save(),
    });
  }

  bindActions(): void {
    this.view.bindActions();
  }

  async load(): Promise<void> {
    try {
      this.draft.load(await this.repository.loadSettings());
      const manifest = await this.repository.loadShipLibrary();
      this.view.showLoaded(manifest);
    } catch (error) {
      this.draft.load(DEFAULT_DECISIVE_PLAN_SETTINGS);
      this.view.showLoadFailure();
      console.error('[DecisivePlan] 读取配置失败', error);
    }
  }

  private getViewState(): DecisivePlanViewState {
    return {
      chapter: this.draft.chapter,
      useQuickRepair: this.draft.useQuickRepair,
      level1: [...this.draft.queue('level1')],
      level2: [...this.draft.queue('level2')],
      dirty: this.draft.dirty,
    };
  }

  private async save(): Promise<DecisivePlanSaveResult> {
    try {
      this.draft.load(
        await this.repository.saveSettings(this.draft.toSettings()),
      );
      return { success: true };
    } catch (error) {
      return { success: false, error };
    }
  }
}
