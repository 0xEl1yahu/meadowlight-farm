/**
 * Pure layout rules of the ObjectRenderer (src/render/objectLayout.ts, spec §7.3):
 * - a giant crop draws once, at its anchor, and its covered tiles are skipped;
 * - a changed object is a placement only when the key showed nothing or another kind, so chest
 *   deposits and forage spawn-day changes rewrite nothing and never pop;
 * - fence rails connect fence neighbours, keyed by edge, and a change at a tile recomputes exactly
 *   the four rails that touch it.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { INVENTORY, WORKBENCH } from '../src/config';
import {
  Direction,
  PLACED_OBJECT_KINDS,
  TileState,
  type GameState,
  type PlacedObject,
  type PlacedObjectKind,
  type Tile,
  type TileCoord,
  type WorldState,
} from '../src/core/types';
import { CROPS } from '../src/farming/crops';
import { HEIGHTS } from '../src/render/constants';
import {
  CHEST_SHAPE,
  FORAGE_LOOKS,
  GIANT_PRODUCE,
  OBJECT_PARTS,
  OBJECT_PART_IDS,
  objectPartsFor,
  type ObjectPartId,
} from '../src/render/objectGeometry';
import { ObjectRenderer } from '../src/render/ObjectRenderer';
import type { SceneContext } from '../src/render/SceneContext';
import type { FrameContext } from '../src/render/types';
import { selectActiveWorld } from '../src/state/selectors';
import {
  OBJECT_MOTION,
  RAIL_SIDE,
  STONE_PATH_VARIANTS,
  approachLid,
  classifyObjectChange,
  drawnObject,
  drawsAt,
  fenceEdgesAround,
  fenceRailKey,
  hasFenceRail,
  objectGroundHeight,
  objectLook,
  openChestTile,
  popScale,
  railNeighbour,
  stonePathVariant,
  type FenceEdge,
  type ObjectLook,
} from '../src/render/objectLayout';
import { createGridSpec, tileIndex } from '../src/world/grid';
import {
  EMPTY_TILE,
  GIANT_CROP_SIZE,
  assertWorldObjectsConsistent,
  createWorld,
  forEachTile,
  setTiles,
  type TileEdit,
} from '../src/world/tiles';
import { BASE, must, soilTile, stack, withPlayer, withTile } from './testUtils';

const GRID = createGridSpec(8, 6, 4);
const FENCE: PlacedObject = { kind: 'woodFence' };

function objectTile(object: PlacedObject): Tile {
  return { ...EMPTY_TILE, object };
}

function emptyChest(): PlacedObject {
  return { kind: 'chest', slots: Array.from({ length: INVENTORY.chestSlots }, () => null) };
}

const SAMPLES: Readonly<Record<PlacedObjectKind, PlacedObject>> = {
  chest: emptyChest(),
  sprinkler: { kind: 'sprinkler' },
  qualitySprinkler: { kind: 'qualitySprinkler' },
  woodBurner: { kind: 'woodBurner', fuel: 0 },
  scarecrow: { kind: 'scarecrow' },
  woodFence: FENCE,
  woodPath: { kind: 'woodPath' },
  stonePath: { kind: 'stonePath' },
  giantCrop: { kind: 'giantCrop', cropId: 'melon', anchorTx: 2, anchorTz: 1 },
  forage: { kind: 'forage', itemId: 'hazelnut', spawnDay: 3 },
  trophy: { kind: 'trophy', festival: 'harvestFair', year: 1 },
  decoration: { kind: 'decoration', variant: 'stoneLantern' },
  workbench: { kind: 'workbench' },
};

/** A small world with `objects` placed at the given tiles. */
function worldWith(objects: readonly (readonly [number, number, PlacedObject])[]): WorldState {
  const edits: TileEdit[] = objects.map(([tx, tz, object]) => ({ tx, tz, tile: objectTile(object) }));
  return setTiles(createWorld(GRID, () => EMPTY_TILE), edits);
}

/** The 3×3 giant crop anchored at (ax, az). */
function giantCropAt(ax: number, az: number): (readonly [number, number, PlacedObject])[] {
  const object: PlacedObject = { kind: 'giantCrop', cropId: 'pumpkin', anchorTx: ax, anchorTz: az };
  const tiles: (readonly [number, number, PlacedObject])[] = [];
  for (let dz = 0; dz < GIANT_CROP_SIZE; dz++) {
    for (let dx = 0; dx < GIANT_CROP_SIZE; dx++) tiles.push([ax + dx, az + dz, object]);
  }
  return tiles;
}

