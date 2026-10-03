/**
 * Bumps (farmclaws part 3 spec §3.1): robots no longer pass through each other. Same-target,
 * swap and into-a-standing-robot bumps, decided from the start of the minute whatever the ids; a
 * line of robots moving the same way moves as one; the forgotten stack; the log, toast and texts;
 * `tile ahead is blocked` seeing robots; put-down, drop-off and morning moves avoiding robots;
 * the `pair` dev preset (plan review focus 2).
 */
import { describe, expect, it } from 'vitest';
import { ROBOTS } from '../src/config';
import { Blocker, Direction, TileState, type GameState, type Robot, type RobotAction, type RobotLogEvent } from '../src/core/types';
import { presetSpecs } from '../src/dev/robotDev';
import { b } from '../src/robots/blocks';
import { findBumps, forgetRunningStack } from '../src/robots/bumps';
import { addRobot } from '../src/robots/create';
import { evaluate } from '../src/robots/eval';
import { robotSays, whatHappened } from '../src/robots/logText';
import { nearestFreeWalkable, requireRobot } from '../src/robots/world';
import { actions } from '../src/state/actions';
import { deserializeGame, serializeGame } from '../src/state/persistence';
import { gameReducer } from '../src/state/reducer';
import { isValidExec } from '../src/state/robotValidation';
import { blockedTile } from '../src/world/tiles';
import { programmed } from './programGen';
import { BASE, TARGET, matureCrop, robotOf, soilTile, withPlayer, withRobots, withTile, type SaveJson } from './testUtils';

const ROW = 12;
const script = (steps: RobotAction[]): Robot['program'] => ({ kind: 'script', steps, loop: true });
const MOVER = script([{ kind: 'move' }]);
const SPINNER = script([{ kind: 'turn', side: 'right' }]);
const NAMES = ['Sprocket', 'Bolt', 'Cog', 'Dot'] as const;

/** A Mini on row 12 at `tx`, facing `facing`, running `program` (moving forward by default). */
function bot(id: number, tx: number, facing: Direction, overrides: Partial<Robot> = {}): Robot {
  return robotOf({ id, name: NAMES[id - 1] ?? `R${id}`, tx, tz: ROW, facing, program: MOVER, ...overrides });
}

/** The robots on the farm, in id order (the list is kept ascending). */
const farmWith = (robots: readonly Robot[], base: GameState = BASE): GameState => withRobots(base, [...robots].sort((a, c) => a.id - c.id));
const tick = (state: GameState, minutes: number = ROBOTS.period): GameState => gameReducer(state, actions.tick(minutes));
const sleep = (state: GameState): GameState => gameReducer(state, actions.sleep());
const eventsOf = (state: GameState, id: number): RobotLogEvent[] => state.robots.log.entries.filter((e) => e.robotId === id).map((e) => e.event);
const texts = (state: GameState): string[] => state.messages.entries.map((m) => m.text);
const at = (state: GameState, id: number): [number, number] => {
  const robot = requireRobot(state, id);
  return [robot.tx, robot.tz];
};
const loadedFrom = (state: GameState): GameState => ({ ...state, ui: { ...state.ui, panel: { kind: 'none' }, paused: false } });

