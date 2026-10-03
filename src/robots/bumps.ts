/**
 * Bumps (farmclaws part 3 spec §3.1): robots no longer pass through each other. Decided once a
 * minute from the positions at the start of the minute, whatever the robots' ids. Pure.
 */
import { invariant } from '../core/invariant';
import type { GameState, Robot, TileCoord, Trigger } from '../core/types';
import { robotsOnTile } from './world';

/** A chosen move this minute whose plan is ok: robot `id` from `from` onto `to`. */
export interface MoveIntent {
  readonly id: number;
  readonly from: TileCoord;
  readonly to: TileCoord;
}

const keyOf = (c: TileCoord): string => `${c.tx},${c.tz}`;
const same = (a: TileCoord, b: TileCoord): boolean => a.tx === b.tx && a.tz === b.tz;

/**
 * The moves that bump: bumped robot id → the id of the robot it bumped into.
 * - Same target: every move onto a tile another move also targets, into the lowest other id.
 * - Swap: two moves that would trade tiles, into each other.
 * - Into a robot that stays, repeated until nothing changes: a move onto a tile where a standing
 *   robot has no move left that hasn't bumped, into the lowest such id.
 * Every other move goes ahead, so a line of robots moving the same way all move.
 */
export function findBumps(state: GameState, moves: readonly MoveIntent[]): ReadonlyMap<number, number> {
  const bumped = new Map<number, number>();
  const byTarget = new Map<string, MoveIntent[]>();
  for (const move of moves) byTarget.set(keyOf(move.to), [...(byTarget.get(keyOf(move.to)) ?? []), move]);
  for (const group of byTarget.values()) {
    if (group.length < 2) continue;
    for (const move of group) bumped.set(move.id, Math.min(...group.filter((m) => m.id !== move.id).map((m) => m.id)));
  }
  for (const move of moves) {
    if (bumped.has(move.id)) continue;
    const swap = moves.find((m) => m.id !== move.id && same(m.from, move.to) && same(m.to, move.from));
    if (swap !== undefined) bumped.set(move.id, swap.id);
  }
  const moving = new Set(moves.map((m) => m.id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const move of moves) {
      if (bumped.has(move.id)) continue;
      // robotsOnTile lists the standing robots lowest id first.
      const stays = robotsOnTile(state, move.to.tx, move.to.tz).find((r) => !moving.has(r.id) || bumped.has(r.id));
      if (stays === undefined) continue;
      bumped.set(move.id, stays.id);
      changed = true;
    }
  }
  return bumped;
}

/**
 * A bumped robot forgets the trigger stack it was running (spec §3.1): that stack's body becomes
 * empty and its `When` block stays, so `exec.due`, `exec.firedToday` and the stack indices stay
 * aligned. Variables, helpers, other stacks and the .MD are kept. A script, or a block robot
 * with no stack running (idle, or on a DO return), forgets nothing and comes back unchanged.
 */
export function forgetRunningStack(robot: Robot): { readonly robot: Robot; readonly forgot: Trigger | null } {
  const program = robot.program;
  const running = robot.exec?.running ?? null;
  if (program.kind !== 'blocks' || running === null) return { robot, forgot: null };
  const stack = program.stacks[running];
  invariant(stack !== undefined, `forgetRunningStack: robot ${robot.id} runs no stack ${running}`);
  const stacks = program.stacks.map((s, i) => (i === running ? { trigger: s.trigger, body: [] } : s));
  return { robot: { ...robot, program: { ...program, stacks } }, forgot: stack.trigger };
}
