/**
 * The Neighbours map (farmclaws part 4a spec §5): Cosmo's and Barnaby's farms east of the town.
 * The definition and its layout (back band, fences and their gaps, dirt fields), both gates
 * walked through with movePlayer, reachability, the startup check's Neighbours rules, the
 * overnight step leaving the map alone, and the neighbours' fences refusing the pickaxe and the
 * axe (plan refinement R9).
 */
import { describe, expect, it } from 'vitest';
import { WORLD } from '../src/config';
import { Blocker, Direction, type GameState, type Tile, type TileCoord, type WorldState } from '../src/core/types';
import { actions } from '../src/state/actions';
import { planPrimaryAction } from '../src/state/intents';
import { gameReducer, startNextDay } from '../src/state/reducer';
import { rectContains } from '../src/world/grid';
import { MAPS, assertMapDefinitions, findWarp, generateMaps, isReservedTile, structureAt, type MapDefinition } from '../src/world/maps';
import {
  BARNABY_FENCE,
  BARNABY_FIELD,
  COSMO_FENCE,
  COSMO_FIELD,
  NEIGHBOURS_BACK_BAND_DEPTH,
  NEIGHBOURS_LANE,
  assertNeighboursLayout,
  isFenceTile,
} from '../src/world/maps/neighbours';
import { EMPTY_TILE, assertWorldObjectsConsistent, blockedTile, countTiles, forEachTile, isWalkable, requireTile, setTile } from '../src/world/tiles';
import { BASE, atDay, count, holding, reachableFrom, tileAt, withPlayer, withTile } from './testUtils';

const SEEDS = [WORLD.seed, 0, 1, 2, 3, 12345, 0x7fffffff, 0xffffffff] as const;

const key = (tx: number, tz: number): string => `${tx},${tz}`;
const r = (x0: number, z0: number, width: number, depth: number) => ({ x0, z0, width, depth });
const lastText = (state: GameState): string | undefined => state.messages.entries.at(-1)?.text;

const def = MAPS.neighbours;
const world = generateMaps(WORLD.seed).neighbours;
const FENCE: Tile = { ...EMPTY_TILE, object: { kind: 'woodFence' } };

/** The ring of tiles with corners (x0, z0) and (x1, z1), written out from the spec's numbers. */
const onRing = (x0: number, z0: number, x1: number, z1: number) => (tx: number, tz: number): boolean =>
  tx >= x0 && tx <= x1 && tz >= z0 && tz <= z1 && (tx === x0 || tx === x1 || tz === z0 || tz === z1);
const cosmoRing = onRing(3, 5, 10, 12);
const barnabyRing = onRing(20, 16, 29, 25);
/** Spec §5.2: each ring is fence except its gate. */
const fenceExpected = (tx: number, tz: number): boolean =>
  (cosmoRing(tx, tz) && !(tx === 6 && tz === 12)) || (barnabyRing(tx, tz) && !(tx === 24 && tz === 16));

const move = (state: GameState, direction: Direction): GameState => gameReducer(state, actions.move(direction));

