/**
 * Review focus 2: however minutes arrive (one big tick, or the same minutes one at a time),
 * robots produce exactly the same state, including a tick that ends exactly at pass-out. (The
 * game drops a tick's minutes past pass-out, with or without robots, so the late run's first
 * tick is sized to land on it.) Part 2 review focus 3: the same with block robots across a DO
 * return, an `At` trigger, a DO power-down, dizziness, a flat wake and pass-out.
 */
import { describe, expect, it } from 'vitest';
import { TIME } from '../src/config';
import { mulberry32 } from '../src/core/hash';
import {
  CROP_IDS,
  DIRECTIONS,
  Direction,
  EVERY_CHOICES,
  ROBOT_PART_IDS,
  ROBOT_SIZES,
  TileState,
  type GameState,
  type RobotAction,
  type RobotPartId,
} from '../src/core/types';
import { b } from '../src/robots/blocks';
import { addRobot } from '../src/robots/create';
import { ROBOT_ACTION_KINDS } from '../src/robots/parts';
import { requireRobot, withRobot } from '../src/robots/world';
import { actions } from '../src/state/actions';
import { serializeGame } from '../src/state/persistence';
import { gameReducer } from '../src/state/reducer';
import { EMPTY_TILE } from '../src/world/tiles';
import { addBlockRobot } from './programGen';
import { atDay, BASE, HEAVY_TEST_TIMEOUT_MS, matureCrop, must, robotOf, soilTile, withRobots, withTile, withZones } from './testUtils';

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

const SIX_PM = 18 * 60;
/** A late-evening minute: after the DO return, before pass-out. */
const evening = (rng: () => number): number => SIX_PM + 1 + Math.floor(rng() * 400);

/**
 * Five block robots at 6:00 whose day crosses everything review focus 3 names: Drizzle waters
 * Zone A in the morning and again on an `At` trigger, fenced in by DON'T leave; Reaper is still
 * harvesting Zone B slowly when its DO return comes; Poll wakes on `Every n` with a helper and,
 * on some seeds, too few tokens to wake; Loopy gets dizzy on an `At` trigger; Spin powers down by
 * DO card when its tokens run low.
 */
function blockFarm(seed: number): GameState {
  const rng = mulberry32(seed);
  let state = withZones(atDay(BASE, 0, TIME.dayStartMinute), { A: { x0: 2, z0: 10, w: 4, d: 3 }, B: { x0: 9, z0: 10, w: 5, d: 2 } });
  for (let tx = 2; tx <= 5; tx++) for (let tz = 10; tz <= 12; tz++) state = withTile(state, { tx, tz }, soilTile(TileState.Plowed), 'farm');
  for (let tx = 9; tx <= 13; tx++) {
    for (let tz = 10; tz <= 11; tz++) state = withTile(state, { tx, tz }, soilTile(TileState.Watered, matureCrop(pick(rng, ['parsnip', 'potato'] as const))), 'farm');
  }
  state = withTile(state, { tx: 15, tz: 15 }, { ...EMPTY_TILE, object: { kind: 'woodBurner', fuel: 10 } }, 'farm');
  const water = b.forEach('A', b.if(b.soilIsDry(), [b.water()]));
  state = addBlockRobot(state, {
    name: 'Drizzle',
    size: 'mini',
    parts: ['wateringHead'],
    place: { tx: 2 + Math.floor(rng() * 4), tz: 10 + Math.floor(rng() * 3), facing: pick(rng, DIRECTIONS) },
    program: b.program({ stacks: [b.when(b.morning(), water), b.when(b.atTime(evening(rng)), water)] }),
    md: [{ kind: 'dontLeave', zone: 'A' }],
  });
  state = addBlockRobot(state, {
    name: 'Reaper',
    size: 'standard',
    parts: ['claw', 'basket'],
    place: { tx: 9 + Math.floor(rng() * 5), tz: 10 + Math.floor(rng() * 2), facing: pick(rng, DIRECTIONS) },
    // About 80 minutes a tile, so it's still mid-field when it has to go home.
    program: b.program({ stacks: [b.when(b.morning(), b.forEach('B', b.if(b.cropIsReady(), [b.harvest()]), b.wait(75)))] }),
    md: [{ kind: 'doReturn', to: { kind: 'generator' }, minute: pick(rng, [SIX_PM, SIX_PM + 20, SIX_PM + 60]) }],
  });
  state = addBlockRobot(state, {
    name: 'Poll',
    size: 'mini',
    parts: ['claw'],
    place: { tx: 7, tz: 14, facing: Direction.North },
    program: b.program({
      stacks: [b.when(b.every(pick(rng, EVERY_CHOICES)), b.run('look'))],
      helpers: [b.helper('look', b.if(b.cropIsReady(), [b.harvest()]), b.turn('right'))],
    }),
  });
  // 80 tokens wakes all day; 9 runs out after a few wakes; 1 can't pay a wake and an action.
  const poll = must(state.robots.list.find((r) => r.name === 'Poll'));
  state = withRobot(state, { ...poll, tokens: must([80, 9, 1][seed % 3]) });
  state = addBlockRobot(state, {
    name: 'Loopy',
    size: 'mini',
    parts: ['claw'],
    place: { tx: 3, tz: 15, facing: Direction.East },
    program: b.program({ vars: [b.numVar('n', 0)], stacks: [b.when(b.atTime(evening(rng)), b.forever(b.change('n', 1)))] }),
  });
  return addBlockRobot(state, {
    name: 'Spin',
    size: 'mini',
    parts: ['claw'],
    place: { tx: 6, tz: 16, facing: Direction.South },
    program: b.program({ stacks: [b.when(b.morning(), b.forever(b.turn('right')))] }),
    md: [{ kind: 'doPowerDown', when: { kind: 'tokensBelow', n: 70 } }],
  });
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

  it(
    'gives the same state for big and minute ticks with block robots, across a DO return, an At trigger and pass-out',
    () => {
      // Ten two-hour ticks run from 6:00 exactly to pass-out; two more run the next morning.
      expect((TIME.passOutMinute - TIME.dayStartMinute) % TIME.maxTickMinutes).toBe(0);
      const chunks = (TIME.passOutMinute - TIME.dayStartMinute) / TIME.maxTickMinutes + 2;
      const seen = new Set<string>();
      let acted = 0;
      for (let seed = 1; seed <= 10; seed++) {
        const start = blockFarm(seed);
        let big = start;
        let small = start;
        for (let chunk = 0; chunk < chunks; chunk++) {
          big = gameReducer(big, actions.tick(TIME.maxTickMinutes));
          for (let m = 0; m < TIME.maxTickMinutes; m++) small = gameReducer(small, actions.tick(1));
          expect(serializeGame(big), `seed ${seed}, chunk ${chunk}`).toBe(serializeGame(small));
          for (const entry of big.robots.log.entries) seen.add(entry.event.kind);
        }
        expect(big.time.absoluteDay).toBe(start.time.absoluteDay + 1);
        acted += big.robots.list.reduce((sum, robot) => sum + robot.actionSeq, 0);
      }
      expect(acted).toBeGreaterThan(0);
      // The runs crossed every moment under test.
      for (const kind of ['woke', 'doReturn', 'doPowerDown', 'dizzy', 'flat']) expect(seen.has(kind), kind).toBe(true);
    },
    HEAVY_TEST_TIMEOUT_MS,
  );
});
