/**
 * Grid & chunk mathematics (src/world/grid.ts).
 *
 * Covers spec validation, the tile ⇄ index ⇄ chunk bijections for full and partial (edge)
 * chunks on regular and odd grids, world ⇄ tile conversion at exact tile boundaries, the
 * seamless tiling of world rectangles, direction maths, and the Amanatides & Woo ray
 * traversal — including a brute-force cross-check that samples random rays densely.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/core/hash';
import { DIRECTIONS, Direction, type GridSpec, type TileCoord } from '../src/core/types';
import {
  DIRECTION_STEPS,
  castRay,
  chebyshevDistance,
  chunkCount,
  chunkIndex,
  chunkRect,
  chunkRectByIndex,
  chunkWorldRect,
  createGridSpec,
  directionStep,
  directionYaw,
  forwardTile,
  inBounds,
  localIndexToTile,
  locateTile,
  manhattanDistance,
  rectContains,
  rectInBounds,
  stepTile,
  tileCenterX,
  tileCenterZ,
  tileCount,
  tileFromIndex,
  tileIndex,
  tileMinX,
  tileMinZ,
  traverseGrid,
  worldRect,
  worldToGridX,
  worldToGridZ,
  worldToTile,
  type WorldRect,
} from '../src/world/grid';
import { HEAVY_TEST_TIMEOUT_MS, Violations, must } from './testUtils';

interface Visit {
  readonly tx: number;
  readonly tz: number;
  readonly distance: number;
  readonly step: number;
}

function collect(grid: GridSpec, ox: number, oz: number, dx: number, dz: number, maxDistance: number): Visit[] {
  const visits: Visit[] = [];
  traverseGrid(grid, ox, oz, dx, dz, maxDistance, (tx, tz, distance, step) => {
    visits.push({ tx, tz, distance, step });
  });
  return visits;
}

function tiles(visits: readonly Visit[]): TileCoord[] {
  return visits.map(({ tx, tz }) => ({ tx, tz }));
}

/** World X / Z of a continuous grid-space coordinate. */
function worldX(grid: GridSpec, gx: number): number {
  return grid.originX + gx * grid.tileSize;
}
function worldZ(grid: GridSpec, gz: number): number {
  return grid.originZ + gz * grid.tileSize;
}

function containsHalfOpen(rect: WorldRect, x: number, z: number): boolean {
  return x >= rect.minX && x < rect.maxX && z >= rect.minZ && z < rect.maxZ;
}

/** Grids with regular, partial-edge and degenerate chunk layouts. */
const INDEX_GRIDS: readonly (readonly [number, number, number])[] = [
  [48, 40, 16],
  [17, 5, 4],
  [1, 1, 16],
  [33, 33, 16],
  [16, 16, 16],
  [5, 17, 3],
  [7, 3, 1],
  [1, 9, 4],
  [9, 1, 4],
];

// ---------------------------------------------------------------------------
// Spec
// ---------------------------------------------------------------------------

describe('createGridSpec', () => {
  it('builds the default 48 × 40 / 16 farm grid', () => {
    expect(createGridSpec(48, 40, 16, 1)).toEqual({
      width: 48,
      depth: 40,
      chunkSize: 16,
      tileSize: 1,
      chunksX: 3,
      chunksZ: 3,
      originX: -24,
      originZ: -20,
    });
  });

  it('defaults tileSize to 1', () => {
    expect(createGridSpec(4, 4, 4).tileSize).toBe(1);
  });

  const invalid: readonly (readonly [string, number, number, number, number])[] = [
    ['non-integer width', 1.5, 4, 4, 1],
    ['non-integer depth', 4, 2.25, 4, 1],
    ['non-integer chunk size', 4, 4, 2.5, 1],
    ['zero width', 0, 4, 4, 1],
    ['zero depth', 4, 0, 4, 1],
    ['zero chunk size', 4, 4, 0, 1],
    ['negative width', -4, 4, 4, 1],
    ['negative depth', 4, -4, 4, 1],
    ['negative chunk size', 4, 4, -2, 1],
    ['NaN width', Number.NaN, 4, 4, 1],
    ['NaN depth', 4, Number.NaN, 4, 1],
    ['NaN chunk size', 4, 4, Number.NaN, 1],
    ['infinite width', Number.POSITIVE_INFINITY, 4, 4, 1],
    ['zero tileSize', 4, 4, 4, 0],
    ['negative tileSize', 4, 4, 4, -1],
    ['NaN tileSize', 4, 4, 4, Number.NaN],
    ['infinite tileSize', 4, 4, 4, Number.POSITIVE_INFINITY],
  ];
  it.each(invalid)('rejects %s', (_label, width, depth, chunkSize, tileSize) => {
    expect(() => createGridSpec(width, depth, chunkSize, tileSize)).toThrow(RangeError);
  });

  it('computes chunksX / chunksZ as ceil(size / chunkSize) for every size up to 40', () => {
    const v = new Violations();
    for (let size = 1; size <= 40; size++) {
      for (let chunkSize = 1; chunkSize <= 20; chunkSize++) {
        const grid = createGridSpec(size, size + 1, chunkSize);
        const label = `${size}×${size + 1} / ${chunkSize}`;
        v.equal(`${label} chunksX`, grid.chunksX, Math.ceil(size / chunkSize));
        v.equal(`${label} chunksZ`, grid.chunksZ, Math.ceil((size + 1) / chunkSize));
        // The chunks cover the grid, and no chunk column is entirely outside it.
        v.check(grid.chunksX * chunkSize >= size && (grid.chunksX - 1) * chunkSize < size, `${label} chunk columns`);
        v.check(grid.chunksZ * chunkSize >= size + 1 && (grid.chunksZ - 1) * chunkSize < size + 1, `${label} chunk rows`);
        v.equal(`${label} chunkCount`, chunkCount(grid), grid.chunksX * grid.chunksZ);
        v.equal(`${label} tileCount`, tileCount(grid), size * (size + 1));
      }
    }
    expect(v.head()).toEqual([]);
  });

  it('centres the grid on the world origin for any tile size', () => {
    const cases: readonly (readonly [number, number, number])[] = [
      [48, 40, 1],
      [17, 5, 0.5],
      [1, 1, 2],
      [33, 33, 0.25],
      [10, 3, 3],
      [6, 4, 2.5],
    ];
    for (const [width, depth, tileSize] of cases) {
      const grid = createGridSpec(width, depth, 4, tileSize);
      expect(grid.originX).toBe(-(width * tileSize) / 2);
      expect(grid.originZ).toBe(-(depth * tileSize) / 2);
      const rect = worldRect(grid);
      expect(rect.minX).toBe(-rect.maxX);
      expect(rect.minZ).toBe(-rect.maxZ);
      expect(rect.maxX - rect.minX).toBe(width * tileSize);
      expect(rect.maxZ - rect.minZ).toBe(depth * tileSize);
      expect(tileCenterX(grid, 0) + tileCenterX(grid, width - 1)).toBeCloseTo(0, 12);
      expect(tileCenterZ(grid, 0) + tileCenterZ(grid, depth - 1)).toBeCloseTo(0, 12);
    }
  });
});

