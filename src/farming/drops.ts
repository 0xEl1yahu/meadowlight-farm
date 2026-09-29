/**
 * What clearing debris drops. Every roll is a pure hash of the map's seed, the tile, the day and
 * the blocker (plus the material's reserved salt), so replays always drop the same items.
 */
import { DROPS, TOOLS } from '../config';
import { Salt, hashFloat } from '../core/hash';
import { Blocker, type MaterialItemId } from '../core/types';

export interface Drop {
  readonly itemId: MaterialItemId;
  readonly quantity: number;
}

/** Blockers whose last hit (or scythe cut) drops something. */
export type DroppingBlocker = typeof Blocker.Rock | typeof Blocker.Stump | typeof Blocker.Tree | typeof Blocker.Weeds;

/**
 * The items dropped when `blocker` at (tx, tz) is cleared on absolute day `day`, rolled with
 * `seed` (the map's seed): a rock gives stone and 25% of the time copper ore, a felled tree
 * gives wood and half the time sap, a stump gives wood and sometimes sap, weeds give fiber.
 */
export function debrisDrops(seed: number, blocker: DroppingBlocker, tx: number, tz: number, day: number): readonly Drop[] {
  switch (blocker) {
    case Blocker.Rock: {
      const drops: Drop[] = [{ itemId: 'stone', quantity: TOOLS.stoneFromRock }];
      if (hashFloat(seed, tx, tz, day, blocker, Salt.CopperOre) < DROPS.copperOreFromRock) drops.push({ itemId: 'copperOre', quantity: 1 });
      return drops;
    }
    case Blocker.Tree: {
      const drops: Drop[] = [{ itemId: 'wood', quantity: TOOLS.woodFromTree }];
      if (hashFloat(seed, tx, tz, day, blocker, Salt.Sap) < DROPS.sapFromTree) drops.push({ itemId: 'sap', quantity: 1 });
      return drops;
    }
    case Blocker.Stump: {
      const drops: Drop[] = [{ itemId: 'wood', quantity: TOOLS.woodFromStump }];
      if (hashFloat(seed, tx, tz, day, blocker, Salt.Sap) < DROPS.sapFromStump) drops.push({ itemId: 'sap', quantity: 1 });
      return drops;
    }
    case Blocker.Weeds:
      return [{ itemId: 'fiber', quantity: DROPS.fiberFromWeeds }];
  }
}
