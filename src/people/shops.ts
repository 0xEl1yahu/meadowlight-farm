/**
 * Shop hours (farmclaws part 4d spec §5): which shops keep hours, where their doors are and who
 * keeps them, whether one is open, and what the closed sign says. Pure. A shop is open by the
 * clock alone; it never looks at where its keeper is.
 */
import { SHOP_HOURS } from '../config';
import { defined } from '../core/invariant';
import type { GameState, NpcId, TileCoord } from '../core/types';
import type { ShopGate } from '../jobs/jobs';
import { formatClock } from '../time/clock';

export const SHOP_IDS = ['generalStore', 'blacksmith', 'carpenter', 'ranch', 'partsExchange'] as const;
export type ShopId = (typeof SHOP_IDS)[number];

export interface ShopDoor {
  readonly shop: ShopId;
  /** The door's tile on the town map; E from the tile in front of it. */
  readonly door: TileCoord;
  readonly keeper: NpcId;
  /** The panel the door opens in hours, or null for a shop with no menu. */
  readonly menu: 'shop' | 'partsShop' | 'workshop' | null;
  /** The part 4c gate the menu waits behind, or null. */
  readonly gate: ShopGate | null;
}

/** The five shops with hours (spec §5.1). */
export const SHOP_DOORS: readonly ShopDoor[] = [
  { shop: 'generalStore', door: { tx: 6, tz: 6 }, keeper: 'marigold', menu: 'shop', gate: null },
  { shop: 'blacksmith', door: { tx: 15, tz: 6 }, keeper: 'berlioz', menu: null, gate: null },
  { shop: 'carpenter', door: { tx: 25, tz: 6 }, keeper: 'juniper', menu: 'workshop', gate: 'workshop' },
  { shop: 'ranch', door: { tx: 34, tz: 6 }, keeper: 'tallulah', menu: null, gate: null },
  { shop: 'partsExchange', door: { tx: 20, tz: 6 }, keeper: 'sol', menu: 'partsShop', gate: 'partsShop' },
];

/** Whether `minute` falls inside one of the opening windows. */
function inHours(minute: number): boolean {
  return SHOP_HOURS.some((window) => window.opens <= minute && minute < window.closes);
}

/** Whether `shop` is open now: `opens ≤ minute < closes` for one window, wherever the keeper is. */
export function shopOpen(state: GameState, shop: ShopId): boolean {
  void shop;
  return inHours(state.time.minuteOfDay);
}

/** The time after "Open again at": the next window's opening, with "tomorrow" once the last has closed. */
export function nextOpening(minute: number): string {
  const next = SHOP_HOURS.find((window) => minute < window.opens);
  if (next !== undefined) return formatClock(next.opens);
  return `${formatClock(defined(SHOP_HOURS[0], 'no shop hours').opens)} tomorrow`;
}

/** What a closed shop says, on the door and in the keeper's chat. */
export function closedLine(minute: number): string {
  return `Sorry, we are closed! Open again at ${nextOpening(minute)}.`;
}

/** The door of `shop`. */
export function shopDoorOf(shop: ShopId): ShopDoor {
  return defined(SHOP_DOORS.find((d) => d.shop === shop), `unknown shop ${shop}`);
}
