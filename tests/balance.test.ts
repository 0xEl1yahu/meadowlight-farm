/**
 * The balance pass (farmclaws part 4c spec §6): each job's reference solution, run through the
 * real simulation from the job's set-up, passes with its margin, and the naive approaches fail.
 * Jobs 1 and 2 are solved with the blocks unlocked by then; For each tile comes with job 3.
 */
import { describe, expect, it } from 'vitest';
import { JOBS, UNLOCKS } from '../src/config';
import { deepFreeze } from '../src/core/store';
import { Direction, type BlockProgram, type GameState, type Robot, type ZoneId } from '../src/core/types';
import {
  BARNABY_TEAM,
  barnabyBudget,
  barnabyCropsHarvested,
  barnabyFieldTiles,
  barnabyTokensSpent,
  bedTilesWatered,
  cosmoRipeTiles,
  looksBeforePicking,
  ripeCropsHarvested,
  sprinkleOf,
  waveOf,
} from '../src/jobs/checks';
import { takeJob } from '../src/jobs/jobs';
import type { BlockKind } from '../src/robots/blockKinds';
import { b } from '../src/robots/blocks';
import { addRobot } from '../src/robots/create';
import { programmedRobot, withMd } from '../src/robots/edits';
import { allExprNodes, programStatements, statementExprs } from '../src/robots/program';
import { withRobot } from '../src/robots/world';
import { actions, type GameAction } from '../src/state/actions';
import { gameReducer } from '../src/state/reducer';
import { BARNABY_FIELD } from '../src/world/maps/neighbours';
import {
  BARNABY_ASSIGNMENT,
  BARNABY_QUARTERS,
  POLLING,
  SHOW_HIM_BLIND,
  SHOW_HIM_REFERENCE,
  WHOLE_FIELD,
  knowTheLimitsReference,
  spinningRobotReference,
  withoutPowerDown,
} from './jobSolutions';
import { BASE, atDay, must, withJobsDone, withZones } from './testUtils';

const act = (state: GameState, action: GameAction): GameState => gameReducer(state, action);

/** Job `id` taken at 9:00 am on day 0 of `state`, as a player walking over after breakfast would. */
function taken(state: GameState, id: Parameters<typeof takeJob>[1]): GameState {
  const next = takeJob(atDay(state, 0, 9 * 60), id);
  if (typeof next === 'string') throw new Error(next);
  return deepFreeze(next);
}

/** `state` with `robot` given `program` now, and its .MD replaced by `md` when given. */
function programmed(state: GameState, robot: Robot, program: BlockProgram, md?: Robot['md']): GameState {
  const coded = programmedRobot(robot, program, state.time.minuteOfDay);
  if (typeof coded === 'string') throw new Error(coded);
  const carded = md === undefined ? coded : withMd(coded, md);
  if (typeof carded === 'string') throw new Error(carded);
  return withRobot(state, carded);
}

/** Ticks through the day, ten minutes at a time, until `stop` holds or the evening comes. */
function runDay(state: GameState, stop: (s: GameState) => boolean): GameState {
  let next = state;
  while (!stop(next) && next.time.minuteOfDay < 20 * 60) next = act(next, actions.tick(10));
  return next;
}

/** Every block kind `program` uses: its triggers, its statements (an action block by its action) and its expressions. */
function blocksUsed(program: BlockProgram): Set<BlockKind> {
  const kinds = new Set<BlockKind>(program.stacks.map((stack) => stack.trigger.kind));
  for (const statement of programStatements(program)) {
    kinds.add(statement.kind === 'do' ? statement.action.kind : statement.kind);
    for (const expr of statementExprs(statement).flatMap(allExprNodes)) kinds.add(expr.kind);
  }
  return kinds;
}

const isDone = (id: 'spinningRobot' | 'showHim' | 'knowTheLimits') => (state: GameState): boolean => state.jobs.status[id] === 'done';

