/**
 * Triggers and the robot's day through real minutes (farmclaws part 2 spec §7): the morning
 * reset, waking only when idle, the wake's cost, going flat on a wake, the `every` cadence,
 * dizzy robots, and save round trips mid-program (review focus 1 and 4).
 */
import { describe, expect, it } from 'vitest';
import { Weather, type BlockProgram, type GameState, type Robot } from '../src/core/types';
import { b } from '../src/robots/blocks';
import { freshExec, morningExec } from '../src/robots/exec';
import { requireRobot } from '../src/robots/world';
import { actions } from '../src/state/actions';
import { deserializeGame, serializeGame } from '../src/state/persistence';
import { gameReducer } from '../src/state/reducer';
import { BASE, must, robotOf, withRobots } from './testUtils';

const tick = (state: GameState, minutes: number): GameState => gameReducer(state, actions.tick(minutes));
const sleep = (state: GameState): GameState => gameReducer(state, actions.sleep());
const kinds = (state: GameState): string[] => state.robots.log.entries.map((e) => e.event.kind);
/** Minutes at which the robot logged `kind`. */
const minutesOf = (state: GameState, kind: string): number[] => state.robots.log.entries.filter((e) => e.event.kind === kind).map((e) => e.minute);

function worker(program: BlockProgram, overrides: Partial<Robot> = {}): Robot {
  return robotOf({ program, exec: morningExec(program), ...overrides });
}

const SPINNER = b.program({ stacks: [b.when(b.morning(), b.turn('right'))] });

function idle(program: BlockProgram, overrides: Partial<Robot> = {}): Robot {
  return robotOf({ program, exec: freshExec(program), power: 'standby', ...overrides });
}

describe('the morning reset', () => {
  it('starts the first morning stack, re-arms triggers and turns robots back on', () => {
    const program = b.program({ vars: [b.numVar('n', 3)], stacks: [b.when(b.atTime(600), b.turn('left')), b.when(b.morning(), b.move())] });
    const tired = idle(program, { off: 'dizzy', exec: { ...freshExec(program), vars: [{ type: 'number', value: 9 }], due: [null], doneCards: [1] } });
    const morning = sleep(withRobots(BASE, [tired]));
    expect(requireRobot(morning, 1)).toMatchObject({ power: 'working', off: null, exec: morningExec(program), pc: 0 });
    expect(must(requireRobot(morning, 1).exec).running).toBe(1);
  });

  it('leaves a robot with no morning stack idle on standby, and a flat one flat', () => {
    const program = b.program({ stacks: [b.when(b.every(30), b.move())] });
    const morning = sleep(withRobots(BASE, [worker(program), worker(program, { id: 2, name: 'Bolt', tokens: 0, power: 'flat' })]));
    expect(requireRobot(morning, 1)).toMatchObject({ power: 'standby', exec: freshExec(program) });
    expect(requireRobot(morning, 2).power).toBe('flat');
  });
  it('keeps a robot whose morning changed nothing by reference (render contract)', () => {
    const program = b.program({ stacks: [b.when(b.every(30), b.move())] });
    const once = sleep(withRobots(BASE, [worker(program), worker(SPINNER, { id: 2, name: 'Bolt' })]));
    const twice = sleep(once);
    expect(requireRobot(twice, 1)).toBe(requireRobot(once, 1));
    expect(requireRobot(twice, 2)).toBe(requireRobot(once, 2));
  });
});

describe('waking', () => {
  const EVERY_15 = b.program({ stacks: [b.when(b.every(15), b.turn('right'))] });

  it('checks on its schedule for free, wakes when due, pays the wake and acts that same minute', () => {
    const next = tick(withRobots(BASE, [idle(EVERY_15)]), 16);
    expect(kinds(next)).toEqual(['woke', 'did']);
    expect(minutesOf(next, 'woke')).toEqual([376]);
    expect(requireRobot(next, 1)).toMatchObject({ power: 'working', tokens: 78, tokensToday: 2, actionSeq: 1 });
    expect(must(requireRobot(next, 1).exec).due).toEqual([391]);
  });

  it('keeps the every cadence over an hour: wake, act, finish, wait for the next due', () => {
    const next = tick(withRobots(BASE, [idle(EVERY_15)]), 60);
    expect(minutesOf(next, 'woke')).toEqual([376, 392, 408]);
    expect(kinds(next)).toEqual(['woke', 'did', 'finished', 'woke', 'did', 'finished', 'woke', 'did', 'finished']);
    expect(requireRobot(next, 1)).toMatchObject({ power: 'standby', tokens: 74, tokensToday: 6, nextActMinute: 424 });
    expect(must(requireRobot(next, 1).exec).due).toEqual([423]);
  });

  it('never interrupts a running stack: the trigger fires once the robot is idle', () => {
    const program = b.program({ stacks: [b.when(b.morning(), b.wait(30), b.turn('left')), b.when(b.every(5), b.turn('right'))] });
    const next = tick(withRobots(BASE, [worker(program)]), 60);
    expect(minutesOf(next, 'finished')).toEqual([398, 406, 414]);
    expect(minutesOf(next, 'woke')).toEqual([402, 410, 418]);
  });

  it('wakes from a Power down block when a trigger fires', () => {
    const program = b.program({ stacks: [b.when(b.morning(), b.powerDown()), b.when(b.atTime(400), b.turn('right'))] });
    const next = tick(withRobots(BASE, [worker(program)]), 44);
    expect(kinds(next)).toEqual(['poweredDown', 'woke', 'did', 'finished']);
    expect(minutesOf(next, 'woke')).toEqual([400]);
  });

  it('wakes once a day on a full bag and when it starts raining', () => {
    const program = b.program({ stacks: [b.when(b.bagFull(), b.turn('right')), b.when(b.startsRaining(), b.turn('left'))] });
    const robot = idle(program, { bag: [{ itemId: 'parsnip', quantity: 1, quality: 0 }] });
    const next = tick({ ...withRobots(BASE, [robot]), weather: Weather.Rain }, 60);
    expect(minutesOf(next, 'woke')).toEqual([364, 372]);
    expect(must(requireRobot(next, 1).exec).firedToday).toEqual([true, true]);
  });

  it('goes flat on a wake it cannot pay, commits nothing and never wakes for free (review focus 4)', () => {
    const program = b.program({ stacks: [b.when(b.every(5), b.turn('right'))] });
    const robot = idle(program, { tokens: 0 });
    const next = tick(withRobots(BASE, [robot]), 8);
    expect(requireRobot(next, 1)).toMatchObject({ power: 'flat', tokens: 0, actionSeq: 0 });
    expect(requireRobot(next, 1).exec).toEqual(robot.exec);
    expect(kinds(next)).toEqual(['flat']);
    expect(next.messages.entries.at(-1)?.text).toBe('Sprocket ran out of power.');
    expect(kinds(tick(next, 60))).toEqual(['flat']);
  });

  it('needs the wake and the action together: one token short goes flat', () => {
    const program = b.program({ stacks: [b.when(b.every(5), b.turn('right'))] });
    const next = tick(withRobots(BASE, [idle(program, { tokens: 1 })]), 8);
    expect(requireRobot(next, 1)).toMatchObject({ power: 'flat', tokens: 1 });
    expect(must(requireRobot(next, 1).exec).due).toEqual([365]);
  });
});

