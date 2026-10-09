/**
 * Pure view models for the shops chunk (farmclaws part 4b spec §3.2, §4.3): what Sol's parts
 * shop lists and what Juniper's workshop shows. No DOM, so tests/partsShop.test.ts and
 * tests/workshop.test.ts cover every rule here; the panels only draw what these return.
 */
import { PARTS, ROBOTS } from '../../config';
import { BASIC_PART_IDS, ROBOT_PART_IDS, ROBOT_SIZES, type GameState, type RobotPartId, type RobotSize } from '../../core/types';
import { getItem, sellBackPrice } from '../../items/items';
import { suggestedName } from '../../robots/workshop';
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

/** One of Juniper's robots: its size, price, what the size gives and what it comes with. */
export interface WorkshopCard {
  readonly size: RobotSize;
  readonly title: string;
  readonly price: number;
  /** "{slots} part slots · {battery} battery · {blocks} blocks". */
  readonly specs: string;
  readonly line: string;
}

export interface WorkshopView {
  readonly gold: number;
  /** "{n} / 12 robots": robots on the farm plus deliveries due. */
  readonly count: string;
  readonly cards: readonly WorkshopCard[];
  /** What the checkout's name field starts with. */
  readonly suggestedName: string;
}

const SIZE_TITLES: Readonly<Record<RobotSize, string>> = { mini: 'Mini', standard: 'Standard', big: 'Big' };

/** Juniper's range, the same every day: one card per size, smallest first. */
export const WORKSHOP_CARDS: readonly WorkshopCard[] = ROBOT_SIZES.map((size) => {
  const { price, partSlots, battery, blocks } = ROBOTS.sizes[size];
  return {
    size,
    title: SIZE_TITLES[size],
    price,
    specs: `${partSlots} part ${partSlots === 1 ? 'slot' : 'slots'} · ${battery} battery · ${blocks} blocks`,
    line: 'Comes with a claw and a program that harvests Zone A.',
  };
});

export function workshopView(state: GameState): WorkshopView {
  const { list, deliveries } = state.robots;
  return {
    gold: state.player.gold,
    count: `${list.length + deliveries.length} / ${ROBOTS.maxRobots} robots`,
    cards: WORKSHOP_CARDS,
    suggestedName: suggestedName(state),
  };
}
