/**
 * Brookhollow (40 × 32): the town south-east of the farm. Pure data, identical for every seed:
 * shops and SLOPMART's booth along the back (−Z) edge behind a hedge line, a cobbled square with a
 * well, a main street from the west gate to the east gate, a river along the south with a
 * promenade in front of it and the townsfolk's exits beyond it, and low props on the grass.
 *
 * Occlusion rule: the camera looks from +X/+Z, so anything tall hides the tiles on its −X/−Z
 * side. The shops, SLOPMART's booth and the parts exchange therefore stand against the back edge,
 * and every other back-band tile (z 0–6) is hedge, so nothing walkable is ever hidden behind a
 * building. Only thin lamp posts, the low well and the low props stand in the open.
 */
import { WORLD } from '../../config';
import { Blocker, Direction, type StructureKind, type TileCoord, type TileRect, type WorldState } from '../../core/types';
import { createGridSpec, rectContains } from '../grid';
import { EMPTY_TILE, blockedTile, createWorld } from '../tiles';
import { coordIn, precomputeMask, precomputeSurfaces } from './lookup';
import type { MapDefinition, StructurePlacement, Surface } from './types';

const grid = createGridSpec(40, 32, WORLD.chunkSize, WORLD.tileSize);

/** Rows z 0 … TOWN_BACK_BAND_DEPTH − 1 are shops, the parts exchange and hedges, wall to wall. */
export const TOWN_BACK_BAND_DEPTH = 7;

const rect = (x0: number, z0: number, width: number, depth: number): TileRect => ({ x0, z0, width, depth });
const hedge = (x0: number, z0: number, width: number, depth: number): StructurePlacement => ({
  kind: 'hedge',
  rect: rect(x0, z0, width, depth),
  door: null,
});
const lampPost = (tx: number, tz: number): StructurePlacement => ({ kind: 'lampPost', rect: rect(tx, tz, 1, 1), door: null });
const prop = (kind: StructureKind, x0: number, z0: number, width: number, depth: number): StructurePlacement => ({
  kind,
  rect: rect(x0, z0, width, depth),
  door: null,
});

/** The props (part 4d spec §7.1): scenery that blocks its tiles like the well. */
export const TOWN_PROP_KINDS: readonly StructureKind[] = ['marketStall', 'bench', 'planter', 'crates', 'barrels', 'cart'];
/** The kinds that may stand in the open, outside the back band: low, or thin like a lamp post. */
const OPEN_KINDS: readonly StructureKind[] = ['well', 'lampPost', ...TOWN_PROP_KINDS];

/**
 * The townsfolk's two south exits (part 4d spec §3.2), the south-west and south-east corners of
 * the river's south bank. Like a door, a walker steps off the map there; both are reserved.
 */
export const TOWN_EXITS: readonly TileCoord[] = [
  { tx: 0, tz: 30 },
  { tx: 39, tz: 30 },
];

const structures: readonly StructurePlacement[] = [
  { kind: 'generalStore', rect: rect(3, 0, 7, 7), door: { tx: 6, tz: 6 } },
  { kind: 'blacksmith', rect: rect(12, 0, 6, 7), door: { tx: 15, tz: 6 } },
  { kind: 'carpenter', rect: rect(22, 0, 6, 7), door: { tx: 25, tz: 6 } },
  { kind: 'ranch', rect: rect(31, 0, 7, 7), door: { tx: 34, tz: 6 } },
  // Sol's parts exchange stands on exactly the tiles of the old notice board and its three
  // hedges, so the town's blocked tiles, and every saved town, stay the same.
  { kind: 'partsExchange', rect: rect(18, 0, 4, 7), door: { tx: 20, tz: 6 } },
  // SLOPMART's booth (part 4d spec §6.1) stands on exactly the old hedge's tiles, with its counter at the door.
  { kind: 'slopShop', rect: rect(28, 0, 3, 7), door: { tx: 29, tz: 6 } },
  hedge(0, 0, 3, 7),
  hedge(10, 0, 2, 7),
  hedge(38, 0, 2, 7),
  { kind: 'well', rect: rect(19, 13, 2, 2), door: null },
  lampPost(13, 8),
  lampPost(26, 8),
  lampPost(13, 20),
  lampPost(26, 20),
  lampPost(4, 14),
  lampPost(36, 14),
  prop('marketStall', 9, 9, 2, 1),
  prop('marketStall', 9, 11, 2, 1),
  prop('marketStall', 29, 10, 2, 1),
  prop('bench', 15, 21, 2, 1),
  prop('bench', 23, 21, 2, 1),
  prop('planter', 12, 12, 1, 1),
  prop('planter', 27, 12, 1, 1),
  prop('crates', 3, 8, 1, 1),
  prop('crates', 4, 8, 1, 1),
  prop('barrels', 31, 8, 1, 1),
  prop('barrels', 32, 8, 1, 1),
  prop('cart', 37, 19, 2, 1),
];