describe('the Neighbours map', () => {
  it('is a fixed 40 × 28 map without tilling, in the farm style, with one gate back to the town', () => {
    expect(def).toMatchObject({
      id: 'neighbours',
      name: 'The Neighbours',
      allowsTilling: false,
      scenery: 'farm',
      farmstead: null,
      wild: null,
      decor: { tuftChance: 0.3, flowerChance: 0.06 },
      cosmeticOffset: { x: 5003, z: 6011 },
      warps: [{ from: { tx: 0, tz: 14 }, exit: Direction.West, to: { mapId: 'town', tx: 38, tz: 16, facing: Direction.West } }],
      reserved: [
        { tx: 0, tz: 14 },
        { tx: 1, tz: 14 },
      ],
    });
    expect([def.grid.width, def.grid.depth]).toEqual([40, 28]);
    expect([world.grid.width, world.grid.depth]).toEqual([40, 28]);
  });

  it('generates the same world for every seed, and a new game starts with it', () => {
    for (const seed of SEEDS) expect(generateMaps(seed).neighbours, `seed ${seed}`).toEqual(world);
    expect(MAPS.neighbours.generate(1)).toEqual(MAPS.neighbours.generate(2));
    expect(BASE.maps.neighbours).toEqual(world);
  });

  it('places exactly the structures of the spec', () => {
    const hedge = (x0: number, z0: number, width: number, depth: number) => ({ kind: 'hedge', rect: r(x0, z0, width, depth), door: null });
    expect(def.structures).toEqual([
      { kind: 'cosmoHouse', rect: r(3, 0, 6, 5), door: { tx: 5, tz: 4 } },
      { kind: 'chickenCoop', rect: r(11, 0, 4, 5), door: null },
      { kind: 'barnabyHouse', rect: r(24, 0, 6, 5), door: { tx: 26, tz: 4 } },
      hedge(0, 0, 3, 5),
      hedge(9, 0, 2, 5),
      hedge(15, 0, 9, 5),
      hedge(30, 0, 10, 5),
    ]);
  });

  it('covers the back band z 0–4 exactly once with the houses, the coop and hedges, and builds nothing in front of it', () => {
    expect(NEIGHBOURS_BACK_BAND_DEPTH).toBe(5);
    forEachTile(world, (tile, tx, tz) => {
      const covering = def.structures.filter((s) => rectContains(s.rect, tx, tz));
      if (tz <= 4) {
        expect(covering.length, key(tx, tz)).toBe(1);
        expect(['cosmoHouse', 'barnabyHouse', 'chickenCoop', 'hedge']).toContain(covering[0]?.kind);
        expect(tile, key(tx, tz)).toEqual(blockedTile(Blocker.Building));
      } else {
        expect(covering, key(tx, tz)).toEqual([]);
      }
    });
  });

  it('rings both fields with wood fences, open at one gate each', () => {
    expect(COSMO_FENCE).toEqual({ corners: [{ tx: 3, tz: 5 }, { tx: 10, tz: 12 }], gap: { tx: 6, tz: 12 } });
    expect(BARNABY_FENCE).toEqual({ corners: [{ tx: 20, tz: 16 }, { tx: 29, tz: 25 }], gap: { tx: 24, tz: 16 } });
    forEachTile(world, (tile, tx, tz) => {
      expect(isFenceTile(tx, tz), key(tx, tz)).toBe(fenceExpected(tx, tz));
      if (fenceExpected(tx, tz)) expect(tile, key(tx, tz)).toEqual(FENCE);
      else expect(tile.object, key(tx, tz)).toBeNull();
    });
    // 28 ring tiles round Cosmo's 6 × 6 field and 36 round Barnaby's 8 × 8, less a gate each.
    expect(countTiles(world, (tile) => tile.object?.kind === 'woodFence')).toBe(27 + 35);
    for (const gap of [COSMO_FENCE.gap, BARNABY_FENCE.gap]) {
      expect(requireTile(world, gap.tx, gap.tz), key(gap.tx, gap.tz)).toEqual(EMPTY_TILE);
      expect(isWalkable(requireTile(world, gap.tx, gap.tz))).toBe(true);
    }
  });

  it('lays bare dirt (not soil) on the lane and inside both fields, and grass everywhere else', () => {
    expect(NEIGHBOURS_LANE).toEqual(r(0, 13, 40, 3));
    expect(COSMO_FIELD).toEqual(r(4, 6, 6, 6));
    expect(BARNABY_FIELD).toEqual(r(21, 17, 8, 8));
    forEachTile(world, (tile, tx, tz) => {
      const dirt = (tz >= 13 && tz <= 15) || (tx >= 4 && tx <= 9 && tz >= 6 && tz <= 11) || (tx >= 21 && tx <= 28 && tz >= 17 && tz <= 24);
      expect(def.surfaceAt(tx, tz), key(tx, tz)).toBe(dirt ? 'dirt' : 'grass');
      expect(def.isShaded(tx, tz)).toBe(false);
      if (structureAt(def, tx, tz) === null && !fenceExpected(tx, tz)) expect(tile, key(tx, tz)).toEqual(EMPTY_TILE);
    });
  });

  it('passes the world-level placed-object check', () => {
    expect(() => assertWorldObjectsConsistent(world)).not.toThrow();
  });
});

