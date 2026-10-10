/**
 * Juniper's robot workshop (farmclaws part 4b spec §4.3), in the shops' modal style: the title
 * with the player's gold and the robot count under it, and one card per size. Read program
 * opens the robot screen's preview (`workshop/preview`), and closing it comes back here with
 * focus on that button. Buy turns a card into the checkout: "Name your robot", a field holding
 * the suggested name, Buy for {price}g and Cancel. It draws workshopView and dispatches
 * `workshop/order`; the reducer gives every refusal's toast, so the buttons stay enabled.
 *
 * - The cards are built once; the gold, the count, the suggested name and each card's "{n} left"
 *   (spec §6) follow the state. A sold-out card shows "Sold out today" in place of its buttons.
 * - The checkout closes when an order lands (the deliveries grow), on Cancel, on Escape in the
 *   name field, and whenever the panel opens again. The input controller skips keys typed in the
 *   field, so Enter there submits the checkout and Escape cancels it.
 * - Buttons blur after mouse clicks but keep focus on keyboard activation (releasePointerFocus).
 */
import { PROFILE } from '../../config';
import type { GameState, RobotSize } from '../../core/types';
import { actions } from '../../state/actions';
import { closestWithin, h, hudButton, iconHost, releasePointerFocus, setHidden, setText } from '../dom';
import { createCloseIcon, createCoinIcon } from '../icons';
import type { ShopPanelContext } from './context';
import { WORKSHOP_CARDS, workshopView, type WorkshopCard } from './viewModel';

const numberFormat = new Intl.NumberFormat('en-US');

const gold = (amount: number): string => `${numberFormat.format(amount)}g`;

interface CardParts {
  readonly card: WorkshopCard;
  readonly element: HTMLElement;
  /** The card's own buttons, hidden while its checkout is open. */
  readonly buttons: HTMLElement;
  readonly read: HTMLButtonElement;
  readonly buy: HTMLButtonElement;
  readonly left: HTMLElement;
  readonly soldOut: HTMLElement;
}

/** The size a workshop preview showed, or null for any other panel. */
function previewedSize(panel: GameState['ui']['panel']): RobotSize | null {
  return panel.kind === 'robot' && panel.mode === 'preview' ? panel.size : null;
}

export class WorkshopPanel {
  readonly element = h('div', 'hud-modal hud-shop hud-workshop');
  private readonly goldValue = h('span', 'hud-shop__gold-value');
  private readonly count = h('p', 'hud-workshop__count');
  private readonly cards: readonly CardParts[];
  /** The one checkout, moved into the card being bought. */
  private readonly checkout = h('form', 'hud-workshop__checkout');
  private readonly nameField = h('input', 'hud-workshop__name');
  private readonly confirm = hudButton('hud-btn hud-btn--buy');
  private readonly close = hudButton('hud-iconbtn hud-modal__close');
  private readonly context: ShopPanelContext;
  private buying: CardParts | null = null;
  private suggested = '';
  /** The sizes Juniper has sold out of today. */
  private readonly soldOut = new Set<RobotSize>();

  constructor(context: ShopPanelContext) {
    this.context = context;
    const titleId = `${context.idPrefix}-workshop-title`;
    const nameId = `${context.idPrefix}-workshop-name`;
    this.element.hidden = true;
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-modal', 'true');
    this.element.setAttribute('aria-labelledby', titleId);

    const backdrop = h('div', 'hud-modal__backdrop');
    const card = h('div', 'hud-panel hud-modal__card hud-shop__card');

    const header = h('header', 'hud-modal__header');
    const heading = h('div', 'hud-modal__heading hud-parts__heading');
    const title = h('h2', 'hud-modal__title', "Juniper's robot workshop");
    title.id = titleId;
    const goldRow = h('div', 'hud-shop__gold');
    goldRow.title = 'Your gold';
    goldRow.append(iconHost('hud-shop__gold-coin', createCoinIcon()), this.goldValue, h('span', 'hud-shop__gold-unit', 'g'));
    heading.append(title, goldRow, this.count);
    const close = this.close;
    close.setAttribute('aria-label', 'Close the workshop');
    close.title = 'Close (Esc)';
    close.append(createCloseIcon());
    header.append(heading, close);

    this.cards = WORKSHOP_CARDS.map((entry) => this.cardParts(entry));
    const list = h('ul', 'hud-shop__list');
    list.append(...this.cards.map((parts) => parts.element));

    const label = h('label', 'hud-workshop__label', 'Name your robot');
    label.htmlFor = nameId;
    this.nameField.id = nameId;
    this.nameField.type = 'text';
    this.nameField.maxLength = PROFILE.maxNameLength;
    this.nameField.autocomplete = 'off';
    this.nameField.spellcheck = false;
    const cancel = hudButton('hud-btn', 'Cancel');
    cancel.type = 'button';
    this.confirm.type = 'submit';
    this.checkout.hidden = true;
    this.checkout.append(label, this.nameField, this.confirm, cancel);

    card.append(header, list);
    this.element.append(backdrop, card);

    const closeWorkshop = (event: MouseEvent): void => {
      releasePointerFocus(close, event);
      context.dispatch(actions.closePanel());
    };
    close.addEventListener('click', closeWorkshop, { signal: context.signal });
    backdrop.addEventListener('click', closeWorkshop, { signal: context.signal });
    list.addEventListener(
      'click',
      (event) => {
        const button = closestWithin(event, list, 'button[data-size]');
        const parts = this.cards.find((entry) => entry.card.size === button?.dataset.size);
        if (button === null || parts === undefined) return;
        releasePointerFocus(button, event);
        if (button === parts.read) context.dispatch(actions.previewRobot(parts.card.size));
        else this.openCheckout(parts);
      },
      { signal: context.signal },
    );
    cancel.addEventListener(
      'click',
      () => {
        this.closeCheckout(true);
      },
      { signal: context.signal },
    );
    this.checkout.addEventListener(
      'submit',
      (event) => {
        event.preventDefault();
        if (this.buying !== null) context.dispatch(actions.orderRobot(this.buying.card.size, this.nameField.value.trim()));
      },
      { signal: context.signal },
    );
    this.nameField.addEventListener(
      'keydown',
      (event) => {
        if (event.code !== 'Escape') return;
        event.preventDefault();
        this.closeCheckout(true);
      },
      { signal: context.signal },
    );
  }

