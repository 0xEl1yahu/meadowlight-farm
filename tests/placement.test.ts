/**
 * Placing crafted objects with Space, and picking them back up with the pickaxe or axe.
 */
import { describe, expect, it } from 'vitest';
import { INVENTORY } from '../src/config';
import { Blocker, Direction, PLACEABLE_ITEM_IDS, TileState, type GameState } from '../src/core/types';
import { actions } from '../src/state/actions';
import { countItem } from '../src/state/inventory';
import { isFarmOnlyPlaceable, pickUpTool, placementProblem, planPrimaryAction } from '../src/state/intents';
import { gameReducer } from '../src/state/reducer';
import { getMap } from '../src/world/maps';
import { EMPTY_TILE, blockedTile, getTile, isWalkable } from '../src/world/tiles';
import { BASE, TARGET, cropOf, holding, scenario, soilTile, stack, tileAt, withPlayer, withSlots, withTile } from './testUtils';

function useTool(state: GameState): GameState {
  return gameReducer(state, actions.useTool());
}

function lastText(state: GameState): string | undefined {
  return state.messages.entries[state.messages.entries.length - 1]?.text;
}

const EMPTY_CHEST = { kind: 'chest', slots: Array.from({ length: INVENTORY.chestSlots }, () => null) } as const;

describe('placing', () => {
  it('places every placeable on bare grass on the farm, using one item', () => {
    for (const id of PLACEABLE_ITEM_IDS) {
      const state = holding(scenario(EMPTY_TILE), id, 3);
      const next = useTool(state);
      const placed = tileAt(next, TARGET).object;
      expect(placed?.kind).toBe(id);
      expect(countItem(next.inventory, id)).toBe(2);
      expect(next.player.lastAction).toEqual({ seq: 1, kind: 'place', target: TARGET, success: true });
    }
  });

  it('places a chest empty, with 36 slots', () => {
    const next = useTool(holding(scenario(EMPTY_TILE), 'chest'));
    expect(tileAt(next, TARGET).object).toEqual(EMPTY_CHEST);
    expect(countItem(next.inventory, 'chest')).toBe(0);
  });

  it('puts paths on grass only, everything else also on empty unfertilised soil', () => {
    for (const id of PLACEABLE_ITEM_IDS) {
      const onSoil = useTool(holding(scenario(soilTile(TileState.Watered)), id));
      if (id === 'woodPath' || id === 'stonePath') {
        expect(lastText(onSoil)).toBe('Paths go on grass.');
        expect(tileAt(onSoil, TARGET).object).toBeNull();
      } else {
        expect(tileAt(onSoil, TARGET).object?.kind).toBe(id);
        expect(tileAt(onSoil, TARGET).state).toBe(TileState.Watered);
      }
    }
    const fertilised = useTool(holding(scenario({ ...soilTile(TileState.Plowed), fertilizer: 'basic' }), 'sprinkler'));
    expect(tileAt(fertilised, TARGET).object).toBeNull();
  });

  it('refuses tiles with a crop, a blocker or an object', () => {
    const tiles = [soilTile(TileState.Plowed, cropOf('parsnip')), blockedTile(Blocker.Rock, 2), { ...EMPTY_TILE, object: { kind: 'woodPath' } } as const];
    for (const tile of tiles) {
      const state = holding(scenario(tile), 'woodFence');
      const next = useTool(state);
      expect(next.maps).toBe(state.maps);
      expect(next.inventory).toBe(state.inventory);
      expect(lastText(next)).toBe("There's something in the way.");
    }
  });

  it('keeps sprinklers and scarecrows on the farm, paths, fences and chests anywhere', () => {
    const forest = { ...BASE, player: { ...BASE.player, mapId: 'forest' as const } };
    for (const id of PLACEABLE_ITEM_IDS) {
      const problem = placementProblem(forest, id, { tx: 0, tz: 0 });
      if (isFarmOnlyPlaceable(id)) expect(problem).toMatch(/belongs on your farm/);
      else expect(problem === null || !/farm/.test(problem)).toBe(true);
    }
  });

  it('never places on a reserved tile', () => {
    const reserved = getMap('farm').reserved[0];
    if (reserved === undefined) throw new Error('the farm has reserved tiles');
    for (const id of PLACEABLE_ITEM_IDS) expect(placementProblem(BASE, id, reserved)).toBe('Keep this spot clear.');
  });

  it('keeps paths walkable and every other object solid', () => {
    for (const id of PLACEABLE_ITEM_IDS) {
      const next = useTool(holding(scenario(EMPTY_TILE), id));
      const tile = getTile(next.maps.farm, TARGET.tx, TARGET.tz);
      expect(tile !== null && isWalkable(tile)).toBe(id === 'woodPath' || id === 'stonePath');
    }
  });
});

describe('picking up', () => {
  it('lifts each object with its tool, returning the item', () => {
    for (const id of PLACEABLE_ITEM_IDS) {
      const tile = id === 'chest' ? { ...EMPTY_TILE, object: EMPTY_CHEST } : { ...EMPTY_TILE, object: id === 'woodBurner' ? { kind: id, fuel: 0 } : { kind: id } };
      const tool = pickUpTool(id);
      const state = holding(scenario(tile), tool);
      const next = useTool(state);
      expect(tileAt(next, TARGET)).toEqual(EMPTY_TILE);
      expect(countItem(next.inventory, id)).toBe(1);
      expect(next.player.energy).toBe(state.player.energy);
      // The other tool does nothing, silently.
      const other = holding(scenario(tile), tool === 'axe' ? 'pickaxe' : 'axe');
      const untouched = useTool(other);
      expect(untouched.maps).toBe(other.maps);
      expect(untouched.messages).toBe(other.messages);
    }
    expect(PLACEABLE_ITEM_IDS.filter((id) => pickUpTool(id) === 'axe')).toEqual(['chest', 'woodFence', 'woodPath', 'scarecrow']);
  });

  it('keeps a chest that still holds items', () => {
    const slots = EMPTY_CHEST.slots.map((s, i) => (i === 7 ? stack('wood', 3) : s));
    const state = holding(scenario({ ...EMPTY_TILE, object: { kind: 'chest', slots } }), 'axe');
    const next = useTool(state);
    expect(tileAt(next, TARGET).object).toEqual({ kind: 'chest', slots });
    expect(lastText(next)).toBe('Empty the chest first.');
  });

  it('needs room in the inventory', () => {
    const full = Array.from({ length: INVENTORY.startingUnlockedSlots }, () => stack('pickaxe', 1));
    const state = withPlayer(withTile(withSlots(BASE, full), TARGET, { ...EMPTY_TILE, object: { kind: 'stonePath' } }), { tx: 5, tz: 9 }, Direction.South);
    expect(planPrimaryAction(state).intent).toEqual({ kind: 'blocked', reason: 'Your inventory is full.' });
    expect(tileAt(useTool(state), TARGET).object).toEqual({ kind: 'stonePath' });
  });

  it('lifts a sprinkler off tilled soil, leaving the soil', () => {
    const next = useTool(holding(scenario({ ...soilTile(TileState.Watered), object: { kind: 'qualitySprinkler' } }), 'pickaxe'));
    expect(tileAt(next, TARGET)).toEqual(soilTile(TileState.Watered));
  });
});
