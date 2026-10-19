/**
 * The maps part 4d changes (farmclaws part 4d spec §5.3, §6.1, §7.1, §7.3, §8): SLOPMART's booth on
 * the old hedge's tiles, the town's props and its two south exits, Cosmo's second fence gap at his
 * door, the chicken run, and the startup checks that hold them: the props' layout rules and a
 * walkable door front on every map. Also what the door signs read, and the five chickens, who
 * stay inside their run whenever you look.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Blocker, Direction, MAP_IDS, type MapId, type StructureKind, type Tile, type TileCoord } from '../src/core/types';
import { SHOP_IDS, signFace } from '../src/people/shops';
import { ChickenRenderer } from '../src/render/ChickenRenderer';
import { CHICKEN_COUNT, chickenAt } from '../src/render/chickenLayout';
import type { SceneContext } from '../src/render/SceneContext';
import { rectContains, tileMinX, tileMinZ } from '../src/world/grid';
import { MAPS, assertMapDefinitions, isReservedTile, type MapDefinition, type StructurePlacement } from '../src/world/maps';
import { CHICKEN_RUN, COSMO_FENCE, assertNeighboursLayout, ringInside } from '../src/world/maps/neighbours';
import { TOWN_EXITS, TOWN_PROP_KINDS, assertTownLayout } from '../src/world/maps/town';
import { EMPTY_TILE, blockedTile, forEachTile, isWalkable, requireTile, setTile } from '../src/world/tiles';
import { BASE, atMinute, reachableFrom, withPlayer } from './testUtils';

const key = (tx: number, tz: number): string => `${tx},${tz}`;
const r = (x0: number, z0: number, width: number, depth: number) => ({ x0, z0, width, depth });

const town = MAPS.town;
const neighbours = MAPS.neighbours;
const FENCE: Tile = { ...EMPTY_TILE, object: { kind: 'woodFence' } };

/** The spec's prop table (§7.1), written out. */
const PROPS: readonly (readonly [StructureKind, ReturnType<typeof r>])[] = [
  ['marketStall', r(9, 9, 2, 1)],
  ['marketStall', r(9, 11, 2, 1)],
  ['marketStall', r(29, 10, 2, 1)],
  ['bench', r(15, 21, 2, 1)],
  ['bench', r(23, 21, 2, 1)],
  ['planter', r(12, 12, 1, 1)],
  ['planter', r(27, 12, 1, 1)],
  ['crates', r(3, 8, 1, 1)],
  ['crates', r(4, 8, 1, 1)],
  ['barrels', r(31, 8, 1, 1)],
  ['barrels', r(32, 8, 1, 1)],
  ['cart', r(37, 19, 2, 1)],
];

const props = (): readonly StructurePlacement[] => town.structures.filter((s) => TOWN_PROP_KINDS.includes(s.kind));
const doorFronts = (def: MapDefinition): TileCoord[] =>
  def.structures.flatMap((s) => (s.door === null ? [] : [{ tx: s.door.tx, tz: s.door.tz + 1 }]));
const withTown = (structures: readonly StructurePlacement[]): MapDefinition => ({ ...town, structures });

describe("SLOPMART's booth", () => {
  it('stands on the old hedge between the carpenter and the ranch, its door at (29, 6)', () => {
    const booth = town.structures.filter((s) => s.kind === 'slopShop');
    expect(booth).toEqual([{ kind: 'slopShop', rect: r(28, 0, 3, 7), door: { tx: 29, tz: 6 } }]);
    expect(town.structures.some((s) => s.kind === 'hedge' && s.rect.x0 === 28)).toBe(false);
  });

  it("blocks exactly the old hedge's tiles", () => {
    const hedge = r(28, 0, 3, 7);
    const world = BASE.maps.town;
    for (let tz = 0; tz < 7; tz++) {
      for (let tx = 26; tx < 33; tx++) {
        const covering = town.structures.filter((s) => rectContains(s.rect, tx, tz));
        expect(covering.some((s) => s.kind === 'slopShop'), key(tx, tz)).toBe(rectContains(hedge, tx, tz));
        expect(requireTile(world, tx, tz), key(tx, tz)).toEqual(blockedTile(Blocker.Building));
      }
    }
    expect(isWalkable(requireTile(world, 29, 7))).toBe(true);
  });
});

