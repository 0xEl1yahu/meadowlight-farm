/**
 * `inventory/move` (spec §5.4) between two player slots and between the player and the open
 * chest, the pure slot helpers behind it, opening a chest, and the UI panel rules (§5.6):
 * which panels open and close when, and that every panel freezes the game.
 */
import { describe, expect, it } from 'vitest';
import { INVENTORY, PLAYER, TIME } from '../src/config';
import { mulberry32 } from '../src/core/hash';
import { deepFreeze } from '../src/core/store';
import { InvariantError } from '../src/core/invariant';
import {
  Direction,
  MAP_IDS,
  TileState,
  type ChestSlots,
  type GameState,
  type ItemId,
  type ItemStack,
  type MapId,
  type SlotRef,
  type TileCoord,
} from '../src/core/types';
import { getItem } from '../src/items/items';
import { actions, type GameAction } from '../src/state/actions';
import { moveAcrossSlots, moveBetweenSlots, moveWithinSlots, type Slots } from '../src/state/inventory';
import { gameReducer } from '../src/state/reducer';
import { selectIsFrozen, selectOpenChest } from '../src/state/selectors';
import { EMPTY_TILE } from '../src/world/tiles';
import {
  BASE,
  STAND,
  TARGET,
  must,
  scenario,
  soilTile,
  stack,
  tileAt,
  withPlayer,
  withSlots,
  withTile,
  worldChangesOutside,
} from './testUtils';

const MAX = INVENTORY.maxStack;

/** A player slot. */
const P = (index: number): SlotRef => ({ container: 'player', index });
/** A slot of the chest at `at` on `mapId` (default: the canonical chest on the farm at TARGET). */
const C = (index: number, at: TileCoord = TARGET, mapId: MapId = 'farm'): SlotRef => ({
  container: 'chest',
  mapId,
  tx: at.tx,
  tz: at.tz,
  index,
});

function emptyChest(): (ItemStack | null)[] {
  return Array.from({ length: INVENTORY.chestSlots }, () => null);
}

/** A chest holding `stacks` from slot 0 onwards. */
function chestOf(stacks: readonly (ItemStack | null)[]): ChestSlots {
  const slots = emptyChest();
  stacks.forEach((held, i) => (slots[i] = held));
  return slots;
}

/**
 * The canonical scenario with a chest on TARGET holding `chest`, the player holding `player`
 * (slot 0 onwards, selection on slot `selected`), with the chest panel already open.
 */
function atChest(player: readonly (ItemStack | null)[], chest: readonly (ItemStack | null)[] = [], selected = 0): GameState {
  const base = withSlots(scenario({ ...EMPTY_TILE, object: { kind: 'chest', slots: chestOf(chest) } }), player, selected);
  const open = gameReducer(base, actions.interact());
  expect(open.ui.panel).toEqual({ kind: 'chest', mapId: 'farm', tx: TARGET.tx, tz: TARGET.tz });
  return deepFreeze(open);
}

/** A frozen state with no panel open and the player holding `player`. */
function holdingOnly(player: readonly (ItemStack | null)[], selected = 0): GameState {
  return deepFreeze(withSlots(BASE, player, selected));
}

function move(state: GameState, from: SlotRef, to: SlotRef, quantity: number | null = null): GameState {
  return gameReducer(state, actions.moveItem(from, to, quantity));
}

function chestSlots(state: GameState): ChestSlots {
  return must(selectOpenChest(state), 'no chest open').slots;
}

function slot(state: GameState, index: number): ItemStack | null {
  return state.inventory.slots[index] ?? null;
}

