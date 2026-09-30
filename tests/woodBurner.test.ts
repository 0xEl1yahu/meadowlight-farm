/**
 * The wood burner: crafting, placing on the farm only, picking up only when empty, and saving.
 */
import { describe, expect, it } from 'vitest';
import { CRAFTING_RECIPE_IDS, type GameState } from '../src/core/types';
import { actions } from '../src/state/actions';
import { countItem } from '../src/state/inventory';
import { placementProblem } from '../src/state/intents';
import { deserializeGame, serializeGame } from '../src/state/persistence';
import { gameReducer } from '../src/state/reducer';
import { EMPTY_TILE } from '../src/world/tiles';
import { BASE, TARGET, holding, scenario, stack, tileAt, withSlots, withTile, type SaveJson } from './testUtils';

const lastText = (state: GameState) => state.messages.entries[state.messages.entries.length - 1]?.text;
const knowing = (state: GameState): GameState => ({ ...state, crafting: { known: [...CRAFTING_RECIPE_IDS] } });

describe('wood burner', () => {
  it('is not known at first, and crafts from 20 stone, 10 wood and 2 copper ore once known', () => {
    const stocked = withSlots(BASE, [stack('stone', 20), stack('wood', 10), stack('copperOre', 2)]);
    expect(lastText(gameReducer(stocked, actions.craft('woodBurner')))).toBe("You don't know that recipe yet.");
    const crafted = gameReducer(knowing(stocked), actions.craft('woodBurner'));
    expect(countItem(crafted.inventory, 'woodBurner')).toBe(1);
    expect(countItem(crafted.inventory, 'stone')).toBe(0);
  });

  it('places empty on the farm and belongs only there', () => {
    const placed = gameReducer(holding(scenario(EMPTY_TILE), 'woodBurner'), actions.useTool());
    expect(tileAt(placed, TARGET).object).toEqual({ kind: 'woodBurner', fuel: 0 });
    const forest = { ...BASE, player: { ...BASE.player, mapId: 'forest' as const } };
    expect(placementProblem(forest, 'woodBurner', { tx: 0, tz: 0 })).toMatch(/belongs on your farm/);
  });

  it('picks up with the pickaxe only when it holds no wood', () => {
    const loaded = holding(scenario({ ...EMPTY_TILE, object: { kind: 'woodBurner', fuel: 4 } }), 'pickaxe');
    const refused = gameReducer(loaded, actions.useTool());
    expect(lastText(refused)).toBe('Burn off the wood first.');
    expect(tileAt(refused, TARGET).object).toEqual({ kind: 'woodBurner', fuel: 4 });
    const empty = holding(scenario({ ...EMPTY_TILE, object: { kind: 'woodBurner', fuel: 0 } }), 'pickaxe');
    const picked = gameReducer(empty, actions.useTool());
    expect(tileAt(picked, TARGET).object).toBeNull();
    expect(countItem(picked.inventory, 'woodBurner')).toBe(1);
  });

  it('saves its fuel and rejects impossible fuel or a burner off the farm', () => {
    const state = withTile(BASE, TARGET, { ...EMPTY_TILE, object: { kind: 'woodBurner', fuel: 7 } }, 'farm');
    expect(deserializeGame(serializeGame(state))).toEqual(state);
    const tooFull = JSON.parse(serializeGame(withTile(BASE, TARGET, { ...EMPTY_TILE, object: { kind: 'woodBurner', fuel: 7 } }, 'farm'))) as SaveJson;
    const text = JSON.stringify(tooFull).replace('"fuel":7', '"fuel":11');
    expect(deserializeGame(text)).toBeNull();
    const inForest = withTile(BASE, { tx: 3, tz: 3 }, { ...EMPTY_TILE, object: { kind: 'woodBurner', fuel: 0 } }, 'forest');
    expect(deserializeGame(serializeGame(inForest))).toBeNull();
  });
});
