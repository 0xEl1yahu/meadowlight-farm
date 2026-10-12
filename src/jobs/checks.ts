/**
 * The jobs' success checks and progress lines (farmclaws part 4c spec §3). Each check is a pure
 * function of the state and reads the robots' own log, so rain or the player's own work never
 * counts towards a job.
 */
import { JOBS } from '../config';
import type { GameState, Robot, RobotOwner, RobotProgram, TileCoord } from '../core/types';
import { BLOCK_CATEGORY } from '../robots/blockKinds';
import { allExprNodes, programStatements, statementExprs } from '../robots/program';
import { COSMO_FIELD } from '../world/maps/neighbours';

/** Sol's Mini, job 1's robot (spec §3.1). */
export const SPRINKLE = 'Sprinkle';

/** Cosmo's Big, job 2's robot (spec §3.2). */
export const WAVE = 'Wave';

/** `owner`'s robot called `name` with the lowest id, or null when there's none. */
function robotNamed(state: GameState, owner: RobotOwner, name: string): Robot | null {
  let found: Robot | null = null;
  for (const robot of state.robots.list) {
    if (robot.owner === owner && robot.name === name && (found === null || robot.id < found.id)) found = robot;
  }
  return found;
}

/**
 * Sprinkle: the player's robot of that name with the lowest id, the one job 1 set up before the
 * player could own any other. Null once it's gone (scrapped).
 */
export function sprinkleOf(state: GameState): Robot | null {
  return robotNamed(state, 'player', SPRINKLE);
}

/** Wave: Cosmo's robot of that name, set up by job 2; null before. */
export function waveOf(state: GameState): Robot | null {
  return robotNamed(state, 'cosmo', WAVE);
}

/** The tiles where `robot`'s log shows it doing `action` today, as "tx,tz" keys. */
function tilesDidToday(state: GameState, robot: Robot, action: 'water' | 'harvest'): ReadonlySet<string> {
  const day = state.time.absoluteDay;
  const tiles = new Set<string>();
  for (const entry of state.robots.log.entries) {
    const { event } = entry;
    if (entry.robotId === robot.id && entry.day === day && event.kind === 'did' && event.action === action) tiles.add(`${entry.tx},${entry.tz}`);
  }
  return tiles;
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
  const watered = tilesDidToday(state, sprinkle, 'water');
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

/**
 * The tiles of Cosmo's field that are ripe at the morning set-up (spec §3.2), row by row: the
 * checkerboard's (tx + tz) even half.
 */
export function cosmoRipeTiles(): readonly TileCoord[] {
  const tiles: TileCoord[] = [];
  const { x0, z0, width, depth } = COSMO_FIELD;
  for (let tz = z0; tz < z0 + depth; tz++) {
    for (let tx = x0; tx < x0 + width; tx++) if ((tx + tz) % 2 === 0) tiles.push({ tx, tz });
  }
  return tiles;
}

/**
 * How many of the crops ripe at the morning set-up Wave's log shows it harvesting today. A `did
 * harvest` entry is logged on the tile harvested (the robot's own), and a robot moves between two
 * tiles it harvests, so an entry never stands for more than one tile.
 */
export function ripeCropsHarvested(state: GameState): number {
  const wave = waveOf(state);
  if (wave === null) return 0;
  const harvested = tilesDidToday(state, wave, 'harvest');
  return cosmoRipeTiles().filter((tile) => harvested.has(`${tile.tx},${tile.tz}`)).length;
}

/** Job 2's program rule (spec §3.2): a block program with at least one If and at least one sensor block. */
export function looksBeforePicking(program: RobotProgram): boolean {
  if (program.kind !== 'blocks') return false;
  const statements = programStatements(program);
  const exprs = statements.flatMap((statement) => statementExprs(statement).flatMap(allExprNodes));
  return statements.some((statement) => statement.kind === 'if') && exprs.some((expr) => BLOCK_CATEGORY[expr.kind] === 'sensors');
}

/** Job 2's check (spec §3.2): Wave harvested every crop that was ripe at the morning set-up today, with a program that looks before it picks. */
export function showHimDone(state: GameState): boolean {
  const wave = waveOf(state);
  return wave !== null && looksBeforePicking(wave.program) && ripeCropsHarvested(state) === cosmoRipeTiles().length;
}

/** Job 2's progress line: "{n} / 18 ripe crops harvested today." */
export function showHimProgress(state: GameState): string {
  return `${ripeCropsHarvested(state)} / ${cosmoRipeTiles().length} ripe crops harvested today.`;
}