describe('opening a chest', () => {
  it('interacting with a chest opens its panel and records the attempt', () => {
    const state = atChest([stack('hoe', 1)], [stack('wood', 3)]);
    expect(state.player.lastAction).toEqual({ seq: 1, kind: 'openChest', target: TARGET, success: true });
    expect(selectIsFrozen(state)).toBe(true);
    expect(selectOpenChest(state)).toEqual({ mapId: 'farm', tx: TARGET.tx, tz: TARGET.tz, slots: chestOf([stack('wood', 3)]) });
    expect(state.player.energy).toBe(PLAYER.maxEnergy);
  });

  it('opens a chest with the primary action too, whatever is selected, but not with a tool', () => {
    const chest = scenario({ ...EMPTY_TILE, object: { kind: 'chest', slots: emptyChest() } });
    const seeds = withSlots(chest, [stack('parsnip', 3)]);
    expect(gameReducer(seeds, actions.useTool()).ui.panel.kind).toBe('chest');
    const hoe = withSlots(chest, [stack('hoe', 1)]);
    expect(gameReducer(hoe, actions.useTool()).ui.panel.kind).toBe('none');
  });

  it('opens chests on any map, recording that map in the panel', () => {
    const cleared = withTile(BASE, { tx: 20, tz: 19 }, EMPTY_TILE, 'forest');
    const forestChest = withTile(cleared, { tx: 20, tz: 20 }, { ...EMPTY_TILE, object: { kind: 'chest', slots: emptyChest() } }, 'forest');
    const state = withPlayer(forestChest, { tx: 20, tz: 19 }, Direction.South, 'forest');
    const open = gameReducer(state, actions.interact());
    expect(open.ui.panel).toEqual({ kind: 'chest', mapId: 'forest', tx: 20, tz: 20 });
    expect(selectOpenChest(open)?.mapId).toBe('forest');
  });

  it('ignores other placed objects when interacting', () => {
    for (const object of [{ kind: 'scarecrow' }, { kind: 'woodFence' }] as const) {
      const state = scenario({ ...EMPTY_TILE, object });
      expect(gameReducer(state, actions.interact())).toBe(state);
    }
    const sprinkler = scenario({ ...soilTile(TileState.Watered), object: { kind: 'sprinkler' } });
    expect(gameReducer(sprinkler, actions.interact())).toBe(sprinkler);
  });

  it('selectOpenChest is null without a chest panel, or when the chest is gone', () => {
    expect(selectOpenChest(BASE)).toBeNull();
    const open = atChest([], [stack('wood', 1)]);
    const gone = withTile(open, TARGET, EMPTY_TILE);
    expect(selectOpenChest(gone)).toBeNull();
  });
});

