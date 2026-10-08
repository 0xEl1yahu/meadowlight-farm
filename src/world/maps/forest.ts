/**
 * Mossy Woods (36 × 30): a shaded forest west of the farm. A dirt trail runs in from the east
 * gate to a sunny clearing; a brook winds north to south with a tree-free bank so its water
 * stays reachable. Everything else is a seeded roll of trees, rocks, stumps and weeds, and wild
 * shade crops grow on the open forest floor.
 */
import { TOOLS, WORLD } from '../../config';
import { Salt, hashFloat } from '../../core/hash';
import { Blocker, Direction, type Tile, type WorldState } from '../../core/types';
import { initialWildCrop } from '../../farming/wild';
import { shadeCropsInSeason } from '../../farming/crops';
import { seasonOfDay } from '../../time/clock';
import { createGridSpec } from '../grid';
import { EMPTY_TILE, blockedTile, createWorld } from '../tiles';
import { coordIn, mapSeed, precomputeMask, precomputeSurfaces } from './lookup';
import type { MapDefinition, WildTuning } from './types';

const grid = createGridSpec(36, 30, WORLD.chunkSize, WORLD.tileSize);

const reserved = [
  { tx: 35, tz: 15 },
  { tx: 34, tz: 15 },
] as const;

const wild: WildTuning = { sproutChance: 0.02, spreadChancePerNeighbor: 0.12, maxWild: 60, initialDensity: 0.06 };

/** Trail (dirt; no debris or wild crops at generation): x 22–35, z 14–16. */
export function isForestTrail(tx: number, tz: number): boolean {
  return tx >= 22 && tx <= 35 && tz >= 14 && tz <= 16;
}

const CLEARING = { x: 17.5, z: 14.5, radius: 5 } as const;

/** Clearing (grass; no debris; the only unshaded part): centre strictly closer than 5 to (17.5, 14.5). */
export function isForestClearing(tx: number, tz: number): boolean {
  return Math.hypot(tx + 0.5 - CLEARING.x, tz + 0.5 - CLEARING.z) < CLEARING.radius;
}

const BROOK: readonly (readonly [number, number])[] = [
  [6.5, 3.5],
  [9.5, 8.5],
  [8.5, 13.5],
  [11.5, 19.5],
  [10.5, 25.5],
];

/** Distance from (x, z) to the brook's centre line. */
function brookDistance(x: number, z: number): number {
  let best = Infinity;
  for (let i = 1; i < BROOK.length; i++) {
    const a = BROOK[i - 1];
    const b = BROOK[i];
    if (a === undefined || b === undefined) continue;
    const [ax, az] = a;
    const [bx, bz] = b;
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    best = Math.min(best, Math.hypot(x - (ax + t * dx), z - (az + t * dz)));
  }
  return best;
}

/** Brook water: tile centre within 1.1 of the polyline. */
export function isForestBrook(tx: number, tz: number): boolean {
  return brookDistance(tx + 0.5, tz + 0.5) <= 1.1;
}

/** Brook bank: centre within 2.2 of the polyline and not water. No Tree, Rock or Stump here. */
export function isForestBank(tx: number, tz: number): boolean {
  return !isForestBrook(tx, tz) && brookDistance(tx + 0.5, tz + 0.5) <= 2.2;
}

const brookMask = precomputeMask(grid, isForestBrook);
const bankMask = precomputeMask(grid, isForestBank);
const clearingMask = precomputeMask(grid, isForestClearing);

/** Debris roll for one forest-floor tile (not water, trail or clearing). */
function rollFloor(seed: number, tx: number, tz: number): Tile {
  const r = hashFloat(seed, tx, tz, Salt.ForestGen);
  const bank = bankMask(tx, tz);
  if (r < 0.24) return bank ? EMPTY_TILE : blockedTile(Blocker.Tree, TOOLS.treeHits);
  if (r < 0.27) return bank ? EMPTY_TILE : blockedTile(Blocker.Rock, TOOLS.rockHits);
  if (r < 0.3) return bank ? EMPTY_TILE : blockedTile(Blocker.Stump, TOOLS.stumpHits);
  if (r < 0.36) return blockedTile(Blocker.Weeds);
  return EMPTY_TILE;
}

function generateForest(seed: number): WorldState {
  const mseed = mapSeed(seed, 'forest');
  const wildCrops = shadeCropsInSeason(seasonOfDay(0)).map((def) => def.id);
  return createWorld(grid, (tx, tz) => {
    if (brookMask(tx, tz)) return blockedTile(Blocker.Water);
    if (isForestTrail(tx, tz) || clearingMask(tx, tz)) return EMPTY_TILE;
    const tile = rollFloor(mseed, tx, tz);
    if (tile !== EMPTY_TILE || coordIn(reserved, tx, tz) || !FOREST_MAP.isShaded(tx, tz)) return tile;
    const crop = initialWildCrop(mseed, 0, wildCrops, tx, tz, wild.initialDensity);
    return crop === null ? tile : { ...tile, crop };
  });
}

export const FOREST_MAP: MapDefinition = {
  id: 'forest',
  name: 'Mossy Woods',
  grid,
  allowsTilling: false,
  warps: [
    { from: { tx: 35, tz: 15 }, exit: Direction.East, to: { mapId: 'farm', tx: 1, tz: 13, facing: Direction.East } },
  ],
  reserved,
  structures: [],
  npcs: [],
  wild,
  farmstead: null,
  scenery: 'forest',
  decor: { tuftChance: 0.1, flowerChance: 0.02 },
  cosmeticOffset: { x: 1009, z: 2003 },
  isShaded: precomputeMask(grid, (tx, tz) => !isForestClearing(tx, tz)),
  surfaceAt: precomputeSurfaces(grid, (tx, tz) => (isForestTrail(tx, tz) ? 'dirt' : 'grass')),
  generate: generateForest,
};
