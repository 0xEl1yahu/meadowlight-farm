/**
 * Meadowlight Farm (48 × 40): the player's own land. Wraps the original farm generator
 * unchanged, so every farm hash stays bit-identical (the farm's map seed is the save seed).
 * The west gate leads to the forest and the south-east gate to the town.
 */
import { LAYOUT, SHADE, WORLD } from '../../config';
import { Direction } from '../../core/types';
import { createGridSpec } from '../grid';
import { isShadedTile } from '../shade';
import { generateWorld } from '../worldgen';
import { precomputeMask, precomputeSurfaces } from './lookup';
import type { MapDefinition, Warp } from './types';

const grid = createGridSpec(48, 40, WORLD.chunkSize, WORLD.tileSize);

const warps: readonly Warp[] = [
  { from: { tx: 0, tz: 13 }, exit: Direction.West, to: { mapId: 'forest', tx: 34, tz: 15, facing: Direction.West } },
  { from: { tx: 47, tz: 38 }, exit: Direction.East, to: { mapId: 'town', tx: 1, tz: 16, facing: Direction.East } },
];

const reserved = [
  { tx: 0, tz: 13 },
  { tx: 1, tz: 13 },
  { tx: 47, tz: 38 },
  { tx: 46, tz: 38 },
] as const;

export const FARM_MAP: MapDefinition = {
  id: 'farm',
  name: 'Meadowlight Farm',
  grid,
  allowsTilling: true,
  warps,
  reserved,
  structures: [],
  npcs: [],
  wild: {
    sproutChance: SHADE.sproutChance,
    spreadChancePerNeighbor: SHADE.spreadChancePerNeighbor,
    maxWild: SHADE.maxWild,
    initialDensity: SHADE.initialDensity,
  },
  farmstead: LAYOUT,
  scenery: 'farm',
  decor: { tuftChance: 0.4, flowerChance: 0.05 },
  cosmeticOffset: { x: 0, z: 0 },
  isShaded: precomputeMask(grid, (tx, tz) => isShadedTile(grid, tx, tz, LAYOUT)),
  surfaceAt: precomputeSurfaces(grid, () => 'grass'),
  generate: (seed) => generateWorld(seed, grid, LAYOUT, reserved, SHADE.initialDensity),
};