describe('inventory/move: rejections return the same state', () => {
  const player = [stack('hoe', 1), stack('parsnip', 10), null, stack('stone', 5)];
  const chest = [stack('wood', 20), null, stack('parsnip', 4, 2)];

  it('1. is rejected while paused, whatever the panel', () => {
    for (const state of [holdingOnly(player), atChest(player, chest)]) {
      const paused = gameReducer(state, actions.setPaused(true));
      expect(paused.ui.paused).toBe(true);
      expect(move(paused, P(1), P(2))).toBe(paused);
      expect(move(paused, P(1), P(3), 1)).toBe(paused);
    }
    const pausedAtChest = gameReducer(atChest(player, chest), actions.setPaused(true));
    expect(move(pausedAtChest, C(0), P(2))).toBe(pausedAtChest);
    expect(move(pausedAtChest, P(1), C(1))).toBe(pausedAtChest);
  });

  it('2. rejects non-integer player refs', () => {
    const state = holdingOnly(player);
    for (const index of [1.5, Number.NaN, Number.POSITIVE_INFINITY, -0.5, '1' as unknown as number, null as unknown as number]) {
      expect(move(state, P(index), P(2)), String(index)).toBe(state);
      expect(move(state, P(1), P(index)), String(index)).toBe(state);
    }
  });

  it('2. rejects player refs outside the unlocked slots (locked backpack slots included)', () => {
    const state = holdingOnly(player);
    for (const index of [-1, INVENTORY.startingUnlockedSlots, 30, INVENTORY.slotCount - 1, INVENTORY.slotCount, 99]) {
      expect(move(state, P(1), P(index)), `to ${index}`).toBe(state);
      expect(move(state, P(index), P(2)), `from ${index}`).toBe(state);
    }
    // The last unlocked backpack slot is fine.
    expect(slot(move(state, P(1), P(INVENTORY.startingUnlockedSlots - 1)), INVENTORY.startingUnlockedSlots - 1)).toEqual(stack('parsnip', 10));
  });

  it('2. accepts slots 24 … 35 once all 36 are unlocked', () => {
    const state = deepFreeze({ ...holdingOnly(player), inventory: { ...holdingOnly(player).inventory, unlockedSlots: 36 as const } });
    const next = move(state, P(1), P(35));
    expect(slot(next, 35)).toEqual(stack('parsnip', 10));
    expect(slot(move(next, P(35), P(24), 3), 24)).toEqual(stack('parsnip', 3));
  });

  it('2. rejects malformed refs and unknown containers', () => {
    const state = atChest(player, chest);
    for (const ref of [null, undefined, 5, 'player', { container: 'bag', index: 1 }, { index: 1 }] as unknown as SlotRef[]) {
      expect(move(state, ref, P(2)), JSON.stringify(ref)).toBe(state);
      expect(move(state, P(1), ref), JSON.stringify(ref)).toBe(state);
    }
  });

  it('2. rejects chest refs with non-integer coordinates or indexes, or an unknown map', () => {
    const state = atChest(player, chest);
    const bad: readonly SlotRef[] = [
      { container: 'chest', mapId: 'farm', tx: TARGET.tx + 0.5, tz: TARGET.tz, index: 0 },
      { container: 'chest', mapId: 'farm', tx: TARGET.tx, tz: Number.NaN, index: 0 },
      { container: 'chest', mapId: 'farm', tx: TARGET.tx, tz: TARGET.tz, index: 0.5 },
      { container: 'chest', mapId: 'mine' as MapId, tx: TARGET.tx, tz: TARGET.tz, index: 0 },
      { container: 'chest', mapId: 'farm', tx: String(TARGET.tx) as unknown as number, tz: TARGET.tz, index: 0 },
    ];
    for (const ref of bad) {
      expect(move(state, ref, P(2)), JSON.stringify(ref)).toBe(state);
      expect(move(state, P(1), ref), JSON.stringify(ref)).toBe(state);
    }
  });

  it('2. rejects chest refs outside the 36 chest slots', () => {
    const state = atChest(player, chest);
    for (const index of [-1, INVENTORY.chestSlots, 100]) {
      expect(move(state, P(1), C(index)), String(index)).toBe(state);
      expect(move(state, C(index), P(2)), String(index)).toBe(state);
    }
    expect(chestSlots(move(state, P(1), C(INVENTORY.chestSlots - 1)))[INVENTORY.chestSlots - 1]).toEqual(stack('parsnip', 10));
  });

  it('2. rejects a chest ref that is not the open chest (wrong tile, wrong map, no chest panel)', () => {
    const open = atChest(player, chest);
    const otherTile = { tx: TARGET.tx + 1, tz: TARGET.tz };
    for (const ref of [C(0, otherTile), C(0, TARGET, 'forest'), C(0, TARGET, 'town')]) {
      expect(move(open, ref, P(2)), JSON.stringify(ref)).toBe(open);
      expect(move(open, P(1), ref), JSON.stringify(ref)).toBe(open);
    }
    // A second chest next door exists, but only the open one can be used.
    const twoChests = withTile(open, otherTile, { ...EMPTY_TILE, object: { kind: 'chest', slots: chestOf([stack('stone', 1)]) } });
    expect(move(twoChests, C(0, otherTile), P(2))).toBe(twoChests);
    // With the inventory panel (or none) open, no chest ref is valid at all.
    const inventoryOpen = gameReducer(gameReducer(open, actions.closePanel()), actions.setInventoryOpen(true));
    expect(inventoryOpen.ui.panel.kind).toBe('inventory');
    expect(move(inventoryOpen, C(0), P(2))).toBe(inventoryOpen);
    const closed = gameReducer(open, actions.closePanel());
    expect(move(closed, P(1), C(1))).toBe(closed);
  });

  it('2. rejects the open chest ref once its tile no longer holds a chest', () => {
    const open = atChest(player, chest);
    const gone = deepFreeze(withTile(open, TARGET, EMPTY_TILE));
    expect(move(gone, C(0), P(2))).toBe(gone);
    expect(move(gone, P(1), C(1))).toBe(gone);
    const sprinkler = deepFreeze(withTile(open, TARGET, { ...EMPTY_TILE, object: { kind: 'scarecrow' } }));
    expect(move(sprinkler, P(1), C(1))).toBe(sprinkler);
  });

  it('3. rejects an empty source slot, in the player or in the chest', () => {
    const state = atChest(player, chest);
    expect(move(state, P(2), P(4))).toBe(state);
    expect(move(state, P(2), C(1))).toBe(state);
    expect(move(state, C(1), P(4))).toBe(state);
    expect(move(state, C(1), C(4))).toBe(state);
  });

  it('3. rejects quantities outside 1 … the source quantity, and non-integers', () => {
    const state = atChest(player, chest);
    for (const q of [0, -1, 11, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '3' as unknown as number]) {
      expect(move(state, P(1), P(2), q), String(q)).toBe(state);
      expect(move(state, P(1), C(1), q), String(q)).toBe(state);
    }
    for (const q of [0, 21]) expect(move(state, C(0), P(2), q), String(q)).toBe(state);
  });

  it('4. moving a slot onto itself is a no-op, with any quantity', () => {
    const state = atChest(player, chest);
    for (const q of [null, 1, 5, 10]) expect(move(state, P(1), P(1), q)).toBe(state);
    for (const q of [null, 1, 20]) expect(move(state, C(0), C(0), q)).toBe(state);
  });
});

