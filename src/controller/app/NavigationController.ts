/** 处理主页面导航、标签切换和当前页面状态。 */
import { NavigationView } from '../../view/main/NavigationView';

export interface NavigationControllerHost {
  loadFleetPlanner(): Promise<void>;
  ensureDefaultPlan(): Promise<void>;
  loadPlanManagement(): Promise<void>;
  refreshAdbStatus(): Promise<void>;
  refreshShipLibraryStatus(): Promise<void>;
}

export class NavigationController {
  constructor(
    private readonly host: NavigationControllerHost,
    private readonly view = new NavigationView(),
  ) {}

  bindNavigation(): void {
    this.view.onPageSelected = pageId => this.switchPage(pageId);
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

  switchPage(pageId: string, planTab?: string): void {
    this.view.showPage(pageId);
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
