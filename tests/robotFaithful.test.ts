/**
 * Faithful to a fault (farmclaws design §3.9, part 2 spec §14.1): instructions that sound
 * sensible, carried out exactly. Each test is one row of the design's table that part 2 can
 * express, and asserts the faithful outcome and the log line that explains it. The row "DON'T
 * spend more than 60 tokens a day" waits for that card (part 7).
 *
 * Robots act on their own tile (water, harvest) and the tile ahead (move, refill, deposit). A
 * Mini acts every 4 minutes from 6:04; a Standard pays twice a Mini's costs.
 */
import { describe, expect, it } from 'vitest';
import { INVENTORY, ROBOTS, TIME } from '../src/config';
import { Blocker, Direction, TileState, Weather, type GameState, type ItemId, type MdCard, type RobotLogEvent, type TileCoord } from '../src/core/types';
import { bagCount } from '../src/robots/bag';
import { b } from '../src/robots/blocks';
import { robotSays } from '../src/robots/logText';
import { actionCost } from '../src/robots/stats';
import { requireRobot } from '../src/robots/world';
import { actions } from '../src/state/actions';
import { gameReducer } from '../src/state/reducer';
import { chebyshevDistance } from '../src/world/grid';
import { EMPTY_TILE, blockedTile } from '../src/world/tiles';
import { programmed } from './programGen';
import { BASE, atDay, matureCrop, robotOf, soilTile, tileAt, withRobots, withTile, withZones } from './testUtils';

const MORNING = atDay(BASE, 0, TIME.dayStartMinute);
const SIX_PM = 18 * 60;
/** Zone A in most rows: three tiles in a row, walked west to east. */
const ROW_A = { x0: 4, z0: 12, w: 3, d: 1 } as const;

const tick = (state: GameState, minutes: number): GameState => gameReducer(state, actions.tick(minutes));

/** Every event robot 1 logged, oldest first, with collapsed repeats expanded. */
const eventsOf = (state: GameState): RobotLogEvent[] =>
  state.robots.log.entries.filter((e) => e.robotId === 1).flatMap((e) => Array.from({ length: e.count }, () => e.event));

const repeated = (n: number, event: RobotLogEvent): RobotLogEvent[] => Array.from({ length: n }, () => event);

function chestItems(state: GameState, at: TileCoord): ItemId[] {
  const object = tileAt(state, at, 'farm').object;
  return object?.kind === 'chest' ? object.slots.flatMap((s) => (s === null ? [] : [s.itemId])) : [];
}

/** "For each tile in A: if crop is ready, harvest", started at 6:00. */
const HARVEST_A = b.program({ stacks: [b.when(b.morning(), b.forEach('A', b.if(b.cropIsReady(), [b.harvest()])))] });