describe('inventory/move: player ↔ player', () => {
  it('5. moves a whole stack into an empty slot (hotbar → backpack and back)', () => {
    const state = holdingOnly([stack('hoe', 1), stack('parsnip', 10)]);
    const next = move(state, P(1), P(15));
    expect(slot(next, 1)).toBeNull();
    expect(slot(next, 15)).toEqual(stack('parsnip', 10));
    const back = move(next, P(15), P(4));
    expect(slot(back, 15)).toBeNull();
    expect(slot(back, 4)).toEqual(stack('parsnip', 10));
  });

  it('5. splits part of a stack into an empty slot, keeping its quality', () => {
    const state = holdingOnly([stack('hoe', 1), stack('parsnip', 10, 1)]);
    const next = move(state, P(1), P(12), 4);
    expect(slot(next, 1)).toEqual(stack('parsnip', 6, 1));
    expect(slot(next, 12)).toEqual(stack('parsnip', 4, 1));
    // Moving the rest by number empties the source like null does.
    const rest = move(next, P(1), P(13), 6);
    expect(slot(rest, 1)).toBeNull();
    expect(slot(rest, 13)).toEqual(stack('parsnip', 6, 1));
  });

  it('6. merges into a stack of the same item and quality, up to maxStack', () => {
    const state = holdingOnly([stack('stone', 10), stack('stone', MAX - 4), stack('stone', 30)]);
    const topped = move(state, P(0), P(2));
    expect(slot(topped, 0)).toBeNull();
    expect(slot(topped, 2)).toEqual(stack('stone', 40));
    // Only 4 fit on the nearly full stack: 6 stay behind.
    const capped = move(state, P(0), P(1));
    expect(slot(capped, 0)).toEqual(stack('stone', 6));
    expect(slot(capped, 1)).toEqual(stack('stone', MAX));
    // Part of a stack merges too.
    const part = move(state, P(2), P(0), 5);
    expect(slot(part, 2)).toEqual(stack('stone', 25));
    expect(slot(part, 0)).toEqual(stack('stone', 15));
  });

  it('6. a full target stack of the same kind is a no-op', () => {
    const state = holdingOnly([stack('wood', 5), stack('wood', MAX)]);
    expect(move(state, P(0), P(1))).toBe(state);
    expect(move(state, P(0), P(1), 2)).toBe(state);
  });

  it('7. swaps two whole stacks of different items', () => {
    const state = holdingOnly([stack('hoe', 1), stack('parsnip', 10), null, stack('stone', 5)]);
    const next = move(state, P(1), P(3));
    expect(slot(next, 1)).toEqual(stack('stone', 5));
    expect(slot(next, 3)).toEqual(stack('parsnip', 10));
    expect(next.inventory.slots[1]).toBe(state.inventory.slots[3]);
    expect(next.inventory.slots[3]).toBe(state.inventory.slots[1]);
  });

  it('7. swaps a silver stack onto a normal stack of the same item instead of merging', () => {
    const state = holdingOnly([stack('parsnip', 3, 1), stack('parsnip', 8, 0)]);
    const next = move(state, P(0), P(1));
    expect(slot(next, 0)).toEqual(stack('parsnip', 8, 0));
    expect(slot(next, 1)).toEqual(stack('parsnip', 3, 1));
    const gold = holdingOnly([stack('parsnip', 2, 2), stack('parsnip', 2, 1)]);
    expect(slot(move(gold, P(0), P(1)), 1)).toEqual(stack('parsnip', 2, 2));
  });

  it('8. part of a stack onto a different item or quality is a no-op', () => {
    const state = holdingOnly([stack('parsnip', 10, 0), stack('stone', 5), stack('parsnip', 4, 2)]);
    expect(move(state, P(0), P(1), 3)).toBe(state);
    expect(move(state, P(0), P(2), 9)).toBe(state);
  });

  it('works with no panel open and with the inventory panel open (only pause blocks moves)', () => {
    const closed = holdingOnly([stack('hoe', 1), stack('parsnip', 10)]);
    const open = deepFreeze(gameReducer(closed, actions.setInventoryOpen(true)));
    expect(selectIsFrozen(open)).toBe(true);
    for (const state of [closed, open]) {
      const next = move(state, P(1), P(20));
      expect(slot(next, 20)).toEqual(stack('parsnip', 10));
      expect(next.ui).toBe(state.ui);
    }
  });

  it('never changes the selection or the water, even when the watering can moves', () => {
    const base = holdingOnly([stack('wateringCan', 1), stack('parsnip', 10)], 1);
    const state = deepFreeze({ ...base, inventory: { ...base.inventory, water: 7 } });
    const next = move(state, P(0), P(14));
    expect(slot(next, 14)).toEqual(stack('wateringCan', 1));
    expect(next.inventory.selected).toBe(1);
    expect(next.inventory.water).toBe(7);
    expect(next.inventory.waterCapacity).toBe(state.inventory.waterCapacity);
    // Moving the selected stack away leaves the selection on the (now empty) slot.
    const moved = move(state, P(1), P(12));
    expect(moved.inventory.selected).toBe(1);
    expect(slot(moved, 1)).toBeNull();
  });

  it('touches nothing but the inventory slots', () => {
    const state = holdingOnly([stack('hoe', 1), stack('parsnip', 10)]);
    const next = move(state, P(1), P(2), 3);
    expect(next.maps).toBe(state.maps);
    expect(next.player).toBe(state.player);
    expect(next.ui).toBe(state.ui);
    expect(next.shipping).toBe(state.shipping);
    expect(next.messages).toBe(state.messages);
    expect(next.inventory.slots[0]).toBe(state.inventory.slots[0]);
  });
});