/** Cobbled main street, z 15–17 across the whole width. */
export const TOWN_MAIN_STREET = rect(0, 15, 40, 3);
/** Cobbled square, x 14–25, z 7–19: meets the blacksmith, parts exchange and carpenter doors. */
export const TOWN_SQUARE = rect(14, 7, 12, 13);
/** Dirt: the door paths to the general store and the ranch, the promenade and its connector. */
export const TOWN_DIRT_PATHS: readonly TileRect[] = [rect(6, 7, 1, 8), rect(34, 7, 1, 8), rect(3, 22, 34, 1), rect(19, 20, 2, 2)];

function townSurface(tx: number, tz: number): Surface {
  if (rectContains(TOWN_MAIN_STREET, tx, tz) || rectContains(TOWN_SQUARE, tx, tz)) return 'cobble';
  if (TOWN_DIRT_PATHS.some((path) => rectContains(path, tx, tz))) return 'dirt';
  return 'grass';
}

/** The river: 3 ≤ tx ≤ 36, 24 ≤ tz ≤ 27, minus its four corners. The bank south of it is reachable around both ends. */
export function isTownRiver(tx: number, tz: number): boolean {
  if (tx < 3 || tx > 36 || tz < 24 || tz > 27) return false;
  return !((tx === 3 || tx === 36) && (tz === 24 || tz === 27));
}

/** Calls `fn` for every tile of `r`. */
function forEachRectTile(r: TileRect, fn: (tx: number, tz: number) => void): void {
  for (let tz = r.z0; tz < r.z0 + r.depth; tz++) {
    for (let tx = r.x0; tx < r.x0 + r.width; tx++) fn(tx, tz);
  }
}

/**
 * Town-only layout rules, checked by `assertMapDefinitions`: the shops, SLOPMART's booth, the
 * parts exchange and hedges cover the back band exactly once, and only the low or thin kinds
 * (OPEN_KINDS) stand outside it; every prop stands on grass, off every door front and reserved
 * tile; no structure touches the river or a path, except the low well standing in the cobbled
 * square; every door is on its rect's front row with a walkable, unbuilt tile in front of it.
 */
