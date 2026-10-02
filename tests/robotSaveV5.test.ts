/**
 * Save version 5 (farmclaws part 2 spec §10): robots gain exec, md and off, the robots section
 * gains zones; the v4 → v5 migration; round trips of block-program robots in every exec shape
 * the interpreter makes; one corrupted field per validation rule; addRobot with block programs.
 */
import { describe, expect, it } from 'vitest';
import { ROBOTS, TIME } from '../src/config';
import { ZONE_IDS, type BlockProgram, type Frame, type GameState, type MdCard, type Robot, type RobotExec } from '../src/core/types';
import { b } from '../src/robots/blocks';
import { addRobot } from '../src/robots/create';
import { freshExec } from '../src/robots/exec';
import { requireRobot } from '../src/robots/world';
import { deserializeGame, migrateSave, serializeGame } from '../src/state/persistence';
import { isValidExec } from '../src/state/robotValidation';
import saveV2Text from './fixtures/save-v2.json?raw';
import { BASE, must, robotOf, withRobots, withZones, type SaveJson } from './testUtils';

/** A Standard waterer and harvester: four stacks, a helper, two variables. 21 blocks. */
const PROGRAM: BlockProgram = b.program({
  vars: [b.numVar('rows', 3), b.tileVar('home', 5, 10)],
  stacks: [
    b.when(b.morning(), b.repeat(4, b.water(), b.move()), b.forEach('A', b.water()), b.run('turnAround')),
    b.when(b.every(5), b.goTo(b.v('home')), b.say('Home')),
    b.when(b.atTime(720), b.if(b.bagIsFull(), [b.deposit()], [b.harvest()])),
    b.when(b.bagFull(), b.deposit()),
  ],
  helpers: [b.helper('turnAround', b.turn('right'), b.turn('right'))],
});

const MD: readonly MdCard[] = [
  { kind: 'dontLeave', zone: 'A' },
  { kind: 'doReturn', to: { kind: 'generator' }, minute: 1080 },
  { kind: 'doPowerDown', when: { kind: 'tokensBelow', n: 10 } },
];

const ZONE_A = { x0: 3, z0: 9, w: 4, d: 3 };
const SNAKE_A = [
  { tx: 3, tz: 9 },
  { tx: 4, tz: 9 },
  { tx: 5, tz: 9 },
  { tx: 6, tz: 9 },
];

const stackFrame = (index: number, next: number): Frame => ({ kind: 'list', list: { root: 'stack', index, path: [] }, next, loop: null });
const running = (index: number, frames: Frame[]): RobotExec => ({ ...freshExec(PROGRAM), running: index, frames });

/** The exec shapes the interpreter makes, one robot each. */
const EXECS = {
  idleWithEveryDue: freshExec(PROGRAM),
  midRepeat: running(0, [stackFrame(0, 1), { kind: 'list', list: { root: 'stack', index: 0, path: [[0, 'body']] }, next: 1, loop: { kind: 'times', left: 3 } }]),
  midForEach: running(0, [
    stackFrame(0, 2),
    { kind: 'list', list: { root: 'stack', index: 0, path: [[1, 'body']] }, next: 0, loop: { kind: 'forEach', tiles: SNAKE_A, i: 2 } },
    { kind: 'route', target: { tx: 5, tz: 9 }, path: [{ tx: 5, tz: 10 }, { tx: 5, tz: 9 }], why: 'forEach' },
  ]),
  midHelper: running(0, [stackFrame(0, 3), { kind: 'list', list: { root: 'helper', index: 0, path: [] }, next: 1, loop: null }]),
  midRoute: running(1, [stackFrame(1, 1), { kind: 'route', target: { tx: 5, tz: 10 }, path: [], why: 'goTo' }]),
  inElse: running(2, [stackFrame(2, 1), { kind: 'list', list: { root: 'stack', index: 2, path: [[0, 'else']] }, next: 0, loop: null }]),
  doReturn: {
    ...freshExec(PROGRAM),
    due: [null, 905, 720, null],
    firedToday: [false, false, false, true],
    frames: [{ kind: 'route', target: { tx: 9, tz: 13 }, path: [{ tx: 7, tz: 13 }], why: 'doReturn' }],
  },
  done: { ...freshExec(PROGRAM), due: [null, TIME.passOutMinute + 4, null, null], doneCards: [1] },
} satisfies Record<string, RobotExec>;

