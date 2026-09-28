/**
 * Grid & chunk mathematics. Pure functions only — no THREE, no state.
 *
 * Coordinate spaces
 * - Tile space: integer (tx, tz), 0 ≤ tx < width, 0 ≤ tz < depth.
 * - Grid space: continuous (gx, gz) = tile space scaled to tile units; tile (tx, tz) covers
 *   gx ∈ [tx, tx + 1), gz ∈ [tz, tz + 1). Tile centres sit at (tx + 0.5, tz + 0.5).
 * - World space: x = originX + gx · tileSize, z = originZ + gz · tileSize.
 * - Chunk space: (cx, cz) = (⌊tx / chunkSize⌋, ⌊tz / chunkSize⌋), local (lx, lz) = remainder.
 *   Edge chunks are clipped to the grid, so their width/depth may be < chunkSize.
 *
 * All ranges are half-open; a world point exactly on the far edge (x = maxX) is out of bounds,
 * which guarantees every in-bounds point maps to exactly one tile.
 */
import type { Direction, GridSpec, TileCoord, TileRect } from '../core/types';

export interface TileLocation {
  readonly chunkIndex: number;
  readonly localIndex: number;
  readonly cx: number;
  readonly cz: number;
  readonly lx: number;
  readonly lz: number;
}

export interface ChunkRect extends TileRect {
  readonly cx: number;
  readonly cz: number;
}

export interface WorldRect {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export interface GridStep {
  readonly dx: -1 | 0 | 1;
  readonly dz: -1 | 0 | 1;
}

// ---------------------------------------------------------------------------
// Spec
// ---------------------------------------------------------------------------

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`GridSpec: ${name} must be a positive integer, got ${value}`);
  }
}

export function createGridSpec(width: number, depth: number, chunkSize: number, tileSize = 1): GridSpec {
  assertPositiveInteger('width', width);
  assertPositiveInteger('depth', depth);
  assertPositiveInteger('chunkSize', chunkSize);
  if (!(tileSize > 0) || !Number.isFinite(tileSize)) {
    throw new RangeError(`GridSpec: tileSize must be a positive finite number, got ${tileSize}`);
  }
  return {
    width,
    depth,
    chunkSize,
    tileSize,
    chunksX: Math.ceil(width / chunkSize),
    chunksZ: Math.ceil(depth / chunkSize),
    originX: -(width * tileSize) / 2,
    originZ: -(depth * tileSize) / 2,
  };
}

export function tileCount(grid: GridSpec): number {
  return grid.width * grid.depth;
}

export function chunkCount(grid: GridSpec): number {
  return grid.chunksX * grid.chunksZ;
}

// ---------------------------------------------------------------------------
// Tile indexing
// ---------------------------------------------------------------------------

export function inBounds(grid: GridSpec, tx: number, tz: number): boolean {
  return (
    Number.isInteger(tx) && Number.isInteger(tz) && tx >= 0 && tz >= 0 && tx < grid.width && tz < grid.depth
  );
}

/** Global row-major index. Precondition: inBounds(grid, tx, tz). */
export function tileIndex(grid: GridSpec, tx: number, tz: number): number {
  return tz * grid.width + tx;
}

export function tileFromIndex(grid: GridSpec, index: number): TileCoord {
  if (!Number.isInteger(index) || index < 0 || index >= tileCount(grid)) {
    throw new RangeError(`tileFromIndex: index ${index} outside [0, ${tileCount(grid)})`);
  }
  const tz = Math.floor(index / grid.width);
  return { tx: index - tz * grid.width, tz };
}

// ---------------------------------------------------------------------------
// Chunks
// ---------------------------------------------------------------------------

export function chunkIndex(grid: GridSpec, cx: number, cz: number): number {
  return cz * grid.chunksX + cx;
}

