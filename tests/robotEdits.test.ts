/**
 * Program, .MD and zone edits (farmclaws part 3 spec §4.7): the pure edits moved out of the dev
 * hooks into src/robots/edits.ts, and the programRobot / setRobotMd reducer actions.
 */
import { describe, expect, it } from 'vitest';
import { ROBOTS, TIME } from '../src/config';
import { Direction, type GameState, type MdCard, type RobotAction, type RobotPlace, type RobotProgram, type ZoneRect } from '../src/core/types';
import { b } from '../src/robots/blocks';
import { checkMd, checkProgram } from '../src/robots/check';
import { addRobot } from '../src/robots/create';
import { MD_SCRIPT, MD_SHAPE, PROGRAM_SHAPE, ZONE_OFF_FARM, ZONE_SHAPE, programmedRobot, withMd, withZone } from '../src/robots/edits';
import { freshExec, morningExec } from '../src/robots/exec';
import { requireRobot } from '../src/robots/world';
import { actions } from '../src/state/actions';
import { gameReducer } from '../src/state/reducer';
import { BASE, TARGET, atDay, benchedRobotOf, robotOf, withRobots, withZones } from './testUtils';

const AT: RobotPlace = { tx: TARGET.tx, tz: TARGET.tz, facing: Direction.South };
const STEPS: RobotAction[] = [{ kind: 'water' }, { kind: 'move' }];
const WALK = b.program({ stacks: [b.when(b.morning(), b.move())] });
/** A Mini's first act of the day without a quick core: 6:04. */
const FIRST_ACT = TIME.dayStartMinute + ROBOTS.period;
const RETURN: MdCard = { kind: 'doReturn', to: { kind: 'generator' }, minute: 18 * 60 };

describe('programmedRobot', () => {
  it("starts the morning stack up to the robot's first act of the day", () => {
    const robot = robotOf({ power: 'standby', off: 'dizzy' });
    expect(programmedRobot(robot, WALK, FIRST_ACT)).toEqual({
      ...robot,
      program: WALK,
      pc: 0,
      exec: morningExec(WALK),
      off: null,
      power: 'working',
      nextActMinute: FIRST_ACT + ROBOTS.period,
    });
  });

  it('keeps a robot the player switched off switched off', () => {
    const program = b.program({ stacks: [b.when(b.morning(), b.move())] });
    const next = programmedRobot(robotOf({ power: 'standby', off: 'player' }), program, 900);
    expect(typeof next).not.toBe('string');
    expect(next).toMatchObject({ off: 'player', program });
  });

  it('leaves the robot idle a minute later, waiting for a trigger', () => {
    expect(programmedRobot(robotOf(), WALK, FIRST_ACT + 1)).toMatchObject({
      exec: freshExec(WALK),
      power: 'standby',
      nextActMinute: FIRST_ACT + 1 + ROBOTS.period,
    });
  });

  it("moves the cut-off to a quick core's earlier first act", () => {
    const quick = robotOf({ parts: ['quickCore'] });
    const cutOff = TIME.dayStartMinute + ROBOTS.quickCorePeriod;
    expect(programmedRobot(quick, WALK, cutOff)).toMatchObject({ exec: morningExec(WALK), power: 'working' });
    expect(programmedRobot(quick, WALK, cutOff + 1)).toMatchObject({ exec: freshExec(WALK), power: 'standby' });
  });

  it('stands by at 6:00 when no stack starts in the morning', () => {
    const polling = b.program({ stacks: [b.when(b.every(15), b.move())] });
    expect(programmedRobot(robotOf(), polling, TIME.dayStartMinute)).toMatchObject({ exec: freshExec(polling), power: 'standby' });
  });

  it('runs a script from its first step, with no exec', () => {
    const script: RobotProgram = { kind: 'script', steps: STEPS, loop: false };
    expect(programmedRobot(robotOf({ power: 'standby' }), script, 900)).toMatchObject({ program: script, pc: 0, exec: null, power: 'working', off: null });
  });

  it('keeps the power of a flat, broken or repairing robot', () => {
    for (const power of ['flat', 'broken', 'repairing'] as const) {
      expect(programmedRobot(robotOf({ power, tokens: 0 }), WALK, TIME.dayStartMinute)).toMatchObject({ power, exec: morningExec(WALK) });
    }
  });

  it("returns the checker's sentence for a program the robot can't hold", () => {
    // One trigger and twelve moves: 13 blocks on a 12-block Mini.
    const tooLong = b.program({ stacks: [b.when(b.morning(), ...Array.from({ length: ROBOTS.sizes.mini.blocks }, () => b.move()))] });
    const problem = checkProgram(tooLong, robotOf());
    expect(typeof problem).toBe('string');
    expect(programmedRobot(robotOf(), tooLong, TIME.dayStartMinute)).toBe(problem);
  });

  it("refuses something that isn't a program", () => {
    for (const junk of [42, null, 'move', { kind: 'blocks' }]) {
      expect(programmedRobot(robotOf(), junk as never, TIME.dayStartMinute)).toBe(PROGRAM_SHAPE);
    }
  });
});

