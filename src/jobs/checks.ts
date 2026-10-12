/**
 * The jobs' success checks and progress lines (farmclaws part 4c spec §3). Each check is a pure
 * function of the state and reads the robots' own log, so rain or the player's own work never
 * counts towards a job.
 */
import { JOBS } from '../config';
import type { GameState, Robot, TileCoord } from '../core/types';

/** Sol's Mini, job 1's robot (spec §3.1). */
export const SPRINKLE = 'Sprinkle';

/**
 * Sprinkle: the player's robot of that name with the lowest id, the one job 1 set up before the
 * player could own any other. Null once it's gone (scrapped).
 */
export function sprinkleOf(state: GameState): Robot | null {
  let found: Robot | null = null;
  for (const robot of state.robots.list) {
    if (robot.owner === 'player' && robot.name === SPRINKLE && (found === null || robot.id < found.id)) found = robot;
  }
  return found;
}

/** The tiles of job 1's bed, row by row; none before job 1 is taken. */
export function bedTiles(state: GameState): readonly TileCoord[] {
  const bed = state.jobs.bed;
  if (bed === null) return [];
  const tiles: TileCoord[] = [];
  for (let dz = 0; dz < JOBS.bedSize; dz++) {
    for (let dx = 0; dx < JOBS.bedSize; dx++) tiles.push({ tx: bed.tx + dx, tz: bed.tz + dz });
  }
  return tiles;
}

/**
 * How many bed tiles Sprinkle's log shows it watering today. A `did water` entry is logged on the
 * tile the robot waters (its own), and a robot moves between two tiles it waters, so an entry
 * never stands for more than one tile.
 */
export function bedTilesWatered(state: GameState): number {
  const sprinkle = sprinkleOf(state);
  if (sprinkle === null) return 0;
  const day = state.time.absoluteDay;
  const watered = new Set<string>();
  for (const entry of state.robots.log.entries) {
    const { event } = entry;
    if (entry.robotId === sprinkle.id && entry.day === day && event.kind === 'did' && event.action === 'water') watered.add(`${entry.tx},${entry.tz}`);
  }
  return bedTiles(state).filter((tile) => watered.has(`${tile.tx},${tile.tz}`)).length;
}

/**
 * Job 1's check (spec §3.1): today Sprinkle watered every bed tile, then powered itself down with
 * its own Power down block (its latest entry today is `poweredDown` and it stands by; a DO power
 * down card logs `doPowerDown` instead) with tokens to spare.
 */
export function spinningRobotDone(state: GameState): boolean {
  const sprinkle = sprinkleOf(state);
  if (sprinkle === null || sprinkle.power !== 'standby' || sprinkle.tokens <= 0) return false;
  const tiles = bedTiles(state);
  if (tiles.length === 0 || bedTilesWatered(state) < tiles.length) return false;
  const entries = state.robots.log.entries;
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry === undefined || entry.robotId !== sprinkle.id) continue;
    return entry.day === state.time.absoluteDay && entry.event.kind === 'poweredDown';
  }
  return false;
}

/** Job 1's progress line: "{n} / 9 bed tiles watered today." */
export function spinningRobotProgress(state: GameState): string {
  return `${bedTilesWatered(state)} / ${JOBS.bedSize * JOBS.bedSize} bed tiles watered today.`;
}
