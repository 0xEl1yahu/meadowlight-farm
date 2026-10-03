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
import { INVENTORY } from '../src/config';
import {
  Blocker,
  PLACED_OBJECT_KINDS,
  TileState,
  type GiantCropId,
  type GridSpec,
  type PlacedObject,
  type PlacedObjectKind,
  type Tile,
  type WorldState,
} from '../src/core/types';
import { chunkCount, chunkRectByIndex, createGridSpec, locateTile, tileCount } from '../src/world/grid';
import {
  EMPTY_TILE,
  assertTileConsistent,
  assertWorldObjectsConsistent,
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
    const none = { object: null, fertilizer: null };
    expect(EMPTY_TILE).toEqual({ state: TileState.Unplowed, blocker: Blocker.None, blockerHp: 0, crop: null, ...none });
    expect(blockedTile(Blocker.Rock, 2)).toEqual({ state: TileState.Blocked, blocker: Blocker.Rock, blockerHp: 2, crop: null, ...none });
    expect(blockedTile(Blocker.House)).toEqual({ state: TileState.Blocked, blocker: Blocker.House, blockerHp: 0, crop: null, ...none });
    expect(blockedTile(Blocker.Tree, 4)).toEqual({ state: TileState.Blocked, blocker: Blocker.Tree, blockerHp: 4, crop: null, ...none });
  });

  it('isWalkable is false exactly for Blocked tiles; isSoil exactly for Plowed / Watered', () => {
    expect(isWalkable(EMPTY_TILE)).toBe(true);
    expect(isWalkable(soilTile(TileState.Plowed))).toBe(true);
    expect(isWalkable(soilTile(TileState.Watered, cropOf('parsnip')))).toBe(true);
    for (const blocker of [
      Blocker.Rock,
      Blocker.Stump,
      Blocker.Water,
      Blocker.House,
      Blocker.ShippingBin,
      Blocker.Tree,
      Blocker.Weeds,
      Blocker.Building,
    ] as const) {
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
      blockedTile(Blocker.Tree, 4),
      blockedTile(Blocker.Weeds),
      blockedTile(Blocker.Building),
    ];
    for (const tile of valid) expect(() => assertTileConsistent(tile)).not.toThrow();
  });

  it('rejects Blocked without a blocker, blockers on open ground, crops off soil and bad hp', () => {
    const invalid: readonly (readonly [string, Tile])[] = [
      ['Blocked with blocker None', { ...EMPTY_TILE, state: TileState.Blocked }],
      ['Unplowed with a rock', { ...EMPTY_TILE, blocker: Blocker.Rock, blockerHp: 2 }],
      ['Plowed with a stump', { ...EMPTY_TILE, state: TileState.Plowed, blocker: Blocker.Stump, blockerHp: 3 }],
      ['Watered with water blocker', { ...EMPTY_TILE, state: TileState.Watered, blocker: Blocker.Water }],
      ['Unplowed with weeds', { ...EMPTY_TILE, blocker: Blocker.Weeds }],
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

/** One placed object of every kind, with valid payloads. */
const SAMPLE_OBJECTS: Readonly<Record<PlacedObjectKind, PlacedObject>> = {
  chest: { kind: 'chest', slots: Array.from({ length: INVENTORY.chestSlots }, () => null) },
  sprinkler: { kind: 'sprinkler' },
  qualitySprinkler: { kind: 'qualitySprinkler' },
  woodBurner: { kind: 'woodBurner', fuel: 0 },
  scarecrow: { kind: 'scarecrow' },
  woodFence: { kind: 'woodFence' },
  woodPath: { kind: 'woodPath' },
  stonePath: { kind: 'stonePath' },
  giantCrop: { kind: 'giantCrop', cropId: 'melon', anchorTx: 0, anchorTz: 0 },
  forage: { kind: 'forage', itemId: 'hazelnut', spawnDay: 3 },
  trophy: { kind: 'trophy', festival: 'harvestFair', year: 1 },
  decoration: { kind: 'decoration', variant: 'stoneLantern' },
  workbench: { kind: 'workbench' },
};
const PATHS: readonly PlacedObjectKind[] = ['woodPath', 'stonePath'];
const objectTile = (kind: PlacedObjectKind, base: Tile = EMPTY_TILE): Tile => ({ ...base, object: SAMPLE_OBJECTS[kind] });

describe('blocker hit points', () => {
  it('allows positive hp only on Rock, Stump and Tree', () => {
    for (const blocker of [Blocker.Rock, Blocker.Stump, Blocker.Tree] as const) {
      expect(() => assertTileConsistent(blockedTile(blocker, 1))).not.toThrow();
    }
    for (const blocker of [Blocker.Water, Blocker.House, Blocker.ShippingBin, Blocker.Weeds, Blocker.Building] as const) {
      expect(() => assertTileConsistent(blockedTile(blocker, 1)), `blocker ${blocker}`).toThrow(InvariantError);
      expect(() => assertTileConsistent(blockedTile(blocker, 0)), `blocker ${blocker}`).not.toThrow();
    }
  });
});

describe('placed objects and fertiliser on tiles', () => {
  it('accepts every object kind on grass, and every non-path kind on plowed and watered soil', () => {
    for (const kind of PLACED_OBJECT_KINDS) {
      expect(() => assertTileConsistent(objectTile(kind)), kind).not.toThrow();
      if (PATHS.includes(kind)) continue;
      expect(() => assertTileConsistent(objectTile(kind, soilTile(TileState.Plowed))), kind).not.toThrow();
      expect(() => assertTileConsistent(objectTile(kind, soilTile(TileState.Watered))), kind).not.toThrow();
    }
  });

  it('rejects objects on blocked tiles or next to a crop', () => {
    for (const kind of PLACED_OBJECT_KINDS) {
      expect(() => assertTileConsistent(objectTile(kind, blockedTile(Blocker.Rock, 2))), kind).toThrow(InvariantError);
      expect(() => assertTileConsistent(objectTile(kind, blockedTile(Blocker.Weeds))), kind).toThrow(InvariantError);
      const planted = objectTile(kind, soilTile(TileState.Plowed, cropOf('parsnip')));
      expect(() => assertTileConsistent(planted), kind).toThrow(InvariantError);
      const wild: Tile = { ...EMPTY_TILE, crop: cropOf('mushroom', { wild: true }), object: SAMPLE_OBJECTS[kind] };
      expect(() => assertTileConsistent(wild), kind).toThrow(InvariantError);
    }
  });

  it('keeps paths on unfertilised grass', () => {
    for (const kind of PATHS) {
      expect(() => assertTileConsistent(objectTile(kind, soilTile(TileState.Plowed))), kind).toThrow(InvariantError);
      expect(() => assertTileConsistent(objectTile(kind, soilTile(TileState.Watered))), kind).toThrow(InvariantError);
      const fertilised: Tile = { ...EMPTY_TILE, object: SAMPLE_OBJECTS[kind], fertilizer: 'basic' };
      expect(() => assertTileConsistent(fertilised), kind).toThrow(InvariantError);
    }
  });

  it('allows fertiliser only on soil without an object', () => {
    for (const fertilizer of ['basic', 'quality', 'speedGro'] as const) {
      expect(() => assertTileConsistent({ ...soilTile(TileState.Plowed), fertilizer })).not.toThrow();
      expect(() => assertTileConsistent({ ...soilTile(TileState.Watered, cropOf('corn')), fertilizer })).not.toThrow();
      expect(() => assertTileConsistent({ ...EMPTY_TILE, fertilizer }), fertilizer).toThrow(InvariantError);
      expect(() => assertTileConsistent({ ...blockedTile(Blocker.Rock, 2), fertilizer }), fertilizer).toThrow(InvariantError);
      const underSprinkler: Tile = { ...objectTile('sprinkler', soilTile(TileState.Plowed)), fertilizer };
      expect(() => assertTileConsistent(underSprinkler), fertilizer).toThrow(InvariantError);
    }
  });

  it('lets the player walk over paths only', () => {
    for (const kind of PLACED_OBJECT_KINDS) {
      expect(isWalkable(objectTile(kind)), kind).toBe(PATHS.includes(kind));
    }
    expect(isWalkable(objectTile('sprinkler', soilTile(TileState.Watered)))).toBe(false);
  });

  it('checks placed objects whenever a tile is written', () => {
    const world = createWorld(createGridSpec(4, 4, 2), () => EMPTY_TILE);
    expect(() => setTile(world, 1, 1, objectTile('woodPath', soilTile(TileState.Plowed)))).toThrow(InvariantError);
    expect(() => mapTiles(world, () => ({ ...EMPTY_TILE, fertilizer: 'basic' }))).toThrow(InvariantError);
    expect(requireTile(setTile(world, 1, 1, objectTile('chest')), 1, 1)).toEqual(objectTile('chest'));
  });
});

describe('assertWorldObjectsConsistent', () => {
  const grid = createGridSpec(9, 7, 4);
  const blank = createWorld(grid, () => EMPTY_TILE);
  const giant = (cropId: GiantCropId, anchorTx: number, anchorTz: number): Tile => ({
    ...EMPTY_TILE,
    object: { kind: 'giantCrop', cropId, anchorTx, anchorTz },
  });
  /** Writes `tile` on the 3×3 square whose min corner is (x0, z0). */
  const fill = (world: WorldState, x0: number, z0: number, tile: Tile): WorldState => {
    let next = world;
    for (let dz = 0; dz < 3; dz++) for (let dx = 0; dx < 3; dx++) next = setTile(next, x0 + dx, z0 + dz, tile);
    return next;
  };

  it('accepts worlds without giant crops and full 3×3 giant crops, even ones sharing an edge', () => {
    expect(() => assertWorldObjectsConsistent(blank)).not.toThrow();
    const withOthers = setTile(setTile(blank, 0, 0, objectTile('chest')), 8, 6, objectTile('stonePath'));
    expect(() => assertWorldObjectsConsistent(withOthers)).not.toThrow();
    const one = fill(blank, 2, 1, giant('pumpkin', 2, 1));
    expect(() => assertWorldObjectsConsistent(one)).not.toThrow();
    const two = fill(fill(blank, 0, 0, giant('melon', 0, 0)), 3, 0, giant('cauliflower', 3, 0));
    expect(() => assertWorldObjectsConsistent(two)).not.toThrow();
    const corner = fill(blank, 6, 4, giant('melon', 6, 4));
    expect(() => assertWorldObjectsConsistent(corner)).not.toThrow();
  });

  it('rejects a footprint that leaves the grid', () => {
    let world = blank;
    for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) world = setTile(world, 7 + dx, 5 + dz, giant('melon', 7, 5));
    expect(() => assertWorldObjectsConsistent(world)).toThrow(InvariantError);
    const negative = setTile(blank, 0, 0, giant('melon', -1, 0));
    expect(() => assertWorldObjectsConsistent(negative)).toThrow(InvariantError);
  });

  it('rejects a footprint with a missing or different tile', () => {
    const full = fill(blank, 2, 1, giant('pumpkin', 2, 1));
    for (const [tx, tz] of [[2, 1], [3, 2], [4, 3]] as const) {
      expect(() => assertWorldObjectsConsistent(setTile(full, tx, tz, EMPTY_TILE)), `hole at ${tx},${tz}`).toThrow(InvariantError);
      const otherCrop = setTile(full, tx, tz, giant('melon', 2, 1));
      expect(() => assertWorldObjectsConsistent(otherCrop), `melon at ${tx},${tz}`).toThrow(InvariantError);
      const chest = setTile(full, tx, tz, objectTile('chest'));
      expect(() => assertWorldObjectsConsistent(chest), `chest at ${tx},${tz}`).toThrow(InvariantError);
    }
  });

  it('rejects tiles outside the footprint that name its anchor, and overlapping footprints', () => {
    const full = fill(blank, 2, 1, giant('pumpkin', 2, 1));
    expect(() => assertWorldObjectsConsistent(setTile(full, 5, 1, giant('pumpkin', 2, 1)))).toThrow(InvariantError);
    expect(() => assertWorldObjectsConsistent(setTile(full, 0, 0, giant('pumpkin', 2, 1)))).toThrow(InvariantError);
    const overlapping = fill(full, 3, 2, giant('pumpkin', 3, 2));
    expect(() => assertWorldObjectsConsistent(overlapping)).toThrow(InvariantError);
  });
});
