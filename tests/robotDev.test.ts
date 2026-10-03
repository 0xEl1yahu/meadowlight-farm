import { describe, expect, it } from 'vitest';
import { ROBOTS, TIME } from '../src/config';
import { Direction, type MdCard, type RobotAction, type RobotPlace, type RobotProgram, type ZoneRect } from '../src/core/types';
import { programmedRobot, scriptedRobotSpec, withMd, withZone } from '../src/dev/robotDev';
import { b } from '../src/robots/blocks';
import { checkMd, checkProgram } from '../src/robots/check';
import { addRobot } from '../src/robots/create';
import { freshExec, morningExec } from '../src/robots/exec';
import { BASE, TARGET, robotOf, withZones } from './testUtils';

const AT: RobotPlace = { tx: TARGET.tx, tz: TARGET.tz, facing: Direction.South };
const STEPS: RobotAction[] = [{ kind: 'water' }, { kind: 'move' }];

describe('scriptedRobotSpec', () => {
  it('fills in the defaults', () => {
    expect(scriptedRobotSpec({ steps: STEPS, parts: ['wateringHead'] }, AT)).toEqual({
      name: 'Scripty',
      size: 'mini',
      parts: ['wateringHead'],
      place: AT,
      program: { kind: 'script', steps: STEPS, loop: true },
    });
  });

  it('keeps explicit values, including loop: false', () => {
    const spec = scriptedRobotSpec({ steps: STEPS, parts: ['claw', 'basket'], name: 'Bo', size: 'standard', loop: false }, AT);
    expect(spec.name).toBe('Bo');
    expect(spec.size).toBe('standard');
    expect(spec.program).toEqual({ kind: 'script', steps: STEPS, loop: false });
  });
});

describe('addRobot with a scripted spec', () => {
  it('accepts the default spec at a clear tile', () => {
    const result = addRobot(BASE, scriptedRobotSpec({ steps: STEPS, parts: ['wateringHead'] }, AT));
    expect('error' in result).toBe(false);
  });

  it('rejects an invalid step', () => {
    const bad = [{ kind: 'dance' }] as unknown as RobotAction[];
    const result = addRobot(BASE, scriptedRobotSpec({ steps: bad, parts: ['claw'] }, AT));
    expect(result).toEqual({ error: 'That program is not a valid script.' });
  });

  it('rejects an empty script', () => {
    const result = addRobot(BASE, scriptedRobotSpec({ steps: [], parts: ['claw'] }, AT));
    expect('error' in result).toBe(true);
  });

  it('returns an error instead of throwing for an unknown size', () => {
    const spec = scriptedRobotSpec({ steps: STEPS, parts: ['claw'], size: 'huge' as never }, AT);
    expect(addRobot(BASE, spec)).toEqual({ error: "A robot's size is one of mini, standard, big." });
  });

  it('returns an error instead of throwing for a bad place', () => {
    const msg = { error: 'A robot needs a place: tx, tz and facing.' };
    expect(addRobot(BASE, scriptedRobotSpec({ steps: STEPS, parts: ['claw'] }, null as never))).toEqual(msg);
    expect(addRobot(BASE, scriptedRobotSpec({ steps: STEPS, parts: ['claw'] }, { tx: 1.5, tz: 2, facing: Direction.South }))).toEqual(msg);
    expect(addRobot(BASE, scriptedRobotSpec({ steps: STEPS, parts: ['claw'] }, { tx: 5, tz: 10, facing: 9 as never }))).toEqual(msg);
  });
});

// Part 2 (spec §12): programs, .MDs and zones from the console.

const PROGRAM_USAGE = 'Usage: setProgram(name, blocks.program({ stacks: [blocks.when(blocks.morning(), blocks.move())] }))';
const MD_USAGE = "Usage: setMd(name, [{ kind: 'dontGoIntoWater' }, { kind: 'doReturn', to: { kind: 'generator' }, minute: 1080 }])";
const ZONE_USAGE = "Usage: setZone('A', { x0, z0, w, d }) sets a zone and setZone('A', null) clears it. Zones are A to H.";
const ZONE_OFF_FARM = 'A zone is at least 1 × 1 tile and lies wholly inside the farm.';

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

  it("returns the usage for something that isn't a program", () => {
    for (const junk of [42, null, 'move', { kind: 'blocks' }]) {
      expect(programmedRobot(robotOf(), junk as never, TIME.dayStartMinute)).toBe(PROGRAM_USAGE);
    }
  });
});

describe('withMd', () => {
  it('sets the cards', () => {
    const cards: MdCard[] = [{ kind: 'dontGoIntoWater' }, RETURN];
    expect(withMd(robotOf(), cards)).toEqual({ ...robotOf(), md: cards });
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
    const problem = checkMd(four, robotOf());
    expect(typeof problem).toBe('string');
    expect(withMd(robotOf(), four)).toBe(problem);
  });

  it("returns the usage for something that isn't a list of cards", () => {
    for (const junk of [42, null, 'water', [{ kind: 'dance' }]]) expect(withMd(robotOf(), junk as never)).toBe(MD_USAGE);
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

  it('answers an unknown zone or a malformed rectangle with the usage', () => {
    expect(withZone(BASE, 'Z' as never, RECT)).toBe(ZONE_USAGE);
    expect(withZone(BASE, 'A', { ...RECT, x0: 1.5 })).toBe(ZONE_USAGE);
    expect(withZone(BASE, 'A', undefined as never)).toBe(ZONE_USAGE);
    expect(withZone(BASE, 'A', 'A1' as never)).toBe(ZONE_USAGE);
  });

  it('refuses a rectangle that is empty or leaves the farm', () => {
    expect(withZone(BASE, 'A', { ...RECT, w: 0 })).toBe(ZONE_OFF_FARM);
    expect(withZone(BASE, 'A', { ...RECT, d: 0 })).toBe(ZONE_OFF_FARM);
    expect(withZone(BASE, 'A', { ...RECT, x0: -1 })).toBe(ZONE_OFF_FARM);
    expect(withZone(BASE, 'A', { x0: 46, z0: 9, w: 5, d: 1 })).toBe(ZONE_OFF_FARM);
  });
});

describe('console input never throws', () => {
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
});