describe('who bumps', () => {
  it.each([
    ['the leader has the lower id', 1, 2],
    ['the leader has the higher id', 2, 1],
  ])('moves a convoy as one when %s', (_label, leader, follower) => {
    const tail = 3;
    const state = farmWith([bot(leader, 5, Direction.East), bot(follower, 4, Direction.East), bot(tail, 3, Direction.East)]);
    const next = tick(state);
    expect([at(next, leader), at(next, follower), at(next, tail)]).toEqual([
      [6, ROW],
      [5, ROW],
      [4, ROW],
    ]);
    for (const id of [1, 2, 3]) expect(requireRobot(next, id)).toMatchObject({ off: null, lastAction: { seq: 1, kind: 'move', success: true, bickered: false } });
    expect(next.robots.log.entries.some((e) => e.event.kind === 'crashed')).toBe(false);
  });

  it('bumps every robot moving onto the same tile, each into the lowest other id', () => {
    const state = farmWith([bot(1, 4, Direction.East), bot(2, 6, Direction.West), robotOf({ id: 3, name: 'Cog', tx: 5, tz: ROW - 1, facing: Direction.South, program: MOVER })]);
    const next = tick(state);
    expect([at(next, 1), at(next, 2), at(next, 3)]).toEqual([
      [4, ROW],
      [6, ROW],
      [5, ROW - 1],
    ]);
    expect(eventsOf(next, 1)).toEqual([{ kind: 'crashed', withId: 2, forgot: null }]);
    expect(eventsOf(next, 2)).toEqual([{ kind: 'crashed', withId: 1, forgot: null }]);
    expect(eventsOf(next, 3)).toEqual([{ kind: 'crashed', withId: 1, forgot: null }]);
  });

  it('bumps two robots that would swap tiles, into each other', () => {
    const next = tick(farmWith([bot(1, 4, Direction.East), bot(2, 5, Direction.West)]));
    expect([at(next, 1), at(next, 2)]).toEqual([
      [4, ROW],
      [5, ROW],
    ]);
    expect(eventsOf(next, 1)).toEqual([{ kind: 'crashed', withId: 2, forgot: null }]);
    expect(eventsOf(next, 2)).toEqual([{ kind: 'crashed', withId: 1, forgot: null }]);
  });

  it('bumps a robot moving into one that stays, and leaves the one it bumped into alone', () => {
    const spinner = bot(2, 5, Direction.North, { program: SPINNER });
    const next = tick(farmWith([bot(1, 4, Direction.East), spinner]));
    expect(at(next, 1)).toEqual([4, ROW]);
    expect(requireRobot(next, 2)).toMatchObject({ tx: 5, tz: ROW, facing: Direction.East, off: null, tokens: 79, lastAction: { kind: 'turn', success: true } });
    expect(eventsOf(next, 1)).toEqual([{ kind: 'crashed', withId: 2, forgot: null }]);
    expect(eventsOf(next, 2)).toEqual([{ kind: 'did', action: 'turn', detail: { kind: 'none' } }]);
  });

  it.each([
    ['the robot that stays has the lowest id', [3, 1, 2]],
    ['the robot that stays has the highest id', [1, 2, 3]],
  ] as const)('bumps a whole line behind a robot that stays, whatever the ids, when %s', (_label, [stays, near, far]) => {
    const state = farmWith([bot(stays, 6, Direction.East, { power: 'standby' }), bot(near, 5, Direction.East), bot(far, 4, Direction.East)]);
    const next = tick(state);
    expect([at(next, stays), at(next, near), at(next, far)]).toEqual([
      [6, ROW],
      [5, ROW],
      [4, ROW],
    ]);
    expect(eventsOf(next, near)).toEqual([{ kind: 'crashed', withId: stays, forgot: null }]);
    expect(eventsOf(next, far)).toEqual([{ kind: 'crashed', withId: near, forgot: null }]);
    expect(eventsOf(next, stays)).toEqual([]);
  });

  it('bumps into broken robots in the water but never into carried or repairing ones', () => {
    const pond = withTile(BASE, { tx: 5, tz: ROW }, blockedTile(Blocker.Water), 'farm');
    const sunk = tick(farmWith([bot(1, 4, Direction.East), bot(2, 5, Direction.North, { power: 'broken' })], pond));
    expect(requireRobot(sunk, 1)).toMatchObject({ tx: 4, power: 'working', off: 'dizzy' });
    const away = tick(farmWith([bot(1, 4, Direction.East), bot(2, 5, Direction.North, { power: 'repairing', repairReadyDay: 1 })]));
    expect(at(away, 1)).toEqual([5, ROW]);
    const carriedOff = { ...BASE, player: { ...BASE.player, carrying: 2 } };
    const held = tick(farmWith([bot(1, 4, Direction.East), bot(2, 5, Direction.North, { carried: true })], carriedOff));
    expect(at(held, 1)).toEqual([5, ROW]);
  });

  it('lets a robot walk out of a tile it shares with another: moving out is never a bump', () => {
    const state = farmWith([bot(1, 5, Direction.East), bot(2, 5, Direction.North, { program: SPINNER })]);
    const next = tick(state);
    expect([at(next, 1), at(next, 2)]).toEqual([
      [6, ROW],
      [5, ROW],
    ]);
    expect(requireRobot(next, 1).off).toBeNull();
  });

  it('findBumps reads the start-of-minute positions and repeats the rule until nothing changes', () => {
    const state = farmWith([bot(1, 4, Direction.East), bot(2, 5, Direction.East), bot(3, 7, Direction.West)]);
    const convoy = [
      { id: 1, from: { tx: 4, tz: ROW }, to: { tx: 5, tz: ROW } },
      { id: 2, from: { tx: 5, tz: ROW }, to: { tx: 6, tz: ROW } },
    ];
    expect(findBumps(state, convoy).size).toBe(0);
    // Robot 3 heads for the same tile as robot 2: both bump, and then robot 1 bumps into robot 2.
    const meeting = [...convoy, { id: 3, from: { tx: 7, tz: ROW }, to: { tx: 6, tz: ROW } }];
    expect([...findBumps(state, meeting)]).toEqual([
      [2, 3],
      [3, 2],
      [1, 2],
    ]);
  });
});

