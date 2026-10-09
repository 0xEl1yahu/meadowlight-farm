/**
 * Sol's parts shop (farmclaws part 4b spec §3): Shop in Sol's chat opens the parts shop panel;
 * `parts/buy` sells a basic part for its price, `parts/sell` buys any part back for half its
 * price rounded down; both act only while the parts shop is open and the game isn't paused. The
 * panel's pure view model lists what Sol sells and what the backpack can sell back.
 */
import { describe, expect, it } from 'vitest';
import { INVENTORY, PARTS } from '../src/config';
import { deepFreeze } from '../src/core/store';
import { BASIC_PART_IDS, Direction, ROBOT_PART_IDS, type GameState, type UiPanel } from '../src/core/types';
import { getItem } from '../src/items/items';
import { panelKeyCommand } from '../src/input/panelKeys';
import { npcActions, npcSpot } from '../src/people/cast';
import { actions } from '../src/state/actions';
import { countItem } from '../src/state/inventory';
import { gameReducer } from '../src/state/reducer';
import { partsShopView } from '../src/ui/shops/viewModel';
import { BASE, must, stack, withGold, withPlayer, withSlots } from './testUtils';

const withPanel = (state: GameState, panel: UiPanel, paused = false): GameState => ({ ...state, ui: { ...state.ui, panel, paused } });

/** BASE with Sol's shop open, 2,000g and an empty backpack. */
const SHOP: GameState = deepFreeze(withPanel(withGold(withSlots(BASE, []), 2000), { kind: 'partsShop' }));

const buy = (state: GameState, part: Parameters<typeof actions.buyPart>[0]): GameState => gameReducer(state, actions.buyPart(part));
const sell = (state: GameState, part: Parameters<typeof actions.sellPart>[0]): GameState => gameReducer(state, actions.sellPart(part));
const lastToast = (state: GameState): unknown => state.messages.entries.at(-1);

describe("Sol's Shop action", () => {
  it('gives Sol a Shop button', () => {
    expect(npcActions('sol')).toEqual([{ kind: 'partsShop', label: 'Shop' }]);
  });

  it("swaps Sol's chat for the parts shop, from a real chat", () => {
    const { mapId, placement } = must(npcSpot('sol'));
    const before = withPlayer(BASE, { tx: placement.tx, tz: placement.tz + 1 }, Direction.North, mapId);
    const talking = gameReducer(before, actions.interact());
    expect(talking.ui.panel.kind).toBe('talk');
    const shopping = gameReducer(talking, actions.npcAct('sol', 'partsShop'));
    expect(shopping.ui).toEqual({ ...talking.ui, panel: { kind: 'partsShop' } });
    expect(shopping.npcs).toBe(talking.npcs);
    expect(shopping.inventory).toBe(talking.inventory);
    expect(gameReducer(shopping, actions.closePanel()).ui.panel).toEqual({ kind: 'none' });
  });

  it("doesn't open from someone else's chat or while paused", () => {
    const marigold = withPanel(BASE, { kind: 'talk', npc: 'marigold', line: 'Hello.' });
    expect(gameReducer(marigold, actions.npcAct('marigold', 'partsShop'))).toBe(marigold);
    const paused = withPanel(BASE, { kind: 'talk', npc: 'sol', line: 'Hello.' }, true);
    expect(gameReducer(paused, actions.npcAct('sol', 'partsShop'))).toBe(paused);
  });

  it('closes on E, K, Enter and Escape, like the chat box', () => {
    for (const panel of [{ kind: 'partsShop' }, { kind: 'workshop' }] as const) {
      const state = withPanel(BASE, panel);
      for (const code of ['KeyE', 'KeyK', 'Enter', 'NumpadEnter', 'Escape']) {
        expect(panelKeyCommand(code, state), `${panel.kind} ${code}`).toEqual(actions.closePanel());
        expect(panelKeyCommand(code, state, true), `${panel.kind} Shift+${code}`).toEqual(actions.closePanel());
      }
    }
  });
});

