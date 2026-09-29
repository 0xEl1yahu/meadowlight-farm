/**
 * The Crafting tab of the backpack screen: one row per known recipe (unknown recipes are not
 * shown), with the output icon, its ingredients as have / need, and a Craft button that is
 * disabled while craftCheck says no. Rows are rebuilt only when the known list changes; the
 * counts and buttons refresh when the inventory reference changes.
 */
import { CRAFTING_RECIPE_IDS, type CraftingRecipeId, type GameState } from '../core/types';
import { RECIPES, craftCheck } from '../crafting/recipes';
import { getItem } from '../items/items';
import { actions, type GameAction } from '../state/actions';
import { countItem } from '../state/inventory';
import { h, hudButton, setAttr, setText, setTitle } from './dom';
import type { ItemIconCache } from './slots';

interface RecipeRow {
  readonly id: CraftingRecipeId;
  readonly element: HTMLElement;
  readonly counts: readonly HTMLElement[];
  readonly button: HTMLButtonElement;
}

export class CraftingPanel {
  readonly element = h('section', 'hud-inv__section hud-craft');
  private readonly list = h('ul', 'hud-craft__list');
  private readonly empty = h('p', 'hud-craft__empty', 'No recipes yet.');
  private rows: RecipeRow[] = [];
  private known: GameState['crafting']['known'] | null = null;
  private inventory: GameState['inventory'] | null = null;

  private readonly icons: ItemIconCache;
  private readonly dispatch: (action: GameAction) => void;

  constructor(icons: ItemIconCache, dispatch: (action: GameAction) => void, signal: AbortSignal) {
    this.icons = icons;
    this.dispatch = dispatch;
    const heading = h('h3', 'hud-inv__heading');
    heading.append(h('span', 'hud-inv__label', 'Crafting'));
    this.element.append(heading, this.list, this.empty);
    this.list.addEventListener(
      'click',
      (event) => {
        const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-recipe]') : null;
        const id = target?.dataset.recipe as CraftingRecipeId | undefined;
        if (id !== undefined && (CRAFTING_RECIPE_IDS as readonly string[]).includes(id)) this.dispatch(actions.craft(id));
      },
      { signal },
    );
  }

  sync(state: GameState): void {
    if (state.crafting.known !== this.known) {
      this.known = state.crafting.known;
      this.inventory = null;
      this.rows = CRAFTING_RECIPE_IDS.filter((id) => state.crafting.known.includes(id)).map((id) => this.buildRow(id));
      this.list.replaceChildren(...this.rows.map((row) => row.element));
      this.empty.hidden = this.rows.length > 0;
    }
    if (state.inventory === this.inventory) return;
    this.inventory = state.inventory;
    for (const row of this.rows) {
      const recipe = RECIPES[row.id];
      recipe.ingredients.forEach((ing, i) => {
        const node = row.counts[i];
        if (node === undefined) return;
        const have = countItem(state.inventory, ing.itemId);
        setText(node, `${have} / ${ing.quantity}`);
        node.classList.toggle('is-short', have < ing.quantity);
      });
      const check = craftCheck(state, row.id);
      row.button.disabled = !check.ok;
      setAttr(row.button, 'aria-disabled', check.ok ? 'false' : 'true');
      setTitle(row.button, check.ok ? `Craft ${getItem(recipe.output).name}` : check.reason);
    }
  }

  private buildRow(id: CraftingRecipeId): RecipeRow {
    const recipe = RECIPES[id];
    const output = getItem(recipe.output);
    const element = h('li', 'hud-craft__row');
    const icon = h('span', 'hud-craft__icon');
    icon.append(this.icons.get(recipe.output));
    const name = h('span', 'hud-craft__name', recipe.quantity > 1 ? `${output.name} ×${recipe.quantity}` : output.name);
    name.title = output.description;
    const needs = h('span', 'hud-craft__needs');
    const counts: HTMLElement[] = [];
    for (const ing of recipe.ingredients) {
      const chip = h('span', 'hud-craft__need');
      chip.title = getItem(ing.itemId).name;
      const small = h('span', 'hud-craft__need-icon');
      small.append(this.icons.get(ing.itemId));
      const count = h('span', 'hud-craft__need-count');
      counts.push(count);
      chip.append(small, count);
      needs.append(chip);
    }
    const button = hudButton('hud-btn hud-btn--primary hud-craft__btn', 'Craft');
    button.dataset.recipe = id;
    button.setAttribute('aria-label', `Craft ${output.name}`);
    element.append(icon, name, needs, button);
    return { id, element, counts, button };
  }
}
