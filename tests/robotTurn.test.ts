/**
 * One due minute of a block-program robot (farmclaws part 2 spec §6.1, §7): DO power down, DO
 * return, the program or the trigger checks, and the DON'T check, as exact Turn values. Also the
 * new log events' text and their save validation.
 */
import { describe, expect, it } from 'vitest';
import { Blocker, TileState, Weather, type BlockProgram, type GameState, type MdCard, type Robot, type RobotExec, type RobotLogEntry, type RobotLogEvent, type Tile, type TileCoord, type Trigger } from '../src/core/types';
import { b } from '../src/robots/blocks';
import { freshExec, morningExec } from '../src/robots/exec';
import { startStack, stepProgram } from '../src/robots/interpret';
import { logRobotEvent } from '../src/robots/log';
import { robotSays, triggerText, whatHappened } from '../src/robots/logText';
import { dueReturnCard, mdCardText, powerDownCard, returnTarget } from '../src/robots/md';
import { decideTurn } from '../src/robots/turn';
import { deserializeGame, serializeGame } from '../src/state/persistence';
import { blockedTile, EMPTY_TILE } from '../src/world/tiles';
import { BASE, TARGET, matureCrop, must, robotOf, soilTile, stack, withRobots, withTile, withZones } from './testUtils';

/** Zone A: x 3 … 7, z 9 … 12, around TARGET (5, 10) inside the clear zone. */
const ZONE_A = { x0: 3, z0: 9, w: 5, d: 4 };
const LEAVE_A: MdCard = { kind: 'dontLeave', zone: 'A' };
const NO_WATER: MdCard = { kind: 'dontGoIntoWater' };
const SPARE_PARSNIPS: MdCard = { kind: 'dontHarvest', cropId: 'parsnip' };
const KEEP_PARSNIPS: MdCard = { kind: 'dontDeposit', itemId: 'parsnip' };
const TO_GENERATOR: MdCard = { kind: 'doReturn', to: { kind: 'generator' }, minute: 1080 };
const returnTo = (tx: number, tz: number, minute = 1080): MdCard => ({ kind: 'doReturn', to: { kind: 'tile', tx, tz }, minute });
const downWhen = (when: Extract<MdCard, { readonly kind: 'doPowerDown' }>['when']): MdCard => ({ kind: 'doPowerDown', when });

const WATER = blockedTile(Blocker.Water);
const ROCK = blockedTile(Blocker.Rock);
const BURNER: Tile = { ...EMPTY_TILE, object: { kind: 'woodBurner', fuel: 0 } };

const SPIN = b.program({ stacks: [b.when(b.morning(), b.turn('right'))] });
const MOVER = b.program({ stacks: [b.when(b.morning(), b.forever(b.move()))] });

const at = (state: GameState, minute: number): GameState => ({ ...state, time: { ...state.time, minuteOfDay: minute } });
const withWeather = (state: GameState, weather: Weather): GameState => ({ ...state, weather });
const execOf = (robot: Robot): RobotExec => must(robot.exec);
const frame0 = (index: number, next: number) => ({ kind: 'list' as const, list: { root: 'stack' as const, index, path: [] }, next, loop: null });

/** A working robot that has just started stack 0 of `program`. */
function running(program: BlockProgram, overrides: Partial<Robot> = {}): Robot {
  return robotOf({ program, exec: startStack(freshExec(program), 0), ...overrides });
}

/** An idle robot on standby: no stack running. */
function idle(program: BlockProgram, overrides: Partial<Robot> = {}): Robot {
  return robotOf({ program, exec: freshExec(program), power: 'standby', ...overrides });
}

/** A robot part-way through a DO return to (5, 13) along `path`. */
function returning(path: readonly TileCoord[], overrides: Partial<Robot> = {}): Robot {
  const exec: RobotExec = { ...freshExec(SPIN), frames: [{ kind: 'route', target: { tx: 5, tz: 13 }, path, why: 'doReturn' }] };
  return robotOf({ program: SPIN, exec, md: [returnTo(5, 13)], ...overrides });
}

/** The exec the program's own step produces (the step must be an action). */
function stepped(state: GameState, robot: Robot): RobotExec {
  const step = stepProgram(state, robot);
  if (step.kind !== 'act') throw new Error(`expected an action, got ${step.kind}`);
  return step.exec;
}

const stoppedExec = (robot: Robot): RobotExec => ({ ...execOf(robot), running: null, frames: [] });

