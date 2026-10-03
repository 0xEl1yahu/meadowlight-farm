/**
 * Pure layout rules of the ObjectRenderer (spec §7.3), free of three.js so they are unit-tested
 * (tests/objectLayout.test.ts):
 *
 * - Anchors: every placed object draws at its own tile, except a giant crop, which draws once,
 *   at its anchor (the min-x, min-z corner of its 3×3 footprint). Covered tiles are skipped.
 * - Looks: what a key shows is the object's kind plus the few fields that change its look (a
 *   forage item, a giant crop's crop, a trophy's festival, a decoration's variant). A chest's
 *   slots and a forage's spawn day are not part of the look.
 * - Placement vs update: a changed object is a placement (pop-in, matrix write) only when the
 *   key showed nothing or another kind. Same kind with a different look is an update (rewrite
 *   without a pop); same kind and look is nothing at all, so a chest deposit never re-pops the
 *   chest or overwrites its open lid.
 * - Fence rails: keyed by edge (tileIndex · 2 + side, side 0 = east, 1 = south). A rail exists
 *   when the fences on both of its tiles exist. A change at (tx, tz) can only affect the east and
 *   south rails of (tx, tz), the east rail of (tx − 1, tz) and the south rail of (tx, tz − 1).
 * - Motion: the pop-in curve (CropRenderer's ease-out-back entrance) and the chest lid easing
 *   open while `ui.panel` is that chest.
 */
import { Salt, hash32 } from '../core/hash';
import type { GameState, GridSpec, MapId, PlacedObject, PlacedObjectKind, Tile, TileCoord, WorldState } from '../core/types';
import { inBounds, tileIndex } from '../world/grid';
import { getTile, isSoil } from '../world/tiles';
import { HEIGHTS } from './constants';

// ---------------------------------------------------------------------------
// Anchors and looks
// ---------------------------------------------------------------------------

/** True when the object on (tx, tz) is drawn there: always, except on a giant crop's covered tiles. */
export function drawsAt(object: PlacedObject, tx: number, tz: number): boolean {
  return object.kind !== 'giantCrop' || (object.anchorTx === tx && object.anchorTz === tz);
}

/** The object a tile draws, or null for an empty tile and a giant crop's covered tiles. */
export function drawnObject(tile: Tile, tx: number, tz: number): PlacedObject | null {
  const object = tile.object;
  return object !== null && drawsAt(object, tx, tz) ? object : null;
}

/** Height of the ground an object stands on: sunken soil (a sprinkler on a bed) or grass. */
export function objectGroundHeight(tile: Tile): number {
  return isSoil(tile) ? HEIGHTS.soilTop : HEIGHTS.grassTop;
}

/** What one key shows: the object kind plus the data that changes its look ('' when none does). */
export interface ObjectLook {
  readonly kind: PlacedObjectKind;
  readonly variant: string;
}

export function objectLook(object: PlacedObject): ObjectLook {
  switch (object.kind) {
    case 'giantCrop':
      return { kind: object.kind, variant: object.cropId };
    case 'forage':
      return { kind: object.kind, variant: object.itemId };
    case 'trophy':
      return { kind: object.kind, variant: object.festival };
    case 'decoration':
      return { kind: object.kind, variant: object.variant };
    case 'chest':
    case 'woodBurner':
    case 'sprinkler':
    case 'qualitySprinkler':
    case 'scarecrow':
    case 'woodFence':
    case 'woodPath':
    case 'stonePath':
    case 'workbench':
      return { kind: object.kind, variant: '' };
  }
}

/**
 * - `none`: nothing to do (still empty, or the same kind with the same look);
 * - `place`: a new kind appears on the key (pop in, write matrices);
 * - `update`: the same kind with another look (swap parts in place, no pop);
 * - `remove`: the key's object is gone (touch only the recorded kind's parts).
 */
export type ObjectChange = 'none' | 'place' | 'update' | 'remove';

export function classifyObjectChange(shown: ObjectLook | undefined, next: ObjectLook | null): ObjectChange {
  if (next === null) return shown === undefined ? 'none' : 'remove';
  if (shown === undefined || shown.kind !== next.kind) return 'place';
  return shown.variant === next.variant ? 'none' : 'update';
}

// ---------------------------------------------------------------------------
// Fence rails
// ---------------------------------------------------------------------------

export const RAIL_SIDE = { east: 0, south: 1 } as const;
export type RailSide = (typeof RAIL_SIDE)[keyof typeof RAIL_SIDE];

/** A rail from the centre of (tx, tz) to the centre of its east or south neighbour. */
export interface FenceEdge {
  readonly tx: number;
  readonly tz: number;
  readonly side: RailSide;
}

