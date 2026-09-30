/**
 * Save validation for the robots section (farmclaws part 1 spec §6.2). Every check is a type
 * guard that returns false on any unexpected shape and never throws.
 */
import { ROBOTS, TIME } from '../config';
import {
  Blocker,
  CROP_IDS,
  MAP_IDS,
  QUALITIES,
  ROBOT_BLOCK_REASONS,
  ROBOT_LOG_EVENT_KINDS,
  ROBOT_PART_IDS,
  ROBOT_POWERS,
  ROBOT_SIZES,
  type GameState,
  type RobotAction,
  type RobotPartId,
  type RobotProgram,
  type WorldState,
} from '../core/types';
import { isItemId } from '../items/items';
import { ROBOT_ACTION_KINDS } from '../robots/parts';
import { bagStacks, batteryFor } from '../robots/stats';
import { inBounds } from '../world/grid';
import { forEachTile, getTile, isWalkable } from '../world/tiles';
import { isValidName } from './sectionValidation';
import { hasExactKeys, isBool, isCanonicalSubset, isCount, isInt, isIntIn, isObj, isOneOf, isValidStack } from './validation';

const MAX = Number.MAX_SAFE_INTEGER;

const ROBOT_KEYS = [
  'id', 'name', 'size', 'parts', 'tx', 'tz', 'facing', 'bag', 'tank', 'tokens', 'power', 'carried', 'program', 'pc',
  'nextActMinute', 'repairReadyDay', 'tokensToday', 'moveSeq', 'teleportSeq', 'actionSeq', 'lastAction',
] as const;

/** Wood burners work the farm's robots, so a burner on another map means a corrupt save. */
function burnersOnlyOnFarm(maps: GameState['maps']): boolean {
  let stray = false;
  for (const id of MAP_IDS.filter((mapId) => mapId !== 'farm')) {
    forEachTile(maps[id], (tile) => {
      if (tile.object?.kind === 'woodBurner') stray = true;
    });
  }
  return !stray;
}

export function isValidRobotAction(v: unknown): v is RobotAction {
  if (!isObj(v) || typeof v.kind !== 'string') return false;
  switch (v.kind) {
    case 'move':
    case 'water':
    case 'harvest':
    case 'till':
    case 'refill':
    case 'deposit':
    case 'powerDown':
      return hasExactKeys(v, ['kind']);
    case 'turn':
      return hasExactKeys(v, ['kind', 'side']) && (v.side === 'left' || v.side === 'right');
    case 'plant':
      return hasExactKeys(v, ['kind', 'cropId']) && isOneOf(v.cropId, CROP_IDS);
    case 'take':
      return hasExactKeys(v, ['kind', 'itemId']) && isItemId(v.itemId);
    case 'say': {
      if (!hasExactKeys(v, ['kind', 'text']) || typeof v.text !== 'string' || v.text.trim() !== v.text) return false;
      const length = Array.from(v.text).length;
      return length >= 1 && length <= ROBOTS.sayMaxLength;
    }
    case 'wait':
      return hasExactKeys(v, ['kind', 'minutes']) && isIntIn(v.minutes, 1, ROBOTS.maxWaitMinutes);
    default:
      return false;
  }
}

export function isValidRobotProgram(v: unknown): v is RobotProgram {
  return (
    isObj(v) &&
    hasExactKeys(v, ['kind', 'steps', 'loop']) &&
    v.kind === 'script' &&
    isBool(v.loop) &&
    Array.isArray(v.steps) &&
    v.steps.length >= 1 &&
    v.steps.length <= ROBOTS.maxScriptSteps &&
    v.steps.every(isValidRobotAction)
  );
}

function isValidDetail(v: unknown): boolean {
  if (!isObj(v)) return false;
  switch (v.kind) {
    case 'none':
    case 'tile':
      return hasExactKeys(v, ['kind']);
    case 'crop':
      return hasExactKeys(v, ['kind', 'cropId', 'quantity', 'quality']) && isOneOf(v.cropId, CROP_IDS) && isIntIn(v.quantity, 1, MAX) && isOneOf(v.quality, QUALITIES);
    case 'planted':
      return hasExactKeys(v, ['kind', 'cropId']) && isOneOf(v.cropId, CROP_IDS);
    case 'items':
      return (
        hasExactKeys(v, ['kind', 'into', 'stacks', 'quantity']) &&
        isOneOf(v.into, ['chest', 'bin', 'bag']) &&
        isIntIn(v.stacks, 1, MAX) &&
        isIntIn(v.quantity, 1, MAX)
      );
    default:
      return false;
  }
}

function isValidLogEvent(v: unknown): boolean {
  if (!isObj(v) || !isOneOf(v.kind, ROBOT_LOG_EVENT_KINDS)) return false;
  switch (v.kind) {
    case 'did':
      return hasExactKeys(v, ['kind', 'action', 'detail']) && isOneOf(v.action, ROBOT_ACTION_KINDS) && isValidDetail(v.detail);
    case 'blocked':
      return hasExactKeys(v, ['kind', 'action', 'reason']) && isOneOf(v.action, ROBOT_ACTION_KINDS) && isOneOf(v.reason, ROBOT_BLOCK_REASONS);
    case 'bickered':
      return (
        hasExactKeys(v, ['kind', 'action', 'withIds']) &&
        isOneOf(v.action, ROBOT_ACTION_KINDS) &&
        Array.isArray(v.withIds) &&
        v.withIds.length >= 1 &&
        v.withIds.every((id: unknown) => isIntIn(id, 1, MAX))
      );
    default:
      return hasExactKeys(v, ['kind']);
  }
}