// ---------------------------------------------------------------------------
// Tile indexing
// ---------------------------------------------------------------------------

describe('inBounds', () => {
  const grid = createGridSpec(48, 40, 16);

  it('accepts every tile on all four edges and rejects the ring just outside', () => {
    for (let tx = 0; tx < grid.width; tx++) {
      expect(inBounds(grid, tx, 0)).toBe(true);
      expect(inBounds(grid, tx, grid.depth - 1)).toBe(true);
      expect(inBounds(grid, tx, -1)).toBe(false);
      expect(inBounds(grid, tx, grid.depth)).toBe(false);
    }
    for (let tz = 0; tz < grid.depth; tz++) {
      expect(inBounds(grid, 0, tz)).toBe(true);
      expect(inBounds(grid, grid.width - 1, tz)).toBe(true);
      expect(inBounds(grid, -1, tz)).toBe(false);
      expect(inBounds(grid, grid.width, tz)).toBe(false);
    }
    expect(inBounds(grid, -1, -1)).toBe(false);
    expect(inBounds(grid, grid.width, grid.depth)).toBe(false);
  });

  it('rejects non-integer and non-finite coordinates', () => {
    const bad: readonly (readonly [number, number])[] = [
      [0.5, 0],
      [0, 0.5],
      [47.999, 0],
      [0, 39.0001],
      [Number.NaN, 0],
      [0, Number.NaN],
      [Number.POSITIVE_INFINITY, 0],
      [0, Number.NEGATIVE_INFINITY],
    ];
    for (const [tx, tz] of bad) expect(inBounds(grid, tx, tz)).toBe(false);
  });
});

describe('tileIndex / tileFromIndex', () => {
  it.each(INDEX_GRIDS)('round-trips every tile of a %i × %i / %i grid', (width, depth, chunkSize) => {
    const grid = createGridSpec(width, depth, chunkSize);
    const v = new Violations();
    const seen = new Set<number>();
    for (let tz = 0; tz < depth; tz++) {
      for (let tx = 0; tx < width; tx++) {
        const index = tileIndex(grid, tx, tz);
        v.equal(`index of (${tx}, ${tz})`, index, tz * width + tx);
        v.equal(`tile of index ${index}`, tileFromIndex(grid, index), { tx, tz });
        seen.add(index);
      }
    }
    expect(seen.size).toBe(tileCount(grid));
    for (let index = 0; index < tileCount(grid); index++) {
      const { tx, tz } = tileFromIndex(grid, index);
      v.equal(`round trip of index ${index}`, tileIndex(grid, tx, tz), index);
    }
    expect(v.head()).toEqual([]);
  });

  it('rejects indices outside [0, tileCount)', () => {
    const grid = createGridSpec(48, 40, 16);
    for (const index of [-1, tileCount(grid), tileCount(grid) + 7, 0.5, Number.NaN]) {
      expect(() => tileFromIndex(grid, index)).toThrow(RangeError);
    }
  });
});

// ---------------------------------------------------------------------------
// Chunks
// ---------------------------------------------------------------------------