describe('what a bump does', () => {
  it('pays the move, settles as a failure, and leaves the robot dizzy until morning', () => {
    const next = tick(farmWith([bot(1, 4, Direction.East), bot(2, 6, Direction.West)]));
    const robot = requireRobot(next, 1);
    expect(robot).toMatchObject({ tx: 4, tz: ROW, tokens: 79, off: 'dizzy', power: 'working', actionSeq: 1, moveSeq: 0 });
    expect(robot.lastAction).toEqual({ seq: 1, kind: 'move', success: false, bickered: false });
    expect(robot.stats.today).toEqual({ tokens: 1, actions: 1, crops: 0 });
    // Off until morning: nothing more happens today.
    const later = tick(next, 60);
    expect(requireRobot(later, 1)).toBe(requireRobot(next, 1));
    const morning = sleep(later);
    expect(requireRobot(morning, 1).off).toBeNull();
  });

  it('toasts each bump, and the log tells the truth while the robot stays cheerful', () => {
    const next = tick(farmWith([bot(1, 4, Direction.East), bot(2, 6, Direction.West)]));
    expect(texts(next).slice(-2)).toEqual(['Sprocket bumped into Bolt and got dizzy.', 'Bolt bumped into Sprocket and got dizzy.']);
    const names = new Map(next.robots.list.map((r) => [r.id, r.name]));
    const entry = next.robots.log.entries[0];
    if (entry === undefined) throw new Error('expected a log entry');
    expect(robotSays(entry)).toBe('Made a new friend ✓');
    expect(whatHappened(entry, names)).toBe('Bumped into Bolt and got dizzy.');
    const forgot = { ...entry, event: { kind: 'crashed' as const, withId: 2, forgot: { kind: 'atTime' as const, minute: 840 } } };
    expect(whatHappened(forgot, names)).toBe('Bumped into Bolt and got dizzy. Forgot everything under "When it\'s 2:00 pm".');
    expect(robotSays(forgot)).toBe('Made a new friend ✓');
  });

  it('routes into a robot that stands still and bumps: the running stack is forgotten, its When kept', () => {
    const program = b.program({ stacks: [b.when(b.morning(), b.goTo(b.tileAt(8, ROW)))] });
    const router = programmed(bot(1, 4, Direction.East), program);
    const state = farmWith([router, bot(2, 6, Direction.North, { power: 'standby' })]);
    const next = tick(state, 12);
    const robot = requireRobot(next, 1);
    expect(at(next, 1)).toEqual([5, ROW]);
    expect(robot.off).toBe('dizzy');
    expect(robot.program).toEqual(b.program({ stacks: [b.when(b.morning())] }));
    expect(robot.exec).toMatchObject({ running: null, frames: [] });
    expect(eventsOf(next, 1).at(-1)).toEqual({ kind: 'crashed', withId: 2, forgot: { kind: 'morning' } });
    expect(texts(next).at(-1)).toBe('Sprocket bumped into Bolt and forgot what to do when morning came.');
  });

  it('forgets only the running stack: variables, other stacks, helpers and the .MD stay, and the exec stays aligned', () => {
    const program = b.program({
      vars: [b.numVar('laps', 0)],
      stacks: [b.when(b.atTime(720), b.run('spin')), b.when(b.morning(), b.forever(b.change('laps', 1), b.move())), b.when(b.every(30), b.turn('left'))],
      helpers: [b.helper('spin', b.turn('right'))],
    });
    const robot = programmed(bot(1, 4, Direction.East), program, [{ kind: 'dontGoIntoWater' }]);
    const state = farmWith([robot, bot(2, 5, Direction.North, { power: 'standby' })]);
    const next = tick(state);
    const after = requireRobot(next, 1);
    if (after.program.kind !== 'blocks' || after.exec === null) throw new Error('expected a block robot');
    expect(after.program.stacks[1]).toEqual({ trigger: { kind: 'morning' }, body: [] });
    expect(after.program.stacks[0]).toBe(program.stacks[0]);
    expect(after.program.stacks[2]).toBe(program.stacks[2]);
    expect(after.program.vars).toBe(program.vars);
    expect(after.program.helpers).toBe(program.helpers);
    expect(after.md).toBe(robot.md);
    expect(after.exec.due).toHaveLength(3);
    expect(after.exec.firedToday).toHaveLength(3);
    expect(isValidExec(after.exec, after.program)).toBe(true);
    expect(eventsOf(next, 1)).toEqual([{ kind: 'crashed', withId: 2, forgot: { kind: 'morning' } }]);
    expect(deserializeGame(serializeGame(next))).toEqual(loadedFrom(next));
    // The next morning finds the emptied stack: the robot starts it, finishes at once and idles.
    const morning = tick(sleep(next));
    expect(requireRobot(morning, 1)).toMatchObject({ tx: 4, tz: ROW, off: null, power: 'standby' });
  });

  it('a script robot, or one walking home on a DO return, forgets nothing', () => {
    const scripted = tick(farmWith([bot(1, 4, Direction.East), bot(2, 5, Direction.North, { power: 'standby' })]));
    expect(requireRobot(scripted, 1).program).toBe(MOVER);
    expect(eventsOf(scripted, 1)).toEqual([{ kind: 'crashed', withId: 2, forgot: null }]);

    const spin = b.program({ stacks: [b.when(b.morning(), b.forever(b.turn('right')))] });
    const homeward = programmed(bot(1, 4, Direction.East), spin, [{ kind: 'doReturn', to: { kind: 'tile', tx: 8, tz: ROW }, minute: 360 }]);
    const returning = tick(farmWith([homeward, bot(2, 5, Direction.North, { power: 'standby' })]));
    const robot = requireRobot(returning, 1);
    expect(robot.program).toBe(spin);
    expect(robot).toMatchObject({ tx: 4, off: 'dizzy', exec: { running: null, frames: [] } });
    expect(eventsOf(returning, 1).at(-1)).toEqual({ kind: 'crashed', withId: 2, forgot: null });
  });

  it('forgetRunningStack keeps the robot itself when nothing runs', () => {
    const idle = programmed(bot(1, 4, Direction.East), b.program({ stacks: [b.when(b.atTime(720), b.move())] }));
    expect(forgetRunningStack(idle)).toEqual({ robot: idle, forgot: null });
    expect(forgetRunningStack(idle).robot).toBe(idle);
    const scripted = bot(1, 4, Direction.East);
    expect(forgetRunningStack(scripted).robot).toBe(scripted);
  });

  it('saves the crashed event and rejects a corrupted one', () => {
    const next = tick(farmWith([bot(1, 4, Direction.East), bot(2, 6, Direction.West)]));
    expect(deserializeGame(serializeGame(next))).toEqual(loadedFrom(next));
    const corrupt = (edit: (event: SaveJson) => void): GameState | null => {
      const save = JSON.parse(serializeGame(next)) as SaveJson;
      const entries = ((save.robots as SaveJson).log as SaveJson).entries as SaveJson[];
      const first = entries[0];
      if (first === undefined) throw new Error('expected a log entry');
      edit(first.event as SaveJson);
      return deserializeGame(JSON.stringify(save));
    };
    expect(corrupt((e) => void (e.withId = 0))).toBeNull();
    expect(corrupt((e) => void (e.forgot = { kind: 'atTime', minute: 5 }))).toBeNull();
    expect(corrupt((e) => void delete e.forgot)).toBeNull();
    expect(corrupt((e) => void (e.forgot = { kind: 'every', minutes: 15 }))).not.toBeNull();
  });
});

