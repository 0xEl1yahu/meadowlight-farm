/**
 * Crafting recipes (PLAN-v2 §3 D). Each recipe id is also the id of the item it makes.
 * Crafting is pure: `craftCheck` says whether the player can make a recipe right now, and the
 * reducer's `crafting/craft` consumes the ingredients and adds the output.
 */
import type { CraftingRecipeId, GameState, InventoryState, ItemId } from '../core/types';
import { getItem } from '../items/items';
import { capacityFor, countItem, removeItem } from '../state/inventory';

export interface Ingredient {
  readonly itemId: ItemId;
  readonly quantity: number;
}

export interface Recipe {
  readonly id: CraftingRecipeId;
  readonly ingredients: readonly Ingredient[];
  readonly output: ItemId;
  readonly quantity: number;
}

function recipe(id: CraftingRecipeId, ingredients: readonly Ingredient[], quantity = 1): Recipe {
  return { id, ingredients, output: id, quantity };
}

const need = (itemId: ItemId, quantity: number): Ingredient => ({ itemId, quantity });

export const RECIPES: Readonly<Record<CraftingRecipeId, Recipe>> = {
  chest: recipe('chest', [need('wood', 50)]),
  woodFence: recipe('woodFence', [need('wood', 2)]),
  woodPath: recipe('woodPath', [need('wood', 1)]),
  stonePath: recipe('stonePath', [need('stone', 1)]),
  scarecrow: recipe('scarecrow', [need('wood', 25), need('fiber', 10), need('stone', 5)]),
  sprinkler: recipe('sprinkler', [need('copperOre', 1), need('stone', 10)]),
  qualitySprinkler: recipe('qualitySprinkler', [need('copperOre', 3), need('stone', 15), need('wood', 10)]),
  basicFertilizer: recipe('basicFertilizer', [need('sap', 2)], 5),
  qualityFertilizer: recipe('qualityFertilizer', [need('sap', 4), need('fiber', 2)], 5),
  speedGro: recipe('speedGro', [need('sap', 2), need('mushroom', 1)], 5),
};

export type CraftCheck = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/** Ingredients removed; the output not yet added. */
export function consumeIngredients(inventory: InventoryState, r: Recipe): InventoryState {
  return r.ingredients.reduce((inv, ing) => removeItem(inv, ing.itemId, ing.quantity), inventory);
}

/** Whether `id` can be crafted now: known, every ingredient held, and the output fits once they're used. */
export function craftCheck(state: GameState, id: CraftingRecipeId): CraftCheck {
  const r = RECIPES[id];
  if (!state.crafting.known.includes(id)) return { ok: false, reason: "You don't know that recipe yet." };
  const missing = r.ingredients.find((ing) => countItem(state.inventory, ing.itemId) < ing.quantity);
  if (missing !== undefined) return { ok: false, reason: `You need more ${getItem(missing.itemId).name}.` };
  if (capacityFor(consumeIngredients(state.inventory, r), r.output) < r.quantity) {
    return { ok: false, reason: 'Your inventory is full.' };
  }
  return { ok: true };
}
