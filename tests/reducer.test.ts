/**
 * The root reducer (src/state/reducer.ts), exercised action by action.
 *
 * Every tool on every relevant tile, energy costs and exhaustion, movement and facing,
 * interaction (harvest, ship, sleep, refill), the clock and passing out, the day transition,
 * the seed shop, UI toggles, selection, loading, and the rule that a frozen game (shop open
 * or paused) ignores movement, tools, interaction, sleep and ticks. All scenarios start from
 * a deep-frozen state, so any mutation inside the reducer would throw.
 */
import { describe, expect, it } from 'vitest';
import { INVENTORY, MESSAGES, PLAYER, TIME, TOOLS, WORLD } from '../src/config';
import { deepFreeze } from '../src/core/store';
import {
  Blocker,
  DIRECTIONS,
  Direction,
  Season,
  TileState,
  type GameState,
  type ItemStack,
  type MapId,
  type TileCoord,
} from '../src/core/types';
import { CROPS, createCropInstance, isMature, stageCount } from '../src/farming/crops';
import { actions, type GameAction } from '../src/state/actions';
import { createInitialState } from '../src/state/initialState';
import { FARM_ONLY_REASON, harvestQuantity, planInteraction, planPrimaryAction } from '../src/state/intents';
import { gameReducer } from '../src/state/reducer';
import { formatDate } from '../src/time/clock';
import { rollWeather } from '../src/time/weather';
import { inBounds, stepTile } from '../src/world/grid';
import { EMPTY_TILE, blockedTile, forEachTile, isHittableBlocker, isWalkable, requireTile } from '../src/world/tiles';
import {
  BASE,
  STAND,
  TARGET,
  atDay,
  count,
  cropOf,
  emptyHanded,
  holding,
  matureCrop,
  must,
  scenario,
  soilTile,
  tileAt,
  withEnergy,
  withGold,
  withPlayer,
  withSlots,
  withTile,
  withWater,
  worldChangesOutside,
} from './testUtils';

function run(state: GameState, ...sequence: readonly GameAction[]): GameState {
  return sequence.reduce(gameReducer, state);
}

function useTool(state: GameState): GameState {
  return gameReducer(state, actions.useTool());
}

function interact(state: GameState): GameState {
  return gameReducer(state, actions.interact());
}

function lastMessage(state: GameState): { readonly text: string; readonly tone: string } | undefined {
  return state.messages.entries[state.messages.entries.length - 1];
}

function messageTexts(state: GameState): string[] {
  return state.messages.entries.map((entry) => entry.text);
}

function fullOf(stack: ItemStack): (ItemStack | null)[] {
  return Array.from({ length: INVENTORY.hotbarSize }, () => stack);
}

/** Expects a failed attempt: feedback recorded, nothing else changed (apart from an optional message). */
function expectFailedAttempt(prev: GameState, next: GameState, kind: string, target: TileCoord | null, message: string | null): void {
  expect(next.maps).toBe(prev.maps);
  expect(next.inventory).toBe(prev.inventory);
  expect(next.player.energy).toBe(prev.player.energy);
  expect(next.player.actionSeq).toBe(prev.player.actionSeq + 1);
  expect(next.player.lastAction).toEqual({ seq: prev.player.actionSeq + 1, kind, target, success: false });
  if (message === null) expect(next.messages).toBe(prev.messages);
  else expect(lastMessage(next)).toMatchObject({ text: message, tone: 'warn' });
}