describe('the gates', () => {
  it('reserves the gate and arrival tiles on both sides, and keeps them clear', () => {
    for (const { tx, tz } of [{ tx: 39, tz: 16 }, { tx: 38, tz: 16 }]) {
      expect(isReservedTile(MAPS.town, tx, tz)).toBe(true);
      expect(requireTile(BASE.maps.town, tx, tz)).toEqual(EMPTY_TILE);
      expect(MAPS.town.surfaceAt(tx, tz)).toBe('cobble');
    }
    for (const { tx, tz } of [{ tx: 0, tz: 14 }, { tx: 1, tz: 14 }]) {
      expect(isReservedTile(def, tx, tz)).toBe(true);
      expect(requireTile(world, tx, tz)).toEqual(EMPTY_TILE);
    }
    expect(findWarp(MAPS.town, 39, 16, Direction.East)?.to).toEqual({ mapId: 'neighbours', tx: 1, tz: 14, facing: Direction.East });
    expect(findWarp(def, 0, 14, Direction.West)?.to).toEqual({ mapId: 'town', tx: 38, tz: 16, facing: Direction.West });
    expect(findWarp(def, 0, 13, Direction.West)).toBeNull();
  });

  it('walks east out of the town onto the lane, and back west into the town', () => {
    const start = withPlayer(BASE, { tx: 38, tz: 16 }, Direction.North, 'town');
    const atGate = move(start, Direction.East);
    expect(atGate.player).toMatchObject({ mapId: 'town', tx: 39, tz: 16, facing: Direction.East, moveSeq: 1, teleportSeq: 0 });
    const there = move(atGate, Direction.East);
    expect(there.player).toMatchObject({ mapId: 'neighbours', tx: 1, tz: 14, facing: Direction.East, moveSeq: 1, teleportSeq: 1 });
    const onward = move(there, Direction.East);
    expect(onward.player).toMatchObject({ mapId: 'neighbours', tx: 2, tz: 14, moveSeq: 2, teleportSeq: 1 });
    const edge = move(move(onward, Direction.West), Direction.West);
    expect(edge.player).toMatchObject({ mapId: 'neighbours', tx: 0, tz: 14, facing: Direction.West, moveSeq: 4, teleportSeq: 1 });
    const back = move(edge, Direction.West);
    expect(back.player).toMatchObject({ mapId: 'town', tx: 38, tz: 16, facing: Direction.West, moveSeq: 4, teleportSeq: 2 });
    expect(back.maps).toBe(BASE.maps);
  });

  it('turns the player at every other edge tile of the lane instead of leaving', () => {
    const north = withPlayer(BASE, { tx: 0, tz: 13 }, Direction.North, 'neighbours');
    expect(move(north, Direction.West).player).toEqual({ ...north.player, facing: Direction.West });
    const east = withPlayer(BASE, { tx: 39, tz: 14 }, Direction.North, 'neighbours');
    expect(move(east, Direction.East).player).toEqual({ ...east.player, facing: Direction.East });
  });
});

describe('getting around', () => {
  it('reaches every walkable tile from the gate, the fields through their gaps', () => {
    const reach = reachableFrom(world, { tx: 1, tz: 14 });
    forEachTile(world, (tile, tx, tz) => {
      expect(reach.has(key(tx, tz)), key(tx, tz)).toBe(isWalkable(tile));
    });
    for (const inside of [{ tx: 7, tz: 8 }, { tx: 25, tz: 20 }]) expect(reach.has(key(inside.tx, inside.tz))).toBe(true);
  });

  it('closes each field but for its gap', () => {
    const shut = (gap: TileCoord, inside: TileCoord): void => {
      const closed = setTile(world, gap.tx, gap.tz, FENCE);
      const reach = reachableFrom(closed, { tx: 1, tz: 14 });
      expect(reach.has(key(inside.tx, inside.tz))).toBe(false);
    };
    shut(COSMO_FENCE.gap, { tx: 7, tz: 8 });
    shut(BARNABY_FENCE.gap, { tx: 25, tz: 20 });
  });
});

