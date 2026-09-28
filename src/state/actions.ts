/**
 * Every way the game state can change. Actions are plain serialisable objects, so an action
 * log replayed from the same initial state reproduces the same game exactly.
 */
import type { Direction, GameState, SeedItemId } from '../core/types';

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
  | { readonly type: 'shop/setOpen'; readonly open: boolean }
  | { readonly type: 'shop/buy'; readonly itemId: SeedItemId; readonly quantity: number }
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
  setShopOpen: (open: boolean): GameAction => ({ type: 'shop/setOpen', open }),
  buy: (itemId: SeedItemId, quantity: number): GameAction => ({ type: 'shop/buy', itemId, quantity }),
  setPaused: (paused: boolean): GameAction => ({ type: 'game/setPaused', paused }),
  setTimeScale: (timeScale: number): GameAction => ({ type: 'game/setTimeScale', timeScale }),
  load: (state: GameState): GameAction => ({ type: 'game/load', state }),
} as const;