function isValidLog(v: unknown, farm: WorldState): boolean {
  if (!isObj(v) || !hasExactKeys(v, ['nextId', 'entries']) || !isCount(v.nextId) || !Array.isArray(v.entries)) return false;
  if (v.entries.length > ROBOTS.logCapacity) return false;
  let previous = -1;
  for (const entry of v.entries as readonly unknown[]) {
    if (
      !isObj(entry) ||
      !hasExactKeys(entry, ['id', 'day', 'minute', 'robotId', 'tx', 'tz', 'event', 'count']) ||
      !isIntIn(entry.id, previous + 1, v.nextId - 1) ||
      !isCount(entry.day) ||
      !isIntIn(entry.minute, TIME.dayStartMinute, TIME.passOutMinute) ||
      !isIntIn(entry.robotId, 1, MAX) ||
      !isInt(entry.tx) ||
      !isInt(entry.tz) ||
      !inBounds(farm.grid, entry.tx, entry.tz) ||
      !isIntIn(entry.count, 1, MAX) ||
      !isValidLogEvent(entry.event)
    ) {
      return false;
    }
    previous = entry.id;
  }
  return true;
}

function isValidLastAction(v: unknown, actionSeq: number): boolean {
  if (v === null) return true;
  return (
    isObj(v) &&
    hasExactKeys(v, ['seq', 'kind', 'success', 'bickered']) &&
    v.seq === actionSeq &&
    isOneOf(v.kind, ROBOT_ACTION_KINDS) &&
    isBool(v.success) &&
    isBool(v.bickered)
  );
}

function isValidRobot(v: unknown, farm: WorldState): boolean {
  if (!isObj(v) || !hasExactKeys(v, ROBOT_KEYS)) return false;
  if (!isIntIn(v.id, 1, MAX) || !isValidName(v.name) || !isOneOf(v.size, ROBOT_SIZES)) return false;
  if (!isCanonicalSubset(v.parts, ROBOT_PART_IDS) || v.parts.length > ROBOTS.sizes[v.size].partSlots) return false;
  const parts: readonly RobotPartId[] = v.parts;
  if (!isInt(v.tx) || !isInt(v.tz) || !inBounds(farm.grid, v.tx, v.tz) || !isIntIn(v.facing, 0, 3)) return false;
  if (!Array.isArray(v.bag) || v.bag.length > bagStacks({ size: v.size, parts }) || !v.bag.every((s: unknown) => isValidStack(s, true))) return false;
  if (!isIntIn(v.tank, 0, ROBOTS.tankCapacity) || (v.tank > 0 && !parts.includes('wateringHead'))) return false;
  if (!isIntIn(v.tokens, 0, batteryFor(v.size)) || !isCount(v.tokensToday)) return false;
  if (!isOneOf(v.power, ROBOT_POWERS) || !isBool(v.carried)) return false;
  if (!isValidRobotProgram(v.program) || !isIntIn(v.pc, 0, v.program.steps.length - 1)) return false;
  if (!isIntIn(v.nextActMinute, TIME.dayStartMinute, TIME.passOutMinute + ROBOTS.maxWaitMinutes)) return false;
  if (!isCount(v.moveSeq) || !isCount(v.teleportSeq) || !isCount(v.actionSeq)) return false;
  if (!isValidLastAction(v.lastAction, v.actionSeq)) return false;
  if (v.power === 'repairing') return isCount(v.repairReadyDay) && !v.carried;
  if (v.repairReadyDay !== null) return false;
  if (v.carried) return true;
  const tile = getTile(farm, v.tx, v.tz);
  if (tile === null) return false;
  if (v.power === 'broken') return tile.blocker === Blocker.Water || isWalkable(tile);
  return isWalkable(tile);
}

/**
 * The robots section: ids unique, ascending and below nextId; at most maxRobots; every robot
 * valid on the farm; the carried robot (if any) matches `player.carrying` and the player is on
 * the farm; the pool, last night's fuel and the log valid.
 */
export function isValidRobotsSection(v: unknown, maps: GameState['maps'], player: unknown): boolean {
  if (!isObj(v) || !hasExactKeys(v, ['nextId', 'list', 'pool', 'log', 'lastNightFuel']) || !isObj(player)) return false;
  if (!isIntIn(v.nextId, 1, MAX) || !Array.isArray(v.list) || v.list.length > ROBOTS.maxRobots) return false;
  let previous = 0;
  let carried = 0;
  for (const robot of v.list as readonly unknown[]) {
    if (!isValidRobot(robot, maps.farm) || !isObj(robot) || !isInt(robot.id)) return false;
    if (robot.id <= previous || robot.id >= v.nextId) return false;
    previous = robot.id;
    if (robot.carried === true) {
      carried++;
      if (player.carrying !== robot.id || player.mapId !== 'farm') return false;
    }
  }
  if (carried !== (player.carrying === null ? 0 : 1)) return false;
  const fuel = v.lastNightFuel;
  if (!isCount(v.pool) || !isObj(fuel) || !hasExactKeys(fuel, ['wood', 'tokens']) || !isCount(fuel.wood) || !isCount(fuel.tokens)) return false;
  return isValidLog(v.log, maps.farm) && burnersOnlyOnFarm(maps);
}