  sync(state: GameState, prev: GameState | null): void {
    const open = state.ui.panel.kind === 'workshop';
    setHidden(this.element, !open);
    if (!open) return;
    const opened = prev === null || prev.ui.panel.kind !== 'workshop';
    const changed =
      opened ||
      state.player.gold !== prev.player.gold ||
      state.robots !== prev.robots ||
      state.seed !== prev.seed ||
      state.shopsSoldToday !== prev.shopsSoldToday;
    if (changed) this.syncView(state);
    if (opened) {
      this.closeCheckout(false);
      const previewed = prev === null ? null : previewedSize(prev.ui.panel);
      this.cards.find((entry) => entry.card.size === previewed)?.read.focus();
    } else if (state.robots.deliveries.length > prev.robots.deliveries.length) this.closeCheckout(true);
  }

  private syncView(state: GameState): void {
    const view = workshopView(state);
    setText(this.goldValue, numberFormat.format(view.gold));
    setText(this.count, view.count);
    this.suggested = view.suggestedName;
    for (const card of view.cards) {
      const parts = this.cards.find((entry) => entry.card.size === card.size);
      if (parts === undefined) continue;
      setText(parts.left, card.left);
      if (card.soldOut === null) this.soldOut.delete(card.size);
      else this.soldOut.add(card.size);
      if (parts !== this.buying) setHidden(parts.buttons, card.soldOut !== null);
      setHidden(parts.soldOut, card.soldOut === null);
      if (card.soldOut !== null) setText(parts.soldOut, card.soldOut);
    }
  }

  private cardParts(card: WorkshopCard): CardParts {
    const element = h('li', 'hud-shop__item hud-workshop__card');
    const info = h('div', 'hud-shop__info');
    const nameRow = h('div', 'hud-shop__name-row');
    nameRow.append(h('span', 'hud-shop__name', card.title), h('span', 'hud-shop__price', gold(card.price)));
    const left = h('span', 'hud-shop__owned');
    info.append(nameRow, h('p', 'hud-parts__line', card.specs), h('p', 'hud-parts__line', card.line), left);
    const buttons = h('div', 'hud-shop__buy');
    const read = hudButton('hud-btn', 'Read program');
    read.dataset.size = card.size;
    read.setAttribute('aria-label', `Read the ${card.title} robot's program`);
    const buy = hudButton('hud-btn hud-btn--buy', 'Buy');
    buy.dataset.size = card.size;
    buy.setAttribute('aria-label', `Buy a ${card.title} robot for ${gold(card.price)}`);
    buttons.append(read, buy);
    const soldOut = h('span', 'hud-shop__sold-out');
    soldOut.hidden = true;
    element.append(iconHost('hud-shop__icon', this.context.icons.get('claw')), info, buttons, soldOut);
    return { card, element, buttons, read, buy, left, soldOut };
  }

  /** Turns `parts` into the checkout, with the suggested name selected in the field. */
  private openCheckout(parts: CardParts): void {
    if (this.buying !== null) setHidden(this.buying.buttons, false);
    this.buying = parts;
    setText(this.confirm, `Buy for ${gold(parts.card.price)}`);
    this.nameField.value = this.suggested;
    setHidden(parts.buttons, true);
    parts.element.append(this.checkout);
    setHidden(this.checkout, false);
    this.nameField.focus();
    this.nameField.select();
  }

  /**
   * Back to the card's buttons, or its "Sold out today" when the order took the last one;
   * `refocus` moves focus to its Buy button (the close button once sold out) when focus was in
   * the checkout.
   */
  private closeCheckout(refocus: boolean): void {
    const parts = this.buying;
    if (parts === null) return;
    const hadFocus = this.checkout.contains(document.activeElement);
    const soldOut = this.soldOut.has(parts.card.size);
    this.buying = null;
    setHidden(this.checkout, true);
    setHidden(parts.buttons, soldOut);
    if (refocus && hadFocus) (soldOut ? this.close : parts.buy).focus();
  }
}
