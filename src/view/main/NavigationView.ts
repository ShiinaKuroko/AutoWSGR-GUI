/** 管理主导航和计划子标签的 DOM 状态与用户意图。 */
export class NavigationView {
  private readonly navTabs: HTMLElement | null;
  private readonly navIndicator: HTMLElement | null;
  private readonly navResizeObserver: ResizeObserver | null;

  onPageSelected?: (pageId: string) => void;
  onPlanTabSelected?: (tabId: string) => void;

  constructor() {
    this.navTabs = document.querySelector<HTMLElement>('.nav-tabs');
    this.navIndicator = this.navTabs?.querySelector<HTMLElement>(
      '.nav-tab-indicator',
    ) ?? null;

    document.querySelectorAll<HTMLElement>('.nav-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        const pageId = tab.dataset['page'];
        if (pageId) this.onPageSelected?.(pageId);
      });
    });
    document.querySelectorAll<HTMLElement>('[data-plan-tab]').forEach(
      (tab) => {
        tab.addEventListener('click', () => {
          const tabId = tab.dataset['planTab'];
          if (tabId) this.onPlanTabSelected?.(tabId);
        });
      },
    );

    this.updateNavigationIndicator();
    requestAnimationFrame(() => {
      this.navIndicator?.classList.add('is-ready');
    });

    if (this.navTabs) {
      this.navResizeObserver = new ResizeObserver(
        () => this.updateNavigationIndicator(),
      );
      this.navResizeObserver.observe(this.navTabs);
    } else {
      this.navResizeObserver = null;
    }
  }

  showPage(pageId: string): void {
    document.querySelectorAll<HTMLElement>('.nav-tab').forEach((tab) => {
      tab.classList.toggle('active', tab.dataset['page'] === pageId);
    });
    this.updateNavigationIndicator();
    document.querySelectorAll<HTMLElement>('.page').forEach((page) => {
      page.classList.toggle('active', page.id === `page-${pageId}`);
    });
  }

  showPlanTab(tabId: string): void {
    document.querySelectorAll<HTMLElement>('[data-plan-tab]').forEach(
      (tab) => {
        const active = tab.dataset['planTab'] === tabId;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-selected', String(active));
      },
    );
    document.querySelectorAll<HTMLElement>('[data-plan-panel]').forEach(
      (panel) => {
        const active = panel.dataset['planPanel'] === tabId;
        panel.classList.toggle('active', active);
        panel.hidden = !active;
      },
    );
  }

  getActivePlanTab(): string {
    return document.querySelector<HTMLElement>('[data-plan-tab].active')
      ?.dataset['planTab'] ?? 'fleet';
  }

  getActivePage(): string {
    return document.querySelector<HTMLElement>('.nav-tab.active')
      ?.dataset['page'] ?? 'main';
  }

  private updateNavigationIndicator(): void {
    const activeTab = this.navTabs?.querySelector<HTMLElement>(
      '.nav-tab.active',
    );
    if (!activeTab || !this.navIndicator) return;

    this.navIndicator.style.width = `${activeTab.offsetWidth}px`;
    this.navIndicator.style.transform = (
      `translate3d(${activeTab.offsetLeft}px, 0, 0)`
    );
  }
}
