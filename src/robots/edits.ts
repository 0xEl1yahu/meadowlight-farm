/**
 * Editing a robot's program, .MD and parts and the farm's zones (farmclaws part 2 spec §12, part 3
 * spec §4.7, part 4b spec §5.2). The workbench's reducer actions and the dev hooks make every edit
 * through these, after the same gate: isProgramShape → checkProgram and isMdShape → checkMd. Pure.
 *
 * The refusals for malformed input never name a dev hook: this module is in the production bundle,
 * which the dist check greps for hook names. The hooks print their usage line instead.
 */
import { ROBOTS, TIME } from '../config';
import { withArticle } from '../core/text';
import { ROBOT_PART_IDS, ZONE_IDS, type GameState, type MdCard, type Robot, type RobotPartId, type RobotProgram, type ZoneId, type ZoneRect } from '../core/types';
import { partNoun } from '../items/items';
import { isMdShape, isProgramShape } from '../state/robotValidation';
import { isInt, isObj, isOneOf } from '../state/validation';
import { checkMd, checkProgram, isValidZoneRect } from './check';
import { execAt, morningExec } from './exec';
import { bagStacks, hasPart, periodFor } from './stats';

export const PROGRAM_SHAPE = 'That program is not a script or a block program.';
export const MD_SHAPE = 'That .MD is not a list of cards.';
export const ZONE_SHAPE = 'Zones are A to H, and a zone is { x0, z0, w, d } or null.';
export const ZONE_OFF_FARM = 'A zone is at least 1 × 1 tile and lies wholly inside the farm.';
export const MD_SCRIPT = '.MD cards only apply to block programs.';

/** Powers a new program doesn't change: the robot needs charging, rescuing or repairing first, or can only be scrapped (ruined). */
const KEPT_POWERS: ReadonlySet<Robot['power']> = new Set<Robot['power']>(['flat', 'broken', 'repairing', 'ruined']);

/**
 * `robot` with a new program, set up the way the morning reset would (part 2 spec §12). A block
 * program starts its `morning` stack only if `minuteOfDay` is no later than the robot's first
 * act of the day (TIME.dayStartMinute + its period); later it idles until a trigger fires, with
 * the atTime triggers already past today spent (execAt). A script runs from step 0. Either way
 * the robot turns back on and acts one period from now; a flat, broken, repairing or ruined robot
 * keeps its power. Returns the checker's sentence instead when the program fails, or PROGRAM_SHAPE when
 * it isn't a program at all.
 */
export function programmedRobot(robot: Robot, program: RobotProgram, minuteOfDay: number): Robot | string {
  if (!isProgramShape(program)) return PROGRAM_SHAPE;
  const problem = checkProgram(program, robot);
  if (problem !== null) return problem;
  const early = minuteOfDay <= TIME.dayStartMinute + periodFor(robot);
  const exec = program.kind === 'blocks' ? (early ? morningExec(program) : execAt(program, minuteOfDay)) : null;
  const runs = exec === null || exec.running !== null;
  return {
    ...robot,
    program,
    pc: 0,
    exec,
    // A new program clears 'dizzy' and 'done'; only the bench's switch turns a 'player' robot on.
    off: robot.off === 'player' ? 'player' : null,
    power: KEPT_POWERS.has(robot.power) ? robot.power : runs ? 'working' : 'standby',
    nextActMinute: minuteOfDay + periodFor(robot),
  };
}

/**
 * `robot` with a new .MD. The cards apply at once: today's carried-out DO cards are forgotten
 * (their indices may name other cards now), and a DO return under way stops, because its card
 * may be gone; a working robot then stands by until a trigger or a DO card moves it. A robot
 * running a script is refused: .MD cards only apply to block programs. Returns the checker's
 * sentence for cards the robot can't hold, or MD_SHAPE when `md` isn't a list of cards.
 */
export function withMd(robot: Robot, md: readonly MdCard[]): Robot | string {
  if (!isMdShape(md)) return MD_SHAPE;
  const exec = robot.exec;
  if (exec === null) return MD_SCRIPT;
  const problem = checkMd(md, robot);
  if (problem !== null) return problem;
  const returning = exec.running === null && exec.frames.length > 0;
  return {
    ...robot,
    md,
    exec: { ...exec, frames: returning ? [] : exec.frames, doneCards: [] },
    power: returning && robot.power === 'working' ? 'standby' : robot.power,
  };
}

/**
 * `robot` with `part` fitted (part 4b spec §5.2): `parts` stays in catalogue order, and a watering
 * head comes with a full tank. Returns the refusal for a part it already has or a robot with no
 * free slot.
 */
export function withPartFitted(robot: Robot, part: RobotPartId): Robot | string {
  if (hasPart(robot, part)) return `${robot.name} already has ${withArticle(partNoun(part))}.`;
  if (robot.parts.length >= ROBOTS.sizes[robot.size].partSlots) return `${robot.name} has no free part slot.`;
  return {
    ...robot,
    parts: ROBOT_PART_IDS.filter((id) => id === part || hasPart(robot, id)),
    tank: part === 'wateringHead' ? ROBOTS.tankCapacity : robot.tank,
  };
}

/**
 * `robot` with `part` taken off, so a saved robot stays valid: the sensor eye stays while the
 * program needs it (removing a part only ever fails checkProgram's sensor rule), the basket while
 * the bag holds more stacks than the robot could carry without it, and a watering head's tank
 * empties. The reducer only sends parts the robot has; for one it hasn't, the refusal says so.
 */
export function withPartRemoved(robot: Robot, part: RobotPartId): Robot | string {
  if (!hasPart(robot, part)) return `${robot.name} has no ${partNoun(part)}.`;
  const parts = robot.parts.filter((id) => id !== part);
  if (checkProgram(robot.program, { size: robot.size, parts }) !== null) return `${robot.name}'s program uses the sensor eye.`;
  if (robot.bag.length > bagStacks({ size: robot.size, parts })) return `Empty ${robot.name}'s bag before taking the basket off.`;
  return { ...robot, parts, tank: part === 'wateringHead' ? 0 : robot.tank };
}

function isZoneRectShape(v: unknown): v is ZoneRect {
  return isObj(v) && isInt(v.x0) && isInt(v.z0) && isInt(v.w) && isInt(v.d);
}

/**
 * `state` with zone `id` set to `rect` (only its four fields) or cleared with null. Returns
 * ZONE_OFF_FARM for a rectangle that is empty or leaves the farm, and ZONE_SHAPE for an unknown
 * zone or something that isn't a rectangle.
 */
export function withZone(state: GameState, id: ZoneId, rect: ZoneRect | null): GameState | string {
  if (!isOneOf(id, ZONE_IDS) || (rect !== null && !isZoneRectShape(rect))) return ZONE_SHAPE;
  if (rect !== null && !isValidZoneRect(rect)) return ZONE_OFF_FARM;
  const zone: ZoneRect | null = rect === null ? null : { x0: rect.x0, z0: rect.z0, w: rect.w, d: rect.d };
  return { ...state, robots: { ...state.robots, zones: { ...state.robots.zones, [id]: zone } } };
}
