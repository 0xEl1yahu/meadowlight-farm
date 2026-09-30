/**
 * Numbers derived from a robot's size and parts (farmclaws part 1 spec §3.3). Pure.
 */
import { ROBOTS } from '../config';
import type { Robot, RobotActionKind, RobotPartId, RobotPower, RobotSize } from '../core/types';

export type RobotBody = Pick<Robot, 'size' | 'parts'>;

export function hasPart(robot: Pick<Robot, 'parts'>, part: RobotPartId): boolean {
  return robot.parts.includes(part);
}

export function batteryFor(size: RobotSize): number {
  return ROBOTS.sizes[size].battery;
}

export function bagStacks(robot: RobotBody): number {
  return ROBOTS.sizes[robot.size].bagStacks + (hasPart(robot, 'basket') ? ROBOTS.basketExtraStacks : 0);
}

/** Minutes between a robot's actions. */
export function periodFor(robot: Pick<Robot, 'parts'>): number {
  return hasPart(robot, 'quickCore') ? ROBOTS.quickCorePeriod : ROBOTS.period;
}

export function repairCost(robot: Pick<Robot, 'size'>): number {
  return Math.round(ROBOTS.sizes[robot.size].price * ROBOTS.repairShare);
}

/**
 * Power of a robot going back to work, after being put down or each morning (spec §5.7, §5.8):
 * a broken robot stays broken; any other robot works if it has tokens, else it's flat.
 */
export function resumedPower(robot: Pick<Robot, 'power' | 'tokens'>): RobotPower {
  if (robot.power === 'broken') return 'broken';
  return robot.tokens > 0 ? 'working' : 'flat';
}

export function carryEnergyFor(robot: Pick<Robot, 'size'>): number {
  return ROBOTS.carryEnergy[robot.size];
}

/** Tokens an action costs: 0 stays 0; otherwise base × size, × 0.75 with an efficient core, floored, at least 1. */
export function actionCost(robot: RobotBody, kind: RobotActionKind): number {
  const base: number = ROBOTS.cost[kind];
  if (base === 0) return 0;
  const factor = hasPart(robot, 'efficientCore') ? ROBOTS.efficientCoreFactor : 1;
  return Math.max(1, Math.floor(base * ROBOTS.sizes[robot.size].costMultiplier * factor));
}