describe('decideTurn: the program', () => {
  it('runs the program when no card applies', () => {
    const robot = running(SPIN);
    expect(decideTurn(BASE, robot)).toEqual({
      kind: 'act',
      action: { kind: 'turn', side: 'right' },
      exec: { ...execOf(robot), frames: [frame0(0, 1)] },
      wakeCost: 0,
      keep: new Set(),
      events: [],
    });
  });

  it('finishes when the running stack ends, leaving no frames', () => {
    const robot = running(SPIN, { exec: { ...execOf(running(SPIN)), frames: [frame0(0, 1)] } });
    expect(decideTurn(BASE, robot)).toEqual({ kind: 'finish', exec: stoppedExec(robot), wakeCost: 0, events: [] });
  });

  it('ends the running stack on a Power down block, so triggers can wake it', () => {
    const program = b.program({ stacks: [b.when(b.morning(), b.powerDown())] });
    const robot = running(program);
    expect(decideTurn(BASE, robot)).toEqual({ kind: 'act', action: { kind: 'powerDown' }, exec: stoppedExec(robot), wakeCost: 0, keep: new Set(), events: [] });
  });

  it('goes dizzy on a loop of free blocks', () => {
    const program = b.program({ vars: [b.numVar('x', 0)], stacks: [b.when(b.morning(), b.forever(b.set('x', b.n(1))))] });
    expect(decideTurn(BASE, running(program))).toEqual({ kind: 'dizzy', wakeCost: 0, events: [] });
  });

  it('logs a route it gave up on before the action', () => {
    const program = b.program({ stacks: [b.when(b.morning(), b.goTo(b.tileAt(5, 13)), b.turn('left'))] });
    const state = withTile(BASE, { tx: 5, tz: 13 }, WATER, 'farm');
    const robot = running(program);
    expect(decideTurn(state, robot)).toEqual({
      kind: 'act',
      action: { kind: 'turn', side: 'left' },
      exec: stepped(state, robot),
      wakeCost: 0,
      keep: new Set(),
      events: [{ kind: 'gaveUp', target: { tx: 5, tz: 13 }, why: 'goTo' }],
    });
  });
});

describe('decideTurn: DO power down', () => {
  const shutBy = (robot: Robot, card: MdCard) => ({ kind: 'shutDown', exec: stoppedExec(robot), event: { kind: 'doPowerDown', card }, events: [] });

  it('powers down when the bag is full, and not before', () => {
    const card = downWhen({ kind: 'bagFull' });
    const full = running(SPIN, { md: [card], bag: [stack('parsnip', 1)] });
    expect(decideTurn(BASE, full)).toEqual(shutBy(full, card));
    expect(decideTurn(BASE, running(SPIN, { md: [card] })).kind).toBe('act');
  });

  it('powers down with fewer than n tokens, and not at exactly n', () => {
    const card = downWhen({ kind: 'tokensBelow', n: 10 });
    const low = running(SPIN, { md: [card], tokens: 9 });
    expect(decideTurn(BASE, low)).toEqual(shutBy(low, card));
    expect(decideTurn(BASE, running(SPIN, { md: [card], tokens: 10 })).kind).toBe('act');
  });

  it('powers down in rain and storm, not in sun or snow', () => {
    const card = downWhen({ kind: 'raining' });
    const robot = running(SPIN, { md: [card] });
    for (const weather of [Weather.Rain, Weather.Storm]) expect(decideTurn(withWeather(BASE, weather), robot)).toEqual(shutBy(robot, card));
    for (const weather of [Weather.Sunny, Weather.Snow]) expect(decideTurn(withWeather(BASE, weather), robot).kind).toBe('act');
  });

  it('wins over a due DO return and over the program, and applies to an idle robot too', () => {
    const card = downWhen({ kind: 'raining' });
    const robot = running(SPIN, { md: [returnTo(5, 13, 360), card] });
    expect(decideTurn(withWeather(BASE, Weather.Rain), robot)).toEqual(shutBy(robot, card));
    const resting = idle(SPIN, { md: [card] });
    const turn = decideTurn(withWeather(BASE, Weather.Rain), resting);
    if (turn.kind !== 'shutDown') throw new Error(`expected a shutDown, got ${turn.kind}`);
    expect(turn).toEqual(shutBy(resting, card));
    expect(turn.exec).toBe(resting.exec);
  });

  it('finds the first card whose condition holds', () => {
    const bag = downWhen({ kind: 'bagFull' });
    const tokens = downWhen({ kind: 'tokensBelow', n: 50 });
    expect(powerDownCard(BASE, running(SPIN, { md: [bag, tokens], tokens: 20 }))).toBe(tokens);
    expect(powerDownCard(BASE, running(SPIN, { md: [bag, tokens] }))).toBeNull();
  });
});

