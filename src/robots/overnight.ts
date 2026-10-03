/**
 * The robots' night, run inside startNextDay after the maps grow (farmclaws part 1 spec §5.7):
 * generators burn, a carried robot is set down, repairs come back, robots near a generator
 * recharge, and every robot is reset for the morning where it stands. Pure.
 */
import { GENERATORS, PLAYER, ROBOTS, TIME } from '../config';
import { joinWithAnd } from '../core/text';
import {
  Blocker,
  Direction,
  type GameState,
  type MessageTone,
  type Robot,
  type RobotExec,
  type RobotStatCounts,
  type RobotStats,
  type TileCoord,
} from '../core/types';
import { chebyshevDistance } from '../world/grid';
import { forEachTile, getTile, isWalkable, setTiles, type TileEdit } from '../world/tiles';
import { morningExec } from './exec';
import { logRobotEvent, pruneRobotLog } from './log';
import { ZERO_ROBOT_STATS, batteryFor, isWeekStart, periodFor, resumedPower } from './stats';
import { nearestFreeWalkable, withFarm, withRobot } from './world';

/** A morning toast the night produced. */
export interface RobotNote {
  readonly text: string;
  readonly tone: MessageTone;
}

/** Robot names in the order given (id order), joined "a, b and c". */
function names(robots: readonly Robot[]): string {
  return joinWithAnd(robots.map((r) => r.name), '');
}

/** Every wood burner burns all its fuel into the pool; returns the burners' tiles for recharging. */
function burnGenerators(state: GameState, notes: RobotNote[]): { readonly state: GameState; readonly burners: readonly TileCoord[] } {
  const edits: TileEdit[] = [];
  const burners: TileCoord[] = [];
  let wood = 0;
  forEachTile(state.maps.farm, (tile, tx, tz) => {
    const object = tile.object;
    if (object === null || object.kind !== 'woodBurner') return;
    burners.push({ tx, tz });
    if (object.fuel === 0) return;
    wood += object.fuel;
    edits.push({ tx, tz, tile: { ...tile, object: { kind: 'woodBurner', fuel: 0 } } });
  });
  const tokens = wood * GENERATORS.woodBurner.tokensPerWood;
  const last = state.robots.lastNightFuel;
  if (wood === 0 && last.wood === 0 && last.tokens === 0) return { state, burners };
  if (wood > 0) notes.push({ text: `Your wood burners turned ${wood} wood into ${tokens} tokens.`, tone: 'info' });
  const burned = withFarm(state, setTiles(state.maps.farm, edits));
  return {
    state: { ...burned, robots: { ...burned.robots, pool: burned.robots.pool + tokens, lastNightFuel: { wood, tokens } } },
    burners,
  };
}

/** A robot still in the player's arms is set down on the spawn tile; the morning reset powers it. */
function setDownCarried(state: GameState): GameState {
  const id = state.player.carrying;
  const robot = state.robots.list.find((r) => r.id === id);
  if (id === null || robot === undefined) return state;
  const down: Robot = { ...robot, carried: false, tx: PLAYER.spawn.tx, tz: PLAYER.spawn.tz, facing: PLAYER.spawnFacing, teleportSeq: robot.teleportSeq + 1 };
  return withRobot({ ...state, player: { ...state.player, carrying: null } }, down);
}

/**
 * Repairs due today come back fully charged in front of the shipping bin, on the nearest
 * walkable tile with no robot on it (part 3 spec §3.1). Returns their ids.
 */
function returnRepaired(state: GameState, notes: RobotNote[]): { readonly state: GameState; readonly returned: ReadonlySet<number> } {
  let next = state;
  const returned = new Set<number>();
  for (const robot of state.robots.list) {
    if (robot.power !== 'repairing' || robot.repairReadyDay === null || robot.repairReadyDay > state.time.absoluteDay) continue;
    const at = nearestFreeWalkable(next, ROBOTS.repairDropOff, robot.id);
    next = withRobot(next, {
      ...robot,
      tx: at.tx,
      tz: at.tz,
      facing: Direction.South,
      tokens: batteryFor(robot.size),
      power: 'working',
      repairReadyDay: null,
      teleportSeq: robot.teleportSeq + 1,
    });
    next = logRobotEvent(next, robot.id, { kind: 'repaired' });
    returned.add(robot.id);
    notes.push({ text: `${robot.name} is back from repairs.`, tone: 'success' });
  }
  return { state: next, returned };
}

/**
 * In id order, robots within chargeRadius of a burner fill up from the pool. Every other robot
 * that isn't broken or away at repairs (even a full one) is named as having missed out. A robot
 * just back from repairs spent the day at the shop, so it's never named.
 */