describe('inventory/move: player ↔ chest', () => {
  const player = [stack('hoe', 1), stack('parsnip', 10), null, stack('stone', 5), stack('parsnip', 3, 1)];
  const chest = [stack('wood', 20), null, stack('parsnip', 4, 2), stack('stone', MAX)];

  it('5. deposits into an empty chest slot and withdraws into an empty player slot', () => {
    const state = atChest(player, chest);
    const deposited = move(state, P(1), C(1));
    expect(slot(deposited, 1)).toBeNull();
    expect(chestSlots(deposited)[1]).toEqual(stack('parsnip', 10));
    const withdrawn = move(deposited, C(0), P(2), 5);
    expect(chestSlots(withdrawn)[0]).toEqual(stack('wood', 15));
    expect(slot(withdrawn, 2)).toEqual(stack('wood', 5));
  });

  it('6. merges same-quality stacks across containers, up to maxStack', () => {
    const state = atChest(player, chest);
    const stone = move(state, P(3), C(3));
    expect(stone).toBe(state); // The chest's stone stack is already full.
    const back = move(state, C(3), P(3));
    expect(slot(back, 3)).toEqual(stack('stone', MAX));
    expect(chestSlots(back)[3]).toEqual(stack('stone', 5));
  });

  it('7. swaps different items or qualities across containers', () => {
    const state = atChest(player, chest);
    const swapped = move(state, P(4), C(2));
    expect(slot(swapped, 4)).toEqual(stack('parsnip', 4, 2));
    expect(chestSlots(swapped)[2]).toEqual(stack('parsnip', 3, 1));
    const items = move(state, C(0), P(0));
    expect(slot(items, 0)).toEqual(stack('wood', 20));
    expect(chestSlots(items)[0]).toEqual(stack('hoe', 1));
  });

  it('8. part of a stack onto a different stack across containers is a no-op', () => {
    const state = atChest(player, chest);
    expect(move(state, P(1), C(0), 2)).toBe(state);
    expect(move(state, C(0), P(1), 2)).toBe(state);
  });

  it('moves between two slots of the open chest', () => {
    const state = atChest(player, chest);
    const next = move(state, C(0), C(35), 8);
    expect(chestSlots(next)[0]).toEqual(stack('wood', 12));
    expect(chestSlots(next)[35]).toEqual(stack('wood', 8));
    expect(next.inventory).toBe(state.inventory);
  });

  it('writes the chest through its tile: only that tile changes, other maps keep their identity', () => {
    const state = atChest(player, chest);
    const next = move(state, P(1), C(1), 6);
    const object = tileAt(next, TARGET).object;
    expect(object?.kind).toBe('chest');
    expect(object !== null && object.kind === 'chest' ? object.slots[1] : null).toEqual(stack('parsnip', 6));
    expect(worldChangesOutside(state.maps.farm, next.maps.farm, TARGET)).toEqual([]);
    for (const id of MAP_IDS) if (id !== 'farm') expect(next.maps[id]).toBe(state.maps[id]);
    expect({ ...tileAt(next, TARGET), object: null }).toEqual({ ...tileAt(state, TARGET), object: null });
    expect(next.ui).toBe(state.ui);
    expect(next.player).toBe(state.player);
  });

  it('writes a chest on another map to that map', () => {
    const cleared = withTile(BASE, { tx: 20, tz: 19 }, EMPTY_TILE, 'forest');
    const chested = withTile(cleared, { tx: 20, tz: 20 }, { ...EMPTY_TILE, object: { kind: 'chest', slots: emptyChest() } }, 'forest');
    const state = gameReducer(withPlayer(withSlots(chested, [stack('wood', 9)]), { tx: 20, tz: 19 }, Direction.South, 'forest'), actions.interact());
    const next = move(state, P(0), C(4, { tx: 20, tz: 20 }, 'forest'));
    expect(chestSlots(next)[4]).toEqual(stack('wood', 9));
    expect(next.maps.farm).toBe(state.maps.farm);
    expect(next.maps.town).toBe(state.maps.town);
  });
});

