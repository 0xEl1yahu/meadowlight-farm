/**
 * Every way the game state can change. Actions are plain serialisable objects, so an action
 * log replayed from the same initial state reproduces the same game exactly.
 */
import type { CraftingRecipeId, Direction, GameState, SeedItemId, SlotRef } from '../core/types';

export type GameAction =
  | { readonly type: 'time/tick'; readonly minutes: number }
  | { readonly type: 'day/sleep' }
  | { readonly type: 'player/move'; readonly direction: Direction }
  | { readonly type: 'player/face'; readonly direction: Direction }
  /** Use the selected hotbar item on the tile the forward ray hits. */
  | { readonly type: 'player/useTool' }
  /** Context action on the forward tile: harvest, ship, sleep, refill. */
  | { readonly type: 'player/interact' }
  | { readonly type: 'inventory/select'; readonly slot: number }
  | { readonly type: 'inventory/cycle'; readonly delta: number }
  /** Moves `quantity` units (null = the whole stack) between two slots: player ↔ player or player ↔ open chest. */
  | { readonly type: 'inventory/move'; readonly from: SlotRef; readonly to: SlotRef; readonly quantity: number | null }
  | { readonly type: 'shop/setOpen'; readonly open: boolean }
  | { readonly type: 'ui/setInventoryOpen'; readonly open: boolean }
  /** Closes whichever panel is open. */
  | { readonly type: 'ui/closePanel' }
  | { readonly type: 'shop/buy'; readonly itemId: SeedItemId; readonly quantity: number }
  /** Crafts one batch of a known recipe from the player's inventory. */
  | { readonly type: 'crafting/craft'; readonly recipe: CraftingRecipeId }
  | { readonly type: 'game/setPaused'; readonly paused: boolean }
  | { readonly type: 'game/setTimeScale'; readonly timeScale: number }
  | { readonly type: 'game/load'; readonly state: GameState };

export type GameActionType = GameAction['type'];

export const actions = {
  tick: (minutes: number): GameAction => ({ type: 'time/tick', minutes }),
  sleep: (): GameAction => ({ type: 'day/sleep' }),
  move: (direction: Direction): GameAction => ({ type: 'player/move', direction }),
  face: (direction: Direction): GameAction => ({ type: 'player/face', direction }),
  useTool: (): GameAction => ({ type: 'player/useTool' }),
  interact: (): GameAction => ({ type: 'player/interact' }),
  selectSlot: (slot: number): GameAction => ({ type: 'inventory/select', slot }),
  cycleSlot: (delta: number): GameAction => ({ type: 'inventory/cycle', delta }),
  moveItem: (from: SlotRef, to: SlotRef, quantity: number | null = null): GameAction => ({
    type: 'inventory/move',
    from,
    to,
    quantity,
  }),
  setShopOpen: (open: boolean): GameAction => ({ type: 'shop/setOpen', open }),
  setInventoryOpen: (open: boolean): GameAction => ({ type: 'ui/setInventoryOpen', open }),
  closePanel: (): GameAction => ({ type: 'ui/closePanel' }),
  buy: (itemId: SeedItemId, quantity: number): GameAction => ({ type: 'shop/buy', itemId, quantity }),
  craft: (recipe: CraftingRecipeId): GameAction => ({ type: 'crafting/craft', recipe }),
  setPaused: (paused: boolean): GameAction => ({ type: 'game/setPaused', paused }),
  setTimeScale: (timeScale: number): GameAction => ({ type: 'game/setTimeScale', timeScale }),
  load: (state: GameState): GameAction => ({ type: 'game/load', state }),
} as const;
