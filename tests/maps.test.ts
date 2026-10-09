/**
 * The four maps (src/world/maps/): the static definitions and their module-load validation,
 * the per-map generators, the per-map seed, the overnight pipeline on every map, and the
 * version-2 → version-3 migration of the old single farm world into `maps`.
 *
 * The farm must stay bit-identical to the pre-maps generator: its per-tile fingerprint was
 * frozen into tests/fixtures/farmFingerprint.ts before the multi-map change.
 */
import { describe, expect, it } from 'vitest';
import { LAYOUT, PLAYER, SHADE, TOOLS, WORKBENCH, WORLD } from '../src/config';
import { withWorkbenchAt } from '../src/robots/workbench';
import { Salt, hash32, hashFloat } from '../src/core/hash';
import {
  Blocker,
  DIRECTIONS,
  Direction,
  MAP_IDS,
  Season,
  TileState,
  Weather,
  type MapId,
  type Tile,
  type WorldState,
} from '../src/core/types';
import { shadeCropsInSeason } from '../src/farming/crops';
import { advanceWorldOvernight } from '../src/farming/growth';
import { gameReducer, startNextDay } from '../src/state/reducer';
import { actions } from '../src/state/actions';
import { selectActiveMap, selectActiveMapId, selectActiveWorld, withActiveWorld, withMap } from '../src/state/selectors';
import { rollWeather } from '../src/time/weather';
import { inBounds, rectContains, stepTile, tileIndex } from '../src/world/grid';
import {
  MAPS,
  assertMapDefinitions,
  findWarp,
  generateMaps,
  getMap,
  isReservedTile,
  mapSeed,
  structureAt,
  type MapDefinition,
} from '../src/world/maps';
import { isForestBank, isForestBrook, isForestClearing, isForestTrail } from '../src/world/maps/forest';
import { TOWN_DIRT_PATHS, TOWN_MAIN_STREET, TOWN_SQUARE, isTownRiver } from '../src/world/maps/town';
import { isShadedTile } from '../src/world/shade';
import { EMPTY_TILE, blockedTile, countTiles, forEachTile, isWalkable, requireTile, setTile, setTiles } from '../src/world/tiles';
import { FARM_FINGERPRINT, FARM_FINGERPRINT_DEPTH, FARM_FINGERPRINT_WIDTH } from './fixtures/farmFingerprint';
import { deserializeGame, migrateSave } from '../src/state/persistence';
import {
  BASE,
  atDay,
  cropOf,
  legacySave,
  matureCrop,
  must,
  reachableFrom,
  soilTile,
  tileAt,
  withPlayer,
  withTile,
  type SaveJson,
} from './testUtils';

const SEEDS = [WORLD.seed, 0, 1, 2, 3, 12345, 0x7fffffff, 0xffffffff] as const;

const key = (tx: number, tz: number): string => `${tx},${tz}`;

/** The frozen per-tile fingerprint: the tile without `object` / `fertilizer`, stringified, folded one char code at a time. */
function tileFingerprint(tile: Tile): number {
  const json = JSON.stringify({ ...tile, object: undefined, fertilizer: undefined });
  let h = 0;
  for (let i = 0; i < json.length; i++) h = hash32(h, json.charCodeAt(i));
  return h;
}

function wildCount(world: WorldState): number {
  return countTiles(world, (tile) => tile.crop !== null && tile.crop.wild);
}

/** Every tile of `world` with its coordinates, in row-major order. */
function tilesOf(world: WorldState): { readonly tx: number; readonly tz: number; readonly tile: Tile }[] {
  const out: { tx: number; tz: number; tile: Tile }[] = [];
  forEachTile(world, (tile, tx, tz) => out.push({ tx, tz, tile }));
  return out;
}

describe('the farm is bit-identical to the pre-maps generator', () => {
  it('matches the frozen per-tile fingerprint exactly for the default seed', () => {
    const farm = generateMaps(WORLD.seed).farm;
    expect([farm.grid.width, farm.grid.depth]).toEqual([FARM_FINGERPRINT_WIDTH, FARM_FINGERPRINT_DEPTH]);
    expect(FARM_FINGERPRINT).toHaveLength(FARM_FINGERPRINT_WIDTH * FARM_FINGERPRINT_DEPTH);
    const mismatches: string[] = [];
    forEachTile(farm, (tile, tx, tz) => {
      if (tileFingerprint(tile) !== FARM_FINGERPRINT[tileIndex(farm.grid, tx, tz)]) mismatches.push(key(tx, tz));
    });
    expect(mismatches).toEqual([]);
  });

  it('has plain empty tiles on the four reserved (gate) tiles for the default seed', () => {
    const farm = generateMaps(WORLD.seed).farm;
    for (const { tx, tz } of MAPS.farm.reserved) expect(requireTile(farm, tx, tz), key(tx, tz)).toEqual(EMPTY_TILE);
  });

  it('is what createInitialState puts in maps.farm, and the player starts there', () => {
    expect(BASE.maps.farm).toEqual(withWorkbenchAt(generateMaps(WORLD.seed).farm, WORKBENCH.home));
    expect(BASE.player).toMatchObject({ mapId: 'farm', tx: PLAYER.spawn.tx, tz: PLAYER.spawn.tz, facing: PLAYER.spawnFacing });
  });
});

