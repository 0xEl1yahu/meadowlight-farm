/**
 * Teaching recipes (release 1 cleanup spec §5.2): a save lists the known recipes in
 * CRAFTING_RECIPE_IDS order and validation refuses any other, so every recipe is taught here.
 * Pure.
 */
import { CRAFTING_RECIPE_IDS, type CraftingRecipeId, type GameState } from '../core/types';

/** `known` plus `recipes`, in canonical order; `known` itself when it has them all already. */
export function knownWith(known: readonly CraftingRecipeId[], recipes: readonly CraftingRecipeId[]): readonly CraftingRecipeId[] {
  if (recipes.every((recipe) => known.includes(recipe))) return known;
  return CRAFTING_RECIPE_IDS.filter((id) => known.includes(id) || recipes.includes(id));
}

/** `state` knowing `recipes` too; the same state when it knows them all already. */
export function withRecipes(state: GameState, recipes: readonly CraftingRecipeId[]): GameState {
  const known = knownWith(state.crafting.known, recipes);
  return known === state.crafting.known ? state : { ...state, crafting: { ...state.crafting, known } };
}

/** The `recipes` the state doesn't know yet, in the order given. */
export function unknownRecipes(state: GameState, recipes: readonly CraftingRecipeId[]): readonly CraftingRecipeId[] {
  return recipes.filter((recipe) => !state.crafting.known.includes(recipe));
}
