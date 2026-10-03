/**
 * The farm log's merging (farmclaws part 3 spec §6.2): a repeated event merges into the robot's
 * most recent entry only when that entry is from today.
 */
import { describe, expect, it } from 'vitest';
import type { GameState } from '../src/core/types';
import { logRobotEvent } from '../src/robots/log';
import { BASE, atDay, robotOf, withRobots } from './testUtils';

/** [day, minute, event kind, count] per entry, oldest first. */
const rows = (state: GameState) => state.robots.log.entries.map((e) => [e.day, e.minute, e.event.kind, e.count]);

describe('merging log entries', () => {
  it('merges a repeated event within the day, keeping the first time', () => {
    let state = withRobots(atDay(BASE, 3, 600), [robotOf()]);
    state = logRobotEvent(state, 1, { kind: 'flat' });
    state = logRobotEvent(atDay(state, 3, 640), 1, { kind: 'flat' });
    expect(rows(state)).toEqual([[3, 600, 'flat', 2]]);
  });

  it('starts a new entry for the same event on a new day, and merges into that one', () => {
    let state = withRobots(atDay(BASE, 3, 1500), [robotOf()]);
    state = logRobotEvent(state, 1, { kind: 'flat' });
    state = logRobotEvent(atDay(state, 4, 400), 1, { kind: 'flat' });
    state = logRobotEvent(atDay(state, 4, 420), 1, { kind: 'flat' });
    expect(rows(state)).toEqual([
      [3, 1500, 'flat', 1],
      [4, 400, 'flat', 2],
    ]);
    expect(state.robots.log.nextId).toBe(2);
  });
});
