/**
 * Panel keys (spec §7.4, src/input/panelKeys.ts): I toggles the backpack or closes a chest; E, K
 * and Enter close the backpack or a chest instead of interacting; B does nothing while either is
 * open; Escape closes any panel, otherwise toggles pause. Each command is also run through the
 * reducer to check the panel it leaves behind.
 */
import { describe, expect, it } from 'vitest';
import { INVENTORY } from '../src/config';
import { deepFreeze } from '../src/core/store';
import type { GameState } from '../src/core/types';
import { IGNORED, INTERACT_KEYS, isInventoryScreenOpen, panelKeyCommand } from '../src/input/panelKeys';
import { actions } from '../src/state/actions';
import { gameReducer } from '../src/state/reducer';
import { EMPTY_TILE } from '../src/world/tiles';
import { BASE, scenario } from './testUtils';

const NONE = BASE;
const INVENTORY_OPEN = deepFreeze(gameReducer(BASE, actions.setInventoryOpen(true)));
const SHOP_OPEN = deepFreeze(gameReducer(BASE, actions.setShopOpen(true)));
const PAUSED = deepFreeze(gameReducer(BASE, actions.setPaused(true)));
const CHEST_OPEN = deepFreeze(
  gameReducer(
    scenario({ ...EMPTY_TILE, object: { kind: 'chest', slots: Array.from({ length: INVENTORY.chestSlots }, () => null) } }),
    actions.interact(),
  ),
);

/** Presses `code` and returns the state the reducer leaves (the same state when nothing is dispatched). */
function press(code: string, state: GameState): GameState {
  const command = panelKeyCommand(code, state);
  if (command === null || command === IGNORED) return state;
  return gameReducer(state, command);
}

describe('panel keys', () => {
  it('starts from the expected panels', () => {
    expect(NONE.ui.panel.kind).toBe('none');
    expect(INVENTORY_OPEN.ui.panel.kind).toBe('inventory');
    expect(SHOP_OPEN.ui.panel.kind).toBe('shop');
    expect(CHEST_OPEN.ui.panel.kind).toBe('chest');
    expect(isInventoryScreenOpen(INVENTORY_OPEN)).toBe(true);
    expect(isInventoryScreenOpen(CHEST_OPEN)).toBe(true);
    expect(isInventoryScreenOpen(SHOP_OPEN)).toBe(false);
    expect(isInventoryScreenOpen(NONE)).toBe(false);
  });

  it('I toggles the backpack and closes a chest', () => {
    expect(panelKeyCommand('KeyI', NONE)).toEqual(actions.setInventoryOpen(true));
    expect(press('KeyI', NONE).ui.panel.kind).toBe('inventory');
    expect(panelKeyCommand('KeyI', INVENTORY_OPEN)).toEqual(actions.setInventoryOpen(false));
    expect(press('KeyI', INVENTORY_OPEN).ui.panel.kind).toBe('none');
    expect(panelKeyCommand('KeyI', CHEST_OPEN)).toEqual(actions.closePanel());
    expect(press('KeyI', CHEST_OPEN).ui.panel.kind).toBe('none');
  });

  it('I leaves the shop alone and cannot open the backpack while paused', () => {
    expect(panelKeyCommand('KeyI', SHOP_OPEN)).toBe(IGNORED);
    expect(press('KeyI', PAUSED)).toBe(PAUSED);
  });

  it('E, K and Enter close the backpack or a chest instead of interacting', () => {
    expect([...INTERACT_KEYS].sort()).toEqual(['Enter', 'KeyE', 'KeyK', 'NumpadEnter']);
    for (const code of INTERACT_KEYS) {
      expect(panelKeyCommand(code, NONE)).toEqual(actions.interact());
      expect(panelKeyCommand(code, INVENTORY_OPEN)).toEqual(actions.closePanel());
      expect(panelKeyCommand(code, CHEST_OPEN)).toEqual(actions.closePanel());
      expect(press(code, CHEST_OPEN).ui.panel.kind).toBe('none');
      // The chest stays where it was: closing never re-runs the interaction.
      expect(press(code, CHEST_OPEN).player.lastAction).toEqual(CHEST_OPEN.player.lastAction);
    }
  });

  it('B toggles the shop but does nothing while the backpack or a chest is open', () => {
    expect(panelKeyCommand('KeyB', NONE)).toEqual(actions.setShopOpen(true));
    expect(panelKeyCommand('KeyB', SHOP_OPEN)).toEqual(actions.setShopOpen(false));
    expect(panelKeyCommand('KeyB', INVENTORY_OPEN)).toBe(IGNORED);
    expect(panelKeyCommand('KeyB', CHEST_OPEN)).toBe(IGNORED);
  });

  it('Escape closes any panel, otherwise toggles pause', () => {
    for (const state of [INVENTORY_OPEN, SHOP_OPEN, CHEST_OPEN]) {
      expect(panelKeyCommand('Escape', state)).toEqual(actions.closePanel());
      expect(press('Escape', state).ui.panel.kind).toBe('none');
    }
    expect(panelKeyCommand('Escape', NONE)).toEqual(actions.setPaused(true));
    expect(panelKeyCommand('Escape', PAUSED)).toEqual(actions.setPaused(false));
  });

  it('leaves every other key to the controller', () => {
    for (const code of ['KeyW', 'Space', 'Tab', 'KeyP', 'KeyN', 'KeyT', 'Digit1', 'Equal', 'KeyZ']) {
      expect(panelKeyCommand(code, NONE)).toBeNull();
      expect(panelKeyCommand(code, INVENTORY_OPEN)).toBeNull();
    }
  });
});

