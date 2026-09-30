/**
 * The robot executor: every action's success, every block reason, costs, and addRobot.
 */
import { describe, expect, it } from 'vitest';
import { ROBOTS, TIME } from '../src/config';
import { Blocker, Direction, TileState, type GameState, type Robot, type RobotAction } from '../src/core/types';
import { createCropInstance } from '../src/farming/crops';
import { addRobot } from '../src/robots/create';
import { applyRobotPlan, planRobotAction } from '../src/robots/execute';
import { chestSlots, requireRobot } from '../src/robots/world';
import { harvestQuality, harvestQuantity } from '../src/state/intents';
import { blockedTile, EMPTY_TILE } from '../src/world/tiles';
import { BASE, TARGET, atDay, matureCrop, must, robotOf, soilTile, stack, tileAt, withRobots, withTile } from './testUtils';

const AHEAD = { tx: TARGET.tx, tz: TARGET.tz + 1 };
const chestWith = (...stacks: ReturnType<typeof stack>[]) => ({
  ...EMPTY_TILE,
  object: { kind: 'chest' as const, slots: Array.from({ length: 36 }, (_, i) => stacks[i] ?? null) },
});

/** One robot (id 1) on the farm, then plans and applies `action`. */
function act(state: GameState, robot: Robot, action: RobotAction): { next: GameState; robot: Robot } {
  const placed = withRobots(state, [robot]);
  const plan = planRobotAction(placed, robot, action);
  const next = applyRobotPlan(placed, robot.id, plan);
  return { next, robot: requireRobot(next, robot.id) };
}

const lastEvent = (state: GameState) => state.robots.log.entries[state.robots.log.entries.length - 1]?.event;

describe('robot actions that succeed', () => {
  it('moves forward and counts the step', () => {
    const { robot } = act(BASE, robotOf(), { kind: 'move' });
    expect([robot.tx, robot.tz, robot.moveSeq, robot.tokens]).toEqual([AHEAD.tx, AHEAD.tz, 1, 79]);
  });

  it('shorts out driving into water, with a toast', () => {
    const wet = withTile(BASE, AHEAD, blockedTile(Blocker.Water), 'farm');
    const { next, robot } = act(wet, robotOf(), { kind: 'move' });
    expect(robot.power).toBe('broken');
    expect([robot.tx, robot.tz]).toEqual([AHEAD.tx, AHEAD.tz]);
    expect(lastEvent(next)).toEqual({ kind: 'shortedOut' });
    expect(next.messages.entries.at(-1)?.text).toBe('Sprocket drove into the water and shorted out.');
  });

  it('turns left and right a quarter turn', () => {
    expect(act(BASE, robotOf({ facing: Direction.North }), { kind: 'turn', side: 'left' }).robot.facing).toBe(Direction.West);
    expect(act(BASE, robotOf({ facing: Direction.West }), { kind: 'turn', side: 'right' }).robot.facing).toBe(Direction.North);
  });

  it('waters its own plowed tile from the tank', () => {
    const state = withTile(BASE, TARGET, soilTile(TileState.Plowed), 'farm');
    const { next, robot } = act(state, robotOf({ parts: ['wateringHead'], tank: 3 }), { kind: 'water' });
    expect(tileAt(next, TARGET, 'farm').state).toBe(TileState.Watered);
    expect([robot.tank, robot.tokens]).toEqual([2, 78]);
  });

  it('harvests into its bag with the same size and quality the player would get', () => {
    const state = withTile(atDay(BASE, 3), TARGET, soilTile(TileState.Watered, matureCrop('parsnip')), 'farm');
    const crop = must(tileAt(state, TARGET, 'farm').crop);
    const quantity = harvestQuantity(state, TARGET, crop, 'farm');
    const quality = harvestQuality(state, TARGET, crop, 'farm');
    const { next, robot } = act(state, robotOf(), { kind: 'harvest' });
    expect(robot.bag).toEqual([stack('parsnip', quantity, quality)]);
    expect(tileAt(next, TARGET, 'farm').crop).toBeNull();
    expect(lastEvent(next)).toEqual({ kind: 'did', action: 'harvest', detail: { kind: 'crop', cropId: 'parsnip', quantity, quality } });
    expect(next.messages).toBe(state.messages);
  });

  it('tills grass and plants one seed from the bag', () => {
    const tilled = act(BASE, robotOf({ parts: ['tiller'] }), { kind: 'till' });
    expect(tileAt(tilled.next, TARGET, 'farm').state).toBe(TileState.Plowed);
    const soil = withTile(BASE, TARGET, soilTile(TileState.Plowed), 'farm');
    const { next, robot } = act(soil, robotOf({ parts: ['seeder'], bag: [stack('parsnip_seeds', 2)] }), { kind: 'plant', cropId: 'parsnip' });
    expect(tileAt(next, TARGET, 'farm').crop).toEqual(createCropInstance('parsnip', 0));
    expect(robot.bag).toEqual([stack('parsnip_seeds', 1)]);
  });

  it('refills from water ahead', () => {
    const wet = withTile(BASE, AHEAD, blockedTile(Blocker.Water), 'farm');
    expect(act(wet, robotOf({ parts: ['wateringHead'], tank: 2 }), { kind: 'refill' }).robot.tank).toBe(ROBOTS.tankCapacity);
  });

  it('deposits into a chest ahead, keeping what does not fit', () => {
    const full = Array.from({ length: 35 }, () => stack('stone', 999));
    const state = withTile(BASE, AHEAD, chestWith(...full), 'farm');
    const robot = robotOf({ size: 'standard', parts: ['claw'], bag: [stack('parsnip', 5), stack('wood', 3)] });
    const { next, robot: after } = act(state, robot, { kind: 'deposit' });
    const slots = chestSlots(tileAt(next, AHEAD, 'farm'));
    expect(slots[35]).toEqual(stack('parsnip', 5));
    expect(after.bag).toEqual([stack('wood', 3)]);
    expect(lastEvent(next)).toEqual({ kind: 'did', action: 'deposit', detail: { kind: 'items', into: 'chest', stacks: 1, quantity: 5 } });
  });

  it('ships every sellable stack into the bin, seeds included, and keeps unsellable ones', () => {
    const atBin = robotOf({ size: 'standard', tx: 9, tz: 6, facing: Direction.North, bag: [stack('parsnip_seeds', 4), stack('parsnip', 2), stack('chest', 1)] });
    const { next, robot } = act(BASE, atBin, { kind: 'deposit' });
    expect(next.shipping.pending).toEqual([stack('parsnip_seeds', 4), stack('parsnip', 2)]);
    expect(robot.bag).toEqual([stack('chest', 1)]);
  });

  it('takes an item from a chest ahead', () => {
    const state = withTile(BASE, AHEAD, chestWith(stack('parsnip_seeds', 12)), 'farm');
    const { next, robot } = act(state, robotOf(), { kind: 'take', itemId: 'parsnip_seeds' });
    expect(robot.bag).toEqual([stack('parsnip_seeds', 12)]);
    expect(chestSlots(tileAt(next, AHEAD, 'farm'))[0]).toBeNull();
  });

  it('says, waits and powers down', () => {
    expect(act(BASE, robotOf(), { kind: 'say', text: 'Hello' }).robot.tokens).toBe(79);
    const waited = act(BASE, robotOf(), { kind: 'wait', minutes: 30 }).robot;
    expect([waited.tokens, waited.nextActMinute]).toEqual([80, BASE.time.minuteOfDay + 30]);
    const down = act(BASE, robotOf(), { kind: 'powerDown' });
    expect(down.robot.power).toBe('standby');
    expect(lastEvent(down.next)).toEqual({ kind: 'poweredDown' });
  });
});

