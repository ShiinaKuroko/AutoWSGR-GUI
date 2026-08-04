/** 处理主页面导航、标签切换和当前页面状态。 */
import { FleetPlannerController } from '../plan/FleetPlannerController';
import { PlanController } from '../plan/PlanController';

export interface NavigationControllerHost {
  readonly fleetPlannerController: FleetPlannerController;
  getPlanController(): PlanController;
  refreshAdbStatus(): Promise<void>;
  refreshShipLibraryStatus(): Promise<void>;
}

export class NavigationController {
  constructor(private readonly host: NavigationControllerHost) {}

  bindNavigation(): void {
    document.querySelectorAll<HTMLElement>('.nav-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        const pageId = tab.dataset['page'];
        if (pageId) this.switchPage(pageId);
      });
    });
  }

  bindPlanNavigation(): void {
    document.querySelectorAll<HTMLElement>('[data-plan-tab]').forEach((tab) => {
      tab.addEventListener('click', () => {
        const tabId = tab.dataset['planTab'];
        if (tabId) this.showPlanTab(tabId);
      });
    });
  }

  showPlanTab(tabId: string): void {
    document.querySelectorAll<HTMLElement>('[data-plan-tab]').forEach((tab) => {
      const active = tab.dataset['planTab'] === tabId;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll<HTMLElement>('[data-plan-panel]').forEach((panel) => {
      const active = panel.dataset['planPanel'] === tabId;
      panel.classList.toggle('active', active);
      panel.hidden = !active;
    });
    if (tabId === 'fleet') {
      void this.host.fleetPlannerController.load();
    } else if (tabId === 'scheme') {
      void this.host.getPlanController().ensureDefaultPlan();
    } else if (tabId === 'manage') {
      void this.host.fleetPlannerController.loadManagement();
    }
  }

  switchPage(pageId: string, planTab?: string): void {
    document.querySelectorAll('.nav-tab').forEach((t) => t.classList.remove('active'));
    document.querySelector(`.nav-tab[data-page="${pageId}"]`)?.classList.add('active');
    document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
    document.getElementById(`page-${pageId}`)?.classList.add('active');
    if (pageId === 'plan') {
      if (planTab) this.showPlanTab(planTab);
      const activeTab = document.querySelector<HTMLElement>('[data-plan-tab].active')
        ?.dataset['planTab'] ?? 'fleet';
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