describe("the town's props", () => {
  it('are the spec’s props, each a structure with no door', () => {
    expect(TOWN_PROP_KINDS).toEqual(['marketStall', 'bench', 'planter', 'crates', 'barrels', 'cart']);
    expect(props().map((s) => [s.kind, s.rect])).toEqual(PROPS);
    for (const s of props()) expect(s.door).toBeNull();
  });

  it('stand on grass, off every door front and reserved tile, and block their tiles in a new game', () => {
    const fronts = doorFronts(town);
    for (const s of props()) {
      for (let tz = s.rect.z0; tz < s.rect.z0 + s.rect.depth; tz++) {
        for (let tx = s.rect.x0; tx < s.rect.x0 + s.rect.width; tx++) {
          expect(town.surfaceAt(tx, tz), key(tx, tz)).toBe('grass');
          expect(fronts.some((f) => f.tx === tx && f.tz === tz), key(tx, tz)).toBe(false);
          expect(isReservedTile(town, tx, tz), key(tx, tz)).toBe(false);
          expect(requireTile(BASE.maps.town, tx, tz), key(tx, tz)).toEqual(blockedTile(Blocker.Building));
        }
      }
    }
  });

  it('leave every walkable tile of the town reachable from the west gate', () => {
    const reach = reachableFrom(BASE.maps.town, { tx: 1, tz: 16 });
    forEachTile(BASE.maps.town, (tile, tx, tz) => {
      if (isWalkable(tile)) expect(reach.has(key(tx, tz)), key(tx, tz)).toBe(true);
    });
  });

  const broken: readonly (readonly [string, readonly StructurePlacement[], string])[] = [
    ['a prop on a path', [...town.structures, { kind: 'bench', rect: r(14, 9, 1, 1), door: null }], 'Town: bench at (14, 9) is not on grass'],
    ['a prop on a door front', [...town.structures, { kind: 'planter', rect: r(29, 7, 1, 1), door: null }], 'Town: planter at (29, 7) stands on a door front'],
    ['a prop on a reserved tile', [...town.structures, { kind: 'cart', rect: r(0, 30, 1, 1), door: null }], 'Town: cart at (0, 30) stands on a reserved tile'],
    [
      'a prop in the back band',
      town.structures.map((s) => (s.kind === 'slopShop' ? { ...s, kind: 'crates' as const, door: null } : s)),
      'Town: back-band tile (28, 0) is covered by [crates], not by exactly one shop, booth, parts exchange or hedge',
    ],
    ['a tall structure in the open', [...town.structures, { kind: 'hedge', rect: r(11, 9, 1, 1), door: null }], 'Town: hedge at (11, 9) stands in the open, and only low kinds may'],
  ];

  it.each(broken)('rejects %s', (_label, structures, message) => {
    expect(() => assertTownLayout(withTown(structures))).toThrow(message);
  });
});

describe("the town's south exits", () => {
  it('are reserved, plain walkable grass on the south bank', () => {
    expect(TOWN_EXITS).toEqual([{ tx: 0, tz: 30 }, { tx: 39, tz: 30 }]);
    const reach = reachableFrom(BASE.maps.town, { tx: 1, tz: 16 });
    for (const exit of TOWN_EXITS) {
      expect(isReservedTile(town, exit.tx, exit.tz)).toBe(true);
      expect(requireTile(BASE.maps.town, exit.tx, exit.tz)).toEqual(EMPTY_TILE);
      expect(town.surfaceAt(exit.tx, exit.tz)).toBe('grass');
      expect(reach.has(key(exit.tx, exit.tz))).toBe(true);
    }
  });
});

