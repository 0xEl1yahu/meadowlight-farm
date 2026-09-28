/**
 * Deterministic farm generation (src/world/worldgen.ts).
 *
 * The same seed must always yield the same farm; the fixed layout (house, shipping bin,
 * pond) must be stamped exactly; clear zones and the spawn must be free of debris; and every
 * Blocked tile must carry a blocker with the hit points the tools expect.
 */
import { describe, expect, it } from 'vitest';
import { LAYOUT, PLAYER, TOOLS, WORLD, type FarmLayout } from '../src/config';
import { Blocker, DIRECTIONS, TileState, type WorldState } from '../src/core/types';
import { createInitialState } from '../src/state/initialState';
import { createGridSpec, inBounds, rectContains, stepTile } from '../src/world/grid';
import { EMPTY_TILE, countTiles, forEachTile, isWalkable, requireTile } from '../src/world/tiles';
import { generateTile, generateWorld, isPondTile } from '../src/world/worldgen';
import { reachableFrom } from './testUtils';

const grid = createGridSpec(WORLD.width, WORLD.depth, WORLD.chunkSize, WORLD.tileSize);
const SEEDS = [WORLD.seed, 0, 1, 2, 3, 12345, 0x7fffffff, 0xffffffff] as const;

function inClearZone(tx: number, tz: number): boolean {
  return LAYOUT.clearZones.some((zone) => rectContains(zone, tx, tz));
}

function isDebris(blocker: Blocker): boolean {
  return blocker === Blocker.Rock || blocker === Blocker.Stump;
}

describe('generateWorld determinism', () => {
  it('produces an identical farm for the same seed', () => {
    for (const seed of SEEDS) {
      expect(generateWorld(seed, grid)).toEqual(generateWorld(seed, grid));
    }
  });

  it('matches the world of createInitialState(seed)', () => {
    expect(createInitialState().world).toEqual(generateWorld(WORLD.seed, grid));
    expect(createInitialState(7).world).toEqual(generateWorld(7, grid));
  });

  it('produces different debris for different seeds', () => {
    const worlds = SEEDS.map((seed) => generateWorld(seed, grid));
    for (let i = 0; i < worlds.length; i++) {
      for (let j = i + 1; j < worlds.length; j++) {
        const a = worlds[i] as WorldState;
        const b = worlds[j] as WorldState;
        let differing = 0;
        forEachTile(a, (tile, tx, tz) => {
          if (tile.blocker !== requireTile(b, tx, tz).blocker) differing++;
        });
        expect(differing, `seeds ${SEEDS[i]} and ${SEEDS[j]}`).toBeGreaterThan(20);
      }
    }
  });

  it('generateTile agrees with every tile of the generated world', () => {
    const world = generateWorld(WORLD.seed, grid);
    forEachTile(world, (tile, tx, tz) => {
      expect(generateTile(WORLD.seed, LAYOUT, tx, tz)).toEqual(tile);
    });
  });
});