/** One block robot per exec shape (ids 1 … 8 on row tz 11), dizzy and done robots among them, and a script robot (id 9). */
function lively(): GameState {
  const shapes = Object.values(EXECS);
  const robots: Robot[] = shapes.map((exec, i) =>
    robotOf({ id: i + 1, name: `R${i + 1}`, size: 'standard', parts: ['claw', 'wateringHead'], tank: 20, tx: 2 + i, tz: 11, program: PROGRAM, exec, md: MD }),
  );
  const at = (id: number, overrides: Partial<Robot>) => robots.map((r) => (r.id === id ? { ...r, ...overrides } : r));
  let list = at(1, { power: 'standby' });
  list = list.map((r) => (r.id === 2 ? { ...r, off: 'dizzy' as const } : r));
  list = list.map((r) => (r.id === 8 ? { ...r, power: 'standby' as const, off: 'done' as const } : r));
  list = [...list, robotOf({ id: 9, name: 'Scripty', tx: 2, tz: 12 })];
  return withZones(withRobots(BASE, list), { A: ZONE_A, C: { x0: 0, z0: 0, w: 48, d: 40 } });
}

const loadedFrom = (state: GameState): GameState => ({ ...state, ui: { ...state.ui, panel: { kind: 'none' }, paused: false } });

/** Serialises `state`, lets `edit` change the parsed JSON, and loads it again. */
function corrupt(state: GameState, edit: (save: SaveJson) => void): GameState | null {
  const save = JSON.parse(serializeGame(state)) as SaveJson;
  edit(save);
  return deserializeGame(JSON.stringify(save));
}

type RobotJson = SaveJson & { program: SaveJson; exec: SaveJson & { frames: SaveJson[]; vars: SaveJson[]; due: unknown[]; firedToday: unknown[]; doneCards: unknown[] }; md: SaveJson[] };
const robotsOf = (save: SaveJson) => save.robots as SaveJson & { list: RobotJson[]; zones: SaveJson };
/** The saved robot with `id` (ids are 1-based and contiguous in lively()). */
const robot = (save: SaveJson, id: number): RobotJson => must(robotsOf(save).list[id - 1]);
const frame = (save: SaveJson, id: number, index: number): SaveJson => must(robot(save, id).exec.frames[index]);

