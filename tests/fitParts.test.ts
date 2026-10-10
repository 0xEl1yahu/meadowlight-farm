/**
 * Fitting parts at the workbench (farmclaws part 4b spec §5): `robot/fit` and `robot/unfit`
 * move a part between the backpack and the robot on the bench. Slots, duplicates, catalogue
 * order, the watering head's tank, a full backpack, the sensor-eye and basket refusals, the
 * bench-only, ruined and paused guards, and scrapping returning the robot's parts.
 */
import { describe, expect, it } from 'vitest';
import { ROBOTS } from '../src/config';
import type { GameState, Robot } from '../src/core/types';
import { b } from '../src/robots/blocks';
import { checkProgram } from '../src/robots/check';
import { withPartFitted, withPartRemoved } from '../src/robots/edits';
import { morningExec } from '../src/robots/exec';
import { requireRobot } from '../src/robots/world';
import { actions } from '../src/state/actions';
import { isValidGameState } from '../src/state/persistence';
import { gameReducer } from '../src/state/reducer';
import { BASE, benchedRobotOf, count, robotOf, stack, withRobots, withSlots } from './testUtils';

const lastMessage = (state: GameState) => state.messages.entries.at(-1);

/** `robot` on the bench with its screen open, and `stacks` in the backpack. */
function atBench(robot: Robot, stacks: Parameters<typeof withSlots>[1] = []): GameState {
  const state = withSlots(withRobots(BASE, [robot]), stacks);
  return { ...state, ui: { ...state.ui, panel: { kind: 'robot', robotId: robot.id, mode: 'bench' } } };
}

/** A backpack with every unlocked slot full of stone. */
const FULL = Array.from({ length: BASE.inventory.unlockedSlots }, () => stack('stone', 999));

/** A block program that asks whether it's raining: it needs a sensor eye. */
const RAIN_CHECK = b.program({ stacks: [b.when(b.morning(), b.if(b.itIsRaining(), [b.move()]))] });

describe('fitting a part', () => {
  it('moves one part from the backpack into a free slot, keeping catalogue order', () => {
    const state = atBench(benchedRobotOf({ size: 'standard', parts: ['tiller'] }), [stack('claw', 2)]);
    const next = gameReducer(state, actions.fitPart(1, 'claw'));
    expect(requireRobot(next, 1).parts).toEqual(['claw', 'tiller']);
    expect(count(next, 'claw')).toBe(1);
    expect(lastMessage(next)).toMatchObject({ text: 'Fitted a claw to Sprocket.', tone: 'success' });
    expect(isValidGameState(next)).toBe(true);
  });

  it('says "an" before a vowel', () => {
    const state = atBench(benchedRobotOf({ size: 'standard' }), [stack('efficientCore', 1)]);
    const next = gameReducer(state, actions.fitPart(1, 'efficientCore'));
    expect(requireRobot(next, 1).parts).toEqual(['claw', 'efficientCore']);
    expect(lastMessage(next)?.text).toBe('Fitted an efficient core to Sprocket.');
  });

  it('refuses a robot with no free slot, and changes nothing', () => {
    const state = atBench(benchedRobotOf(), [stack('tiller', 1)]);
    const next = gameReducer(state, actions.fitPart(1, 'tiller'));
    expect(next.robots).toBe(state.robots);
    expect(next.inventory).toBe(state.inventory);
    expect(lastMessage(next)).toMatchObject({ text: 'Sprocket has no free part slot.', tone: 'warn' });
  });

  it('refuses a part the robot already has', () => {
    const state = atBench(benchedRobotOf({ size: 'big' }), [stack('claw', 1)]);
    const next = gameReducer(state, actions.fitPart(1, 'claw'));
    expect(next.robots).toBe(state.robots);
    expect(next.inventory).toBe(state.inventory);
    expect(lastMessage(next)).toMatchObject({ text: 'Sprocket already has a claw.', tone: 'warn' });
    expect(withPartFitted(robotOf({ size: 'big', parts: ['antenna'] }), 'antenna')).toBe('Sprocket already has an antenna.');
  });

  it('fills a watering head\'s tank', () => {
    const state = atBench(benchedRobotOf({ size: 'standard' }), [stack('wateringHead', 1)]);
    const robot = requireRobot(gameReducer(state, actions.fitPart(1, 'wateringHead')), 1);
    expect(robot.parts).toEqual(['claw', 'wateringHead']);
    expect(robot.tank).toBe(ROBOTS.tankCapacity);
  });

  it('does nothing without the part in the backpack, or for something that isn\'t a part', () => {
    const state = atBench(benchedRobotOf({ size: 'standard' }), [stack('wood', 5)]);
    expect(gameReducer(state, actions.fitPart(1, 'tiller'))).toBe(state);
    expect(gameReducer(state, actions.fitPart(1, 'wood' as never))).toBe(state);
  });
});

