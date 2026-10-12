/**
 * What taking a job puts into the world (farmclaws part 4c spec §3). Pure: each set-up returns
 * the new state, or the sentence saying why the job can't be set up.
 */
import { GENERATORS, JOBS, PLAYER, WORKBENCH } from '../config';
import { invariant } from '../core/invariant';
import { Direction, TileState, type BlockProgram, type CropInstance, type GameState, type RobotOwner, type TileCoord } from '../core/types';
import { CROPS, createCropInstance, stageCount } from '../farming/crops';
import { addRobot } from '../robots/create';
import { withZone } from '../robots/edits';
import { findFreeBlock, freeSpotNear } from '../robots/workbench';
import { nearestFreeWalkable, robotsOnTile, withFarm, withRobot } from '../robots/world';
import { withMap } from '../state/selectors';
import { COSMO_FIELD } from '../world/maps/neighbours';
import { EMPTY_TILE, requireTile, setTiles, type TileEdit } from '../world/tiles';
import { SPRINKLE, WAVE, bedTiles } from './checks';

/** Sprinkle's program as Sol hands it over: when morning comes, repeat forever, turn right. */
const SPINNING: BlockProgram = {
  kind: 'blocks',
  vars: [],
  stacks: [
    {
      trigger: { kind: 'morning' },
      body: [{ kind: 'repeatForever', body: [{ kind: 'do', action: { kind: 'turn', side: 'right' } }] }],
    },
  ],
  helpers: [],
};

/** The refusal when the farm has no room left for job 1's bed. */
export const NO_ROOM_FOR_BED = `Your farm has no free ${JOBS.bedSize} × ${JOBS.bedSize} patch of grass for the bed.`;

/**
 * Job 1's set-up (spec §3.1): Sol's Mini Sprinkle, the player's, fully charged, on the free tile
 * nearest the workbench's home that isn't the spawn or under a farm robot, facing South; then the
 * bed, the 3 × 3 block of free grass nearest JOBS.bedSearchFrom with no robot on it, tilled and
 * sown with parsnips, saved in `jobs.bed`; and Zone A set to the bed when it's empty. Refused with
 * the cap's sentence when the farm has its 12 robots, or NO_ROOM_FOR_BED.
 */
export function setUpSpinningRobot(state: GameState): GameState | string {
  const standing = state.robots.list.filter((robot) => robot.mapId === 'farm' && robot.power !== 'repairing');
  const at = freeSpotNear(state.maps.farm, WORKBENCH.home, [PLAYER.spawn, ...standing]);
  const bed = findFreeBlock(state.maps.farm, JOBS.bedSearchFrom, JOBS.bedSize, [at, ...standing]);
  if (bed === null) return NO_ROOM_FOR_BED;
  const added = addRobot(state, {
    name: SPRINKLE,
    size: 'mini',
    parts: ['wateringHead'],
    program: SPINNING,
    place: { ...at, facing: Direction.South },
  });
  if ('error' in added) return added.error;

  let next: GameState = { ...added.state, jobs: { ...added.state.jobs, bed } };
  const farm = next.maps.farm;
  const day = next.time.absoluteDay;
  const sown = bedTiles(next).map(({ tx, tz }) => ({
    tx,
    tz,
    tile: { ...requireTile(farm, tx, tz), state: TileState.Plowed, crop: createCropInstance('parsnip', day) },
  }));
  next = withFarm(next, setTiles(farm, sown));
  if (next.robots.zones.A !== null) return next;
  const zoned = withZone(next, 'A', { mapId: 'farm', x0: bed.tx, z0: bed.tz, w: JOBS.bedSize, d: JOBS.bedSize });
  invariant(typeof zoned !== 'string', 'the bed is a zone on the farm');
  return zoned;
}

/** Wave's program as Cosmo hands it over: when morning comes, repeat forever, say "hello chickens". */
const HELLO_CHICKENS: BlockProgram = {
  kind: 'blocks',
  vars: [],
  stacks: [
    {
      trigger: { kind: 'morning' },
      body: [{ kind: 'repeatForever', body: [{ kind: 'do', action: { kind: 'say', text: { kind: 'text', value: 'hello chickens' } } }] }],
    },
  ],
  helpers: [],
};