describe('map definitions', () => {
  it('has one definition per map id, keyed by its own id', () => {
    expect(Object.keys(MAPS)).toEqual([...MAP_IDS]);
    for (const id of MAP_IDS) {
      expect(MAPS[id].id).toBe(id);
      expect(getMap(id)).toBe(MAPS[id]);
      expect(MAPS[id].grid.chunkSize).toBe(WORLD.chunkSize);
      expect(MAPS[id].grid.tileSize).toBe(WORLD.tileSize);
    }
  });

  it('sets up the farm as before, plus its gates', () => {
    const farm = MAPS.farm;
    expect(farm).toMatchObject({
      name: 'Meadowlight Farm',
      allowsTilling: true,
      scenery: 'farm',
      structures: [],
      farmstead: LAYOUT,
      decor: { tuftChance: 0.4, flowerChance: 0.05 },
      cosmeticOffset: { x: 0, z: 0 },
      wild: {
        sproutChance: SHADE.sproutChance,
        spreadChancePerNeighbor: SHADE.spreadChancePerNeighbor,
        maxWild: SHADE.maxWild,
        initialDensity: SHADE.initialDensity,
      },
    });
    expect([farm.grid.width, farm.grid.depth]).toEqual([48, 40]);
    expect(farm.warps).toEqual([
      { from: { tx: 0, tz: 13 }, exit: Direction.West, to: { mapId: 'forest', tx: 34, tz: 15, facing: Direction.West } },
      { from: { tx: 47, tz: 38 }, exit: Direction.East, to: { mapId: 'town', tx: 1, tz: 16, facing: Direction.East } },
    ]);
    expect(farm.reserved).toEqual([
      { tx: 0, tz: 13 },
      { tx: 1, tz: 13 },
      { tx: 47, tz: 38 },
      { tx: 46, tz: 38 },
    ]);
    expect(LAYOUT.clearZones.slice(2)).toEqual([
      { x0: 0, z0: 13, width: 1, depth: 1 },
      { x0: 46, z0: 38, width: 2, depth: 1 },
    ]);
    expect(LAYOUT.plots).toEqual([
      { x0: 20, z0: 3, width: 7, depth: 6 },
      { x0: 30, z0: 3, width: 8, depth: 7 },
    ]);
    forEachTile(BASE.maps.farm, (_tile, tx, tz) => {
      expect(farm.surfaceAt(tx, tz)).toBe('grass');
      expect(farm.isShaded(tx, tz), key(tx, tz)).toBe(isShadedTile(farm.grid, tx, tz));
    });
  });

  it('sets up the forest and the town', () => {
    expect(MAPS.forest).toMatchObject({
      name: 'Mossy Woods',
      allowsTilling: false,
      scenery: 'forest',
      structures: [],
      farmstead: null,
      decor: { tuftChance: 0.1, flowerChance: 0.02 },
      cosmeticOffset: { x: 1009, z: 2003 },
      wild: { sproutChance: 0.02, spreadChancePerNeighbor: 0.12, maxWild: 60, initialDensity: 0.06 },
      warps: [{ from: { tx: 35, tz: 15 }, exit: Direction.East, to: { mapId: 'farm', tx: 1, tz: 13, facing: Direction.East } }],
      reserved: [
        { tx: 35, tz: 15 },
        { tx: 34, tz: 15 },
      ],
    });
    expect([MAPS.forest.grid.width, MAPS.forest.grid.depth]).toEqual([36, 30]);
    expect(MAPS.town).toMatchObject({
      name: 'Brookhollow',
      allowsTilling: false,
      scenery: 'town',
      farmstead: null,
      wild: null,
      decor: { tuftChance: 0.04, flowerChance: 0.03 },
      cosmeticOffset: { x: 3001, z: 4007 },
      warps: [
        { from: { tx: 0, tz: 16 }, exit: Direction.West, to: { mapId: 'farm', tx: 46, tz: 38, facing: Direction.West } },
        { from: { tx: 39, tz: 16 }, exit: Direction.East, to: { mapId: 'neighbours', tx: 1, tz: 14, facing: Direction.East } },
      ],
      reserved: [
        { tx: 0, tz: 16 },
        { tx: 1, tz: 16 },
        { tx: 39, tz: 16 },
        { tx: 38, tz: 16 },
      ],
    });
    expect([MAPS.town.grid.width, MAPS.town.grid.depth]).toEqual([40, 32]);
  });

  it('answers the shade and surface lookups out of bounds too', () => {
    for (const id of MAP_IDS) {
      const { width, depth } = MAPS[id].grid;
      for (const [tx, tz] of [[-1, 0], [0, -1], [width, 0], [0, depth]] as const) {
        expect(MAPS[id].isShaded(tx, tz)).toBe(false);
        expect(MAPS[id].surfaceAt(tx, tz)).toBe('grass');
      }
    }
  });
});

describe('warps and reserved tiles', () => {
  it('pairs every warp with a reciprocal one arriving next to it', () => {
    for (const id of MAP_IDS) {
      for (const warp of MAPS[id].warps) {
        const back = MAPS[warp.to.mapId].warps.filter((w) => w.to.mapId === id);
        expect(back.length, `${id} (${warp.from.tx}, ${warp.from.tz})`).toBeGreaterThan(0);
        const adjacent = back.some((w) => Math.abs(w.to.tx - warp.from.tx) + Math.abs(w.to.tz - warp.from.tz) === 1);
        expect(adjacent, `${id} (${warp.from.tx}, ${warp.from.tz})`).toBe(true);
        // And the reciprocal warp's own edge tile is right next to this warp's arrival.
        const arrivalBack = back.find((w) => Math.abs(w.from.tx - warp.to.tx) + Math.abs(w.from.tz - warp.to.tz) === 1);
        expect(arrivalBack, `${id} → ${warp.to.mapId}`).toBeDefined();
      }
    }
  });

  it('leaves each map from an edge tile and arrives one tile inside the edge, facing into the map', () => {
    for (const id of MAP_IDS) {
      const def = MAPS[id];
      for (const warp of def.warps) {
        const out = stepTile(warp.from, warp.exit);
        expect(inBounds(def.grid, warp.from.tx, warp.from.tz)).toBe(true);
        expect(inBounds(def.grid, out.tx, out.tz)).toBe(false);
        const target = MAPS[warp.to.mapId];
        expect(inBounds(target.grid, warp.to.tx, warp.to.tz)).toBe(true);
        // One step on in the arrival facing stays on the grid, so a held key can't bounce back.
        const ahead = stepTile(warp.to, warp.to.facing);
        expect(inBounds(target.grid, ahead.tx, ahead.tz)).toBe(true);
        // The arrival tile's own step back the way it came is the target's edge warp tile.
        const behind = stepTile(warp.to, (warp.to.facing + 2) % 4 as Direction);
        expect(findWarp(target, behind.tx, behind.tz, (warp.to.facing + 2) % 4 as Direction)?.to.mapId).toBe(id);
      }
    }
  });

  it('reserves exactly the warp tiles and the arrival tiles', () => {
    for (const id of MAP_IDS) {
      const expected = new Set<string>();
      for (const warp of MAPS[id].warps) expected.add(key(warp.from.tx, warp.from.tz));
      for (const other of MAP_IDS) {
        for (const warp of MAPS[other].warps) if (warp.to.mapId === id) expected.add(key(warp.to.tx, warp.to.tz));
      }
      expect(new Set(MAPS[id].reserved.map((r) => key(r.tx, r.tz)))).toEqual(expected);
    }
  });

  it('keeps every reserved tile a plain walkable empty tile, for every seed', () => {
    for (const seed of SEEDS) {
      const maps = generateMaps(seed);
      for (const id of MAP_IDS) {
        for (const { tx, tz } of MAPS[id].reserved) {
          const tile = requireTile(maps[id], tx, tz);
          expect(tile, `seed ${seed} ${id} (${tx}, ${tz})`).toEqual(EMPTY_TILE);
          expect(isWalkable(tile)).toBe(true);
        }
      }
    }
  });

  it('finds a warp only on its tile and in its exit direction', () => {
    expect(findWarp(MAPS.farm, 0, 13, Direction.West)?.to.mapId).toBe('forest');
    expect(findWarp(MAPS.farm, 47, 38, Direction.East)?.to.mapId).toBe('town');
    expect(findWarp(MAPS.farm, 0, 13, Direction.North)).toBeNull();
    expect(findWarp(MAPS.farm, 0, 12, Direction.West)).toBeNull();
    expect(findWarp(MAPS.forest, 35, 15, Direction.East)?.to).toEqual({ mapId: 'farm', tx: 1, tz: 13, facing: Direction.East });
    expect(findWarp(MAPS.town, 0, 16, Direction.West)?.to).toEqual({ mapId: 'farm', tx: 46, tz: 38, facing: Direction.West });
    expect(findWarp(MAPS.town, 0, 15, Direction.West)).toBeNull();
    expect(findWarp(MAPS.town, 39, 16, Direction.East)?.to).toEqual({ mapId: 'neighbours', tx: 1, tz: 14, facing: Direction.East });
    expect(findWarp(MAPS.town, 39, 15, Direction.East)).toBeNull();
    expect(findWarp(MAPS.neighbours, 0, 14, Direction.West)?.to).toEqual({ mapId: 'town', tx: 38, tz: 16, facing: Direction.West });
  });

  it('answers isReservedTile and structureAt', () => {
    expect(isReservedTile(MAPS.farm, 1, 13)).toBe(true);
    expect(isReservedTile(MAPS.farm, 2, 13)).toBe(false);
    expect(isReservedTile(MAPS.forest, 34, 15)).toBe(true);
    expect(isReservedTile(MAPS.town, 1, 16)).toBe(true);
    expect(isReservedTile(MAPS.town, 0, 13)).toBe(false);
    expect(isReservedTile(MAPS.town, 38, 16)).toBe(true);
    expect(isReservedTile(MAPS.neighbours, 1, 14)).toBe(true);
    expect(structureAt(MAPS.town, 6, 6)?.kind).toBe('generalStore');
    expect(structureAt(MAPS.town, 20, 6)?.kind).toBe('partsExchange');
    expect(structureAt(MAPS.town, 18, 0)?.kind).toBe('partsExchange');
    expect(structureAt(MAPS.town, 20, 14)?.kind).toBe('well');
    expect(structureAt(MAPS.town, 36, 14)?.kind).toBe('lampPost');
    expect(structureAt(MAPS.town, 20, 16)).toBeNull();
    expect(structureAt(MAPS.farm, 2, 2)).toBeNull();
  });
});