/** The neighbour a rail leads to. */
export function railNeighbour(edge: FenceEdge): { readonly tx: number; readonly tz: number } {
  return edge.side === RAIL_SIDE.east ? { tx: edge.tx + 1, tz: edge.tz } : { tx: edge.tx, tz: edge.tz + 1 };
}

/** Both ends of the edge lie inside the grid. */
export function isEdgeInGrid(grid: GridSpec, edge: FenceEdge): boolean {
  const end = railNeighbour(edge);
  return inBounds(grid, edge.tx, edge.tz) && inBounds(grid, end.tx, end.tz);
}

export function fenceRailKey(grid: GridSpec, edge: FenceEdge): number {
  return tileIndex(grid, edge.tx, edge.tz) * 2 + edge.side;
}

/**
 * The rails a change at (tx, tz) can affect: the east and south rails of (tx, tz), the east rail
 * of (tx − 1, tz) and the south rail of (tx, tz − 1), keeping only edges inside the grid.
 */
export function fenceEdgesAround(grid: GridSpec, tx: number, tz: number): FenceEdge[] {
  const edges: FenceEdge[] = [
    { tx, tz, side: RAIL_SIDE.east },
    { tx, tz, side: RAIL_SIDE.south },
    { tx: tx - 1, tz, side: RAIL_SIDE.east },
    { tx, tz: tz - 1, side: RAIL_SIDE.south },
  ];
  return edges.filter((edge) => isEdgeInGrid(grid, edge));
}

function isFenceTile(tile: Tile | null): boolean {
  return tile !== null && tile.object !== null && tile.object.kind === 'woodFence';
}

/** A rail stands on the edge when both of its tiles hold a wood fence. */
export function hasFenceRail(world: WorldState, edge: FenceEdge): boolean {
  const end = railNeighbour(edge);
  return isFenceTile(getTile(world, edge.tx, edge.tz)) && isFenceTile(getTile(world, end.tx, end.tz));
}

// ---------------------------------------------------------------------------
// Cosmetic variety
// ---------------------------------------------------------------------------

/** Number of flagstone layouts a stone path picks from. */
export const STONE_PATH_VARIANTS = 3;

/**
 * Deterministic cosmetic value in [0, 2³²) for an object on (tx, tz), where (ox, oz) is the map's
 * cosmeticOffset so maps don't repeat each other's patterns. `channel` separates independent picks.
 */
export function objectCosmetic(tx: number, tz: number, ox: number, oz: number, channel: number): number {
  return hash32(tx + ox, tz + oz, channel, Salt.Cosmetic);
}

/** Which of the STONE_PATH_VARIANTS flagstone layouts a stone path on (tx, tz) shows. */
export function stonePathVariant(tx: number, tz: number, ox: number, oz: number): number {
  return objectCosmetic(tx, tz, ox, oz, 0x57a7) % STONE_PATH_VARIANTS;
}

// ---------------------------------------------------------------------------
// Motion
// ---------------------------------------------------------------------------

export const OBJECT_MOTION = {
  /** Length of the pop-in when an object is placed. */
  popSeconds: 0.45,
  /** Ease-out-back overshoot (CropRenderer's entrance uses the same gentle value). */
  overshoot: 1.35,
  /** Never upload an exactly singular matrix. */
  minScale: 1e-4,
  /** Exponential rate (1/s) of the chest lid; it settles in about 0.35 s. */
  lidRate: 10,
  /** The lid snaps to its target once this close. */
  lidEpsilon: 0.002,
} as const;

/** Pop-in scale at progress t ∈ [0, 1]: ease-out-back from (almost) nothing, exactly 1 at the end. */
export function popScale(t: number): number {
  if (t >= 1) return 1;
  if (t <= 0) return OBJECT_MOTION.minScale;
  const c1 = OBJECT_MOTION.overshoot;
  const c3 = c1 + 1;
  const u = t - 1;
  return Math.max(OBJECT_MOTION.minScale, 1 + c3 * u * u * u + c1 * u * u);
}

/** Lid openness (0 closed, 1 open) after `dt` seconds easing toward `target`; snaps once close. */
export function approachLid(current: number, target: number, dt: number): number {
  const next = current + (target - current) * (1 - Math.exp(-OBJECT_MOTION.lidRate * dt));
  return Math.abs(target - next) < OBJECT_MOTION.lidEpsilon ? target : next;
}

/** The tile of the chest open in `ui.panel` when that chest is on `mapId`; null otherwise. */
export function openChestTile(state: GameState, mapId: MapId): TileCoord | null {
  const panel = state.ui.panel;
  return panel.kind === 'chest' && panel.mapId === mapId ? { tx: panel.tx, tz: panel.tz } : null;
}
