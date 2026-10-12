/**
 * Adding robots to the farm (farmclaws part 1 spec §3.4).
 */
import { PROFILE, ROBOTS } from '../config';
import {
  DIRECTIONS,
  ROBOT_HOME_MAPS,
  ROBOT_MAP_IDS,
  ROBOT_OWNERS,
  ROBOT_PART_IDS,
  ROBOT_SIZES,
  type GameState,
  type MdCard,
  type Robot,
  type RobotMapId,
  type RobotOwner,
  type RobotPartId,
  type RobotPlace,
  type RobotProgram,
  type RobotSize,
} from '../core/types';
import { isMdShape, isProgramShape } from '../state/robotValidation';
import { isValidName } from '../state/sectionValidation';
import { isCanonicalSubset, isInt, isOneOf } from '../state/validation';
import { MAPS, isReservedTile } from '../world/maps';
import { getTile, isWalkable } from '../world/tiles';
import { checkMd, checkProgram } from './check';
import { MD_SHAPE, PROGRAM_SHAPE } from './edits';
import { execAt } from './exec';
import { ZERO_ROBOT_STATS, batteryFor, hasPart, periodFor } from './stats';

export interface RobotSpec {
  readonly name: string;
  readonly size: RobotSize;
  readonly parts: readonly RobotPartId[];
  /** Where it's delivered. */
  readonly place: RobotPlace;
  readonly program: RobotProgram;
  /** The robot's .MD; none when left out. */
  readonly md?: readonly MdCard[];
  /** The map it lives on; the farm when left out (part 4c spec §5.1). */
  readonly mapId?: RobotMapId;
  /** Whose robot it is; the player's when left out. */
  readonly owner?: RobotOwner;
}

export type AddRobotResult = { readonly state: GameState; readonly id: number } | { readonly error: string };

/** The robot name rule's refusal (isValidName). */
export const ROBOT_NAME_RULE = `A robot needs a name of 1 to ${PROFILE.maxNameLength} characters.`;

/** The cap's refusal; the cap counts deliveries due wherever a robot is ordered (part 4b spec §4.5). */
export const ROBOT_CAP_RULE = `The farm already has ${ROBOTS.maxRobots} robots.`;

/** How many of `list` are the player's: the robots the cap counts (part 4c spec §5.1). */
export function playerRobotCount(list: readonly Pick<Robot, 'owner'>[]): number {
  return list.filter((robot) => robot.owner === 'player').length;
}

function specProblem(state: GameState, spec: RobotSpec): string | null {
  const mapId: unknown = spec.mapId ?? 'farm';
  const owner: unknown = spec.owner ?? 'player';
  if (!isOneOf(mapId, ROBOT_MAP_IDS) || !isOneOf(owner, ROBOT_OWNERS) || ROBOT_HOME_MAPS[owner] !== mapId) {
    return "The player's robots live on the farm, and the neighbours' on the Neighbours map.";
  }
  if (owner === 'player' && playerRobotCount(state.robots.list) >= ROBOTS.maxRobots) return ROBOT_CAP_RULE;
  if (!isValidName(spec.name)) return ROBOT_NAME_RULE;
  if (!(ROBOT_SIZES as readonly unknown[]).includes(spec.size)) return `A robot's size is one of ${ROBOT_SIZES.join(', ')}.`;
  if (!isCanonicalSubset(spec.parts, ROBOT_PART_IDS)) return 'Parts must be listed once each, in catalogue order.';
  if (spec.parts.length > ROBOTS.sizes[spec.size].partSlots) return `A ${spec.size} robot has room for ${ROBOTS.sizes[spec.size].partSlots} parts.`;
  if (!isProgramShape(spec.program)) return PROGRAM_SHAPE;
  const programProblem = checkProgram(spec.program, spec);
  if (programProblem !== null) return programProblem;
  const md: unknown = spec.md ?? [];
  if (!isMdShape(md)) return MD_SHAPE;
  const mdProblem = checkMd(md, spec);
  if (mdProblem !== null) return mdProblem;
  const place: unknown = spec.place;
  if (typeof place !== 'object' || place === null) return 'A robot needs a place: tx, tz and facing.';
  const { tx, tz, facing } = place as Record<string, unknown>;
  if (!isInt(tx) || !isInt(tz) || !(DIRECTIONS as readonly unknown[]).includes(facing)) return 'A robot needs a place: tx, tz and facing.';
  const tile = getTile(state.maps[mapId], tx, tz);
  if (tile === null || !isWalkable(tile) || isReservedTile(MAPS[mapId], tx, tz)) {
    return mapId === 'farm' ? 'Robots are delivered to open ground on the farm.' : 'Robots are delivered to open ground on the Neighbours map.';
  }
  return null;
}

/**
 * A new robot from `spec`, numbered `id`, at `spec.place` on its map: fully charged, working, not
 * carried, with an empty bag. A block program starts idle at `minuteOfDay` (execAt: atTime
 * triggers already past are spent). It doesn't check the spec; addRobot does.
 */
export function newRobot(spec: RobotSpec, id: number, minuteOfDay: number): Robot {
  return {
    id,
    name: spec.name,
    size: spec.size,
    mapId: spec.mapId ?? 'farm',
    owner: spec.owner ?? 'player',
    parts: spec.parts,
    tx: spec.place.tx,
    tz: spec.place.tz,
    facing: spec.place.facing,
    bag: [],
    tank: hasPart(spec, 'wateringHead') ? ROBOTS.tankCapacity : 0,
    tokens: batteryFor(spec.size),
    power: 'working',
    carried: false,
    onBench: false,
    program: spec.program,
    pc: 0,
    exec: spec.program.kind === 'blocks' ? execAt(spec.program, minuteOfDay) : null,
    md: spec.md ?? [],
    off: null,
    nextActMinute: minuteOfDay + periodFor(spec),
    repairReadyDay: null,
    stats: ZERO_ROBOT_STATS,
    moveSeq: 0,
    teleportSeq: 0,
    actionSeq: 0,
    lastAction: null,
    paint: 0,
  };
}

/**
 * Adds a robot at `spec.place` on its map (newRobot), fully charged (not from the pool). Its
 * morning stack first runs at the next morning reset. Only the player's robots count towards the cap.
 */
export function addRobot(state: GameState, spec: RobotSpec): AddRobotResult {
  const problem = specProblem(state, spec);
  if (problem !== null) return { error: problem };
  const id = state.robots.nextId;
  const robot = newRobot(spec, id, state.time.minuteOfDay);
  return { state: { ...state, robots: { ...state.robots, nextId: id + 1, list: [...state.robots.list, robot] } }, id };
}