describe('assertMapDefinitions', () => {
  type Defs = Record<MapId, MapDefinition>;
  const withDef = (id: MapId, patch: Partial<MapDefinition>): Defs => ({ ...MAPS, [id]: { ...MAPS[id], ...patch } });
  const [farmToForest, farmToTown] = MAPS.farm.warps;

  it('accepts the shipped definitions', () => {
    expect(() => assertMapDefinitions(MAPS)).not.toThrow();
  });

  const broken: readonly (readonly [string, Defs])[] = [
    [
      'a warp that is not on the edge',
      withDef('forest', { warps: [{ ...MAPS.forest.warps[0]!, from: { tx: 34, tz: 15 } }] }),
    ],
    [
      'a warp whose exit steps back into the grid',
      withDef('forest', { warps: [{ ...MAPS.forest.warps[0]!, exit: Direction.West }] }),
    ],
    [
      'a warp targeting a tile outside the target map',
      withDef('town', { warps: [{ ...MAPS.town.warps[0]!, to: { mapId: 'farm', tx: 48, tz: 38, facing: Direction.West } }] }),
    ],
    [
      'a warp without a reciprocal',
      withDef('farm', { warps: [farmToForest!] }),
    ],
    [
      'a reciprocal that arrives too far away',
      withDef('town', { warps: [{ ...MAPS.town.warps[0]!, to: { mapId: 'farm', tx: 45, tz: 38, facing: Direction.West } }] }),
    ],
    [
      'a structure outside the grid',
      withDef('town', { structures: [...MAPS.town.structures, { kind: 'lampPost', rect: { x0: 39, z0: 20, width: 2, depth: 1 }, door: null }] }),
    ],
    [
      'overlapping structures',
      withDef('town', { structures: [...MAPS.town.structures, { kind: 'lampPost', rect: { x0: 5, z0: 3, width: 1, depth: 1 }, door: null }] }),
    ],
    [
      'a structure on a reserved tile',
      withDef('forest', { structures: [{ kind: 'lampPost', rect: { x0: 34, z0: 15, width: 1, depth: 1 }, door: null }] }),
    ],
    [
      'a town structure in the river',
      withDef('town', { structures: [...MAPS.town.structures, { kind: 'lampPost', rect: { x0: 10, z0: 25, width: 1, depth: 1 }, door: null }] }),
    ],
    [
      'a town structure on a path',
      withDef('town', { structures: [...MAPS.town.structures, { kind: 'lampPost', rect: { x0: 8, z0: 16, width: 1, depth: 1 }, door: null }] }),
    ],
    [
      'a town back band with a gap',
      withDef('town', { structures: MAPS.town.structures.filter((s) => !(s.kind === 'hedge' && s.rect.x0 === 38)) }),
    ],
    [
      'a town back band with a gap where the parts exchange stands',
      withDef('town', { structures: MAPS.town.structures.filter((s) => s.kind !== 'partsExchange') }),
    ],
    [
      'a parts exchange door off its front row',
      withDef('town', {
        structures: MAPS.town.structures.map((s) => (s.kind === 'partsExchange' ? { ...s, door: { tx: 20, tz: 5 } } : s)),
      }),
    ],
    [
      'a farm spawn that is not clear',
      withDef('farm', { farmstead: { ...LAYOUT, clearZones: LAYOUT.clearZones.slice(1) } }),
    ],
    [
      'an unreserved arrival tile',
      withDef('farm', { reserved: MAPS.farm.reserved.filter((r) => !(r.tx === 1 && r.tz === 13)) }),
    ],
    [
      'an east gate with no way back from the Neighbours',
      withDef('neighbours', { warps: [] }),
    ],
  ];

  it.each(broken)('throws on %s', (_name, defs) => {
    expect(() => assertMapDefinitions(defs)).toThrow(RangeError);
  });

  it('keeps the farm warps in the order the spec lists them', () => {
    expect(farmToForest?.to.mapId).toBe('forest');
    expect(farmToTown?.to.mapId).toBe('town');
  });
});

