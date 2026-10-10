/**
 * Daily stock (farmclaws part 4b spec §6): Sol sells 2 of each basic part a day, Juniper 1 robot
 * of each size and Marigold 30 packets of each seed. A buy or order past the day's stock is
 * refused with that shop's toast (a seed batch bigger than what's left: "Only {n} left today."),
 * selling a part back doesn't restock, the counts are saved, and every shop restocks in the
 * morning. The panels' view models show "{n} left" and the sold-out labels.
 */
import { describe, expect, it } from 'vitest';
import { SHOP_STOCK } from '../src/config';
import { deepFreeze } from '../src/core/store';
import { BASIC_PART_IDS, ROBOT_SIZES, type GameState, type UiPanel } from '../src/core/types';
import { actions } from '../src/state/actions';
import { countItem } from '../src/state/inventory';
import { deserializeGame, serializeGame } from '../src/state/persistence';
import { gameReducer, startNextDay } from '../src/state/reducer';
import { partsLeft, robotsLeft, seedsLeft } from '../src/state/selectors';
import { partsShopView, seedStock, workshopView } from '../src/ui/shops/viewModel';
import { BASE, must, withGold, withSlots } from './testUtils';

const withPanel = (state: GameState, panel: UiPanel): GameState => ({ ...state, ui: { ...state.ui, panel } });

/** BASE (spring) with 50,000g and an empty backpack, ready to open any shop. */
const RICH: GameState = deepFreeze(withGold(withSlots(BASE, []), 50000));
const SOL = deepFreeze(withPanel(RICH, { kind: 'partsShop' }));
const JUNIPER = deepFreeze(withPanel(RICH, { kind: 'workshop' }));
const MARIGOLD = deepFreeze(withPanel(RICH, { kind: 'shop' }));

const buyPart = (state: GameState, part: Parameters<typeof actions.buyPart>[0]): GameState => gameReducer(state, actions.buyPart(part));
const order = (state: GameState, size: (typeof ROBOT_SIZES)[number], name: string): GameState => gameReducer(state, actions.orderRobot(size, name));
const buySeeds = (state: GameState, quantity: number): GameState => gameReducer(state, actions.buy('parsnip_seeds', quantity));
const lastToast = (state: GameState): unknown => state.messages.entries.at(-1);

/** `state` after the same action `times` times. */
function repeat(state: GameState, times: number, step: (state: GameState) => GameState): GameState {
  let next = state;
  for (let i = 0; i < times; i++) next = step(next);
  return next;
}

describe('what is left', () => {
  it("starts each day at the shop's full stock", () => {
    for (const part of BASIC_PART_IDS) expect(partsLeft(BASE, part), part).toBe(SHOP_STOCK.partsPerDay);
    for (const size of ROBOT_SIZES) expect(robotsLeft(BASE, size), size).toBe(SHOP_STOCK.robotsPerSizePerDay);
    expect(seedsLeft(BASE, 'parsnip_seeds')).toBe(SHOP_STOCK.seedsPerDay);
    expect(seedsLeft(BASE, 'pumpkin_seeds')).toBe(SHOP_STOCK.seedsPerDay);
  });
});

describe("Sol's parts", () => {
  it('sells 2 of each basic part a day, then says he is out', () => {
    const two = repeat(SOL, SHOP_STOCK.partsPerDay, (s) => buyPart(s, 'claw'));
    expect(countItem(two.inventory, 'claw')).toBe(2);
    expect(two.shopsSoldToday.parts.claw).toBe(2);
    expect(partsLeft(two, 'claw')).toBe(0);
    const third = buyPart(two, 'claw');
    expect(third.player).toBe(two.player);
    expect(third.inventory).toBe(two.inventory);
    expect(third.shopsSoldToday).toBe(two.shopsSoldToday);
    expect(lastToast(third)).toMatchObject({ text: 'Out of stock. Sol restocks tomorrow.', tone: 'warn' });
    expect(countItem(buyPart(two, 'tiller').inventory, 'tiller')).toBe(1);
  });

  it('says he is out before asking for gold', () => {
    const soldOut = withGold(repeat(SOL, SHOP_STOCK.partsPerDay, (s) => buyPart(s, 'basket')), 0);
    expect(lastToast(buyPart(soldOut, 'basket'))).toMatchObject({ text: 'Out of stock. Sol restocks tomorrow.' });
  });

  it("doesn't count a refused buy", () => {
    const poor = withGold(SOL, 0);
    expect(buyPart(poor, 'claw').shopsSoldToday).toBe(poor.shopsSoldToday);
  });

  it("doesn't restock when a part is sold back", () => {
    const two = repeat(SOL, SHOP_STOCK.partsPerDay, (s) => buyPart(s, 'sensorEye'));
    const soldBack = gameReducer(two, actions.sellPart('sensorEye'));
    expect(countItem(soldBack.inventory, 'sensorEye')).toBe(1);
    expect(soldBack.shopsSoldToday).toBe(two.shopsSoldToday);
    expect(lastToast(buyPart(soldBack, 'sensorEye'))).toMatchObject({ text: 'Out of stock. Sol restocks tomorrow.' });
  });
});

