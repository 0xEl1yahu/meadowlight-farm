/**
 * The interpreter (farmclaws part 2 spec §5.1): every statement, loops and helpers resuming
 * across minutes, variables, the step budget, route frames and `For each tile`.
 */
import { describe, expect, it } from 'vitest';
import { ROBOTS } from '../src/config';
import { deepFreeze } from '../src/core/store';
import {
  Blocker,
  Direction,
  TileState,
  type BlockProgram,
  type GameState,
  type HelperDef,
  type MdCard,
  type Robot,
  type RobotAction,
  type Statement,
  type TileCoord,
  type VarDecl,
} from '../src/core/types';
import { b } from '../src/robots/blocks';
import { freshExec } from '../src/robots/exec';
import { startStack, stepProgram, type GaveUp, type Step } from '../src/robots/interpret';
import { stepTile } from '../src/world/grid';
import { blockedTile } from '../src/world/tiles';
import { BASE, TARGET, must, robotOf, soilTile, withTile, withZones } from './testUtils';

/** A program with one morning stack running `body`. */
function prog(body: Statement[], vars: VarDecl[] = [], helpers: HelperDef[] = []): BlockProgram {
  return b.program({ vars, stacks: [b.when(b.morning(), ...body)], helpers });
}

/** A robot (default: a Mini on TARGET facing South) running stack 0 of `program` from its start. */
function running(program: BlockProgram, overrides: Partial<Robot> = {}): Robot {
  return robotOf({ program, exec: startStack(freshExec(program), 0), ...overrides });
}

/** The robot after its turn resolved: the step's exec is committed, and moves and turns happen. */
function resolve(robot: Robot, step: Step): Robot {
  if (step.kind === 'dizzy') throw new Error('resolve: the robot is dizzy');
  if (step.kind === 'idle') return { ...robot, exec: step.exec };
  const action = step.action;
  if (action.kind === 'move') {
    const to = stepTile({ tx: robot.tx, tz: robot.tz }, robot.facing);
    return { ...robot, tx: to.tx, tz: to.tz, exec: step.exec };
  }
  if (action.kind === 'turn') {
    const facing = ((robot.facing + (action.side === 'left' ? 3 : 1)) % 4) as Direction;
    return { ...robot, facing, exec: step.exec };
  }
  return { ...robot, exec: step.exec };
}

type Outcome = RobotAction | 'idle' | 'dizzy';

/** Runs up to `limit` turns, stopping after the first idle or dizzy. */
function play(state: GameState, start: Robot, limit = 200): { outcomes: Outcome[]; robot: Robot; gaveUp: GaveUp[]; at: TileCoord[] } {
  let robot = start;
  const outcomes: Outcome[] = [];
  const gaveUp: GaveUp[] = [];
  const at: TileCoord[] = [];
  for (let i = 0; i < limit; i++) {
    const step = stepProgram(state, robot);
    if (step.kind === 'dizzy') {
      outcomes.push('dizzy');
      break;
    }
    gaveUp.push(...step.gaveUp);
    if (step.kind === 'idle') {
      outcomes.push('idle');
      robot = resolve(robot, step);
      break;
    }
    outcomes.push(step.action);
    at.push({ tx: robot.tx, tz: robot.tz });
    robot = resolve(robot, step);
  }
  return { outcomes, robot, gaveUp, at };
}

const actions = (body: Statement[], vars: VarDecl[] = [], helpers: HelperDef[] = []): Outcome[] =>
  play(BASE, running(prog(body, vars, helpers))).outcomes;

const MOVE: RobotAction = { kind: 'move' };
const LEFT: RobotAction = { kind: 'turn', side: 'left' };
const RIGHT: RobotAction = { kind: 'turn', side: 'right' };
const say = (text: string): RobotAction => ({ kind: 'say', text });
const rockAt = (state: GameState, ...tiles: TileCoord[]): GameState =>
  tiles.reduce((s, t) => withTile(s, t, blockedTile(Blocker.Rock, 2), 'farm'), state);

describe('startStack', () => {
  it('runs a stack from its first statement', () => {
    const program = b.program({ stacks: [b.when(b.morning(), b.move()), b.when(b.every(15), b.water())] });
    expect(startStack(freshExec(program), 1)).toEqual({
      ...freshExec(program),
      running: 1,
      frames: [{ kind: 'list', list: { root: 'stack', index: 1, path: [] }, next: 0, loop: null }],
    });
  });
});

