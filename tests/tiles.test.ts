/**
 * Immutable tile storage (src/world/tiles.ts).
 *
 * The render systems rely on reference identity to find dirty chunks and tiles, so these
 * tests pin down the structural-sharing contract precisely: a single-tile write replaces
 * exactly one chunk and one tile slot, bumps that chunk's revision, and leaves every other
 * reference untouched; no-op writes return the very same world object.
 */
import { describe, expect, it } from 'vitest';
import { InvariantError } from '../src/core/invariant';
import { Blocker, TileState, type GridSpec, type Tile, type WorldState } from '../src/core/types';
import { chunkCount, chunkRectByIndex, createGridSpec, locateTile, tileCount } from '../src/world/grid';
import {
  EMPTY_TILE,
  assertTileConsistent,
  blockedTile,
  countTiles,
  createWorld,
  forEachTile,
  getTile,
  isSoil,
  isWalkable,
  mapTiles,
  requireTile,
  setTile,
  updateTile,
} from '../src/world/tiles';
import { cropOf, must, soilTile, worldChangesOutside } from './testUtils';

const key = (tx: number, tz: number): string => `${tx},${tz}`;

/** A world whose every tile is a distinct object, remembered by coordinate. */
function distinctWorld(grid: GridSpec): { readonly world: WorldState; readonly byCoord: Map<string, Tile> } {
  const byCoord = new Map<string, Tile>();
  const world = createWorld(grid, (tx, tz) => {
    const tile: Tile = { ...EMPTY_TILE };
    byCoord.set(key(tx, tz), tile);
    return tile;
  });
  return { world, byCoord };
}

const GRIDS: readonly GridSpec[] = [createGridSpec(48, 40, 16), createGridSpec(17, 5, 4), createGridSpec(1, 1, 16), createGridSpec(33, 33, 16)];

describe('createWorld', () => {
  it.each(GRIDS)('lays out chunks matching the grid ($width × $depth / $chunkSize)', (grid) => {
    const calls: string[] = [];
    const world = createWorld(grid, (tx, tz) => {
      calls.push(key(tx, tz));
      return EMPTY_TILE;
    });
    expect(world.grid).toBe(grid);
    expect(world.chunks).toHaveLength(chunkCount(grid));
    world.chunks.forEach((chunk, index) => {
      const rect = chunkRectByIndex(grid, index);
      expect(chunk).toMatchObject({ ...rect, revision: 0 });
      expect(chunk.tiles).toHaveLength(rect.width * rect.depth);
    });
    // The sampler is called exactly once per tile.
    expect(calls).toHaveLength(tileCount(grid));
    expect(new Set(calls).size).toBe(tileCount(grid));
  });

  it.each(GRIDS)('stores each sampled tile where getTile finds it ($width × $depth / $chunkSize)', (grid) => {
    const { world, byCoord } = distinctWorld(grid);
    for (let tz = 0; tz < grid.depth; tz++) {
      for (let tx = 0; tx < grid.width; tx++) {
        expect(getTile(world, tx, tz)).toBe(byCoord.get(key(tx, tz)));
        expect(requireTile(world, tx, tz)).toBe(byCoord.get(key(tx, tz)));
      }
    }
  });

  it('getTile returns null and requireTile throws out of bounds', () => {
    const world = createWorld(createGridSpec(4, 3, 2), () => EMPTY_TILE);
    for (const [tx, tz] of [
      [-1, 0],
      [4, 0],
      [0, 3],
      [0.5, 1],
    ] as const) {
      expect(getTile(world, tx, tz)).toBeNull();
      expect(() => requireTile(world, tx, tz)).toThrow(RangeError);
    }
  });
});

