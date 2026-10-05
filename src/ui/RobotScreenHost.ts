/**
 * Opens the robot screen (farmclaws part 3 spec §4.1). The host lives in the main chunk; the
 * screen itself (src/ui/robotScreen/) is one dynamic import, made the first time a robot panel
 * opens, so the screen's code, and the Blockly editor it loads in turn, stay out of the game's
 * first download.
 *
 * - While the module loads, a card says "Opening…".
 * - When the import fails, the panel closes with a warning toast and the robot is untouched.
 *   The failed attempt is forgotten, so the next robot panel tries again.
 * - While the card shows, Escape closes the panel, so a stalled import can't trap the player (the
 *   input controller leaves every key alone while a robot panel is open). The listener lives only
 *   while the card shows.
 * - It dispatches only from the import's promise callbacks and that key listener, never from sync.
 */
import type { Store } from '../core/store';
import type { GameState } from '../core/types';
import { actions, type GameAction } from '../state/actions';
import { h, setHidden } from './dom';
import type { RobotScreen } from './robotScreen/RobotScreen';

export interface RobotScreenHostOptions {
  /** The HUD root (#hud); the screen and its loading card are appended to it. */
  readonly root: HTMLElement;
  readonly store: Store<GameState, GameAction>;
}

const LOADING_TEXT = 'Opening…';
const LOAD_FAILED_TEXT = "The robot screen couldn't load. Try again.";

export class RobotScreenHost {
  private readonly root: HTMLElement;
  private readonly store: Store<GameState, GameAction>;
  private readonly loading = h('div', 'robot-screen-loading');
  private screen: RobotScreen | null = null;
  /** True while the import is in flight. */
  private importing = false;
  /** True while the screen shows a robot panel. */
  private showing = false;
  private disposed = false;
  /** Aborts the loading card's Escape listener; non-null only while the card shows. */
  private escapeListener: AbortController | null = null;

  constructor(options: RobotScreenHostOptions) {
    this.root = options.root;
    this.store = options.store;
    this.loading.hidden = true;
    this.loading.setAttribute('role', 'status');
    this.loading.append(h('div', 'robot-screen-loading__card', LOADING_TEXT));
    this.root.append(this.loading);
  }

  sync(state: GameState, prev: GameState | null): void {
    if (this.disposed) return;
    if (state.ui.panel.kind !== 'robot') {
      this.hideLoading();
      if (this.showing) {
        this.showing = false;
        this.screen?.close();
      }
      return;
    }
    const screen = this.screen;
    if (screen === null) {
      this.showLoading();
      this.load();
      return;
    }
    if (!this.showing || prev === null) {
      this.showing = true;
      screen.open(state);
      return;
    }
    screen.sync(state, prev);
  }

  dispose(): void {
    this.disposed = true;
    this.stopEscape();
    this.screen?.dispose();
    this.screen = null;
    this.loading.remove();
  }

  private showLoading(): void {
    setHidden(this.loading, false);
    if (this.escapeListener !== null) return;
    const abort = new AbortController();
    this.escapeListener = abort;
    window.addEventListener('keydown', this.onLoadingKey, { capture: true, signal: abort.signal });
  }

  private hideLoading(): void {
    setHidden(this.loading, true);
    this.stopEscape();
  }

  private stopEscape(): void {
    this.escapeListener?.abort();
    this.escapeListener = null;
  }

  private readonly onLoadingKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || event.isComposing || this.disposed) return;
    event.preventDefault();
    event.stopPropagation();
    this.stopEscape();
    this.store.dispatch(actions.closePanel());
  };

  private load(): void {
    if (this.importing) return;
    this.importing = true;
    import('./robotScreen/RobotScreen').then(
      ({ RobotScreen: Screen }) => {
        this.importing = false;
        if (this.disposed) return;
        const screen = new Screen({ root: this.root, store: this.store });
        this.screen = screen;
        this.hideLoading();
        const state = this.store.getState();
        if (state.ui.panel.kind === 'robot') {
          this.showing = true;
          screen.open(state);
        }
      },
      () => {
        this.importing = false;
        if (this.disposed) return;
        this.hideLoading();
        if (this.store.getState().ui.panel.kind !== 'robot') return;
        this.store.dispatch(actions.closePanel());
        this.store.dispatch(actions.notify(LOAD_FAILED_TEXT, 'warn'));
      },
    );
  }
}