describe('panel keys with Shift (part 3 spec §2.3)', () => {
  it('Shift + E, K or Enter peeks; without Shift they interact', () => {
    for (const code of INTERACT_KEYS) {
      expect(panelKeyCommand(code, NONE, true)).toEqual(actions.peek());
      expect(panelKeyCommand(code, NONE, false)).toEqual(actions.interact());
      expect(panelKeyCommand(code, NONE)).toEqual(actions.interact());
    }
  });

  it('Shift + E still closes the backpack or a chest', () => {
    for (const code of INTERACT_KEYS) {
      expect(panelKeyCommand(code, INVENTORY_OPEN, true)).toEqual(actions.closePanel());
      expect(panelKeyCommand(code, CHEST_OPEN, true)).toEqual(actions.closePanel());
    }
  });

  it('Shift changes nothing for the other keys', () => {
    expect(panelKeyCommand('KeyI', NONE, true)).toEqual(actions.setInventoryOpen(true));
    expect(panelKeyCommand('KeyB', NONE, true)).toEqual(actions.setShopOpen(true));
    expect(panelKeyCommand('Escape', NONE, true)).toEqual(actions.setPaused(true));
    expect(panelKeyCommand('KeyW', NONE, true)).toBeNull();
  });
});

describe('Escape with a zone draft (part 3 spec §8)', () => {
  const DRAFT: GameState = deepFreeze({ ...BASE, ui: { ...BASE.ui, zoneDraft: { zone: 'A', corner: { tx: 5, tz: 10 } } } });

  it('drops the draft instead of pausing', () => {
    expect(panelKeyCommand('Escape', DRAFT)).toEqual(actions.clearZoneDraft());
    const dropped = press('Escape', DRAFT);
    expect(dropped.ui.zoneDraft).toBeNull();
    expect(dropped.ui.paused).toBe(false);
    expect(panelKeyCommand('Escape', dropped)).toEqual(actions.setPaused(true));
  });

  it('still closes an open panel first, and resumes a paused game', () => {
    const open: GameState = { ...DRAFT, ui: { ...DRAFT.ui, panel: { kind: 'shop' } } };
    expect(panelKeyCommand('Escape', open)).toEqual(actions.closePanel());
    const paused: GameState = { ...DRAFT, ui: { ...DRAFT.ui, paused: true } };
    expect(panelKeyCommand('Escape', paused)).toEqual(actions.setPaused(false));
  });
});

describe('the robot screen owns the keyboard (part 3 spec §4.1)', () => {
  const withPanel = (panel: GameState['ui']['panel']): GameState => deepFreeze({ ...BASE, ui: { ...BASE.ui, panel } });
  const BENCH = withPanel({ kind: 'robot', robotId: 1, mode: 'bench' });
  const PEEK = withPanel({ kind: 'robot', robotId: 1, mode: 'peek' });
  const CODES = ['KeyE', 'KeyK', 'Enter', 'NumpadEnter', 'KeyI', 'KeyB', 'Escape', 'KeyW', 'Space', 'KeyP'];

  it.each(CODES)('%s is not a panel key while a robot panel is open', (code) => {
    for (const state of [BENCH, PEEK]) {
      expect(panelKeyCommand(code, state)).toBeNull();
      expect(panelKeyCommand(code, state, true)).toBeNull();
    }
  });
});