describe('decideTurn: DO return', () => {
  const EVENING = at(BASE, 1080);

  it('starts at its minute: replaces the frames with a route, logs started and takes the first step', () => {
    const card = returnTo(5, 13);
    const robot = running(SPIN, { md: [card] });
    expect(decideTurn(EVENING, robot)).toEqual({
      kind: 'act',
      action: { kind: 'move' },
      exec: { ...execOf(robot), running: null, frames: [{ kind: 'route', target: { tx: 5, tz: 13 }, path: [{ tx: 5, tz: 12 }, { tx: 5, tz: 13 }], why: 'doReturn' }] },
      wakeCost: 0,
      keep: new Set(),
      events: [{ kind: 'doReturn', card, phase: 'started' }],
    });
    expect(decideTurn(at(BASE, 1079), robot)).toMatchObject({ kind: 'act', action: { kind: 'turn', side: 'right' }, events: [] });
  });

  it('continues along its path, turning first when it faces the wrong way', () => {
    const onward = returning([{ tx: 5, tz: 12 }, { tx: 5, tz: 13 }], { tz: 11 });
    expect(decideTurn(EVENING, onward)).toEqual({
      kind: 'act',
      action: { kind: 'move' },
      exec: { ...execOf(onward), frames: [{ kind: 'route', target: { tx: 5, tz: 13 }, path: [{ tx: 5, tz: 13 }], why: 'doReturn' }] },
      wakeCost: 0,
      keep: new Set(),
      events: [],
    });
    const sideways = returning([{ tx: 5, tz: 11 }, { tx: 5, tz: 12 }, { tx: 5, tz: 13 }], { facing: 1 });
    expect(decideTurn(EVENING, sideways)).toEqual({
      kind: 'act',
      action: { kind: 'turn', side: 'right' },
      exec: execOf(sideways),
      wakeCost: 0,
      keep: new Set(),
      events: [],
    });
  });

  it('re-plans from where it stands when the next path tile is not beside it', () => {
    const carried = returning([{ tx: 5, tz: 12 }, { tx: 5, tz: 13 }]);
    expect(decideTurn(EVENING, carried)).toMatchObject({
      kind: 'act',
      action: { kind: 'move' },
      exec: { frames: [{ kind: 'route', path: [{ tx: 5, tz: 12 }, { tx: 5, tz: 13 }] }] },
    });
  });

  it('re-plans when its next tile can no longer be entered, instead of walking into it', () => {
    const robot = returning([{ tx: 5, tz: 12 }, { tx: 5, tz: 13 }], { tz: 11 });
    expect(decideTurn(withTile(EVENING, { tx: 5, tz: 12 }, ROCK, 'farm'), robot)).toEqual({
      kind: 'act',
      action: { kind: 'turn', side: 'left' },
      exec: {
        ...execOf(robot),
        frames: [{ kind: 'route', target: { tx: 5, tz: 13 }, path: [{ tx: 6, tz: 11 }, { tx: 6, tz: 12 }, { tx: 6, tz: 13 }, { tx: 5, tz: 13 }], why: 'doReturn' }],
      },
      wakeCost: 0,
      keep: new Set(),
      events: [],
    });
  });

  it('arrives: standby for the day, the card in doneCards', () => {
    const home = returning([], { tz: 13 });
    expect(decideTurn(EVENING, home)).toEqual({
      kind: 'shutDown',
      exec: { ...freshExec(SPIN), doneCards: [0] },
      event: { kind: 'doReturn', card: returnTo(5, 13), phase: 'arrived' },
      events: [],
    });
  });

  it('is carried out once a day: doneCards lets the program run', () => {
    const robot = running(SPIN, { md: [returnTo(5, 13)], exec: { ...execOf(running(SPIN)), doneCards: [0] } });
    expect(dueReturnCard(at(BASE, 1100), robot)).toBeNull();
    expect(decideTurn(at(BASE, 1100), robot)).toMatchObject({ kind: 'act', action: { kind: 'turn', side: 'right' } });
  });

  it('names the first due card and its index, and nothing while a return is under way', () => {
    const card = returnTo(5, 13);
    expect(dueReturnCard(EVENING, running(SPIN, { md: [LEAVE_A, card] }))).toEqual({ card, index: 1 });
    expect(dueReturnCard(at(BASE, 1079), running(SPIN, { md: [LEAVE_A, card] }))).toBeNull();
    expect(dueReturnCard(EVENING, returning([]))).toBeNull();
  });

  it('fails with no generator on the farm, and with no way to the tile', () => {
    const toGenerator = running(SPIN, { md: [TO_GENERATOR] });
    expect(decideTurn(EVENING, toGenerator)).toEqual({
      kind: 'shutDown',
      exec: stoppedExec(toGenerator),
      event: { kind: 'doReturn', card: TO_GENERATOR, phase: 'failed' },
      events: [],
    });
    const toWater = running(SPIN, { md: [returnTo(5, 13)] });
    expect(decideTurn(withTile(EVENING, { tx: 5, tz: 13 }, WATER, 'farm'), toWater)).toEqual({
      kind: 'shutDown',
      exec: stoppedExec(toWater),
      event: { kind: 'doReturn', card: returnTo(5, 13), phase: 'failed' },
      events: [],
    });
  });

  it('fails part-way when the way is gone, without logging started again', () => {
    const robot = returning([{ tx: 5, tz: 12 }, { tx: 5, tz: 13 }]);
    expect(decideTurn(withTile(EVENING, { tx: 5, tz: 13 }, WATER, 'farm'), robot)).toEqual({
      kind: 'shutDown',
      exec: freshExec(SPIN),
      event: { kind: 'doReturn', card: returnTo(5, 13), phase: 'failed' },
      events: [],
    });
  });

  it('logs a conflict naming both cards when a DON’T is what stops it', () => {
    const card = returnTo(5, 14);
    const robot = running(SPIN, { md: [LEAVE_A, card] });
    expect(decideTurn(withZones(EVENING, { A: ZONE_A }), robot)).toEqual({
      kind: 'shutDown',
      exec: stoppedExec(robot),
      event: { kind: 'doReturn', card, phase: 'failed' },
      events: [{ kind: 'conflict', doCard: card, dontCard: LEAVE_A }],
    });
  });

  it('targets the generator nearest by route length, then the burner first in tile order', () => {
    const robot = running(SPIN, { md: [TO_GENERATOR] });
    const two = withTile(withTile(EVENING, { tx: 5, tz: 15 }, BURNER, 'farm'), { tx: 11, tz: 10 }, BURNER, 'farm');
    expect(returnTarget(two, robot, TO_GENERATOR)).toEqual({ tx: 5, tz: 13 });
    expect(decideTurn(two, robot)).toMatchObject({ kind: 'act', exec: { frames: [{ target: { tx: 5, tz: 13 } }] } });
    let walled = two;
    for (let tx = 3; tx <= 7; tx++) walled = withTile(walled, { tx, tz: 12 }, ROCK, 'farm');
    expect(returnTarget(walled, robot, TO_GENERATOR)).toEqual({ tx: 9, tz: 10 });
    // Both burners are two moves away; (1, 10) comes first in tile order although (5, 12) is found first.
    const tied = withTile(withTile(EVENING, { tx: 1, tz: 10 }, BURNER, 'farm'), { tx: 5, tz: 14 }, BURNER, 'farm');
    expect(returnTarget(tied, robot, TO_GENERATOR)).toEqual({ tx: 3, tz: 10 });
    expect(returnTarget(EVENING, robot, TO_GENERATOR)).toBeNull();
  });
});