describe('save version 5', () => {
  it('starts a new game with every zone empty', () => {
    expect(BASE.robots.zones).toEqual({ A: null, B: null, C: null, D: null, E: null, F: null, G: null, H: null });
  });

  it('builds a fresh exec from the program', () => {
    expect(EXECS.idleWithEveryDue).toEqual({
      running: null,
      frames: [],
      vars: [
        { type: 'number', value: 3 },
        { type: 'tile', value: { tx: 5, tz: 10 } },
      ],
      due: [null, TIME.dayStartMinute + 5, 720, null],
      firedToday: [false, false, false, false],
      doneCards: [],
    });
  });

  it('round-trips block robots in every exec shape, with zones', () => {
    const state = lively();
    for (const exec of Object.values(EXECS)) expect(isValidExec(exec, PROGRAM)).toBe(true);
    expect(deserializeGame(serializeGame(state))).toEqual(loadedFrom(state));
  });

  it('migrates a version-4 save: robots gain exec, md and off, and every zone is empty', () => {
    const state = withRobots(BASE, [robotOf({ id: 1 }), robotOf({ id: 2, name: 'Bolt', power: 'standby', tx: 4, tz: 10 })]);
    const save = JSON.parse(serializeGame(state)) as SaveJson;
    for (const r of robotsOf(save).list as SaveJson[]) {
      delete r.exec;
      delete r.md;
      delete r.off;
    }
    delete (save.robots as SaveJson).zones;
    save.version = 4;
    const migrated = migrateSave(save) as SaveJson;
    expect(migrated.version).toBe(5);
    expect(robotsOf(migrated).list.map((r) => [r.exec, r.md, r.off])).toEqual([
      [null, [], null],
      [null, [], null],
    ]);
    expect(robotsOf(migrated).zones).toEqual(Object.fromEntries(ZONE_IDS.map((id) => [id, null])));
    expect(must(deserializeGame(JSON.stringify(save)))).toEqual(state);
  });

  it('migrates the version-2 fixture through three steps to 5', () => {
    const loaded = must(deserializeGame(saveV2Text));
    expect(loaded.version).toBe(5);
    expect(loaded.robots.list).toEqual([]);
    expect(loaded.robots.zones).toEqual(BASE.robots.zones);
  });

  const rejections: readonly [string, (save: SaveJson) => void][] = [
    ['too few variable values', (s) => void robot(s, 1).exec.vars.pop()],
    ['a variable value of the wrong type', (s) => void (robot(s, 1).exec.vars[0] = { type: 'text', value: '3' })],
    ['a number variable beyond maxNumber', (s) => void (robot(s, 1).exec.vars[0] = { type: 'number', value: ROBOTS.maxNumber + 1 })],
    ['a tile variable off the farm', (s) => void (robot(s, 1).exec.vars[1] = { type: 'tile', value: { tx: 48, tz: 0 } })],
    ['a due list shorter than the stacks', (s) => void robot(s, 1).exec.due.pop()],
    ['a firedToday list shorter than the stacks', (s) => void robot(s, 1).exec.firedToday.pop()],
    ['a due minute on a bagFull stack', (s) => void (robot(s, 1).exec.due[3] = 700)],
    ['an atTime due that is not its own minute', (s) => void (robot(s, 1).exec.due[2] = 721)],
    ['running past the last stack', (s) => void (robot(s, 2).exec.running = 4)],
    ['frames while nothing runs', (s) => void (robot(s, 2).exec.running = null)],
    ['nothing in frames while a stack runs', (s) => void (robot(s, 2).exec.frames = [])],
    ['a list that does not resolve', (s) => void ((frame(s, 2, 1).list as SaveJson).path = [[0, 'then']])],
    ['a helper index past the helpers', (s) => void ((frame(s, 4, 1).list as SaveJson).index = 1)],
    ['next beyond the list length', (s) => void (frame(s, 2, 1).next = 3)],
    ['a loop state on a plain list', (s) => void (frame(s, 6, 1).loop = { kind: 'forever' })],
    ['a loop body without a loop state', (s) => void (frame(s, 2, 1).loop = null)],
    ['a loop state of the wrong kind', (s) => void (frame(s, 2, 1).loop = { kind: 'until' })],
    ['times.left beyond maxRepeatTimes', (s) => void (frame(s, 2, 1).loop = { kind: 'times', left: ROBOTS.maxRepeatTimes + 1 })],
    ['a For each tile off the farm', (s) => void (((frame(s, 3, 1).loop as SaveJson).tiles as SaveJson[])[0] = { tx: 48, tz: 9 })],
    ['a For each index out of range', (s) => void ((frame(s, 3, 1).loop as SaveJson).i = 4)],
    ['a route path tile off the farm', (s) => void ((frame(s, 3, 2).path as SaveJson[])[0] = { tx: -1, tz: 9 })],
    ['a route target off the farm', (s) => void (frame(s, 5, 1).target = { tx: 0, tz: 40 })],
    ['a route with an unknown reason', (s) => void (frame(s, 5, 1).why = 'lost')],
    ['a DO-return route while a stack runs', (s) => void (frame(s, 5, 1).why = 'doReturn')],
    ['a second frame during a DO return', (s) => void robot(s, 7).exec.frames.unshift({ kind: 'route', target: { tx: 9, tz: 13 }, path: [], why: 'doReturn' })],
    ['more frames than maxFrames', (s) => void (robot(s, 2).exec.frames = Array.from({ length: ROBOTS.maxFrames + 1 }, () => ({ kind: 'list', list: { root: 'stack', index: 0, path: [] }, next: 1, loop: null })))],
    ['a repeated done card', (s) => void (robot(s, 8).exec.doneCards = [1, 1])],
    ['a done card that is a DON\'T', (s) => void (robot(s, 8).exec.doneCards = [0])],
    ['a done card past the .MD', (s) => void (robot(s, 8).exec.doneCards = [3])],
    ['a zone off the farm', (s) => void (robotsOf(s).zones.A = { x0: 45, z0: 0, w: 4, d: 1 })],
    ['a zone of width 0', (s) => void (robotsOf(s).zones.A = { x0: 3, z0: 9, w: 0, d: 3 })],
    ['an unknown zone id', (s) => void (robotsOf(s).zones.I = null)],
    ['a missing zone id', (s) => void delete robotsOf(s).zones.H],
    ['an off flag on a flat robot', (s) => void Object.assign(robot(s, 2), { power: 'flat', tokens: 0 })],
    ['an unknown off reason', (s) => void (robot(s, 1).off = 'sleepy')],
    ['a program that fails the checker', (s) => void (((robot(s, 1).program.stacks as SaveJson[])[1]!.body as SaveJson[])[1] = { kind: 'do', action: { kind: 'say', text: { kind: 'text', value: '   ' } } })],
    ['a program with an unknown statement', (s) => void ((robot(s, 1).program.helpers as SaveJson[])[0]!.body = [{ kind: 'dance' }])],
    ['an .MD that fails the checker', (s) => void (robot(s, 1).md[2] = { kind: 'doPowerDown', when: { kind: 'tokensBelow', n: 0 } })],
    ['an .MD card of an unknown kind', (s) => void (robot(s, 1).md[0] = { kind: 'dontDance' })],
    ['a script robot with an exec', (s) => void (robot(s, 9).exec = robot(s, 1).exec)],
    ['a block robot without an exec', (s) => void (robot(s, 1).exec = null as never)],
    ['a block robot with pc 1', (s) => void (robot(s, 1).pc = 1)],
  ];

  it.each(rejections)('rejects %s', (_label, edit) => {
    expect(corrupt(lively(), edit)).toBeNull();
  });
});

