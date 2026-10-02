/**
 * Robot derived numbers (src/robots/stats.ts) and part gating (src/robots/parts.ts).
 */
import { describe, expect, it } from 'vitest';
import { ROBOTS } from '../src/config';
import { EVERY_CHOICES, type RobotActionKind, type RobotPartId, type RobotSize } from '../src/core/types';
import { PART_ACTIONS, ROBOT_ACTION_KINDS, canDo } from '../src/robots/parts';
import { actionCost, bagStacks, batteryFor, carryEnergyFor, periodFor, repairCost, scaledCost, wakeCostFor } from '../src/robots/stats';

const body = (size: RobotSize, parts: readonly RobotPartId[] = []) => ({ size, parts });

describe('robot stats', () => {
  it('scales action costs by size, with the efficient core rounding down to at least 1', () => {
    expect(actionCost(body('mini'), 'harvest')).toBe(3);
    expect(actionCost(body('standard'), 'harvest')).toBe(6);
    expect(actionCost(body('big'), 'harvest')).toBe(12);
    expect(actionCost(body('big', ['efficientCore']), 'harvest')).toBe(9);
    expect(actionCost(body('mini', ['efficientCore']), 'move')).toBe(1);
    expect(actionCost(body('big'), 'wait')).toBe(0);
    expect(actionCost(body('big'), 'powerDown')).toBe(0);
    expect(actionCost(body('standard'), 'till')).toBe(10);
  });

  it('derives battery, bag, period, repair and carry numbers', () => {
    expect([batteryFor('mini'), batteryFor('standard'), batteryFor('big')]).toEqual([80, 200, 500]);
    expect(bagStacks(body('mini'))).toBe(1);
    expect(bagStacks(body('mini', ['basket']))).toBe(3);
    expect(bagStacks(body('standard', ['basket']))).toBe(5);
    expect(periodFor(body('mini'))).toBe(4);
    expect(periodFor(body('mini', ['quickCore']))).toBe(3);
    expect([repairCost(body('mini')), repairCost(body('standard')), repairCost(body('big'))]).toEqual([300, 800, 2000]);
    expect([carryEnergyFor(body('mini')), carryEnergyFor(body('big'))]).toEqual([4, 16]);
  });

  it('gates actions on parts', () => {
    expect(ROBOT_ACTION_KINDS).toHaveLength(12);
    expect(new Set(ROBOT_ACTION_KINDS).size).toBe(12);
    expect(canDo(body('mini', ['claw']), 'water')).toBe(false);
    expect(canDo(body('mini', ['claw']), 'move')).toBe(true);
    expect(canDo(body('mini', ['wateringHead']), 'water')).toBe(true);
    expect(canDo(body('mini', ['wateringHead']), 'refill')).toBe(true);
    expect(PART_ACTIONS.plant).toBe('seeder');
    expect(PART_ACTIONS.till).toBe('tiller');
  });
});

describe('robot stats for the language (part 2)', () => {
  /** Every action's cost per body, written out so a change to the scaling rule shows up here. */
  const COSTS: readonly [RobotSize, readonly RobotPartId[], Readonly<Record<RobotActionKind, number>>][] = [
    ['mini', [], { move: 1, turn: 1, water: 2, harvest: 3, till: 5, plant: 3, refill: 1, deposit: 1, take: 1, say: 1, wait: 0, powerDown: 0 }],
    ['standard', [], { move: 2, turn: 2, water: 4, harvest: 6, till: 10, plant: 6, refill: 2, deposit: 2, take: 2, say: 2, wait: 0, powerDown: 0 }],
    ['big', [], { move: 4, turn: 4, water: 8, harvest: 12, till: 20, plant: 12, refill: 4, deposit: 4, take: 4, say: 4, wait: 0, powerDown: 0 }],
    ['mini', ['efficientCore'], { move: 1, turn: 1, water: 1, harvest: 2, till: 3, plant: 2, refill: 1, deposit: 1, take: 1, say: 1, wait: 0, powerDown: 0 }],
    ['standard', ['efficientCore'], { move: 1, turn: 1, water: 3, harvest: 4, till: 7, plant: 4, refill: 1, deposit: 1, take: 1, say: 1, wait: 0, powerDown: 0 }],
    ['big', ['efficientCore'], { move: 3, turn: 3, water: 6, harvest: 9, till: 15, plant: 9, refill: 3, deposit: 3, take: 3, say: 3, wait: 0, powerDown: 0 }],
  ];

  it.each(COSTS)('keeps every action cost for a %s with %j', (size, parts, costs) => {
    for (const kind of ROBOT_ACTION_KINDS) expect([kind, actionCost(body(size, parts), kind)]).toEqual([kind, costs[kind]]);
  });

  it('scales a base cost the way actions are scaled', () => {
    expect(scaledCost(body('mini'), 5)).toBe(5);
    expect(scaledCost(body('big'), 5)).toBe(20);
    expect(scaledCost(body('standard', ['efficientCore']), 1)).toBe(1);
    expect(scaledCost(body('big', ['efficientCore']), 2)).toBe(6);
  });

  it('charges a size-scaled wake cost', () => {
    expect(wakeCostFor(body('mini'))).toBe(1);
    expect(wakeCostFor(body('standard'))).toBe(2);
    expect(wakeCostFor(body('big'))).toBe(4);
    expect(wakeCostFor(body('big', ['efficientCore']))).toBe(3);
  });

  it('gives each size its block, variable and .MD card limits', () => {
    const limits = (size: RobotSize) => [ROBOTS.sizes[size].blocks, ROBOTS.sizes[size].vars, ROBOTS.sizes[size].mdCards];
    expect(limits('mini')).toEqual([12, 1, 3]);
    expect(limits('standard')).toEqual([30, 3, 6]);
    expect(limits('big')).toEqual([80, 6, 10]);
  });

  it('has the language numbers from the spec', () => {
    expect(ROBOTS).toMatchObject({
      stepBudget: 50,
      maxStacks: 8,
      maxFrames: 16,
      maxNumber: 999_999,
      maxTextLength: 60,
      maxIdentifierLength: 16,
      wakeCost: 1,
      maxRepeatTimes: 999,
    });
    expect(ROBOTS.everyChoices).toEqual([5, 10, 15, 30, 60]);
    expect(ROBOTS.everyChoices).toBe(EVERY_CHOICES);
  });
});