describe('action blocks', () => {
  it('turns every action block into its part 1 action, in order, then goes idle', () => {
    const program = prog(
      [b.move(), b.turn('left'), b.water(), b.harvest(), b.till(), b.plant('parsnip'), b.refill(), b.deposit(), b.take('wood'), b.say('Hi'), b.wait(30), b.powerDown()],
    );
    expect(play(BASE, running(program)).outcomes).toEqual([
      MOVE,
      LEFT,
      { kind: 'water' },
      { kind: 'harvest' },
      { kind: 'till' },
      { kind: 'plant', cropId: 'parsnip' },
      { kind: 'refill' },
      { kind: 'deposit' },
      { kind: 'take', itemId: 'wood' },
      say('Hi'),
      { kind: 'wait', minutes: 30 },
      { kind: 'powerDown' },
      'idle',
    ]);
  });

  it('advances exec past the block it acts on', () => {
    const step = stepProgram(BASE, running(prog([b.move(), b.water()])));
    expect(step).toEqual({
      kind: 'act',
      action: MOVE,
      exec: { ...startStack(freshExec(prog([])), 0), frames: [{ kind: 'list', list: { root: 'stack', index: 0, path: [] }, next: 1, loop: null }] },
      gaveUp: [],
    });
  });

  it('trims and cuts what it says, and says "…" for blank text', () => {
    const long = 'x'.repeat(ROBOTS.sayMaxLength + 10);
    expect(actions([b.say('  Hello  '), b.say(long), b.say('   '), b.say(b.v('t'))], [b.textVar('t', ' from a var ')])).toEqual([
      say('Hello'),
      say('x'.repeat(ROBOTS.sayMaxLength)),
      say('…'),
      say('from a var'),
      'idle',
    ]);
  });

  it('clamps wait to 1 … maxWaitMinutes and reads expressions', () => {
    expect(actions([b.wait(0), b.wait(ROBOTS.maxWaitMinutes + 1), b.wait(b.add(b.v('n'), b.n(5)))], [b.numVar('n', 10)])).toEqual([
      { kind: 'wait', minutes: 1 },
      { kind: 'wait', minutes: ROBOTS.maxWaitMinutes },
      { kind: 'wait', minutes: 15 },
      'idle',
    ]);
  });

  it('takes the item an item variable holds', () => {
    expect(actions([b.take(b.v('what'))], [b.itemVar('what', 'parsnip_seeds')])).toEqual([{ kind: 'take', itemId: 'parsnip_seeds' }, 'idle']);
  });
});

describe('loops and branches', () => {
  it('repeats n times: 0 skips, 1 and 3 run that often', () => {
    expect(actions([b.repeat(0, b.move()), b.turn('right')])).toEqual([RIGHT, 'idle']);
    expect(actions([b.repeat(1, b.move()), b.turn('right')])).toEqual([MOVE, RIGHT, 'idle']);
    expect(actions([b.repeat(3, b.move()), b.turn('right')])).toEqual([MOVE, MOVE, MOVE, RIGHT, 'idle']);
  });

  it('evaluates the repeat count once', () => {
    const { outcomes, robot } = play(BASE, running(prog([b.repeat(b.v('n'), b.change('n', 1), b.move())], [b.numVar('n', 2)])));
    expect(outcomes).toEqual([MOVE, MOVE, 'idle']);
    expect(must(robot.exec).vars).toEqual([{ type: 'number', value: 4 }]);
  });

  it('tests Repeat until before every iteration, the first included', () => {
    expect(actions([b.repeatUntil(b.yes(true), b.move()), b.turn('right')])).toEqual([RIGHT, 'idle']);
    expect(actions([b.repeatUntil(b.eq(b.v('n'), b.n(3)), b.change('n', 1), b.move())], [b.numVar('n', 0)])).toEqual([MOVE, MOVE, MOVE, 'idle']);
  });

  it('repeats forever', () => {
    const { outcomes } = play(BASE, running(prog([b.forever(b.turn('right'))])), 10);
    expect(outcomes).toEqual(Array.from({ length: 10 }, () => RIGHT));
  });

  it('takes then or else, and skips an if without else', () => {
    expect(actions([b.if(b.yes(true), [b.turn('left')], [b.turn('right')])])).toEqual([LEFT, 'idle']);
    expect(actions([b.if(b.yes(false), [b.turn('left')], [b.turn('right')])])).toEqual([RIGHT, 'idle']);
    expect(actions([b.if(b.yes(false), [b.turn('left')]), b.move()])).toEqual([MOVE, 'idle']);
  });

  it('resumes nested loops across minutes', () => {
    expect(actions([b.repeat(2, b.repeat(2, b.turn('left')), b.turn('right')), b.move()])).toEqual([LEFT, LEFT, RIGHT, LEFT, LEFT, RIGHT, MOVE, 'idle']);
  });

  it('saves its place in a nested loop as frames', () => {
    const program = prog([b.repeat(2, b.if(b.yes(true), [b.turn('left'), b.move()]))]);
    const step = stepProgram(BASE, running(program));
    expect(step.kind === 'act' && step.exec.frames).toEqual([
      { kind: 'list', list: { root: 'stack', index: 0, path: [] }, next: 1, loop: null },
      { kind: 'list', list: { root: 'stack', index: 0, path: [[0, 'body']] }, next: 1, loop: { kind: 'times', left: 1 } },
      { kind: 'list', list: { root: 'stack', index: 0, path: [[0, 'body'], [0, 'then']] }, next: 1, loop: null },
    ]);
  });
});