describe('robot actions that are blocked', () => {
  const cases: readonly [string, GameState, Robot, RobotAction, string, number][] = [
    ['no part', BASE, robotOf(), { kind: 'water' }, 'noPart', 0],
    ['bumping a rock', withTile(BASE, AHEAD, blockedTile(Blocker.Rock, 2), 'farm'), robotOf(), { kind: 'move' }, 'bumped', 1],
    ['the farm edge', BASE, robotOf({ tx: 5, tz: 0, facing: Direction.North }), { kind: 'move' }, 'farmEdge', 1],
    ['nothing ripe', BASE, robotOf(), { kind: 'harvest' }, 'nothingToHarvest', 3],
    ['a full bag', withTile(BASE, TARGET, soilTile(TileState.Watered, matureCrop('parsnip')), 'farm'), robotOf({ bag: [stack('wood', 1)] }), { kind: 'harvest' }, 'bagFull', 3],
    ['an empty tank', withTile(BASE, TARGET, soilTile(TileState.Plowed), 'farm'), robotOf({ parts: ['wateringHead'] }), { kind: 'water' }, 'tankEmpty', 2],
    ['watered soil', withTile(BASE, TARGET, soilTile(TileState.Watered), 'farm'), robotOf({ parts: ['wateringHead'], tank: 5 }), { kind: 'water' }, 'notWaterable', 2],
    ['tilled soil', withTile(BASE, TARGET, soilTile(TileState.Plowed), 'farm'), robotOf({ parts: ['tiller'] }), { kind: 'till' }, 'notTillable', 5],
    ['no seeds', withTile(BASE, TARGET, soilTile(TileState.Plowed), 'farm'), robotOf({ parts: ['seeder'] }), { kind: 'plant', cropId: 'parsnip' }, 'noSeed', 3],
    ['the wrong season', withTile(BASE, TARGET, soilTile(TileState.Plowed), 'farm'), robotOf({ parts: ['seeder'], bag: [stack('pumpkin_seeds', 1)] }), { kind: 'plant', cropId: 'pumpkin' }, 'outOfSeason', 3],
    ['grass', BASE, robotOf({ parts: ['seeder'], bag: [stack('parsnip_seeds', 1)] }), { kind: 'plant', cropId: 'parsnip' }, 'cannotPlant', 3],
    ['no water ahead', BASE, robotOf({ parts: ['wateringHead'] }), { kind: 'refill' }, 'noWaterAhead', 1],
    ['a full tank', withTile(BASE, AHEAD, blockedTile(Blocker.Water), 'farm'), robotOf({ parts: ['wateringHead'], tank: ROBOTS.tankCapacity }), { kind: 'refill' }, 'tankFull', 1],
    ['nothing ahead', BASE, robotOf({ bag: [stack('wood', 1)] }), { kind: 'deposit' }, 'nothingAhead', 1],
    ['an empty bag', withTile(BASE, AHEAD, chestWith(), 'farm'), robotOf(), { kind: 'deposit' }, 'bagEmpty', 1],
    ['a full chest', withTile(BASE, AHEAD, chestWith(...Array.from({ length: 36 }, () => stack('stone', 999))), 'farm'), robotOf({ bag: [stack('wood', 1)] }), { kind: 'deposit' }, 'containerFull', 1],
    ['a missing item', withTile(BASE, AHEAD, chestWith(stack('wood', 3)), 'farm'), robotOf(), { kind: 'take', itemId: 'stone' }, 'itemNotFound', 1],
  ];

  it.each(cases)('is blocked by %s, paying its cost and changing nothing else', (_label, state, robot, action, reason, cost) => {
    const placed = withRobots(state, [robot]);
    const plan = planRobotAction(placed, robot, action);
    expect(plan).toMatchObject({ ok: false, reason, cost });
    const next = applyRobotPlan(placed, robot.id, plan);
    expect(next.maps).toBe(placed.maps);
    expect(requireRobot(next, robot.id).tokens).toBe(robot.tokens - cost);
    expect(lastEvent(next)).toEqual({ kind: 'blocked', action: action.kind, reason });
  });
});

