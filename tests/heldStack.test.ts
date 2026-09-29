/**
 * The inventory screen's pick-up-and-place rules (spec §7.4, src/ui/heldStack.ts): what left and
 * right clicks hold and dispatch, how slot references resolve against the open panel, and how a
 * held stack is dropped or clamped when its source changes. The `click` helper drives the rules
 * through the real reducer the way InventoryScreen does.
 */
import { describe, expect, it } from 'vitest';
import { INVENTORY } from '../src/config';
import { deepFreeze } from '../src/core/store';
import type { ChestSlots, GameState, ItemStack, SlotRef } from '../src/core/types';
import { actions } from '../src/state/actions';
import { gameReducer } from '../src/state/reducer';
import {
  leftClickSlot,
  reconcileHeld,
  rightClickSlot,
  sameSlotRef,
  stackAtRef,
  type HeldStack,
} from '../src/ui/heldStack';
import { EMPTY_TILE } from '../src/world/tiles';
import { BASE, TARGET, scenario, stack, withSlots } from './testUtils';

const P = (index: number): SlotRef => ({ container: 'player', index });
type ChestRef = Extract<SlotRef, { readonly container: 'chest' }>;
const C = (index: number, tx = TARGET.tx, tz = TARGET.tz): ChestRef => ({ container: 'chest', mapId: 'farm', tx, tz, index });

function chestOf(stacks: readonly (ItemStack | null)[]): ChestSlots {
  return Array.from({ length: INVENTORY.chestSlots }, (_, i) => stacks[i] ?? null);
}

/** The backpack screen open with the player holding `player` from slot 0 onwards. */
function backpack(player: readonly (ItemStack | null)[]): GameState {
  const state = gameReducer(withSlots(BASE, player), actions.setInventoryOpen(true));
  expect(state.ui.panel.kind).toBe('inventory');
  return deepFreeze(state);
}

/** A chest on TARGET holding `chest`, opened by interacting with it. */
function atChest(player: readonly (ItemStack | null)[], chest: readonly (ItemStack | null)[]): GameState {
  const base = withSlots(scenario({ ...EMPTY_TILE, object: { kind: 'chest', slots: chestOf(chest) } }), player);
  const state = gameReducer(base, actions.interact());
  expect(state.ui.panel.kind).toBe('chest');
  return deepFreeze(state);
}

interface Screen {
  readonly state: GameState;
  readonly held: HeldStack | null;
}

/** One click, the way InventoryScreen.apply runs it: rule, dispatch, reconcile, keep on a rejected right click. */
function click(screen: Screen, ref: SlotRef, button: 'left' | 'right'): Screen {
  const stack = stackAtRef(screen.state, ref);
  if (stack === undefined) return screen;
  const result = button === 'left' ? leftClickSlot(screen.held, ref, stack) : rightClickSlot(screen.held, ref, stack);
  if (result.move === null) return { state: screen.state, held: result.held };
  const next = gameReducer(screen.state, actions.moveItem(result.move.from, result.move.to, result.move.quantity));
  if (next === screen.state) return { state: next, held: button === 'right' ? screen.held : result.held };
  return { state: next, held: reconcileHeld(result.held, next, screen.state) };
}

function playerSlot(state: GameState, index: number): ItemStack | null {
  return state.inventory.slots[index] ?? null;
}

describe('slot references', () => {
  it('compares player and chest references field by field', () => {
    expect(sameSlotRef(P(3), P(3))).toBe(true);
    expect(sameSlotRef(P(3), P(4))).toBe(false);
    expect(sameSlotRef(C(3), C(3))).toBe(true);
    expect(sameSlotRef(C(3), P(3))).toBe(false);
    expect(sameSlotRef(P(3), C(3))).toBe(false);
    expect(sameSlotRef(C(3), C(3, TARGET.tx + 1))).toBe(false);
    expect(sameSlotRef(C(3), { ...C(3), mapId: 'forest' })).toBe(false);
  });

  it('resolves unlocked player slots and treats locked or malformed ones as unusable', () => {
    const state = backpack([stack('hoe', 1), null, stack('parsnip', 4)]);
    expect(stackAtRef(state, P(0))).toEqual(stack('hoe', 1));
    expect(stackAtRef(state, P(1))).toBeNull();
    expect(stackAtRef(state, P(INVENTORY.startingUnlockedSlots - 1))).toBeNull();
    expect(stackAtRef(state, P(INVENTORY.startingUnlockedSlots))).toBeUndefined();
    expect(stackAtRef(state, P(-1))).toBeUndefined();
    expect(stackAtRef(state, P(1.5))).toBeUndefined();
  });

  it('resolves chest slots only for the chest open in the panel', () => {
    const state = atChest([], [stack('wood', 7)]);
    expect(stackAtRef(state, C(0))).toEqual(stack('wood', 7));
    expect(stackAtRef(state, C(1))).toBeNull();
    expect(stackAtRef(state, C(INVENTORY.chestSlots))).toBeUndefined();
    expect(stackAtRef(state, C(0, TARGET.tx + 1))).toBeUndefined();
    const closed = gameReducer(state, actions.closePanel());
    expect(stackAtRef(closed, C(0))).toBeUndefined();
  });
});