describe('farm layout', () => {
  it.each(SEEDS)('stamps the 5 × 5 house exactly (seed %i)', (seed) => {
    const world = generateWorld(seed, grid);
    forEachTile(world, (tile, tx, tz) => {
      const inHouse = rectContains(LAYOUT.house, tx, tz);
      expect(tile.blocker === Blocker.House).toBe(inHouse);
      if (inHouse) expect(tile).toEqual({ state: TileState.Blocked, blocker: Blocker.House, blockerHp: 0, crop: null });
    });
    expect(countTiles(world, (tile) => tile.blocker === Blocker.House)).toBe(LAYOUT.house.width * LAYOUT.house.depth);
  });

  it('puts the door on the house front (+Z) face with the spawn directly in front of it', () => {
    const { house, houseDoor } = LAYOUT;
    expect(rectContains(house, houseDoor.tx, houseDoor.tz)).toBe(true);
    expect(houseDoor.tz).toBe(house.z0 + house.depth - 1);
    expect(PLAYER.spawn).toEqual({ tx: houseDoor.tx, tz: houseDoor.tz + 1 });
  });

  it.each(SEEDS)('stamps the 2-tile shipping bin (seed %i)', (seed) => {
    const world = generateWorld(seed, grid);
    forEachTile(world, (tile, tx, tz) => {
      const inBin = rectContains(LAYOUT.shippingBin, tx, tz);
      expect(tile.blocker === Blocker.ShippingBin).toBe(inBin);
      if (inBin) expect(tile.state).toBe(TileState.Blocked);
    });
    expect(countTiles(world, (tile) => tile.blocker === Blocker.ShippingBin)).toBe(2);
  });

  it.each(SEEDS)('fills the pond ellipse with water and nothing else (seed %i)', (seed) => {
    const world = generateWorld(seed, grid);
    let pond = 0;
    forEachTile(world, (tile, tx, tz) => {
      const inPond = isPondTile(LAYOUT.pond, tx, tz);
      if (inPond) pond++;
      expect(tile.blocker === Blocker.Water).toBe(inPond);
      if (inPond) expect(tile).toEqual({ state: TileState.Blocked, blocker: Blocker.Water, blockerHp: 0, crop: null });
    });
    expect(pond).toBeGreaterThan(20);
  });

  it('keeps the pond ellipse inside the grid and away from the house and bin', () => {
    const { pond } = LAYOUT;
    const x0 = Math.floor(pond.centerX - pond.radiusX) - 1;
    const x1 = Math.ceil(pond.centerX + pond.radiusX) + 1;
    const z0 = Math.floor(pond.centerZ - pond.radiusZ) - 1;
    const z1 = Math.ceil(pond.centerZ + pond.radiusZ) + 1;
    for (let tz = z0; tz <= z1; tz++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (!isPondTile(pond, tx, tz)) continue;
        expect(inBounds(grid, tx, tz)).toBe(true);
        expect(rectContains(LAYOUT.house, tx, tz)).toBe(false);
        expect(rectContains(LAYOUT.shippingBin, tx, tz)).toBe(false);
      }
    }
  });

  it('isPondTile tests the tile centre against the ellipse', () => {
    const pond = { centerX: 10, centerZ: 10, radiusX: 2, radiusZ: 1 };
    expect(isPondTile(pond, 9, 9)).toBe(true); // centre (9.5, 9.5): (0.25)² + (0.5)² ≤ 1
    expect(isPondTile(pond, 11, 9)).toBe(true); // centre (11.5, 9.5): 0.5625 + 0.25 ≤ 1
    expect(isPondTile(pond, 12, 9)).toBe(false); // centre (12.5, 9.5): 1.5625 > 1
    expect(isPondTile(pond, 9, 10)).toBe(true);
    expect(isPondTile(pond, 9, 11)).toBe(false); // centre z 11.5: (1.5)² > 1
  });
});

