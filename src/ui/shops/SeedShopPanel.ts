/**
 * Marigold's seed shop (farmclaws part 4a), moved unchanged from the HUD into the shops' lazy
 * chunk (part 4b spec §10). B, and Shop in Marigold's chat, open it.
 *
 * - The stock is the season's seeds (selectShopStock); each row buys ×1, ×5 or ×10 through
 *   `shop/buy`, and a button is disabled while its batch costs more gold than the player has or
 *   doesn't fit in the bag.
 * - Rows are rebuilt when the shop opens or the season changes, and only the buttons, owned
 *   counts and gold readout update otherwise.
 * - Buttons blur after mouse clicks but keep focus on keyboard activation (releasePointerFocus).
 */
import { SEASON_NAMES, Season, type GameState } from '../../core/types';
import { CROPS, totalGrowDays } from '../../farming/crops';
import { isSeedItemId, sellPriceFor, type SeedItem } from '../../items/items';
import { actions } from '../../state/actions';
import { capacityFor, countItem } from '../../state/inventory';
import { selectShopStock } from '../../state/selectors';
import { closestWithin, h, hudButton, iconHost, releasePointerFocus, setHidden, setText, setTitle } from '../dom';
import { createCloseIcon, createCoinIcon, createWinterIcon } from '../icons';
import type { ItemIconCache } from '../slots';
import type { ShopPanelContext } from './context';

const BUY_QUANTITIES: readonly number[] = [1, 5, 10];

const numberFormat = new Intl.NumberFormat('en-US');

interface BuyButton {
  readonly button: HTMLButtonElement;
  readonly quantity: number;
}

interface ShopRow {
  readonly element: HTMLElement;
  readonly item: SeedItem;
  readonly buttons: readonly BuyButton[];
  readonly owned: HTMLElement;
}

function metaTag(text: string, modifier = ''): HTMLElement {
  return h('span', modifier === '' ? 'hud-tag' : `hud-tag ${modifier}`, text);
}

export class SeedShopPanel {
  readonly element = h('div', 'hud-modal hud-shop');
  private readonly list = h('ul', 'hud-shop__list');
  private readonly empty = h('div', 'hud-shop__empty');
  private readonly emptyTitle = h('h3', 'hud-shop__empty-title');
  private readonly emptyText = h('p', 'hud-shop__empty-text');
  private readonly season = h('p', 'hud-modal__subtitle');
  private readonly goldValue = h('span', 'hud-shop__gold-value');
  private readonly icons: ItemIconCache;
  private rows: ShopRow[] = [];

  constructor(context: ShopPanelContext) {
    this.icons = context.icons;
    const titleId = `${context.idPrefix}-shop-title`;
    this.element.hidden = true;
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-modal', 'true');
    this.element.setAttribute('aria-labelledby', titleId);

    const backdrop = h('div', 'hud-modal__backdrop');
    const card = h('div', 'hud-panel hud-modal__card hud-shop__card');

    const header = h('header', 'hud-modal__header');
    const heading = h('div', 'hud-modal__heading');
    const title = h('h2', 'hud-modal__title', 'Seed Shop');
    title.id = titleId;
    heading.append(title, this.season);
    const gold = h('div', 'hud-shop__gold');
    gold.title = 'Your gold';
    gold.append(iconHost('hud-shop__gold-coin', createCoinIcon()), this.goldValue, h('span', 'hud-shop__gold-unit', 'g'));
    const close = hudButton('hud-iconbtn hud-modal__close');
    close.setAttribute('aria-label', 'Close the seed shop');
    close.title = 'Close (B / Esc)';
    close.append(createCloseIcon());
    header.append(heading, gold, close);

    this.empty.hidden = true;
    this.empty.append(iconHost('hud-shop__empty-art', createWinterIcon()), this.emptyTitle, this.emptyText);

    const footer = h('p', 'hud-shop__footer', 'Seeds only grow in their season, and only on days they are watered.');

    card.append(header, this.list, this.empty, footer);
    this.element.append(backdrop, card);

    const closeShop = (event: MouseEvent): void => {
      releasePointerFocus(close, event);
      context.dispatch(actions.setShopOpen(false));
    };
    close.addEventListener('click', closeShop, { signal: context.signal });
    backdrop.addEventListener('click', closeShop, { signal: context.signal });
    this.list.addEventListener(
      'click',
      (event) => {
        const button = closestWithin(event, this.list, 'button[data-item]');
        if (!(button instanceof HTMLButtonElement)) return;
        releasePointerFocus(button, event);
        if (button.disabled) return;
        const itemId = button.dataset.item;
        const quantity = Number(button.dataset.qty);
        if (isSeedItemId(itemId) && Number.isInteger(quantity) && quantity > 0) {
          context.dispatch(actions.buy(itemId, quantity));
        }
      },
      { signal: context.signal },
    );
  }

