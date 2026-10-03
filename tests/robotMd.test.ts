/**
 * The .MD through real minutes (farmclaws part 2 spec §6): DON'T skips are free and take the
 * turn, kept items stay in the bag, DO cards end the robot's day, conflicts are logged, and
 * DON'T beats DO beats the program.
 */
import { describe, expect, it } from 'vitest';
import { INVENTORY } from '../src/config';
import { Blocker, TileState, Weather, type BlockProgram, type GameState, type MdCard, type Robot, type RobotLogEvent, type Tile } from '../src/core/types';
import { b } from '../src/robots/blocks';
import { morningExec } from '../src/robots/exec';
import { decideTurn } from '../src/robots/turn';
import { requireRobot } from '../src/robots/world';
import { actions } from '../src/state/actions';
import { gameReducer } from '../src/state/reducer';
import { blockedTile, EMPTY_TILE } from '../src/world/tiles';
import { BASE, TARGET, matureCrop, robotOf, soilTile, stack, tileAt, withRobots, withTile, withZones } from './testUtils';

const ZONE_A = { x0: 3, z0: 9, w: 5, d: 4 };
const LEAVE_A: MdCard = { kind: 'dontLeave', zone: 'A' };
const NO_WATER: MdCard = { kind: 'dontGoIntoWater' };
const KEEP_PARSNIPS: MdCard = { kind: 'dontDeposit', itemId: 'parsnip' };
const SPARE_PARSNIPS: MdCard = { kind: 'dontHarvest', cropId: 'parsnip' };
const IN_RAIN: MdCard = { kind: 'doPowerDown', when: { kind: 'raining' } };
const returnTo = (tx: number, tz: number, minute: number): MdCard => ({ kind: 'doReturn', to: { kind: 'tile', tx, tz }, minute });

const SPIN = b.program({ stacks: [b.when(b.morning(), b.forever(b.turn('right')))] });
const MOVER = b.program({ stacks: [b.when(b.morning(), b.forever(b.move()))] });
const CHEST: Tile = { ...EMPTY_TILE, object: { kind: 'chest', slots: new Array<null>(INVENTORY.chestSlots).fill(null) } };

const tick = (state: GameState, minutes: number): GameState => gameReducer(state, actions.tick(minutes));
const sleep = (state: GameState): GameState => gameReducer(state, actions.sleep());
const at = (state: GameState, minute: number): GameState => ({ ...state, time: { ...state.time, minuteOfDay: minute } });
const events = (state: GameState): RobotLogEvent[] => state.robots.log.entries.map((e) => e.event);
/** Event kinds, with a DO return's phase: "doReturn started". */
const labels = (state: GameState): string[] => events(state).map((e) => (e.kind === 'doReturn' ? `doReturn ${e.phase}` : e.kind));

/** A working robot that has just started its morning stack, due at 6:04. */
function worker(program: BlockProgram, overrides: Partial<Robot> = {}): Robot {
  return robotOf({ program, exec: morningExec(program), ...overrides });
}

describe('DON’T cards in the tick', () => {
  it('skips a forbidden move: logged with the card, free, and the turn is taken', () => {
    const robot = worker(MOVER, { tz: 12, md: [LEAVE_A] });
    const state = withZones(withRobots(BASE, [robot]), { A: ZONE_A });
    const turn = decideTurn(at(state, 364), robot);
    if (turn.kind !== 'skip') throw new Error(`expected a skip, got ${turn.kind}`);
    const next = tick(state, 4);
    const after = requireRobot(next, 1);
    expect(after).toMatchObject({ tx: 5, tz: 12, tokens: 80, actionSeq: 1, nextActMinute: 368, power: 'working' });
    expect(after.stats.today).toEqual({ tokens: 0, actions: 0, crops: 0 });
    expect(after.lastAction).toEqual({ seq: 1, kind: 'move', success: false, bickered: false });
    expect(after.exec).toEqual(turn.exec);
    expect(events(next)).toEqual([{ kind: 'skipped', action: 'move', card: LEAVE_A }]);
    const later = tick(next, 8);
    expect(later.robots.log.entries).toHaveLength(1);
    expect(later.robots.log.entries[0]?.count).toBe(3);
    expect(requireRobot(later, 1).tokens).toBe(80);
  });

  it('skips driving into water with DON’T go into water, and shorts out without it', () => {
    const pond = withTile(BASE, { tx: 5, tz: 11 }, blockedTile(Blocker.Water), 'farm');
    const careful = tick(withRobots(pond, [worker(MOVER, { md: [NO_WATER] })]), 4);
    expect(requireRobot(careful, 1)).toMatchObject({ tz: 10, power: 'working', tokens: 80 });
    expect(events(careful)).toEqual([{ kind: 'skipped', action: 'move', card: NO_WATER }]);
    const careless = tick(withRobots(pond, [worker(MOVER)]), 4);
    expect(requireRobot(careless, 1)).toMatchObject({ tz: 11, power: 'broken' });
  });

  it('leaves a DON’T harvest crop in the ground', () => {
    const program = b.program({ stacks: [b.when(b.morning(), b.harvest())] });
    const field = withTile(BASE, TARGET, soilTile(TileState.Watered, matureCrop('parsnip')), 'farm');
    const next = tick(withRobots(field, [worker(program, { md: [SPARE_PARSNIPS] })]), 4);
    expect(tileAt(next, TARGET, 'farm').crop).not.toBeNull();
    expect(requireRobot(next, 1).bag).toEqual([]);
    expect(events(next)).toEqual([{ kind: 'skipped', action: 'harvest', card: SPARE_PARSNIPS }]);
  });

  it('deposits everything but the kept items, which stay in the bag', () => {
    const program = b.program({ stacks: [b.when(b.morning(), b.deposit())] });
    const robot = worker(program, { size: 'standard', tokens: 200, md: [KEEP_PARSNIPS], bag: [stack('parsnip', 3), stack('potato', 2)] });
    const ahead = { tx: TARGET.tx, tz: TARGET.tz + 1 };
    const next = tick(withRobots(withTile(BASE, ahead, CHEST, 'farm'), [robot]), 4);
    expect(requireRobot(next, 1)).toMatchObject({ bag: [stack('parsnip', 3)], tokens: 198 });
    const chest = tileAt(next, ahead, 'farm').object;
    expect(chest?.kind === 'chest' && chest.slots.slice(0, 2)).toEqual([stack('potato', 2), null]);
    expect(events(next)).toEqual([{ kind: 'did', action: 'deposit', detail: { kind: 'items', into: 'chest', stacks: 1, quantity: 2 } }]);
  });

  it('skips a deposit of only kept items', () => {
    const program = b.program({ stacks: [b.when(b.morning(), b.deposit())] });
    const robot = worker(program, { md: [KEEP_PARSNIPS], bag: [stack('parsnip', 3)] });
    const next = tick(withRobots(withTile(BASE, { tx: TARGET.tx, tz: TARGET.tz + 1 }, CHEST, 'farm'), [robot]), 4);
    expect(requireRobot(next, 1)).toMatchObject({ bag: [stack('parsnip', 3)], tokens: 80 });
    expect(events(next)).toEqual([{ kind: 'skipped', action: 'deposit', card: KEEP_PARSNIPS }]);
  });
});

