/**
 * Marigold's backpack upgrade (Release 1 cleanup spec §5.1): 2000g raises the unlocked slots from
 * 24 to 36. It acts only while the seed shop is open and the game runs, once, and a short purse
 * gets a toast and nothing else.
 */
import { describe, expect, it } from 'vitest';
import { INVENTORY } from '../src/config';
import { deepFreeze } from '../src/core/store';
import type { GameState } from '../src/core/types';
import { actions } from '../src/state/actions';
import { backpackUpgradeOffered } from '../src/state/inventory';
import { gameReducer } from '../src/state/reducer';
import { BASE, withGold } from './testUtils';

const open = (state: GameState, paused = false): GameState => ({ ...state, ui: { ...state.ui, panel: { kind: 'shop' }, paused } });
const atMarigold = (gold: number): GameState => deepFreeze(open(withGold(BASE, gold)));
const buy = (state: GameState): GameState => gameReducer(state, actions.buyBackpack());
const lastToast = (state: GameState): unknown => state.messages.entries.at(-1);

describe('shop/backpack', () => {
  it('starts with the smaller backpack', () => {
    expect(BASE.inventory.unlockedSlots).toBe(INVENTORY.startingUnlockedSlots);
  });

  it('takes exactly the price, leaves 0g and unlocks every slot', () => {
    const next = buy(atMarigold(INVENTORY.backpackUpgradePrice));
    expect(next.player.gold).toBe(0);
    expect(next.inventory.unlockedSlots).toBe(INVENTORY.slotCount);
    expect(lastToast(next)).toMatchObject({ text: 'Your backpack holds 36 now.', tone: 'success' });
  });

  it('refuses one gold short and changes nothing else', () => {
    const state = atMarigold(INVENTORY.backpackUpgradePrice - 1);
    const next = buy(state);
    expect(next.player).toBe(state.player);
    expect(next.inventory).toBe(state.inventory);
    expect(lastToast(next)).toMatchObject({ text: "You can't afford that.", tone: 'warn' });
  });

  it('does nothing with the seed shop closed or the game paused', () => {
    const rich = withGold(BASE, 5000);
    expect(buy(rich)).toBe(rich);
    const paused = open(rich, true);
    expect(buy(paused)).toBe(paused);
  });

  it('does nothing a second time', () => {
    const once = buy(atMarigold(5000));
    expect(buy(once)).toBe(once);
  });

  it('leaves shop/buy ignored while paused', () => {
    const paused = open(withGold(BASE, 5000), true);
    expect(gameReducer(paused, actions.buy('parsnip_seeds', 1))).toBe(paused);
  });
});

describe('backpackUpgradeOffered', () => {
  it('offers the upgrade on the starting backpack only', () => {
    expect(backpackUpgradeOffered(BASE.inventory)).toBe(true);
    expect(backpackUpgradeOffered({ ...BASE.inventory, unlockedSlots: INVENTORY.slotCount })).toBe(false);
  });

  it('stops offering it once bought', () => {
    expect(backpackUpgradeOffered(buy(atMarigold(5000)).inventory)).toBe(false);
  });
});