function edgeKeys(edges: readonly FenceEdge[]): string[] {
  return edges.map((e) => `${e.tx},${e.tz},${e.side === RAIL_SIDE.east ? 'E' : 'S'}`).sort();
}

describe('giant crop anchor skipping', () => {
  it('draws a giant crop once, at its anchor, and skips the eight covered tiles', () => {
    const world = worldWith(giantCropAt(2, 1));
    assertWorldObjectsConsistent(world);
    const drawn: string[] = [];
    let covered = 0;
    forEachTile(world, (tile, tx, tz) => {
      if (tile.object !== null) covered++;
      if (drawnObject(tile, tx, tz) !== null) drawn.push(`${tx},${tz}`);
    });
    expect(covered).toBe(GIANT_CROP_SIZE * GIANT_CROP_SIZE);
    expect(drawn).toEqual(['2,1']);
  });

  it('draws every other kind on its own tile', () => {
    for (const kind of PLACED_OBJECT_KINDS) {
      if (kind === 'giantCrop') continue;
      expect(drawsAt(SAMPLES[kind], 5, 4), kind).toBe(true);
      expect(drawnObject(objectTile(SAMPLES[kind]), 5, 4), kind).toBe(SAMPLES[kind]);
    }
    expect(drawnObject(EMPTY_TILE, 0, 0)).toBeNull();
  });

  it('only the anchor corner counts, never the other corners of the footprint', () => {
    const giant = SAMPLES.giantCrop;
    expect(drawsAt(giant, 2, 1)).toBe(true);
    for (const [tx, tz] of [
      [4, 1],
      [2, 3],
      [4, 3],
      [3, 2],
    ] as const) {
      expect(drawsAt(giant, tx, tz), `${tx},${tz}`).toBe(false);
    }
  });
});

describe('placement versus update', () => {
  it('places a new object on an empty key and removes a vanished one', () => {
    const chest = objectLook(emptyChest());
    expect(classifyObjectChange(undefined, chest)).toBe('place');
    expect(classifyObjectChange(chest, null)).toBe('remove');
    expect(classifyObjectChange(undefined, null)).toBe('none');
  });

  it('treats a chest deposit or withdrawal as no change at all (no rewrite, no pop)', () => {
    const empty = emptyChest();
    const filled: PlacedObject = { kind: 'chest', slots: [stack('parsnip', 5, 2), ...Array.from({ length: INVENTORY.chestSlots - 1 }, () => null)] };
    expect(empty).not.toBe(filled);
    expect(classifyObjectChange(objectLook(empty), objectLook(filled))).toBe('none');
    expect(objectLook(empty)).toEqual(objectLook(filled));
  });

  it('ignores a forage spawn-day change but updates a different forage in place', () => {
    const leek: PlacedObject = { kind: 'forage', itemId: 'wildLeek', spawnDay: 3 };
    const laterLeek: PlacedObject = { kind: 'forage', itemId: 'wildLeek', spawnDay: 9 };
    const holly: PlacedObject = { kind: 'forage', itemId: 'holly', spawnDay: 9 };
    expect(classifyObjectChange(objectLook(leek), objectLook(laterLeek))).toBe('none');
    expect(classifyObjectChange(objectLook(leek), objectLook(holly))).toBe('update');
  });

  it('updates in place when a trophy, decoration or giant crop changes its look but keeps its kind', () => {
    const pairs: readonly (readonly [PlacedObject, PlacedObject])[] = [
      [
        { kind: 'trophy', festival: 'harvestFair', year: 1 },
        { kind: 'trophy', festival: 'starfallFeast', year: 1 },
      ],
      [
        { kind: 'decoration', variant: 'paperLantern' },
        { kind: 'decoration', variant: 'flowerArch' },
      ],
      [
        { kind: 'giantCrop', cropId: 'melon', anchorTx: 0, anchorTz: 0 },
        { kind: 'giantCrop', cropId: 'cauliflower', anchorTx: 0, anchorTz: 0 },
      ],
    ];
    for (const [before, after] of pairs) {
      expect(classifyObjectChange(objectLook(before), objectLook(after)), before.kind).toBe('update');
    }
    const trophyNextYear: PlacedObject = { kind: 'trophy', festival: 'harvestFair', year: 2 };
    expect(classifyObjectChange(objectLook({ kind: 'trophy', festival: 'harvestFair', year: 1 }), objectLook(trophyNextYear))).toBe('none');
  });

  it('places again whenever the kind changes, for every pair of kinds', () => {
    for (const a of PLACED_OBJECT_KINDS) {
      for (const b of PLACED_OBJECT_KINDS) {
        const change = classifyObjectChange(objectLook(SAMPLES[a]), objectLook(SAMPLES[b]));
        expect(change, `${a} -> ${b}`).toBe(a === b ? 'none' : 'place');
      }
    }
  });

  it('gives every kind a look naming that kind', () => {
    for (const kind of PLACED_OBJECT_KINDS) {
      const look: ObjectLook = objectLook(SAMPLES[kind]);
      expect(look.kind).toBe(kind);
    }
  });
});

