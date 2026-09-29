/**
 * Deterministic farm generation. The same seed always yields the same farm. The farm map
 * (src/world/maps/farm.ts) wraps this generator; the farm's map seed is the save seed itself.
 */
import { LAYOUT, PLAYER, SHADE, TOOLS, type FarmLayout, type PondSpec } from '../config';
import { Salt, hashFloat } from '../core/hash';
import { Blocker, type GridSpec, type Tile, type TileCoord, type TileRect, type WorldState } from '../core/types';
import { initialWildCrop } from '../farming/wild';
import { shadeCropsInSeason } from '../farming/crops';
import { seasonOfDay } from '../time/clock';
import { inBounds, rectContains, rectInBounds } from './grid';
import { isShadedTile } from './shade';
import { EMPTY_TILE, blockedTile, createWorld } from './tiles';

export function isPondTile(pond: PondSpec, tx: number, tz: number): boolean {
  const nx = (tx + 0.5 - pond.centerX) / pond.radiusX;
  const nz = (tz + 0.5 - pond.centerZ) / pond.radiusZ;
  return nx * nx + nz * nz <= 1;
}

function assertLayout(grid: GridSpec, layout: FarmLayout): void {
  const rects: readonly [string, TileRect][] = [
    ['house', layout.house],
    ['shippingBin', layout.shippingBin],
    ...layout.clearZones.map((zone, i): [string, TileRect] => [`clearZones[${i}]`, zone]),
  ];
  for (const [name, rect] of rects) {
    if (!rectInBounds(grid, rect)) throw new RangeError(`Farm layout: ${name} lies outside the grid`);
  }
  if (!rectContains(layout.house, layout.houseDoor.tx, layout.houseDoor.tz)) {
    throw new RangeError('Farm layout: houseDoor must be a house tile');
  }
  if (!inBounds(grid, PLAYER.spawn.tx, PLAYER.spawn.tz)) {
    throw new RangeError('Farm layout: player spawn lies outside the grid');
  }
  if (!layout.clearZones.some((zone) => rectContains(zone, PLAYER.spawn.tx, PLAYER.spawn.tz))) {
    throw new RangeError('Farm layout: player spawn must lie inside a clear zone');
  }
  if (!(layout.pond.radiusX > 0) || !(layout.pond.radiusZ > 0)) {
    throw new RangeError('Farm layout: pond radii must be positive');
  }
}

export function generateTile(seed: number, layout: FarmLayout, tx: number, tz: number): Tile {
  if (rectContains(layout.house, tx, tz)) return blockedTile(Blocker.House);
  if (rectContains(layout.shippingBin, tx, tz)) return blockedTile(Blocker.ShippingBin);
  if (isPondTile(layout.pond, tx, tz)) return blockedTile(Blocker.Water);
  if (layout.clearZones.some((zone) => rectContains(zone, tx, tz))) return EMPTY_TILE;

  const roll = hashFloat(seed, tx, tz, Salt.Debris);
  if (roll < layout.rockDensity) return blockedTile(Blocker.Rock, TOOLS.rockHits);
  if (roll < layout.rockDensity + layout.stumpDensity) return blockedTile(Blocker.Stump, TOOLS.stumpHits);
  return EMPTY_TILE;
}

/**
 * The farm. Initial wild crops go on empty shaded tiles except the spawn and the `reserved`
 * (warp and arrival) tiles, with `wildDensity` (the farm's `SHADE.initialDensity`).
 */
export function generateWorld(
  seed: number,
  grid: GridSpec,
  layout: FarmLayout = LAYOUT,
  reserved: readonly TileCoord[] = [],
  wildDensity: number = SHADE.initialDensity,
): WorldState {
  assertLayout(grid, layout);
  const wildCrops = shadeCropsInSeason(seasonOfDay(0)).map((def) => def.id);
  return createWorld(grid, (tx, tz) => {
    const tile = generateTile(seed, layout, tx, tz);
    const isSpawn = tx === PLAYER.spawn.tx && tz === PLAYER.spawn.tz;
    if (tile !== EMPTY_TILE || isSpawn || !isShadedTile(grid, tx, tz, layout)) return tile;
    if (reserved.some((r) => r.tx === tx && r.tz === tz)) return tile;
    const crop = initialWildCrop(seed, 0, wildCrops, tx, tz, wildDensity);
    return crop === null ? tile : { ...tile, crop };
  });
}
