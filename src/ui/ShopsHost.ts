/**
 * Opens the shops (farmclaws part 4b spec §10). The host lives in the main chunk; the shops
 * themselves (src/ui/shops/: Marigold's seed shop and Sol's parts shop) are one dynamic import,
 * made the first time a shop panel opens, so their code stays out of the game's first download.
 *
 * - While the module loads, a card says "Opening…". Escape still closes the panel through the
 *   ordinary panel keys, so a stalled import can't trap the player.
 * - When the import fails, the panel closes with a warning toast. The failed attempt is
 *   forgotten, so the next shop panel tries again.
 * - Once loaded, every state goes to the shops, which show the open shop's panel and hide the rest.
 * - It dispatches only from the import's promise callbacks, never from sync.
 */
import type { Store } from '../core/store';
import type { GameState, UiPanel } from '../core/types';
import { actions, type GameAction } from '../state/actions';
import { h, setHidden } from './dom';
import type { ShopsScreen } from './shops/ShopsScreen';

export interface ShopsHostOptions {
  /** The HUD's shops layer (Hud.shopsLayer); the shops and their loading card are appended to it. */
  readonly root: HTMLElement;
  readonly store: Store<GameState, GameAction>;
}

/** The panels the shops chunk draws. */
const SHOP_PANELS: ReadonlySet<UiPanel['kind']> = new Set(['shop', 'partsShop', 'workshop']);

const LOADING_TEXT = 'Opening…';
const LOAD_FAILED_TEXT = "The shop didn't open. Try again.";

export class ShopsHost {
  private readonly root: HTMLElement;
  private readonly store: Store<GameState, GameAction>;
  private readonly loading = h('div', 'robot-screen-loading');
  private screen: ShopsScreen | null = null;
  /** True while the import is in flight. */
  private importing = false;
  private disposed = false;

  constructor(options: ShopsHostOptions) {
    this.root = options.root;
    this.store = options.store;
    this.loading.hidden = true;
    this.loading.setAttribute('role', 'status');
    this.loading.append(h('div', 'robot-screen-loading__card', LOADING_TEXT));
    this.root.append(this.loading);
  }

  sync(state: GameState, prev: GameState | null): void {
    if (this.disposed) return;
    if (this.screen !== null) {
      this.screen.sync(state, prev);
      return;
    }
    const open = SHOP_PANELS.has(state.ui.panel.kind);
    setHidden(this.loading, !open);
    if (open) this.load();
  }

  dispose(): void {
    this.disposed = true;
    this.screen?.dispose();
    this.screen = null;
    this.loading.remove();
  }

  private load(): void {
    if (this.importing) return;
    this.importing = true;
    import('./shops/ShopsScreen').then(
      ({ ShopsScreen: Screen }) => {
        this.importing = false;
        if (this.disposed) return;
        const screen = new Screen({ root: this.root, store: this.store });
        this.screen = screen;
        setHidden(this.loading, true);
        screen.sync(this.store.getState(), null);
      },
      () => {
        this.importing = false;
        if (this.disposed) return;
        setHidden(this.loading, true);
        if (!SHOP_PANELS.has(this.store.getState().ui.panel.kind)) return;
        this.store.dispatch(actions.closePanel());
        this.store.dispatch(actions.notify(LOAD_FAILED_TEXT, 'warn'));
      },
    );
  }
}