/** A walkable tile next to water on `mapId` (the farm pond by default) and the direction that faces the water. */
function waterShore(state: GameState, mapId: MapId = 'farm'): { readonly at: TileCoord; readonly facing: Direction } {
  const world = state.maps[mapId];
  const shores: { readonly at: TileCoord; readonly facing: Direction }[] = [];
  forEachTile(world, (tile, tx, tz) => {
    if (!isWalkable(tile)) return;
    for (const direction of DIRECTIONS) {
      const next = stepTile({ tx, tz }, direction);
      if (inBounds(world.grid, next.tx, next.tz) && requireTile(world, next.tx, next.tz).blocker === Blocker.Water) {
        shores.push({ at: { tx, tz }, facing: direction });
      }
    }
  });
  return must(shores[0], `no shore found on ${mapId}`);
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

describe('hoe', () => {
  it('tills grass into plowed soil for 2 energy, touching only the target tile', () => {
    const state = scenario(EMPTY_TILE);
    const next = useTool(state);
    expect(tileAt(next, TARGET)).toEqual(soilTile(TileState.Plowed));
    expect(next.player.energy).toBe(PLAYER.maxEnergy - TOOLS.energyCost.hoe);
    expect(next.player.lastAction).toEqual({ seq: 1, kind: 'hoe', target: TARGET, success: true });
    expect(worldChangesOutside(state.maps.farm, next.maps.farm, TARGET)).toEqual([]);
    expect(next.inventory).toBe(state.inventory);
    expect(next.messages).toBe(state.messages);
    expect(next.time).toBe(state.time);
  });

  it('refuses rocks and stumps with a hint, and other tiles silently', () => {
    const rock = scenario(blockedTile(Blocker.Rock, 2));
    expectFailedAttempt(rock, useTool(rock), 'hoe', TARGET, 'This rock needs a pickaxe.');
    const stump = scenario(blockedTile(Blocker.Stump, 3));
    expectFailedAttempt(stump, useTool(stump), 'hoe', TARGET, 'This stump needs an axe.');
    for (const tile of [soilTile(TileState.Plowed), soilTile(TileState.Watered), blockedTile(Blocker.House), blockedTile(Blocker.Water)]) {
      const state = scenario(tile);
      expectFailedAttempt(state, useTool(state), 'hoe', TARGET, null);
    }
  });

  it('clears a withered crop but keeps the soil (and its moisture)', () => {
    const state = scenario(soilTile(TileState.Watered, cropOf('parsnip', { dead: true, stage: 2 })));
    const next = useTool(state);
    expect(tileAt(next, TARGET)).toEqual(soilTile(TileState.Watered));
    expect(next.player.energy).toBe(PLAYER.maxEnergy - TOOLS.energyCost.hoe);
  });
});

describe('watering can', () => {
  it('waters dry soil, keeping the crop reference, for 1 water and 2 energy', () => {
    const crop = cropOf('corn');
    const state = scenario(soilTile(TileState.Plowed, crop), atDay(BASE, 30));
    const next = useTool(holding(state, 'wateringCan'));
    expect(tileAt(next, TARGET).state).toBe(TileState.Watered);
    expect(tileAt(next, TARGET).crop).toBe(crop);
    expect(next.inventory.water).toBe(TOOLS.wateringCanCapacity - 1);
    expect(next.player.energy).toBe(PLAYER.maxEnergy - TOOLS.energyCost.wateringCan);
    expect(next.player.lastAction).toMatchObject({ kind: 'wateringCan', success: true });
  });

  it('does nothing to already watered soil or grass', () => {
    for (const tile of [soilTile(TileState.Watered), EMPTY_TILE]) {
      const state = holding(scenario(tile), 'wateringCan');
      expectFailedAttempt(state, useTool(state), 'wateringCan', TARGET, null);
    }
  });

  it('drains exactly one unit per use and refuses when empty', () => {
    let state = holding(scenario(soilTile(TileState.Plowed)), 'wateringCan');
    for (let i = 0; i < TOOLS.wateringCanCapacity; i++) {
      state = useTool(withTile(state, TARGET, soilTile(TileState.Plowed)));
      expect(state.player.lastAction?.success).toBe(true);
    }
    expect(state.inventory.water).toBe(0);
    expect(state.player.energy).toBe(PLAYER.maxEnergy - TOOLS.wateringCanCapacity * TOOLS.energyCost.wateringCan);
    const dry = withTile(state, TARGET, soilTile(TileState.Plowed));
    expectFailedAttempt(dry, useTool(dry), 'wateringCan', TARGET, 'Your watering can is empty. Refill it at the pond.');
  });

  it('refills for free from water, and says so when already full', () => {
    const pond = holding(scenario(blockedTile(Blocker.Water)), 'wateringCan');
    const next = useTool(withEnergy(withWater(pond, 3), 0));
    expect(next.inventory.water).toBe(TOOLS.wateringCanCapacity);
    expect(next.player.energy).toBe(0);
    expect(next.maps).toBe(pond.maps);
    expect(next.player.lastAction).toEqual({ seq: 1, kind: 'refill', target: TARGET, success: true });
    expectFailedAttempt(pond, useTool(pond), 'refill', TARGET, 'Your watering can is already full.');
  });
});

describe('pickaxe', () => {
  it('breaks a 2-hp rock in two hits (2 → 1 → cleared) and drops one stone', () => {
    let state = holding(scenario(blockedTile(Blocker.Rock, TOOLS.rockHits)), 'pickaxe');
    state = useTool(state);
    expect(tileAt(state, TARGET)).toEqual(blockedTile(Blocker.Rock, 1));
    expect(count(state, 'stone')).toBe(0);
    expect(state.player.energy).toBe(PLAYER.maxEnergy - TOOLS.energyCost.pickaxe);
    expect(state.stats.debrisCleared).toBe(0);
    state = useTool(state);
    expect(tileAt(state, TARGET)).toBe(EMPTY_TILE);
    expect(count(state, 'stone')).toBe(TOOLS.stoneFromRock);
    expect(state.stats.debrisCleared).toBe(1);
    expect(state.player.energy).toBe(PLAYER.maxEnergy - 2 * TOOLS.energyCost.pickaxe);
    expect(state.player.actionSeq).toBe(2);
    // The target is now grass, which the pickaxe ignores.
    expectFailedAttempt(state, useTool(state), 'pickaxe', TARGET, null);
  });

  it('clears the rock even without room for the stone, and says so', () => {
    const state = withSlots(scenario(blockedTile(Blocker.Rock, 1)), [
      { itemId: 'pickaxe', quantity: 1 },
      ...fullOf({ itemId: 'wood', quantity: INVENTORY.maxStack }).slice(1),
    ]);
    const next = useTool(state);
    expect(tileAt(next, TARGET)).toBe(EMPTY_TILE);
    expect(count(next, 'stone')).toBe(0);
    expect(lastMessage(next)).toMatchObject({ text: 'No room for Stone.', tone: 'warn' });
  });

  it('turns empty or withered soil back into grass, but not soil with a living crop', () => {
    for (const tile of [soilTile(TileState.Plowed), soilTile(TileState.Watered), soilTile(TileState.Watered, cropOf('potato', { dead: true }))]) {
      const next = useTool(holding(scenario(tile), 'pickaxe'));
      expect(tileAt(next, TARGET)).toBe(EMPTY_TILE);
    }
    const growing = holding(scenario(soilTile(TileState.Plowed, cropOf('potato'))), 'pickaxe');
    expectFailedAttempt(growing, useTool(growing), 'pickaxe', TARGET, null);
    const stump = holding(scenario(blockedTile(Blocker.Stump, 3)), 'pickaxe');
    expectFailedAttempt(stump, useTool(stump), 'pickaxe', TARGET, 'This stump needs an axe.');
  });
});

describe('axe', () => {
  it('chops a 3-hp stump in three hits and drops two wood', () => {
    let state = holding(scenario(blockedTile(Blocker.Stump, TOOLS.stumpHits)), 'axe');
    for (let hp = TOOLS.stumpHits - 1; hp >= 1; hp--) {
      state = useTool(state);
      expect(tileAt(state, TARGET)).toEqual(blockedTile(Blocker.Stump, hp));
      expect(count(state, 'wood')).toBe(0);
    }
    expect(state.stats.debrisCleared).toBe(0);
    state = useTool(state);
    expect(tileAt(state, TARGET)).toBe(EMPTY_TILE);
    expect(count(state, 'wood')).toBe(TOOLS.woodFromStump);
    expect(state.stats.debrisCleared).toBe(1);
    expect(state.player.energy).toBe(PLAYER.maxEnergy - TOOLS.stumpHits * TOOLS.energyCost.axe);
    // Wood lands in the first empty slot.
    expect(state.inventory.slots[6]).toEqual({ itemId: 'wood', quantity: TOOLS.woodFromStump });
  });

  it('fells a tree into a fresh stump, then clears the stump: wood and cleared debris add up', () => {
    let state = holding(scenario(blockedTile(Blocker.Tree, TOOLS.treeHits)), 'axe');
    expect(planPrimaryAction(state).intent).toEqual({ kind: 'chop', blocker: Blocker.Tree });
    for (let hp = TOOLS.treeHits - 1; hp >= 1; hp--) {
      state = useTool(state);
      expect(tileAt(state, TARGET)).toEqual(blockedTile(Blocker.Tree, hp));
      expect(count(state, 'wood')).toBe(0);
    }
    state = useTool(state);
    // The tree falls: its stump takes the usual stump hits, and the tree counts as cleared once.
    expect(tileAt(state, TARGET)).toEqual(blockedTile(Blocker.Stump, TOOLS.stumpHits));
    expect(count(state, 'wood')).toBe(TOOLS.woodFromTree);
    expect(state.stats.debrisCleared).toBe(1);
    expect(state.player.lastAction).toMatchObject({ kind: 'axe', success: true, target: TARGET });
    expect(planPrimaryAction(state).intent).toEqual({ kind: 'chop', blocker: Blocker.Stump });
    for (let hit = 0; hit < TOOLS.stumpHits; hit++) state = useTool(state);
    expect(tileAt(state, TARGET)).toBe(EMPTY_TILE);
    expect(count(state, 'wood')).toBe(TOOLS.woodFromTree + TOOLS.woodFromStump);
    expect(state.stats.debrisCleared).toBe(2);
    expect(state.player.energy).toBe(PLAYER.maxEnergy - (TOOLS.treeHits + TOOLS.stumpHits) * TOOLS.energyCost.axe);
    expect(state.player.actionSeq).toBe(TOOLS.treeHits + TOOLS.stumpHits);
    // Grass now: the axe has nothing left to do.
    expectFailedAttempt(state, useTool(state), 'axe', TARGET, null);
  });

  it('fells the tree even without room for its wood, and says so', () => {
    const state = withSlots(scenario(blockedTile(Blocker.Tree, 1)), [
      { itemId: 'axe', quantity: 1 },
      ...fullOf({ itemId: 'stone', quantity: INVENTORY.maxStack }).slice(1),
    ]);
    const next = useTool(state);
    expect(tileAt(next, TARGET)).toEqual(blockedTile(Blocker.Stump, TOOLS.stumpHits));
    expect(count(next, 'wood')).toBe(0);
    expect(next.stats.debrisCleared).toBe(1);
    expect(lastMessage(next)).toMatchObject({ text: 'No room for Wood.', tone: 'warn' });
  });

  it('refuses rocks and weeds with a hint', () => {
    const rock = holding(scenario(blockedTile(Blocker.Rock, 2)), 'axe');
    expectFailedAttempt(rock, useTool(rock), 'axe', TARGET, 'This rock needs a pickaxe.');
    const weeds = holding(scenario(blockedTile(Blocker.Weeds)), 'axe');
    expectFailedAttempt(weeds, useTool(weeds), 'axe', TARGET, 'Cut these weeds with the scythe.');
  });
});

describe('scythe', () => {
  it('harvests a mature crop for free, keeping the soil', () => {
    const state = holding(scenario(soilTile(TileState.Watered, matureCrop('parsnip'))), 'scythe');
    const next = useTool(withEnergy(state, 0));
    expect(tileAt(next, TARGET)).toEqual(soilTile(TileState.Watered));
    expect(count(next, 'parsnip')).toBe(1);
    expect(next.player.energy).toBe(0);
    expect(next.player.lastAction).toMatchObject({ kind: 'scythe', success: true });
    expect(lastMessage(next)).toMatchObject({ text: 'Harvested Parsnip ×1.', tone: 'success' });
  });

  it('ignores growing crops and clears withered ones', () => {
    const growing = holding(scenario(soilTile(TileState.Plowed, cropOf('parsnip', { stage: 3 }))), 'scythe');
    expectFailedAttempt(growing, useTool(growing), 'scythe', TARGET, null);
    const withered = holding(scenario(soilTile(TileState.Plowed, cropOf('parsnip', { dead: true }))), 'scythe');
    expect(tileAt(useTool(withered), TARGET)).toEqual(soilTile(TileState.Plowed));
  });

  it('cuts weeds down to grass for no energy and no drop, counting the cleared debris', () => {
    const state = withEnergy(holding(scenario(blockedTile(Blocker.Weeds)), 'scythe'), 0);
    const next = useTool(state);
    expect(tileAt(next, TARGET)).toBe(EMPTY_TILE);
    expect(next.player.energy).toBe(0);
    expect(next.inventory).toBe(state.inventory);
    expect(next.stats.debrisCleared).toBe(state.stats.debrisCleared + 1);
    expect(next.player.lastAction).toEqual({ seq: 1, kind: 'scythe', target: TARGET, success: true });
    expect(next.messages).toBe(state.messages);
    expect(worldChangesOutside(state.maps.farm, next.maps.farm, TARGET)).toEqual([]);
    // Now grass: nothing more to cut.
    expectFailedAttempt(next, useTool(next), 'scythe', TARGET, null);
  });

  it('leaves weeds to the scythe: every other tool explains, interacting does nothing', () => {
    for (const tool of ['hoe', 'pickaxe', 'axe'] as const) {
      const state = holding(scenario(blockedTile(Blocker.Weeds)), tool);
      expectFailedAttempt(state, useTool(state), tool, TARGET, 'Cut these weeds with the scythe.');
    }
    const hands = emptyHanded(scenario(blockedTile(Blocker.Weeds)));
    expect(interact(hands)).toBe(hands);
  });
});

describe('per-map rules', () => {
  /** A bare trail tile in the forest and a bare cobble tile on the town's main street, with the tile south of each. */
  const OFF_FARM = [
    { mapId: 'forest', stand: { tx: 30, tz: 15 }, target: { tx: 30, tz: 16 } },
    { mapId: 'town', stand: { tx: 10, tz: 16 }, target: { tx: 10, tz: 17 } },
  ] as const;

  it('refuses the hoe and seeds off the farm, with no energy spent', () => {
    for (const { mapId, stand, target } of OFF_FARM) {
      const there = withPlayer(BASE, stand, Direction.South, mapId);
      expect(tileAt(there, target)).toBe(EMPTY_TILE);
      const hoe = holding(there, 'hoe');
      expectFailedAttempt(hoe, useTool(hoe), 'hoe', target, FARM_ONLY_REASON);
      // Even on soil (which no map but the farm can have), seeds are refused.
      const seeded = holding(withTile(there, target, soilTile(TileState.Plowed)), 'parsnip_seeds', 5);
      expectFailedAttempt(seeded, useTool(seeded), 'plant', target, FARM_ONLY_REASON);
    }
    // The same actions work on the farm.
    expect(tileAt(useTool(holding(scenario(EMPTY_TILE), 'hoe')), TARGET)).toEqual(soilTile(TileState.Plowed));
  });

  it('refills the watering can at the forest brook and the town river', () => {
    for (const mapId of ['forest', 'town'] as const) {
      const shore = waterShore(BASE, mapId);
      const state = withWater(withPlayer(BASE, shore.at, shore.facing, mapId), 3);
      const target = stepTile(shore.at, shore.facing);
      for (const next of [useTool(holding(state, 'wateringCan')), interact(state)]) {
        expect(next.inventory.water).toBe(TOOLS.wateringCanCapacity);
        expect(next.player.lastAction).toMatchObject({ kind: 'refill', success: true, target });
        expect(next.maps).toBe(state.maps);
      }
    }
  });

  it('does nothing, silently, when interacting with a town building', () => {
    // The general store's door, faced from the square in front of it.
    const state = emptyHanded(withPlayer(BASE, { tx: 6, tz: 7 }, Direction.North, 'town'));
    expect(tileAt(state, { tx: 6, tz: 6 }).blocker).toBe(Blocker.Building);
    expect(planInteraction(state).intent).toEqual({ kind: 'blocked', reason: null });
    expect(interact(state)).toBe(state);
    const hoe = holding(state, 'hoe');
    expectFailedAttempt(hoe, useTool(hoe), 'hoe', { tx: 6, tz: 6 }, null);
  });
});

describe('tiles holding a placed object', () => {
  const sprinklerSoil = { ...soilTile(TileState.Plowed), object: { kind: 'sprinkler' } } as const;

  it('never lets the pickaxe or the hoe clear or dig a tile with an object (no energy spent)', () => {
    const chest = { ...EMPTY_TILE, object: { kind: 'chest', slots: Array.from({ length: INVENTORY.chestSlots }, () => null) } } as const;
    const path = { ...EMPTY_TILE, object: { kind: 'woodPath' } } as const;
    for (const tile of [sprinklerSoil, { ...soilTile(TileState.Watered), object: { kind: 'scarecrow' } } as const, chest, path]) {
      for (const tool of ['pickaxe', 'hoe'] as const) {
        const state = holding(scenario(tile), tool);
        expect(planPrimaryAction(state).energyCost).toBe(0);
        expectFailedAttempt(state, useTool(state), tool, TARGET, null);
      }
    }
  });

  it('waters the soil under a sprinkler and keeps the sprinkler', () => {
    const state = holding(scenario(sprinklerSoil), 'wateringCan');
    const next = useTool(state);
    expect(tileAt(next, TARGET)).toEqual({ ...sprinklerSoil, state: TileState.Watered });
    expect(next.inventory.water).toBe(state.inventory.water - 1);
  });

  it('scatters seeds around a tile with an object, never onto it', () => {
    const beyond = { tx: TARGET.tx, tz: TARGET.tz + 1 };
    const state = holding(withTile(scenario(sprinklerSoil), beyond, soilTile(TileState.Plowed)), 'parsnip_seeds', 5);
    const next = useTool(state);
    expect(tileAt(next, TARGET)).toBe(tileAt(state, TARGET));
    expect(tileAt(next, beyond).crop).toEqual(createCropInstance('parsnip', 0));
    expect(count(next, 'parsnip_seeds')).toBe(4);
    // With only the object's tile tilled, there is nothing to plant.
    const alone = holding(scenario(sprinklerSoil), 'parsnip_seeds', 5);
    expect(planPrimaryAction(alone).intent.kind).toBe('blocked');
  });
});

describe('seeds', () => {
  it('plants an in-season crop on soil, consuming one seed and no energy', () => {
    const state = holding(scenario(soilTile(TileState.Plowed), atDay(BASE, 3)), 'parsnip_seeds', 15);
    const next = useTool(state);
    expect(tileAt(next, TARGET)).toEqual(soilTile(TileState.Plowed, createCropInstance('parsnip', 3)));
    expect(count(next, 'parsnip_seeds')).toBe(14);
    expect(next.player.energy).toBe(PLAYER.maxEnergy);
    expect(next.player.lastAction).toEqual({ seq: 1, kind: 'plant', target: TARGET, success: true });
  });

  it('empties the slot when the last seed is planted', () => {
    const state = holding(scenario(soilTile(TileState.Watered)), 'potato_seeds', 1);
    const next = useTool(state);
    expect(next.inventory.slots[next.inventory.selected]).toBeNull();
    expect(tileAt(next, TARGET).crop?.cropId).toBe('potato');
  });

  it('refuses out-of-season seeds, unplowed ground and occupied soil', () => {
    const outOfSeason = holding(scenario(soilTile(TileState.Plowed)), 'pumpkin_seeds', 4);
    expectFailedAttempt(outOfSeason, useTool(outOfSeason), 'plant', TARGET, "Pumpkin won't grow in Spring.");
    const grass = holding(scenario(EMPTY_TILE), 'parsnip_seeds', 4);
    expectFailedAttempt(grass, useTool(grass), 'plant', TARGET, 'Till the soil with the hoe first.');
    // The rest of the patch is grass, so the only advice left is to till.
    const occupied = holding(scenario(soilTile(TileState.Plowed, cropOf('parsnip'))), 'parsnip_seeds', 4);
    expectFailedAttempt(occupied, useTool(occupied), 'plant', TARGET, 'Till the soil with the hoe first.');
    const winter = holding(scenario(soilTile(TileState.Plowed), atDay(BASE, 100)), 'corn_seeds', 4);
    expectFailedAttempt(winter, useTool(winter), 'plant', TARGET, "Corn won't grow in Winter.");
  });
});

describe('energy', () => {
  it('refuses costly tools when exhausted, allowing a tool that costs exactly the remaining energy', () => {
    const tired = withEnergy(scenario(EMPTY_TILE), 1);
    expectFailedAttempt(tired, useTool(tired), 'hoe', TARGET, "You're too exhausted. Get some sleep.");
    const exact = useTool(withEnergy(scenario(EMPTY_TILE), 2));
    expect(exact.player.energy).toBe(0);
    expect(tileAt(exact, TARGET).state).toBe(TileState.Plowed);
  });

  it('allows exactly floor(maxEnergy / cost) uses per day', () => {
    let state = scenario(EMPTY_TILE);
    let successes = 0;
    for (let i = 0; i < 80; i++) {
      state = useTool(withTile(state, TARGET, EMPTY_TILE));
      if (state.player.lastAction?.success === true) successes++;
    }
    expect(successes).toBe(Math.floor(PLAYER.maxEnergy / TOOLS.energyCost.hoe));
    expect(state.player.energy).toBe(0);
    expect(state.player.actionSeq).toBe(80);
  });
});

describe('facing the edge of the world', () => {
  it('records a failed tool swing with no target', () => {
    const state = withPlayer(BASE, { tx: 5, tz: 0 }, Direction.North);
    expectFailedAttempt(state, useTool(state), 'hoe', null, null);
    expect(interact(state)).toBe(state);
  });
});

// ---------------------------------------------------------------------------
// Interaction
// ---------------------------------------------------------------------------

describe('interact: harvest', () => {
  it('harvests the deterministic yield with "harvest" feedback and no energy', () => {
    for (let day = 0; day < 20; day++) {
      const state = scenario(soilTile(TileState.Plowed, matureCrop('potato')), atDay(BASE, day));
      const expected = harvestQuantity(state, TARGET, must(tileAt(state, TARGET).crop));
      const next = interact(state);
      expect(count(next, 'potato')).toBe(expected);
      expect(interact(state)).toEqual(next);
      expect(next.player.lastAction).toEqual({ seq: 1, kind: 'harvest', target: TARGET, success: true });
      expect(next.player.energy).toBe(PLAYER.maxEnergy);
      expect(tileAt(next, TARGET).crop).toBeNull();
    }
  });

  it('sends regrowing crops back to their last stage, maturing again after regrowDays watered nights', () => {
    let state = scenario(soilTile(TileState.Watered, matureCrop('strawberry')), atDay(BASE, 2));
    state = interact(state);
    const def = CROPS.strawberry;
    expect(tileAt(state, TARGET).crop).toEqual({
      ...matureCrop('strawberry'),
      stage: stageCount(def) - 1,
      daysInStage: 0,
      dryDays: 0,
      regrowing: true,
      harvestCount: 1,
    });
    const regrowDays = must(def.regrowDays);
    for (let night = 1; night <= regrowDays; night++) {
      const soil = tileAt(state, TARGET);
      state = gameReducer(withTile(state, TARGET, { ...soil, state: TileState.Watered }), actions.sleep());
      expect(isMature(must(tileAt(state, TARGET).crop))).toBe(night === regrowDays);
    }
    state = withPlayer(state, STAND, Direction.South);
    const before = count(state, 'strawberry');
    const quantity = harvestQuantity(state, TARGET, must(tileAt(state, TARGET).crop));
    state = interact(state);
    expect(count(state, 'strawberry')).toBe(before + quantity);
    expect(tileAt(state, TARGET).crop?.harvestCount).toBe(2);
  });

  it('refuses a harvest that does not fit, leaving the crop in place', () => {
    const state = withSlots(scenario(soilTile(TileState.Plowed, matureCrop('melon')), atDay(BASE, 30)), fullOf({ itemId: 'stone', quantity: 999 }));
    expectFailedAttempt(state, interact(state), 'harvest', TARGET, 'Your inventory is full.');
  });

  it('clears withered crops and is a silent no-op on growing ones', () => {
    const dead = scenario(soilTile(TileState.Plowed, cropOf('parsnip', { dead: true })));
    expect(tileAt(interact(dead), TARGET)).toEqual(soilTile(TileState.Plowed));
    const growing = scenario(soilTile(TileState.Plowed, cropOf('parsnip')));
    expect(interact(growing)).toBe(growing);
    const grass = scenario(EMPTY_TILE);
    expect(interact(grass)).toBe(grass);
  });
});

describe('interact: shipping bin', () => {
  const atBin = withPlayer(BASE, { tx: 9, tz: 6 }, Direction.North);

  it('faces the real shipping bin from (9, 6)', () => {
    expect(requireTile(atBin.maps.farm, 9, 5).blocker).toBe(Blocker.ShippingBin);
  });

  it('ships the whole selected stack, merges pending stacks and pays out the next morning', () => {
    let state = holding(atBin, 'parsnip', 5);
    state = interact(state);
    expect(state.inventory.slots[state.inventory.selected]).toBeNull();
    expect(state.shipping.pending).toEqual([{ itemId: 'parsnip', quantity: 5 }]);
    expect(state.player.gold).toBe(PLAYER.startingGold);
    expect(state.player.lastAction).toMatchObject({ kind: 'ship', success: true, target: { tx: 9, tz: 5 } });
    expect(lastMessage(state)).toMatchObject({ text: 'Shipped Parsnip ×5 — 175g tomorrow.', tone: 'success' });

    state = interact(holding(state, 'parsnip', 3));
    state = interact(holding(state, 'stone', 10));
    expect(state.shipping.pending).toEqual([
      { itemId: 'parsnip', quantity: 8 },
      { itemId: 'stone', quantity: 10 },
    ]);

    const payout = 8 * CROPS.parsnip.sellPrice + 10 * 2;
    state = gameReducer(state, actions.sleep());
    expect(state.player.gold).toBe(PLAYER.startingGold + payout);
    expect(state.shipping).toEqual({ pending: [], lastPayout: payout });
    expect(messageTexts(state)).toContain(`Your shipment sold for ${payout}g.`);

    state = gameReducer(state, actions.sleep());
    expect(state.player.gold).toBe(PLAYER.startingGold + payout);
    expect(state.shipping.lastPayout).toBe(0);
  });

  it('pays out when the day ends by passing out, too', () => {
    const shipped = interact(holding(atDay(atBin, 0, 1550), 'stone', 7));
    const next = gameReducer(shipped, actions.tick(10));
    expect(next.time.absoluteDay).toBe(1);
    expect(next.player.gold).toBe(PLAYER.startingGold + 14);
  });

  it('refuses tools and empty hands with an explanation', () => {
    const tool = holding(atBin, 'hoe');
    expectFailedAttempt(tool, interact(tool), 'ship', { tx: 9, tz: 5 }, "Hoe can't be shipped.");
    const empty = emptyHanded(atBin);
    expectFailedAttempt(empty, interact(empty), 'ship', { tx: 9, tz: 5 }, 'Select something on your hotbar to ship it.');
  });
});

describe('interact: house and pond', () => {
  it('sleeps at the house door and starts the next morning at the spawn', () => {
    const state = withEnergy(withPlayer(BASE, PLAYER.spawn, Direction.North), 30);
    const next = interact(state);
    expect(next.time).toEqual({ minuteOfDay: TIME.dayStartMinute, dayOfSeason: 2, season: Season.Spring, year: 1, absoluteDay: 1 });
    expect(next.weather).toBe(rollWeather(state.seed, 1));
    expect(next.player).toMatchObject({
      tx: PLAYER.spawn.tx,
      tz: PLAYER.spawn.tz,
      facing: PLAYER.spawnFacing,
      energy: PLAYER.maxEnergy,
      teleportSeq: 1,
      moveSeq: 0,
      actionSeq: 1,
      lastAction: { seq: 1, kind: 'sleep', target: { tx: PLAYER.spawn.tx, tz: PLAYER.spawn.tz - 1 }, success: true },
    });
    expect(messageTexts(next)).toContain(`Good morning! ${formatDate(next.time)}.`);
  });

  it('refills the watering can at the generated pond', () => {
    const shore = waterShore(BASE);
    const state = withWater(withPlayer(BASE, shore.at, shore.facing), 3);
    const next = interact(state);
    expect(next.inventory.water).toBe(TOOLS.wateringCanCapacity);
    expect(next.player.lastAction).toMatchObject({ kind: 'refill', success: true, target: stepTile(shore.at, shore.facing) });
    // Full can: silent no-op.
    const full = withWater(state, TOOLS.wateringCanCapacity);
    expect(interact(full)).toBe(full);
  });
});

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

describe('time/tick', () => {
  it('advances the clock by whole minutes, capped at maxTickMinutes', () => {
    const next = gameReducer(BASE, actions.tick(10));
    expect(next.time.minuteOfDay).toBe(370);
    expect(next.maps).toBe(BASE.maps);
    expect(next.player).toBe(BASE.player);
    expect(gameReducer(BASE, actions.tick(1.9)).time.minuteOfDay).toBe(361);
    expect(gameReducer(BASE, actions.tick(1000)).time.minuteOfDay).toBe(360 + TIME.maxTickMinutes);
  });

  it('ignores zero, negative, fractional-below-one and non-finite ticks', () => {
    for (const minutes of [0, -5, 0.9, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(gameReducer(BASE, actions.tick(minutes))).toBe(BASE);
    }
  });

  it('does not pass out one minute before 26:00', () => {
    const next = gameReducer(atDay(BASE, 0, 1500), actions.tick(59));
    expect(next.time.minuteOfDay).toBe(1559);
    expect(next.time.absoluteDay).toBe(0);
  });

  it('passes out at 26:00: next morning, half energy, back at the spawn', () => {
    const late = withEnergy(withPlayer(atDay(BASE, 4, 1500), STAND, Direction.East), 12);
    const next = gameReducer(late, actions.tick(60));
    expect(next.time).toMatchObject({ absoluteDay: 5, minuteOfDay: TIME.dayStartMinute });
    expect(next.player.energy).toBe(Math.round(PLAYER.maxEnergy * PLAYER.passOutEnergyFraction));
    expect(next.player.energy).toBe(50);
    expect(next.player).toMatchObject({ tx: PLAYER.spawn.tx, tz: PLAYER.spawn.tz, facing: PLAYER.spawnFacing, teleportSeq: 1 });
    expect(messageTexts(next)).toContain('You passed out from exhaustion and woke up at home with half your energy.');
    // Overshooting the deadline is the same as hitting it exactly.
    expect(gameReducer(late, actions.tick(120))).toEqual(next);
  });

  it('passes out exactly once over a whole day of 10-minute ticks', () => {
    let state = BASE;
    let transitions = 0;
    for (let i = 0; i < (TIME.passOutMinute - TIME.dayStartMinute) / 10; i++) {
      const next = gameReducer(state, actions.tick(10));
      if (next.time.absoluteDay !== state.time.absoluteDay) transitions++;
      state = next;
    }
    expect(transitions).toBe(1);
    expect(state.time).toMatchObject({ absoluteDay: 1, minuteOfDay: TIME.dayStartMinute });
  });
});

describe('day/sleep', () => {
  it('restores energy, advances the calendar, rolls weather and teleports the player home', () => {
    const tired = withEnergy(withPlayer(atDay(BASE, 9, 1200), STAND, Direction.West), 3);
    const next = gameReducer(tired, actions.sleep());
    expect(next.time).toEqual({ minuteOfDay: 360, dayOfSeason: 11, season: Season.Spring, year: 1, absoluteDay: 10 });
    expect(next.weather).toBe(rollWeather(WORLD.seed, 10));
    expect(next.player).toMatchObject({
      energy: PLAYER.maxEnergy,
      tx: PLAYER.spawn.tx,
      tz: PLAYER.spawn.tz,
      facing: PLAYER.spawnFacing,
      teleportSeq: tired.player.teleportSeq + 1,
      moveSeq: tired.player.moveSeq,
    });
    expect(messageTexts(next)).not.toContain('You passed out from exhaustion and woke up at home with half your energy.');
  });

  it('withers out-of-season crops when Spring turns to Summer (day 27 → 28)', () => {
    const state = withTile(atDay(BASE, 27), TARGET, soilTile(TileState.Watered, cropOf('parsnip', { stage: 2 })));
    const next = gameReducer(state, actions.sleep());
    expect(next.time.season).toBe(Season.Summer);
    expect(tileAt(next, TARGET).crop?.dead).toBe(true);
    expect(messageTexts(next)).toContain('Summer has arrived! Out-of-season crops have withered.');
  });

  it('keeps corn alive from Summer into Fall (day 55 → 56) and grows it', () => {
    const corn = cropOf('corn', { stage: 2, daysInStage: 0 });
    const state = withTile(atDay(BASE, 55), TARGET, soilTile(TileState.Watered, corn));
    const next = gameReducer(state, actions.sleep());
    expect(next.time.season).toBe(Season.Fall);
    expect(tileAt(next, TARGET).crop).toEqual({ ...corn, daysInStage: 1 });
  });

  it('rolls into Year 2 after the last day of Winter', () => {
    const next = gameReducer(atDay(BASE, 111), actions.sleep());
    expect(next.time).toMatchObject({ absoluteDay: 112, year: 2, season: Season.Spring, dayOfSeason: 1 });
  });

  it('matures a parsnip after exactly 4 watered nights through the real action flow', () => {
    // Till, plant and water in front of the spawn, then water again every morning.
    let state = gameReducer(BASE, actions.move(Direction.South));
    state = run(state, actions.move(Direction.South), actions.useTool(), actions.selectSlot(5), actions.useTool(), actions.selectSlot(1));
    const plot = { tx: PLAYER.spawn.tx, tz: PLAYER.spawn.tz + 3 };
    expect(tileAt(state, plot).crop?.cropId).toBe('parsnip');
    for (let night = 1; night <= 4; night++) {
      state = run(state, actions.useTool(), actions.sleep());
      expect(isMature(must(tileAt(state, plot).crop))).toBe(night === 4);
      state = run(state, actions.move(Direction.South), actions.move(Direction.South));
      expect(state.player).toMatchObject({ tx: PLAYER.spawn.tx, tz: PLAYER.spawn.tz + 2, facing: Direction.South });
    }
    state = gameReducer(state, actions.interact());
    expect(count(state, 'parsnip')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------

describe('movement', () => {
  it('steps onto walkable tiles, facing the move direction', () => {
    const { tx, tz } = PLAYER.spawn;
    const next = gameReducer(BASE, actions.move(Direction.South));
    expect(next.player).toMatchObject({ tx, tz: tz + 1, facing: Direction.South, moveSeq: 1 });
    expect(next.maps).toBe(BASE.maps);
    const east = gameReducer(next, actions.move(Direction.East));
    expect(east.player).toMatchObject({ tx: tx + 1, tz: tz + 1, facing: Direction.East, moveSeq: 2 });
  });

  it('walks over soil and crops', () => {
    const below = { tx: PLAYER.spawn.tx, tz: PLAYER.spawn.tz + 1 };
    const state = withTile(BASE, below, soilTile(TileState.Watered, cropOf('parsnip')));
    expect(gameReducer(state, actions.move(Direction.South)).player).toMatchObject(below);
  });

  it('is blocked by every blocker but still turns to face it', () => {
    const below = { tx: PLAYER.spawn.tx, tz: PLAYER.spawn.tz + 1 };
    const blockers = [
      Blocker.Rock,
      Blocker.Stump,
      Blocker.Water,
      Blocker.House,
      Blocker.ShippingBin,
      Blocker.Tree,
      Blocker.Weeds,
      Blocker.Building,
    ] as const;
    for (const blocker of blockers) {
      // Only debris counts hits; every other blocker keeps blockerHp at 0.
      const tile = blockedTile(blocker, isHittableBlocker(blocker) ? 1 : 0);
      const state = withTile(withPlayer(BASE, PLAYER.spawn, Direction.North), below, tile);
      const next = gameReducer(state, actions.move(Direction.South));
      expect(next.player).toMatchObject({ ...PLAYER.spawn, facing: Direction.South, moveSeq: 0 });
      expect(gameReducer(next, actions.move(Direction.South))).toBe(next);
    }
    // The real house north of the spawn.
    const house = gameReducer(BASE, actions.move(Direction.North));
    expect(house.player).toMatchObject({ ...PLAYER.spawn, facing: Direction.North, moveSeq: 0 });
  });

  it('stops at the world edge but turns to face it', () => {
    const edge = withPlayer(BASE, { tx: 5, tz: 0 }, Direction.South);
    const next = gameReducer(edge, actions.move(Direction.North));
    expect(next.player).toMatchObject({ tx: 5, tz: 0, facing: Direction.North, moveSeq: 0 });
    expect(gameReducer(next, actions.move(Direction.North))).toBe(next);
  });

  it('ignores invalid directions; face only turns', () => {
    expect(gameReducer(BASE, actions.move(7 as number as Direction))).toBe(BASE);
    expect(gameReducer(BASE, actions.face(-1 as number as Direction))).toBe(BASE);
    expect(gameReducer(BASE, actions.face(Direction.South))).toBe(BASE);
    const turned = gameReducer(BASE, actions.face(Direction.West));
    expect(turned.player).toEqual({ ...BASE.player, facing: Direction.West });
  });
});

// ---------------------------------------------------------------------------
// Frozen game
// ---------------------------------------------------------------------------

describe('frozen game (shop open or paused)', () => {
  const frozenStates: readonly (readonly [string, GameState])[] = [
    ['shop open', gameReducer(scenario(EMPTY_TILE), actions.setShopOpen(true))],
    ['paused', gameReducer(scenario(EMPTY_TILE), actions.setPaused(true))],
  ];

  it.each(frozenStates)('ignores movement, facing, tools, interaction, sleep and ticks while %s', (_label, state) => {
    const ignored: readonly GameAction[] = [
      actions.move(Direction.North),
      actions.move(Direction.East),
      actions.face(Direction.West),
      actions.useTool(),
      actions.interact(),
      actions.sleep(),
      actions.tick(10),
      actions.tick(TIME.maxTickMinutes),
    ];
    for (const action of ignored) expect(gameReducer(state, action), action.type).toBe(state);
  });

  it.each(frozenStates)('still allows hotbar selection while %s', (_label, state) => {
    expect(gameReducer(state, actions.selectSlot(3)).inventory.selected).toBe(3);
    expect(gameReducer(state, actions.cycleSlot(-1)).inventory.selected).toBe(INVENTORY.hotbarSize - 1);
  });

  it('cannot open the shop while paused, but can pause while shopping', () => {
    const paused = gameReducer(BASE, actions.setPaused(true));
    expect(gameReducer(paused, actions.setShopOpen(true))).toBe(paused);
    const shopping = gameReducer(BASE, actions.setShopOpen(true));
    const both = gameReducer(shopping, actions.setPaused(true));
    expect(both.ui).toMatchObject({ shopOpen: true, paused: true });
    expect(gameReducer(both, actions.setPaused(true))).toBe(both);
    expect(gameReducer(BASE, actions.setPaused(false))).toBe(BASE);
    expect(gameReducer(BASE, actions.setShopOpen(false))).toBe(BASE);
  });
});

// ---------------------------------------------------------------------------
// Shop
// ---------------------------------------------------------------------------

describe('shop/buy', () => {
  const open = gameReducer(BASE, actions.setShopOpen(true));

  it('is ignored while the shop is closed', () => {
    expect(gameReducer(BASE, actions.buy('parsnip_seeds', 1))).toBe(BASE);
  });

  it('buys in-season seeds, stacking onto an existing stack', () => {
    const next = gameReducer(open, actions.buy('parsnip_seeds', 5));
    expect(next.player.gold).toBe(PLAYER.startingGold - 5 * CROPS.parsnip.seedPrice);
    expect(next.inventory.slots[5]).toEqual({ itemId: 'parsnip_seeds', quantity: 20 });
    expect(lastMessage(next)).toMatchObject({ text: 'Bought Parsnip Seeds ×5 for 100g.', tone: 'success' });
  });

  it('puts a new seed type in the first empty slot', () => {
    const next = gameReducer(open, actions.buy('potato_seeds', 2));
    expect(next.inventory.slots[6]).toEqual({ itemId: 'potato_seeds', quantity: 2 });
    expect(next.player.gold).toBe(PLAYER.startingGold - 2 * CROPS.potato.seedPrice);
  });

  it('allows spending exactly all gold, and refuses anything more', () => {
    const exact = gameReducer(withGold(open, 40), actions.buy('parsnip_seeds', 2));
    expect(exact.player.gold).toBe(0);
    const poor = withGold(open, 39);
    const refused = gameReducer(poor, actions.buy('parsnip_seeds', 2));
    expect(refused.player.gold).toBe(39);
    expect(refused.inventory).toBe(poor.inventory);
    expect(lastMessage(refused)).toMatchObject({ text: "You can't afford that.", tone: 'warn' });
  });

  it('refuses out-of-season seeds', () => {
    const next = gameReducer(open, actions.buy('pumpkin_seeds', 1));
    expect(next.player.gold).toBe(PLAYER.startingGold);
    expect(next.inventory).toBe(open.inventory);
    expect(lastMessage(next)).toMatchObject({ text: "Pumpkin Seeds aren't sold in Spring.", tone: 'warn' });
    const winter = atDay(open, 90);
    expect(lastMessage(gameReducer(winter, actions.buy('parsnip_seeds', 1)))?.text).toBe("Parsnip Seeds aren't sold in Winter.");
  });

  it('refuses purchases that do not fit in the inventory', () => {
    const full = withSlots(open, [{ itemId: 'parsnip_seeds', quantity: 990 }, ...fullOf({ itemId: 'stone', quantity: 1 }).slice(1)]);
    expect(count(gameReducer(full, actions.buy('parsnip_seeds', 9)), 'parsnip_seeds')).toBe(999);
    const refused = gameReducer(full, actions.buy('parsnip_seeds', 10));
    expect(refused.inventory).toBe(full.inventory);
    expect(refused.player.gold).toBe(full.player.gold);
    expect(lastMessage(refused)).toMatchObject({ text: 'Your inventory is full.', tone: 'warn' });
    expect(lastMessage(gameReducer(full, actions.buy('potato_seeds', 1)))?.text).toBe('Your inventory is full.');
  });

  it('ignores invalid quantities and non-seed items', () => {
    for (const quantity of [0, -1, 1.5, Number.NaN]) {
      expect(gameReducer(open, actions.buy('parsnip_seeds', quantity))).toBe(open);
    }
    expect(gameReducer(open, actions.buy('hoe' as never, 1))).toBe(open);
    expect(gameReducer(open, actions.buy('diamond_seeds' as never, 1))).toBe(open);
  });
});

// ---------------------------------------------------------------------------
// UI, selection, load, messages
// ---------------------------------------------------------------------------

describe('game/setTimeScale', () => {
  it('accepts only the configured scales', () => {
    for (const scale of TIME.timeScales) {
      const next = gameReducer(BASE, actions.setTimeScale(scale));
      expect(next.ui.timeScale).toBe(scale);
      expect(gameReducer(next, actions.setTimeScale(scale))).toBe(next);
    }
    for (const scale of [0, 3, -1, 32, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(gameReducer(BASE, actions.setTimeScale(scale))).toBe(BASE);
    }
  });
});

describe('hotbar selection', () => {
  it('selects valid slots and ignores the rest', () => {
    expect(gameReducer(BASE, actions.selectSlot(3)).inventory.selected).toBe(3);
    expect(gameReducer(BASE, actions.selectSlot(11)).inventory.selected).toBe(11);
    for (const slot of [0, -1, 12, 1.5, Number.NaN]) expect(gameReducer(BASE, actions.selectSlot(slot))).toBe(BASE);
  });

  it('cycles with wrap-around in both directions', () => {
    const at = (slot: number): GameState => gameReducer(BASE, actions.selectSlot(slot));
    expect(gameReducer(at(11), actions.cycleSlot(1)).inventory.selected).toBe(0);
    expect(gameReducer(BASE, actions.cycleSlot(-1)).inventory.selected).toBe(11);
    expect(gameReducer(BASE, actions.cycleSlot(13)).inventory.selected).toBe(1);
    expect(gameReducer(BASE, actions.cycleSlot(-25)).inventory.selected).toBe(11);
    expect(gameReducer(BASE, actions.cycleSlot(12))).toBe(BASE);
    expect(gameReducer(BASE, actions.cycleSlot(0))).toBe(BASE);
    expect(gameReducer(BASE, actions.cycleSlot(0.5))).toBe(BASE);
  });
});

describe('game/load', () => {
  it('replaces the state, closes menus and flags a teleport newer than either state', () => {
    const loaded: GameState = deepFreeze({
      ...createInitialState(7),
      ui: { shopOpen: true, paused: true, timeScale: 4 },
      player: { ...createInitialState(7).player, teleportSeq: 3 },
    });
    const prev = { ...BASE, player: { ...BASE.player, teleportSeq: 9 } };
    const next = gameReducer(prev, actions.load(loaded));
    expect(next).toEqual({
      ...loaded,
      ui: { shopOpen: false, paused: false, timeScale: 4 },
      player: { ...loaded.player, teleportSeq: 10 },
    });
    expect(next.maps).toBe(loaded.maps);
    expect(gameReducer(BASE, actions.load(loaded)).player.teleportSeq).toBe(4);
  });
});

describe('message log', () => {
  it(`keeps only the newest ${MESSAGES.capacity} messages with increasing ids`, () => {
    let state = scenario(blockedTile(Blocker.Rock, 2));
    for (let i = 0; i < 10; i++) state = useTool(state);
    expect(state.messages.entries).toHaveLength(MESSAGES.capacity);
    expect(state.messages.nextId).toBe(BASE.messages.nextId + 10);
    const ids = state.messages.entries.map((entry) => entry.id);
    expect(ids).toEqual([6, 7, 8, 9, 10, 11]);
    for (const entry of state.messages.entries) {
      expect(entry).toMatchObject({ text: 'This rock needs a pickaxe.', tone: 'warn', day: 0, minute: 360 });
    }
  });
});

describe('purity', () => {
  it('never mutates its (deep-frozen) input for any action', () => {
    const snapshot = JSON.stringify(BASE);
    const everything: readonly GameAction[] = [
      actions.tick(30),
      actions.sleep(),
      actions.move(Direction.South),
      actions.face(Direction.East),
      actions.useTool(),
      actions.interact(),
      actions.selectSlot(4),
      actions.cycleSlot(1),
      actions.setShopOpen(true),
      actions.buy('parsnip_seeds', 1),
      actions.setPaused(true),
      actions.setTimeScale(8),
      actions.load(createInitialState(3)),
    ];
    for (const action of everything) expect(() => gameReducer(BASE, action)).not.toThrow();
    expect(JSON.stringify(BASE)).toBe(snapshot);
  });

  it('keeps the unchanged parts of the state by reference', () => {
    const next = gameReducer(BASE, actions.move(Direction.South));
    expect(next.maps).toBe(BASE.maps);
    expect(next.inventory).toBe(BASE.inventory);
    expect(next.time).toBe(BASE.time);
    expect(next.shipping).toBe(BASE.shipping);
    expect(next.messages).toBe(BASE.messages);
    expect(next.ui).toBe(BASE.ui);
  });
});

describe('initial state', () => {
  it('starts a fresh game at the spawn with the starter kit', () => {
    const state = createInitialState();
    expect(state.seed).toBe(WORLD.seed);
    expect(state.player).toEqual({
      mapId: 'farm',
      tx: PLAYER.spawn.tx,
      tz: PLAYER.spawn.tz,
      facing: PLAYER.spawnFacing,
      energy: PLAYER.maxEnergy,
      maxEnergy: PLAYER.maxEnergy,
      gold: PLAYER.startingGold,
      moveSeq: 0,
      teleportSeq: 0,
      actionSeq: 0,
      lastAction: null,
    });
    expect(state.inventory.slots.filter((slot) => slot !== null)).toEqual(INVENTORY.starting);
    expect(state.weather).toBe(rollWeather(WORLD.seed, 0));
    expect(state.ui).toEqual({ shopOpen: false, paused: false, timeScale: 1 });
    expect(state.messages.entries).toHaveLength(2);
  });

  it('rejects seeds that are not 32-bit unsigned integers', () => {
    for (const seed of [-1, 1.5, 2 ** 32, Number.NaN]) expect(() => createInitialState(seed)).toThrow(RangeError);
    expect(() => createInitialState(0)).not.toThrow();
    expect(() => createInitialState(0xffffffff)).not.toThrow();
  });

  it('stocks enough seeds and tools for the first-day loop', () => {
    expect(count(BASE, 'parsnip_seeds')).toBe(15);
    for (const tool of ['hoe', 'wateringCan', 'pickaxe', 'axe', 'scythe'] as const) expect(count(BASE, tool)).toBe(1);
    expect(stageCount(CROPS.parsnip)).toBe(4);
    expect(BASE.inventory.water).toBe(TOOLS.wateringCanCapacity);
  });
});
