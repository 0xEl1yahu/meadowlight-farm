/**
 * The chat box (farmclaws part 4a spec §3.2): while the talk panel is open, a panel along the
 * bottom of the screen, above the hotbar, with the character's name, their role line under it in
 * smaller text, the line the talk panel carries and a row of action buttons. Close sits at the
 * top right.
 *
 * - `sync(state, prev)` redraws only when `ui.panel` changes. What it shows comes from the pure
 *   chatBoxView, so the line is never picked again while the box is open.
 * - An action button dispatches `talk/act` for the character shown; Close dispatches
 *   `ui/closePanel`. E, K, Enter and Escape close the box through panelKeyCommand. Buttons blur
 *   after mouse clicks but keep focus on keyboard activation, like the modals' buttons.
 * - Narrower than ROBOT_SCREEN.phoneMaxWidth (isPhoneWidth) the box takes the chat-box--phone
 *   modifier: it spans the screen and its buttons wrap. The width is read again on every resize.
 * - The context hint hides while any panel is open, so nothing else sits where the box does.
 * - Text is written with textContent only; every listener uses the HUD's AbortSignal.
 */
import type { GameState } from '../core/types';
import { actions, type GameAction } from '../state/actions';
import { chatBoxView, isPhoneWidth, type ChatBoxView } from './chatBoxView';
import { closestWithin, h, hudButton, releasePointerFocus, setHidden, setText } from './dom';

/** What the chat box needs from the HUD's shared context. */
export interface ChatBoxContext {
  readonly dispatch: (action: GameAction) => void;
  /** Aborted when the HUD is disposed. */
  readonly signal: AbortSignal;
  /** Unique prefix for element ids (aria-labelledby). */
  readonly idPrefix: string;
}

export class ChatBox {
  readonly element = h('section', 'hud-panel chat-box');
  private readonly name = h('h2', 'chat-box__name');
  private readonly role = h('p', 'chat-box__role');
  private readonly line = h('p', 'chat-box__line');
  private readonly buttons = h('div', 'chat-box__actions');
  /** What the box shows now; null while it's hidden. */
  private shown: ChatBoxView | null = null;

  constructor(context: ChatBoxContext) {
    const nameId = `${context.idPrefix}-chat-name`;
    this.element.hidden = true;
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-labelledby', nameId);
    this.name.id = nameId;

    const heading = h('header', 'chat-box__heading');
    heading.append(this.name, this.role);
    const close = hudButton('hud-btn hud-btn--ghost chat-box__close', 'Close');
    close.title = 'Close (E / Esc)';
    this.element.append(heading, close, this.line, this.buttons);

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
        const action = view.actions[Number(button.dataset.index)];
        if (action !== undefined) context.dispatch(actions.npcAct(view.npc, action.kind));
      },
      { signal },
    );

    const syncWidth = (): void => {
      this.element.classList.toggle('chat-box--phone', isPhoneWidth(window.innerWidth));
    };
    syncWidth();
    window.addEventListener('resize', syncWidth, { signal });
  }

  sync(state: GameState, prev: GameState | null): void {
    if (prev !== null && state.ui.panel === prev.ui.panel) return;
    const view = chatBoxView(state);
    this.shown = view;
    setHidden(this.element, view === null);
    if (view === null) return;
    setText(this.name, view.name);
    setText(this.role, view.role);
    setText(this.line, view.line);
    this.buttons.replaceChildren(
      ...view.actions.map((action, index) => {
        const button = hudButton('hud-btn hud-btn--primary chat-box__action', action.label);
        button.dataset.index = String(index);
        return button;
      }),
    );
    setHidden(this.buttons, view.actions.length === 0);
  }
}