describe('withMd', () => {
  /** An idle block robot: .MD cards only apply to block programs. */
  const BLOCKY = robotOf({ program: WALK, exec: freshExec(WALK), power: 'standby' });

  it('sets the cards', () => {
    const cards: MdCard[] = [{ kind: 'dontGoIntoWater' }, RETURN];
    expect(withMd(BLOCKY, cards)).toEqual({ ...BLOCKY, md: cards, exec: { ...freshExec(WALK), doneCards: [] } });
  });

  it('refuses a robot running a script', () => {
    expect(withMd(robotOf(), [{ kind: 'dontGoIntoWater' }])).toBe(MD_SCRIPT);
  });

  it("forgets today's carried-out DO cards and stops a DO return under way", () => {
    const programmed = programmedRobot(robotOf(), WALK, TIME.dayStartMinute);
    if (typeof programmed === 'string') throw new Error(programmed);
    const returning = {
      ...programmed,
      md: [RETURN],
      exec: { ...freshExec(WALK), frames: [{ kind: 'route' as const, target: { tx: 9, tz: 6 }, path: [], why: 'doReturn' as const }], doneCards: [0] },
    };
    expect(withMd(returning, [{ kind: 'dontGoIntoWater' }])).toMatchObject({
      md: [{ kind: 'dontGoIntoWater' }],
      power: 'standby',
      exec: { ...freshExec(WALK), frames: [], doneCards: [] },
    });
  });

  it('leaves a running program running', () => {
    const programmed = programmedRobot(robotOf(), WALK, TIME.dayStartMinute);
    if (typeof programmed === 'string') throw new Error(programmed);
    expect(withMd(programmed, [RETURN])).toEqual({ ...programmed, md: [RETURN], exec: { ...morningExec(WALK), doneCards: [] } });
  });

  it("returns the checker's sentence for cards the robot can't hold", () => {
    // A Mini's .MD holds 3 cards.
    const four: MdCard[] = [{ kind: 'dontGoIntoWater' }, { kind: 'dontLeave', zone: 'A' }, { kind: 'dontLeave', zone: 'B' }, { kind: 'dontHarvest', cropId: 'pumpkin' }];
    const problem = checkMd(four, BLOCKY);
    expect(typeof problem).toBe('string');
    expect(withMd(BLOCKY, four)).toBe(problem);
  });

  it("refuses something that isn't a list of cards", () => {
    for (const junk of [42, null, 'water', [{ kind: 'dance' }]]) expect(withMd(BLOCKY, junk as never)).toBe(MD_SHAPE);
  });
});

