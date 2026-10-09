/**
 * Pure view models for the shops chunk (farmclaws part 4b spec §3.2): what Sol's parts shop
 * lists. No DOM, so tests/partsShop.test.ts covers every rule here; the panels only draw what
 * these return.
 */
import { PARTS } from '../../config';
import { BASIC_PART_IDS, ROBOT_PART_IDS, type GameState, type RobotPartId } from '../../core/types';
import { getItem, sellBackPrice } from '../../items/items';
import { countItem } from '../../state/inventory';

/** A part Sol sells: its name, what it provides (its item description, spec §3.2's line) and its price. */
export interface PartRow {
  readonly part: RobotPartId;
  readonly name: string;
  readonly line: string;
  readonly price: number;
}

/** A part the backpack holds: how many, and what Sol pays for one. */
export interface SellRow {
  readonly part: RobotPartId;
  readonly name: string;
  readonly count: number;
  readonly price: number;
}

export interface PartsShopView {
  readonly gold: number;
  /** The basic six, in catalogue order. */
  readonly buy: readonly PartRow[];
  /** One row per part the backpack holds, in catalogue order, its stacks counted together. */
  readonly sell: readonly SellRow[];
  /** The Sell list's note when the backpack holds no parts; null when it holds some. */
  readonly sellEmpty: string | null;
}

/** What Sol sells, the same every day: the basic six in catalogue order. */
export const PARTS_FOR_SALE: readonly PartRow[] = BASIC_PART_IDS.map((part) => {
  const item = getItem(part);
  return { part, name: item.name, line: item.description, price: PARTS.prices[part] };
});

export function partsShopView(state: GameState): PartsShopView {
  const sell: SellRow[] = [];
  for (const part of ROBOT_PART_IDS) {
    const count = countItem(state.inventory, part);
    if (count > 0) sell.push({ part, name: getItem(part).name, count, price: sellBackPrice(part) });
  }
  return { gold: state.player.gold, buy: PARTS_FOR_SALE, sell, sellEmpty: sell.length === 0 ? 'No parts in your backpack.' : null };
}
