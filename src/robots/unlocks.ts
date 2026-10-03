/**
 * The unlocked blocks, cards and robot-screen tabs (farmclaws part 3 spec §7). Unlocks gate the
 * editor only: the simulation never reads them. Pure.
 */
import { MD_CARD_KINDS, ROBOT_TABS, type GameState, type RobotUnlocks } from '../core/types';
import { BLOCK_KINDS } from './blockKinds';

/** Every block, card and tab, in canonical order. */
export const ALL_UNLOCKS: RobotUnlocks = { blocks: BLOCK_KINDS, cards: MD_CARD_KINDS, tabs: ROBOT_TABS };

/** `have` with `add` joined in `order`'s order; `have` itself when `add` brings nothing new. */
function joined<T>(order: readonly T[], have: readonly T[], add: readonly T[] | undefined): readonly T[] {
  if (add === undefined || add.every((kind) => have.includes(kind))) return have;
  return order.filter((kind) => have.includes(kind) || add.includes(kind));
}

/**
 * `state` with `add` unlocked on top of what already is, each list in canonical order. The same
 * state comes back when nothing in `add` is new. Part 4's jobs call this.
 */
export function withUnlocks(state: GameState, add: Partial<RobotUnlocks>): GameState {
  const have = state.robots.unlocks;
  const blocks = joined(BLOCK_KINDS, have.blocks, add.blocks);
  const cards = joined(MD_CARD_KINDS, have.cards, add.cards);
  const tabs = joined(ROBOT_TABS, have.tabs, add.tabs);
  if (blocks === have.blocks && cards === have.cards && tabs === have.tabs) return state;
  return { ...state, robots: { ...state.robots, unlocks: { blocks, cards, tabs } } };
}