describe('addRobot with block programs', () => {
  const place = { tx: 5, tz: 11, facing: 2 as const };

  it('starts a block robot idle on a fresh exec, with its .MD', () => {
    const result = addRobot(BASE, { name: 'Drizzle', size: 'standard', parts: ['claw', 'wateringHead'], place, program: PROGRAM, md: MD });
    if ('error' in result) throw new Error(result.error);
    const added = requireRobot(result.state, result.id);
    expect([added.exec, added.md, added.off, added.pc, added.power]).toEqual([freshExec(PROGRAM), MD, null, 0, 'working']);
    expect(deserializeGame(serializeGame(result.state))).toEqual(loadedFrom(result.state));
  });

  it('gives a script robot no exec and an empty .MD', () => {
    const result = addRobot(BASE, { name: 'Scripty', size: 'mini', parts: ['claw'], place, program: { kind: 'script', steps: [{ kind: 'move' }], loop: true } });
    if ('error' in result) throw new Error(result.error);
    expect(requireRobot(result.state, result.id)).toMatchObject({ exec: null, md: [], off: null });
  });

  it("returns the checker's message for a program or .MD it refuses", () => {
    const tooBig = b.program({ stacks: [b.when(b.morning(), ...Array.from({ length: 12 }, () => b.move()))] });
    expect(addRobot(BASE, { name: 'Bulky', size: 'mini', parts: [], place, program: tooBig })).toEqual({ error: 'Mini robots hold 12 blocks; this program has 13.' });
    const md: MdCard[] = [{ kind: 'dontGoIntoWater' }, { kind: 'dontGoIntoWater' }];
    const small = b.program({ stacks: [b.when(b.morning(), b.move())] });
    expect(addRobot(BASE, { name: 'Twice', size: 'mini', parts: [], place, program: small, md })).toEqual({ error: 'The .MD has the same card twice.' });
  });

  it('refuses shapes that are not programs or .MDs without throwing', () => {
    const spec = { name: 'Odd', size: 'mini' as const, parts: [], place };
    expect(addRobot(BASE, { ...spec, program: { kind: 'blocks', stacks: [] } as never })).toEqual({ error: 'That program is not a script or a block program.' });
    expect(addRobot(BASE, { ...spec, program: b.program({ stacks: [b.when(b.morning(), b.move())] }), md: [{ kind: 'dontDance' }] as never })).toEqual({ error: 'That .MD is not a list of cards.' });
  });
});
