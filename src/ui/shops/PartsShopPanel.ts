/**
 * Sol's parts shop (farmclaws part 4b spec §3.2), in the seed shop's modal style: the title with
 * the player's gold under it, a Buy row per basic part, a Sell row per part in the backpack, and
 * the footer about repairs. It draws partsShopView and dispatches `parts/buy` and `parts/sell`;
 * the reducer gives every refusal's toast, so the Buy buttons stay enabled.
 *
 * - The Buy rows never change; the Sell rows are rebuilt when the backpack changes.
 * - Buttons blur after mouse clicks but keep focus on keyboard activation (releasePointerFocus).
 */
import { withArticle } from '../../core/text';
import type { GameState, RobotPartId } from '../../core/types';
import { isPartItemId } from '../../items/items';
import { actions } from '../../state/actions';
import { closestWithin, h, hudButton, iconHost, releasePointerFocus, setHidden, setText } from '../dom';
import { createCloseIcon, createCoinIcon } from '../icons';
import type { ShopPanelContext } from './context';
import { PARTS_FOR_SALE, partsShopView, type PartRow, type SellRow } from './viewModel';

const numberFormat = new Intl.NumberFormat('en-US');

export class PartsShopPanel {
  readonly element = h('div', 'hud-modal hud-shop hud-parts');
  private readonly goldValue = h('span', 'hud-shop__gold-value');
  private readonly sellList = h('ul', 'hud-shop__list');
  private readonly sellEmpty = h('p', 'hud-parts__empty');
  private readonly context: ShopPanelContext;

  constructor(context: ShopPanelContext) {
    this.context = context;
    const titleId = `${context.idPrefix}-parts-title`;
    this.element.hidden = true;
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-modal', 'true');
    this.element.setAttribute('aria-labelledby', titleId);

    const backdrop = h('div', 'hud-modal__backdrop');
    const card = h('div', 'hud-panel hud-modal__card hud-shop__card');

    const header = h('header', 'hud-modal__header');
    const heading = h('div', 'hud-modal__heading hud-parts__heading');
    const title = h('h2', 'hud-modal__title', "Sol's parts exchange");
    title.id = titleId;
    const gold = h('div', 'hud-shop__gold');
    gold.title = 'Your gold';
    gold.append(iconHost('hud-shop__gold-coin', createCoinIcon()), this.goldValue, h('span', 'hud-shop__gold-unit', 'g'));
    heading.append(title, gold);
    const close = hudButton('hud-iconbtn hud-modal__close');
    close.setAttribute('aria-label', 'Close the parts shop');
    close.title = 'Close (Esc)';
    close.append(createCloseIcon());
    header.append(heading, close);

    const buyList = h('ul', 'hud-shop__list');
    buyList.append(...PARTS_FOR_SALE.map((row) => this.buyRow(row)));
    this.sellEmpty.hidden = true;
    const footer = h('p', 'hud-shop__footer', 'Repairs: carry a broken robot to the shipping bin.');

    card.append(
      header,
      h('h3', 'hud-parts__section', 'Buy'),
      buyList,
      h('h3', 'hud-parts__section', 'Sell'),
      this.sellList,
      this.sellEmpty,
      footer,
    );
    this.element.append(backdrop, card);

    const closeShop = (event: MouseEvent): void => {
      releasePointerFocus(close, event);
      context.dispatch(actions.closePanel());
    };
    close.addEventListener('click', closeShop, { signal: context.signal });
    backdrop.addEventListener('click', closeShop, { signal: context.signal });
    card.addEventListener(
      'click',
      (event) => {
        const button = closestWithin(event, card, 'button[data-part]');
        if (button === null) return;
        releasePointerFocus(button, event);
        const part = button.dataset.part;
        if (!isPartItemId(part)) return;
        context.dispatch(button.dataset.act === 'sell' ? actions.sellPart(part) : actions.buyPart(part));
      },
      { signal: context.signal },
    );
  }

  sync(state: GameState, prev: GameState | null): void {
    const open = state.ui.panel.kind === 'partsShop';
    setHidden(this.element, !open);
    if (!open) return;
    const opened = prev === null || prev.ui.panel.kind !== 'partsShop';
    if (!opened && state.player.gold === prev.player.gold && state.inventory === prev.inventory) return;
    const view = partsShopView(state);
    setText(this.goldValue, numberFormat.format(view.gold));
    if (opened || state.inventory !== prev.inventory) {
      this.sellList.replaceChildren(...view.sell.map((row) => this.sellRow(row)));
      setHidden(this.sellList, view.sell.length === 0);
      setHidden(this.sellEmpty, view.sellEmpty === null);
      if (view.sellEmpty !== null) setText(this.sellEmpty, view.sellEmpty);
    }
  }

  private buyRow(row: PartRow): HTMLElement {
    const info = h('div', 'hud-shop__info');
    const nameRow = h('div', 'hud-shop__name-row');
    nameRow.append(h('span', 'hud-shop__name', row.name), h('span', 'hud-shop__price', `${row.price}g`));
    info.append(nameRow, h('p', 'hud-parts__line', row.line));
    const button = this.button(row.part, 'buy', 'Buy', `Buy ${withArticle(row.name.toLowerCase())} for ${row.price}g`);
    return this.row(row.part, info, button);
  }

  private sellRow(row: SellRow): HTMLElement {
    const info = h('div', 'hud-shop__info');
    const nameRow = h('div', 'hud-shop__name-row');
    nameRow.append(h('span', 'hud-shop__name', row.name), h('span', 'hud-shop__price', `${row.price}g`));
    info.append(nameRow, h('span', 'hud-shop__owned', `In your bag: ${row.count}`));
    const button = this.button(row.part, 'sell', 'Sell one', `Sell ${withArticle(row.name.toLowerCase())} for ${row.price}g`);
    return this.row(row.part, info, button);
  }

  private row(part: RobotPartId, info: HTMLElement, button: HTMLButtonElement): HTMLElement {
    const element = h('li', 'hud-shop__item');
    const buy = h('div', 'hud-shop__buy');
    buy.append(button);
    element.append(iconHost('hud-shop__icon', this.context.icons.get(part)), info, buy);
    return element;
  }

  private button(part: RobotPartId, act: 'buy' | 'sell', text: string, label: string): HTMLButtonElement {
    const button = hudButton('hud-btn hud-btn--buy', text);
    button.dataset.part = part;
    button.dataset.act = act;
    button.setAttribute('aria-label', label);
    return button;
  }
}