describe("Juniper's robots", () => {
  it('builds 1 of each size a day, then says it is sold out', () => {
    const one = order(JUNIPER, 'mini', 'Bolt');
    expect(one.shopsSoldToday.robots).toEqual({ mini: 1, standard: 0, big: 0 });
    expect(robotsLeft(one, 'mini')).toBe(0);
    const again = order(one, 'mini', 'Cog');
    expect(again.player).toBe(one.player);
    expect(again.robots).toBe(one.robots);
    expect(again.shopsSoldToday).toBe(one.shopsSoldToday);
    expect(lastToast(again)).toMatchObject({ text: 'Sold out today. Juniper builds another tomorrow.', tone: 'warn' });
    const all = order(order(one, 'standard', 'Cog'), 'big', 'Rivet');
    expect(all.robots.deliveries).toHaveLength(3);
    expect(all.shopsSoldToday.robots).toEqual({ mini: 1, standard: 1, big: 1 });
  });

  it("doesn't count a refused order", () => {
    const badName = order(JUNIPER, 'big', '');
    expect(badName.shopsSoldToday).toBe(JUNIPER.shopsSoldToday);
    const poor = withGold(JUNIPER, 0);
    expect(order(poor, 'big', 'Bolt').shopsSoldToday).toBe(poor.shopsSoldToday);
  });
});

describe("Marigold's seeds", () => {
  it('sells 30 packets of each seed a day, then says she is out', () => {
    const sold = buySeeds(buySeeds(buySeeds(buySeeds(MARIGOLD, 10), 10), 5), 5);
    expect(countItem(sold.inventory, 'parsnip_seeds')).toBe(30);
    expect(sold.shopsSoldToday.seeds.parsnip_seeds).toBe(30);
    expect(seedsLeft(sold, 'parsnip_seeds')).toBe(0);
    const more = buySeeds(sold, 1);
    expect(more.player).toBe(sold.player);
    expect(more.inventory).toBe(sold.inventory);
    expect(more.shopsSoldToday).toBe(sold.shopsSoldToday);
    expect(lastToast(more)).toMatchObject({ text: 'Out of stock. Marigold restocks tomorrow.', tone: 'warn' });
    expect(countItem(gameReducer(sold, actions.buy('potato_seeds', 10)).inventory, 'potato_seeds')).toBe(10);
  });

  it('refuses a batch bigger than what is left, and sells the rest', () => {
    const most = buySeeds(buySeeds(MARIGOLD, 10), 15);
    const tooMany = buySeeds(most, 10);
    expect(tooMany.player).toBe(most.player);
    expect(tooMany.inventory).toBe(most.inventory);
    expect(tooMany.shopsSoldToday).toBe(most.shopsSoldToday);
    expect(lastToast(tooMany)).toMatchObject({ text: 'Only 5 left today.', tone: 'warn' });
    const rest = buySeeds(most, 5);
    expect(countItem(rest.inventory, 'parsnip_seeds')).toBe(30);
    expect(lastToast(buySeeds(rest, 5))).toMatchObject({ text: 'Out of stock. Marigold restocks tomorrow.' });
  });

  it('still says when a seed is out of season first', () => {
    expect(lastToast(gameReducer(MARIGOLD, actions.buy('pumpkin_seeds', 1)))).toMatchObject({ text: "Pumpkin Seeds aren't sold in Spring." });
  });
});

