/** 渲染当前舰队舰船、等级和损伤状态预览。 */
import type {
  ElectronBridge,
  ShipLibraryManifest,
  ShipLibraryShip,
} from '../../types/ipc.js';
import type { DailySortieStatsSnapshot } from '../../types/statistics.js';
import type { CurrentFleetShipVO } from '../../types/view.js';
import { createShipArtwork } from '../plan/ShipArtwork';

export type FleetPreviewViewHost = Pick<
  ElectronBridge,
  'getShipLibraryManifest'
>;

function formatCount(count: number, limit?: number): string {
  if (count === 0) return '-';
  return limit === undefined ? String(count) : `${count}/${limit}`;
}

/** 在主页展示当前运行任务明确携带的舰队。 */
export class FleetPreviewView {
  private readonly grid: HTMLElement;
  private readonly empty: HTMLElement;
  private manifest: ShipLibraryManifest | null | undefined;
  private manifestPromise: Promise<void> | null = null;
  private currentShips: CurrentFleetShipVO[] = [];
  private renderedSignature = '';
  private currentStats: DailySortieStatsSnapshot | null = null;
  private shipDetailsPinned = false;
  private readonly statsRoot: HTMLElement;
  private readonly battleCount: HTMLElement;
  private readonly quickRepairCount: HTMLElement;
  private readonly bathRepairCount: HTMLElement;
  private readonly lootCount: HTMLElement;
  private readonly shipCount: HTMLElement;
  private readonly expeditionCount: HTMLElement;
  private readonly shipToggle: HTMLButtonElement;
  private readonly shipDetails: HTMLElement;
  private readonly shipDropList: HTMLElement;
  private readonly dropNotice: HTMLElement;
  private readonly gradeCounts: Record<string, HTMLElement>;

  constructor(private readonly host: FleetPreviewViewHost) {
    this.grid = document.getElementById('current-fleet-preview')!;
    this.empty = document.getElementById('current-fleet-empty')!;
    this.statsRoot = document.getElementById('daily-sortie-stats')!;
    this.battleCount = document.getElementById('daily-battle-count')!;
    this.quickRepairCount = document.getElementById(
      'daily-quick-repair-count',
    )!;
    this.bathRepairCount = document.getElementById(
      'daily-bath-repair-count',
    )!;
    this.lootCount = document.getElementById('daily-loot-count')!;
    this.shipCount = document.getElementById('daily-ship-count')!;
    this.expeditionCount = document.getElementById(
      'daily-expedition-count',
    )!;
    this.shipToggle = document.getElementById(
      'daily-ship-toggle',
    ) as HTMLButtonElement;
    this.shipDetails = document.getElementById('daily-ship-details')!;
    this.shipDropList = document.getElementById('daily-ship-drop-list')!;
    this.dropNotice = document.getElementById('daily-drop-notice')!;
    this.gradeCounts = {
      SS: document.getElementById('daily-grade-ss')!,
      S: document.getElementById('daily-grade-s')!,
      A: document.getElementById('daily-grade-a')!,
      B: document.getElementById('daily-grade-b')!,
      C: document.getElementById('daily-grade-c')!,
      D: document.getElementById('daily-grade-d')!,
    };
    this.shipToggle.addEventListener('click', () => {
      if (!this.currentStats) return;
      if (!this.shipDetailsPinned && this.currentStats.dropNotice) {
        this.shipDetailsPinned = true;
      } else {
        this.shipDetailsPinned = !this.shipDetailsPinned;
      }
      this.renderStats(this.currentStats);
    });
  }

  render(
    ships: CurrentFleetShipVO[],
    hasRunningTask: boolean,
    stats: DailySortieStatsSnapshot,
  ): void {
    this.currentStats = stats;
    this.renderStats(stats);
    this.currentShips = ships
      .map(ship => ({
        name: ship.name.trim(),
        searchName: ship.searchName?.trim(),
      }))
      .filter(ship => Boolean(ship.name))
      .slice(0, 6);
    const hasFleet = this.currentShips.length > 0;
    this.grid.hidden = !hasFleet;
    this.empty.hidden = hasRunningTask || hasFleet;

    if (!hasFleet) {
      this.grid.replaceChildren();
      this.renderedSignature = '';
      return;
    }

    if (this.manifest !== undefined) {
      this.renderCards();
      return;
    }
    this.loadManifest();
  }

