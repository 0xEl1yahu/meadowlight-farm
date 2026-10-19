/**
 * SLOPMART 24/7 (farmclaws part 4d spec §6): what's in each mystery box, whether DEALZ will sell
 * one, and what DEALZ says. Pure: a box is a function of the save's seed and its lifetime count of
 * boxes, so every save has its own fixed sequence and reloading never changes the next box.
 *
 * Every DEALZ line is in capitals and ends " ✓", refusals included, and a result line never says
 * whether the box held a gem. Only the toast tells the truth.
 */
import { SLOP, SLOP_GEMS } from '../config';
import { hash32, hashFloat } from '../core/hash';
import { defined } from '../core/invariant';
import { CROP_IDS, SLOP_IDS, type GameState, type ItemId, type Season } from '../core/types';
import { CROPS, isInSeason, seedItemId } from '../farming/crops';
import { getItem } from '../items/items';
import { hasEmptySlot } from '../state/inventory';

/** What one box holds: one stack. */
export type BoxContents = { readonly itemId: ItemId; readonly quantity: number };

/** A row of the gem table (spec §6.3): an item and how many, or that many seeds of a field crop out of season. */
export type SlopGem =
  | { readonly kind: 'item'; readonly itemId: ItemId; readonly quantity: number }
  | { readonly kind: 'outOfSeasonSeeds'; readonly quantity: number };

/** DEALZ's greetings (spec §6.4), one picked as the chat opens. */
export const DEALZ_GREETINGS: readonly string[] = [
  'BUY SOMETHING OR GET THE HELL OUT PUNK ✓',
  "WHAT ARE YOU OGLIN' AT? ✓",
  'WHY ARE YOU HERE? ✓',
  'YOU BUYING OR WINDOW SHOPPING, PAL? ✓',
  'OH GREAT. A CUSTOMER ✓',
  'YOUR SATISFACTION IS NOT TRACKED. NEITHER ARE YOUR FEELINGS ✓',
  'NO REFUNDS. NO EXCHANGES. NO EYE CONTACT ✓',
  'YOU AGAIN ✓',
];

/** DEALZ's result lines (spec §6.4), the same for slop and gems; `{ITEM}` is filled by itemShout. */
const DEALZ_RESULTS: readonly string[] = [
  "{ITEM}. ENJOY IT OR DON'T. I DON'T CARE ✓",
  '{ITEM}. PREMIUM QUALITY. NEXT ✓',
  '{ITEM}. BEST ONE YET. NOW MOVE ✓',
];

/** DEALZ's refusals (spec §6.4). */
export const DEALZ_LINES = {
  soldOut: 'SOLD OUT. GO HOME ✓',
  noGold: 'NO MONEY, NO SLOP. BEAT IT ✓',
  bagFull: 'YOUR BAG IS FULL. NOT MY PROBLEM, PAL ✓',
} as const;

/** The entry of `list` that `hash` picks. */
function pick<T>(list: readonly T[], hash: number, what: string): T {
  return defined(list[hash % list.length], `no ${what} to pick`);
}

/** Whether box number `boxesOpened` holds a gem rather than slop (spec §6.3). */
export function isGem(seed: number, boxesOpened: number): boolean {
  return hashFloat(seed, boxesOpened, SLOP.tierSalt) < SLOP.gemChance;
}

/**
 * Box number `boxesOpened` of the save with `seed`, opened in `season` (spec §6.3): a gem from the
 * gem table, or one slop item. Out-of-season seeds are one of the field crops that don't list
 * `season`, in CROP_IDS order.
 */
export function boxAt(seed: number, boxesOpened: number, season: Season): BoxContents {
  const index = hash32(seed, boxesOpened, SLOP.pickSalt);
  // Slop comes one to a box.
  if (!isGem(seed, boxesOpened)) return { itemId: pick(SLOP_IDS, index, 'slop'), quantity: 1 };
  const gem = pick(SLOP_GEMS, index, 'gem');
  if (gem.kind === 'item') return { itemId: gem.itemId, quantity: gem.quantity };
  const crops = CROP_IDS.filter((id) => CROPS[id].habitat === 'field' && !isInSeason(CROPS[id], season));
  return { itemId: seedItemId(pick(crops, hash32(seed, boxesOpened, SLOP.cropSalt), 'out-of-season crop')), quantity: gem.quantity };
}

/** What DEALZ says as the chat opens (spec §6.2): today's greeting, moved on by each box bought. */
export function dealzGreeting(state: GameState): string {
  return pick(DEALZ_GREETINGS, hash32(state.seed, state.time.absoluteDay, state.slopShop.boxesOpened, SLOP.greetingSalt), 'greeting');
}

/** `{ITEM}` (spec §6.4): the item's name in capitals, with " ×{quantity}" when there's more than one. */
function itemShout(contents: BoxContents): string {
  const name = getItem(contents.itemId).name.toUpperCase();
  return contents.quantity > 1 ? `${name} ×${contents.quantity}` : name;
}

/** What DEALZ says after selling box number `boxesOpened`, picked without looking at the tier (spec §6.4). */
export function dealzResult(seed: number, boxesOpened: number, contents: BoxContents): string {
  const template = pick(DEALZ_RESULTS, hash32(seed, boxesOpened, SLOP.resultSalt), 'result line');
  return template.replace('{ITEM}', () => itemShout(contents));
}

/**
 * Why DEALZ won't sell a box now, as DEALZ's line, or null when he will (spec §6.2), checked in
 * order: today's boxes, the gold, then a completely empty slot, which a box needs whatever it
 * holds, so a nearly full bag can't tell you what's inside.
 */
export function dealzRefusal(state: GameState): string | null {
  if (state.shopsSoldToday.slopBoxes >= SLOP.boxesPerDay) return DEALZ_LINES.soldOut;
  if (state.player.gold < SLOP.boxPrice) return DEALZ_LINES.noGold;
  if (!hasEmptySlot(state.inventory)) return DEALZ_LINES.bagFull;
  return null;
}

/** The toast after a sale (spec §6.2): the truth about what was in the box. */
export function boxToast(contents: BoxContents): string {
  const name = getItem(contents.itemId).name;
  return contents.quantity > 1 ? `Mystery box: ${name} ×${contents.quantity}.` : `Mystery box: ${name}.`;
}