describe('left click', () => {
  it('picks up the whole stack, and an empty slot does nothing', () => {
    expect(leftClickSlot(null, P(2), stack('parsnip', 9))).toEqual({ held: { ref: P(2), quantity: 9 }, move: null });
    expect(leftClickSlot(null, P(2), null)).toEqual({ held: null, move: null });
  });

  it('places everything held on another slot and lets go', () => {
    const held: HeldStack = { ref: P(2), quantity: 5 };
    expect(leftClickSlot(held, C(4), null)).toEqual({ held: null, move: { from: P(2), to: C(4), quantity: 5 } });
  });

  it('cancels when the held slot itself is clicked', () => {
    expect(leftClickSlot({ ref: C(1), quantity: 3 }, C(1), stack('wood', 3))).toEqual({ held: null, move: null });
  });

  it('moves a stack from the hotbar into the backpack through the reducer', () => {
    let screen: Screen = { state: backpack([stack('hoe', 1), stack('parsnip', 12)]), held: null };
    screen = click(screen, P(1), 'left');
    expect(screen.held).toEqual({ ref: P(1), quantity: 12 });
    expect(playerSlot(screen.state, 1)).toEqual(stack('parsnip', 12));
    screen = click(screen, P(15), 'left');
    expect(screen.held).toBeNull();
    expect(playerSlot(screen.state, 1)).toBeNull();
    expect(playerSlot(screen.state, 15)).toEqual(stack('parsnip', 12));
  });

  it('swaps a held whole stack with a different item', () => {
    let screen: Screen = { state: backpack([stack('hoe', 1), stack('parsnip', 3, 1)]), held: null };
    screen = click(click(screen, P(0), 'left'), P(1), 'left');
    expect(screen.held).toBeNull();
    expect(playerSlot(screen.state, 0)).toEqual(stack('parsnip', 3, 1));
    expect(playerSlot(screen.state, 1)).toEqual(stack('hoe', 1));
  });

  it('ignores locked slots entirely', () => {
    const state = backpack([stack('wood', 5)]);
    const screen = click({ state, held: { ref: P(0), quantity: 5 } }, P(INVENTORY.startingUnlockedSlots), 'left');
    expect(screen.state).toBe(state);
    expect(screen.held).toEqual({ ref: P(0), quantity: 5 });
  });
});