/**
 * `owner`'s generator (spec §5.4): a wood burner with a full hopper at JOBS.generators[owner] on
 * the Neighbours map. It never runs out, since the night only burns the farm's burners, and the
 * player can't place anything on its tile (placementProblem). A robot on the tile steps off to
 * the nearest free walkable one. The same state when the generator is already there.
 */
export function withGenerator(state: GameState, owner: Exclude<RobotOwner, 'player'>): GameState {
  const at: TileCoord = JOBS.generators[owner];
  const world = state.maps.neighbours;
  if (requireTile(world, at.tx, at.tz).object?.kind === 'woodBurner') return state;
  let next = withMap(state, 'neighbours', setTiles(world, [{ ...at, tile: { ...EMPTY_TILE, object: { kind: 'woodBurner', fuel: GENERATORS.woodBurner.hopper } } }]));
  for (const robot of robotsOnTile(next, 'neighbours', at.tx, at.tz)) {
    const off = nearestFreeWalkable(next, 'neighbours', at, robot.id);
    next = withRobot(next, { ...robot, tx: off.tx, tz: off.tz, teleportSeq: robot.teleportSeq + 1 });
  }
  return next;
}

/** A parsnip sown on `day` that is `daysLeft` watered days from ripe (0: ripe). */
function parsnipDaysFromRipe(day: number, daysLeft: number): CropInstance {
  const stageDays = CROPS.parsnip.stageDays;
  let stage = stageCount(CROPS.parsnip);
  let daysInStage = 0;
  for (let left = daysLeft; left > 0 && stage > 0; ) {
    stage--;
    const days = stageDays[stage] ?? 0;
    daysInStage = Math.max(0, days - left);
    left -= days;
  }
  return { ...createCropInstance('parsnip', day), stage, daysInStage };
}

/**
 * Cosmo's field set up (spec §3.2), when job 2 is taken and every morning while it's active:
 * tilled soil with parsnips in a checkerboard, ripe where (tx + tz) is even and
 * JOBS.unripeDaysLeft days from ripe where it's odd. A tile under a placed object keeps it.
 */
export function setUpCosmoField(state: GameState): GameState {
  const world = state.maps.neighbours;
  const day = state.time.absoluteDay;
  const ripe = parsnipDaysFromRipe(day, 0);
  const unripe = parsnipDaysFromRipe(day, JOBS.unripeDaysLeft);
  const edits: TileEdit[] = [];
  const { x0, z0, width, depth } = COSMO_FIELD;
  for (let tz = z0; tz < z0 + depth; tz++) {
    for (let tx = x0; tx < x0 + width; tx++) {
      const tile = requireTile(world, tx, tz);
      if (tile.object !== null) continue;
      edits.push({ tx, tz, tile: { ...tile, state: TileState.Plowed, crop: (tx + tz) % 2 === 0 ? ripe : unripe } });
    }
  }
  return withMap(state, 'neighbours', setTiles(world, edits));
}

/**
 * Job 2's set-up (spec §3.2): Cosmo's generator, his field, and his Big Wave (Claw, Sensor eye,
 * Basket; the hello-chickens program; Cosmo's) on the lane at JOBS.waveAt, facing North, fully
 * charged. Refused with addRobot's sentence when something of the player's stands on Wave's tile.
 */
export function setUpShowHim(state: GameState): GameState | string {
  const added = addRobot(setUpCosmoField(withGenerator(state, 'cosmo')), {
    name: WAVE,
    size: 'big',
    parts: ['claw', 'basket', 'sensorEye'],
    program: HELLO_CHICKENS,
    place: { ...JOBS.waveAt, facing: Direction.North },
    mapId: 'neighbours',
    owner: 'cosmo',
  });
  return 'error' in added ? added.error : added.state;
}