  sync(state: GameState, prev: GameState | null): void {
    const open = state.ui.panel.kind === 'shop';
    setHidden(this.element, !open);
    if (!open) return;
    if (prev === null || prev.ui.panel.kind !== 'shop' || state.time.season !== prev.time.season) {
      this.buildStock(state);
      this.syncAvailability(state);
      return;
    }
    if (state.player.gold !== prev.player.gold || state.inventory !== prev.inventory) this.syncAvailability(state);
  }

  private buildStock(state: GameState): void {
    const season = state.time.season;
    const stock = selectShopStock(state);
    setText(this.season, `${SEASON_NAMES[season]} seeds`);
    this.rows = stock.map((item) => this.createRow(item));
    this.list.replaceChildren(...this.rows.map((row) => row.element));
    setHidden(this.list, stock.length === 0);
    setHidden(this.empty, stock.length > 0);
    if (stock.length === 0) {
      if (season === Season.Winter) {
        setText(this.emptyTitle, 'Nothing to plant in winter');
        setText(
          this.emptyText,
          'The soil is resting under the snow. Clear rocks and stumps, plan your beds, and come back when Spring arrives!',
        );
      } else {
        setText(this.emptyTitle, 'Sold out for now');
        setText(this.emptyText, 'Fresh seeds arrive with the next season.');
      }
    }
  }

  private createRow(item: SeedItem): ShopRow {
    const crop = CROPS[item.cropId];
    const element = h('li', 'hud-shop__item');

    const info = h('div', 'hud-shop__info');
    const nameRow = h('div', 'hud-shop__name-row');
    nameRow.append(h('span', 'hud-shop__name', item.name), h('span', 'hud-shop__price', `${item.price}g`));

    const growDays = totalGrowDays(crop);
    const meta = h('div', 'hud-shop__meta');
    meta.append(
      metaTag(`${growDays} ${growDays === 1 ? 'day' : 'days'} to grow`),
      crop.regrowDays === null
        ? metaTag('Single harvest')
        : metaTag(`Regrows every ${crop.regrowDays} ${crop.regrowDays === 1 ? 'day' : 'days'}`, 'is-regrow'),
      metaTag(`Sells ${sellPriceFor(crop.id, 0)}g`, 'is-sell'),
    );
    if (crop.seasons.length > 1) {
      meta.append(metaTag(`Grows in ${crop.seasons.map((season) => SEASON_NAMES[season]).join(' & ')}`, 'is-season'));
    }
    const owned = h('span', 'hud-shop__owned');
    owned.hidden = true;
    info.append(nameRow, meta, owned);

    const buy = h('div', 'hud-shop__buy');
    const buttons = BUY_QUANTITIES.map((quantity): BuyButton => {
      const button = hudButton('hud-btn hud-btn--buy', `×${quantity}`);
      button.dataset.item = item.id;
      button.dataset.qty = String(quantity);
      button.setAttribute('aria-label', `Buy ${quantity} ${item.name} for ${item.price * quantity}g`);
      buy.append(button);
      return { button, quantity };
    });

    element.append(iconHost('hud-shop__icon', this.icons.get(item.id)), info, buy);
    return { element, item, buttons, owned };
  }

  private syncAvailability(state: GameState): void {
    const gold = state.player.gold;
    setText(this.goldValue, numberFormat.format(gold));
    for (const row of this.rows) {
      const inBag = countItem(state.inventory, row.item.id);
      setHidden(row.owned, inBag === 0);
      if (inBag > 0) setText(row.owned, `In your bag: ${inBag}`);
      const room = capacityFor(state.inventory, row.item.id);
      for (const { button, quantity } of row.buttons) {
        const cost = row.item.price * quantity;
        const affordable = cost <= gold;
        const fits = quantity <= room;
        const disabled = !affordable || !fits;
        if (button.disabled !== disabled) button.disabled = disabled;
        const title = !affordable
          ? `Costs ${numberFormat.format(cost)}g, you have ${numberFormat.format(gold)}g`
          : !fits
            ? 'Not enough room in your bag'
            : `Buy ${quantity} for ${numberFormat.format(cost)}g`;
        setTitle(button, title);
      }
    }
  }
}
