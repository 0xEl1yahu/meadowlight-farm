/**
 * DEALZ's chat at SLOPMART (farmclaws part 4d spec §6.2), in the shops' lazy chunk. It is built
 * like the chat box and wears its classes: DEALZ's name, the role line "SLOPMART 24/7 · A BARNABY
 * VENTURE", the line the slopShop panel carries and two buttons, Buy a mystery box and Leave.
 *
 * - `sync(state, prev)` redraws when `ui.panel` changes: the line changes for a result or a
 *   refusal, so the panel carries it and nothing is saved. What it shows comes from the pure
 *   slopShopView.
 * - Buy dispatches `slop/buy`, which gives every refusal's line and toast, so it stays enabled;
 *   Leave and Close dispatch `ui/closePanel`. E, K, Enter and Escape close it through panelKeyCommand.
 * - Narrower than ROBOT_SCREEN.phoneMaxWidth (isPhoneWidth) it takes the chat-box--phone modifier,
 *   as the chat box does. Buttons blur after mouse clicks but keep focus on keyboard activation.
 * - Text is written with textContent only; every listener uses the shops' AbortSignal.
 */
import type { GameState } from '../../core/types';
import { actions } from '../../state/actions';
import { isPhoneWidth } from '../chatBoxView';
import { closestWithin, h, hudButton, releasePointerFocus, setHidden, setText } from '../dom';
import type { ShopPanelContext } from './context';
import { slopShopView, type SlopShopView } from './viewModel';

export class SlopShopPanel {
  /** The layer that seats the chat box above the hotbar; it takes no clicks itself. */
  readonly element = h('div', 'slop-shop');
  private readonly box = h('section', 'hud-panel chat-box slop-shop__box');
  private readonly name = h('h2', 'chat-box__name');
  private readonly role = h('p', 'chat-box__role');
  private readonly line = h('p', 'chat-box__line');
  private readonly buttons = h('div', 'chat-box__actions');
  /** What the panel shows now; null while it's hidden. */
  private shown: SlopShopView | null = null;

  constructor(context: ShopPanelContext) {
    const nameId = `${context.idPrefix}-slop-name`;
    this.element.hidden = true;
    this.box.setAttribute('role', 'dialog');
    this.box.setAttribute('aria-labelledby', nameId);
    this.name.id = nameId;

    const heading = h('header', 'chat-box__heading');
    heading.append(this.name, this.role);
    const close = hudButton('hud-btn hud-btn--ghost chat-box__close', 'Close');
    close.title = 'Close (E / Esc)';
    this.box.append(heading, close, this.line, this.buttons);
    this.element.append(this.box);

    const signal = context.signal;
    close.addEventListener(
      'click',
      (event) => {
        releasePointerFocus(close, event);
        context.dispatch(actions.closePanel());
      },
      { signal },
    );
    this.buttons.addEventListener(
      'click',
      (event) => {
        const button = closestWithin(event, this.buttons, 'button[data-index]');
        const view = this.shown;
        if (button === null || view === null) return;
        releasePointerFocus(button, event);
        const chosen = view.buttons[Number(button.dataset.index)];
        if (chosen !== undefined) context.dispatch(chosen.action);
      },
      { signal },
    );

    const syncWidth = (): void => {
      this.box.classList.toggle('chat-box--phone', isPhoneWidth(window.innerWidth));
    };
    syncWidth();
    window.addEventListener('resize', syncWidth, { signal });
  }

  /** `prev` null redraws from scratch. */
  sync(state: GameState, prev: GameState | null): void {
    if (prev !== null && state.ui.panel === prev.ui.panel) return;
    const view = slopShopView(state);
    this.shown = view;
    setHidden(this.element, view === null);
    if (view === null) return;
    setText(this.name, view.name);
    setText(this.role, view.role);
    setText(this.line, view.line);
    this.buttons.replaceChildren(
      ...view.buttons.map((chosen, index) => {
        const style = chosen.primary ? 'hud-btn--primary' : 'hud-btn--ghost';
        const button = hudButton(`hud-btn ${style} chat-box__action`, chosen.label);
        button.dataset.index = String(index);
        return button;
      }),
    );
  }
}