describe('withZone', () => {
  const RECT: ZoneRect = { x0: 4, z0: 9, w: 3, d: 3 };

  it('sets a zone and leaves the others alone', () => {
    const next = withZone(BASE, 'A', RECT);
    if (typeof next === 'string') throw new Error(next);
    expect(next.robots.zones).toEqual({ ...BASE.robots.zones, A: RECT });
  });

  it('clears a zone with null', () => {
    const next = withZone(withZones(BASE, { A: RECT }), 'A', null);
    if (typeof next === 'string') throw new Error(next);
    expect(next.robots.zones.A).toBeNull();
  });

  it("keeps only the rectangle's own fields", () => {
    const next = withZone(BASE, 'B', { ...RECT, colour: 'red' } as ZoneRect);
    if (typeof next === 'string') throw new Error(next);
    expect(next.robots.zones.B).toEqual(RECT);
  });

  it('refuses an unknown zone or a malformed rectangle', () => {
    expect(withZone(BASE, 'Z' as never, RECT)).toBe(ZONE_SHAPE);
    expect(withZone(BASE, 'A', { ...RECT, x0: 1.5 })).toBe(ZONE_SHAPE);
    expect(withZone(BASE, 'A', undefined as never)).toBe(ZONE_SHAPE);
    expect(withZone(BASE, 'A', 'A1' as never)).toBe(ZONE_SHAPE);
  });

  it('refuses a rectangle that is empty or leaves the farm', () => {
    expect(withZone(BASE, 'A', { ...RECT, w: 0 })).toBe(ZONE_OFF_FARM);
    expect(withZone(BASE, 'A', { ...RECT, d: 0 })).toBe(ZONE_OFF_FARM);
    expect(withZone(BASE, 'A', { ...RECT, x0: -1 })).toBe(ZONE_OFF_FARM);
    expect(withZone(BASE, 'A', { x0: 46, z0: 9, w: 5, d: 1 })).toBe(ZONE_OFF_FARM);
  });
});