describe('decideTurn: DON’T cards', () => {
  it('skips a move out of a DON’T leave zone, and allows one inside it', () => {
    const state = withZones(BASE, { A: ZONE_A });
    const edge = running(MOVER, { tz: 12, md: [LEAVE_A] });
    expect(decideTurn(state, edge)).toEqual({ kind: 'skip', action: { kind: 'move' }, card: LEAVE_A, exec: stepped(state, edge), wakeCost: 0, events: [] });
    expect(decideTurn(state, running(MOVER, { tz: 11, md: [LEAVE_A] })).kind).toBe('act');
  });

  it('skips a move into water, and allows it without the card', () => {
    const state = withTile(BASE, { tx: 5, tz: 11 }, WATER, 'farm');
    const robot = running(MOVER, { md: [NO_WATER] });
    expect(decideTurn(state, robot)).toEqual({ kind: 'skip', action: { kind: 'move' }, card: NO_WATER, exec: stepped(state, robot), wakeCost: 0, events: [] });
    expect(decideTurn(state, running(MOVER)).kind).toBe('act');
  });

  it('skips harvesting the named crop only', () => {
    const program = b.program({ stacks: [b.when(b.morning(), b.harvest())] });
    const robot = running(program, { md: [SPARE_PARSNIPS] });
    const parsnip = withTile(BASE, TARGET, soilTile(TileState.Watered, matureCrop('parsnip')), 'farm');
    expect(decideTurn(parsnip, robot)).toEqual({ kind: 'skip', action: { kind: 'harvest' }, card: SPARE_PARSNIPS, exec: stepped(parsnip, robot), wakeCost: 0, events: [] });
    const potato = withTile(BASE, TARGET, soilTile(TileState.Watered, matureCrop('potato')), 'farm');
    expect(decideTurn(potato, robot).kind).toBe('act');
  });

  it('skips a deposit of only kept items, and deposits the rest with the kept set', () => {
    const program = b.program({ stacks: [b.when(b.morning(), b.deposit())] });
    const keeper = running(program, { size: 'standard', md: [KEEP_PARSNIPS], bag: [stack('parsnip', 3)] });
    expect(decideTurn(BASE, keeper)).toEqual({ kind: 'skip', action: { kind: 'deposit' }, card: KEEP_PARSNIPS, exec: stepped(BASE, keeper), wakeCost: 0, events: [] });
    const mixed = { ...keeper, bag: [stack('parsnip', 3), stack('potato', 2)] };
    expect(decideTurn(BASE, mixed)).toEqual({ kind: 'act', action: { kind: 'deposit' }, exec: stepped(BASE, mixed), wakeCost: 0, keep: new Set(['parsnip']), events: [] });
  });
});

