/**
 * Robot derived numbers (src/robots/stats.ts) and part gating (src/robots/parts.ts).
 */
import { describe, expect, it } from 'vitest';
import { ROBOTS } from '../src/config';
import {
  EVERY_CHOICES,
  TileState,
  type GameState,
  type Robot,
  type RobotAction,
  type RobotActionKind,
  type RobotPartId,
  type RobotSize,
  type RobotStats,
} from '../src/core/types';
import { b } from '../src/robots/blocks';
import { freshExec, morningExec } from '../src/robots/exec';
import { PART_ACTIONS, ROBOT_ACTION_KINDS, canDo } from '../src/robots/parts';
import {
  ZERO_ROBOT_STATS,
  actionCost,
  addRobotStats,
  bagStacks,
  batteryFor,
  carryEnergyFor,
  isWeekStart,
  periodFor,
  repairCost,
  scaledCost,
  wakeCostFor,
} from '../src/robots/stats';
import { requireRobot } from '../src/robots/world';
import { actions } from '../src/state/actions';
import { gameReducer } from '../src/state/reducer';
import { BASE, TARGET, atDay, matureCrop, robotOf, soilTile, stack, withRobots, withTile, withZones } from './testUtils';

const body = (size: RobotSize, parts: readonly RobotPartId[] = []) => ({ size, parts });

describe('robot stats', () => {
  it('scales action costs by size, with the efficient core rounding down to at least 1', () => {
    expect(actionCost(body('mini'), 'harvest')).toBe(3);
    expect(actionCost(body('standard'), 'harvest')).toBe(6);
    expect(actionCost(body('big'), 'harvest')).toBe(12);
    expect(actionCost(body('big', ['efficientCore']), 'harvest')).toBe(9);
    expect(actionCost(body('mini', ['efficientCore']), 'move')).toBe(1);
    expect(actionCost(body('big'), 'wait')).toBe(0);
    expect(actionCost(body('big'), 'powerDown')).toBe(0);
    expect(actionCost(body('standard'), 'till')).toBe(10);
  });

  it('derives battery, bag, period, repair and carry numbers', () => {
    expect([batteryFor('mini'), batteryFor('standard'), batteryFor('big')]).toEqual([80, 200, 500]);
    expect(bagStacks(body('mini'))).toBe(1);
    expect(bagStacks(body('mini', ['basket']))).toBe(3);
    expect(bagStacks(body('standard', ['basket']))).toBe(5);
    expect(periodFor(body('mini'))).toBe(4);
    expect(periodFor(body('mini', ['quickCore']))).toBe(3);
    expect([repairCost(body('mini')), repairCost(body('standard')), repairCost(body('big'))]).toEqual([300, 800, 2000]);
    expect([carryEnergyFor(body('mini')), carryEnergyFor(body('big'))]).toEqual([4, 16]);
  });

  it('gates actions on parts', () => {
    expect(ROBOT_ACTION_KINDS).toHaveLength(12);
    expect(new Set(ROBOT_ACTION_KINDS).size).toBe(12);
    expect(canDo(body('mini', ['claw']), 'water')).toBe(false);
    expect(canDo(body('mini', ['claw']), 'move')).toBe(true);
    expect(canDo(body('mini', ['wateringHead']), 'water')).toBe(true);
    expect(canDo(body('mini', ['wateringHead']), 'refill')).toBe(true);
    expect(PART_ACTIONS.plant).toBe('seeder');
    expect(PART_ACTIONS.till).toBe('tiller');
  });
});