describe('variables and helpers', () => {
  it('sets and changes variables, clamping numbers to ±maxNumber', () => {
    const vars = [b.numVar('n', ROBOTS.maxNumber - 10), b.textVar('t', 'hi')];
    const { robot } = play(BASE, running(prog([b.change('n', 100), b.set('t', b.text('bye')), b.move()], vars)), 1);
    expect(must(robot.exec).vars).toEqual([
      { type: 'number', value: ROBOTS.maxNumber },
      { type: 'text', value: 'bye' },
    ]);
    const low = play(BASE, running(prog([b.set('n', b.sub(b.n(-ROBOTS.maxNumber), b.n(5))), b.move()], vars)), 1).robot;
    expect(must(low.exec).vars[0]).toEqual({ type: 'number', value: -ROBOTS.maxNumber });
  });

  it('calls helpers, nested, and returns to the caller', () => {
    const helpers = [b.helper('outer', b.turn('left'), b.run('inner'), b.turn('left')), b.helper('inner', b.turn('right'))];
    expect(actions([b.run('outer'), b.move()], [], helpers)).toEqual([LEFT, RIGHT, LEFT, MOVE, 'idle']);
  });

  it('keeps a helper frame on the stack mid-helper', () => {
    const helpers = [b.helper('spin', b.turn('left'), b.turn('left'))];
    const step = stepProgram(BASE, running(prog([b.run('spin')], [], helpers)));
    expect(step.kind === 'act' && step.exec.frames).toEqual([
      { kind: 'list', list: { root: 'stack', index: 0, path: [] }, next: 1, loop: null },
      { kind: 'list', list: { root: 'helper', index: 0, path: [] }, next: 1, loop: null },
    ]);
  });

  it('goes idle when the stack ends: no frames, nothing running', () => {
    const { outcomes, robot } = play(BASE, running(prog([b.move()])));
    expect(outcomes).toEqual([MOVE, 'idle']);
    expect(must(robot.exec)).toMatchObject({ running: null, frames: [] });
  });
});