/** Tile-space rectangle covered by chunk (cx, cz), clipped to the grid. */
export function chunkRect(grid: GridSpec, cx: number, cz: number): ChunkRect {
  if (!Number.isInteger(cx) || !Number.isInteger(cz) || cx < 0 || cz < 0 || cx >= grid.chunksX || cz >= grid.chunksZ) {
    throw new RangeError(`chunkRect: chunk (${cx}, ${cz}) outside ${grid.chunksX}×${grid.chunksZ}`);
  }
  const x0 = cx * grid.chunkSize;
  const z0 = cz * grid.chunkSize;
  return {
    cx,
    cz,
    x0,
    z0,
    width: Math.min(grid.chunkSize, grid.width - x0),
    depth: Math.min(grid.chunkSize, grid.depth - z0),
  };
}

export function chunkRectByIndex(grid: GridSpec, index: number): ChunkRect {
  if (!Number.isInteger(index) || index < 0 || index >= chunkCount(grid)) {
    throw new RangeError(`chunkRectByIndex: index ${index} outside [0, ${chunkCount(grid)})`);
  }
  const cz = Math.floor(index / grid.chunksX);
  return chunkRect(grid, index - cz * grid.chunksX, cz);
}

/** Resolves a tile to its chunk and chunk-local storage index. Throws when out of bounds. */
export function locateTile(grid: GridSpec, tx: number, tz: number): TileLocation {
  if (!inBounds(grid, tx, tz)) {
    throw new RangeError(`locateTile: tile (${tx}, ${tz}) outside ${grid.width}×${grid.depth}`);
  }
  const cx = Math.floor(tx / grid.chunkSize);
  const cz = Math.floor(tz / grid.chunkSize);
  const lx = tx - cx * grid.chunkSize;
  const lz = tz - cz * grid.chunkSize;
  const chunkWidth = Math.min(grid.chunkSize, grid.width - cx * grid.chunkSize);
  return {
    chunkIndex: cz * grid.chunksX + cx,
    localIndex: lz * chunkWidth + lx,
    cx,
    cz,
    lx,
    lz,
  };
}

/** Inverse of the local part of locateTile for a given chunk rectangle. */
export function localIndexToTile(rect: TileRect, localIndex: number): TileCoord {
  if (!Number.isInteger(localIndex) || localIndex < 0 || localIndex >= rect.width * rect.depth) {
    throw new RangeError(`localIndexToTile: index ${localIndex} outside [0, ${rect.width * rect.depth})`);
  }
  const lz = Math.floor(localIndex / rect.width);
  return { tx: rect.x0 + (localIndex - lz * rect.width), tz: rect.z0 + lz };
}

export function rectContains(rect: TileRect, tx: number, tz: number): boolean {
  return tx >= rect.x0 && tz >= rect.z0 && tx < rect.x0 + rect.width && tz < rect.z0 + rect.depth;
}

export function rectInBounds(grid: GridSpec, rect: TileRect): boolean {
  return (
    Number.isInteger(rect.x0) &&
    Number.isInteger(rect.z0) &&
    Number.isInteger(rect.width) &&
    Number.isInteger(rect.depth) &&
    rect.width > 0 &&
    rect.depth > 0 &&
    rect.x0 >= 0 &&
    rect.z0 >= 0 &&
    rect.x0 + rect.width <= grid.width &&
    rect.z0 + rect.depth <= grid.depth
  );
}

// ---------------------------------------------------------------------------
// World-space conversion
// ---------------------------------------------------------------------------

export function tileMinX(grid: GridSpec, tx: number): number {
  return grid.originX + tx * grid.tileSize;
}

export function tileMinZ(grid: GridSpec, tz: number): number {
  return grid.originZ + tz * grid.tileSize;
}

export function tileCenterX(grid: GridSpec, tx: number): number {
  return grid.originX + (tx + 0.5) * grid.tileSize;
}

export function tileCenterZ(grid: GridSpec, tz: number): number {
  return grid.originZ + (tz + 0.5) * grid.tileSize;
}

/** Continuous grid-space coordinate of a world X. */
export function worldToGridX(grid: GridSpec, x: number): number {
  return (x - grid.originX) / grid.tileSize;
}