describe('locateTile / chunkRect / localIndexToTile', () => {
  it.each(INDEX_GRIDS)('agree for every tile of a %i × %i / %i grid (full round trip)', (width, depth, chunkSize) => {
    const grid = createGridSpec(width, depth, chunkSize);
    const v = new Violations();
    const localSeen = new Map<number, Set<number>>();

    for (let tz = 0; tz < depth; tz++) {
      for (let tx = 0; tx < width; tx++) {
        const loc = locateTile(grid, tx, tz);
        const rect = chunkRect(grid, loc.cx, loc.cz);
        const at = `(${tx}, ${tz})`;

        v.equal(`${at} chunk coords`, [loc.cx, loc.cz], [Math.floor(tx / chunkSize), Math.floor(tz / chunkSize)]);
        v.equal(`${at} chunkIndex`, loc.chunkIndex, chunkIndex(grid, loc.cx, loc.cz));
        v.equal(`${at} chunkIndex formula`, loc.chunkIndex, loc.cz * grid.chunksX + loc.cx);
        v.equal(`${at} chunkRectByIndex`, chunkRectByIndex(grid, loc.chunkIndex), rect);

        v.check(rectContains(rect, tx, tz), `${at} outside its chunk rect`);
        v.equal(`${at} local coords`, [loc.lx, loc.lz], [tx - rect.x0, tz - rect.z0]);
        // Row-major with the chunk's ACTUAL width (edge chunks may be narrower).
        v.equal(`${at} localIndex`, loc.localIndex, loc.lz * rect.width + loc.lx);
        v.check(loc.localIndex < rect.width * rect.depth, `${at} localIndex past the chunk`);
        v.equal(`${at} localIndexToTile`, localIndexToTile(rect, loc.localIndex), { tx, tz });

        let set = localSeen.get(loc.chunkIndex);
        if (set === undefined) {
          set = new Set<number>();
          localSeen.set(loc.chunkIndex, set);
        }
        v.check(!set.has(loc.localIndex), `${at} shares a local index`);
        set.add(loc.localIndex);
      }
    }

    // Every chunk's local indices are exactly [0, width·depth): the mapping is a bijection.
    expect(localSeen.size).toBe(chunkCount(grid));
    for (let index = 0; index < chunkCount(grid); index++) {
      const rect = chunkRectByIndex(grid, index);
      const set = must(localSeen.get(index), `chunk ${index} has no tiles`);
      v.equal(`chunk ${index} tile count`, set.size, rect.width * rect.depth);
      for (let local = 0; local < rect.width * rect.depth; local++) {
        v.check(set.has(local), `chunk ${index} local ${local} unused`);
        const { tx, tz } = localIndexToTile(rect, local);
        const loc = locateTile(grid, tx, tz);
        v.equal(`chunk ${index} local ${local} round trip`, [loc.chunkIndex, loc.localIndex], [index, local]);
      }
    }
    expect(v.head()).toEqual([]);
  });

  it('clips the partial last chunk row of the 48 × 40 / 16 farm to 8 rows', () => {
    const grid = createGridSpec(48, 40, 16);
    for (let cx = 0; cx < 3; cx++) {
      expect(chunkRect(grid, cx, 0)).toEqual({ cx, cz: 0, x0: cx * 16, z0: 0, width: 16, depth: 16 });
      expect(chunkRect(grid, cx, 2)).toEqual({ cx, cz: 2, x0: cx * 16, z0: 32, width: 16, depth: 8 });
    }
    expect(locateTile(grid, 47, 39)).toEqual({ chunkIndex: 8, localIndex: 7 * 16 + 15, cx: 2, cz: 2, lx: 15, lz: 7 });
    expect(locateTile(grid, 0, 32)).toEqual({ chunkIndex: 6, localIndex: 0, cx: 0, cz: 2, lx: 0, lz: 0 });
  });

  it('uses the actual (narrow) width of edge chunks on odd grids', () => {
    const odd = createGridSpec(17, 5, 4);
    expect(odd.chunksX).toBe(5);
    expect(odd.chunksZ).toBe(2);
    expect(chunkRect(odd, 4, 0)).toEqual({ cx: 4, cz: 0, x0: 16, z0: 0, width: 1, depth: 4 });
    expect(chunkRect(odd, 4, 1)).toEqual({ cx: 4, cz: 1, x0: 16, z0: 4, width: 1, depth: 1 });
    expect(chunkRect(odd, 0, 1)).toEqual({ cx: 0, cz: 1, x0: 0, z0: 4, width: 4, depth: 1 });
    // Width-1 edge chunk: the local index advances by 1 per row, not by chunkSize.
    expect(locateTile(odd, 16, 3)).toEqual({ chunkIndex: 4, localIndex: 3, cx: 4, cz: 0, lx: 0, lz: 3 });
    expect(locateTile(odd, 16, 4)).toEqual({ chunkIndex: 9, localIndex: 0, cx: 4, cz: 1, lx: 0, lz: 0 });
    expect(locateTile(odd, 15, 3)).toEqual({ chunkIndex: 3, localIndex: 15, cx: 3, cz: 0, lx: 3, lz: 3 });
    expect(locateTile(odd, 3, 4)).toEqual({ chunkIndex: 5, localIndex: 3, cx: 0, cz: 1, lx: 3, lz: 0 });

    const g33 = createGridSpec(33, 33, 16);
    expect(chunkRect(g33, 2, 1)).toEqual({ cx: 2, cz: 1, x0: 32, z0: 16, width: 1, depth: 16 });
    expect(chunkRect(g33, 2, 2)).toEqual({ cx: 2, cz: 2, x0: 32, z0: 32, width: 1, depth: 1 });
    expect(locateTile(g33, 32, 20)).toEqual({ chunkIndex: 5, localIndex: 4, cx: 2, cz: 1, lx: 0, lz: 4 });
    expect(locateTile(g33, 31, 32)).toEqual({ chunkIndex: 7, localIndex: 15, cx: 1, cz: 2, lx: 15, lz: 0 });

    const single = createGridSpec(1, 1, 16);
    expect(chunkRect(single, 0, 0)).toEqual({ cx: 0, cz: 0, x0: 0, z0: 0, width: 1, depth: 1 });
    expect(locateTile(single, 0, 0)).toEqual({ chunkIndex: 0, localIndex: 0, cx: 0, cz: 0, lx: 0, lz: 0 });
  });

  it('sums chunk tile counts to the grid tile count', () => {
    for (const [width, depth, chunkSize] of INDEX_GRIDS) {
      const grid = createGridSpec(width, depth, chunkSize);
      let total = 0;
      for (let index = 0; index < chunkCount(grid); index++) {
        const rect = chunkRectByIndex(grid, index);
        expect(rect.width).toBeGreaterThan(0);
        expect(rect.depth).toBeGreaterThan(0);
        expect(rect.width).toBeLessThanOrEqual(chunkSize);
        expect(rect.depth).toBeLessThanOrEqual(chunkSize);
        expect(rectInBounds(grid, rect)).toBe(true);
        total += rect.width * rect.depth;
      }
      expect(total).toBe(tileCount(grid));
    }
  });

  it('throws for chunks, chunk indices, tiles and local indices out of range', () => {
    const grid = createGridSpec(48, 40, 16);
    const badChunks: readonly (readonly [number, number])[] = [
      [-1, 0],
      [0, -1],
      [3, 0],
      [0, 3],
      [0.5, 0],
      [0, Number.NaN],
    ];
    for (const [cx, cz] of badChunks) {
      expect(() => chunkRect(grid, cx, cz)).toThrow(RangeError);
      expect(() => chunkWorldRect(grid, cx, cz)).toThrow(RangeError);
    }
    for (const index of [-1, 9, 1.5]) expect(() => chunkRectByIndex(grid, index)).toThrow(RangeError);
    const badTiles: readonly (readonly [number, number])[] = [
      [-1, 0],
      [48, 0],
      [0, 40],
      [0.5, 0],
    ];
    for (const [tx, tz] of badTiles) expect(() => locateTile(grid, tx, tz)).toThrow(RangeError);
    const rect = chunkRect(grid, 2, 2);
    for (const local of [-1, 16 * 8, 0.5]) expect(() => localIndexToTile(rect, local)).toThrow(RangeError);
  });

  it('rectContains is half-open and rectInBounds validates placement', () => {
    const rect = { x0: 2, z0: 3, width: 2, depth: 1 };
    expect(rectContains(rect, 2, 3)).toBe(true);
    expect(rectContains(rect, 3, 3)).toBe(true);
    expect(rectContains(rect, 4, 3)).toBe(false);
    expect(rectContains(rect, 2, 4)).toBe(false);
    expect(rectContains(rect, 1, 3)).toBe(false);
    expect(rectContains(rect, 2, 2)).toBe(false);

    const grid = createGridSpec(48, 40, 16);
    expect(rectInBounds(grid, { x0: 0, z0: 0, width: 48, depth: 40 })).toBe(true);
    expect(rectInBounds(grid, { x0: 47, z0: 39, width: 1, depth: 1 })).toBe(true);
    expect(rectInBounds(grid, { x0: 0, z0: 0, width: 49, depth: 40 })).toBe(false);
    expect(rectInBounds(grid, { x0: 0, z0: 0, width: 48, depth: 41 })).toBe(false);
    expect(rectInBounds(grid, { x0: -1, z0: 0, width: 2, depth: 2 })).toBe(false);
    expect(rectInBounds(grid, { x0: 0, z0: 0, width: 0, depth: 2 })).toBe(false);
    expect(rectInBounds(grid, { x0: 0.5, z0: 0, width: 2, depth: 2 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// World-space conversion
// ---------------------------------------------------------------------------

describe('world ⇄ tile conversion', () => {
  /** Tile sizes whose products and quotients are exact in binary floating point. */
  const EXACT_GRIDS: readonly GridSpec[] = [
    createGridSpec(48, 40, 16, 1),
    createGridSpec(17, 5, 4, 0.5),
    createGridSpec(9, 7, 4, 2),
    createGridSpec(6, 4, 4, 0.25),
    createGridSpec(6, 4, 4, 2.5),
  ];

  it('maps each tile min corner (a boundary point), centre and far interior back to that tile', () => {
    const v = new Violations();
    for (const grid of EXACT_GRIDS) {
      for (let tz = 0; tz < grid.depth; tz++) {
        for (let tx = 0; tx < grid.width; tx++) {
          const label = `${grid.width}×${grid.depth}@${grid.tileSize} (${tx}, ${tz})`;
          const x0 = tileMinX(grid, tx);
          const z0 = tileMinZ(grid, tz);
          const x1 = tileMinX(grid, tx + 1);
          const z1 = tileMinZ(grid, tz + 1);
          const eps = grid.tileSize * 1e-9;
          v.equal(`${label} width`, x1 - x0, grid.tileSize);
          v.equal(`${label} min corner`, worldToTile(grid, x0, z0), { tx, tz });
          v.equal(`${label} centre`, worldToTile(grid, tileCenterX(grid, tx), tileCenterZ(grid, tz)), { tx, tz });
          v.equal(`${label} max corner − ε`, worldToTile(grid, x1 - eps, z1 - eps), { tx, tz });
          // Just below the min boundary belongs to the previous tile (or nothing).
          v.equal(`${label} left of min x`, worldToTile(grid, x0 - eps, z0), tx > 0 ? { tx: tx - 1, tz } : null);
          v.equal(`${label} above min z`, worldToTile(grid, x0, z0 - eps), tz > 0 ? { tx, tz: tz - 1 } : null);
        }
      }
    }
    expect(v.head()).toEqual([]);
  });

  it('treats the far edge (x = maxX, z = maxZ) as out of bounds', () => {
    for (const grid of EXACT_GRIDS) {
      const rect = worldRect(grid);
      const eps = grid.tileSize * 1e-9;
      expect(worldToTile(grid, rect.maxX, rect.minZ)).toBeNull();
      expect(worldToTile(grid, rect.minX, rect.maxZ)).toBeNull();
      expect(worldToTile(grid, rect.maxX, rect.maxZ)).toBeNull();
      expect(worldToTile(grid, rect.maxX - eps, rect.maxZ - eps)).toEqual({ tx: grid.width - 1, tz: grid.depth - 1 });
      expect(worldToTile(grid, rect.minX, rect.minZ)).toEqual({ tx: 0, tz: 0 });
      expect(worldToTile(grid, rect.minX - eps, rect.minZ)).toBeNull();
      expect(worldToTile(grid, rect.minX, rect.minZ - eps)).toBeNull();
    }
  });

  it('handles negative world space around the centred origin', () => {
    const grid = createGridSpec(48, 40, 16);
    expect(worldToTile(grid, 0, 0)).toEqual({ tx: 24, tz: 20 });
    expect(worldToTile(grid, -0.5, -0.5)).toEqual({ tx: 23, tz: 19 });
    expect(worldToTile(grid, -1e-6, -1e-6)).toEqual({ tx: 23, tz: 19 });
    expect(worldToTile(grid, -24, -20)).toEqual({ tx: 0, tz: 0 });
    expect(worldToTile(grid, -24.000001, 0)).toBeNull();
    expect(worldToTile(grid, 23.999999, 19.999999)).toEqual({ tx: 47, tz: 39 });
    expect(worldToTile(grid, -100, -100)).toBeNull();
  });

  it('returns null for non-finite points', () => {
    const grid = createGridSpec(48, 40, 16);
    expect(worldToTile(grid, Number.NaN, 0)).toBeNull();
    expect(worldToTile(grid, 0, Number.NaN)).toBeNull();
    expect(worldToTile(grid, Number.POSITIVE_INFINITY, 0)).toBeNull();
    expect(worldToTile(grid, 0, Number.NEGATIVE_INFINITY)).toBeNull();
  });

  it('converts to continuous grid space consistently with tile centres and corners', () => {
    for (const grid of EXACT_GRIDS) {
      expect(worldToGridX(grid, grid.originX)).toBe(0);
      expect(worldToGridZ(grid, grid.originZ)).toBe(0);
      for (let tx = 0; tx < grid.width; tx++) {
        expect(worldToGridX(grid, tileCenterX(grid, tx))).toBe(tx + 0.5);
        expect(worldToGridX(grid, tileMinX(grid, tx))).toBe(tx);
        expect(tileCenterX(grid, tx) - tileMinX(grid, tx)).toBe(grid.tileSize / 2);
      }
      for (let tz = 0; tz < grid.depth; tz++) {
        expect(worldToGridZ(grid, tileCenterZ(grid, tz))).toBe(tz + 0.5);
        expect(worldToGridZ(grid, tileMinZ(grid, tz))).toBe(tz);
      }
    }
  });

  it('puts random in-bounds points inside the half-open extent of the tile it returns', () => {
    const rng = mulberry32(0x5eed);
    const grids = [...EXACT_GRIDS, createGridSpec(13, 11, 5, 0.3), createGridSpec(3, 8, 2, 1.7)];
    const v = new Violations();
    for (const grid of grids) {
      const rect = worldRect(grid);
      for (let i = 0; i < 2000; i++) {
        const x = rect.minX + rng() * (rect.maxX - rect.minX);
        const z = rect.minZ + rng() * (rect.maxZ - rect.minZ);
        const tile = worldToTile(grid, x, z);
        if (tile === null) {
          v.check(false, `(${x}, ${z}) should be in bounds of ${grid.width}×${grid.depth}@${grid.tileSize}`);
          continue;
        }
        const gx = worldToGridX(grid, x);
        const gz = worldToGridZ(grid, z);
        v.check(gx >= tile.tx && gx < tile.tx + 1 && gz >= tile.tz && gz < tile.tz + 1, () => `(${x}, ${z}) → ${JSON.stringify(tile)}`);
      }
    }
    expect(v.head()).toEqual([]);
  });
});

describe('worldRect / chunkWorldRect', () => {
  const grids: readonly GridSpec[] = [
    createGridSpec(48, 40, 16, 1),
    createGridSpec(17, 5, 4, 0.5),
    createGridSpec(33, 33, 16, 2),
    createGridSpec(1, 1, 16, 1.5),
    createGridSpec(7, 3, 1, 0.25),
  ];

  it('tiles the world exactly: areas sum up, neighbours share edges, outer chunks touch the border', () => {
    for (const grid of grids) {
      const world = worldRect(grid);
      let area = 0;
      for (let cz = 0; cz < grid.chunksZ; cz++) {
        for (let cx = 0; cx < grid.chunksX; cx++) {
          const rect = chunkWorldRect(grid, cx, cz);
          expect(rect.maxX).toBeGreaterThan(rect.minX);
          expect(rect.maxZ).toBeGreaterThan(rect.minZ);
          area += (rect.maxX - rect.minX) * (rect.maxZ - rect.minZ);

          if (cx + 1 < grid.chunksX) expect(chunkWorldRect(grid, cx + 1, cz).minX).toBe(rect.maxX);
          else expect(rect.maxX).toBe(world.maxX);
          if (cz + 1 < grid.chunksZ) expect(chunkWorldRect(grid, cx, cz + 1).minZ).toBe(rect.maxZ);
          else expect(rect.maxZ).toBe(world.maxZ);
          if (cx === 0) expect(rect.minX).toBe(world.minX);
          if (cz === 0) expect(rect.minZ).toBe(world.minZ);

          // Chunks in the same column / row share the same X / Z extent (no ragged seams).
          const columnHead = chunkWorldRect(grid, cx, 0);
          expect(rect.minX).toBe(columnHead.minX);
          expect(rect.maxX).toBe(columnHead.maxX);
          const rowHead = chunkWorldRect(grid, 0, cz);
          expect(rect.minZ).toBe(rowHead.minZ);
          expect(rect.maxZ).toBe(rowHead.maxZ);
        }
      }
      expect(area).toBeCloseTo((world.maxX - world.minX) * (world.maxZ - world.minZ), 9);
    }
  });

  it('places every tile centre and random point in exactly one chunk (no gaps, no overlaps)', () => {
    const rng = mulberry32(42);
    for (const grid of grids) {
      const rects: { readonly cx: number; readonly cz: number; readonly rect: WorldRect }[] = [];
      for (let cz = 0; cz < grid.chunksZ; cz++) {
        for (let cx = 0; cx < grid.chunksX; cx++) rects.push({ cx, cz, rect: chunkWorldRect(grid, cx, cz) });
      }
      const v = new Violations();
      for (let tz = 0; tz < grid.depth; tz++) {
        for (let tx = 0; tx < grid.width; tx++) {
          const x = tileCenterX(grid, tx);
          const z = tileCenterZ(grid, tz);
          const hits = rects.filter(({ rect }) => containsHalfOpen(rect, x, z));
          const loc = locateTile(grid, tx, tz);
          v.check(hits.length === 1 && hits[0]?.cx === loc.cx && hits[0]?.cz === loc.cz, `centre of (${tx}, ${tz}) in ${hits.length} chunks`);
          // Tile corners (exact boundaries) are also owned by exactly one chunk.
          const corner = rects.filter(({ rect }) => containsHalfOpen(rect, tileMinX(grid, tx), tileMinZ(grid, tz)));
          v.check(corner.length === 1, `corner of (${tx}, ${tz}) in ${corner.length} chunks`);
        }
      }
      const world = worldRect(grid);
      for (let i = 0; i < 500; i++) {
        const x = world.minX + rng() * (world.maxX - world.minX);
        const z = world.minZ + rng() * (world.maxZ - world.minZ);
        const hits = rects.filter(({ rect }) => containsHalfOpen(rect, x, z)).length;
        v.check(hits === 1, `(${x}, ${z}) in ${hits} chunks`);
      }
      expect(v.head()).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// Directions
// ---------------------------------------------------------------------------

describe('directions', () => {
  it('maps North/East/South/West to -Z/+X/+Z/-X unit steps', () => {
    expect(DIRECTION_STEPS[Direction.North]).toEqual({ dx: 0, dz: -1 });
    expect(DIRECTION_STEPS[Direction.East]).toEqual({ dx: 1, dz: 0 });
    expect(DIRECTION_STEPS[Direction.South]).toEqual({ dx: 0, dz: 1 });
    expect(DIRECTION_STEPS[Direction.West]).toEqual({ dx: -1, dz: 0 });
    for (const direction of DIRECTIONS) {
      const step = directionStep(direction);
      expect(Math.abs(step.dx) + Math.abs(step.dz)).toBe(1);
      const from = { tx: 10, tz: 20 };
      const to = stepTile(from, direction);
      expect(to).toEqual({ tx: 10 + step.dx, tz: 20 + step.dz });
      const opposite = ((direction + 2) % 4) as Direction;
      expect(stepTile(to, opposite)).toEqual(from);
    }
  });

  it('directionYaw rotates a +Z-facing model onto each direction vector', () => {
    const up = new THREE.Vector3(0, 1, 0);
    for (const direction of DIRECTIONS) {
      const { dx, dz } = directionStep(direction);
      const forward = new THREE.Vector3(0, 0, 1).applyAxisAngle(up, directionYaw(direction));
      expect(forward.x).toBeCloseTo(dx, 12);
      expect(forward.y).toBeCloseTo(0, 12);
      expect(forward.z).toBeCloseTo(dz, 12);
    }
    expect(directionYaw(Direction.South)).toBe(0);
    expect(directionYaw(Direction.East)).toBeCloseTo(Math.PI / 2, 12);
    expect(Math.abs(directionYaw(Direction.North))).toBeCloseTo(Math.PI, 12);
    expect(directionYaw(Direction.West)).toBeCloseTo(-Math.PI / 2, 12);
  });

  it('computes Chebyshev and Manhattan distances symmetrically', () => {
    const a = { tx: 0, tz: 0 };
    const b = { tx: 3, tz: -4 };
    expect(chebyshevDistance(a, b)).toBe(4);
    expect(chebyshevDistance(b, a)).toBe(4);
    expect(manhattanDistance(a, b)).toBe(7);
    expect(manhattanDistance(b, a)).toBe(7);
    expect(chebyshevDistance(a, a)).toBe(0);
    expect(manhattanDistance(a, a)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Ray traversal
// ---------------------------------------------------------------------------

describe('traverseGrid', () => {
  const grid10 = createGridSpec(10, 10, 4);
  const cx = (tx: number): number => tileCenterX(grid10, tx);
  const cz = (tz: number): number => tileCenterZ(grid10, tz);

  it('walks axis-aligned rays tile by tile with exact entry distances', () => {
    const expectations: readonly (readonly [Direction, readonly TileCoord[]])[] = [
      [Direction.East, [{ tx: 4, tz: 4 }, { tx: 5, tz: 4 }, { tx: 6, tz: 4 }, { tx: 7, tz: 4 }]],
      [Direction.West, [{ tx: 4, tz: 4 }, { tx: 3, tz: 4 }, { tx: 2, tz: 4 }, { tx: 1, tz: 4 }]],
      [Direction.South, [{ tx: 4, tz: 4 }, { tx: 4, tz: 5 }, { tx: 4, tz: 6 }, { tx: 4, tz: 7 }]],
      [Direction.North, [{ tx: 4, tz: 4 }, { tx: 4, tz: 3 }, { tx: 4, tz: 2 }, { tx: 4, tz: 1 }]],
    ];
    for (const [direction, expected] of expectations) {
      const { dx, dz } = directionStep(direction);
      const visits = collect(grid10, cx(4), cz(4), dx, dz, 3);
      expect(tiles(visits)).toEqual(expected);
      expect(visits.map((v) => v.distance)).toEqual([0, 0.5, 1.5, 2.5]);
      expect(visits.map((v) => v.step)).toEqual([0, 1, 2, 3]);
    }
  });

  it('reports world-space distances when tileSize ≠ 1', () => {
    const big = createGridSpec(10, 10, 4, 2);
    const visits = collect(big, tileCenterX(big, 1), tileCenterZ(big, 1), 1, 0, 5);
    expect(tiles(visits)).toEqual([
      { tx: 1, tz: 1 },
      { tx: 2, tz: 1 },
      { tx: 3, tz: 1 },
      { tx: 4, tz: 1 },
    ]);
    expect(visits.map((v) => v.distance)).toEqual([0, 1, 3, 5]);
    // A direction vector's length is irrelevant: it is normalised.
    expect(collect(big, tileCenterX(big, 1), tileCenterZ(big, 1), 1000, 0, 5)).toEqual(visits);
  });

  it('treats maxDistance as inclusive: a tile entered exactly at maxDistance is visited', () => {
    expect(tiles(collect(grid10, cx(2), cz(2), 1, 0, 0.5))).toEqual([
      { tx: 2, tz: 2 },
      { tx: 3, tz: 2 },
    ]);
    expect(tiles(collect(grid10, cx(2), cz(2), 1, 0, 0.4999))).toEqual([{ tx: 2, tz: 2 }]);
    expect(tiles(collect(grid10, cx(2), cz(2), 1, 0, 1.5))).toHaveLength(3);
    expect(tiles(collect(grid10, cx(2), cz(2), 1, 0, 1.4999))).toHaveLength(2);
    expect(collect(grid10, cx(2), cz(2), 1, 0, 0)).toEqual([{ tx: 2, tz: 2, distance: 0, step: 0 }]);
  });

  it('steps Z first through an exact corner, then reaches the diagonal tile at the same distance', () => {
    const h = Math.SQRT1_2;
    const visits = collect(grid10, cx(0), cz(0), 1, 1, 3);
    expect(tiles(visits)).toEqual([
      { tx: 0, tz: 0 },
      { tx: 0, tz: 1 },
      { tx: 1, tz: 1 },
      { tx: 1, tz: 2 },
      { tx: 2, tz: 2 },
    ]);
    const expectedDistances = [0, h, h, h + Math.SQRT2, h + Math.SQRT2];
    visits.forEach((visit, i) => expect(visit.distance).toBeCloseTo(must(expectedDistances[i]), 12));

    const back = collect(grid10, cx(9), cz(9), -1, -1, 3);
    expect(tiles(back)).toEqual([
      { tx: 9, tz: 9 },
      { tx: 9, tz: 8 },
      { tx: 8, tz: 8 },
      { tx: 8, tz: 7 },
      { tx: 7, tz: 7 },
    ]);
  });

  it('follows a shallow (2:1) diagonal with analytically known crossings', () => {
    const r5 = Math.sqrt(5);
    const visits = collect(grid10, cx(0), cz(0), 2, 1, 3.5);
    expect(tiles(visits)).toEqual([
      { tx: 0, tz: 0 },
      { tx: 1, tz: 0 },
      { tx: 1, tz: 1 },
      { tx: 2, tz: 1 },
      { tx: 3, tz: 1 },
      { tx: 3, tz: 2 },
    ]);
    // x-lines at gx = k cross at t = (k − 0.5)·√5/2, z-lines at gz = k at t = (k − 0.5)·√5.
    const expectedDistances = [0, 0.5 * (r5 / 2), 0.5 * r5, 1.5 * (r5 / 2), 2.5 * (r5 / 2), 1.5 * r5];
    visits.forEach((visit, i) => expect(visit.distance).toBeCloseTo(must(expectedDistances[i]), 12));
  });

  it('lets rays that start outside the grid enter it, skipping the outside tiles', () => {
    const small = createGridSpec(4, 4, 4);
    const visits = collect(small, worldX(small, -2.5), worldZ(small, 1.5), 1, 0, 10);
    expect(tiles(visits)).toEqual([
      { tx: 0, tz: 1 },
      { tx: 1, tz: 1 },
      { tx: 2, tz: 1 },
      { tx: 3, tz: 1 },
    ]);
    expect(visits.map((v) => v.distance)).toEqual([2.5, 3.5, 4.5, 5.5]);
    // Steps count the outside tiles too (3 outside before the first inside tile).
    expect(visits.map((v) => v.step)).toEqual([3, 4, 5, 6]);

    const diagonal = collect(small, worldX(small, -1.5), worldZ(small, -1.5), 1, 1, 20);
    expect(must(diagonal[0])).toMatchObject({ tx: 0, tz: 0 });
    expect(must(diagonal[0]).distance).toBeCloseTo(1.5 * Math.SQRT2, 12);
    for (const visit of diagonal) expect(inBounds(small, visit.tx, visit.tz)).toBe(true);

    // A ray running alongside the grid never enters it.
    expect(collect(small, worldX(small, -2), worldZ(small, -0.5), 1, 0, 20)).toEqual([]);
    // Too short to reach the grid.
    expect(collect(small, worldX(small, -2.5), worldZ(small, 1.5), 1, 0, 2.4)).toEqual([]);
  });

  it('stops visiting once the ray leaves the grid, however long it is', () => {
    const small = createGridSpec(4, 4, 4);
    const visits = collect(small, tileCenterX(small, 2), tileCenterZ(small, 1), 1, 0, 100);
    expect(tiles(visits)).toEqual([
      { tx: 2, tz: 1 },
      { tx: 3, tz: 1 },
    ]);
    const upward = collect(small, tileCenterX(small, 1), tileCenterZ(small, 1), 0, -1, 1e6);
    expect(tiles(upward)).toEqual([
      { tx: 1, tz: 1 },
      { tx: 1, tz: 0 },
    ]);
  });

  it('visits only the origin tile for a zero-length or non-finite direction', () => {
    expect(collect(grid10, cx(3), cz(7), 0, 0, 5)).toEqual([{ tx: 3, tz: 7, distance: 0, step: 0 }]);
    expect(collect(grid10, cx(3), cz(7), Number.NaN, 1, 5)).toEqual([{ tx: 3, tz: 7, distance: 0, step: 0 }]);
    expect(collect(grid10, worldX(grid10, -3), cz(7), 0, 0, 5)).toEqual([]);
  });

  it('ignores non-finite origins and rejects invalid maxDistance', () => {
    expect(collect(grid10, Number.NaN, cz(1), 1, 0, 5)).toEqual([]);
    expect(collect(grid10, cx(1), Number.POSITIVE_INFINITY, 1, 0, 5)).toEqual([]);
    for (const maxDistance of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => traverseGrid(grid10, cx(1), cz(1), 1, 0, maxDistance, () => false)).toThrow(RangeError);
    }
  });

  it('stops as soon as the visitor returns true', () => {
    const seen: TileCoord[] = [];
    traverseGrid(grid10, cx(0), cz(5), 1, 0, 9, (tx, tz) => {
      seen.push({ tx, tz });
      return tx === 2;
    });
    expect(seen).toEqual([
      { tx: 0, tz: 5 },
      { tx: 1, tz: 5 },
      { tx: 2, tz: 5 },
    ]);
  });

  it(
    'agrees with brute-force sampling along random rays (in-order superset, exact slab entries)',
    () => {
      const rng = mulberry32(0x0dda);
      const specs: readonly GridSpec[] = [
        createGridSpec(12, 9, 4, 1),
        createGridSpec(7, 11, 3, 0.5),
        createGridSpec(5, 5, 2, 2),
        createGridSpec(16, 3, 16, 0.75),
      ];
      const v = new Violations();
      let totalVisits = 0;
      let raysEnteringFromOutside = 0;

      for (let r = 0; r < 240; r++) {
        const grid = must(specs[r % specs.length]);
        const bounds = worldRect(grid);
        const spanX = bounds.maxX - bounds.minX;
        const spanZ = bounds.maxZ - bounds.minZ;
        const ox = bounds.minX - 0.3 * spanX + rng() * 1.6 * spanX;
        const oz = bounds.minZ - 0.3 * spanZ + rng() * 1.6 * spanZ;
        const angle = rng() * Math.PI * 2;
        const ux = Math.cos(angle);
        const uz = Math.sin(angle);
        const maxDistance = rng() * 1.5 * Math.hypot(spanX, spanZ);
        const visits = collect(grid, ox, oz, ux, uz, maxDistance);
        const ray = `ray #${r}`;
        totalVisits += visits.length;
        if (visits.length > 0 && worldToTile(grid, ox, oz) === null) raysEnteringFromOutside++;

        for (let i = 0; i < visits.length; i++) {
          const visit = must(visits[i]);
          const at = `${ray} visit ${i} (${visit.tx}, ${visit.tz})`;
          // (a) In-bounds tiles, monotone distances inside [0, maxDistance], strictly increasing steps.
          v.check(inBounds(grid, visit.tx, visit.tz), `${at} out of bounds`);
          v.check(visit.distance >= 0 && visit.distance <= maxDistance + 1e-9, `${at} distance ${visit.distance} outside [0, ${maxDistance}]`);
          if (i > 0) {
            const prev = must(visits[i - 1]);
            v.check(visit.distance >= prev.distance, `${at} distance decreased`);
            v.check(visit.step > prev.step, `${at} step did not increase`);
            // (b) Consecutive tiles are 4-neighbours (no diagonal jumps, no repeats).
            v.check(Math.abs(visit.tx - prev.tx) + Math.abs(visit.tz - prev.tz) === 1, `${at} is not a 4-neighbour of the previous tile`);
          }
          // (c) The reported entry distance equals the slab-test entry of the tile's box.
          const [ax, bx] = slab(ox, ux, tileMinX(grid, visit.tx), tileMinX(grid, visit.tx + 1));
          const [az, bz] = slab(oz, uz, tileMinZ(grid, visit.tz), tileMinZ(grid, visit.tz + 1));
          const enter = Math.max(ax, az, 0);
          const exit = Math.min(bx, bz);
          v.check(exit >= enter - 1e-9, `${at} is not intersected by the ray`);
          v.check(Math.abs(visit.distance - enter) < 1e-9, `${at} entry ${visit.distance} ≠ slab entry ${enter}`);
        }

        // (d) Densely sampled tiles along the segment appear in the DDA output, in order.
        const keys = visits.map((visit) => `${visit.tx},${visit.tz}`);
        const sampled: string[] = [];
        const h = grid.tileSize * 0.002;
        for (let s = 0; s < maxDistance; s += h) {
          const tile = worldToTile(grid, ox + ux * s, oz + uz * s);
          if (tile === null) continue;
          const key = `${tile.tx},${tile.tz}`;
          if (sampled[sampled.length - 1] !== key) sampled.push(key);
        }
        let j = 0;
        for (const key of sampled) {
          while (j < keys.length && keys[j] !== key) j++;
          v.check(j < keys.length, `${ray}: sampled tile ${key} missing from (or out of order in) the DDA output`);
          j++;
        }
      }
      expect(v.head()).toEqual([]);
      // Sanity: the random rays exercised real traversals, including entries from outside.
      expect(totalVisits).toBeGreaterThan(500);
      expect(raysEnteringFromOutside).toBeGreaterThan(5);
    },
    HEAVY_TEST_TIMEOUT_MS,
  );
});

/** Ray-parameter interval [t0, t1] during which o + u·t lies in [min, max). */
function slab(origin: number, u: number, min: number, max: number): readonly [number, number] {
  if (u === 0) {
    return origin >= min && origin < max
      ? [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY]
      : [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
  }
  const t1 = (min - origin) / u;
  const t2 = (max - origin) / u;
  return [Math.min(t1, t2), Math.max(t1, t2)];
}

describe('castRay', () => {
  const grid = createGridSpec(10, 10, 4);

  it('returns the first tile satisfying the predicate with its entry distance', () => {
    expect(castRay(grid, tileCenterX(grid, 1), tileCenterZ(grid, 1), 1, 0, 9, (tx) => tx === 4)).toEqual({
      tx: 4,
      tz: 1,
      distance: 2.5,
    });
    expect(castRay(grid, tileCenterX(grid, 1), tileCenterZ(grid, 1), 1, 0, 9, () => true)).toEqual({
      tx: 1,
      tz: 1,
      distance: 0,
    });
  });

  it('returns null when nothing matches within reach', () => {
    expect(castRay(grid, tileCenterX(grid, 1), tileCenterZ(grid, 1), 1, 0, 9, () => false)).toBeNull();
    expect(castRay(grid, tileCenterX(grid, 1), tileCenterZ(grid, 1), 1, 0, 2, (tx) => tx === 4)).toBeNull();
  });
});

describe('forwardTile', () => {
  const grids: readonly GridSpec[] = [
    createGridSpec(6, 4, 4, 1),
    createGridSpec(5, 3, 2, 2),
    createGridSpec(48, 40, 16, 1),
    // Tile sizes that are not exact in binary floating point.
    createGridSpec(7, 5, 3, 0.1),
    createGridSpec(9, 4, 2, 0.3),
    createGridSpec(11, 6, 4, 1.7),
  ];

  /** Every (tile, direction) of the grid whose forwardTile disagrees with the adjacent tile. */
  function forwardMismatches(grid: GridSpec, reach: number): { readonly nulls: number; readonly problems: string[] } {
    const v = new Violations();
    let nulls = 0;
    for (let tz = 0; tz < grid.depth; tz++) {
      for (let tx = 0; tx < grid.width; tx++) {
        for (const direction of DIRECTIONS) {
          const next = stepTile({ tx, tz }, direction);
          const expected = inBounds(grid, next.tx, next.tz) ? next : null;
          if (expected === null) nulls++;
          v.equal(`${grid.width}×${grid.depth}@${grid.tileSize} (${tx}, ${tz}) dir ${direction}`, forwardTile(grid, { tx, tz }, direction, reach), expected);
        }
      }
    }
    return { nulls, problems: v.head() };
  }

  it('returns the adjacent tile in all four directions, or null at every edge', () => {
    for (const grid of grids) {
      const { nulls, problems } = forwardMismatches(grid, 1);
      expect(problems).toEqual([]);
      // Exactly one outward-facing edge per border tile side.
      expect(nulls).toBe(2 * grid.width + 2 * grid.depth);
    }
  });

  it('still returns the first non-origin tile with a longer reach', () => {
    for (const grid of grids) {
      expect(forwardMismatches(grid, 2).problems).toEqual([]);
      expect(forwardMismatches(grid, 5).problems).toEqual([]);
    }
  });

  it('needs a reach of at least half a tile (the adjacent tile is entered at t = 0.5)', () => {
    const grid = createGridSpec(6, 4, 4, 2);
    expect(forwardTile(grid, { tx: 2, tz: 2 }, Direction.East, 0.5)).toEqual({ tx: 3, tz: 2 });
    expect(forwardTile(grid, { tx: 2, tz: 2 }, Direction.East, 0.49)).toBeNull();
  });
});