function recharge(state: GameState, burners: readonly TileCoord[], returned: ReadonlySet<number>, notes: RobotNote[]): GameState {
  let next = state;
  const short: Robot[] = [];
  const away: Robot[] = [];
  for (const robot of state.robots.list) {
    if (robot.power === 'broken' || robot.power === 'repairing' || returned.has(robot.id)) continue;
    if (!burners.some((b) => chebyshevDistance(b, robot) <= ROBOTS.chargeRadius)) {
      away.push(robot);
      continue;
    }
    const want = batteryFor(robot.size) - robot.tokens;
    const give = Math.min(want, next.robots.pool);
    if (give < want) short.push(robot);
    if (give === 0) continue;
    next = withRobot({ ...next, robots: { ...next.robots, pool: next.robots.pool - give } }, { ...robot, tokens: robot.tokens + give });
  }
  if (short.length > 0) notes.push({ text: `Not enough tokens to fully charge ${names(short)}.`, tone: 'warn' });
  if (away.length > 0) notes.push({ text: `${names(away)} ended the day away from a generator and didn't recharge.`, tone: 'warn' });
  return next;
}

/** Deep equality for plain save data: numbers, strings, booleans, null, arrays and plain objects. */
function samePlainData(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null || Array.isArray(a) !== Array.isArray(b)) return false;
  const left = a as Readonly<Record<string, unknown>>;
  const right = b as Readonly<Record<string, unknown>>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => key in right && samePlainData(left[key], right[key]));
}

/**
 * The morning's exec (part 2 spec §7): null for a script; for a block program, the robot's own
 * exec when it already is exactly the morning's, so a robot the morning didn't change keeps its
 * reference (the render contract).
 */
function morningExecOf(robot: Robot): RobotExec | null {
  if (robot.program.kind !== 'blocks') return null;
  const fresh = morningExec(robot.program);
  return robot.exec !== null && samePlainData(robot.exec, fresh) ? robot.exec : fresh;
}

const isZero = (counts: RobotStatCounts): boolean => counts.tokens === 0 && counts.actions === 0 && counts.crops === 0;

/**
 * The morning's stats (part 3 spec §6.1): today starts again from 0, and so does the week on the
 * first day of a week. `stats` itself when there is nothing to reset.
 */
function morningStats(stats: RobotStats, weekStart: boolean): RobotStats {
  const today = isZero(stats.today) ? stats.today : ZERO_ROBOT_STATS.today;
  const week = !weekStart || isZero(stats.week) ? stats.week : ZERO_ROBOT_STATS.week;
  return today === stats.today && week === stats.week ? stats : { today, week };
}

/**
 * Every robot not at repairs stays where it is, restarts its script and resets its day. One whose
 * tile is no longer walkable (weeds or a giant crop grew there) moves to the nearest walkable
 * tile; a broken robot may keep standing in water. Broken robots are included so a broken robot
 * on land is never left on an unwalkable tile, which the save validator rejects.
 *
 * A block program (part 2 spec §7) gets the morning's exec: variables back to their initials,
 * triggers re-armed, its first `morning` stack started. It works if that stack started and waits
 * on standby otherwise; flat and broken robots stay so. Every robot is turned back on, except one
 * switched off at the bench; a robot on the workbench stays there.
 */
function resetForMorning(state: GameState): GameState {
  let next = state;
  const farm = state.maps.farm;
  const weekStart = isWeekStart(state.time.dayOfSeason);
  for (const robot of state.robots.list) {
    if (robot.power === 'repairing') continue;
    const tile = getTile(farm, robot.tx, robot.tz);
    const inWater = tile !== null && tile.blocker === Blocker.Water;
    // A robot on the workbench stays on it (part 3 spec §2.2); the bench tile itself isn't walkable.
    const standable = robot.onBench || (tile !== null && (isWalkable(tile) || (robot.power === 'broken' && inWater)));
    // Off an unwalkable tile, onto the nearest walkable one with no robot on it (part 3 spec §3.1).
    const at = standable ? { tx: robot.tx, tz: robot.tz } : nearestFreeWalkable(next, robot, robot.id);
    const moved = at.tx !== robot.tx || at.tz !== robot.tz;
    const exec = morningExecOf(robot);
    const resumed = resumedPower(robot);
    next = withRobot(next, {
      ...robot,
      tx: at.tx,
      tz: at.tz,
      teleportSeq: moved ? robot.teleportSeq + 1 : robot.teleportSeq,
      pc: 0,
      stats: morningStats(robot.stats, weekStart),
      nextActMinute: TIME.dayStartMinute + periodFor(robot),
      power: resumed === 'working' && exec !== null && exec.running === null ? 'standby' : resumed,
      exec,
      // 'dizzy' and 'done' last until morning; the bench's switch lasts until it is switched on.
      off: robot.off === 'player' ? 'player' : null,
    });
  }
  return next;
}

/** The whole night, in the spec's order. `notes` become morning toasts. */
export function runRobotsOvernight(state: GameState): { readonly state: GameState; readonly notes: readonly RobotNote[] } {
  const notes: RobotNote[] = [];
  const burned = burnGenerators(state, notes);
  const repaired = returnRepaired(setDownCarried(burned.state), notes);
  let next = recharge(repaired.state, burned.burners, repaired.returned, notes);
  next = resetForMorning(next);
  return { state: pruneRobotLog(next), notes };
}