describe('ending the stack', () => {
  it('a finished program goes to standby and says so', () => {
    const program = b.program({ stacks: [b.when(b.morning(), b.turn('right'))] });
    const next = tick(withRobots(BASE, [worker(program)]), 8);
    expect(requireRobot(next, 1)).toMatchObject({ power: 'standby', nextActMinute: 372 });
    expect(kinds(next)).toEqual(['did', 'finished']);
  });

  it('a dizzy robot is toasted, stays off all day and is back next morning', () => {
    const program = b.program({ vars: [b.numVar('x', 0)], stacks: [b.when(b.morning(), b.forever(b.set('x', b.n(1))))] });
    const robot = worker(program);
    const next = tick(withRobots(BASE, [robot]), 4);
    expect(requireRobot(next, 1)).toMatchObject({ off: 'dizzy', power: 'working', tokens: 80, exec: robot.exec });
    expect(kinds(next)).toEqual(['dizzy']);
    expect(next.messages.entries.at(-1)).toMatchObject({ text: 'Sprocket got dizzy going round in circles.', tone: 'warn' });
    const later = tick(next, 120);
    expect(requireRobot(later, 1)).toBe(requireRobot(next, 1));
    expect(requireRobot(sleep(later), 1)).toMatchObject({ off: null, power: 'working', exec: morningExec(program) });
  });
});

describe('saving mid-program (review focus 1)', () => {
  const roundTrip = (state: GameState): void => {
    expect(deserializeGame(serializeGame(state))).toEqual(state);
  };
  const run = (robot: Robot, minutes: number): GameState => tick(withRobots(BASE, [robot]), minutes);

  it('loads mid-loop, mid-route and mid-helper to an identical state', () => {
    const loop = run(worker(b.program({ stacks: [b.when(b.morning(), b.repeat(5, b.turn('right')))] })), 8);
    expect(must(requireRobot(loop, 1).exec).frames.some((f) => f.kind === 'list' && f.loop?.kind === 'times')).toBe(true);
    roundTrip(loop);

    const route = run(worker(b.program({ stacks: [b.when(b.morning(), b.goTo(b.tileAt(5, 15)))] })), 8);
    expect(must(requireRobot(route, 1).exec).frames.at(-1)?.kind).toBe('route');
    roundTrip(route);

    const helper = b.program({ stacks: [b.when(b.morning(), b.run('spin'))], helpers: [b.helper('spin', b.turn('right'), b.turn('right'), b.turn('right'))] });
    const inHelper = run(worker(helper), 8);
    expect(must(requireRobot(inHelper, 1).exec).frames.at(-1)).toMatchObject({ kind: 'list', list: { root: 'helper', index: 0 } });
    roundTrip(inHelper);
  });

  it('loads during a DO return, dizzy, done, and idle with a pending every trigger', () => {
    const spin = b.program({ stacks: [b.when(b.morning(), b.forever(b.turn('right')))] });
    const returning = run(worker(spin, { md: [{ kind: 'doReturn', to: { kind: 'tile', tx: 5, tz: 15 }, minute: 360 }] }), 8);
    expect(must(requireRobot(returning, 1).exec).frames).toMatchObject([{ kind: 'route', why: 'doReturn' }]);
    roundTrip(returning);

    const dizzy = run(worker(b.program({ vars: [b.numVar('x', 0)], stacks: [b.when(b.morning(), b.forever(b.set('x', b.n(1))))] })), 4);
    expect(requireRobot(dizzy, 1).off).toBe('dizzy');
    roundTrip(dizzy);

    const done = run(worker(spin, { tokens: 79, md: [{ kind: 'doPowerDown', when: { kind: 'tokensBelow', n: 80 } }] }), 4);
    expect(requireRobot(done, 1).off).toBe('done');
    roundTrip(done);

    const waiting = run(idle(b.program({ stacks: [b.when(b.every(30), b.turn('right'))] })), 8);
    expect(must(requireRobot(waiting, 1).exec).due).toEqual([390]);
    roundTrip(waiting);
  });
});