describe('slot helpers', () => {
  const slots: Slots = deepFreeze([stack('stone', 10), null, stack('stone', MAX - 1), stack('parsnip', 2, 1)]);

  it('moveWithinSlots returns a new array, or null for a no-op, and never mutates', () => {
    expect(moveWithinSlots(slots, 0, 1, 4)).toEqual([stack('stone', 6), stack('stone', 4), stack('stone', MAX - 1), stack('parsnip', 2, 1)]);
    expect(moveWithinSlots(slots, 0, 2, 10)).toEqual([stack('stone', 9), null, stack('stone', MAX), stack('parsnip', 2, 1)]);
    expect(moveWithinSlots(slots, 0, 0, 10)).toBeNull();
    expect(moveWithinSlots(slots, 0, 3, 3)).toBeNull();
    expect(moveWithinSlots([stack('stone', 1), stack('stone', MAX)], 0, 1, 1)).toBeNull();
    const swapped = must(moveWithinSlots(slots, 3, 0, 2));
    expect(swapped[0]).toBe(slots[3]);
    expect(swapped[3]).toBe(slots[0]);
    expect(swapped[1]).toBe(slots[1]);
  });

  it('moveAcrossSlots returns both new arrays and keeps untouched slots', () => {
    const other: Slots = deepFreeze([null, stack('parsnip', 1, 1)]);
    const result = must(moveAcrossSlots(slots, 3, other, 1, 2));
    expect(result.src[3]).toBeNull();
    expect(result.dst[1]).toEqual(stack('parsnip', 3, 1));
    expect(result.src[0]).toBe(slots[0]);
    expect(result.dst[0]).toBeNull();
    expect(() => moveAcrossSlots(slots, 0, slots, 1, 1)).toThrow(InvariantError);
  });

  it('moveBetweenSlots handles one array or two and asserts its preconditions', () => {
    const same = must(moveBetweenSlots(slots, 0, slots, 1, 10));
    expect(same.src).toBe(same.dst);
    expect(same.src).toEqual([null, stack('stone', 10), stack('stone', MAX - 1), stack('parsnip', 2, 1)]);
    expect(() => moveBetweenSlots(slots, 1, slots, 0, 1)).toThrow(InvariantError);
    expect(() => moveBetweenSlots(slots, 0, slots, 1, 0)).toThrow(InvariantError);
    expect(() => moveBetweenSlots(slots, 0, slots, 1, 11)).toThrow(InvariantError);
    expect(() => moveBetweenSlots(slots, 0, slots, 9, 1)).toThrow(InvariantError);
  });
});