describe('faithful to a fault', () => {
  it("DON'T go into water, and a refill trip to the pond: it waters until the tank is empty, then trundles over the dry tiles doing nothing", () => {
    // Refill works from the shore, so the trip that can't happen is the one that ends in the pond:
    // a route never ends on water, with or without the card.
    const pond: TileCoord = { tx: 8, tz: 12 };
    const bed: TileCoord[] = [
      { tx: 4, tz: 12 },
      { tx: 5, tz: 12 },
      { tx: 6, tz: 12 },
      { tx: 6, tz: 13 },
      { tx: 5, tz: 13 },
      { tx: 4, tz: 13 },
    ]; // snake order
    let state = withZones(MORNING, { A: { x0: 4, z0: 12, w: 3, d: 2 } });
    for (const at of bed) state = withTile(state, at, soilTile(TileState.Plowed), 'farm');
    state = withTile(state, pond, blockedTile(Blocker.Water), 'farm');
    const program = b.program({
      stacks: [b.when(b.morning(), b.forEach('A', b.if(b.soilIsDry(), [b.water()])), b.goTo(b.tileAt(pond.tx, pond.tz)), b.refill())],
    });
    const robot = programmed(robotOf({ parts: ['wateringHead'], tank: 3, tx: 4, tz: 12, facing: Direction.East }), program, [{ kind: 'dontGoIntoWater' }]);
    // 15 turns, 6:04 … 7:00: 3 waters, 3 dry waters, 5 moves, 2 turns, the refill, then it finishes.
    const next = tick(withRobots(state, [robot]), 60);

    const W = TileState.Watered;
    const P = TileState.Plowed;
    expect(bed.map((at) => tileAt(next, at, 'farm').state)).toEqual([W, W, W, P, P, P]);
    const after = requireRobot(next, 1);
    expect([after.tank, after.power, after.tokens]).toEqual([0, 'standby', 60]);
    const events = eventsOf(next);
    expect(events.filter((e) => e.kind === 'blocked' && e.action === 'water')).toEqual(repeated(3, { kind: 'blocked', action: 'water', reason: 'tankEmpty' }));
    expect(events).toContainEqual({ kind: 'gaveUp', target: pond, why: 'goTo' });
    expect(events).toContainEqual({ kind: 'blocked', action: 'refill', reason: 'noWaterAhead' });
    expect(events.at(-1)).toEqual({ kind: 'finished' });
  });

  it("DON'T leave Zone A, and a program that deposits into a chest just outside it: the bag fills and every harvest after that fails", () => {
    const front: TileCoord = { tx: 6, tz: 13 };
    const chestAt: TileCoord = { tx: 6, tz: 14 };
    const field = (md: readonly MdCard[]): GameState => {
      let state = withZones(MORNING, { A: ROW_A });
      state = withTile(state, { tx: 4, tz: 12 }, soilTile(TileState.Watered, matureCrop('parsnip')), 'farm');
      for (const tx of [5, 6]) state = withTile(state, { tx, tz: 12 }, soilTile(TileState.Watered, matureCrop('potato')), 'farm');
      const emptyChest = { kind: 'chest' as const, slots: Array.from({ length: INVENTORY.chestSlots }, () => null) };
      state = withTile(state, chestAt, { ...EMPTY_TILE, object: emptyChest }, 'farm');
      const program = b.program({
        stacks: [b.when(b.morning(), b.forEach('A', b.if(b.cropIsReady(), [b.harvest()])), b.goTo(b.tileAt(front.tx, front.tz)), b.deposit())],
      });
      return withRobots(state, [programmed(robotOf({ tx: 4, tz: 12, facing: Direction.East }), program, md)]);
    };

    // A one-stack Mini: the parsnip fills its bag, both potatoes fail, the route out of A is
    // refused, and the deposit faces open grass.
    const fenced = tick(field([{ kind: 'dontLeave', zone: 'A' }]), 30);
    const robot = requireRobot(fenced, 1);
    expect(robot.bag.map((s) => s.itemId)).toEqual(['parsnip']);
    expect([5, 6].map((tx) => tileAt(fenced, { tx, tz: 12 }, 'farm').crop?.cropId)).toEqual(['potato', 'potato']);
    expect(chestItems(fenced, chestAt)).toEqual([]);
    const events = eventsOf(fenced);
    expect(events.filter((e) => e.kind === 'blocked' && e.action === 'harvest')).toEqual(repeated(2, { kind: 'blocked', action: 'harvest', reason: 'bagFull' }));
    expect(events).toContainEqual({ kind: 'gaveUp', target: front, why: 'goTo' });
    expect([robot.tx, robot.tz, robot.power, robot.tokens]).toEqual([6, 12, 'standby', 68]);

    // Without the card the same program reaches the chest.
    const free = tick(field([]), 40);
    expect(chestItems(free, chestAt)).toEqual(['parsnip']);
    expect(requireRobot(free, 1).bag).toEqual([]);
  });

  it('DO power down when the bag is full, on a one-stack Mini in a row of two crops: it stops after its first harvest, every morning', () => {
    // "Full" means every bag stack is in use, so one parsnip fills a one-stack Mini.
    const card: MdCard = { kind: 'doPowerDown', when: { kind: 'bagFull' } };
    let state = withZones(MORNING, { A: ROW_A });
    for (const [tx, crop] of [[4, 'parsnip'], [5, 'parsnip'], [6, 'potato']] as const) {
      state = withTile(state, { tx, tz: 12 }, soilTile(TileState.Watered, matureCrop(crop)), 'farm');
    }
    const next = tick(withRobots(state, [programmed(robotOf({ tx: 4, tz: 12, facing: Direction.East }), HARVEST_A, [card])]), 60);
    const robot = requireRobot(next, 1);
    expect([robot.power, robot.off, robot.tx, robot.tz, robot.tokens]).toEqual(['standby', 'done', 4, 12, 77]);
    expect(robot.bag.map((s) => [s.itemId, s.quantity])).toEqual([['parsnip', 1]]);
    expect([5, 6].map((tx) => tileAt(next, { tx, tz: 12 }, 'farm').crop?.cropId)).toEqual(['parsnip', 'potato']);
    expect(eventsOf(next).at(-1)).toEqual({ kind: 'doPowerDown', card });

    // The morning turns it back on; the bag is still full, so it powers straight down again.
    const morning = gameReducer(next, actions.sleep());
    expect(requireRobot(morning, 1).off).toBeNull();
    expect(requireRobot(tick(morning, ROBOTS.period), 1).off).toBe('done');
  });

  it('DO return to the nearest generator at 6:00 pm: it leaves on the dot, with half the row unharvested', () => {
    const card: MdCard = { kind: 'doReturn', to: { kind: 'generator' }, minute: SIX_PM };
    const burner: TileCoord = { tx: 6, tz: 15 };
    const row: TileCoord[] = [4, 5, 6, 7, 8, 9].map((tx) => ({ tx, tz: 12 }));
    let state = withZones(atDay(BASE, 0, SIX_PM - 24), { A: { x0: 4, z0: 12, w: 6, d: 1 } });
    for (const at of row) state = withTile(state, at, soilTile(TileState.Watered, matureCrop('parsnip')), 'farm');
    state = withTile(state, burner, { ...EMPTY_TILE, object: { kind: 'woodBurner', fuel: 0 } }, 'farm');
    // Programmed at 6:00 and still at it in the evening: it harvests at 17:40, 17:48 and 17:56.
    const robot = programmed(robotOf({ size: 'standard', parts: ['claw', 'basket'], tokens: 200, tx: 4, tz: 12, facing: Direction.East }), HARVEST_A, [card]);
    const next = tick(withRobots(state, [{ ...robot, nextActMinute: SIX_PM - 20 }]), 60);

    expect(row.map((at) => tileAt(next, at, 'farm').crop === null)).toEqual([true, true, true, false, false, false]);
    const after = requireRobot(next, 1);
    expect([after.power, after.off]).toEqual(['standby', 'done']);
    expect(bagCount(after.bag, 'parsnip')).toBe(3);
    expect(chebyshevDistance(after, burner)).toBeLessThanOrEqual(ROBOTS.chargeRadius);
    const returns = next.robots.log.entries.filter((e) => e.event.kind === 'doReturn');
    expect(returns.map((e) => e.event)).toEqual([
      { kind: 'doReturn', card, phase: 'started' },
      { kind: 'doReturn', card, phase: 'arrived' },
    ]);
    expect(returns[0]?.minute).toBe(SIX_PM);
  });

  it('"Harvest everything that\'s ready" harvests the pumpkin you were growing for the Claw Fair', () => {
    const fair = (md: readonly MdCard[]): GameState => {
      let state = withZones(MORNING, { A: ROW_A });
      for (const [tx, crop] of [[4, 'parsnip'], [5, 'pumpkin'], [6, 'parsnip']] as const) {
        state = withTile(state, { tx, tz: 12 }, soilTile(TileState.Watered, matureCrop(crop)), 'farm');
      }
      const robot = robotOf({ size: 'standard', parts: ['claw', 'basket'], tokens: 200, tx: 4, tz: 12, facing: Direction.East });
      return withRobots(state, [programmed(robot, HARVEST_A, md)]);
    };

    const greedy = tick(fair([]), 30);
    const greedyBot = requireRobot(greedy, 1);
    expect([bagCount(greedyBot.bag, 'pumpkin'), bagCount(greedyBot.bag, 'parsnip')]).toEqual([1, 2]);
    expect(tileAt(greedy, { tx: 5, tz: 12 }, 'farm').crop).toBeNull();

    // Once the player closes the gap, the same robot leaves it alone, the skip is free, and the
    // log names the rule.
    const card: MdCard = { kind: 'dontHarvest', cropId: 'pumpkin' };
    const careful = tick(fair([card]), 30);
    const carefulBot = requireRobot(careful, 1);
    expect([bagCount(carefulBot.bag, 'pumpkin'), bagCount(carefulBot.bag, 'parsnip')]).toEqual([0, 2]);
    expect(tileAt(careful, { tx: 5, tz: 12 }, 'farm').crop?.cropId).toBe('pumpkin');
    expect(eventsOf(careful)).toContainEqual({ kind: 'skipped', action: 'harvest', card });
    expect(carefulBot.tokens - greedyBot.tokens).toBe(actionCost(carefulBot, 'harvest'));
  });

  it('"Water every dry tile in Zone A" on a rainy morning: nothing is dry, so it finishes at once and reports ✓', () => {
    let state: GameState = { ...withZones(MORNING, { A: ROW_A }), weather: Weather.Rain };
    // The rain watered the bed at dawn.
    for (const tx of [4, 5, 6]) state = withTile(state, { tx, tz: 12 }, soilTile(TileState.Watered), 'farm');
    const program = b.program({ stacks: [b.when(b.morning(), b.forEach('A', b.if(b.soilIsDry(), [b.water()])))] });
    const robot = programmed(robotOf({ parts: ['wateringHead'], tank: ROBOTS.tankCapacity, tx: 4, tz: 12, facing: Direction.East }), program);
    const next = tick(withRobots(state, [robot]), 20);

    const after = requireRobot(next, 1);
    expect([after.power, after.tank, after.tx, after.tz, after.tokens]).toEqual(['standby', ROBOTS.tankCapacity, 6, 12, 78]);
    const move: RobotLogEvent = { kind: 'did', action: 'move', detail: { kind: 'none' } };
    expect(eventsOf(next)).toEqual([move, move, { kind: 'finished' }]);
    const entries = next.robots.log.entries;
    expect(entries.at(-1)?.minute).toBe(TIME.dayStartMinute + 3 * ROBOTS.period);
    expect(entries.every((e) => robotSays(e).endsWith(' ✓'))).toBe(true);
  });
});
