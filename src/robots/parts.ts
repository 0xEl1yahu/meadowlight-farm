/**
 * Which part each robot action needs (farmclaws design §3.7). Keyed by every action kind, so
 * the compiler keeps ROBOT_ACTION_KINDS in step with the RobotAction union.
 */
import type { Robot, RobotActionKind, RobotPartId } from '../core/types';

export const PART_ACTIONS = {
  move: null,
  turn: null,
  say: null,
  wait: null,
  powerDown: null,
  harvest: 'claw',
  deposit: 'claw',
  take: 'claw',
  water: 'wateringHead',
  refill: 'wateringHead',
  till: 'tiller',
  plant: 'seeder',
} as const satisfies Readonly<Record<RobotActionKind, RobotPartId | null>>;

/** Every action kind, each once. */
export const ROBOT_ACTION_KINDS = Object.keys(PART_ACTIONS) as readonly RobotActionKind[];

/** Whether the robot has the part `kind` needs (built-in actions always pass). */
export function canDo(robot: Pick<Robot, 'parts'>, kind: RobotActionKind): boolean {
  const part: RobotPartId | null = PART_ACTIONS[kind];
  return part === null || robot.parts.includes(part);
}