describe("Cosmo's door", () => {
  it('opens through a second gap in his fence, at (5, 5)', () => {
    expect(COSMO_FENCE).toEqual({ corners: [{ tx: 3, tz: 5 }, { tx: 10, tz: 12 }], gaps: [{ tx: 6, tz: 12 }, { tx: 5, tz: 5 }] });
    const house = neighbours.structures.find((s) => s.kind === 'cosmoHouse');
    expect(house?.door).toEqual({ tx: 5, tz: 4 });
    expect(requireTile(BASE.maps.neighbours, 5, 5)).toEqual(EMPTY_TILE);
    // From his door he walks into his field, and out of its gate to the lane.
    const reach = reachableFrom(BASE.maps.neighbours, { tx: 5, tz: 5 });
    expect(reach.has(key(7, 8))).toBe(true);
    expect(reach.has(key(1, 14))).toBe(true);
  });

  it('passes the every-map door-front check, which fails when any map blocks a door front', () => {
    expect(() => assertMapDefinitions(MAPS)).not.toThrow();
    for (const id of MAP_IDS) {
      const world = MAPS[id].generate(0);
      for (const front of doorFronts(MAPS[id])) expect(isWalkable(requireTile(world, front.tx, front.tz)), `${id} ${key(front.tx, front.tz)}`).toBe(true);
    }
    const fenced: MapDefinition = { ...neighbours, generate: () => setTile(neighbours.generate(0), 5, 5, FENCE) };
    const maps: Readonly<Record<MapId, MapDefinition>> = { ...MAPS, neighbours: fenced };
    expect(() => assertMapDefinitions(maps)).toThrow('Map neighbours: the tile in front of the cosmoHouse door is not walkable');
  });

  it('checks every gap of a ring', () => {
    const fenced: MapDefinition = { ...neighbours, generate: () => setTile(neighbours.generate(0), 5, 5, FENCE) };
    expect(() => assertNeighboursLayout(fenced)).toThrow('Neighbours: the fence gap at (5, 5) is blocked');
  });
});

describe("Cosmo's chicken run", () => {
  it('is a closed ring of wood fence beside the coop, with corners (11, 5) and (15, 8)', () => {
    expect(CHICKEN_RUN).toEqual({ corners: [{ tx: 11, tz: 5 }, { tx: 15, tz: 8 }], gaps: [] });
    expect(ringInside(CHICKEN_RUN)).toEqual(r(12, 6, 3, 2));
    const world = BASE.maps.neighbours;
    for (let tz = 5; tz <= 8; tz++) {
      for (let tx = 11; tx <= 15; tx++) {
        const inside = tx >= 12 && tx <= 14 && tz >= 6 && tz <= 7;
        expect(requireTile(world, tx, tz), key(tx, tz)).toEqual(inside ? EMPTY_TILE : FENCE);
        expect(neighbours.surfaceAt(tx, tz), key(tx, tz)).toBe('grass');
      }
    }
  });

  it('keeps its inside clear and shut off, and everything else reachable from the gate', () => {
    const reach = reachableFrom(BASE.maps.neighbours, { tx: 1, tz: 14 });
    const run = ringInside(CHICKEN_RUN);
    forEachTile(BASE.maps.neighbours, (tile, tx, tz) => {
      expect(reach.has(key(tx, tz)), key(tx, tz)).toBe(isWalkable(tile) && !rectContains(run, tx, tz));
    });
  });

  it('is checked at startup: a hole in it, or anything inside it, fails', () => {
    const holed: MapDefinition = { ...neighbours, generate: () => setTile(neighbours.generate(0), 13, 8, EMPTY_TILE) };
    expect(() => assertNeighboursLayout(holed)).toThrow('Neighbours: the fence has a hole at (13, 8)');
    const cluttered: MapDefinition = { ...neighbours, generate: () => setTile(neighbours.generate(0), 13, 6, FENCE) };
    expect(() => assertNeighboursLayout(cluttered)).toThrow('Neighbours: the chicken run is not clear at (13, 6)');
  });
});

