/**
 * Adding robots to the farm (farmclaws part 1 spec §3.4).
 */
import { PROFILE, ROBOTS } from '../config';
import { DIRECTIONS, ROBOT_PART_IDS, ROBOT_SIZES, type GameState, type Robot, type RobotPartId, type RobotPlace, type RobotProgram, type RobotSize } from '../core/types';
import { isValidRobotProgram } from '../state/robotValidation';
import { isValidName } from '../state/sectionValidation';
import { isCanonicalSubset, isInt } from '../state/validation';
import { MAPS, isReservedTile } from '../world/maps';
import { getTile, isWalkable } from '../world/tiles';
import { batteryFor, hasPart, periodFor } from './stats';

export interface RobotSpec {
  readonly name: string;
  readonly size: RobotSize;
  readonly parts: readonly RobotPartId[];
  /** Where it's delivered. */
  readonly place: RobotPlace;
  readonly program: RobotProgram;
}

export type AddRobotResult = { readonly state: GameState; readonly id: number } | { readonly error: string };

function specProblem(state: GameState, spec: RobotSpec): string | null {
  if (state.robots.list.length >= ROBOTS.maxRobots) return `The farm already has ${ROBOTS.maxRobots} robots.`;
  if (!isValidName(spec.name)) return `A robot needs a name of 1 to ${PROFILE.maxNameLength} characters.`;
  if (!(ROBOT_SIZES as readonly unknown[]).includes(spec.size)) return `A robot's size is one of ${ROBOT_SIZES.join(', ')}.`;
  if (!isCanonicalSubset(spec.parts, ROBOT_PART_IDS)) return 'Parts must be listed once each, in catalogue order.';
  if (spec.parts.length > ROBOTS.sizes[spec.size].partSlots) return `A ${spec.size} robot has room for ${ROBOTS.sizes[spec.size].partSlots} parts.`;
  if (!isValidRobotProgram(spec.program)) return 'That program is not a valid script.';
  const place: unknown = spec.place;
  if (typeof place !== 'object' || place === null) return 'A robot needs a place: tx, tz and facing.';
  const { tx, tz, facing } = place as Record<string, unknown>;
  if (!isInt(tx) || !isInt(tz) || !(DIRECTIONS as readonly unknown[]).includes(facing)) return 'A robot needs a place: tx, tz and facing.';
  const tile = getTile(state.maps.farm, tx, tz);
  if (tile === null || !isWalkable(tile) || isReservedTile(MAPS.farm, tx, tz)) return 'Robots are delivered to open ground on the farm.';
  return null;
}

/** Adds a robot at `spec.place`, fully charged (not from the pool), working and not carried. */
export function addRobot(state: GameState, spec: RobotSpec): AddRobotResult {
  const problem = specProblem(state, spec);
  if (problem !== null) return { error: problem };
  const id = state.robots.nextId;
  const robot: Robot = {
    id,
    name: spec.name,
    size: spec.size,
    parts: spec.parts,
    tx: spec.place.tx,
    tz: spec.place.tz,
    facing: spec.place.facing,
    bag: [],
    tank: hasPart(spec, 'wateringHead') ? ROBOTS.tankCapacity : 0,
    tokens: batteryFor(spec.size),
    power: 'working',
    carried: false,
    program: spec.program,
    pc: 0,
    nextActMinute: state.time.minuteOfDay + periodFor(spec),
    repairReadyDay: null,
    tokensToday: 0,
    moveSeq: 0,
    teleportSeq: 0,
    actionSeq: 0,
    lastAction: null,
  };
  return { state: { ...state, robots: { ...state.robots, nextId: id + 1, list: [...state.robots.list, robot] } }, id };
}