describe('the morning restock', () => {
  it('clears every count when the next day starts', () => {
    const shopped = order(withPanel(buyPart(SOL, 'claw'), { kind: 'workshop' }), 'big', 'Bolt');
    const withSeeds = buySeeds(withPanel(shopped, { kind: 'shop' }), 7);
    expect(withSeeds.shopsSoldToday.parts.claw).toBe(1);
    expect(withSeeds.shopsSoldToday.robots.big).toBe(1);
    expect(withSeeds.shopsSoldToday.seeds.parsnip_seeds).toBe(7);
    const morning = startNextDay(withPanel(withSeeds, { kind: 'none' }), false);
    expect(morning.shopsSoldToday).toEqual(BASE.shopsSoldToday);
    expect(partsLeft(morning, 'claw')).toBe(SHOP_STOCK.partsPerDay);
  });

  it('keeps the same objects when nothing was sold', () => {
    expect(startNextDay(BASE, false).shopsSoldToday).toBe(BASE.shopsSoldToday);
    const robotOnly = order(JUNIPER, 'mini', 'Bolt');
    const morning = startNextDay(withPanel(robotOnly, { kind: 'none' }), false).shopsSoldToday;
    expect(morning.robots).toEqual(BASE.shopsSoldToday.robots);
    expect(morning.parts).toBe(robotOnly.shopsSoldToday.parts);
    expect(morning.seeds).toBe(robotOnly.shopsSoldToday.seeds);
  });

  it('comes by sleeping, not by reloading mid-day', () => {
    const soldOut = repeat(SOL, SHOP_STOCK.partsPerDay, (s) => buyPart(s, 'claw'));
    const loaded = must(deserializeGame(serializeGame(soldOut)));
    expect(loaded.shopsSoldToday).toEqual(soldOut.shopsSoldToday);
    const reopened = withPanel(loaded, { kind: 'partsShop' });
    expect(lastToast(buyPart(reopened, 'claw'))).toMatchObject({ text: 'Out of stock. Sol restocks tomorrow.' });
    const slept = gameReducer(withPanel(loaded, { kind: 'none' }), actions.sleep());
    expect(countItem(buyPart(withPanel(slept, { kind: 'partsShop' }), 'claw').inventory, 'claw')).toBe(3);
  });
});

describe('what the panels show', () => {
  it("shows each of Sol's parts left, and Out of stock when there are none", () => {
    const rows = (state: GameState) => partsShopView(state).buy.map(({ part, left, soldOut }) => ({ part, left, soldOut }));
    expect(rows(SOL)).toEqual(BASIC_PART_IDS.map((part) => ({ part, left: '2 left', soldOut: null })));
    const oneClaw = buyPart(SOL, 'claw');
    expect(rows(oneClaw)[0]).toEqual({ part: 'claw', left: '1 left', soldOut: null });
    expect(rows(buyPart(oneClaw, 'claw'))[0]).toEqual({ part: 'claw', left: '0 left', soldOut: 'Out of stock' });
  });

  it("shows each of Juniper's sizes left, and Sold out today when there are none", () => {
    const cards = (state: GameState) => workshopView(state).cards.map(({ size, left, soldOut }) => ({ size, left, soldOut }));
    expect(cards(JUNIPER)).toEqual(ROBOT_SIZES.map((size) => ({ size, left: '1 left', soldOut: null })));
    expect(cards(order(JUNIPER, 'standard', 'Bolt'))).toEqual([
      { size: 'mini', left: '1 left', soldOut: null },
      { size: 'standard', left: '0 left', soldOut: 'Sold out today' },
      { size: 'big', left: '1 left', soldOut: null },
    ]);
  });

  it('shows each seed left, and which batches still fit', () => {
    expect(seedStock(MARIGOLD, 'parsnip_seeds')).toEqual({ left: 30, label: '30 left', soldOut: null });
    const most = buySeeds(buySeeds(MARIGOLD, 10), 12);
    expect(seedStock(most, 'parsnip_seeds')).toEqual({ left: 8, label: '8 left', soldOut: null });
    const all = buySeeds(most, 8);
    expect(seedStock(all, 'parsnip_seeds')).toEqual({ left: 0, label: '0 left', soldOut: 'Out of stock' });
    expect(seedStock(all, 'potato_seeds').left).toBe(30);
  });
});