describe('seeing and avoiding robots', () => {
  it('tile ahead is blocked, and not clear, with a standing robot ahead', () => {
    const program = b.program({ stacks: [b.when(b.morning(), b.move())] });
    const looker = bot(1, 4, Direction.East);
    const sense = (state: GameState, what: 'blocked' | 'clear' | 'water'): boolean => {
      const value = evaluate(b.tileAheadIs(what), { state, robot: looker, program, vars: [] });
      return value.type === 'yesNo' && value.value;
    };
    const empty = farmWith([looker]);
    expect([sense(empty, 'blocked'), sense(empty, 'clear'), sense(empty, 'water')]).toEqual([false, true, false]);
    const ahead = farmWith([looker, bot(2, 5, Direction.North, { power: 'flat', tokens: 0 })]);
    expect([sense(ahead, 'blocked'), sense(ahead, 'clear'), sense(ahead, 'water')]).toEqual([true, false, false]);
    const pond = withTile(BASE, { tx: 5, tz: ROW }, blockedTile(Blocker.Water), 'farm');
    const sunk = farmWith([looker, bot(2, 5, Direction.North, { power: 'broken' })], pond);
    expect([sense(sunk, 'blocked'), sense(sunk, 'clear'), sense(sunk, 'water')]).toEqual([true, false, true]);
    const away = farmWith([looker, bot(2, 5, Direction.North, { power: 'repairing', repairReadyDay: 1 })]);
    expect([sense(away, 'blocked'), sense(away, 'clear')]).toEqual([false, true]);
  });

  it('lets a program look before it moves', () => {
    const careful = b.program({ stacks: [b.when(b.morning(), b.forever(b.if(b.tileAheadIs('clear'), [b.move()], [b.turn('right')])))] });
    const next = tick(farmWith([programmed(bot(1, 4, Direction.East, { parts: ['sensorEye'] }), careful), bot(2, 5, Direction.North, { power: 'standby' })]));
    expect(requireRobot(next, 1)).toMatchObject({ tx: 4, facing: Direction.South, off: null });
  });

  it('refuses to put a robot down on a robot', () => {
    const base = withPlayer(BASE, { tx: TARGET.tx, tz: TARGET.tz - 1 }, Direction.South);
    const state = farmWith([robotOf({ id: 1, carried: true }), robotOf({ id: 2, name: 'Bolt' })], { ...base, player: { ...base.player, carrying: 1 } });
    const next = gameReducer(state, actions.interact());
    expect(next.player.carrying).toBe(1);
    expect(texts(next).at(-1)).toBe("There's a robot there.");
  });

  it('drops a repaired robot on the nearest walkable tile with no robot on it', () => {
    const ready = robotOf({ id: 1, power: 'repairing', repairReadyDay: 1, tokens: 0 });
    const parked = robotOf({ id: 2, name: 'Bolt', tx: ROBOTS.repairDropOff.tx, tz: ROBOTS.repairDropOff.tz, power: 'standby' });
    const next = sleep(farmWith([ready, parked]));
    expect(requireRobot(next, 1)).toMatchObject({ power: 'working', tx: 10, tz: 6 });
    expect(at(next, 2)).toEqual([ROBOTS.repairDropOff.tx, ROBOTS.repairDropOff.tz]);
  });

  it('moves a robot off a tile that grew weeds onto a tile with no robot', () => {
    const weeds = withTile(BASE, TARGET, blockedTile(Blocker.Weeds), 'farm');
    const north = { tx: TARGET.tx, tz: TARGET.tz - 1 };
    const next = sleep(farmWith([robotOf({ id: 1 }), robotOf({ id: 2, name: 'Bolt', ...north })], weeds));
    expect(at(next, 1)).toEqual([TARGET.tx + 1, TARGET.tz]);
    expect(at(next, 2)).toEqual([north.tx, north.tz]);
  });

  it('nearestFreeWalkable counts the robot itself as no obstacle', () => {
    const state = farmWith([robotOf({ id: 1 }), robotOf({ id: 2, name: 'Bolt', tx: TARGET.tx + 1 })]);
    expect(nearestFreeWalkable(state, TARGET, 1)).toEqual(TARGET);
    expect(nearestFreeWalkable(state, TARGET, 2)).toEqual({ tx: TARGET.tx, tz: TARGET.tz - 1 });
  });

  it('keeps the pair preset bickering without ever bumping', () => {
    const place = { tx: 5, tz: ROW, facing: Direction.South };
    let state = withTile(BASE, place, soilTile(TileState.Watered, matureCrop('parsnip')), 'farm');
    for (const spec of presetSpecs('pair', place)) {
      const added = addRobot(state, spec);
      if ('error' in added) throw new Error(added.error);
      state = added.state;
    }
    const next = tick(state, 60);
    const kinds = next.robots.log.entries.map((e) => e.event.kind);
    expect(kinds).toContain('bickered');
    expect(kinds).not.toContain('crashed');
    expect(next.robots.list.map((r) => r.off)).toEqual([null, null]);
  });
});
