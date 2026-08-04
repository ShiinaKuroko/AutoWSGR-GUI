/** 渲染当前舰队舰船、等级和损伤状态预览。 */
import type {
  ElectronBridge,
  ShipLibraryManifest,
  ShipLibraryShip,
} from '../../types/ipc.js';
import type { CurrentFleetShipVO } from '../../types/view.js';
import { createShipArtwork } from '../plan/ShipArtwork';

export type FleetPreviewViewHost = Pick<
  ElectronBridge,
  'getShipLibraryManifest'
>;

/** 在主页展示当前运行任务明确携带的舰队。 */
export class FleetPreviewView {
  private readonly grid: HTMLElement;
  private readonly empty: HTMLElement;
  private manifest: ShipLibraryManifest | null | undefined;
  private manifestPromise: Promise<void> | null = null;
  private currentShips: CurrentFleetShipVO[] = [];
  private renderedSignature = '';

  constructor(private readonly host: FleetPreviewViewHost) {
    this.grid = document.getElementById('current-fleet-preview')!;
    this.empty = document.getElementById('current-fleet-empty')!;
  }

  render(ships: CurrentFleetShipVO[], hasRunningTask: boolean): void {
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