describe('the step budget', () => {
  const frees = (count: number): Statement[] => Array.from({ length: count }, () => b.change('n', 1));
  const n = [b.numVar('n', 0)];

  it(`acts after ${ROBOTS.stepBudget - 1} free blocks, and is dizzy at ${ROBOTS.stepBudget}`, () => {
    expect(stepProgram(BASE, running(prog([...frees(ROBOTS.stepBudget - 1), b.move()], n))).kind).toBe('act');
    expect(stepProgram(BASE, running(prog([...frees(ROBOTS.stepBudget), b.move()], n)))).toEqual({ kind: 'dizzy' });
  });

  it('counts the loop statement and each further iteration', () => {
    // Repeat 24: 1 (the repeat) + 24 changes + 23 further iterations = 48 steps, then the move.
    expect(stepProgram(BASE, running(prog([b.repeat(24, b.change('n', 1)), b.move()], n))).kind).toBe('act');
    // Repeat 25: the 25th change is the 50th step.
    expect(stepProgram(BASE, running(prog([b.repeat(25, b.change('n', 1)), b.move()], n)))).toEqual({ kind: 'dizzy' });
  });

  it('gets dizzy in a Repeat forever with only free blocks, even an empty one', () => {
    expect(stepProgram(BASE, running(prog([b.forever(b.change('n', 1))], n)))).toEqual({ kind: 'dizzy' });
    expect(stepProgram(BASE, running(prog([b.forever()])))).toEqual({ kind: 'dizzy' });
  });

  it('starts a fresh budget every minute', () => {
    const program = prog([b.forever(...frees(30), b.move())], n);
    const { outcomes } = play(BASE, running(program), 5);
    expect(outcomes).toEqual([MOVE, MOVE, MOVE, MOVE, MOVE]);
  });
});

describe('expressions read the state passed in', () => {
  it('answers from the start-of-minute state and changes nothing', () => {
    const program = prog([b.if(b.soilIsDry(), [b.water()], [b.turn('left')])]);
    const dry = deepFreeze(withTile(BASE, TARGET, soilTile(TileState.Plowed), 'farm'));
    const robot = deepFreeze(running(program, { parts: ['wateringHead'], tank: 5 }));
    expect(stepProgram(dry, robot)).toMatchObject({ kind: 'act', action: { kind: 'water' } });
    expect(stepProgram(BASE, robot)).toMatchObject({ kind: 'act', action: LEFT });
    expect(stepProgram(dry, robot)).toMatchObject({ kind: 'act', action: { kind: 'water' } });
  });
});

describe('Go to', () => {
  it('turns, then moves one tile a minute, pops on arrival and carries on', () => {
    const { outcomes, robot } = play(BASE, running(prog([b.goTo(b.tileAt(7, 10)), b.say('Here')])));
    expect(outcomes).toEqual([LEFT, MOVE, MOVE, say('Here'), 'idle']);
    expect([robot.tx, robot.tz]).toEqual([7, 10]);
  });

  it('saves the route as a frame, dropping each tile it moves toward', () => {
    const robot = running(prog([b.goTo(b.tileAt(5, 13))]));
    const step = stepProgram(BASE, robot);
    expect(step).toEqual({
      kind: 'act',
      action: MOVE,
      exec: {
        ...must(robot.exec),
        frames: [
          { kind: 'list', list: { root: 'stack', index: 0, path: [] }, next: 1, loop: null },
          { kind: 'route', target: { tx: 5, tz: 13 }, path: [{ tx: 5, tz: 12 }, { tx: 5, tz: 13 }], why: 'goTo' },
        ],
      },
      gaveUp: [],
    });
  });

  it('re-plans when a rock lands on its next tile', () => {
    const first = running(prog([b.goTo(b.tileAt(5, 13))]));
    const moved = resolve(first, stepProgram(BASE, first));
    const rocky = rockAt(BASE, { tx: 5, tz: 12 });
    const step = stepProgram(rocky, moved);
    expect(step.kind === 'act' && step.action).toEqual(LEFT);
    expect(step.kind === 'act' && step.exec.frames[1]).toEqual({
      kind: 'route',
      target: { tx: 5, tz: 13 },
      path: [{ tx: 6, tz: 11 }, { tx: 6, tz: 12 }, { tx: 6, tz: 13 }, { tx: 5, tz: 13 }],
      why: 'goTo',
    });
    expect(play(rocky, moved).robot).toMatchObject({ tx: 5, tz: 13 });
  });

  it('re-plans from where it stands after being picked up and put down (review focus 2)', () => {
    const first = running(prog([b.goTo(b.tileAt(5, 13)), b.say('Here')]));
    const moved = resolve(first, stepProgram(BASE, first));
    const putDown = { ...moved, tx: 8, tz: 12, facing: Direction.North };
    const step = stepProgram(BASE, putDown);
    expect(step.kind === 'act' && step.exec.frames[1]).toEqual({
      kind: 'route',
      target: { tx: 5, tz: 13 },
      path: [{ tx: 8, tz: 13 }, { tx: 7, tz: 13 }, { tx: 6, tz: 13 }, { tx: 5, tz: 13 }],
      why: 'goTo',
    });
    expect(step.kind === 'act' && step.action).toEqual(RIGHT);
    const { outcomes, robot } = play(BASE, putDown);
    expect(outcomes.slice(-2)).toEqual([say('Here'), 'idle']);
    expect([robot.tx, robot.tz]).toEqual([5, 13]);
  });

  it('gives up on a tile it can never reach and moves on', () => {
    const walled = rockAt(BASE, { tx: 5, tz: 9 }, { tx: 6, tz: 10 }, { tx: 5, tz: 11 }, { tx: 4, tz: 10 });
    const step = stepProgram(walled, running(prog([b.goTo(b.tileAt(5, 13)), b.say('Stuck')])));
    expect(step).toMatchObject({ kind: 'act', action: say('Stuck'), gaveUp: [{ target: { tx: 5, tz: 13 }, why: 'goTo' }] });
  });

  it('finishes a Go to its own tile at once', () => {
    expect(actions([b.goTo(b.myTile()), b.say('Here')])).toEqual([say('Here'), 'idle']);
  });
});