describe('the forest, Mossy Woods', () => {
  const def = MAPS.forest;
  const forest = generateMaps(WORLD.seed).forest;
  const debris = (tile: Tile): boolean =>
    tile.blocker === Blocker.Tree || tile.blocker === Blocker.Rock || tile.blocker === Blocker.Stump || tile.blocker === Blocker.Weeds;

  it('runs a dirt trail in from the gate, free of debris and wild crops', () => {
    for (let tx = 22; tx <= 35; tx++) {
      for (let tz = 14; tz <= 16; tz++) {
        expect(isForestTrail(tx, tz)).toBe(true);
        expect(def.surfaceAt(tx, tz)).toBe('dirt');
        expect(requireTile(forest, tx, tz), key(tx, tz)).toEqual(EMPTY_TILE);
      }
    }
    expect(isForestTrail(21, 15)).toBe(false);
    expect(isForestTrail(30, 13)).toBe(false);
    forEachTile(forest, (_tile, tx, tz) => {
      if (!isForestTrail(tx, tz)) expect(def.surfaceAt(tx, tz), key(tx, tz)).toBe('grass');
    });
  });

  it('opens a sunny clearing, strictly inside radius 5 of (17.5, 14.5), that never meets the trail', () => {
    expect(isForestClearing(17, 14)).toBe(true);
    expect(isForestClearing(22, 14)).toBe(false); // centre exactly 5.0 away: trail, not clearing
    expect(isForestClearing(13, 14)).toBe(true);
    expect(isForestClearing(12, 14)).toBe(false); // centre exactly 5.0 away on the west side
    let size = 0;
    forEachTile(forest, (tile, tx, tz) => {
      const inside = Math.hypot(tx + 0.5 - 17.5, tz + 0.5 - 14.5) < 5;
      expect(isForestClearing(tx, tz)).toBe(inside);
      expect(def.isShaded(tx, tz), key(tx, tz)).toBe(!inside);
      if (!inside) return;
      size++;
      expect(isForestTrail(tx, tz)).toBe(false);
      expect(tile, key(tx, tz)).toEqual(EMPTY_TILE);
    });
    expect(size).toBeGreaterThan(60);
  });

  it('winds a brook of water that never touches an edge, with a bank free of trees, rocks and stumps', () => {
    for (const seed of SEEDS) {
      let water = 0;
      forEachTile(generateMaps(seed).forest, (tile, tx, tz) => {
        expect(tile.blocker === Blocker.Water, `seed ${seed} ${key(tx, tz)}`).toBe(isForestBrook(tx, tz));
        if (isForestBrook(tx, tz)) {
          water++;
          expect(tx > 0 && tz > 0 && tx < 35 && tz < 29, key(tx, tz)).toBe(true);
          expect(tile.blockerHp).toBe(0);
        }
        if (isForestBank(tx, tz)) {
          const blocker = tile.blocker;
          expect(blocker !== Blocker.Tree && blocker !== Blocker.Rock && blocker !== Blocker.Stump, key(tx, tz)).toBe(true);
        }
      });
      expect(water).toBeGreaterThan(40);
    }
    // The polyline's vertices are water; a tile two away is bank, not water.
    for (const [tx, tz] of [[6, 3], [9, 8], [8, 13], [11, 19], [10, 25]] as const) expect(isForestBrook(tx, tz)).toBe(true);
    expect(isForestBank(11, 8)).toBe(true);
    expect(isForestBrook(11, 8)).toBe(false);
  });

  it('rolls every other tile from the forest seed: tree, rock, stump, weeds or nothing', () => {
    for (const seed of SEEDS) {
      const world = generateMaps(seed).forest;
      const mseed = mapSeed(seed, 'forest');
      forEachTile(world, (tile, tx, tz) => {
        if (isForestBrook(tx, tz) || isForestTrail(tx, tz) || isForestClearing(tx, tz)) return;
        const r = hashFloat(mseed, tx, tz, Salt.ForestGen);
        const bank = isForestBank(tx, tz);
        let expected: Tile = EMPTY_TILE;
        if (r < 0.24) expected = bank ? EMPTY_TILE : blockedTile(Blocker.Tree, TOOLS.treeHits);
        else if (r < 0.27) expected = bank ? EMPTY_TILE : blockedTile(Blocker.Rock, TOOLS.rockHits);
        else if (r < 0.3) expected = bank ? EMPTY_TILE : blockedTile(Blocker.Stump, TOOLS.stumpHits);
        else if (r < 0.36) expected = blockedTile(Blocker.Weeds);
        const withoutCrop = tile.crop !== null && tile.crop.wild ? { ...tile, crop: null } : tile;
        expect(withoutCrop, `seed ${seed} ${key(tx, tz)}`).toEqual(expected);
      });
    }
  });

  it('is mostly wooded: about a quarter trees, and some rocks, stumps and weeds', () => {
    const count = (blocker: Blocker): number => countTiles(forest, (tile) => tile.blocker === blocker);
    expect(count(Blocker.Tree)).toBeGreaterThan(150);
    expect(count(Blocker.Tree)).toBeLessThan(300);
    expect(count(Blocker.Rock)).toBeGreaterThan(5);
    expect(count(Blocker.Stump)).toBeGreaterThan(5);
    expect(count(Blocker.Weeds)).toBeGreaterThan(20);
    forEachTile(forest, (tile) => {
      if (tile.blocker === Blocker.Tree) expect(tile.blockerHp).toBe(TOOLS.treeHits);
      if (debris(tile)) expect(tile.crop).toBeNull();
      expect(tile.state).toBe(tile.blocker === Blocker.None ? TileState.Unplowed : TileState.Blocked);
      expect(tile.object).toBeNull();
    });
  });

  it('starts with spring shade crops only on shaded empty floor off the trail and the reserved tiles', () => {
    const springIds = shadeCropsInSeason(Season.Spring).map((crop) => crop.id);
    for (const seed of SEEDS) {
      const world = generateMaps(seed).forest;
      const mseed = mapSeed(seed, 'forest');
      forEachTile(world, (tile, tx, tz) => {
        if (tile.crop === null) return;
        const where = `seed ${seed} ${key(tx, tz)}`;
        expect(tile.crop.wild, where).toBe(true);
        expect(springIds, where).toContain(tile.crop.cropId);
        expect(def.isShaded(tx, tz), where).toBe(true);
        expect(isForestTrail(tx, tz) || isReservedTile(def, tx, tz), where).toBe(false);
        expect({ ...tile, crop: null }, where).toEqual(EMPTY_TILE);
        expect(hashFloat(mseed, tx, tz, Salt.Wild), where).toBeLessThan(def.wild?.initialDensity ?? 0);
      });
      expect(wildCount(world), `seed ${seed}`).toBeGreaterThan(10);
    }
  });

  it('can be crossed from the gate to the clearing and the brook bank', () => {
    const reach = reachableFrom(forest, { tx: 34, tz: 15 });
    expect(reach.has(key(17, 14))).toBe(true);
    const bankNextToWater = tilesOf(forest).some(({ tx, tz }) => {
      if (!reach.has(key(tx, tz))) return false;
      return DIRECTIONS.some((d) => {
        const n = stepTile({ tx, tz }, d);
        return inBounds(def.grid, n.tx, n.tz) && isForestBrook(n.tx, n.tz);
      });
    });
    expect(bankNextToWater).toBe(true);
  });
});