describe('job 1, the spinning robot', () => {
  const TAKEN = taken(BASE, 'spinningRobot');
  const SPRINKLE = must(sprinkleOf(TAKEN));
  const REFERENCE = spinningRobotReference(must(TAKEN.jobs.bed));
  const done = isDone('spinningRobot');

  it("is solved with job 1's blocks, in a Mini's twelve", () => {
    expect(TAKEN.jobs.bed).toEqual({ tx: 6, tz: 6 });
    expect({ tx: SPRINKLE.tx, tz: SPRINKLE.tz, facing: SPRINKLE.facing }).toEqual({ tx: 6, tz: 3, facing: Direction.South });
    for (const kind of blocksUsed(REFERENCE)) expect(TAKEN.robots.unlocks.blocks, kind).toContain(kind);
    expect(TAKEN.robots.unlocks.blocks).not.toContain('forEachTile');
  });

  it('passes on the first day with at least 40 tokens left', () => {
    const morning = act(programmed(TAKEN, SPRINKLE, REFERENCE), actions.sleep());
    const end = runDay(morning, done);
    expect(done(end)).toBe(true);
    expect(end.time.absoluteDay).toBe(morning.time.absoluteDay);
    expect(end.time.minuteOfDay).toBeLessThanOrEqual(9 * 60);
    expect(must(sprinkleOf(end)).tokens).toBeGreaterThanOrEqual(40);
  });

  it('fails with the spinning program', () => {
    const end = runDay(act(TAKEN, actions.sleep()), done);
    expect(done(end)).toBe(false);
    expect(bedTilesWatered(end)).toBe(0);
  });

  it('fails without Power down, every tile watered', () => {
    const end = runDay(act(programmed(TAKEN, SPRINKLE, withoutPowerDown(REFERENCE)), actions.sleep()), done);
    expect(bedTilesWatered(end)).toBe(9);
    expect(done(end)).toBe(false);
  });
});

describe("job 2, Cosmo's harvest", () => {
  const TAKEN = taken(withJobsDone(BASE, 'spinningRobot'), 'showHim');
  const WAVE = must(waveOf(TAKEN));
  const done = isDone('showHim');

  it("is solved with the blocks unlocked by job 2, without For each tile", () => {
    for (const kind of blocksUsed(SHOW_HIM_REFERENCE)) expect(TAKEN.robots.unlocks.blocks, kind).toContain(kind);
    expect(TAKEN.robots.unlocks.blocks).not.toContain('forEachTile');
    expect(looksBeforePicking(SHOW_HIM_REFERENCE)).toBe(true);
  });

  it('passes on the first day by noon, with at least 40 tokens left', () => {
    const morning = act(programmed(TAKEN, WAVE, SHOW_HIM_REFERENCE), actions.sleep());
    const end = runDay(morning, done);
    expect(done(end)).toBe(true);
    expect(end.time.absoluteDay).toBe(morning.time.absoluteDay);
    expect(end.time.minuteOfDay).toBeLessThanOrEqual(12 * 60);
    expect(must(waveOf(end)).tokens).toBeGreaterThanOrEqual(40);
  });

  it('fails harvesting every tile without a sensor and an If', () => {
    expect(looksBeforePicking(SHOW_HIM_BLIND)).toBe(false);
    const end = runDay(act(programmed(TAKEN, WAVE, SHOW_HIM_BLIND), actions.sleep()), done);
    expect(done(end)).toBe(false);
    // Trying the unripe tiles too, Wave runs out of tokens before the field is done.
    expect(must(waveOf(end)).power).toBe('flat');
    expect(ripeCropsHarvested(end)).toBeLessThan(cosmoRipeTiles().length);
  });

  it('fails with the hello-chickens program', () => {
    const end = runDay(act(TAKEN, actions.sleep()), done);
    expect(done(end)).toBe(false);
    expect(ripeCropsHarvested(end)).toBe(0);
    expect(cosmoRipeTiles()).toHaveLength(18);
  });
});