describe('debris', () => {
  it.each(SEEDS)('never places rocks or stumps in clear zones, and the spawn is walkable (seed %i)', (seed) => {
    const world = generateWorld(seed, grid);
    for (const zone of LAYOUT.clearZones) {
      for (let tz = zone.z0; tz < zone.z0 + zone.depth; tz++) {
        for (let tx = zone.x0; tx < zone.x0 + zone.width; tx++) {
          expect(isDebris(requireTile(world, tx, tz).blocker)).toBe(false);
        }
      }
    }
    const spawn = requireTile(world, PLAYER.spawn.tx, PLAYER.spawn.tz);
    expect(isWalkable(spawn)).toBe(true);
    expect(spawn).toBe(EMPTY_TILE);
  });

  it.each(SEEDS)('gives every Blocked tile a blocker with the correct hit points (seed %i)', (seed) => {
    const world = generateWorld(seed, grid);
    forEachTile(world, (tile) => {
      expect(tile.crop).toBeNull();
      if (tile.state !== TileState.Blocked) {
        expect(tile).toBe(EMPTY_TILE);
        return;
      }
      switch (tile.blocker) {
        case Blocker.Rock:
          expect(tile.blockerHp).toBe(TOOLS.rockHits);
          break;
        case Blocker.Stump:
          expect(tile.blockerHp).toBe(TOOLS.stumpHits);
          break;
        case Blocker.Water:
        case Blocker.House:
        case Blocker.ShippingBin:
          expect(tile.blockerHp).toBe(0);
          break;
        case Blocker.None:
          throw new Error('Blocked tile without a blocker');
      }
    });
  });

  it('only places debris outside the layout, at roughly the configured densities', () => {
    let eligible = 0;
    let rocks = 0;
    let stumps = 0;
    for (let seed = 100; seed < 120; seed++) {
      const world = generateWorld(seed, grid);
      forEachTile(world, (tile, tx, tz) => {
        const reserved =
          rectContains(LAYOUT.house, tx, tz) ||
          rectContains(LAYOUT.shippingBin, tx, tz) ||
          isPondTile(LAYOUT.pond, tx, tz) ||
          inClearZone(tx, tz);
        if (reserved) {
          expect(isDebris(tile.blocker)).toBe(false);
          return;
        }
        eligible++;
        if (tile.blocker === Blocker.Rock) rocks++;
        if (tile.blocker === Blocker.Stump) stumps++;
      });
    }
    expect(Math.abs(rocks / eligible - LAYOUT.rockDensity)).toBeLessThan(0.008);
    expect(Math.abs(stumps / eligible - LAYOUT.stumpDensity)).toBeLessThan(0.006);
  });

  it('leaves the default farm playable: the pond, bin and most of the land are reachable from spawn', () => {
    const world = generateWorld(WORLD.seed, grid);
    const reachable = reachableFrom(world, PLAYER.spawn);
    const touches = (blocker: Blocker): boolean => {
      for (const cell of reachable) {
        const [tx, tz] = cell.split(',').map(Number) as [number, number];
        for (const direction of DIRECTIONS) {
          const next = stepTile({ tx, tz }, direction);
          if (inBounds(grid, next.tx, next.tz) && requireTile(world, next.tx, next.tz).blocker === blocker) return true;
        }
      }
      return false;
    };
    expect(touches(Blocker.Water)).toBe(true);
    expect(touches(Blocker.ShippingBin)).toBe(true);
    expect(touches(Blocker.House)).toBe(true);
    const walkable = countTiles(world, isWalkable);
    expect(reachable.size / walkable).toBeGreaterThan(0.95);
  });
});

describe('layout validation', () => {
  const broken: readonly (readonly [string, FarmLayout])[] = [
    ['house outside the grid', { ...LAYOUT, house: { x0: 46, z0: 2, width: 5, depth: 5 } }],
    ['shipping bin outside the grid', { ...LAYOUT, shippingBin: { x0: 9, z0: -1, width: 2, depth: 1 } }],
    ['clear zone outside the grid', { ...LAYOUT, clearZones: [...LAYOUT.clearZones, { x0: 40, z0: 38, width: 10, depth: 5 }] }],
    ['door not on the house', { ...LAYOUT, houseDoor: { tx: 5, tz: 7 } }],
    ['spawn outside every clear zone', { ...LAYOUT, clearZones: [{ x0: 20, z0: 20, width: 4, depth: 4 }] }],
    ['zero pond radius', { ...LAYOUT, pond: { ...LAYOUT.pond, radiusX: 0 } }],
    ['negative pond radius', { ...LAYOUT, pond: { ...LAYOUT.pond, radiusZ: -1 } }],
  ];
  it.each(broken)('rejects a layout with %s', (_label, layout) => {
    expect(() => generateWorld(WORLD.seed, grid, layout)).toThrow(RangeError);
  });

  it('rejects a grid too small to hold the player spawn', () => {
    const tiny: FarmLayout = {
      ...LAYOUT,
      house: { x0: 0, z0: 0, width: 1, depth: 1 },
      houseDoor: { tx: 0, tz: 0 },
      shippingBin: { x0: 1, z0: 0, width: 1, depth: 1 },
      clearZones: [{ x0: 0, z0: 0, width: 4, depth: 4 }],
    };
    expect(() => generateWorld(WORLD.seed, createGridSpec(4, 4, 4), tiny)).toThrow(/spawn lies outside the grid/);
    // The same layout is fine on a grid that contains the spawn.
    expect(() => generateWorld(WORLD.seed, createGridSpec(8, 8, 4), { ...tiny, clearZones: [{ x0: 0, z0: 0, width: 8, depth: 8 }] })).not.toThrow();
  });
});