describe('the town, Brookhollow', () => {
  const def = MAPS.town;
  const town = generateMaps(WORLD.seed).town;
  const r = (x0: number, z0: number, width: number, depth: number) => ({ x0, z0, width, depth });

  it('places exactly the structures of the spec', () => {
    const lamp = (tx: number, tz: number) => ({ kind: 'lampPost', rect: r(tx, tz, 1, 1), door: null });
    const hedge = (x0: number, z0: number, width: number, depth: number) => ({ kind: 'hedge', rect: r(x0, z0, width, depth), door: null });
    expect(def.structures).toEqual([
      { kind: 'generalStore', rect: r(3, 0, 7, 7), door: { tx: 6, tz: 6 } },
      { kind: 'blacksmith', rect: r(12, 0, 6, 7), door: { tx: 15, tz: 6 } },
      { kind: 'carpenter', rect: r(22, 0, 6, 7), door: { tx: 25, tz: 6 } },
      { kind: 'ranch', rect: r(31, 0, 7, 7), door: { tx: 34, tz: 6 } },
      { kind: 'partsExchange', rect: r(18, 0, 4, 7), door: { tx: 20, tz: 6 } },
      hedge(0, 0, 3, 7),
      hedge(10, 0, 2, 7),
      hedge(28, 0, 3, 7),
      hedge(38, 0, 2, 7),
      { kind: 'well', rect: r(19, 13, 2, 2), door: null },
      lamp(13, 8),
      lamp(26, 8),
      lamp(13, 20),
      lamp(26, 20),
      lamp(4, 14),
      lamp(36, 14),
    ]);
  });

  it('stands the parts exchange on exactly the tiles of the old notice board and its three hedges', () => {
    // Before part 4a: hedge(18, 0, 4, 6), hedge(18, 6, 1, 1), hedge(21, 6, 1, 1) and the notice board (19, 6, 2, 1).
    const before = [r(18, 0, 4, 6), r(18, 6, 1, 1), r(21, 6, 1, 1), r(19, 6, 2, 1)];
    const exchange = def.structures.find((s) => s.kind === 'partsExchange');
    if (exchange === undefined) throw new Error('no parts exchange');
    for (let tz = 0; tz < 32; tz++) {
      for (let tx = 0; tx < 40; tx++) {
        const old = before.filter((rect) => rectContains(rect, tx, tz)).length;
        expect(old, key(tx, tz)).toBeLessThanOrEqual(1);
        expect(rectContains(exchange.rect, tx, tz), key(tx, tz)).toBe(old === 1);
      }
    }
  });

  it('blocks exactly the tiles it blocked before the parts exchange, so saved towns need no migration', () => {
    // Pinned without reading def.structures: the whole back band (z 0–6), the well and the six
    // lamp posts are buildings, the river is water and everything else is open grass.
    const lamps = [key(13, 8), key(26, 8), key(13, 20), key(26, 20), key(4, 14), key(36, 14)];
    const isBuilding = (tx: number, tz: number): boolean =>
      tz <= 6 || (tx >= 19 && tx <= 20 && tz >= 13 && tz <= 14) || lamps.includes(key(tx, tz));
    let buildings = 0;
    forEachTile(town, (tile, tx, tz) => {
      const expected = isBuilding(tx, tz) ? blockedTile(Blocker.Building) : isTownRiver(tx, tz) ? blockedTile(Blocker.Water) : EMPTY_TILE;
      expect(tile, key(tx, tz)).toEqual(expected);
      if (tile.blocker === Blocker.Building) buildings++;
    });
    expect(buildings).toBe(40 * 7 + 4 + 6);
  });

  it('covers the back band z 0–6 exactly once with shops, hedges and the parts exchange', () => {
    for (let tz = 0; tz <= 6; tz++) {
      for (let tx = 0; tx < 40; tx++) {
        const covering = def.structures.filter((s) => rectContains(s.rect, tx, tz));
        expect(covering.length, key(tx, tz)).toBe(1);
        expect(['well', 'lampPost']).not.toContain(covering[0]?.kind);
      }
    }
  });

  it('builds structures, then the river, then empty grass, the same for every seed', () => {
    for (const seed of SEEDS) expect(generateMaps(seed).town, `seed ${seed}`).toEqual(town);
    forEachTile(town, (tile, tx, tz) => {
      const where = key(tx, tz);
      if (structureAt(def, tx, tz) !== null) expect(tile, where).toEqual(blockedTile(Blocker.Building));
      else if (isTownRiver(tx, tz)) expect(tile, where).toEqual(blockedTile(Blocker.Water));
      else expect(tile, where).toEqual(EMPTY_TILE);
      expect(def.isShaded(tx, tz)).toBe(false);
    });
    expect(wildCount(town)).toBe(0);
  });

  it('runs the river along the south, minus its corners, with a reachable strip beyond it', () => {
    let water = 0;
    forEachTile(town, (tile, tx, tz) => {
      const inside = tx >= 3 && tx <= 36 && tz >= 24 && tz <= 27;
      const corner = (tx === 3 || tx === 36) && (tz === 24 || tz === 27);
      expect(isTownRiver(tx, tz), key(tx, tz)).toBe(inside && !corner);
      if (tile.blocker === Blocker.Water) water++;
    });
    expect(water).toBe(34 * 4 - 4);
    const reach = reachableFrom(town, { tx: 1, tz: 16 });
    for (let tx = 0; tx < 40; tx++) for (let tz = 28; tz < 32; tz++) expect(reach.has(key(tx, tz)), key(tx, tz)).toBe(true);
    // Every walkable tile of the town is reachable from the gate.
    forEachTile(town, (tile, tx, tz) => {
      if (isWalkable(tile)) expect(reach.has(key(tx, tz)), key(tx, tz)).toBe(true);
    });
  });

  it('opens the east gate at the east end of the main street, onto the Neighbours lane', () => {
    expect(def.warps[1]).toEqual({ from: { tx: 39, tz: 16 }, exit: Direction.East, to: { mapId: 'neighbours', tx: 1, tz: 14, facing: Direction.East } });
    for (const tx of [38, 39]) {
      expect(structureAt(def, tx, 16), key(tx, 16)).toBeNull();
      expect(requireTile(town, tx, 16), key(tx, 16)).toEqual(EMPTY_TILE);
      expect(def.surfaceAt(tx, 16), key(tx, 16)).toBe('cobble');
      expect(isReservedTile(def, tx, 16), key(tx, 16)).toBe(true);
    }
  });

  it('paves the street and the square with cobble, the paths with dirt, and grasses the rest', () => {
    expect(TOWN_MAIN_STREET).toEqual(r(0, 15, 40, 3));
    expect(TOWN_SQUARE).toEqual(r(14, 7, 12, 13));
    expect(TOWN_DIRT_PATHS).toEqual([r(6, 7, 1, 8), r(34, 7, 1, 8), r(3, 22, 34, 1), r(19, 20, 2, 2)]);
    forEachTile(town, (_tile, tx, tz) => {
      const cobble = (tz >= 15 && tz <= 17) || (tx >= 14 && tx <= 25 && tz >= 7 && tz <= 19);
      const dirt =
        ((tx === 6 || tx === 34) && tz >= 7 && tz <= 14) || (tz === 22 && tx >= 3 && tx <= 36) || (tx >= 19 && tx <= 20 && tz >= 20 && tz <= 21);
      expect(def.surfaceAt(tx, tz), key(tx, tz)).toBe(cobble ? 'cobble' : dirt ? 'dirt' : 'grass');
    });
  });

  it('opens every shop door and the parts exchange door onto a walkable path tile at z = 7', () => {
    expect(def.structures.filter((s) => s.door !== null).map((s) => s.kind)).toEqual([
      'generalStore',
      'blacksmith',
      'carpenter',
      'ranch',
      'partsExchange',
    ]);
    for (const s of def.structures) {
      if (s.door === null) continue;
      expect(s.door.tz).toBe(6);
      expect(rectContains(s.rect, s.door.tx, s.door.tz)).toBe(true);
      const front = requireTile(town, s.door.tx, 7);
      expect(isWalkable(front), s.kind).toBe(true);
      expect(def.surfaceAt(s.door.tx, 7), s.kind).not.toBe('grass');
    }
  });
});