describe('setTile structural sharing', () => {
  const grid = createGridSpec(48, 40, 16);

  it('replaces exactly one chunk and one tile slot, bumping only that revision', () => {
    const { world } = distinctWorld(grid);
    for (const [tx, tz] of [
      [0, 0],
      [20, 17],
      [47, 39],
      [31, 32],
    ] as const) {
      const tile = soilTile(TileState.Plowed);
      const next = setTile(world, tx, tz, tile);
      const loc = locateTile(grid, tx, tz);

      expect(next).not.toBe(world);
      expect(next.grid).toBe(world.grid);
      expect(getTile(next, tx, tz)).toBe(tile);
      expect(worldChangesOutside(world, next, { tx, tz })).toEqual([]);
      next.chunks.forEach((chunk, index) => {
        if (index === loc.chunkIndex) {
          expect(chunk).not.toBe(world.chunks[index]);
          expect(chunk.revision).toBe(must(world.chunks[index]).revision + 1);
          expect(chunk).toMatchObject(chunkRectByIndex(grid, index));
        } else {
          expect(chunk).toBe(world.chunks[index]);
        }
      });
      // The previous world is untouched (immutability).
      expect(getTile(world, tx, tz)).not.toBe(tile);
    }
  });

  it('accumulates revisions per chunk', () => {
    let world = createWorld(grid, () => EMPTY_TILE);
    world = setTile(world, 1, 1, soilTile(TileState.Plowed));
    world = setTile(world, 2, 1, soilTile(TileState.Plowed));
    world = setTile(world, 40, 1, soilTile(TileState.Watered));
    expect(world.chunks.map((chunk) => chunk.revision)).toEqual([2, 0, 1, 0, 0, 0, 0, 0, 0]);
  });

  it('returns the same world when the same tile reference is written', () => {
    const { world, byCoord } = distinctWorld(grid);
    const same = must(byCoord.get(key(7, 7)));
    expect(setTile(world, 7, 7, same)).toBe(world);
    expect(updateTile(world, 7, 7, (tile) => tile)).toBe(world);
  });

  it('compares by reference: an equal but new tile object is a change', () => {
    const world = createWorld(grid, () => EMPTY_TILE);
    const next = setTile(world, 3, 3, { ...EMPTY_TILE });
    expect(next).not.toBe(world);
    expect(next.chunks[0]).not.toBe(world.chunks[0]);
  });

  it('rejects inconsistent tiles and out-of-bounds writes', () => {
    const world = createWorld(grid, () => EMPTY_TILE);
    expect(() => setTile(world, 0, 0, { ...EMPTY_TILE, state: TileState.Blocked })).toThrow(InvariantError);
    expect(() => setTile(world, -1, 0, EMPTY_TILE)).toThrow(RangeError);
    expect(() => setTile(world, 48, 0, EMPTY_TILE)).toThrow(RangeError);
    expect(() => updateTile(world, 0, 40, (tile) => tile)).toThrow(RangeError);
  });

  it('updateTile passes the current tile to the updater', () => {
    const { world, byCoord } = distinctWorld(grid);
    let received: Tile | null = null;
    const next = updateTile(world, 9, 30, (tile) => {
      received = tile;
      return { ...tile, state: TileState.Plowed };
    });
    expect(received).toBe(byCoord.get(key(9, 30)));
    expect(requireTile(next, 9, 30).state).toBe(TileState.Plowed);
  });
});

describe('mapTiles', () => {
  it.each(GRIDS)('returns the identical world when fn is the identity ($width × $depth / $chunkSize)', (grid) => {
    const { world } = distinctWorld(grid);
    expect(mapTiles(world, (tile) => tile)).toBe(world);
  });

  it.each(GRIDS)('passes the correct coordinates for every tile ($width × $depth / $chunkSize)', (grid) => {
    const { world, byCoord } = distinctWorld(grid);
    const visited = new Set<string>();
    mapTiles(world, (tile, tx, tz) => {
      expect(tile).toBe(byCoord.get(key(tx, tz)));
      visited.add(key(tx, tz));
      return tile;
    });
    expect(visited.size).toBe(tileCount(grid));
  });

  it('shares every chunk it does not touch and bumps revisions of touched chunks once', () => {
    const grid = createGridSpec(48, 40, 16);
    const { world } = distinctWorld(grid);
    const plowed = soilTile(TileState.Plowed);
    // Touch two tiles in chunk 0 and one in chunk 8.
    const targets = new Set([key(0, 0), key(5, 5), key(47, 39)]);
    const next = mapTiles(world, (tile, tx, tz) => (targets.has(key(tx, tz)) ? plowed : tile));
    expect(next).not.toBe(world);
    next.chunks.forEach((chunk, index) => {
      if (index === 0 || index === 8) {
        expect(chunk).not.toBe(world.chunks[index]);
        expect(chunk.revision).toBe(1);
      } else {
        expect(chunk).toBe(world.chunks[index]);
      }
    });
    const before = must(world.chunks[0]);
    const after = must(next.chunks[0]);
    after.tiles.forEach((tile, i) => {
      const changed = i === 0 || i === 5 * 16 + 5;
      if (changed) expect(tile).toBe(plowed);
      else expect(tile).toBe(before.tiles[i]);
    });
  });

  it('validates the tiles it writes', () => {
    const world = createWorld(createGridSpec(4, 4, 2), () => EMPTY_TILE);
    expect(() => mapTiles(world, () => ({ ...EMPTY_TILE, crop: cropOf('parsnip') }))).toThrow(InvariantError);
  });
});