  private renderStats(stats: DailySortieStatsSnapshot): void {
    this.battleCount.textContent = formatCount(stats.battleCount);
    this.quickRepairCount.textContent = formatCount(stats.quickRepairCount);
    this.bathRepairCount.textContent = formatCount(stats.bathRepairCount);
    this.lootCount.textContent = formatCount(
      stats.lootCount,
      stats.lootLimit,
    );
    this.shipCount.textContent = formatCount(
      stats.shipCount,
      stats.shipLimit,
    );
    this.expeditionCount.textContent = formatCount(
      stats.expeditionCount,
    );
    for (const [grade, element] of Object.entries(this.gradeCounts)) {
      element.textContent = formatCount(
        stats.grades[grade as keyof typeof stats.grades],
      );
    }

    const notice = stats.dropNotice;
    this.dropNotice.hidden = !notice;
    this.dropNotice.textContent = notice
      ? `获得「${notice.shipName}」！今日第 ${notice.dailyIndex} 艘了！0v0！`
      : '';
    this.statsRoot.classList.toggle('has-drop-notice', Boolean(notice));
    this.shipToggle.classList.toggle('has-drop-notice', Boolean(notice));

    const detailsExpanded = this.shipDetailsPinned || Boolean(notice);
    this.shipToggle.setAttribute(
      'aria-expanded',
      String(detailsExpanded),
    );
    this.shipDetails.hidden = !detailsExpanded;
    if (!detailsExpanded) return;

    const fragment = document.createDocumentFragment();
    if (stats.shipDrops.length === 0) {
      const empty = document.createElement('span');
      empty.className = 'daily-ship-drop-empty';
      empty.textContent = '今日暂无舰船掉落';
      fragment.append(empty);
    } else {
      for (const drop of stats.shipDrops) {
        const row = document.createElement('div');
        row.className = 'daily-ship-drop-item';
        const name = document.createElement('span');
        name.textContent = drop.name;
        const count = document.createElement('b');
        count.textContent = `×${drop.count}`;
        row.append(name, count);
        fragment.append(row);
      }
    }
    this.shipDropList.replaceChildren(fragment);
  }

  private loadManifest(): void {
    if (this.manifestPromise) return;
    this.grid.setAttribute('aria-busy', 'true');
    this.manifestPromise = (async () => {
      try {
        this.manifest = await this.host.getShipLibraryManifest();
      } catch {
        this.manifest = null;
      } finally {
        this.grid.removeAttribute('aria-busy');
        this.manifestPromise = null;
        if (this.currentShips.length > 0) this.renderCards();
      }
    })();
  }

  private renderCards(): void {
    const signature = this.currentShips
      .map(ship => `${ship.name}\u0001${ship.searchName ?? ''}`)
      .join('\u0000');
    if (signature === this.renderedSignature) return;
    const fragment = document.createDocumentFragment();
    this.currentShips.forEach((ship, index) => {
      fragment.append(this.createCard(ship, index));
    });
    this.grid.replaceChildren(fragment);
    this.renderedSignature = signature;
  }

  private createCard(
    preview: CurrentFleetShipVO,
    index: number,
  ): HTMLElement {
    const card = document.createElement('div');
    card.className = 'current-fleet-card';
    card.title = preview.name;
    card.setAttribute('role', 'listitem');
    card.setAttribute('aria-label', `位置 ${index + 1}：${preview.name}`);

    const ship = this.findShip(preview);
    if (ship) {
      const typeLabel = this.manifest?.labels.ship_types[ship.ship_type]
        ?? ship.ship_type;
      card.append(createShipArtwork(ship, typeLabel));
    } else {
      const unknown = document.createElement('span');
      unknown.className = 'current-fleet-card-unknown';
      unknown.textContent = preview.name;
      card.append(unknown);
    }
    return card;
  }

  private findShip(preview: CurrentFleetShipVO): ShipLibraryShip | undefined {
    const ships = this.manifest?.ships ?? [];
    const exactNames = [preview.name, preview.searchName].filter(
      (name): name is string => Boolean(name),
    );
    for (const name of exactNames) {
      const match = ships.find(ship => ship.name === name)
        ?? ships.find(ship => ship.search_name === name);
      if (match) return match;
    }

    const baseNames = exactNames
      .map(name => name.split('·')[0].trim())
      .filter((name, index, names) => name && names.indexOf(name) === index);
    for (const name of baseNames) {
      const match = ships.find(ship => ship.name === name)
        ?? ships.find(ship => ship.search_name === name);
      if (match) return match;
    }
    return undefined;
  }
}