describe('generation and map seeds', () => {
  it('is deterministic: the same seed always yields the same maps', () => {
    for (const seed of SEEDS) {
      const maps = generateMaps(seed);
      expect(Object.keys(maps)).toEqual([...MAP_IDS]);
      expect(generateMaps(seed), `seed ${seed}`).toEqual(maps);
      for (const id of MAP_IDS) expect(MAPS[id].generate(seed), `seed ${seed} ${id}`).toEqual(maps[id]);
    }
  });

  it('gives a different forest for every seed, while the town and the Neighbours are the same for all of them', () => {
    const forests = SEEDS.map((seed) => JSON.stringify(generateMaps(seed).forest));
    expect(new Set(forests).size).toBe(SEEDS.length);
    const towns = SEEDS.map((seed) => JSON.stringify(generateMaps(seed).town));
    expect(new Set(towns).size).toBe(1);
    const neighbours = SEEDS.map((seed) => JSON.stringify(generateMaps(seed).neighbours));
    expect(new Set(neighbours).size).toBe(1);
  });

  it('derives the map seed: the save seed itself on the farm, separate u32 streams elsewhere', () => {
    for (const seed of SEEDS) {
      expect(mapSeed(seed, 'farm')).toBe(seed);
      expect(mapSeed(seed, 'forest')).toBe(hash32(seed, Salt.MapForest));
      expect(mapSeed(seed, 'town')).toBe(hash32(seed, Salt.MapTown));
      expect(mapSeed(seed, 'neighbours')).toBe(hash32(seed, Salt.MapNeighbours));
      for (const id of MAP_IDS) {
        const value = mapSeed(seed, id);
        expect(Number.isInteger(value) && value >= 0 && value <= 0xffffffff).toBe(true);
      }
      expect(new Set(MAP_IDS.filter((id) => id !== 'farm').map((id) => mapSeed(seed, id))).size).toBe(MAP_IDS.length - 1);
    }
  });

  it('never starts a map with more wild crops than it allows', () => {
    const seeds = [...SEEDS, 5, 6, 7, 8, 9, 10, 99, 4242];
    for (const seed of seeds) {
      const maps = generateMaps(seed);
      for (const id of MAP_IDS) {
        const count = wildCount(maps[id]);
        const wild = MAPS[id].wild;
        if (wild === null) expect(count, `seed ${seed} ${id}`).toBe(0);
        else expect(count, `seed ${seed} ${id}`).toBeLessThanOrEqual(wild.maxWild);
      }
    }
  });

  it('never generates a wild crop, debris or an object on a reserved tile', () => {
    for (const seed of SEEDS) {
      const maps = generateMaps(seed);
      for (const id of MAP_IDS) {
        for (const { tx, tz } of MAPS[id].reserved) expect(requireTile(maps[id], tx, tz), `${seed} ${id}`).toEqual(EMPTY_TILE);
      }
    }
  });

  it('carves the gates on the farm only where a seed would have put debris', () => {
    for (const seed of SEEDS) {
      const farm = generateMaps(seed).farm;
      for (const { tx, tz } of [{ tx: 0, tz: 13 }, { tx: 46, tz: 38 }, { tx: 47, tz: 38 }]) {
        expect(requireTile(farm, tx, tz), `seed ${seed} ${key(tx, tz)}`).toEqual(EMPTY_TILE);
      }
    }
  });
});

