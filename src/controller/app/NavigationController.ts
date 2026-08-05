/** 处理主页面导航、标签切换和当前页面状态。 */
import { FleetPlannerController } from '../plan/FleetPlannerController';
import { PlanController } from '../plan/PlanController';
import { NavigationView } from '../../view/main/NavigationView';

export interface NavigationControllerHost {
  readonly fleetPlannerController: FleetPlannerController;
  getPlanController(): PlanController;
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
      void this.host.fleetPlannerController.load();
    } else if (tabId === 'scheme') {
      void this.host.getPlanController().ensureDefaultPlan();
    } else if (tabId === 'manage') {
      void this.host.fleetPlannerController.loadManagement();
    }
  }

  switchPage(pageId: string, planTab?: string): void {
    this.view.showPage(pageId);
    if (pageId === 'plan') {
      if (planTab) this.showPlanTab(planTab);
      const activeTab = this.view.getActivePlanTab();
      if (activeTab === 'fleet') {
        void this.host.fleetPlannerController.load();
      }
    }
    if (pageId === 'config') {
      void this.host.refreshAdbStatus();
      void this.host.refreshShipLibraryStatus();
    }
  }
}