describe('right click', () => {
  it('picks up half the stack, rounded up', () => {
    for (const [quantity, half] of [
      [1, 1],
      [2, 1],
      [5, 3],
      [10, 5],
      [INVENTORY.maxStack, Math.ceil(INVENTORY.maxStack / 2)],
    ] as const) {
      expect(rightClickSlot(null, P(0), stack('wood', quantity))).toEqual({ held: { ref: P(0), quantity: half }, move: null });
    }
    expect(rightClickSlot(null, P(0), null)).toEqual({ held: null, move: null });
  });

  it('places one unit and keeps holding the rest', () => {
    expect(rightClickSlot({ ref: P(0), quantity: 3 }, P(5), null)).toEqual({
      held: { ref: P(0), quantity: 2 },
      move: { from: P(0), to: P(5), quantity: 1 },
    });
    expect(rightClickSlot({ ref: P(0), quantity: 1 }, C(5), null)).toEqual({
      held: null,
      move: { from: P(0), to: C(5), quantity: 1 },
    });
  });

  it('does nothing on the held slot itself', () => {
    const held: HeldStack = { ref: P(4), quantity: 2 };
    expect(rightClickSlot(held, P(4), stack('wood', 4))).toEqual({ held, move: null });
  });

  it('splits a stack and deals it out one by one through the reducer', () => {
    let screen: Screen = { state: backpack([stack('parsnip', 10)]), held: null };
    screen = click(screen, P(0), 'right');
    expect(screen.held).toEqual({ ref: P(0), quantity: 5 });
    screen = click(screen, P(12), 'right');
    screen = click(screen, P(13), 'right');
    expect(screen.held).toEqual({ ref: P(0), quantity: 3 });
    expect(playerSlot(screen.state, 0)).toEqual(stack('parsnip', 8));
    expect(playerSlot(screen.state, 12)).toEqual(stack('parsnip', 1));
    expect(playerSlot(screen.state, 13)).toEqual(stack('parsnip', 1));
    screen = click(screen, P(12), 'left');
    expect(screen.held).toBeNull();
    expect(playerSlot(screen.state, 0)).toEqual(stack('parsnip', 5));
    expect(playerSlot(screen.state, 12)).toEqual(stack('parsnip', 4));
  });

  it('keeps holding the whole stack while placing one at a time', () => {
    let screen: Screen = { state: backpack([stack('wood', 3)]), held: null };
    screen = click(screen, P(0), 'left');
    screen = click(screen, P(1), 'right');
    expect(screen.held).toEqual({ ref: P(0), quantity: 2 });
    screen = click(screen, P(1), 'right');
    screen = click(screen, P(1), 'right');
    expect(screen.held).toBeNull();
    expect(playerSlot(screen.state, 0)).toBeNull();
    expect(playerSlot(screen.state, 1)).toEqual(stack('wood', 3));
  });

  it('keeps holding when the reducer rejects the move (a different item in the way)', () => {
    const state = backpack([stack('wood', 4), stack('stone', 2)]);
    let screen: Screen = click({ state, held: null }, P(0), 'right');
    screen = click(screen, P(1), 'right');
    expect(screen.state).toBe(state);
    expect(screen.held).toEqual({ ref: P(0), quantity: 2 });
  });

  it('moves single units into and out of an open chest', () => {
    let screen: Screen = { state: atChest([stack('parsnip', 4, 2)], [stack('wood', 6)]), held: null };
    screen = click(click(screen, P(0), 'right'), C(3), 'right');
    expect(screen.held).toEqual({ ref: P(0), quantity: 1 });
    expect(stackAtRef(screen.state, C(3))).toEqual(stack('parsnip', 1, 2));
    expect(playerSlot(screen.state, 0)).toEqual(stack('parsnip', 3, 2));
    screen = click(screen, P(0), 'left');
    expect(screen.held).toBeNull();
    screen = click(screen, C(0), 'right');
    expect(screen.held).toEqual({ ref: C(0), quantity: 3 });
    screen = click(screen, P(1), 'left');
    expect(screen.held).toBeNull();
    expect(stackAtRef(screen.state, C(0))).toEqual(stack('wood', 3));
    expect(playerSlot(screen.state, 1)).toEqual(stack('wood', 3));
    expect(stackAtRef(screen.state, C(3))).toEqual(stack('parsnip', 1, 2));
  });
});

describe('reconciling a held stack with the state', () => {
  const state = backpack([stack('parsnip', 6), stack('wood', 2)]);
  const held: HeldStack = { ref: P(0), quantity: 4 };

  it('keeps the same held stack while its source is untouched', () => {
    const selected = gameReducer(state, actions.selectSlot(3));
    expect(reconcileHeld(held, selected, state)).toBe(held);
    expect(reconcileHeld(null, selected, state)).toBeNull();
  });

  it('drops it when the screen closes', () => {
    expect(reconcileHeld(held, gameReducer(state, actions.closePanel()), state)).toBeNull();
  });

  it('clamps it when its source shrinks and drops it when the source empties', () => {
    const shrunk = gameReducer(state, actions.moveItem(P(0), P(5), 3));
    expect(reconcileHeld(held, shrunk, state)).toEqual({ ref: P(0), quantity: 3 });
    const emptied = gameReducer(state, actions.moveItem(P(0), P(5), null));
    expect(reconcileHeld(held, emptied, state)).toBeNull();
  });

  it('drops it when a different item or quality replaces its source', () => {
    const swapped = gameReducer(state, actions.moveItem(P(1), P(0), null));
    expect(playerSlot(swapped, 0)).toEqual(stack('wood', 2));
    expect(reconcileHeld(held, swapped, state)).toBeNull();
    const silver = deepFreeze(gameReducer(withSlots(state, [stack('parsnip', 6, 1)]), actions.selectSlot(0)));
    expect(reconcileHeld({ ref: P(0), quantity: 2 }, withSlots(silver, [stack('parsnip', 6, 2)]), silver)).toBeNull();
  });

  it('drops a chest-held stack once the chest is no longer open', () => {
    const chest = atChest([], [stack('wood', 8)]);
    const fromChest: HeldStack = { ref: C(0), quantity: 4 };
    expect(reconcileHeld(fromChest, chest, chest)).toBe(fromChest);
    const closed = gameReducer(chest, actions.closePanel());
    expect(reconcileHeld(fromChest, closed, chest)).toBeNull();
    const bag = gameReducer(closed, actions.setInventoryOpen(true));
    expect(reconcileHeld(fromChest, bag, chest)).toBeNull();
  });

  it('only clamps when there is no earlier state to compare with', () => {
    expect(reconcileHeld({ ref: P(0), quantity: 9 }, state, null)).toEqual({ ref: P(0), quantity: 6 });
  });
});