describe('decideTurn: triggers', () => {
  /** A woken robot's turn: its first action, a turn, after the wake. */
  const woken = (exec: RobotExec, side: 'left' | 'right', trigger: Trigger) => ({
    kind: 'act',
    action: { kind: 'turn', side },
    exec,
    wakeCost: 1,
    keep: new Set(),
    events: [{ kind: 'woke', trigger }],
  });

  it('atTime fires once its minute has come, and only once a day', () => {
    const program = b.program({ stacks: [b.when(b.atTime(600), b.turn('left'))] });
    const robot = idle(program);
    expect(decideTurn(at(BASE, 599), robot)).toEqual({ kind: 'wait' });
    for (const minute of [600, 650]) {
      expect(decideTurn(at(BASE, minute), robot)).toEqual(
        woken({ ...execOf(robot), due: [null], running: 0, frames: [frame0(0, 1)] }, 'left', b.atTime(600)),
      );
    }
    expect(decideTurn(at(BASE, 700), idle(program, { exec: { ...freshExec(program), due: [null] } }))).toEqual({ kind: 'wait' });
  });

  it('every n fires when its due minute has come; the next due is this minute + n', () => {
    const program = b.program({ stacks: [b.when(b.every(15), b.turn('right'))] });
    const robot = idle(program);
    expect(execOf(robot).due).toEqual([375]);
    expect(decideTurn(at(BASE, 374), robot)).toEqual({ kind: 'wait' });
    expect(decideTurn(at(BASE, 375), robot)).toEqual(woken({ ...execOf(robot), due: [390], running: 0, frames: [frame0(0, 1)] }, 'right', b.every(15)));
    expect(decideTurn(at(BASE, 377), robot)).toEqual(woken({ ...execOf(robot), due: [392], running: 0, frames: [frame0(0, 1)] }, 'right', b.every(15)));
  });

  it('bagFull fires on a full bag, once a day', () => {
    const program = b.program({ stacks: [b.when(b.bagFull(), b.turn('right'))] });
    const full = idle(program, { bag: [stack('parsnip', 1)] });
    expect(decideTurn(BASE, full)).toEqual(
      woken({ ...execOf(full), firedToday: [true], running: 0, frames: [frame0(0, 1)] }, 'right', b.bagFull()),
    );
    expect(decideTurn(BASE, idle(program))).toEqual({ kind: 'wait' });
    expect(decideTurn(BASE, { ...full, exec: { ...execOf(full), firedToday: [true] } })).toEqual({ kind: 'wait' });
  });

  it('startsRaining fires in rain and storm, once a day, never in sun or snow', () => {
    const program = b.program({ stacks: [b.when(b.startsRaining(), b.turn('right'))] });
    const robot = idle(program);
    for (const weather of [Weather.Rain, Weather.Storm]) {
      expect(decideTurn(withWeather(BASE, weather), robot)).toEqual(
        woken({ ...execOf(robot), firedToday: [true], running: 0, frames: [frame0(0, 1)] }, 'right', b.startsRaining()),
      );
    }
    for (const weather of [Weather.Sunny, Weather.Snow]) expect(decideTurn(withWeather(BASE, weather), robot)).toEqual({ kind: 'wait' });
    expect(decideTurn(withWeather(BASE, Weather.Rain), { ...robot, exec: { ...execOf(robot), firedToday: [true] } })).toEqual({ kind: 'wait' });
  });

  it('never fires morning from idle', () => {
    expect(decideTurn(at(BASE, 600), idle(SPIN))).toEqual({ kind: 'wait' });
  });

  it('starts only the first stack that fires, in program order', () => {
    const program = b.program({ stacks: [b.when(b.every(15), b.turn('right')), b.when(b.atTime(400), b.turn('left'))] });
    const turn = decideTurn(at(BASE, 400), idle(program));
    expect(turn).toMatchObject({ kind: 'act', action: { kind: 'turn', side: 'right' }, exec: { running: 0, due: [415, 400] } });
  });

  it('fires only when idle: a running stack is never interrupted', () => {
    const program = b.program({ stacks: [b.when(b.morning(), b.wait(30)), b.when(b.every(5), b.move())] });
    expect(decideTurn(at(BASE, 400), running(program))).toMatchObject({ kind: 'act', action: { kind: 'wait', minutes: 30 }, wakeCost: 0, events: [] });
  });

  it('charges the wake scaled by size and the efficient core', () => {
    const program = b.program({ stacks: [b.when(b.every(5), b.turn('right'))] });
    const cases: readonly [Partial<Robot>, number][] = [
      [{ size: 'mini' }, 1],
      [{ size: 'standard' }, 2],
      [{ size: 'big' }, 4],
      [{ size: 'big', parts: ['efficientCore'] }, 3],
    ];
    for (const [body, cost] of cases) expect(decideTurn(at(BASE, 365), idle(program, body))).toMatchObject({ kind: 'act', wakeCost: cost });
  });

  it('finishes at once when the woken stack holds no action, keeping what it did', () => {
    const program = b.program({ vars: [b.numVar('x', 0)], stacks: [b.when(b.every(15), b.set('x', b.n(7)))] });
    const robot = idle(program);
    expect(decideTurn(at(BASE, 375), robot)).toEqual({
      kind: 'finish',
      exec: { ...execOf(robot), due: [390], vars: [{ type: 'number', value: 7 }] },
      wakeCost: 1,
      events: [{ kind: 'woke', trigger: { kind: 'every', minutes: 15 } }],
    });
  });
});