describe('malformed input never throws', () => {
  /** A well-shaped program whose repeatForever statements nest `depth` deep. */
  const deep = (depth: number): RobotProgram => {
    let body: unknown[] = [];
    for (let i = 0; i < depth; i++) body = [{ kind: 'repeatForever', body }];
    return { kind: 'blocks', vars: [], stacks: [{ trigger: { kind: 'morning' }, body }], helpers: [] } as unknown as RobotProgram;
  };

  it('answers a 2000-deep program with a message', () => {
    expect(typeof programmedRobot(robotOf(), deep(2000), TIME.dayStartMinute)).toBe('string');
    expect(addRobot(BASE, { name: 'Deep', size: 'mini', parts: ['claw'], place: AT, program: deep(2000) })).toHaveProperty('error');
  });

  it('refuses sparse arrays', () => {
    const holeyStacks = { kind: 'blocks', vars: [], stacks: new Array(1), helpers: [] } as unknown as RobotProgram;
    expect(programmedRobot(robotOf(), holeyStacks, TIME.dayStartMinute)).toBe(PROGRAM_SHAPE);
    const holeyBody = b.program({ stacks: [{ trigger: b.morning(), body: [b.move(), , b.move()] as never }] });
    expect(programmedRobot(robotOf(), holeyBody, TIME.dayStartMinute)).toBe(PROGRAM_SHAPE);
    const holeyScript = { kind: 'script', steps: [{ kind: 'move' }, , { kind: 'move' }], loop: true } as unknown as RobotProgram;
    expect(programmedRobot(robotOf(), holeyScript, TIME.dayStartMinute)).toBe(PROGRAM_SHAPE);
    expect(addRobot(BASE, { name: 'Holey', size: 'mini', parts: ['claw'], place: AT, program: holeyScript })).toHaveProperty('error');
    expect(withMd(robotOf({ program: WALK, exec: freshExec(WALK) }), new Array(1) as never)).toBe(MD_SHAPE);
  });

  it('refuses a 60-deep DAG of shared and nodes promptly', () => {
    let cond: Record<string, unknown> = { kind: 'yes', value: true };
    for (let i = 0; i < 60; i++) cond = { kind: 'and', a: cond, b: cond };
    const dag = b.program({ stacks: [b.when(b.morning(), b.if(cond as never, [b.move()]))] });
    const started = performance.now();
    expect(programmedRobot(robotOf(), dag, TIME.dayStartMinute)).toBe(PROGRAM_SHAPE);
    expect(addRobot(BASE, { name: 'Dag', size: 'mini', parts: ['claw'], place: AT, program: dag })).toHaveProperty('error');
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('still takes a program that reuses a statement in two stacks', () => {
    const turn = b.turn('right');
    const reused = b.program({ stacks: [b.when(b.morning(), turn), b.when(b.atTime(600), turn)] });
    expect(programmedRobot(robotOf(), reused, TIME.dayStartMinute)).toMatchObject({ program: reused, exec: morningExec(reused) });
  });
});

describe('the programRobot and setRobotMd actions', () => {
  /**
   * Sprocket runs a script; Bolt is an idle block robot. Both stand on the workbench, where the
   * robot screen edits robots (part 3 spec §4.7); the save allows one there, but these tests never save.
   */
  const FARM = withRobots(BASE, [
    benchedRobotOf({ id: 1 }),
    benchedRobotOf({ id: 2, name: 'Bolt', power: 'standby', program: WALK, exec: freshExec(WALK) }),
  ]);
  const last = (state: GameState) => state.messages.entries.at(-1);

  it('programs a robot exactly as programmedRobot does, with a toast', () => {
    const afternoon = atDay(FARM, 0, 900);
    const next = gameReducer(afternoon, actions.programRobot(1, WALK));
    expect(requireRobot(next, 1)).toEqual(programmedRobot(requireRobot(afternoon, 1), WALK, 900));
    expect(requireRobot(next, 2)).toBe(requireRobot(afternoon, 2));
    expect(last(next)).toMatchObject({ text: 'Programmed Sprocket.', tone: 'success' });
  });

  it("answers a program the robot can't hold with the checker's sentence and changes nothing else", () => {
    const tooLong = b.program({ stacks: [b.when(b.morning(), ...Array.from({ length: ROBOTS.sizes.mini.blocks }, () => b.move()))] });
    const next = gameReducer(FARM, actions.programRobot(1, tooLong));
    expect(next.robots).toBe(FARM.robots);
    expect(last(next)).toMatchObject({ text: checkProgram(tooLong, robotOf()), tone: 'warn' });
  });

  it('refuses something that is not a program without throwing', () => {
    const next = gameReducer(FARM, actions.programRobot(1, { kind: 'blocks' } as never));
    expect(next.robots).toBe(FARM.robots);
    expect(last(next)).toMatchObject({ text: PROGRAM_SHAPE, tone: 'warn' });
  });

  it("sets a robot's .MD exactly as withMd does, with a toast", () => {
    const cards: MdCard[] = [{ kind: 'dontGoIntoWater' }];
    const next = gameReducer(FARM, actions.setRobotMd(2, cards));
    expect(requireRobot(next, 2)).toEqual(withMd(requireRobot(FARM, 2), cards));
    expect(last(next)).toMatchObject({ text: "Set Bolt's .MD.", tone: 'success' });
  });

  it('refuses .MD cards for a robot running a script', () => {
    const next = gameReducer(FARM, actions.setRobotMd(1, [{ kind: 'dontGoIntoWater' }]));
    expect(next.robots).toBe(FARM.robots);
    expect(last(next)).toMatchObject({ text: MD_SCRIPT, tone: 'warn' });
  });

  it('ignores a robot id that is not on the farm', () => {
    expect(gameReducer(FARM, actions.programRobot(9, WALK))).toBe(FARM);
    expect(gameReducer(FARM, actions.setRobotMd(9, []))).toBe(FARM);
  });

  it('edits while a panel freezes the game, as the robot screen needs', () => {
    const frozen: GameState = { ...FARM, ui: { ...FARM.ui, panel: { kind: 'inventory' } } };
    expect(requireRobot(gameReducer(frozen, actions.programRobot(1, WALK)), 1).program).toBe(WALK);
    expect(requireRobot(gameReducer(frozen, actions.setRobotMd(2, [RETURN])), 2).md).toEqual([RETURN]);
  });

  it('refuses a robot that is not on the bench, for programs and .MDs alike', () => {
    const field = withRobots(BASE, [robotOf({ id: 1 }), robotOf({ id: 2, name: 'Bolt', tx: 4, tz: 10, power: 'standby', program: WALK, exec: freshExec(WALK) })]);
    const programmed = gameReducer(field, actions.programRobot(1, WALK));
    expect(programmed.robots).toBe(field.robots);
    expect(last(programmed)).toMatchObject({ text: 'Put Sprocket on the workbench first.', tone: 'warn' });
    const carded = gameReducer(field, actions.setRobotMd(2, [{ kind: 'dontGoIntoWater' }]));
    expect(carded.robots).toBe(field.robots);
    expect(last(carded)).toMatchObject({ text: 'Put Bolt on the workbench first.', tone: 'warn' });
  });

  it('checks the bench before the program, so a bad program off the bench gets the bench refusal', () => {
    const field = withRobots(BASE, [robotOf({ id: 1 })]);
    expect(last(gameReducer(field, actions.programRobot(1, { kind: 'blocks' } as never)))).toMatchObject({ text: 'Put Sprocket on the workbench first.' });
  });
});