describe('active-map selectors and helpers', () => {
  const inForest = withPlayer(BASE, { tx: 34, tz: 15 }, Direction.West, 'forest');

  it('select the map the player stands on', () => {
    expect(selectActiveMapId(BASE)).toBe('farm');
    expect(selectActiveWorld(BASE)).toBe(BASE.maps.farm);
    expect(selectActiveMap(BASE)).toBe(MAPS.farm);
    expect(selectActiveMapId(inForest)).toBe('forest');
    expect(selectActiveWorld(inForest)).toBe(BASE.maps.forest);
    expect(selectActiveMap(inForest)).toBe(MAPS.forest);
  });

  it('withMap and withActiveWorld keep the state when the world is unchanged, and share the others', () => {
    expect(withMap(BASE, 'town', BASE.maps.town)).toBe(BASE);
    expect(withActiveWorld(inForest, inForest.maps.forest)).toBe(inForest);
    const town = setTile(BASE.maps.town, 5, 20, soilTile(TileState.Plowed));
    const next = withMap(BASE, 'town', town);
    expect(next.maps.town).toBe(town);
    expect(next.maps.farm).toBe(BASE.maps.farm);
    expect(next.maps.forest).toBe(BASE.maps.forest);
    expect(next.player).toBe(BASE.player);
    const forest = setTile(inForest.maps.forest, 30, 15, soilTile(TileState.Plowed));
    const moved = withActiveWorld(inForest, forest);
    expect(moved.maps.forest).toBe(forest);
    expect(moved.maps.farm).toBe(inForest.maps.farm);
  });

  it('setTiles copies each touched chunk once, bumps its revision once, and skips no-op edits', () => {
    const world = BASE.maps.town;
    expect(setTiles(world, [])).toBe(world);
    expect(setTiles(world, [{ tx: 5, tz: 20, tile: requireTile(world, 5, 20) }])).toBe(world);
    const soil = soilTile(TileState.Plowed);
    const edits = [
      { tx: 1, tz: 20, tile: soil },
      { tx: 2, tz: 20, tile: soil },
      { tx: 3, tz: 21, tile: soil },
      { tx: 20, tz: 20, tile: soil },
    ];
    const next = setTiles(world, edits);
    const sequential = edits.reduce((w, e) => setTile(w, e.tx, e.tz, e.tile), world);
    expect(next.chunks.map((c) => c.tiles)).toEqual(sequential.chunks.map((c) => c.tiles));
    const changed = next.chunks.filter((chunk, i) => chunk !== world.chunks[i]);
    expect(changed).toHaveLength(2);
    for (const chunk of changed) expect(chunk.revision).toBe((world.chunks.find((c) => c.cx === chunk.cx && c.cz === chunk.cz)?.revision ?? -1) + 1);
    // A later edit of the same tile wins.
    const twice = setTiles(world, [{ tx: 1, tz: 20, tile: soil }, { tx: 1, tz: 20, tile: soilTile(TileState.Watered) }]);
    expect(requireTile(twice, 1, 20).state).toBe(TileState.Watered);
  });
});

describe('overnight on every map', () => {
  /** The first day ≥ `from` whose next morning brings rain or a storm. */
  function dayBeforeRain(from: number): number {
    for (let day = from; day < from + 200; day++) {
      const weather = rollWeather(BASE.seed, day + 1);
      if (weather === Weather.Rain || weather === Weather.Storm) return day;
    }
    throw new Error('no rain found');
  }

  it('runs each map through the overnight pipeline with its own map seed and definition', () => {
    let state = atDay(BASE, 3);
    state = withTile(state, { tx: 30, tz: 20 }, soilTile(TileState.Watered, cropOf('parsnip')), 'forest');
    const next = startNextDay(state, false);
    const ctx = {
      day: next.time.absoluteDay,
      season: next.time.season,
      seasonChanged: next.time.season !== state.time.season,
      weather: next.weather,
    };
    for (const id of MAP_IDS) {
      const expected = advanceWorldOvernight(state.maps[id], { ...ctx, seed: mapSeed(state.seed, id) }, MAPS[id]);
      expect(next.maps[id], id).toEqual(expected);
    }
    // A watered crop on forest soil grows like one on the farm.
    expect(requireTile(next.maps.forest, 30, 20).crop?.stage).toBe(1);
  });

  it('keeps the reference of a map that did not change overnight', () => {
    const next = startNextDay(atDay(BASE, 3), false);
    expect(next.maps.town).toBe(BASE.maps.town);
    expect(next.maps.neighbours).toBe(BASE.maps.neighbours);
    expect(next.maps.forest).not.toBe(BASE.maps.forest); // its wild crops grow
    expect(next.maps.farm).not.toBe(BASE.maps.farm);
  });

  it('rain waters plowed soil on every map', () => {
    const day = dayBeforeRain(3);
    let state = atDay(BASE, day);
    state = withTile(state, { tx: 10, tz: 20 }, soilTile(TileState.Plowed), 'farm');
    state = withTile(state, { tx: 30, tz: 20 }, soilTile(TileState.Plowed), 'forest');
    state = withTile(state, { tx: 5, tz: 20 }, soilTile(TileState.Plowed), 'town');
    const next = startNextDay(state, false);
    expect([Weather.Rain, Weather.Storm]).toContain(next.weather);
    expect(tileAt(next, { tx: 10, tz: 20 }, 'farm').state).toBe(TileState.Watered);
    expect(tileAt(next, { tx: 30, tz: 20 }, 'forest').state).toBe(TileState.Watered);
    expect(tileAt(next, { tx: 5, tz: 20 }, 'town').state).toBe(TileState.Watered);
  });

  it('grows and spreads wild crops in the forest shade, but never in the clearing', () => {
    let state = BASE;
    for (let night = 0; night < 20; night++) state = startNextDay(state, false);
    const forest = state.maps.forest;
    expect(wildCount(forest)).toBeGreaterThan(wildCount(BASE.maps.forest));
    forEachTile(forest, (tile, tx, tz) => {
      if (tile.crop?.wild === true) expect(isForestClearing(tx, tz), key(tx, tz)).toBe(false);
    });
  });

  it('wakes the player on the farm, wherever they went to sleep', () => {
    for (const [mapId, at] of [['forest', { tx: 34, tz: 15 }], ['town', { tx: 20, tz: 16 }]] as const) {
      const asleep = withPlayer(BASE, at, Direction.North, mapId);
      const next = gameReducer(asleep, actions.sleep());
      expect(next.player).toMatchObject({
        mapId: 'farm',
        tx: PLAYER.spawn.tx,
        tz: PLAYER.spawn.tz,
        facing: PLAYER.spawnFacing,
        teleportSeq: asleep.player.teleportSeq + 1,
      });
      expect(next.time.absoluteDay).toBe(asleep.time.absoluteDay + 1);
    }
  });

  it('over many nights never puts a crop on a reserved tile nor exceeds a map’s wild cap', () => {
    for (const seed of [WORLD.seed, 7]) {
      let state = seed === WORLD.seed ? BASE : { ...BASE, seed, maps: generateMaps(seed) };
      // Seed a mature wild crop right beside every reserved tile, so spreading has every chance.
      for (const id of MAP_IDS) {
        for (const { tx, tz } of MAPS[id].reserved) {
          for (const d of DIRECTIONS) {
            const n = stepTile({ tx, tz }, d);
            if (!inBounds(MAPS[id].grid, n.tx, n.tz) || isReservedTile(MAPS[id], n.tx, n.tz)) continue;
            if (requireTile(state.maps[id], n.tx, n.tz).blocker !== Blocker.None) continue;
            state = withTile(state, n, { ...EMPTY_TILE, crop: matureCrop('mushroom', { wild: true }) }, id);
          }
        }
      }
      for (let night = 0; night < 120; night++) {
        state = startNextDay(state, false);
        for (const id of MAP_IDS) {
          for (const { tx, tz } of MAPS[id].reserved) {
            expect(requireTile(state.maps[id], tx, tz).crop, `seed ${seed} night ${night} ${id} ${key(tx, tz)}`).toBeNull();
          }
          const wild = MAPS[id].wild;
          expect(wildCount(state.maps[id])).toBeLessThanOrEqual(wild === null ? 0 : wild.maxWild);
        }
      }
    }
  });
});