describe('taking a part off', () => {
  it('moves the part into the backpack', () => {
    const state = atBench(benchedRobotOf({ size: 'standard', parts: ['claw', 'tiller'] }));
    const next = gameReducer(state, actions.unfitPart(1, 'claw'));
    expect(requireRobot(next, 1).parts).toEqual(['tiller']);
    expect(count(next, 'claw')).toBe(count(state, 'claw') + 1);
    expect(lastMessage(next)).toMatchObject({ text: 'Took the claw off Sprocket.', tone: 'success' });
    expect(isValidGameState(next)).toBe(true);
  });

  it('leaves a program that uses the part as it is', () => {
    const program = { kind: 'script' as const, steps: [{ kind: 'harvest' as const }], loop: true };
    const next = gameReducer(atBench(benchedRobotOf({ program })), actions.unfitPart(1, 'claw'));
    expect(requireRobot(next, 1)).toMatchObject({ parts: [], program });
  });

  it('empties a watering head\'s tank', () => {
    const state = atBench(benchedRobotOf({ size: 'standard', parts: ['claw', 'wateringHead'], tank: 12 }));
    const robot = requireRobot(gameReducer(state, actions.unfitPart(1, 'wateringHead')), 1);
    expect(robot).toMatchObject({ parts: ['claw'], tank: 0 });
  });

  it('refuses when the backpack is full', () => {
    const state = atBench(benchedRobotOf(), FULL);
    const next = gameReducer(state, actions.unfitPart(1, 'claw'));
    expect(next.robots).toBe(state.robots);
    expect(next.inventory).toBe(state.inventory);
    expect(lastMessage(next)).toMatchObject({ text: 'Your inventory is full.', tone: 'warn' });
  });

  it("refuses the sensor eye while the program uses a sensor, so the program stays valid", () => {
    const robot = benchedRobotOf({ size: 'standard', parts: ['claw', 'sensorEye'], program: RAIN_CHECK, exec: morningExec(RAIN_CHECK) });
    const state = atBench(robot);
    const next = gameReducer(state, actions.unfitPart(1, 'sensorEye'));
    expect(next.robots).toBe(state.robots);
    expect(lastMessage(next)).toMatchObject({ text: "Sprocket's program uses the sensor eye.", tone: 'warn' });
    expect(checkProgram(requireRobot(next, 1).program, requireRobot(next, 1))).toBeNull();
    // Without a sensor in the program, the eye comes off.
    const plain = gameReducer(atBench({ ...robot, program: robotOf().program, exec: null }), actions.unfitPart(1, 'sensorEye'));
    expect(requireRobot(plain, 1).parts).toEqual(['claw']);
    expect(lastMessage(plain)?.text).toBe('Took the sensor eye off Sprocket.');
  });

  it("refuses the basket while the bag holds more stacks than the robot could carry without it", () => {
    const bag = [stack('parsnip', 3), stack('wood', 2)];
    const robot = benchedRobotOf({ parts: ['basket'], bag });
    expect(bag.length).toBeGreaterThan(ROBOTS.sizes.mini.bagStacks);
    const state = atBench(robot);
    const next = gameReducer(state, actions.unfitPart(1, 'basket'));
    expect(next.robots).toBe(state.robots);
    expect(lastMessage(next)).toMatchObject({ text: "Empty Sprocket's bag before taking the basket off.", tone: 'warn' });
    // One stack fits a Mini without the basket.
    const light = gameReducer(atBench({ ...robot, bag: [stack('wood', 2)] }), actions.unfitPart(1, 'basket'));
    expect(requireRobot(light, 1)).toMatchObject({ parts: [], bag: [stack('wood', 2)] });
    expect(isValidGameState(light)).toBe(true);
  });

  it('does nothing for a part the robot hasn\'t got', () => {
    const state = atBench(benchedRobotOf());
    expect(gameReducer(state, actions.unfitPart(1, 'tiller'))).toBe(state);
    expect(withPartRemoved(robotOf(), 'tiller')).toBe('Sprocket has no tiller.');
  });
});