describe('robot stats for the language (part 2)', () => {
  /** Every action's cost per body, written out so a change to the scaling rule shows up here. */
  const COSTS: readonly [RobotSize, readonly RobotPartId[], Readonly<Record<RobotActionKind, number>>][] = [
    ['mini', [], { move: 1, turn: 1, water: 2, harvest: 3, till: 5, plant: 3, refill: 1, deposit: 1, take: 1, say: 1, wait: 0, powerDown: 0 }],
    ['standard', [], { move: 2, turn: 2, water: 4, harvest: 6, till: 10, plant: 6, refill: 2, deposit: 2, take: 2, say: 2, wait: 0, powerDown: 0 }],
    ['big', [], { move: 4, turn: 4, water: 8, harvest: 12, till: 20, plant: 12, refill: 4, deposit: 4, take: 4, say: 4, wait: 0, powerDown: 0 }],
    ['mini', ['efficientCore'], { move: 1, turn: 1, water: 1, harvest: 2, till: 3, plant: 2, refill: 1, deposit: 1, take: 1, say: 1, wait: 0, powerDown: 0 }],
    ['standard', ['efficientCore'], { move: 1, turn: 1, water: 3, harvest: 4, till: 7, plant: 4, refill: 1, deposit: 1, take: 1, say: 1, wait: 0, powerDown: 0 }],
    ['big', ['efficientCore'], { move: 3, turn: 3, water: 6, harvest: 9, till: 15, plant: 9, refill: 3, deposit: 3, take: 3, say: 3, wait: 0, powerDown: 0 }],
  ];

  it.each(COSTS)('keeps every action cost for a %s with %j', (size, parts, costs) => {
    for (const kind of ROBOT_ACTION_KINDS) expect([kind, actionCost(body(size, parts), kind)]).toEqual([kind, costs[kind]]);
  });

  it('scales a base cost the way actions are scaled', () => {
    expect(scaledCost(body('mini'), 5)).toBe(5);
    expect(scaledCost(body('big'), 5)).toBe(20);
    expect(scaledCost(body('standard', ['efficientCore']), 1)).toBe(1);
    expect(scaledCost(body('big', ['efficientCore']), 2)).toBe(6);
  });

  it('charges a size-scaled wake cost', () => {
    expect(wakeCostFor(body('mini'))).toBe(1);
    expect(wakeCostFor(body('standard'))).toBe(2);
    expect(wakeCostFor(body('big'))).toBe(4);
    expect(wakeCostFor(body('big', ['efficientCore']))).toBe(3);
  });

  it('gives each size its block, variable and .MD card limits', () => {
    const limits = (size: RobotSize) => [ROBOTS.sizes[size].blocks, ROBOTS.sizes[size].vars, ROBOTS.sizes[size].mdCards];
    expect(limits('mini')).toEqual([12, 1, 3]);
    expect(limits('standard')).toEqual([30, 3, 6]);
    expect(limits('big')).toEqual([80, 6, 10]);
  });

  it('has the language numbers from the spec', () => {
    expect(ROBOTS).toMatchObject({
      stepBudget: 50,
      maxStacks: 8,
      maxFrames: 16,
      maxNumber: 999_999,
      maxTextLength: 60,
      maxIdentifierLength: 16,
      wakeCost: 1,
      maxRepeatTimes: 999,
    });
    expect(ROBOTS.everyChoices).toEqual([5, 10, 15, 30, 60]);
    expect(ROBOTS.everyChoices).toBe(EVERY_CHOICES);
  });
});

