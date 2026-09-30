/**
 * Review focus 2: however minutes arrive (one big tick, or the same minutes one at a time),
 * robots produce exactly the same state, including a tick that ends exactly at pass-out. (The
 * game drops a tick's minutes past pass-out, with or without robots, so the late run's first
 * tick is sized to land on it.)
 */
import { describe, expect, it } from 'vitest';
import { TIME } from '../src/config';
import { mulberry32 } from '../src/core/hash';
import { CROP_IDS, DIRECTIONS, ROBOT_PART_IDS, ROBOT_SIZES, type GameState, type RobotAction, type RobotPartId } from '../src/core/types';
import { addRobot } from '../src/robots/create';
import { ROBOT_ACTION_KINDS } from '../src/robots/parts';
import { requireRobot } from '../src/robots/world';
import { actions } from '../src/state/actions';
import { serializeGame } from '../src/state/persistence';
import { gameReducer } from '../src/state/reducer';
import { atDay, BASE, HEAVY_TEST_TIMEOUT_MS, must, robotOf, withRobots } from './testUtils';

function pick<T>(rng: () => number, list: readonly T[]): T {
  return must(list[Math.floor(rng() * list.length)]);
}

function randomAction(rng: () => number): RobotAction {
  const kind = pick(rng, ROBOT_ACTION_KINDS);
  switch (kind) {
    case 'turn':
      return { kind, side: rng() < 0.5 ? 'left' : 'right' };
    case 'plant':
      return { kind, cropId: pick(rng, CROP_IDS) };
    case 'take':
      return { kind, itemId: 'parsnip_seeds' };
    case 'say':
      return { kind, text: 'Hello' };
    case 'wait':
      return { kind, minutes: 1 + Math.floor(rng() * 40) };
    default:
      return { kind };
  }
}

function farmWithRobots(seed: number): GameState {
  const rng = mulberry32(seed);
  let state = atDay(BASE, 0, TIME.dayStartMinute);
  const count = 1 + Math.floor(rng() * 12);
  for (let i = 0; i < count; i++) {
    const size = pick(rng, ROBOT_SIZES);
    const parts = ROBOT_PART_IDS.filter(() => rng() < 0.35).slice(0, size === 'mini' ? 1 : size === 'standard' ? 2 : 3) as RobotPartId[];
    const steps = Array.from({ length: 1 + Math.floor(rng() * 10) }, () => randomAction(rng));
    const result = addRobot(state, {
      name: `R${i}`,
      size,
      parts,
      place: { tx: 1 + Math.floor(rng() * 16), tz: 9 + Math.floor(rng() * 8), facing: pick(rng, DIRECTIONS) },
      program: { kind: 'script', steps, loop: rng() < 0.7 },
    });
    if (!('error' in result)) state = result.state;
  }
  return state;
}

describe('tick batching', () => {
  it(
    'gives the same state for big and minute ticks, across pass-out too',
    () => {
      let acted = 0;
      for (let seed = 1; seed <= 50; seed++) {
        const start = farmWithRobots(seed);
        const late = { ...start, time: { ...start.time, minuteOfDay: TIME.passOutMinute - 90 } };
        const runs: readonly [GameState, readonly number[]][] = [
          [start, [120, 120, 120]],
          [late, [90, 120, 120]],
        ];
        for (const [from, chunks] of runs) {
          let big = from;
          let small = from;
          for (const chunk of chunks) {
            big = gameReducer(big, actions.tick(chunk));
            for (let m = 0; m < chunk; m++) small = gameReducer(small, actions.tick(1));
          }
          expect(serializeGame(big)).toBe(serializeGame(small));
          acted += big.robots.list.reduce((sum, robot) => sum + robot.actionSeq, 0);
        }
      }
      // The robots really acted: the equality above isn't two idle farms.
      expect(acted).toBeGreaterThan(0);
    },
    HEAVY_TEST_TIMEOUT_MS,
  );

  it('a big tick across pass-out matches the same minutes one at a time, with a robot mid-script', () => {
    const steps: RobotAction[] = [{ kind: 'turn', side: 'right' }, { kind: 'turn', side: 'left' }, { kind: 'say', text: 'Hello' }];
    const late = { ...BASE, time: { ...BASE.time, minuteOfDay: TIME.passOutMinute - 30 } };
    const start = withRobots(late, [robotOf({ program: { kind: 'script', steps, loop: true }, nextActMinute: TIME.passOutMinute - 29 })]);
    const big = gameReducer(start, actions.tick(TIME.maxTickMinutes));
    let small = start;
    for (let m = 0; m < 30; m++) small = gameReducer(small, actions.tick(1));
    expect(small.time.absoluteDay).toBe(start.time.absoluteDay + 1);
    expect(serializeGame(big)).toBe(serializeGame(small));
    // It acts at 25:31, 25:35 … 25:59 (never on the pass-out minute itself): eight actions,
    // stopping after step 2 of 3.
    const robot = requireRobot(big, 1);
    expect(robot.actionSeq).toBe(8);
    expect(robot.tokens).toBe(72);
    expect(robot.lastAction).toMatchObject({ seq: 8, kind: 'turn', success: true });
  });
});
