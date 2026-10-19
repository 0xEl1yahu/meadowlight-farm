/**
 * The shops (farmclaws part 4b spec §10): one lazy chunk, loaded by ShopsHost the first time a
 * shop panel opens, holding Marigold's seed shop, Sol's parts shop, Juniper's workshop and DEALZ's chat at SLOPMART. Each panel shows itself
 * while its `ui.panel` kind is open and hides otherwise, so the screen just passes every state on.
 */
import './shops.css';
import type { Store } from '../../core/store';
import type { GameState } from '../../core/types';
import type { GameAction } from '../../state/actions';
import { ItemIconCache } from '../slots';
import type { ShopPanelContext } from './context';
import { PartsShopPanel } from './PartsShopPanel';
import { SeedShopPanel } from './SeedShopPanel';
import { SlopShopPanel } from './SlopShopPanel';
import { WorkshopPanel } from './WorkshopPanel';

export interface ShopsScreenOptions {
  /** The HUD's shops layer; the panels are appended to it. */
  readonly root: HTMLElement;
  readonly store: Store<GameState, GameAction>;
}

let screenCount = 0;

export class ShopsScreen {
  private readonly lifetime = new AbortController();
  private readonly seeds: SeedShopPanel;
  private readonly parts: PartsShopPanel;
  private readonly workshop: WorkshopPanel;
  private readonly slop: SlopShopPanel;

  constructor(options: ShopsScreenOptions) {
    screenCount += 1;
    const store = options.store;
    const context: ShopPanelContext = {
      dispatch: (action) => {
        store.dispatch(action);
      },
      signal: this.lifetime.signal,
      icons: new ItemIconCache(),
      idPrefix: `shops${screenCount}`,
    };
    this.seeds = new SeedShopPanel(context);
    this.parts = new PartsShopPanel(context);
    this.workshop = new WorkshopPanel(context);
    this.slop = new SlopShopPanel(context);
    options.root.append(this.seeds.element, this.parts.element, this.workshop.element, this.slop.element);
  }

  /** `prev` null redraws the open panel from scratch. */
  sync(state: GameState, prev: GameState | null): void {
    this.seeds.sync(state, prev);
    this.parts.sync(state, prev);
    this.workshop.sync(state, prev);
    this.slop.sync(state, prev);
  }

  dispose(): void {
    this.lifetime.abort();
    this.seeds.element.remove();
    this.parts.element.remove();
    this.workshop.element.remove();
    this.slop.element.remove();
  }
}