export function assertTownLayout(def: MapDefinition): void {
  const { width } = def.grid;
  for (let tz = 0; tz < TOWN_BACK_BAND_DEPTH; tz++) {
    for (let tx = 0; tx < width; tx++) {
      const covering = def.structures.filter((s) => rectContains(s.rect, tx, tz));
      const only = covering.length === 1 ? covering[0] : undefined;
      if (only === undefined || OPEN_KINDS.includes(only.kind)) {
        const kinds = covering.map((s) => s.kind).join(', ');
        throw new RangeError(`Town: back-band tile (${tx}, ${tz}) is covered by [${kinds}], not by exactly one shop, booth, parts exchange or hedge`);
      }
    }
  }
  const doorFronts = def.structures.flatMap((s) => (s.door === null ? [] : [{ tx: s.door.tx, tz: s.door.tz + 1 }]));
  for (const s of def.structures) {
    const inOpen = s.rect.z0 + s.rect.depth > TOWN_BACK_BAND_DEPTH;
    if (inOpen && !OPEN_KINDS.includes(s.kind)) {
      throw new RangeError(`Town: ${s.kind} at (${s.rect.x0}, ${s.rect.z0}) stands in the open, and only low kinds may`);
    }
    if (!TOWN_PROP_KINDS.includes(s.kind)) continue;
    forEachRectTile(s.rect, (tx, tz) => {
      if (def.surfaceAt(tx, tz) !== 'grass') throw new RangeError(`Town: ${s.kind} at (${tx}, ${tz}) is not on grass`);
      if (coordIn(doorFronts, tx, tz)) throw new RangeError(`Town: ${s.kind} at (${tx}, ${tz}) stands on a door front`);
      if (coordIn(def.reserved, tx, tz)) throw new RangeError(`Town: ${s.kind} at (${tx}, ${tz}) stands on a reserved tile`);
    });
  }
  for (const s of def.structures) {
    forEachRectTile(s.rect, (tx, tz) => {
      if (isTownRiver(tx, tz)) throw new RangeError(`Town: ${s.kind} at (${tx}, ${tz}) stands in the river`);
      const onSquare = rectContains(TOWN_SQUARE, tx, tz) && !rectContains(TOWN_MAIN_STREET, tx, tz);
      if (def.surfaceAt(tx, tz) !== 'grass' && !(s.kind === 'well' && onSquare)) {
        throw new RangeError(`Town: ${s.kind} at (${tx}, ${tz}) blocks a path`);
      }
    });
    if (s.door === null) continue;
    const front = { tx: s.door.tx, tz: s.door.tz + 1 };
    if (!rectContains(s.rect, s.door.tx, s.door.tz) || s.door.tz !== s.rect.z0 + s.rect.depth - 1) {
      throw new RangeError(`Town: ${s.kind} door is not on its front row`);
    }
    if (def.structures.some((o) => rectContains(o.rect, front.tx, front.tz)) || isTownRiver(front.tx, front.tz)) {
      throw new RangeError(`Town: the tile in front of the ${s.kind} door is blocked`);
    }
  }
}

const structureMask = precomputeMask(grid, (tx, tz) => structures.some((s) => rectContains(s.rect, tx, tz)));
const riverMask = precomputeMask(grid, isTownRiver);

/** Structures, then water, then grass. No hash: the town is the same for every seed. */
function generateTown(): WorldState {
  return createWorld(grid, (tx, tz) => {
    if (structureMask(tx, tz)) return blockedTile(Blocker.Building);
    if (riverMask(tx, tz)) return blockedTile(Blocker.Water);
    return EMPTY_TILE;
  });
}

export const TOWN_MAP: MapDefinition = {
  id: 'town',
  name: 'Brookhollow',
  grid,
  allowsTilling: false,
  warps: [
    { from: { tx: 0, tz: 16 }, exit: Direction.West, to: { mapId: 'farm', tx: 46, tz: 38, facing: Direction.West } },
    { from: { tx: 39, tz: 16 }, exit: Direction.East, to: { mapId: 'neighbours', tx: 1, tz: 14, facing: Direction.East } },
  ],
  reserved: [
    { tx: 0, tz: 16 },
    { tx: 1, tz: 16 },
    { tx: 39, tz: 16 },
    { tx: 38, tz: 16 },
    ...TOWN_EXITS,
  ],
  structures,
  wild: null,
  farmstead: null,
  scenery: 'town',
  decor: { tuftChance: 0.04, flowerChance: 0.03 },
  cosmeticOffset: { x: 3001, z: 4007 },
  isShaded: precomputeMask(grid, () => false),
  surfaceAt: precomputeSurfaces(grid, townSurface),
  generate: () => generateTown(),
};