describe('property: random moves conserve items and keep every stack valid', () => {
  const ITEMS_USED: readonly ItemId[] = ['hoe', 'wateringCan', 'parsnip', 'potato', 'stone', 'wood', 'parsnip_seeds'];

  function randomStack(rng: () => number): ItemStack | null {
    if (rng() < 0.35) return null;
    const itemId = must(ITEMS_USED[Math.floor(rng() * ITEMS_USED.length)]);
    const item = getItem(itemId);
    const quantity = item.maxStack === 1 ? 1 : rng() < 0.2 ? item.maxStack - Math.floor(rng() * 3) : 1 + Math.floor(rng() * 40);
    const quality = item.hasQuality ? (Math.floor(rng() * 3) as 0 | 1 | 2) : 0;
    return stack(itemId, quantity, quality);
  }

  function randomRef(rng: () => number): SlotRef {
    const roll = rng();
    if (roll < 0.5) return P(Math.floor(rng() * 28) - 1);
    if (roll < 0.95) return C(Math.floor(rng() * 38) - 1);
    return C(0, { tx: TARGET.tx + 1, tz: TARGET.tz });
  }

  function totals(state: GameState): Map<string, number> {
    const sums = new Map<string, number>();
    for (const held of [...state.inventory.slots, ...chestSlots(state)]) {
      if (held === null) continue;
      const key = `${held.itemId}/${held.quality}`;
      sums.set(key, (sums.get(key) ?? 0) + held.quantity);
    }
    return sums;
  }

  it('holds over thousands of random moves', () => {
    const rng = mulberry32(0x5107);
    let state = atChest(
      Array.from({ length: INVENTORY.startingUnlockedSlots }, () => randomStack(rng)),
      Array.from({ length: INVENTORY.chestSlots }, () => randomStack(rng)),
      3,
    );
    const expected = totals(state);
    const problems: string[] = [];
    let applied = 0;
    for (let i = 0; i < 4000; i++) {
      const roll = rng();
      const quantity = roll < 0.4 ? null : roll < 0.9 ? 1 + Math.floor(rng() * 50) : -1;
      const action: GameAction = actions.moveItem(randomRef(rng), randomRef(rng), quantity);
      const next = gameReducer(state, action);
      if (next !== state) applied++;
      if (next.inventory.selected !== 3 || next.inventory.water !== state.inventory.water) problems.push(`#${i} selection or water changed`);
      for (let s = INVENTORY.startingUnlockedSlots; s < INVENTORY.slotCount; s++) {
        if (next.inventory.slots[s] !== null) problems.push(`#${i} locked slot ${s} filled`);
      }
      for (const held of [...next.inventory.slots, ...chestSlots(next)]) {
        if (held === null) continue;
        const item = getItem(held.itemId);
        if (!Number.isInteger(held.quantity) || held.quantity < 1 || held.quantity > item.maxStack) problems.push(`#${i} bad quantity`);
        if (held.quality !== 0 && !item.hasQuality) problems.push(`#${i} quality on ${held.itemId}`);
      }
      state = next;
    }
    expect(problems.slice(0, 10)).toEqual([]);
    expect(totals(state)).toEqual(expected);
    expect(applied).toBeGreaterThan(500);
    expect(state.inventory.slots).toHaveLength(INVENTORY.slotCount);
    expect(chestSlots(state)).toHaveLength(INVENTORY.chestSlots);
  });
});