describe("job 3, Barnaby's team", () => {
  const TAKEN = taken(withJobsDone(BASE, 'showHim'), 'knowTheLimits');
  const done = isDone('knowTheLimits');
  const team = (state: GameState): Robot[] => state.robots.list.filter((robot) => robot.owner === 'barnaby');
  const named = (state: GameState, name: string): Robot => must(team(state).find((robot) => robot.name === name));

  /** `state` with zones A to D on the quarters and each Mini on its quarter's reference, Barnaby's .MD taken off. */
  function managed(state: GameState): GameState {
    let next = withZones(state, BARNABY_QUARTERS);
    for (const name of BARNABY_TEAM) next = programmed(next, named(next, name), knowTheLimitsReference(BARNABY_ASSIGNMENT[name]), []);
    return next;
  }

  /** Runs the day and pins the reference's margins: done by noon, a token a crop to spare, every Mini `left` tokens left. */
  function expectPassedWithMargin(morning: GameState, left: number): void {
    const end = runDay(morning, done);
    expect(done(end)).toBe(true);
    expect(end.time.absoluteDay).toBe(morning.time.absoluteDay);
    expect(end.time.minuteOfDay).toBeLessThanOrEqual(12 * 60);
    expect(barnabyTokensSpent(end)).toBeLessThanOrEqual(barnabyBudget() - barnabyFieldTiles().length);
    for (const robot of team(end)) expect(robot.tokens, robot.name).toBeGreaterThanOrEqual(left);
  }

  it('is four zones of 4 × 3 on the sown rows, one per Mini, with blocks unlocked by job 3', () => {
    expect(barnabyFieldTiles()).toHaveLength(48);
    expect(barnabyBudget()).toBe(JOBS.tokensPerCrop * 48);
    for (const zone of Object.values(BARNABY_QUARTERS)) expect([zone.w, zone.d]).toEqual([4, 3]);
    const unlocked: readonly BlockKind[] = [...UNLOCKS.job1.blocks, ...UNLOCKS.job2.blocks, ...UNLOCKS.job3.blocks];
    for (const zone of ['A', 'B', 'C', 'D'] as const satisfies readonly ZoneId[]) {
      for (const kind of blocksUsed(knowTheLimitsReference(zone))) expect(unlocked, kind).toContain(kind);
    }
  });

  it('passes the next day from where Barnaby left his Minis', () => {
    expectPassedWithMargin(act(managed(TAKEN), actions.sleep()), 20);
  });

  it("passes the next day from his generator, where his .MD sent the team the evening before", () => {
    let evening = programmed(TAKEN, named(TAKEN, 'B-1'), b.program({ stacks: [b.when(b.morning())] }));
    while (evening.time.minuteOfDay < 22 * 60) evening = act(evening, actions.tick(60));
    const morning = act(evening, actions.sleep());
    // The team spent the night by the gate, on the lane or the field's north row, not by the house.
    for (const robot of team(morning)) expect(robot.tz, robot.name).toBeLessThanOrEqual(BARNABY_FIELD.z0);
    // B-4 ends a tile short of the generator's reach behind B-1, uncharged, and still finishes.
    expectPassedWithMargin(managed(morning), 10);
  });

  it("fails with B-1's polling program alone", () => {
    const end = runDay(act(TAKEN, actions.sleep()), done);
    expect(done(end)).toBe(false);
    expect(barnabyCropsHarvested(end)).toBeLessThan(barnabyFieldTiles().length);
  });

  it('fails with the four Minis on polling programs', () => {
    let state = TAKEN;
    for (const name of BARNABY_TEAM) state = programmed(state, named(state, name), POLLING);
    const end = runDay(act(state, actions.sleep()), done);
    expect(done(end)).toBe(false);
  });

  it("fails on cost with one Big robot's program on the whole field", () => {
    // A fixture: the player can't bring a Big to Barnaby's field.
    const place = must(JOBS.barnabyRobots[0]);
    const alone = { ...TAKEN, robots: { ...TAKEN.robots, list: TAKEN.robots.list.filter((robot) => robot.owner !== 'barnaby') } };
    const added = addRobot(alone, { name: 'Big B', size: 'big', parts: ['claw'], program: WHOLE_FIELD, place, mapId: 'neighbours', owner: 'barnaby' });
    if ('error' in added) throw new Error(added.error);
    const end = runDay(act(added.state, actions.sleep()), done);
    expect(done(end)).toBe(false);
    expect(barnabyTokensSpent(end)).toBeGreaterThan(barnabyBudget());
    expect(barnabyCropsHarvested(end)).toBeLessThan(barnabyFieldTiles().length);
  });
});