describe('fence rails', () => {
  it('recomputes the east and south rails of the tile and the rails leading into it', () => {
    expect(edgeKeys(fenceEdgesAround(GRID, 3, 2))).toEqual(['2,2,E', '3,1,S', '3,2,E', '3,2,S']);
  });

  it('keeps only edges inside the grid at the corners', () => {
    expect(edgeKeys(fenceEdgesAround(GRID, 0, 0))).toEqual(['0,0,E', '0,0,S']);
    expect(edgeKeys(fenceEdgesAround(GRID, GRID.width - 1, GRID.depth - 1))).toEqual([
      `${GRID.width - 2},${GRID.depth - 1},E`,
      `${GRID.width - 1},${GRID.depth - 2},S`,
    ]);
  });

  it('keys each edge uniquely as tileIndex * 2 + side', () => {
    const keys = new Set<number>();
    for (let tz = 0; tz < GRID.depth; tz++) {
      for (let tx = 0; tx < GRID.width; tx++) {
        for (const edge of fenceEdgesAround(GRID, tx, tz)) {
          const key = fenceRailKey(GRID, edge);
          expect(key).toBe(tileIndex(GRID, edge.tx, edge.tz) * 2 + edge.side);
          expect(key).toBeLessThan(GRID.width * GRID.depth * 2);
          keys.add(key);
        }
      }
    }
    // Every horizontal and vertical interior edge exactly once.
    expect(keys.size).toBe((GRID.width - 1) * GRID.depth + GRID.width * (GRID.depth - 1));
  });

  it('connects neighbouring fences only', () => {
    const world = worldWith([
      [1, 1, FENCE],
      [2, 1, FENCE],
      [2, 2, FENCE],
      [3, 2, SAMPLES.chest],
      [1, 2, SAMPLES.woodPath],
    ]);
    expect(hasFenceRail(world, { tx: 1, tz: 1, side: RAIL_SIDE.east })).toBe(true);
    expect(hasFenceRail(world, { tx: 2, tz: 1, side: RAIL_SIDE.south })).toBe(true);
    expect(hasFenceRail(world, { tx: 1, tz: 1, side: RAIL_SIDE.south })).toBe(false);
    expect(hasFenceRail(world, { tx: 2, tz: 2, side: RAIL_SIDE.east })).toBe(false);
    expect(hasFenceRail(world, { tx: 0, tz: 1, side: RAIL_SIDE.east })).toBe(false);
    expect(railNeighbour({ tx: 1, tz: 1, side: RAIL_SIDE.east })).toEqual({ tx: 2, tz: 1 });
    expect(railNeighbour({ tx: 1, tz: 1, side: RAIL_SIDE.south })).toEqual({ tx: 1, tz: 2 });
  });

  it('finds every rail that changes when a fence is placed or removed among the edges around it', () => {
    const fences: [number, number][] = [
      [1, 1],
      [2, 1],
      [3, 1],
      [2, 0],
      [2, 2],
      [5, 4],
    ];
    const edgesOf = (world: WorldState): Set<number> => {
      const keys = new Set<number>();
      for (let tz = 0; tz < GRID.depth; tz++) {
        for (let tx = 0; tx < GRID.width; tx++) {
          for (const edge of fenceEdgesAround(GRID, tx, tz)) if (hasFenceRail(world, edge)) keys.add(fenceRailKey(GRID, edge));
        }
      }
      return keys;
    };
    const full = worldWith(fences.map(([tx, tz]) => [tx, tz, FENCE] as const));
    for (const [rx, rz] of fences) {
      const without = worldWith(fences.filter(([tx, tz]) => tx !== rx || tz !== rz).map(([tx, tz]) => [tx, tz, FENCE] as const));
      const before = edgesOf(full);
      const after = edgesOf(without);
      const changed = [...before].filter((k) => !after.has(k)).concat([...after].filter((k) => !before.has(k)));
      const around = new Set(fenceEdgesAround(GRID, rx, rz).map((edge) => fenceRailKey(GRID, edge)));
      for (const key of changed) expect(around.has(key), `rail ${key} after removing (${rx}, ${rz})`).toBe(true);
    }
    // The centre fence of the plus sign has four rails; the lone fence has none.
    expect(edgesOf(full).size).toBe(4);
  });
});