describe('parts/buy', () => {
  it('puts one part in the backpack and takes its price', () => {
    const next = buy(SHOP, 'wateringHead');
    expect(next.player.gold).toBe(2000 - PARTS.prices.wateringHead);
    expect(countItem(next.inventory, 'wateringHead')).toBe(1);
    expect(lastToast(next)).toMatchObject({ text: 'Bought a watering head.', tone: 'success' });
    const again = buy(next, 'wateringHead');
    expect(countItem(again.inventory, 'wateringHead')).toBe(2);
    expect(again.player.gold).toBe(2000 - 2 * PARTS.prices.wateringHead);
  });

  it('sells every basic part, named in lower case', () => {
    for (const part of BASIC_PART_IDS) {
      const next = buy(SHOP, part);
      expect(countItem(next.inventory, part), part).toBe(1);
      expect(lastToast(next)).toMatchObject({ text: `Bought a ${getItem(part).name.toLowerCase()}.` });
    }
  });

  it('refuses without enough gold', () => {
    const poor = withGold(SHOP, PARTS.prices.wateringHead - 1);
    const next = buy(poor, 'wateringHead');
    expect(next.player).toBe(poor.player);
    expect(next.inventory).toBe(poor.inventory);
    expect(lastToast(next)).toMatchObject({ text: 'You need 400g.', tone: 'warn' });
    expect(buy(withGold(SHOP, PARTS.prices.wateringHead), 'wateringHead').player.gold).toBe(0);
  });

  it('refuses with a full backpack', () => {
    const full = withSlots(SHOP, Array.from({ length: INVENTORY.slotCount }, () => stack('stone', INVENTORY.maxStack)));
    const next = buy(full, 'claw');
    expect(next.player).toBe(full.player);
    expect(next.inventory).toBe(full.inventory);
    expect(lastToast(next)).toMatchObject({ text: 'Your inventory is full.', tone: 'warn' });
  });

  it('tops up a stack of the same part in a full backpack', () => {
    const stones = Array.from({ length: INVENTORY.slotCount - 1 }, () => stack('stone', INVENTORY.maxStack));
    const full = withSlots(SHOP, [stack('claw', 1), ...stones]);
    expect(countItem(buy(full, 'claw').inventory, 'claw')).toBe(2);
  });

  it("doesn't sell the antenna or the cores", () => {
    for (const part of ['antenna', 'efficientCore', 'quickCore'] as const) expect(buy(SHOP, part)).toBe(SHOP);
  });

  it('does nothing unless the parts shop is open and the game unpaused', () => {
    for (const state of [withPanel(SHOP, { kind: 'none' }), withPanel(SHOP, { kind: 'shop' }), withPanel(SHOP, { kind: 'workshop' }), withPanel(SHOP, { kind: 'partsShop' }, true)]) {
      expect(buy(state, 'claw')).toBe(state);
    }
  });
});

describe('parts/sell', () => {
  it('takes one part and pays half its price, rounded down', () => {
    const state = withSlots(SHOP, [stack('basket', 2)]);
    const next = sell(state, 'basket');
    expect(countItem(next.inventory, 'basket')).toBe(1);
    expect(next.player.gold).toBe(2000 + 175);
    expect(lastToast(next)).toMatchObject({ text: 'Sold a basket for 175g.', tone: 'success' });
    const last = sell(next, 'basket');
    expect(countItem(last.inventory, 'basket')).toBe(0);
    expect(last.player.gold).toBe(2000 + 350);
  });

  it('buys back any part, the antenna and cores included', () => {
    for (const part of ROBOT_PART_IDS) {
      const next = sell(withSlots(SHOP, [stack(part, 1)]), part);
      expect(next.player.gold, part).toBe(2000 + Math.floor(PARTS.prices[part] * PARTS.sellBackShare));
      expect(countItem(next.inventory, part)).toBe(0);
    }
  });

  it('does nothing without the part, or for an item that is not a part', () => {
    const state = withSlots(SHOP, [stack('claw', 1), stack('stone', 5)]);
    expect(sell(state, 'tiller')).toBe(state);
    expect(gameReducer(state, { type: 'parts/sell', part: 'stone' as never })).toBe(state);
  });

  it('does nothing unless the parts shop is open and the game unpaused', () => {
    const holding = withSlots(SHOP, [stack('claw', 1)]);
    for (const state of [withPanel(holding, { kind: 'none' }), withPanel(holding, { kind: 'shop' }), withPanel(holding, { kind: 'partsShop' }, true)]) {
      expect(sell(state, 'claw')).toBe(state);
    }
  });
});

describe('partsShopView', () => {
  it("lists the basic six in catalogue order with Sol's lines and prices", () => {
    const view = partsShopView(SHOP);
    expect(view.gold).toBe(2000);
    expect(view.buy).toEqual([
      { part: 'claw', name: 'Claw', line: 'Harvest, take from and deposit into.', price: 300 },
      { part: 'wateringHead', name: 'Watering head', line: 'Water and refill. Holds 20 uses.', price: 400 },
      { part: 'tiller', name: 'Tiller', line: 'Till soil.', price: 500 },
      { part: 'seeder', name: 'Seeder', line: 'Plant seeds.', price: 500 },
      { part: 'basket', name: 'Basket', line: 'Two more bag stacks.', price: 350 },
      { part: 'sensorEye', name: 'Sensor eye', line: 'Sees the tile ahead, the rain and the time.', price: 450 },
    ]);
  });

  it('says so when the backpack holds no parts', () => {
    const view = partsShopView(withSlots(SHOP, [stack('stone', 3)]));
    expect(view.sell).toEqual([]);
    expect(view.sellEmpty).toBe('No parts in your backpack.');
  });

  it('lists the parts in the backpack in catalogue order, with counts and sell-back prices', () => {
    const state = withSlots(SHOP, [stack('quickCore', 1), stack('claw', 2), stack('stone', 3), stack('claw', 1), stack('basket', 1)]);
    const view = partsShopView(state);
    expect(view.sellEmpty).toBeNull();
    expect(view.sell).toEqual([
      { part: 'claw', name: 'Claw', count: 3, price: 150 },
      { part: 'basket', name: 'Basket', count: 1, price: 175 },
      { part: 'quickCore', name: 'Quick core', count: 1, price: 750 },
    ]);
  });
});