export function worldToGridZ(grid: GridSpec, z: number): number {
  return (z - grid.originZ) / grid.tileSize;
}

/** Tile containing the world point, or null when the point is outside the grid. */
export function worldToTile(grid: GridSpec, x: number, z: number): TileCoord | null {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  const tx = Math.floor(worldToGridX(grid, x));
  const tz = Math.floor(worldToGridZ(grid, z));
  return inBounds(grid, tx, tz) ? { tx, tz } : null;
}

export function worldRect(grid: GridSpec): WorldRect {
  return {
    minX: grid.originX,
    maxX: grid.originX + grid.width * grid.tileSize,
    minZ: grid.originZ,
    maxZ: grid.originZ + grid.depth * grid.tileSize,
  };
}

export function chunkWorldRect(grid: GridSpec, cx: number, cz: number): WorldRect {
  const rect = chunkRect(grid, cx, cz);
  return {
    minX: tileMinX(grid, rect.x0),
    maxX: tileMinX(grid, rect.x0 + rect.width),
    minZ: tileMinZ(grid, rect.z0),
    maxZ: tileMinZ(grid, rect.z0 + rect.depth),
  };
}

// ---------------------------------------------------------------------------
// Directions
// ---------------------------------------------------------------------------

/** Indexed by Direction: North (-Z), East (+X), South (+Z), West (-X). */
export const DIRECTION_STEPS: readonly [GridStep, GridStep, GridStep, GridStep] = [
  { dx: 0, dz: -1 },
  { dx: 1, dz: 0 },
  { dx: 0, dz: 1 },
  { dx: -1, dz: 0 },
];

export function directionStep(direction: Direction): GridStep {
  return DIRECTION_STEPS[direction];
}

export function stepTile(from: TileCoord, direction: Direction): TileCoord {
  const { dx, dz } = DIRECTION_STEPS[direction];
  return { tx: from.tx + dx, tz: from.tz + dz };
}

/**
 * Yaw (rotation about +Y, radians) that turns a model authored facing +Z so it faces
 * `direction`. Three.js rotates +Z to (sin θ, 0, cos θ), hence θ = atan2(dx, dz).
 */
export function directionYaw(direction: Direction): number {
  const { dx, dz } = DIRECTION_STEPS[direction];
  return Math.atan2(dx, dz);
}

export function chebyshevDistance(a: TileCoord, b: TileCoord): number {
  return Math.max(Math.abs(a.tx - b.tx), Math.abs(a.tz - b.tz));
}

export function manhattanDistance(a: TileCoord, b: TileCoord): number {
  return Math.abs(a.tx - b.tx) + Math.abs(a.tz - b.tz);
}

// ---------------------------------------------------------------------------
// Grid raycasting (Amanatides & Woo DDA)
// ---------------------------------------------------------------------------

/**
 * Visitor for traverseGrid. `distance` is the world-space distance along the ray at which the
 * ray enters the tile (0 for the origin tile). Return `true` to stop the traversal.
 */
export type GridRayVisitor = (tx: number, tz: number, distance: number, step: number) => boolean | void;

/**
 * Walks every tile a 2D ray passes through on the XZ plane, in order, until `maxDistance`
 * (world units) is exceeded or the visitor returns true. Tiles outside the grid are skipped
 * but the ray keeps marching, so a ray that starts outside can still enter the grid.
 *
 * When the ray crosses a tile corner exactly (tMaxX === tMaxZ) it steps along Z first; the
 * diagonal neighbour is then reached on the following iteration at the same distance.
 */