describe('the bench rules', () => {
  it('refuses a robot off the bench, with the bench toast', () => {
    const state = atBench(robotOf({ size: 'standard' }), [stack('tiller', 1)]);
    for (const action of [actions.fitPart(1, 'tiller'), actions.unfitPart(1, 'claw')]) {
      const next = gameReducer(state, action);
      expect(next.robots).toBe(state.robots);
      expect(next.inventory).toBe(state.inventory);
      expect(lastMessage(next)?.text).toBe('Put Sprocket on the workbench first.');
    }
  });

  it('refuses a ruined robot', () => {
    const state = atBench(benchedRobotOf({ size: 'standard', power: 'ruined', tokens: 0 }), [stack('tiller', 1)]);
    for (const action of [actions.fitPart(1, 'tiller'), actions.unfitPart(1, 'claw')]) {
      const next = gameReducer(state, action);
      expect(next.robots).toBe(state.robots);
      expect(next.inventory).toBe(state.inventory);
      expect(lastMessage(next)?.text).toBe('Sprocket is ruined. It can only be scrapped.');
    }
  });

  it('does nothing while paused, or for an unknown robot', () => {
    const open = atBench(benchedRobotOf({ size: 'standard' }), [stack('tiller', 1)]);
    const paused: GameState = { ...open, ui: { ...open.ui, paused: true } };
    expect(gameReducer(paused, actions.fitPart(1, 'tiller'))).toBe(paused);
    expect(gameReducer(paused, actions.unfitPart(1, 'claw'))).toBe(paused);
    expect(gameReducer(open, actions.fitPart(9, 'tiller'))).toBe(open);
    expect(gameReducer(open, actions.unfitPart(9, 'claw'))).toBe(open);
  });
});

describe('scrapping returns the parts', () => {
  it("puts the robot's parts into the backpack with its bag", () => {
    const state = atBench(benchedRobotOf({ size: 'standard', parts: ['claw', 'basket'], bag: [stack('wood', 3)] }), [stack('claw', 1)]);
    const next = gameReducer(state, actions.scrapRobot(1));
    expect(next.robots.list).toEqual([]);
    expect(count(next, 'claw')).toBe(2);
    expect(count(next, 'basket')).toBe(1);
    expect(count(next, 'wood')).toBe(3);
    expect(lastMessage(next)?.text).toBe('Scrapped Sprocket for 1000g.');
  });

  it("refuses when the parts don't all fit, and changes nothing", () => {
    const slots = [...FULL.slice(1), stack('wood', 999 - 3)];
    const state = atBench(benchedRobotOf({ bag: [stack('wood', 3)] }), slots);
    const next = gameReducer(state, actions.scrapRobot(1));
    expect(next.robots).toBe(state.robots);
    expect(next.inventory).toBe(state.inventory);
    expect(lastMessage(next)).toMatchObject({ text: "Make room in your backpack for Sprocket's bag first.", tone: 'warn' });
  });
});
