/**
 * The Neighbours (40 × 28): Cosmo's and Barnaby's farms, east of the town (farmclaws part 4a
 * spec §5). Pure data, identical for every seed: two farmhouses and a chicken coop along the
 * back (−Z) edge behind a hedge line, a dirt lane from the west gate, and two fenced fields of
 * bare dirt, Cosmo's north of the lane and Barnaby's south of it.
 *
 * Occlusion rule, as in the town: the camera looks from +X/+Z, so anything tall hides the tiles
 * on its −X/−Z side. The houses and the coop therefore stand against the back edge, and every
 * other back-band tile (z 0–4) is hedge. Out in the open there are only the low wood fences.
 */
import { WORLD } from '../../config';
import { Blocker, Direction, type StructureKind, type Tile, type TileCoord, type TileRect, type WorldState } from '../../core/types';
import { createGridSpec, rectContains } from '../grid';
import { EMPTY_TILE, blockedTile, createWorld, isWalkable, requireTile } from '../tiles';
import { precomputeMask, precomputeSurfaces, reachableTiles } from './lookup';
import type { MapDefinition, StructurePlacement, Surface } from './types';

const grid = createGridSpec(40, 28, WORLD.chunkSize, WORLD.tileSize);

/** Rows z 0 … NEIGHBOURS_BACK_BAND_DEPTH − 1 are houses, the coop and hedges, wall to wall. */
export const NEIGHBOURS_BACK_BAND_DEPTH = 5;

/** Where the town's east gate arrives: one tile inside the west edge, on the lane. */
const ARRIVAL: TileCoord = { tx: 1, tz: 14 };

const rect = (x0: number, z0: number, width: number, depth: number): TileRect => ({ x0, z0, width, depth });
const hedge = (x0: number, z0: number, width: number, depth: number): StructurePlacement => ({
  kind: 'hedge',
  rect: rect(x0, z0, width, depth),
  door: null,
});

const structures: readonly StructurePlacement[] = [
  { kind: 'cosmoHouse', rect: rect(3, 0, 6, 5), door: { tx: 5, tz: 4 } },
  { kind: 'chickenCoop', rect: rect(11, 0, 4, 5), door: null },
  { kind: 'barnabyHouse', rect: rect(24, 0, 6, 5), door: { tx: 26, tz: 4 } },
  hedge(0, 0, 3, 5),
  hedge(9, 0, 2, 5),
  hedge(15, 0, 9, 5),
  hedge(30, 0, 10, 5),
];

/** The kinds that may stand in the back band; nothing else is tall enough to need it, and nothing stands outside it. */
const BACK_BAND_KINDS: readonly StructureKind[] = ['cosmoHouse', 'barnabyHouse', 'chickenCoop', 'hedge'];

/** The dirt lane, z 13–15 across the whole width: the west gate's road. */
export const NEIGHBOURS_LANE = rect(0, 13, 40, 3);
/** Inside Cosmo's fence, x 4–9, z 6–11: bare dirt. */
export const COSMO_FIELD = rect(4, 6, 6, 6);
/** Inside Barnaby's fence, x 21–28, z 17–24: bare dirt. */
export const BARNABY_FIELD = rect(21, 17, 8, 8);

/** A rectangular ring of wood fence round a field, open at one tile. */
export interface FenceRing {
  /** The ring's north-west and south-east corner tiles. */
  readonly corners: readonly [TileCoord, TileCoord];
  /** The one ring tile left open as the field's gate. */
  readonly gap: TileCoord;
}

/** Round Cosmo's field, open on the lane side at (6, 12). */
export const COSMO_FENCE: FenceRing = { corners: [{ tx: 3, tz: 5 }, { tx: 10, tz: 12 }], gap: { tx: 6, tz: 12 } };
/** Round Barnaby's field, open on the lane side at (24, 16). */
export const BARNABY_FENCE: FenceRing = { corners: [{ tx: 20, tz: 16 }, { tx: 29, tz: 25 }], gap: { tx: 24, tz: 16 } };

const FENCES: readonly FenceRing[] = [COSMO_FENCE, BARNABY_FENCE];

/** Is (tx, tz) on the ring of `fence` (its gap included)? */
function onRing(fence: FenceRing, tx: number, tz: number): boolean {
  const [nw, se] = fence.corners;
  if (tx < nw.tx || tx > se.tx || tz < nw.tz || tz > se.tz) return false;
  return tx === nw.tx || tx === se.tx || tz === nw.tz || tz === se.tz;
}

/** A wood-fence tile: on either field's ring, except its gap. */
export function isFenceTile(tx: number, tz: number): boolean {
  return FENCES.some((fence) => onRing(fence, tx, tz) && !(tx === fence.gap.tx && tz === fence.gap.tz));
}

