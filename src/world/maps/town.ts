/**
 * Brookhollow (40 × 32): the town south-east of the farm. Pure data, identical for every seed:
 * shops along the back (−Z) edge behind a hedge line, a cobbled square with a well, a main
 * street from the west gate, and a river along the south with a promenade in front of it.
 *
 * Occlusion rule: the camera looks from +X/+Z, so anything tall hides the tiles on its −X/−Z
 * side. The shops therefore stand against the back edge, and every other back-band tile
 * (z 0–6) is hedge or the notice board, so nothing walkable is ever hidden behind a building.
 * Only thin lamp posts and the low well stand in the open.
 */
import { WORLD } from '../../config';
import { Blocker, Direction, type TileRect, type WorldState } from '../../core/types';
import { createGridSpec, rectContains } from '../grid';
import { EMPTY_TILE, blockedTile, createWorld } from '../tiles';
import { precomputeMask, precomputeSurfaces } from './lookup';
import type { MapDefinition, NpcPlacement, StructurePlacement, Surface } from './types';

const grid = createGridSpec(40, 32, WORLD.chunkSize, WORLD.tileSize);

/** Rows z 0 … TOWN_BACK_BAND_DEPTH − 1 are shops, hedges and the notice board, wall to wall. */
export const TOWN_BACK_BAND_DEPTH = 7;

const rect = (x0: number, z0: number, width: number, depth: number): TileRect => ({ x0, z0, width, depth });
const hedge = (x0: number, z0: number, width: number, depth: number): StructurePlacement => ({
  kind: 'hedge',
  rect: rect(x0, z0, width, depth),
  door: null,
});
const lampPost = (tx: number, tz: number): StructurePlacement => ({ kind: 'lampPost', rect: rect(tx, tz, 1, 1), door: null });

const structures: readonly StructurePlacement[] = [
  { kind: 'generalStore', rect: rect(3, 0, 7, 7), door: { tx: 6, tz: 6 } },
  { kind: 'blacksmith', rect: rect(12, 0, 6, 7), door: { tx: 15, tz: 6 } },
  { kind: 'carpenter', rect: rect(22, 0, 6, 7), door: { tx: 25, tz: 6 } },
  { kind: 'ranch', rect: rect(31, 0, 7, 7), door: { tx: 34, tz: 6 } },
  { kind: 'noticeBoard', rect: rect(19, 6, 2, 1), door: null },
  hedge(0, 0, 3, 7),
  hedge(10, 0, 2, 7),
  hedge(18, 0, 4, 6),
  hedge(18, 6, 1, 1),
  hedge(21, 6, 1, 1),
  hedge(28, 0, 3, 7),
  hedge(38, 0, 2, 7),
  { kind: 'well', rect: rect(19, 13, 2, 2), door: null },
  lampPost(13, 8),
  lampPost(26, 8),
  lampPost(13, 20),
  lampPost(26, 20),
  lampPost(4, 14),
  lampPost(36, 14),
];

/**
 * The characters (part 4a spec §2.1), facing the square. Each shopkeeper stands one tile east of
 * the tile in front of their door, so the door path stays clear; Juniper stands one tile west,
 * because the lamp post at (26, 8) is south of the east tile. Sol stands at the top of the square.
 */
const npcs: readonly NpcPlacement[] = [
  { id: 'sol', tx: 21, tz: 7, facing: Direction.South },
  { id: 'marigold', tx: 7, tz: 7, facing: Direction.South },
  { id: 'bram', tx: 16, tz: 7, facing: Direction.South },
  { id: 'juniper', tx: 24, tz: 7, facing: Direction.South },
  { id: 'tess', tx: 35, tz: 7, facing: Direction.South },
];

/** Cobbled main street, z 15–17 across the whole width. */
export const TOWN_MAIN_STREET = rect(0, 15, 40, 3);
/** Cobbled square, x 14–25, z 7–19: meets the blacksmith and carpenter doors and the notice board. */
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

/**
 * Town-only layout rules, checked by `assertMapDefinitions`: the shops, hedges and notice board
 * cover the back band exactly once; no structure touches the river or a path, except the low
 * well standing in the cobbled square; every door is on its rect's front row with a walkable,
 * unbuilt tile in front of it.
 */
export function assertTownLayout(def: MapDefinition): void {
  const { width } = def.grid;
  for (let tz = 0; tz < TOWN_BACK_BAND_DEPTH; tz++) {
    for (let tx = 0; tx < width; tx++) {
      const covering = def.structures.filter((s) => rectContains(s.rect, tx, tz));
      const kinds = covering.map((s) => s.kind).join(', ');
      if (covering.length !== 1 || covering[0]?.kind === 'well' || covering[0]?.kind === 'lampPost') {
        throw new RangeError(`Town: back-band tile (${tx}, ${tz}) is covered by [${kinds}], not by exactly one shop, hedge or notice board`);
      }
    }
  }
  for (const s of def.structures) {
    for (let tz = s.rect.z0; tz < s.rect.z0 + s.rect.depth; tz++) {
      for (let tx = s.rect.x0; tx < s.rect.x0 + s.rect.width; tx++) {
        if (isTownRiver(tx, tz)) throw new RangeError(`Town: ${s.kind} at (${tx}, ${tz}) stands in the river`);
        const onSquare = rectContains(TOWN_SQUARE, tx, tz) && !rectContains(TOWN_MAIN_STREET, tx, tz);
        if (def.surfaceAt(tx, tz) !== 'grass' && !(s.kind === 'well' && onSquare)) {
          throw new RangeError(`Town: ${s.kind} at (${tx}, ${tz}) blocks a path`);
        }
      }
    }
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
  warps: [{ from: { tx: 0, tz: 16 }, exit: Direction.West, to: { mapId: 'farm', tx: 46, tz: 38, facing: Direction.West } }],
  reserved: [
    { tx: 0, tz: 16 },
    { tx: 1, tz: 16 },
  ],
  structures,
  npcs,
  wild: null,
  farmstead: null,
  scenery: 'town',
  decor: { tuftChance: 0.04, flowerChance: 0.03 },
  cosmeticOffset: { x: 3001, z: 4007 },
  isShaded: precomputeMask(grid, () => false),
  surfaceAt: precomputeSurfaces(grid, townSurface),
  generate: () => generateTown(),
};