describe('stone path variants', () => {
  it('is deterministic, in range, varied, and shifted by the map offset', () => {
    const seen = new Set<number>();
    let differs = 0;
    for (let tz = 0; tz < 12; tz++) {
      for (let tx = 0; tx < 12; tx++) {
        const variant = stonePathVariant(tx, tz, 0, 0);
        expect(variant).toBe(stonePathVariant(tx, tz, 0, 0));
        expect(Number.isInteger(variant) && variant >= 0 && variant < STONE_PATH_VARIANTS).toBe(true);
        seen.add(variant);
        if (stonePathVariant(tx, tz, 97, 41) !== variant) differs++;
      }
    }
    expect(seen.size).toBe(STONE_PATH_VARIANTS);
    expect(differs).toBeGreaterThan(20);
  });
});

describe('object ground', () => {
  it('stands an object on sunken soil or on grass', () => {
    expect(objectGroundHeight(objectTile(SAMPLES.woodPath))).toBe(HEIGHTS.grassTop);
    expect(objectGroundHeight({ ...soilTile(TileState.Plowed), object: SAMPLES.sprinkler })).toBe(HEIGHTS.soilTop);
    expect(objectGroundHeight({ ...soilTile(TileState.Watered), object: SAMPLES.qualitySprinkler })).toBe(HEIGHTS.soilTop);
  });
});

describe('motion', () => {
  it('pops in from almost nothing with a gentle overshoot and lands exactly on 1', () => {
    expect(popScale(0)).toBe(OBJECT_MOTION.minScale);
    expect(popScale(1)).toBe(1);
    expect(popScale(2)).toBe(1);
    let peak = 0;
    for (let i = 1; i < 100; i++) {
      const scale = popScale(i / 100);
      expect(scale).toBeGreaterThan(0);
      peak = Math.max(peak, scale);
    }
    expect(peak).toBeGreaterThan(1.02);
    expect(peak).toBeLessThan(1.15);
  });

  it('eases the lid toward its target and snaps once close', () => {
    let lid = 0;
    let frames = 0;
    while (lid !== 1 && frames < 200) {
      const next = approachLid(lid, 1, 1 / 60);
      expect(next).toBeGreaterThan(lid);
      lid = next;
      frames++;
    }
    expect(lid).toBe(1);
    expect(frames).toBeLessThan(60);
    expect(approachLid(1, 1, 1 / 60)).toBe(1);
    expect(approachLid(0.5, 0, 1)).toBeLessThan(0.5);
  });

  it('opens only the chest of a chest panel on the given map', () => {
    const panel = { kind: 'chest', mapId: 'forest', tx: 3, tz: 4 } as const;
    const open: GameState = { ...BASE, ui: { ...BASE.ui, panel } };
    expect(openChestTile(open, 'forest')).toEqual({ tx: 3, tz: 4 });
    expect(openChestTile(open, 'farm')).toBeNull();
    expect(openChestTile({ ...BASE, ui: { ...BASE.ui, panel: { kind: 'inventory' } } }, 'farm')).toBeNull();
  });
});

