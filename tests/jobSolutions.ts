/**
 * The jobs' reference solutions and naive approaches (farmclaws part 4c spec §6), built with `b`
 * for the balance pass and the job tests. Jobs 1 and 2 use only the blocks unlocked by then: For
 * each tile comes with job 3, so their robots walk the bed and the field with Go to, Repeat and
 * turns.
 */
import type { BlockProgram, Statement, TileCoord, ZoneId, ZoneRect } from '../src/core/types';
import { BARNABY_SOWN } from '../src/jobs/checks';
import { b } from '../src/robots/blocks';
import { COSMO_FIELD } from '../src/world/maps/neighbours';

/**
 * Job 1's reference for the bed with north-west corner `bed`: go to its north-east corner (on a new
 * farm Sprinkle arrives there facing South), water round its edge turning right, step into the
 * middle and water it, then power down. Twelve blocks, a Mini's limit.
 */
export function spinningRobotReference(bed: TileCoord): BlockProgram {
  return b.program({
    stacks: [
      b.when(
        b.morning(),
        b.goTo(b.tileAt(bed.tx + 2, bed.tz)),
        b.repeat(4, b.repeat(2, b.water(), b.move()), b.turn('right')),
        b.move(),
        b.turn('right'),
        b.move(),
        b.water(),
        b.powerDown(),
      ),
    ],
  });
}

/** `program` with its stacks' Power down blocks left out: the robot does its work, then never powers itself down. */
export function withoutPowerDown(program: BlockProgram): BlockProgram {
  const kept = (s: Statement): boolean => !(s.kind === 'do' && s.action.kind === 'powerDown');
  return { ...program, stacks: program.stacks.map((stack) => ({ ...stack, body: stack.body.filter(kept) })) };
}

/**
 * Cosmo's field column by column, from its south-west corner: two Go tos leave Wave there facing
 * West, then up one column and down the next, `visit` on every tile.
 */
function walkCosmoField(visit: () => Statement[]): BlockProgram {
  const { x0, z0, width, depth } = COSMO_FIELD;
  const south = z0 + depth - 1;
  const column = [b.repeat(depth - 1, ...visit(), b.move()), ...visit()];
  return b.program({
    stacks: [
      b.when(
        b.morning(),
        b.goTo(b.tileAt(x0 + 1, south)),
        b.goTo(b.tileAt(x0, south)),
        b.turn('right'),
        b.repeat(width / 2, ...column, b.turn('right'), b.move(), b.turn('right'), ...column, b.turn('left'), b.move(), b.turn('left')),
      ),
    ],
  });
}

/** Job 2's reference: on every tile of Cosmo's field, if the crop is ready, harvest. */
export const SHOW_HIM_REFERENCE = walkCosmoField(() => [b.if(b.cropIsReady(), [b.harvest()])]);

/** Job 2's naive approach: the same walk, harvesting every tile without looking. */
export const SHOW_HIM_BLIND = walkCosmoField(() => [b.harvest()]);

/** The quarters of the sown part of Barnaby's field (each 4 × 3) as zones A to D: north-west, north-east, south-west, south-east. */
export const BARNABY_QUARTERS: Readonly<Record<'A' | 'B' | 'C' | 'D', ZoneRect>> = (() => {
  const { x0, z0, width, depth } = BARNABY_SOWN;
  const w = width / 2;
  const d = depth / 2;
  const quarter = (dx: number, dz: number): ZoneRect => ({ mapId: 'neighbours', x0: x0 + dx * w, z0: z0 + dz * d, w, d });
  return { A: quarter(0, 0), B: quarter(1, 0), C: quarter(0, 1), D: quarter(1, 1) };
})();

/** Job 3's reference for one Mini: when morning comes, for each tile in its quarter, harvest; then power down. */
export function knowTheLimitsReference(zone: ZoneId): BlockProgram {
  return b.program({ stacks: [b.when(b.morning(), b.forEach(zone, b.harvest()), b.powerDown())] });
}

/** Which quarter each of Barnaby's Minis takes in the reference: the nearest, so no two routes cross. */
export const BARNABY_ASSIGNMENT = { 'B-1': 'A', 'B-2': 'D', 'B-3': 'B', 'B-4': 'C' } as const satisfies Readonly<Record<string, ZoneId>>;

/** B-1's polling program, as Barnaby hands it over: every 10 minutes, for each tile in H, harvest. */
export const POLLING = b.program({ stacks: [b.when(b.every(10), b.forEach('H', b.harvest()))] });

/** One robot's program on the whole field: when morning comes, for each tile in H, harvest; then power down. */
export const WHOLE_FIELD = knowTheLimitsReference('H');
