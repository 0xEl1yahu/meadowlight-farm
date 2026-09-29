/**
 * Workstream D (crafting and materials) plus the farming effects of what it makes: recipes and
 * the crafting action, placing and picking up objects, debris drops, fertiliser, sprinklers
 * and crows.
 */
import { describe, expect, it } from 'vitest';
import { INVENTORY } from '../src/config';
import { CRAFTING_RECIPE_IDS, type CraftingRecipeId, type GameState } from '../src/core/types';
import { RECIPES, craftCheck } from '../src/crafting/recipes';
import { getItem } from '../src/items/items';
import { actions } from '../src/state/actions';
import { countItem } from '../src/state/inventory';
import { gameReducer } from '../src/state/reducer';
import { BASE, stack, withSlots } from './testUtils';

function craft(state: GameState, id: CraftingRecipeId): GameState {
  return gameReducer(state, actions.craft(id));
}

function knowing(state: GameState, known: readonly CraftingRecipeId[]): GameState {
  return { ...state, crafting: { known: CRAFTING_RECIPE_IDS.filter((id) => known.includes(id)) } };
}

function lastText(state: GameState): string | undefined {
  return state.messages.entries[state.messages.entries.length - 1]?.text;
}

const ALL = knowing(BASE, CRAFTING_RECIPE_IDS);

describe('recipe table', () => {
  it('matches the plan exactly', () => {
    const table = Object.fromEntries(
      CRAFTING_RECIPE_IDS.map((id) => [id, { makes: RECIPES[id].quantity, cost: RECIPES[id].ingredients.map((i) => `${i.quantity} ${i.itemId}`) }]),
    );
    expect(table).toEqual({
      chest: { makes: 1, cost: ['50 wood'] },
      woodFence: { makes: 1, cost: ['2 wood'] },
      woodPath: { makes: 1, cost: ['1 wood'] },
      stonePath: { makes: 1, cost: ['1 stone'] },
      scarecrow: { makes: 1, cost: ['25 wood', '10 fiber', '5 stone'] },
      sprinkler: { makes: 1, cost: ['1 copperOre', '10 stone'] },
      qualitySprinkler: { makes: 1, cost: ['3 copperOre', '15 stone', '10 wood'] },
      basicFertilizer: { makes: 5, cost: ['2 sap'] },
      qualityFertilizer: { makes: 5, cost: ['4 sap', '2 fiber'] },
      speedGro: { makes: 5, cost: ['2 sap', '1 mushroom'] },
    });
  });

  it('makes the item of the same id, of the right kind', () => {
    for (const id of CRAFTING_RECIPE_IDS) {
      expect(RECIPES[id].output).toBe(id);
      const kind = getItem(id).kind;
      expect(kind === 'placeable' || kind === 'fertilizer').toBe(true);
    }
  });
});

describe('crafting/craft', () => {
  it('consumes the ingredients, adds the output and reports it', () => {
    const state = withSlots(ALL, [stack('wood', 60)]);
    const next = craft(state, 'chest');
    expect(countItem(next.inventory, 'wood')).toBe(10);
    expect(countItem(next.inventory, 'chest')).toBe(1);
    expect(next.stats.craftedChest).toBe(true);
    expect(lastText(next)).toBe('Crafted Chest.');
    expect(next.maps).toBe(state.maps);
  });

  it('makes 5 fertiliser from a batch, using ingredients spread over several slots', () => {
    const state = withSlots(ALL, [stack('sap', 1), null, stack('sap', 2), stack('fiber', 2)]);
    const next = craft(craft(state, 'basicFertilizer'), 'basicFertilizer');
    expect(countItem(next.inventory, 'basicFertilizer')).toBe(5);
    expect(countItem(next.inventory, 'sap')).toBe(1);
    expect(lastText(next)).toBe('You need more Sap.');
    expect(next.stats.craftedChest).toBe(false);
  });

  it('uses the lowest-quality mushroom for Speed-Gro', () => {
    const state = withSlots(ALL, [stack('mushroom', 1, 2), stack('mushroom', 1, 0), stack('sap', 2)]);
    const next = craft(state, 'speedGro');
    expect(next.inventory.slots[0]).toEqual(stack('mushroom', 1, 2));
    expect(countItem(next.inventory, 'mushroom')).toBe(1);
    // The freed slot takes the output.
    expect(next.inventory.slots[1]).toEqual(stack('speedGro', 5));
  });

  it('refuses without enough ingredients, changing nothing but the message log', () => {
    const state = withSlots(ALL, [stack('wood', 25), stack('stone', 5), stack('fiber', 9)]);
    expect(craftCheck(state, 'scarecrow')).toEqual({ ok: false, reason: 'You need more Fiber.' });
    const next = craft(state, 'scarecrow');
    expect(next.inventory).toBe(state.inventory);
    expect(lastText(next)).toBe('You need more Fiber.');
  });

  it('refuses unknown recipes, even with the ingredients', () => {
    const state = withSlots(BASE, [stack('copperOre', 3), stack('stone', 15), stack('wood', 10)]);
    expect(state.crafting.known).not.toContain('qualitySprinkler');
    const next = craft(state, 'qualitySprinkler');
    expect(next.inventory).toBe(state.inventory);
    expect(lastText(next)).toBe("You don't know that recipe yet.");
  });

  it('ignores ids that are not recipes and does nothing while paused', () => {
    const state = withSlots(ALL, [stack('wood', 60)]);
    expect(gameReducer(state, { type: 'crafting/craft', recipe: 'hoe' as CraftingRecipeId })).toBe(state);
    const paused = { ...state, ui: { ...state.ui, paused: true } };
    expect(craft(paused, 'chest')).toBe(paused);
  });

  it('needs room for the output once the ingredients are used', () => {
    const unlocked = INVENTORY.startingUnlockedSlots;
    // Every unlocked slot full of different items: a used-up stack frees its slot.
    const fillers = Array.from({ length: unlocked - 1 }, (_, i) => stack(i % 2 === 0 ? 'hoe' : 'axe', 1));
    const freed = withSlots(ALL, [stack('wood', 1), ...fillers]);
    expect(countItem(craft(freed, 'woodPath').inventory, 'woodPath')).toBe(1);
    const stuck = withSlots(ALL, [stack('wood', 2), ...fillers]);
    expect(craftCheck(stuck, 'woodPath')).toEqual({ ok: false, reason: 'Your inventory is full.' });
    expect(craft(stuck, 'woodPath').inventory).toBe(stuck.inventory);
    // An existing stack of the output still has room.
    const topUp = withSlots(ALL, [stack('wood', 2), stack('woodPath', 3), ...fillers.slice(1)]);
    expect(countItem(craft(topUp, 'woodPath').inventory, 'woodPath')).toBe(4);
  });
});