describe('object geometry tables', () => {
  it('has a part for every kind, and every part belongs to its kind', () => {
    for (const kind of PLACED_OBJECT_KINDS) {
      const parts = objectPartsFor(SAMPLES[kind], 0);
      expect(parts.length, kind).toBeGreaterThan(0);
      for (const id of parts) expect(OBJECT_PARTS[id].kind, id).toBe(kind);
    }
  });

  it('matches every giant crop with its crop produce form and every stone variant with a part', () => {
    for (const [cropId, form] of Object.entries(GIANT_PRODUCE)) {
      expect(CROPS[cropId as keyof typeof GIANT_PRODUCE].visual.produce, cropId).toBe(form);
    }
    const variants = new Set<ObjectPartId>();
    for (let v = 0; v < STONE_PATH_VARIANTS; v++) for (const id of objectPartsFor(SAMPLES.stonePath, v)) variants.add(id);
    expect(variants.size).toBe(STONE_PATH_VARIANTS);
  });

  it('gives every forage item a colour and a form with its own part', () => {
    const forms = new Set(Object.values(FORAGE_LOOKS).map((look) => look.form));
    expect(forms.size).toBe(7);
    for (const [itemId, look] of Object.entries(FORAGE_LOOKS)) {
      const parts = objectPartsFor({ kind: 'forage', itemId: itemId as keyof typeof FORAGE_LOOKS, spawnDay: 1 }, 0);
      expect(parts, itemId).toContain('foragePlant');
      expect(Number.isInteger(look.color)).toBe(true);
    }
  });

  it('builds every part flat-shaded, standing on the ground inside its footprint; paths are flush and cast no shadow', () => {
    for (const id of OBJECT_PART_IDS) {
      const spec = OBJECT_PARTS[id];
      const geometry = spec.build();
      expect(geometry.index, id).toBeNull();
      expect(geometry.hasAttribute('normal'), id).toBe(true);
      expect(geometry.hasAttribute('color'), id).toBe(spec.material !== 'glass');
      expect(geometry.hasAttribute('tintMask'), id).toBe(spec.material === 'plant');
      // The lid is authored around its hinge; measure it closed, in chest space.
      if (id === 'chestLid') geometry.translate(0, CHEST_SHAPE.hingeY, CHEST_SHAPE.hingeZ);
      geometry.computeBoundingBox();
      const box = geometry.boundingBox ?? new THREE.Box3();
      const half = spec.kind === 'giantCrop' ? 1.5 : id === 'fenceRail' ? 1 : 0.5;
      // Roots are half-buried, like the crops' ground produce; everything else stands on the ground.
      expect(box.min.y, id).toBeGreaterThanOrEqual(id === 'forageRoot' ? -0.08 : -0.035);
      expect(Math.max(-box.min.x, box.max.x, -box.min.z, box.max.z), id).toBeLessThanOrEqual(half + 1e-6);
      if (spec.kind === 'woodPath' || spec.kind === 'stonePath') {
        expect(box.max.y, id).toBeLessThanOrEqual(HEIGHTS.pathTop + 0.01);
        expect(spec.castShadow, id).toBe(false);
      }
      geometry.dispose();
    }
  });

  it('hinges the chest lid on the body so the closed lid sits on it', () => {
    expect(CHEST_SHAPE.hingeY).toBe(CHEST_SHAPE.height);
    expect(CHEST_SHAPE.hingeZ).toBeLessThanOrEqual(-CHEST_SHAPE.depth / 2);
  });
});

// ---------------------------------------------------------------------------
// The renderer's diff, in node (three's math needs no WebGL context)
// ---------------------------------------------------------------------------

