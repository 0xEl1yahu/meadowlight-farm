/**
 * Static shade map: a pure function of the grid and the farm layout, so it never needs to be
 * stored in state. Shade crops (mushrooms, snozberries) sprout and grow only on these tiles.
 */
import { LAYOUT, SHADE, type FarmLayout } from '../config';
import type { GridSpec } from '../core/types';
import { inBounds } from './grid';

export function isShadedTile(grid: GridSpec, tx: number, tz: number, layout: FarmLayout = LAYOUT): boolean {
  if (!inBounds(grid, tx, tz)) return false;
  if (tx < SHADE.edgeBand || tz < SHADE.edgeBand) return true;
  const house = layout.house;
  const ring = SHADE.houseRing;
  return (
    tx >= house.x0 - ring &&
    tx < house.x0 + house.width + ring &&
    tz >= house.z0 - ring &&
    tz < house.z0 + house.depth + ring
  );
}