describe('morningExec', () => {
  it('starts the first morning stack, or stays idle without one', () => {
    const program = b.program({ stacks: [b.when(b.atTime(600), b.turn('left')), b.when(b.morning(), b.move()), b.when(b.morning(), b.turn('right'))] });
    expect(morningExec(program)).toEqual(startStack(freshExec(program), 1));
    const none = b.program({ stacks: [b.when(b.every(30), b.move())] });
    expect(morningExec(none)).toEqual(freshExec(none));
  });
});

describe('log text for the language', () => {
  const entry = (event: RobotLogEvent): RobotLogEntry => ({ id: 0, day: 0, minute: 400, robotId: 1, tx: 5, tz: 10, event, count: 1 });
  const names = new Map([[1, 'Sprocket']]);
  const lines = (event: RobotLogEvent): [string, string] => [robotSays(entry(event)), whatHappened(entry(event), names)];

  it('names every card and trigger in plain words', () => {
    expect([LEAVE_A, NO_WATER, SPARE_PARSNIPS, KEEP_PARSNIPS, TO_GENERATOR, returnTo(5, 13, 1095)].map(mdCardText)).toEqual([
      'leave Zone A',
      'go into water',
      'harvest Parsnip',
      'deposit Parsnip',
      'return to the nearest generator at 6:00 pm',
      'return to (5, 13) at 6:15 pm',
    ]);
    expect([downWhen({ kind: 'bagFull' }), downWhen({ kind: 'tokensBelow', n: 20 }), downWhen({ kind: 'raining' })].map(mdCardText)).toEqual([
      'power down when my bag is full',
      'power down when I have fewer than 20 tokens',
      'power down when it rains',
    ]);
    expect([b.morning(), b.atTime(845), b.bagFull(), b.startsRaining(), b.every(15)].map(triggerText)).toEqual([
      'morning came',
      "it's 2:05 pm",
      'my bag is full',
      'it started raining',
      'every 15 minutes',
    ]);
  });

  it('gives every new event both lines', () => {
    expect(lines({ kind: 'skipped', action: 'move', card: LEAVE_A })).toEqual(['Following my rules ✓', "Skipped move: my .MD says don't leave Zone A."]);
    expect(lines({ kind: 'dizzy' })).toEqual(['Thinking very hard ✓', 'Looped without doing anything, and got dizzy. Off until morning.']);
    expect(lines({ kind: 'gaveUp', target: { tx: 5, tz: 13 }, why: 'goTo' })).toEqual(['Took a scenic route ✓', "Couldn't find a way to (5, 13), so gave up going there."]);
    expect(lines({ kind: 'woke', trigger: b.every(15) })).toEqual(['Up and at it ✓', 'Woke up: every 15 minutes.']);
    expect(lines({ kind: 'doReturn', card: TO_GENERATOR, phase: 'started' })).toEqual([
      'Heading home ✓',
      'My .MD says return to the nearest generator at 6:00 pm, so I stopped my program and set off.',
    ]);
    expect(lines({ kind: 'doReturn', card: TO_GENERATOR, phase: 'arrived' })).toEqual(['Home safe ✓', 'Got there and powered down for the day.']);
    expect(lines({ kind: 'doReturn', card: TO_GENERATOR, phase: 'failed' })).toEqual([
      'Home safe ✓',
      "Couldn't get there (no generator I could reach), so powered down where I was.",
    ]);
    expect(lines({ kind: 'doReturn', card: returnTo(5, 13), phase: 'failed' })[1]).toBe("Couldn't get there (no way through), so powered down where I was.");
    expect(lines({ kind: 'doPowerDown', card: downWhen({ kind: 'raining' }) })).toEqual([
      'Powering down ✓',
      'Powered down for the day: my .MD says power down when it rains.',
    ]);
    expect(lines({ kind: 'conflict', doCard: returnTo(5, 14), dontCard: LEAVE_A })).toEqual([
      'Following my rules ✓',
      "My .MD says return to (5, 14) at 6:00 pm, but it also says don't leave Zone A. Don't wins.",
    ]);
  });

  it('saves and loads every new event, and rejects a malformed one', () => {
    const events: readonly RobotLogEvent[] = [
      { kind: 'skipped', action: 'harvest', card: SPARE_PARSNIPS },
      { kind: 'dizzy' },
      { kind: 'gaveUp', target: { tx: 5, tz: 13 }, why: 'forEach' },
      { kind: 'woke', trigger: b.atTime(600) },
      { kind: 'doReturn', card: TO_GENERATOR, phase: 'started' },
      { kind: 'doPowerDown', card: downWhen({ kind: 'tokensBelow', n: 5 }) },
      { kind: 'conflict', doCard: returnTo(5, 14), dontCard: LEAVE_A },
    ];
    const logOf = (list: readonly RobotLogEvent[]): GameState => list.reduce((s, e) => logRobotEvent(s, 1, e), withRobots(BASE, [robotOf()]));
    const state = logOf(events);
    expect(deserializeGame(serializeGame(state))).toEqual(state);
    expect(deserializeGame(serializeGame(logOf([{ kind: 'skipped', action: 'move', card: returnTo(5, 13) }])))).toBeNull();
    expect(deserializeGame(serializeGame(logOf([{ kind: 'gaveUp', target: { tx: 99, tz: 0 }, why: 'goTo' }])))).toBeNull();
    expect(deserializeGame(serializeGame(logOf([{ kind: 'conflict', doCard: LEAVE_A, dontCard: LEAVE_A }])))).toBeNull();
  });
});