describe('robot stats today and this week (part 3)', () => {
  const tick = (state: GameState, minutes: number): GameState => gameReducer(state, actions.tick(minutes));
  const sleep = (state: GameState): GameState => gameReducer(state, actions.sleep());
  const script = (...steps: RobotAction[]): Robot['program'] => ({ kind: 'script', steps, loop: true });
  /** The same counts today and this week, as on a robot's first day. */
  const both = (tokens: number, acts: number, crops: number): RobotStats => ({ today: { tokens, actions: acts, crops }, week: { tokens, actions: acts, crops } });
  const statsOf = (state: GameState, id = 1): RobotStats => requireRobot(state, id).stats;
  const BUSY: RobotStats = { today: { tokens: 12, actions: 4, crops: 1 }, week: { tokens: 50, actions: 20, crops: 6 } };
  const ripe = withTile(BASE, TARGET, soilTile(TileState.Watered, matureCrop('parsnip')), 'farm');

  it('starts at zero and adds to today and this week together', () => {
    expect(ZERO_ROBOT_STATS).toEqual({ today: { tokens: 0, actions: 0, crops: 0 }, week: { tokens: 0, actions: 0, crops: 0 } });
    expect(addRobotStats(BUSY, { tokens: 3, actions: 1, crops: 1 })).toEqual({
      today: { tokens: 15, actions: 5, crops: 2 },
      week: { tokens: 53, actions: 21, crops: 7 },
    });
    expect(addRobotStats(BUSY, { tokens: 1 })).toEqual({ today: { tokens: 13, actions: 4, crops: 1 }, week: { tokens: 51, actions: 20, crops: 6 } });
  });

  it('keeps the same stats object when there is nothing to add', () => {
    expect(addRobotStats(BUSY, {})).toBe(BUSY);
    expect(addRobotStats(BUSY, { tokens: 0, actions: 0, crops: 0 })).toBe(BUSY);
  });

  it('starts a week on days 1, 8, 15 and 22 of the season', () => {
    expect(ROBOTS.weekLength).toBe(7);
    expect([1, 8, 15, 22].map(isWeekStart)).toEqual([true, true, true, true]);
    expect([2, 7, 9, 21, 28].map(isWeekStart)).toEqual([false, false, false, false, false]);
  });

  it('counts a harvest: its tokens, one action and one crop', () => {
    const next = tick(withRobots(ripe, [robotOf({ program: script({ kind: 'harvest' }) })]), 4);
    expect(statsOf(next)).toEqual(both(3, 1, 1));
  });

  it('counts a planting as a crop', () => {
    const plowed = withTile(BASE, TARGET, soilTile(TileState.Plowed), 'farm');
    const planter = robotOf({ parts: ['seeder'], bag: [stack('parsnip_seeds', 2)], program: script({ kind: 'plant', cropId: 'parsnip' }) });
    expect(statsOf(tick(withRobots(plowed, [planter]), 4))).toEqual(both(3, 1, 1));
  });

  it('counts a blocked action and a bicker as actions, with their tokens and no crop', () => {
    const blocked = tick(withRobots(BASE, [robotOf({ program: script({ kind: 'harvest' }) })]), 4);
    expect(statsOf(blocked)).toEqual(both(3, 1, 0));
    const harvest = script({ kind: 'harvest' });
    const bickered = tick(withRobots(ripe, [robotOf({ id: 1, program: harvest }), robotOf({ id: 2, name: 'Bolt', program: harvest })]), 4);
    expect([statsOf(bickered, 1), statsOf(bickered, 2)]).toEqual([both(3, 1, 0), both(3, 1, 0)]);
  });

  it("counts a wake's tokens but not as an action", () => {
    const every = b.program({ stacks: [b.when(b.every(15), b.turn('right'))] });
    const idle = robotOf({ power: 'standby', program: every, exec: freshExec(every) });
    // Woken at 6:16 for 1 token, then a turn for 1 token: one action.
    expect(statsOf(tick(withRobots(BASE, [idle]), 16))).toEqual(both(2, 1, 0));
  });

  it('adds nothing for a skipped action', () => {
    const mover = b.program({ stacks: [b.when(b.morning(), b.forever(b.move()))] });
    const robot = robotOf({ tz: 12, program: mover, exec: morningExec(mover), md: [{ kind: 'dontLeave', zone: 'A' }] });
    const next = tick(withZones(withRobots(BASE, [robot]), { A: { x0: 3, z0: 9, w: 5, d: 4 } }), 4);
    expect(next.robots.log.entries.map((e) => e.event.kind)).toEqual(['skipped']);
    expect(statsOf(next)).toBe(ZERO_ROBOT_STATS);
  });

  it('starts today again each morning and keeps the week', () => {
    const next = sleep(withRobots(BASE, [robotOf({ stats: BUSY })]));
    expect(statsOf(next)).toEqual({ today: { tokens: 0, actions: 0, crops: 0 }, week: BUSY.week });
  });

  it('starts the week again on the morning of day 8, and on the first day of a season', () => {
    expect(statsOf(sleep(withRobots(atDay(BASE, 6), [robotOf({ stats: BUSY })])))).toEqual(ZERO_ROBOT_STATS);
    expect(statsOf(sleep(withRobots(atDay(BASE, 27), [robotOf({ stats: BUSY })])))).toEqual(ZERO_ROBOT_STATS);
  });

  it('keeps the stats object of a robot the morning has nothing to reset for', () => {
    const resting: RobotStats = { today: ZERO_ROBOT_STATS.today, week: BUSY.week };
    expect(statsOf(sleep(withRobots(BASE, [robotOf({ stats: resting })])))).toBe(resting);
    expect(statsOf(sleep(withRobots(atDay(BASE, 6), [robotOf()])))).toBe(ZERO_ROBOT_STATS);
  });
});
