/**
 * Robot derived numbers (src/robots/stats.ts) and part gating (src/robots/parts.ts).
 */
import { describe, expect, it } from 'vitest';
import type { RobotPartId, RobotSize } from '../src/core/types';
import { PART_ACTIONS, ROBOT_ACTION_KINDS, canDo } from '../src/robots/parts';
import { actionCost, bagStacks, batteryFor, carryEnergyFor, periodFor, repairCost } from '../src/robots/stats';

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
