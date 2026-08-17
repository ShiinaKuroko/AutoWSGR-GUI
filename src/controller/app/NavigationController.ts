/** 处理主页面导航、标签切换和当前页面状态。 */
import { NavigationView } from '../../view/main/NavigationView';
import { showConfirm } from '../../view/shared/DialogHelper';
import {
  getNavigationGateway,
  type NavigationGateway,
} from '../../adapter/IpcAdapter.js';

export interface NavigationControllerHost {
  loadFleetPlanner(): Promise<void>;
  ensureDefaultPlan(): Promise<void>;
  loadPlanManagement(): Promise<void>;
  refreshAdbStatus(): Promise<void>;
  refreshShipLibraryStatus(): Promise<void>;
  hasUnsavedConfigChanges(): boolean;
}

export class NavigationController {
  private configLeavePromptOpen = false;

  constructor(
    private readonly host: NavigationControllerHost,
    private readonly view = new NavigationView(),
    private readonly gateway: NavigationGateway | undefined =
      getNavigationGateway(),
  ) {}

  bindNavigation(): void {
    this.view.onPageSelected = pageId => void this.switchPage(pageId);
  }

  /** 开启窗口记忆时恢复上次退出时所在的主导航页面。 */
  restoreLastActivePage(): void {
    if (!this.gateway) return;
    let preferences;
    try {
      preferences = this.gateway.getWindowPreferences();
    } catch {
      return;
    }
    if (!preferences.rememberBounds) return;
    const target = preferences.lastActivePage;
    if (!target || this.view.getActivePage() === target) return;
    void this.switchPage(target);
  }

  bindPlanNavigation(): void {
    this.view.onPlanTabSelected = tabId => this.showPlanTab(tabId);
  }

  showPlanTab(tabId: string): void {
    this.view.showPlanTab(tabId);
    if (tabId === 'fleet') {
      void this.host.loadFleetPlanner();
    } else if (tabId === 'scheme') {
      void this.host.ensureDefaultPlan();
    } else if (tabId === 'manage') {
      void this.host.loadPlanManagement();
    }
  }

  async switchPage(pageId: string, planTab?: string): Promise<void> {
    if (
      this.view.getActivePage() === 'config'
      && pageId !== 'config'
      && this.host.hasUnsavedConfigChanges()
    ) {
      if (this.configLeavePromptOpen) return;
      this.configLeavePromptOpen = true;
      try {
        const confirmed = await showConfirm(
          '设置尚未保存',
          '当前配置尚未保存，请及时保存设置。是否仍然切换页面？',
        );
        if (!confirmed) return;
      } finally {
        this.configLeavePromptOpen = false;
      }
    }

    this.view.showPage(pageId);
    void this.gateway?.rememberActivePage(pageId);
    if (pageId === 'plan') {
      if (planTab) this.showPlanTab(planTab);
      const activeTab = this.view.getActivePlanTab();
      if (activeTab === 'fleet') {
        void this.host.loadFleetPlanner();
      }
    }
    if (pageId === 'config') {
      void this.host.refreshAdbStatus();
      void this.host.refreshShipLibraryStatus();
    }
  }
}