describe('scripts advance as robots act', () => {
  it('goes to standby after the last step of a non-looping script, and logs it', () => {
    const robot = robotOf({ program: { kind: 'script', steps: [{ kind: 'turn', side: 'left' }], loop: false } });
    const { next, robot: after } = act(BASE, robot, { kind: 'turn', side: 'left' });
    expect([after.power, after.pc]).toEqual(['standby', 0]);
    expect(lastEvent(next)).toEqual({ kind: 'finished' });
    expect(after.lastAction).toEqual({ seq: 1, kind: 'turn', success: true, bickered: false });
    expect(after.nextActMinute).toBe(BASE.time.minuteOfDay + 4);
  });
});

describe('addRobot', () => {
  const spec = {
    name: 'Sprocket',
    size: 'mini' as const,
    parts: ['wateringHead' as const],
    place: { tx: TARGET.tx, tz: TARGET.tz, facing: Direction.East },
    program: { kind: 'script' as const, steps: [{ kind: 'water' as const }], loop: false },
  };

  it('adds a charged, working robot with a full tank at its place', () => {
    const result = addRobot(BASE, spec);
    if ('error' in result) throw new Error(result.error);
    const robot = requireRobot(result.state, result.id);
    expect(robot).toMatchObject({ id: 1, tokens: 80, tank: ROBOTS.tankCapacity, power: 'working', tx: TARGET.tx, facing: Direction.East, nextActMinute: TIME.dayStartMinute + 4 });
    expect(result.state.robots.nextId).toBe(2);
  });

  it('refuses bad specs without changing the state', () => {
    const bad: readonly (typeof spec | Record<string, unknown>)[] = [
      { ...spec, name: '' },
      { ...spec, parts: ['claw', 'basket'] },
      { ...spec, parts: ['basket', 'claw'], size: 'standard' },
      { ...spec, place: { tx: -1, tz: 0, facing: Direction.North } },
      { ...spec, program: { kind: 'script', steps: [], loop: false } },
    ];
    for (const s of bad) expect('error' in addRobot(BASE, s as typeof spec)).toBe(true);
    const rock = withTile(BASE, TARGET, blockedTile(Blocker.Rock, 2), 'farm');
    expect('error' in addRobot(rock, spec)).toBe(true);
    let full = BASE;
    for (let i = 0; i < ROBOTS.maxRobots; i++) {
      const r = addRobot(full, spec);
      if ('error' in r) throw new Error(r.error);
      full = r.state;
    }
    expect(addRobot(full, spec)).toEqual({ error: 'The farm already has 12 robots.' });
  });
});