describe('UI panels', () => {
  const shop = (state: GameState, open: boolean): GameState => gameReducer(state, actions.setShopOpen(open));
  const bag = (state: GameState, open: boolean): GameState => gameReducer(state, actions.setInventoryOpen(open));
  const close = (state: GameState): GameState => gameReducer(state, actions.closePanel());
  const pause = (state: GameState, paused: boolean): GameState => gameReducer(state, actions.setPaused(paused));

  it('opens the shop and the inventory only when no panel is open and the game is not paused', () => {
    expect(shop(BASE, true).ui.panel).toEqual({ kind: 'shop' });
    expect(bag(BASE, true).ui.panel).toEqual({ kind: 'inventory' });
    const shopping = shop(BASE, true);
    expect(bag(shopping, true)).toBe(shopping);
    expect(shop(shopping, true)).toBe(shopping);
    const packing = bag(BASE, true);
    expect(shop(packing, true)).toBe(packing);
    expect(bag(packing, true)).toBe(packing);
    const paused = pause(BASE, true);
    expect(shop(paused, true)).toBe(paused);
    expect(bag(paused, true)).toBe(paused);
    const chest = atChest([]);
    expect(shop(chest, true)).toBe(chest);
    expect(bag(chest, true)).toBe(chest);
  });

  it('closes the shop and the inventory only when that panel is the one open', () => {
    const shopping = shop(BASE, true);
    const packing = bag(BASE, true);
    const chest = atChest([]);
    expect(shop(shopping, false).ui.panel).toEqual({ kind: 'none' });
    expect(bag(packing, false).ui.panel).toEqual({ kind: 'none' });
    expect(bag(shopping, false)).toBe(shopping);
    expect(shop(packing, false)).toBe(packing);
    expect(shop(chest, false)).toBe(chest);
    expect(bag(chest, false)).toBe(chest);
    expect(shop(BASE, false)).toBe(BASE);
    expect(bag(BASE, false)).toBe(BASE);
    // Closing works while paused too.
    expect(shop(pause(shopping, true), false).ui).toEqual({ ...BASE.ui, panel: { kind: 'none' }, paused: true });
  });

  it('closePanel closes any panel and is a no-op with none open', () => {
    for (const state of [shop(BASE, true), bag(BASE, true), atChest([]), pause(bag(BASE, true), true)]) {
      const closed = close(state);
      expect(closed.ui.panel).toEqual({ kind: 'none' });
      expect(closed.ui.paused).toBe(state.ui.paused);
    }
    expect(close(BASE)).toBe(BASE);
    expect(close(pause(BASE, true))).toEqual(pause(BASE, true));
  });

  it('every panel freezes the clock, movement, tools and interaction; hotbar selection still works', () => {
    const panels: readonly GameState[] = [shop(scenario(EMPTY_TILE), true), bag(scenario(EMPTY_TILE), true), atChest([stack('hoe', 1)])];
    const frozenActions: readonly GameAction[] = [
      actions.tick(10),
      actions.tick(TIME.maxTickMinutes),
      actions.move(Direction.West),
      actions.face(Direction.East),
      actions.useTool(),
      actions.interact(),
      actions.sleep(),
    ];
    for (const state of panels) {
      expect(selectIsFrozen(state), state.ui.panel.kind).toBe(true);
      for (const action of frozenActions) expect(gameReducer(state, action), `${state.ui.panel.kind} ${action.type}`).toBe(state);
      expect(gameReducer(state, actions.selectSlot(5)).inventory.selected).toBe(5);
      expect(gameReducer(state, actions.cycleSlot(1)).inventory.selected).toBe(state.inventory.selected + 1);
    }
    // Once closed, the chest's player can walk and act again.
    const chestClosed = close(atChest([stack('hoe', 1)]));
    expect(selectIsFrozen(chestClosed)).toBe(false);
    expect(gameReducer(chestClosed, actions.move(Direction.West)).player.tx).toBe(STAND.tx - 1);
  });

  it('bounds hotbar selection and cycling to the 12 hotbar slots, not the 36 inventory slots', () => {
    for (const slotIndex of [12, 23, 35]) expect(gameReducer(BASE, actions.selectSlot(slotIndex))).toBe(BASE);
    const last = gameReducer(BASE, actions.selectSlot(INVENTORY.hotbarSize - 1));
    expect(gameReducer(last, actions.cycleSlot(1)).inventory.selected).toBe(0);
    expect(gameReducer(BASE, actions.cycleSlot(-1)).inventory.selected).toBe(INVENTORY.hotbarSize - 1);
  });

  it('game/load resets the panel and pause', () => {
    const loaded = deepFreeze({ ...atChest([]), ui: { ...BASE.ui, panel: { kind: 'chest' as const, mapId: 'farm' as const, tx: 5, tz: 10 }, paused: true, timeScale: 2 } });
    const next = gameReducer(BASE, actions.load(loaded));
    expect(next.ui).toEqual({ ...BASE.ui, panel: { kind: 'none' }, paused: false, timeScale: 2 });
  });
});
