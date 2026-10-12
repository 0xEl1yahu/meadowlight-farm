/**
 * What taking a job puts into the world (farmclaws part 4c spec §3). Pure: each set-up returns
 * the new state, or the sentence saying why the job can't be set up.
 */
import { GENERATORS, JOBS, PLAYER, WORKBENCH } from '../config';
import { invariant } from '../core/invariant';
import { Direction, TileState, type BlockProgram, type CropInstance, type GameState, type MdCard, type RobotOwner, type TileCoord, type TileRect } from '../core/types';
import { CROPS, createCropInstance, stageCount } from '../farming/crops';
import { addRobot } from '../robots/create';
import { withZone } from '../robots/edits';
import { findFreeBlock, freeSpotNear } from '../robots/workbench';
import { nearestFreeWalkable, robotsOnTile, withFarm, withRobot } from '../robots/world';
import { pushMessage } from '../state/messages';
import { withMap } from '../state/selectors';
import { COSMO_FIELD } from '../world/maps/neighbours';
import { EMPTY_TILE, requireTile, setTiles, type TileEdit } from '../world/tiles';
import { BARNABY_SOWN, BARNABY_TEAM, SPRINKLE, WAVE, bedTiles } from './checks';

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
 * `field` on the Neighbours map as tilled soil with the crop `cropAt` gives each tile. A tile
 * under a placed object keeps it.
 */
function sowField(state: GameState, field: TileRect, cropAt: (tx: number, tz: number) => CropInstance): GameState {
  const world = state.maps.neighbours;
  const edits: TileEdit[] = [];
  const { x0, z0, width, depth } = field;
  for (let tz = z0; tz < z0 + depth; tz++) {
    for (let tx = x0; tx < x0 + width; tx++) {
      const tile = requireTile(world, tx, tz);
      if (tile.object !== null) continue;
      edits.push({ tx, tz, tile: { ...tile, state: TileState.Plowed, crop: cropAt(tx, tz) } });
    }
  }
  return withMap(state, 'neighbours', setTiles(world, edits));
}

/**
 * Cosmo's field set up (spec §3.2), when job 2 is taken and every morning while it's active:
 * tilled soil with parsnips in a checkerboard, ripe where (tx + tz) is even and
 * JOBS.unripeDaysLeft days from ripe where it's odd. A tile under a placed object keeps it.
 */
export function setUpCosmoField(state: GameState): GameState {
  const day = state.time.absoluteDay;
  const ripe = parsnipDaysFromRipe(day, 0);
  const unripe = parsnipDaysFromRipe(day, JOBS.unripeDaysLeft);
  return sowField(state, COSMO_FIELD, (tx, tz) => ((tx + tz) % 2 === 0 ? ripe : unripe));
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

/**
 * Barnaby's field set up (spec §3.3), when job 3 is taken and every morning while it's active:
 * its first JOBS.barnabyRows rows (BARNABY_SOWN) become tilled soil with a ripe parsnip on every
 * tile, and the rest stays bare. A tile under a placed object keeps it.
 */
export function setUpBarnabyField(state: GameState): GameState {
  const ripe = parsnipDaysFromRipe(state.time.absoluteDay, 0);
  return sowField(state, BARNABY_SOWN, () => ripe);
}

/** B-1's program as Barnaby hands it over: every 10 minutes, for each tile in H, harvest. */
const POLLING: BlockProgram = {
  kind: 'blocks',
  vars: [],
  stacks: [{ trigger: { kind: 'every', minutes: 10 }, body: [{ kind: 'forEachTile', zone: 'H', body: [{ kind: 'do', action: { kind: 'harvest' } }] }] }],
  helpers: [],
};

/** B-2 to B-4's empty program: a morning stack with nothing in it. */
const IDLE: BlockProgram = { kind: 'blocks', vars: [], stacks: [{ trigger: { kind: 'morning' }, body: [] }], helpers: [] };

/** Barnaby's .MD on each of his Minis: "DO return to the generator at 6:00 pm". */
const BARNABY_MD: readonly MdCard[] = [{ kind: 'doReturn', to: { kind: 'generator' }, minute: JOBS.barnabyDeadline }];

/** The toast when job 3 takes Zone H (spec §3.3). */
export const ZONE_H_TOAST = 'Barnaby marked his field as Zone H.';

/**
 * Job 3's set-up (spec §3.3): Barnaby's generator on the lane by his gate, his field, Zone H set
 * to the field's sown rows on the Neighbours map whatever it was ("Barnaby marked his field as
 * Zone H."), and his Minis B-1 to B-4 (a Claw each, Barnaby's .MD, fully charged, Barnaby's) on
 * JOBS.barnabyRobots: B-1 with the polling program, the rest idle. A Mini whose tile is taken by a robot or an object stands on
 * the nearest free walkable tile instead.
 */
export function setUpKnowTheLimits(state: GameState): GameState {
  const { x0, z0, width, depth } = BARNABY_SOWN;
  const zoned = withZone(setUpBarnabyField(withGenerator(state, 'barnaby')), 'H', { mapId: 'neighbours', x0, z0, w: width, d: depth });
  invariant(typeof zoned !== 'string', "Barnaby's field is a zone on the Neighbours map");
  let next = pushMessage(zoned, ZONE_H_TOAST, 'info');
  BARNABY_TEAM.forEach((name, i) => {
    const place = JOBS.barnabyRobots[i];
    invariant(place !== undefined, `JOBS.barnabyRobots places ${name}`);
    const at = nearestFreeWalkable(next, 'neighbours', place, next.robots.nextId);
    const added = addRobot(next, {
      name,
      size: 'mini',
      parts: ['claw'],
      program: i === 0 ? POLLING : IDLE,
      md: BARNABY_MD,
      place: { ...at, facing: place.facing },
      mapId: 'neighbours',
      owner: 'barnaby',
    });
    invariant(!('error' in added), `${name} stands on open ground`);
    next = added.state;
  });
  return next;
}