describe('the door signs', () => {
  it('read OPEN in hours and CLOSED outside them, flipping on the hour boundaries', () => {
    const faces: readonly (readonly [number, 'OPEN' | 'CLOSED'])[] = [
      [6 * 60, 'CLOSED'],
      [9 * 60 - 1, 'CLOSED'],
      [9 * 60, 'OPEN'],
      [12 * 60 - 1, 'OPEN'],
      [12 * 60, 'CLOSED'],
      [13 * 60 - 1, 'CLOSED'],
      [13 * 60, 'OPEN'],
      [17 * 60 - 1, 'OPEN'],
      [17 * 60, 'CLOSED'],
      [25 * 60, 'CLOSED'],
    ];
    for (const shop of SHOP_IDS) {
      for (const [minute, face] of faces) expect(signFace(atMinute(BASE, minute), shop), `${shop} at ${minute}`).toBe(face);
    }
  });
});

describe("Cosmo's chickens", () => {
  it('are five, inside the run at every one of 1,000 sampled moments, and not all in one place', () => {
    expect(CHICKEN_COUNT).toBe(5);
    const run = ringInside(CHICKEN_RUN);
    const margin = 0.1;
    const spots = new Set<string>();
    for (let k = 0; k < 1000; k++) {
      const time = k * 7.31 + (k % 7) * 0.113;
      for (let i = 0; i < CHICKEN_COUNT; i++) {
        const { x, z } = chickenAt(i, time);
        expect(x, `chicken ${i} at ${time}`).toBeGreaterThan(run.x0 + margin);
        expect(x, `chicken ${i} at ${time}`).toBeLessThan(run.x0 + run.width - margin);
        expect(z, `chicken ${i} at ${time}`).toBeGreaterThan(run.z0 + margin);
        expect(z, `chicken ${i} at ${time}`).toBeLessThan(run.z0 + run.depth - margin);
        spots.add(`${x.toFixed(1)},${z.toFixed(1)}`);
      }
    }
    expect(spots.size).toBeGreaterThan(50);
  });

  it('wander on a fixed pattern: the same moment puts each chicken in the same place', () => {
    for (let i = 0; i < CHICKEN_COUNT; i++) expect(chickenAt(i, 123.4)).toEqual(chickenAt(i, 123.4));
    expect(chickenAt(0, 50)).not.toEqual(chickenAt(1, 50));
  });

  it('are drawn only on the Neighbours map, each standing in the run', () => {
    const scene = new THREE.Scene();
    const renderer = new ChickenRenderer({ scene } as unknown as SceneContext);
    const hens = scene.getObjectByName('chickens');
    if (!(hens instanceof THREE.InstancedMesh)) throw new Error('no chickens');
    renderer.sync(BASE, null);
    expect(hens.visible).toBe(false);
    const there = withPlayer(BASE, { tx: 1, tz: 14 }, Direction.East, 'neighbours');
    renderer.sync(there, null);
    expect(hens.visible).toBe(true);
    renderer.update({ dt: 1 / 60, elapsed: 42, state: there, clockMinutes: 600 });
    const run = ringInside(CHICKEN_RUN);
    const grid = neighbours.grid;
    const at = new THREE.Matrix4();
    const p = new THREE.Vector3();
    for (let i = 0; i < CHICKEN_COUNT; i++) {
      hens.getMatrixAt(i, at);
      p.setFromMatrixPosition(at);
      expect(p.x).toBeGreaterThan(tileMinX(grid, run.x0));
      expect(p.x).toBeLessThan(tileMinX(grid, run.x0 + run.width));
      expect(p.z).toBeGreaterThan(tileMinZ(grid, run.z0));
      expect(p.z).toBeLessThan(tileMinZ(grid, run.z0 + run.depth));
    }
    renderer.dispose();
    expect(scene.children).toHaveLength(0);
  });
});

describe('the generated maps', () => {
  it('match their definitions: structures block, the river is water, fences stand on their rings, the rest is open', () => {
    forEachTile(BASE.maps.town, (tile, tx, tz) => {
      const built = town.structures.some((s) => rectContains(s.rect, tx, tz));
      if (built) expect(tile, key(tx, tz)).toEqual(blockedTile(Blocker.Building));
      else expect(tile.object, key(tx, tz)).toBeNull();
    });
    for (const seed of [0, 1, 12345]) {
      expect(MAPS.town.generate(seed)).toEqual(BASE.maps.town);
      expect(MAPS.neighbours.generate(seed)).toEqual(BASE.maps.neighbours);
    }
  });
});
