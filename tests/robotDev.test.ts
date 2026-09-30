import { describe, expect, it } from 'vitest';
import { Direction, type RobotAction, type RobotPlace } from '../src/core/types';
import { scriptedRobotSpec } from '../src/dev/robotDev';
import { addRobot } from '../src/robots/create';
import { BASE, TARGET } from './testUtils';

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