export function traverseGrid(
  grid: GridSpec,
  originX: number,
  originZ: number,
  dirX: number,
  dirZ: number,
  maxDistance: number,
  visit: GridRayVisitor,
): void {
  if (!Number.isFinite(originX) || !Number.isFinite(originZ)) return;
  if (!(maxDistance >= 0) || !Number.isFinite(maxDistance)) {
    throw new RangeError(`traverseGrid: maxDistance must be a finite number ≥ 0, got ${maxDistance}`);
  }

  const gx = worldToGridX(grid, originX);
  const gz = worldToGridZ(grid, originZ);
  let tx = Math.floor(gx);
  let tz = Math.floor(gz);

  const length = Math.hypot(dirX, dirZ);
  if (!(length > 0) || !Number.isFinite(length)) {
    if (inBounds(grid, tx, tz)) visit(tx, tz, 0, 0);
    return;
  }

  const ux = dirX / length;
  const uz = dirZ / length;
  const stepX = ux > 0 ? 1 : ux < 0 ? -1 : 0;
  const stepZ = uz > 0 ? 1 : uz < 0 ? -1 : 0;

  // Ray parameter t is measured in tile units (grid space), converted to world on output.
  const tDeltaX = stepX !== 0 ? 1 / Math.abs(ux) : Number.POSITIVE_INFINITY;
  const tDeltaZ = stepZ !== 0 ? 1 / Math.abs(uz) : Number.POSITIVE_INFINITY;
  let tMaxX = stepX > 0 ? (tx + 1 - gx) / ux : stepX < 0 ? (gx - tx) / -ux : Number.POSITIVE_INFINITY;
  let tMaxZ = stepZ > 0 ? (tz + 1 - gz) / uz : stepZ < 0 ? (gz - tz) / -uz : Number.POSITIVE_INFINITY;

  const maxT = maxDistance / grid.tileSize;
  // A ray of length L in tile units crosses at most ⌈L⌉ + 1 lines per axis.
  const maxSteps = 2 * (Math.ceil(maxT) + 1);
  let t = 0;

  for (let step = 0; step <= maxSteps; step++) {
    // Outside the grid and not moving back toward it on that axis: no later tile can be in bounds.
    if (
      (tx < 0 && stepX <= 0) ||
      (tx >= grid.width && stepX >= 0) ||
      (tz < 0 && stepZ <= 0) ||
      (tz >= grid.depth && stepZ >= 0)
    ) {
      return;
    }
    if (inBounds(grid, tx, tz) && visit(tx, tz, t * grid.tileSize, step) === true) return;
    if (tMaxX < tMaxZ) {
      t = tMaxX;
      tMaxX += tDeltaX;
      tx += stepX;
    } else {
      t = tMaxZ;
      tMaxZ += tDeltaZ;
      tz += stepZ;
    }
    if (t > maxT) return;
  }
}

export interface GridRayHit extends TileCoord {
  readonly distance: number;
}

/** First in-bounds tile along the ray for which `predicate` holds, or null. */
export function castRay(
  grid: GridSpec,
  originX: number,
  originZ: number,
  dirX: number,
  dirZ: number,
  maxDistance: number,
  predicate: (tx: number, tz: number, distance: number) => boolean,
): GridRayHit | null {
  let hit: GridRayHit | null = null;
  traverseGrid(grid, originX, originZ, dirX, dirZ, maxDistance, (tx, tz, distance) => {
    if (!predicate(tx, tz, distance)) return false;
    hit = { tx, tz, distance };
    return true;
  });
  return hit;
}

/**
 * The tile a character standing on `from` and facing `direction` is aiming at: a ray from the
 * tile centre along the forward vector, reaching `reachTiles` tiles, returning the first tile
 * that is not the origin tile. With reach 1 this is exactly the adjacent tile (entered at
 * t = 0.5; the next one would be entered at t = 1.5 > 1). Returns null at the grid edge.
 */
export function forwardTile(grid: GridSpec, from: TileCoord, direction: Direction, reachTiles: number): TileCoord | null {
  const { dx, dz } = DIRECTION_STEPS[direction];
  const hit = castRay(
    grid,
    tileCenterX(grid, from.tx),
    tileCenterZ(grid, from.tz),
    dx,
    dz,
    reachTiles * grid.tileSize,
    (tx, tz) => tx !== from.tx || tz !== from.tz,
  );
  return hit === null ? null : { tx: hit.tx, tz: hit.tz };
}
