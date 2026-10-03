/**
 * Numbers derived from a robot's size and parts (farmclaws part 1 spec §3.3). Pure.
 */
import { ROBOTS } from '../config';
import type { Robot, RobotActionKind, RobotPartId, RobotPower, RobotSize, RobotStatCounts, RobotStats } from '../core/types';

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

/**
 * Power of a robot the player puts down (part 2 spec §7): resumedPower, except that a robot off
 * for the day stays off and doesn't wake. It keeps its power (working or standby) while it has
 * tokens, and is flat without them, so `off` only ever pairs with working, standby or flat.
 */
export function putDownPower(robot: Pick<Robot, 'power' | 'tokens' | 'off'>): RobotPower {
  if (robot.off === null) return resumedPower(robot);
  return robot.tokens > 0 ? robot.power : 'flat';
}

export function carryEnergyFor(robot: Pick<Robot, 'size'>): number {
  return ROBOTS.carryEnergy[robot.size];
}

/** A base (Mini) token cost scaled for this robot: × size, × 0.75 with an efficient core, floored, at least 1. */
export function scaledCost(robot: RobotBody, base: number): number {
  const factor = hasPart(robot, 'efficientCore') ? ROBOTS.efficientCoreFactor : 1;
  return Math.max(1, Math.floor(base * ROBOTS.sizes[robot.size].costMultiplier * factor));
}

/** Tokens an action costs: 0 stays 0; otherwise scaledCost of its base cost. */
export function actionCost(robot: RobotBody, kind: RobotActionKind): number {
  const base: number = ROBOTS.cost[kind];
  return base === 0 ? 0 : scaledCost(robot, base);
}

/** Tokens a trigger costs to wake the robot from standby (farmclaws part 2 §7). */
export function wakeCostFor(robot: RobotBody): number {
  return scaledCost(robot, ROBOTS.wakeCost);
}

const ZERO_COUNTS: RobotStatCounts = { tokens: 0, actions: 0, crops: 0 };

/** A robot's stats before it has done anything (farmclaws part 3 spec §6.1). */
export const ZERO_ROBOT_STATS: RobotStats = { today: ZERO_COUNTS, week: ZERO_COUNTS };

function addCounts(counts: RobotStatCounts, add: Partial<RobotStatCounts>): RobotStatCounts {
  return { tokens: counts.tokens + (add.tokens ?? 0), actions: counts.actions + (add.actions ?? 0), crops: counts.crops + (add.crops ?? 0) };
}

/** `stats` with `add` counted today and this week; `stats` itself when every addend is 0 or missing. */
export function addRobotStats(stats: RobotStats, add: Partial<RobotStatCounts>): RobotStats {
  if ((add.tokens ?? 0) === 0 && (add.actions ?? 0) === 0 && (add.crops ?? 0) === 0) return stats;
  return { today: addCounts(stats.today, add), week: addCounts(stats.week, add) };
}

/** Whether a day of the season starts a stats week: days 1, 8, 15 and 22. */
export function isWeekStart(dayOfSeason: number): boolean {
  return (dayOfSeason - 1) % ROBOTS.weekLength === 0;
}