describe('the startup check on the Neighbours map', () => {
  const gen = (): WorldState => def.generate(0);
  const broken: readonly (readonly [string, MapDefinition, string])[] = [
    [
      'a back band with a gap',
      { ...def, structures: def.structures.filter((s) => s.kind !== 'chickenCoop') },
      'Neighbours: back-band tile (11, 0) is covered by [], not by exactly one house, coop or hedge',
    ],
    [
      'a back-band tile covered twice',
      { ...def, structures: [...def.structures, { kind: 'hedge', rect: r(11, 0, 1, 1), door: null }] },
      'Neighbours: back-band tile (11, 0) is covered by [chickenCoop, hedge], not by exactly one house, coop or hedge',
    ],
    [
      'a structure in the back band that has no business there',
      { ...def, structures: def.structures.map((s) => (s.rect.x0 === 9 ? { ...s, kind: 'well' as const } : s)) },
      'Neighbours: back-band tile (9, 0) is covered by [well], not by exactly one house, coop or hedge',
    ],
    [
      'a structure in front of the back band',
      { ...def, structures: [...def.structures, { kind: 'lampPost', rect: r(15, 8, 1, 1), door: null }] },
      'Neighbours: lampPost stands outside the back band',
    ],
    ['a hole in a fence', { ...def, generate: () => setTile(gen(), 3, 8, EMPTY_TILE) }, 'Neighbours: the fence has a hole at (3, 8)'],
    ['a fenced-off gap', { ...def, generate: () => setTile(gen(), 24, 16, FENCE) }, 'Neighbours: the fence gap at (24, 16) is blocked'],
    ['a fenced-off arrival tile', { ...def, generate: () => setTile(gen(), 1, 14, FENCE) }, 'Neighbours: reserved tile (1, 14) is not clear'],
    [
      'a walkable corner nobody can reach',
      { ...def, generate: () => setTile(setTile(gen(), 38, 27, FENCE), 39, 26, FENCE) },
      "Neighbours: (39, 27) can't be reached from the gate",
    ],
  ];

  it('accepts the shipped definition', () => {
    expect(() => assertNeighboursLayout(def)).not.toThrow();
    expect(() => assertMapDefinitions(MAPS)).not.toThrow();
  });

  it.each(broken)('throws on %s', (_name, broken, message) => {
    expect(() => assertNeighboursLayout(broken)).toThrow(new RangeError(message));
    // The whole startup check fails too (two overlapping structures trip assertStructures first).
    expect(() => assertMapDefinitions({ ...MAPS, neighbours: broken })).toThrow(RangeError);
  });
});

describe('overnight', () => {
  it('leaves the map exactly as it was, night after night, rain or shine and across a season', () => {
    let state = withPlayer(atDay(BASE, 20), { tx: 1, tz: 14 }, Direction.East, 'neighbours');
    const map = state.maps.neighbours;
    state = gameReducer(state, actions.sleep());
    expect(state.player.mapId).toBe('farm');
    expect(state.maps.neighbours).toBe(map);
    for (let night = 0; night < 30; night++) {
      state = startNextDay(state, false);
      expect(state.maps.neighbours, `night ${night}`).toBe(map);
    }
  });
});

describe("the neighbours' fences", () => {
  // Standing on the lane, facing Cosmo's fence just west of his gate.
  const atFence = withPlayer(BASE, { tx: 5, tz: 13 }, Direction.North, 'neighbours');
  const FENCE_AT = { tx: 5, tz: 12 };

  it('refuse the pickaxe and the axe with "That belongs to the neighbours."', () => {
    for (const tool of ['pickaxe', 'axe'] as const) {
      const holdingTool = holding(atFence, tool);
      expect(planPrimaryAction(holdingTool).intent).toEqual({ kind: 'blocked', reason: 'That belongs to the neighbours.' });
      const next = gameReducer(holdingTool, actions.useTool());
      expect(lastText(next)).toBe('That belongs to the neighbours.');
      expect(tileAt(next, FENCE_AT, 'neighbours')).toBe(tileAt(atFence, FENCE_AT, 'neighbours'));
      expect(count(next, 'woodFence')).toBe(count(atFence, 'woodFence'));
    }
  });

  it("let the axe lift a fence the player put down off the neighbours' rings", () => {
    const own = withTile(withPlayer(BASE, { tx: 15, tz: 8 }, Direction.North, 'neighbours'), { tx: 15, tz: 7 }, FENCE, 'neighbours');
    expect(planPrimaryAction(holding(own, 'axe')).intent).toEqual({ kind: 'pickUp', itemId: 'woodFence' });
  });
});