function neighboursSurface(tx: number, tz: number): Surface {
  const dirt = [NEIGHBOURS_LANE, COSMO_FIELD, BARNABY_FIELD].some((area) => rectContains(area, tx, tz));
  return dirt ? 'dirt' : 'grass';
}

/**
 * The Neighbours' own layout rules, checked by `assertMapDefinitions`: the houses, the coop and
 * the hedges cover the back band exactly once, and no structure stands outside it; every reserved
 * tile is clear; both fence rings are whole except their gaps, and the gaps are walkable; every
 * walkable tile is reachable from the arrival tile. The tiles are those of `def.generate(0)`, the
 * same for every seed.
 */
export function assertNeighboursLayout(def: MapDefinition): void {
  const { width, depth } = def.grid;
  for (let tz = 0; tz < NEIGHBOURS_BACK_BAND_DEPTH; tz++) {
    for (let tx = 0; tx < width; tx++) {
      const covering = def.structures.filter((s) => rectContains(s.rect, tx, tz));
      const only = covering.length === 1 ? covering[0] : undefined;
      if (only === undefined || !BACK_BAND_KINDS.includes(only.kind)) {
        const kinds = covering.map((s) => s.kind).join(', ');
        throw new RangeError(`Neighbours: back-band tile (${tx}, ${tz}) is covered by [${kinds}], not by exactly one house, coop or hedge`);
      }
    }
  }
  for (const s of def.structures) {
    if (s.rect.z0 + s.rect.depth > NEIGHBOURS_BACK_BAND_DEPTH) throw new RangeError(`Neighbours: ${s.kind} stands outside the back band`);
  }
  const world = def.generate(0);
  for (const r of def.reserved) {
    if (!isWalkable(requireTile(world, r.tx, r.tz))) throw new RangeError(`Neighbours: reserved tile (${r.tx}, ${r.tz}) is not clear`);
  }
  for (const fence of FENCES) {
    const [nw, se] = fence.corners;
    for (let tz = nw.tz; tz <= se.tz; tz++) {
      for (let tx = nw.tx; tx <= se.tx; tx++) {
        if (!onRing(fence, tx, tz)) continue;
        const tile = requireTile(world, tx, tz);
        if (tx === fence.gap.tx && tz === fence.gap.tz) {
          if (!isWalkable(tile)) throw new RangeError(`Neighbours: the fence gap at (${tx}, ${tz}) is blocked`);
        } else if (tile.object?.kind !== 'woodFence') {
          throw new RangeError(`Neighbours: the fence has a hole at (${tx}, ${tz})`);
        }
      }
    }
  }
  const reachable = reachableTiles(world, [ARRIVAL], () => false);
  for (let tz = 0; tz < depth; tz++) {
    for (let tx = 0; tx < width; tx++) {
      if (isWalkable(requireTile(world, tx, tz)) && !reachable(tx, tz)) {
        throw new RangeError(`Neighbours: (${tx}, ${tz}) can't be reached from the gate`);
      }
    }
  }
}

const structureMask = precomputeMask(grid, (tx, tz) => structures.some((s) => rectContains(s.rect, tx, tz)));
const fenceMask = precomputeMask(grid, isFenceTile);

/** Every fence tile is this one: tiles are immutable, so they can share it. */
const FENCE_TILE: Tile = Object.freeze({ ...EMPTY_TILE, object: Object.freeze({ kind: 'woodFence' }) });

/** Structures, then fences, then empty ground (grass or dirt by surface). No hash: the same for every seed. */
function generateNeighbours(): WorldState {
  return createWorld(grid, (tx, tz) => {
    if (structureMask(tx, tz)) return blockedTile(Blocker.Building);
    if (fenceMask(tx, tz)) return FENCE_TILE;
    return EMPTY_TILE;
  });
}

export const NEIGHBOURS_MAP: MapDefinition = {
  id: 'neighbours',
  name: 'The Neighbours',
  grid,
  allowsTilling: false,
  warps: [{ from: { tx: 0, tz: 14 }, exit: Direction.West, to: { mapId: 'town', tx: 38, tz: 16, facing: Direction.West } }],
  reserved: [{ tx: 0, tz: 14 }, ARRIVAL],
  structures,
  npcs: [
    { id: 'cosmo', tx: 7, tz: 13, facing: Direction.South },
    { id: 'barnaby', tx: 25, tz: 15, facing: Direction.North },
  ],
  wild: null,
  farmstead: null,
  scenery: 'farm',
  decor: { tuftChance: 0.3, flowerChance: 0.06 },
  cosmeticOffset: { x: 5003, z: 6011 },
  isShaded: precomputeMask(grid, () => false),
  surfaceAt: precomputeSurfaces(grid, neighboursSurface),
  generate: () => generateNeighbours(),
};