describe('forEachTile / countTiles', () => {
  it.each(GRIDS)('visits each tile exactly once with its coordinates ($width × $depth / $chunkSize)', (grid) => {
    const { world, byCoord } = distinctWorld(grid);
    const visited = new Set<string>();
    forEachTile(world, (tile, tx, tz) => {
      expect(visited.has(key(tx, tz))).toBe(false);
      visited.add(key(tx, tz));
      expect(tile).toBe(byCoord.get(key(tx, tz)));
    });
    expect(visited.size).toBe(tileCount(grid));
  });

  it('counts tiles matching a predicate', () => {
    const grid = createGridSpec(17, 5, 4);
    const world = createWorld(grid, (tx) => (tx % 2 === 0 ? blockedTile(Blocker.Rock, 2) : EMPTY_TILE));
    expect(countTiles(world, (tile) => tile.blocker === Blocker.Rock)).toBe(9 * 5);
    expect(countTiles(world, () => true)).toBe(17 * 5);
  });
});

describe('tile predicates and invariants', () => {
  it('EMPTY_TILE is frozen grass; blockedTile builds Blocked tiles', () => {
    expect(Object.isFrozen(EMPTY_TILE)).toBe(true);
    expect(EMPTY_TILE).toEqual({ state: TileState.Unplowed, blocker: Blocker.None, blockerHp: 0, crop: null });
    expect(blockedTile(Blocker.Rock, 2)).toEqual({ state: TileState.Blocked, blocker: Blocker.Rock, blockerHp: 2, crop: null });
    expect(blockedTile(Blocker.House)).toEqual({ state: TileState.Blocked, blocker: Blocker.House, blockerHp: 0, crop: null });
  });

  it('isWalkable is false exactly for Blocked tiles; isSoil exactly for Plowed / Watered', () => {
    expect(isWalkable(EMPTY_TILE)).toBe(true);
    expect(isWalkable(soilTile(TileState.Plowed))).toBe(true);
    expect(isWalkable(soilTile(TileState.Watered, cropOf('parsnip')))).toBe(true);
    for (const blocker of [Blocker.Rock, Blocker.Stump, Blocker.Water, Blocker.House, Blocker.ShippingBin] as const) {
      expect(isWalkable(blockedTile(blocker, 1))).toBe(false);
      expect(isSoil(blockedTile(blocker, 1))).toBe(false);
    }
    expect(isSoil(EMPTY_TILE)).toBe(false);
    expect(isSoil(soilTile(TileState.Plowed))).toBe(true);
    expect(isSoil(soilTile(TileState.Watered))).toBe(true);
  });

  it('accepts every consistent tile shape', () => {
    const valid: readonly Tile[] = [
      EMPTY_TILE,
      soilTile(TileState.Plowed),
      soilTile(TileState.Watered),
      soilTile(TileState.Plowed, cropOf('corn')),
      soilTile(TileState.Watered, cropOf('melon', { dead: true })),
      blockedTile(Blocker.Rock, 2),
      blockedTile(Blocker.Stump, 3),
      blockedTile(Blocker.Water),
      blockedTile(Blocker.House),
      blockedTile(Blocker.ShippingBin),
    ];
    for (const tile of valid) expect(() => assertTileConsistent(tile)).not.toThrow();
  });

  it('rejects Blocked without a blocker, blockers on open ground, crops off soil and bad hp', () => {
    const invalid: readonly (readonly [string, Tile])[] = [
      ['Blocked with blocker None', { state: TileState.Blocked, blocker: Blocker.None, blockerHp: 0, crop: null }],
      ['Unplowed with a rock', { state: TileState.Unplowed, blocker: Blocker.Rock, blockerHp: 2, crop: null }],
      ['Plowed with a stump', { state: TileState.Plowed, blocker: Blocker.Stump, blockerHp: 3, crop: null }],
      ['Watered with water blocker', { state: TileState.Watered, blocker: Blocker.Water, blockerHp: 0, crop: null }],
      ['crop on unplowed grass', { ...EMPTY_TILE, crop: cropOf('parsnip') }],
      ['crop on a blocked tile', { ...blockedTile(Blocker.Rock, 2), crop: cropOf('parsnip') }],
      ['negative blockerHp', { ...blockedTile(Blocker.Rock), blockerHp: -1 }],
      ['fractional blockerHp', { ...blockedTile(Blocker.Stump), blockerHp: 1.5 }],
      ['NaN blockerHp', { ...EMPTY_TILE, blockerHp: Number.NaN }],
    ];
    for (const [label, tile] of invalid) {
      expect(() => assertTileConsistent(tile), label).toThrow(InvariantError);
    }
  });
});
