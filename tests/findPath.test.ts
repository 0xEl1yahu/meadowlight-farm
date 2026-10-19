import { describe, expect, it } from 'vitest';
import { DIRECTIONS, type TileCoord } from '../src/core/types';
import { createGridSpec, stepTile } from '../src/world/grid';
import { findPath } from '../src/world/path';

const grid = createGridSpec(5, 5, 5);
const open = (): boolean => true;

describe('findPath', () => {
  it('finds the shortest path, excluding the start and including the target', () => {
    const path = findPath(grid, { tx: 0, tz: 0 }, { tx: 3, tz: 2 }, open);
    expect(path).not.toBeNull();
    expect(path).toHaveLength(5);
    expect(path?.[path.length - 1]).toEqual({ tx: 3, tz: 2 });
    let at: TileCoord = { tx: 0, tz: 0 };
    for (const tile of path ?? []) {
      expect(DIRECTIONS.some((d) => stepTile(at, d).tx === tile.tx && stepTile(at, d).tz === tile.tz)).toBe(true);
      at = tile;
    }
  });

  it('breaks ties in DIRECTIONS order', () => {
    // East comes before South in DIRECTIONS, so the east-then-south route wins over south-then-east.
    expect(findPath(grid, { tx: 0, tz: 0 }, { tx: 1, tz: 1 }, open)).toEqual([
      { tx: 1, tz: 0 },
      { tx: 1, tz: 1 },
    ]);
  });

  it('returns null for a walled-off target', () => {
    const wall = (_from: TileCoord, to: TileCoord): boolean => to.tx !== 2;
    expect(findPath(grid, { tx: 0, tz: 0 }, { tx: 4, tz: 0 }, wall)).toBeNull();
  });

  it('returns an empty path when from equals to', () => {
    expect(findPath(grid, { tx: 2, tz: 2 }, { tx: 2, tz: 2 }, open)).toEqual([]);
  });

  it('shows canStep both ends of every step', () => {
    const seen: [TileCoord, TileCoord][] = [];
    findPath(grid, { tx: 0, tz: 0 }, { tx: 1, tz: 0 }, (from, to) => {
      seen.push([from, to]);
      return true;
    });
    expect(seen.length).toBeGreaterThan(0);
    for (const [from, to] of seen) {
      expect(Math.abs(from.tx - to.tx) + Math.abs(from.tz - to.tz)).toBe(1);
    }
    expect(seen[0]).toEqual([{ tx: 0, tz: 0 }, expect.anything()]);
  });
});