describe('migrating the single farm world of an older save into maps', () => {
  /** A played farm with debris and soil on its gate tiles, as an old save could hold them. */
  function gatesInTheWay() {
    let state = BASE;
    state = withTile(state, { tx: 0, tz: 13 }, blockedTile(Blocker.Rock, TOOLS.rockHits));
    state = withTile(state, { tx: 1, tz: 13 }, blockedTile(Blocker.Stump, 1));
    state = withTile(state, { tx: 47, tz: 38 }, blockedTile(Blocker.Stump, TOOLS.stumpHits));
    state = withTile(state, { tx: 46, tz: 38 }, soilTile(TileState.Watered, cropOf('parsnip', { stage: 2 })));
    state = withTile(state, { tx: 3, tz: 13 }, blockedTile(Blocker.Rock, 1));
    return state;
  }
  const clear = { state: TileState.Unplowed, blocker: Blocker.None, blockerHp: 0, crop: null, object: null, fertilizer: null };

  it('turns a version-2 save with a rock on a gate tile into every map, with the gates clear', () => {
    const state = gatesInTheWay();
    const v2 = legacySave(state, 2);
    const migrated = migrateSave(v2) as SaveJson;
    expect(migrated.version).toBe(8);
    expect('world' in migrated).toBe(false);
    expect(Object.keys(migrated.maps as SaveJson)).toEqual([...MAP_IDS]);
    expect((migrated.player as SaveJson).mapId).toBe('farm');

    const loaded = must(deserializeGame(JSON.stringify(v2)));
    expect(tileAt(loaded, { tx: 0, tz: 13 }, 'farm')).toEqual(clear);
    expect(tileAt(loaded, { tx: 1, tz: 13 }, 'farm')).toEqual(clear);
    expect(tileAt(loaded, { tx: 47, tz: 38 }, 'farm')).toEqual(clear);
    // Soil and crops on a gate tile are walkable, so they stay.
    expect(tileAt(loaded, { tx: 46, tz: 38 }, 'farm')).toEqual(tileAt(state, { tx: 46, tz: 38 }, 'farm'));
    // Debris anywhere else stays too.
    expect(tileAt(loaded, { tx: 3, tz: 13 }, 'farm')).toEqual(blockedTile(Blocker.Rock, 1));
    forEachTile(state.maps.farm, (tile, tx, tz) => {
      if (isReservedTile(MAPS.farm, tx, tz)) return;
      expect(tileAt(loaded, { tx, tz }, 'farm'), key(tx, tz)).toEqual(tile);
    });
    expect(loaded.maps.farm.chunks.map((c) => c.revision)).toEqual(state.maps.farm.chunks.map((c) => c.revision));
    expect(loaded.maps.forest).toEqual(MAPS.forest.generate(state.seed));
    expect(loaded.maps.town).toEqual(MAPS.town.generate(state.seed));
    expect(loaded.maps.neighbours).toEqual(MAPS.neighbours.generate(state.seed));
    expect(loaded.player).toEqual(state.player);
    for (const { tx, tz } of MAPS.farm.reserved) expect(isWalkable(tileAt(loaded, { tx, tz }, 'farm'))).toBe(true);
  });

  it('carves the gates of a version-1 save the same way', () => {
    const state = gatesInTheWay();
    const loaded = must(deserializeGame(JSON.stringify(legacySave(state, 1))));
    expect(tileAt(loaded, { tx: 0, tz: 13 }, 'farm')).toEqual(clear);
    expect(tileAt(loaded, { tx: 47, tz: 38 }, 'farm')).toEqual(clear);
    expect(tileAt(loaded, { tx: 46, tz: 38 }, 'farm')).toEqual(tileAt(state, { tx: 46, tz: 38 }, 'farm'));
    expect(loaded.maps.forest).toEqual(MAPS.forest.generate(state.seed));
  });

  it('generates the forest, the town and the Neighbours from the save seed', () => {
    const seed = 424242;
    const state = { ...BASE, seed, maps: generateMaps(seed) };
    const loaded = must(deserializeGame(JSON.stringify(legacySave(state, 2))));
    const maps = generateMaps(seed);
    expect(loaded.maps).toEqual({ ...maps, farm: withWorkbenchAt(maps.farm, WORKBENCH.home) });
    expect(loaded.maps.forest).not.toEqual(BASE.maps.forest);
  });

  it('rejects a version-3 save whose player stands outside their map or on a blocked tile of it', () => {
    const inTown = withPlayer(BASE, { tx: 1, tz: 16 }, Direction.East, 'town');
    expect(deserializeGame(JSON.stringify(inTown))?.player.mapId).toBe('town');
    const offGrid = { ...inTown, player: { ...inTown.player, tx: 45 } };
    expect(deserializeGame(JSON.stringify(offGrid))).toBeNull();
    const onRiver = { ...inTown, player: { ...inTown.player, tx: 10, tz: 25 } };
    expect(deserializeGame(JSON.stringify(onRiver))).toBeNull();
    const inForest = withPlayer(BASE, { tx: 34, tz: 15 }, Direction.West, 'forest');
    const onBrook = { ...inForest, player: { ...inForest.player, tx: 8, tz: 13 } };
    expect(deserializeGame(JSON.stringify(onBrook))).toBeNull();
  });
});
