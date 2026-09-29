/**
 * The map registry: every map's static definition, the per-map seed, world generation for a new
 * game, and lookups. The definitions are validated once at module load.
 */
import { PLAYER } from '../../config';
import { MAP_IDS, type MapId, type TileRect, type WorldState } from '../../core/types';
import { inBounds, rectContains, rectInBounds, stepTile } from '../grid';
import { isPondTile } from '../worldgen';
import { FARM_MAP } from './farm';
import { FOREST_MAP } from './forest';
import { coordIn } from './lookup';
import { TOWN_MAP, assertTownLayout } from './town';
import type { MapDefinition } from './types';

export { findWarp, isReservedTile, mapSeed, structureAt } from './lookup';
export type { MapDefinition, SceneryStyle, StructurePlacement, Surface, Warp, WildTuning } from './types';

function rectsOverlap(a: TileRect, b: TileRect): boolean {
  return a.x0 < b.x0 + b.width && b.x0 < a.x0 + a.width && a.z0 < b.z0 + b.depth && b.z0 < a.z0 + a.depth;
}

function assertWarps(defs: Readonly<Record<MapId, MapDefinition>>, def: MapDefinition): void {
  for (const warp of def.warps) {
    const name = `Map ${def.id}: warp at (${warp.from.tx}, ${warp.from.tz})`;
    const { tx, tz } = warp.from;
    const onEdge = tx === 0 || tz === 0 || tx === def.grid.width - 1 || tz === def.grid.depth - 1;
    if (!inBounds(def.grid, tx, tz) || !onEdge) throw new RangeError(`${name} is not an edge tile`);
    const out = stepTile(warp.from, warp.exit);
    if (inBounds(def.grid, out.tx, out.tz)) throw new RangeError(`${name} exits into the grid`);
    const target = defs[warp.to.mapId];
    if (!inBounds(target.grid, warp.to.tx, warp.to.tz)) throw new RangeError(`${name} targets a tile outside ${target.id}`);
    const reciprocal = target.warps.some((back) => {
      if (back.to.mapId !== def.id) return false;
      const d = Math.abs(back.to.tx - tx) + Math.abs(back.to.tz - tz);
      return d === 1;
    });
    if (!reciprocal) throw new RangeError(`${name} has no reciprocal warp on ${target.id}`);
    if (!coordIn(def.reserved, tx, tz)) throw new RangeError(`${name} is not reserved`);
    if (!coordIn(target.reserved, warp.to.tx, warp.to.tz)) throw new RangeError(`${name} arrives on an unreserved tile`);
  }
}

function assertStructures(def: MapDefinition): void {
  def.structures.forEach((s, i) => {
    if (!rectInBounds(def.grid, s.rect)) throw new RangeError(`Map ${def.id}: ${s.kind} lies outside the grid`);
    for (const other of def.structures.slice(i + 1)) {
      if (rectsOverlap(s.rect, other.rect)) throw new RangeError(`Map ${def.id}: ${s.kind} overlaps ${other.kind}`);
    }
    if (def.reserved.some((r) => rectContains(s.rect, r.tx, r.tz))) {
      throw new RangeError(`Map ${def.id}: ${s.kind} covers a reserved tile`);
    }
  });
}

function assertFarmSpawn(def: MapDefinition): void {
  const layout = def.farmstead;
  const { tx, tz } = PLAYER.spawn;
  const clear =
    layout !== null &&
    inBounds(def.grid, tx, tz) &&
    layout.clearZones.some((zone) => rectContains(zone, tx, tz)) &&
    !rectContains(layout.house, tx, tz) &&
    !rectContains(layout.shippingBin, tx, tz) &&
    !isPondTile(layout.pond, tx, tz) &&
    !coordIn(def.reserved, tx, tz);
  if (!clear) throw new RangeError('Map farm: the player spawn is not clear');
}

/**
 * Throws on a broken set of definitions: a warp not on the edge or exiting into the grid, a
 * target out of bounds, a warp without a reciprocal (the target map must have a warp to this
 * map arriving orthogonally next to `from`), an unreserved warp or arrival tile, a structure
 * outside the grid or overlapping another structure or a reserved tile, a farm spawn that isn't
 * clear, and the town's own layout rules (`assertTownLayout`).
 */
export function assertMapDefinitions(defs: Readonly<Record<MapId, MapDefinition>>): void {
  for (const id of MAP_IDS) {
    const def = defs[id];
    if (def.id !== id) throw new RangeError(`Map ${id}: definition has id ${def.id}`);
    for (const r of def.reserved) {
      if (!inBounds(def.grid, r.tx, r.tz)) throw new RangeError(`Map ${id}: reserved tile (${r.tx}, ${r.tz}) is out of bounds`);
    }
    assertWarps(defs, def);
    assertStructures(def);
  }
  assertFarmSpawn(defs.farm);
  assertTownLayout(defs.town);
}

export const MAPS: Readonly<Record<MapId, MapDefinition>> = { farm: FARM_MAP, forest: FOREST_MAP, town: TOWN_MAP };
assertMapDefinitions(MAPS);

export function getMap(id: MapId): MapDefinition {
  return MAPS[id];
}

/** A new game's worlds, one per map, each from its own map seed. */
export function generateMaps(seed: number): Record<MapId, WorldState> {
  return { farm: MAPS.farm.generate(seed), forest: MAPS.forest.generate(seed), town: MAPS.town.generate(seed) };
}
