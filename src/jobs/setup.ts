/**
 * What taking a job puts into the world (farmclaws part 4c spec §3). Pure: each set-up returns
 * the new state, or the sentence saying why the job can't be set up.
 */
import { JOBS, PLAYER, WORKBENCH } from '../config';
import { invariant } from '../core/invariant';
import { Direction, TileState, type BlockProgram, type GameState } from '../core/types';
import { createCropInstance } from '../farming/crops';
import { addRobot } from '../robots/create';
import { withZone } from '../robots/edits';
import { findFreeBlock, freeSpotNear } from '../robots/workbench';
import { withFarm } from '../robots/world';
import { requireTile, setTiles } from '../world/tiles';
import { SPRINKLE, bedTiles } from './checks';

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