describe('ObjectRenderer', () => {
  /** The new farm without its workbench, so each test counts only the objects it places. */
  const FARM = withTile(BASE, WORKBENCH.home, EMPTY_TILE, 'farm');
  const FARM_GRID = selectActiveWorld(FARM).grid;
  const scratch = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const rotation = new THREE.Quaternion();

  function frame(state: GameState, dt: number): FrameContext {
    return { dt, elapsed: 1, state, clockMinutes: 600 };
  }

  function setup(state: GameState): { scene: THREE.Scene; renderer: ObjectRenderer } {
    const scene = new THREE.Scene();
    const renderer = new ObjectRenderer({ scene, grid: selectActiveWorld(state).grid } as unknown as SceneContext);
    renderer.sync(state, null);
    return { scene, renderer };
  }

  function mesh(scene: THREE.Scene, id: ObjectPartId): THREE.InstancedMesh {
    const found = scene.getObjectByName(`object-${id}`);
    if (!(found instanceof THREE.InstancedMesh)) throw new Error(`no mesh for ${id}`);
    return found;
  }

  /** Instance count of every part in use. */
  function counts(scene: THREE.Scene): Partial<Record<ObjectPartId, number>> {
    const result: Partial<Record<ObjectPartId, number>> = {};
    for (const id of OBJECT_PART_IDS) {
      const m = mesh(scene, id);
      expect(m.visible, id).toBe(m.count > 0);
      if (m.count > 0) result[id] = m.count;
    }
    return result;
  }

  /** Position and uniform scale of instance `slot` of a part. */
  function pose(scene: THREE.Scene, id: ObjectPartId, slot = 0): { x: number; y: number; z: number; s: number } {
    mesh(scene, id).getMatrixAt(slot, scratch);
    scratch.decompose(position, rotation, scale);
    return { x: position.x, y: position.y, z: position.z, s: scale.x };
  }

  function settle(renderer: ObjectRenderer, state: GameState): void {
    for (let i = 0; i < 90; i++) renderer.update(frame(state, 1 / 30));
  }

  function place(state: GameState, coord: TileCoord, object: PlacedObject | null, base: Tile = EMPTY_TILE): GameState {
    return withTile(state, coord, { ...base, object });
  }

  function placeAll(state: GameState, objects: readonly (readonly [number, number, PlacedObject])[]): GameState {
    return objects.reduce((s, [tx, tz, object]) => place(s, { tx, tz }, object), state);
  }

  const A: TileCoord = { tx: 9, tz: 13 };
  const GIANT_ANCHOR: TileCoord = { tx: 14, tz: 14 };

  const EVERY_KIND: readonly (readonly [number, number, PlacedObject])[] = [
    [8, 12, SAMPLES.chest],
    [9, 12, SAMPLES.sprinkler],
    [10, 12, SAMPLES.qualitySprinkler],
    [11, 12, SAMPLES.scarecrow],
    [12, 12, SAMPLES.woodFence],
    [13, 12, SAMPLES.woodPath],
    [14, 12, SAMPLES.stonePath],
    [8, 14, SAMPLES.forage],
    [9, 14, SAMPLES.trophy],
    [10, 14, SAMPLES.decoration],
    ...giantCropAt(GIANT_ANCHOR.tx, GIANT_ANCHOR.tz),
  ];

  it('draws every kind with one mesh per part in use, at rest, and hides the other parts', () => {
    const state = placeAll(FARM, EVERY_KIND);
    const { scene } = setup(state);
    const expected: Partial<Record<ObjectPartId, number>> = {};
    for (const [tx, tz, object] of EVERY_KIND) {
      if (!drawsAt(object, tx, tz)) continue;
      for (const id of objectPartsFor(object, stonePathVariant(tx, tz, 0, 0))) expected[id] = (expected[id] ?? 0) + 1;
    }
    expect(counts(scene)).toEqual(expected);
    expect(pose(scene, 'sprinkler').s).toBeCloseTo(FARM_GRID.tileSize, 6);
    // A giant crop draws once, centred on its 3×3 footprint.
    const gourd = pose(scene, 'giantGourd');
    expect(expected.giantGourd).toBe(1);
    expect(gourd.x).toBeCloseTo(FARM_GRID.originX + (GIANT_ANCHOR.tx + 1.5) * FARM_GRID.tileSize, 6);
    expect(gourd.z).toBeCloseTo(FARM_GRID.originZ + (GIANT_ANCHOR.tz + 1.5) * FARM_GRID.tileSize, 6);
    expect(GIANT_PRODUCE.pumpkin).toBe('gourd');
  });

  it('removes a giant crop from all nine tiles at once', () => {
    const state = placeAll(FARM, giantCropAt(GIANT_ANCHOR.tx, GIANT_ANCHOR.tz));
    const { scene, renderer } = setup(state);
    expect(counts(scene)).toEqual({ giantLeaves: 1, giantGourd: 1 });
    const footprint = giantCropAt(GIANT_ANCHOR.tx, GIANT_ANCHOR.tz);
    const empty = footprint.reduce((s, [tx, tz]) => place(s, { tx, tz }, null), state);
    renderer.sync(empty, state);
    expect(counts(scene)).toEqual({});
    // Every former covered tile can hold its own object afterwards.
    const sprinklers = placeAll(empty, footprint.map(([tx, tz]) => [tx, tz, SAMPLES.sprinkler] as const));
    renderer.sync(sprinklers, empty);
    expect(counts(scene)).toEqual({ sprinkler: 9 });
  });

  it('pops a newly placed object in, then settles at full scale', () => {
    const { scene, renderer } = setup(FARM);
    const next = place(FARM, A, SAMPLES.sprinkler);
    renderer.sync(next, FARM);
    expect(pose(scene, 'sprinkler').s).toBeLessThan(0.01);
    renderer.update(frame(next, OBJECT_MOTION.popSeconds / 2));
    expect(pose(scene, 'sprinkler').s).toBeGreaterThan(0.5);
    settle(renderer, next);
    expect(pose(scene, 'sprinkler').s).toBeCloseTo(FARM_GRID.tileSize, 6);
  });

  it('replaces an object of another kind with a pop, touching only the old kind', () => {
    const chest = place(FARM, A, SAMPLES.chest);
    const { scene, renderer } = setup(chest);
    const next = place(chest, A, SAMPLES.scarecrow);
    renderer.sync(next, chest);
    expect(counts(scene)).toEqual({ scarecrowFrame: 1, scarecrowShirt: 1 });
    expect(pose(scene, 'scarecrowFrame').s).toBeLessThan(0.01);
  });

  it('never rewrites a chest when only its slots change, and keeps its lid open meanwhile', () => {
    const closed = place(FARM, A, SAMPLES.chest);
    const { scene, renderer } = setup(closed);
    const lid = mesh(scene, 'chestLid');
    const body = mesh(scene, 'chestBody');
    const closedLid = new THREE.Matrix4();
    lid.getMatrixAt(0, closedLid);

    const open: GameState = { ...closed, ui: { ...closed.ui, panel: { kind: 'chest', mapId: 'farm', ...A } } };
    renderer.sync(open, closed);
    settle(renderer, open);
    const openLid = new THREE.Matrix4();
    lid.getMatrixAt(0, openLid);
    expect(openLid.equals(closedLid)).toBe(false);
    // The open lid's front edge has swung up above the body.
    const front = new THREE.Vector3(0, 0, CHEST_SHAPE.depth).applyMatrix4(openLid);
    expect(front.y).toBeGreaterThan(pose(scene, 'chestBody').y + CHEST_SHAPE.height + 0.2);

    const bodyVersion = body.instanceMatrix.version;
    const lidVersion = lid.instanceMatrix.version;
    const deposited: PlacedObject = { kind: 'chest', slots: [stack('parsnip', 3, 1), ...Array.from({ length: INVENTORY.chestSlots - 1 }, () => null)] };
    const afterDeposit = place(open, A, deposited);
    renderer.sync(afterDeposit, open);
    settle(renderer, afterDeposit);
    expect(body.instanceMatrix.version).toBe(bodyVersion);
    expect(lid.instanceMatrix.version).toBe(lidVersion);
    const stillOpen = new THREE.Matrix4();
    lid.getMatrixAt(0, stillOpen);
    expect(stillOpen.equals(openLid)).toBe(true);

    const shut: GameState = { ...afterDeposit, ui: { ...afterDeposit.ui, panel: { kind: 'none' } } };
    renderer.sync(shut, afterDeposit);
    settle(renderer, shut);
    const shutLid = new THREE.Matrix4();
    lid.getMatrixAt(0, shutLid);
    expect(shutLid.equals(closedLid)).toBe(true);
  });

  it('ignores a forage spawn-day change and swaps a new forage in place without a pop', () => {
    const leek = place(FARM, A, { kind: 'forage', itemId: 'wildLeek', spawnDay: 2 });
    const { scene, renderer } = setup(leek);
    expect(counts(scene)).toEqual({ foragePlant: 1, forageSprig: 1 });
    const version = mesh(scene, 'forageSprig').instanceMatrix.version;
    const later = place(leek, A, { kind: 'forage', itemId: 'wildLeek', spawnDay: 7 });
    renderer.sync(later, leek);
    expect(mesh(scene, 'forageSprig').instanceMatrix.version).toBe(version);

    const holly = place(later, A, { kind: 'forage', itemId: 'holly', spawnDay: 7 });
    renderer.sync(holly, later);
    expect(counts(scene)).toEqual({ foragePlant: 1, forageHolly: 1 });
    expect(pose(scene, 'forageHolly').s).toBeCloseTo(FARM_GRID.tileSize, 6);
    const tint = new THREE.Color();
    mesh(scene, 'forageHolly').getColorAt(0, tint);
    expect(tint.getHex()).toBe(new THREE.Color(FORAGE_LOOKS.holly.color).getHex());
  });

  it('connects neighbouring fences with rails, keyed by edge, and drops them with a fence', () => {
    const fences: readonly (readonly [number, number, PlacedObject])[] = [
      [8, 12, FENCE],
      [9, 12, FENCE],
      [10, 12, FENCE],
      [9, 13, FENCE],
    ];
    const state = placeAll(FARM, fences);
    const { scene, renderer } = setup(state);
    expect(counts(scene)).toEqual({ fencePost: 4, fenceRail: 3 });
    const south = new THREE.Matrix4();
    const southEnds: number[] = [];
    for (let slot = 0; slot < 3; slot++) {
      mesh(scene, 'fenceRail').getMatrixAt(slot, south);
      const start = new THREE.Vector3(0, 0, 0).applyMatrix4(south);
      const end = new THREE.Vector3(1, 0, 0).applyMatrix4(south);
      expect(Math.hypot(end.x - start.x, end.z - start.z)).toBeCloseTo(FARM_GRID.tileSize, 6);
      if (Math.abs(end.x - start.x) < 1e-6) southEnds.push(end.z - start.z);
    }
    expect(southEnds).toEqual([FARM_GRID.tileSize]);

    const gap = place(state, { tx: 9, tz: 12 }, null);
    renderer.sync(gap, state);
    expect(counts(scene)).toEqual({ fencePost: 3 });
    renderer.sync(state, gap);
    expect(counts(scene)).toEqual({ fencePost: 4, fenceRail: 3 });
    expect(pose(scene, 'fenceRail', 0).s).toBeLessThan(0.01);
    settle(renderer, state);
    expect(pose(scene, 'fenceRail', 2).s).toBeCloseTo(FARM_GRID.tileSize, 6);
  });

  it('follows the ground when soil under an unchanged sprinkler turns back to grass', () => {
    const onSoil = place(FARM, A, SAMPLES.sprinkler, soilTile(TileState.Plowed));
    const { scene, renderer } = setup(onSoil);
    expect(pose(scene, 'sprinkler').y).toBeCloseTo(HEIGHTS.soilTop, 6);
    const tile = must(selectActiveWorld(onSoil).chunks.flatMap((c) => c.tiles).find((t) => t.object === SAMPLES.sprinkler));
    const grass = withTile(onSoil, A, { ...tile, state: TileState.Unplowed });
    renderer.sync(grass, onSoil);
    expect(pose(scene, 'sprinkler').y).toBeCloseTo(HEIGHTS.grassTop, 6);
    expect(pose(scene, 'sprinkler').s).toBeCloseTo(FARM_GRID.tileSize, 6);
  });

  it('rebuilds on a map change and shows only the active map', () => {
    const farm = place(FARM, A, SAMPLES.chest);
    const forestObjects = withTile(farm, { tx: 10, tz: 10 }, objectTile(SAMPLES.trophy), 'forest');
    const inForest = withPlayer(forestObjects, { tx: 34, tz: 15 }, Direction.West, 'forest');
    const { scene, renderer } = setup(forestObjects);
    expect(counts(scene)).toEqual({ chestBody: 1, chestLid: 1 });
    renderer.sync(inForest, null);
    expect(counts(scene)).toEqual({ trophy: 1, trophyRibbon: 1 });
    expect(pose(scene, 'trophy').s).toBeCloseTo(selectActiveWorld(inForest).grid.tileSize, 6);
    renderer.sync(forestObjects, null);
    expect(counts(scene)).toEqual({ chestBody: 1, chestLid: 1 });
    renderer.dispose();
    expect(scene.getObjectByName('object-chestBody')).toBeUndefined();
  });
});