describe('DO cards in the tick', () => {
  it('a DO power down ends the day: standby, off, triggers ignored, back next morning', () => {
    const program = b.program({ stacks: [b.when(b.morning(), b.forever(b.turn('right'))), b.when(b.every(5), b.move())] });
    const rainy = { ...withRobots(BASE, [worker(program, { md: [IN_RAIN] })]), weather: Weather.Rain };
    const next = tick(rainy, 4);
    expect(requireRobot(next, 1)).toMatchObject({ power: 'standby', off: 'done', actionSeq: 0, tokens: 80 });
    expect(events(next)).toEqual([{ kind: 'doPowerDown', card: IN_RAIN }]);
    const later = tick(next, 120);
    expect(requireRobot(later, 1)).toBe(requireRobot(next, 1));
    expect(events(later)).toHaveLength(1);
    const morning = sleep(later);
    expect(requireRobot(morning, 1)).toMatchObject({ off: null, power: 'working', exec: morningExec(program) });
  });

  it('a DO return walks home, then powers down for the day with the card done', () => {
    const card = returnTo(5, 13, 380);
    const robot = worker(SPIN, { md: [card], nextActMinute: 380 });
    const state = at(withRobots(BASE, [robot]), 376);
    const next = tick(state, 16);
    const after = requireRobot(next, 1);
    expect(after).toMatchObject({ tx: 5, tz: 13, power: 'standby', off: 'done', tokens: 77 });
    expect(after.exec).toEqual({ ...morningExec(SPIN), running: null, frames: [], doneCards: [0] });
    expect(labels(next)).toEqual(['doReturn started', 'did', 'doReturn arrived']);
    expect(next.robots.log.entries[1]?.count).toBe(3);
    const morning = sleep(tick(next, 60));
    expect(requireRobot(morning, 1)).toMatchObject({ off: null, power: 'working', exec: morningExec(SPIN) });
  });

  it('a DO return a DON’T stands in the way of fails, with the conflict logged first', () => {
    const card = returnTo(5, 14, 360);
    const state = withZones(withRobots(BASE, [worker(SPIN, { md: [LEAVE_A, card] })]), { A: ZONE_A });
    const next = tick(state, 4);
    expect(requireRobot(next, 1)).toMatchObject({ tx: 5, tz: 10, power: 'standby', off: 'done', tokens: 80 });
    expect(events(next)).toEqual([
      { kind: 'conflict', doCard: card, dontCard: LEAVE_A },
      { kind: 'doReturn', card, phase: 'failed' },
    ]);
  });
});

describe('precedence: DON’T beats DO beats the program', () => {
  // The robot stands on the zone's south edge (5, 12) facing South, moving forever, with 79 of its
  // 80 tokens, so `DO power down when I have fewer than 80 tokens` holds.
  const rows: readonly (readonly [string, readonly MdCard[], readonly string[]])[] = [
    ['the program alone', [], ['did']],
    ['a due DO return over the program', [returnTo(5, 14, 360)], ['doReturn started', 'did']],
    ['DON’T over the program', [LEAVE_A], ['skipped']],
    ['DON’T over a DO return', [LEAVE_A, returnTo(5, 14, 360)], ['conflict', 'doReturn failed']],
    ['DO power down over a DO return', [returnTo(5, 14, 360), { kind: 'doPowerDown', when: { kind: 'tokensBelow', n: 80 } }], ['doPowerDown']],
    ['DO power down, which no DON’T forbids', [LEAVE_A, { kind: 'doPowerDown', when: { kind: 'tokensBelow', n: 80 } }], ['doPowerDown']],
  ];
  it.each(rows)('%s', (_name, md, expected) => {
    const state = withZones(withRobots(BASE, [worker(MOVER, { tz: 12, tokens: 79, md })]), { A: ZONE_A });
    expect(labels(tick(state, 4))).toEqual(expected);
  });
});