describe('For each tile', () => {
  /** Zone A: x 4…6, z 12…13, south of TARGET (5, 10). */
  const ZONE = { x0: 4, z0: 12, w: 3, d: 2 };
  const zoned = withZones(BASE, { A: ZONE });
  const waterer = (state: GameState, md: MdCard[] = [], start: Partial<Robot> = {}) =>
    play(state, running(prog([b.forEach('A', b.water()), b.say('Done')]), { parts: ['wateringHead'], tank: 20, md, ...start }));
  const wateredAt = (result: ReturnType<typeof waterer>): TileCoord[] =>
    result.outcomes.flatMap((o, i) => (o !== 'idle' && o !== 'dizzy' && o.kind === 'water' ? [must(result.at[i])] : []));

  it('visits a 3×2 zone in snake order and runs its body on each tile', () => {
    const result = waterer(zoned);
    expect(wateredAt(result)).toEqual([
      { tx: 4, tz: 12 },
      { tx: 5, tz: 12 },
      { tx: 6, tz: 12 },
      { tx: 6, tz: 13 },
      { tx: 5, tz: 13 },
      { tx: 4, tz: 13 },
    ]);
    expect(result.outcomes.slice(-2)).toEqual([say('Done'), 'idle']);
    expect(result.gaveUp).toEqual([]);
  });

  it('skips tiles nobody can stand on', () => {
    expect(wateredAt(waterer(rockAt(zoned, { tx: 6, tz: 12 })))).toEqual([
      { tx: 4, tz: 12 },
      { tx: 5, tz: 12 },
      { tx: 6, tz: 13 },
      { tx: 5, tz: 13 },
      { tx: 4, tz: 13 },
    ]);
  });

  it('gives up on an unreachable tile, logs it, and carries on', () => {
    const boxed = rockAt(zoned, { tx: 6, tz: 12 }, { tx: 7, tz: 13 }, { tx: 6, tz: 14 }, { tx: 5, tz: 13 });
    const result = waterer(boxed);
    expect(wateredAt(result)).toEqual([
      { tx: 4, tz: 12 },
      { tx: 5, tz: 12 },
      { tx: 4, tz: 13 },
    ]);
    expect(result.gaveUp).toEqual([{ target: { tx: 6, tz: 13 }, why: 'forEach' }]);
    expect(result.outcomes.slice(-2)).toEqual([say('Done'), 'idle']);
  });

  it('does nothing for an empty zone', () => {
    expect(waterer(BASE).outcomes).toEqual([say('Done'), 'idle']);
  });

  it("gives up on a tile it could only reach by leaving its DON'T leave zone, never dizzy (review focus 5)", () => {
    const row = withZones(rockAt(BASE, { tx: 5, tz: 10 }), { A: { x0: 4, z0: 10, w: 3, d: 1 } });
    const result = waterer(row, [{ kind: 'dontLeave', zone: 'A' }], { tx: 4, tz: 10 });
    expect(result.outcomes).toEqual([{ kind: 'water' }, say('Done'), 'idle']);
    expect(result.gaveUp).toEqual([{ target: { tx: 6, tz: 10 }, why: 'forEach' }]);
  });
});
