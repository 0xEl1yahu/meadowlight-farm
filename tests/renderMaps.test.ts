/**
 * Pure, map-aware render helpers from Phase 0 step 3 (spec §7.2):
 * - forest trees stay small enough not to bury the floor (height ≤ 1.5, canopy radius ≤ 0.55 tile);
 * - the highlight box checks a placed object first, treats paths as ground, and has heights for
 *   Tree, Weeds and Building tiles;
 * - the player stands on path planks;
 * - rain splashes land on path planks and never on a blocking placed object;
 * - meadow tufts and flowers step aside for placed objects.
 * three's geometry math runs in node without a WebGL context.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { WORLD } from '../src/config';
import { Blocker, PLACED_OBJECT_KINDS, TileState, type PlacedObject, type Tile } from '../src/core/types';
import { HEIGHTS } from '../src/render/constants';
import { TINT_MASK_ATTRIBUTE } from '../src/render/materials';
import {
  BLOB_LIFT,
  playerBlobLocalHeight,
  playerGroundHeight,
  playerRootHeight,
} from '../src/render/PlayerRenderer';
import { createTreeGeometry, TREE_SHAPES, type TreeSpecies } from '../src/render/structureGeometry';
import type { SceneContext } from '../src/render/SceneContext';
import { TREE, TerrainRenderer } from '../src/render/TerrainRenderer';
import { createWeedsGeometry } from '../src/render/terrainGeometry';
import { highlightBoxHeight, highlightGroundHeight } from '../src/render/TileHighlighter';
import { splashSurfaceHeight } from '../src/render/WeatherRenderer';
import { selectActiveWorld } from '../src/state/selectors';
import { EMPTY_TILE, blockedTile, forEachTile } from '../src/world/tiles';
import { BASE, withTile } from './testUtils';

const SPECIES = Object.keys(TREE_SHAPES) as TreeSpecies[];

function objectTile(object: PlacedObject): Tile {
  return { ...EMPTY_TILE, object };
}

const SAMPLE_OBJECTS: Readonly<Record<PlacedObject['kind'], PlacedObject>> = {
  chest: { kind: 'chest', slots: [] },
  sprinkler: { kind: 'sprinkler' },
  qualitySprinkler: { kind: 'qualitySprinkler' },
  woodBurner: { kind: 'woodBurner', fuel: 0 },
  scarecrow: { kind: 'scarecrow' },
  woodFence: { kind: 'woodFence' },
  woodPath: { kind: 'woodPath' },
  stonePath: { kind: 'stonePath' },
  giantCrop: { kind: 'giantCrop', cropId: 'pumpkin', anchorTx: 0, anchorTz: 0 },
  forage: { kind: 'forage', itemId: 'wildLeek', spawnDay: 1 },
  trophy: { kind: 'trophy', festival: 'harvestFair', year: 1 },
  decoration: { kind: 'decoration', variant: 'paperLantern' },
};

describe('forest tree geometry', () => {
  it.each(SPECIES)('%s: at the largest render scale it is ≤ 1.5 tall with a canopy radius ≤ 0.55 tile', (species) => {
    const geometry = createTreeGeometry(species);
    geometry.computeBoundingBox();
    const box = geometry.boundingBox ?? new THREE.Box3();
    const scale = TREE.scale * WORLD.tileSize;
    expect(box.min.y).toBeGreaterThanOrEqual(-1e-6);
    expect(box.max.y * scale).toBeLessThanOrEqual(1.5);
    const position = geometry.getAttribute('position');
    let radius = 0;
    for (let i = 0; i < position.count; i++) radius = Math.max(radius, Math.hypot(position.getX(i), position.getZ(i)));
    expect((radius * scale) / WORLD.tileSize).toBeLessThanOrEqual(0.55);
    geometry.dispose();
  });

  it.each(SPECIES)('%s: the trunk keeps its colour and only the canopy takes the tint', (species) => {
    const geometry = createTreeGeometry(species);
    const mask = geometry.getAttribute(TINT_MASK_ATTRIBUTE);
    const position = geometry.getAttribute('position');
    expect(mask.count).toBe(position.count);
    const values = new Set<number>();
    for (let i = 0; i < mask.count; i++) values.add(mask.getX(i));
    expect([...values].sort()).toEqual([0, 1]);
    // Every untinted (trunk) vertex sits below the canopy top; every tinted one above the canopy base.
    const shape = TREE_SHAPES[species];
    for (let i = 0; i < mask.count; i++) {
      if (mask.getX(i) === 0) expect(position.getY(i)).toBeLessThanOrEqual(shape.trunkHeight + 1e-6);
      else expect(position.getY(i)).toBeGreaterThanOrEqual(shape.canopyBase - 1e-6);
    }
    geometry.dispose();
  });
});

describe('weeds geometry', () => {
  it('is rooted at y = 0, stays inside its tile and is deterministic', () => {
    const a = createWeedsGeometry();
    const b = createWeedsGeometry();
    a.computeBoundingBox();
    const box = a.boundingBox ?? new THREE.Box3();
    expect(box.min.y).toBeGreaterThanOrEqual(-1e-6);
    expect(box.max.y).toBeLessThanOrEqual(0.6);
    expect(Math.max(-box.min.x, box.max.x, -box.min.z, box.max.z)).toBeLessThan(0.5);
    expect(Array.from(a.getAttribute('position').array)).toEqual(Array.from(b.getAttribute('position').array));
    a.dispose();
    b.dispose();
  });
});

describe('highlight box heights', () => {
  it('has heights for the new blockers', () => {
    expect(highlightBoxHeight(blockedTile(Blocker.Tree, 4))).toBe(1.3);
    expect(highlightBoxHeight(blockedTile(Blocker.Weeds))).toBe(0.6);
    expect(highlightBoxHeight(blockedTile(Blocker.Building))).toBe(1.2);
  });

  it('checks a placed object first, with per-kind heights and paths as ground', () => {
    const expected: Readonly<Record<PlacedObject['kind'], number>> = {
      chest: 0.8,
      sprinkler: 0.5,
      qualitySprinkler: 0.55,
      woodBurner: 0.9,
      scarecrow: 1.4,
      woodFence: 0.9,
      woodPath: highlightBoxHeight(EMPTY_TILE),
      stonePath: highlightBoxHeight(EMPTY_TILE),
      giantCrop: 1.6,
      forage: 0.4,
      trophy: 0.9,
      decoration: 1.0,
    };
    for (const kind of PLACED_OBJECT_KINDS) {
      expect(highlightBoxHeight(objectTile(SAMPLE_OBJECTS[kind])), kind).toBe(expected[kind]);
    }
    const sprinklerOnSoil: Tile = { ...EMPTY_TILE, state: TileState.Watered, object: { kind: 'sprinkler' } };
    expect(highlightBoxHeight(sprinklerOnSoil)).toBe(0.5);
  });

  it('stands on path planks, soil, grass and water', () => {
    expect(highlightGroundHeight(objectTile({ kind: 'woodPath' }))).toBe(HEIGHTS.pathTop);
    expect(highlightGroundHeight(objectTile({ kind: 'stonePath' }))).toBe(HEIGHTS.pathTop);
    expect(highlightGroundHeight(objectTile({ kind: 'chest', slots: [] }))).toBe(HEIGHTS.grassTop);
    expect(highlightGroundHeight(EMPTY_TILE)).toBe(HEIGHTS.grassTop);
    expect(highlightGroundHeight({ ...EMPTY_TILE, state: TileState.Plowed })).toBe(HEIGHTS.soilTop);
    expect(highlightGroundHeight(blockedTile(Blocker.Water))).toBe(HEIGHTS.waterSurface);
  });
});

describe('player ground height', () => {
  it('rises onto paths and sinks onto soil', () => {
    expect(playerGroundHeight(objectTile({ kind: 'woodPath' }))).toBe(HEIGHTS.pathTop);
    expect(playerGroundHeight(objectTile({ kind: 'stonePath' }))).toBe(HEIGHTS.pathTop);
    expect(playerGroundHeight({ ...EMPTY_TILE, state: TileState.Watered })).toBe(HEIGHTS.soilTop);
    expect(playerGroundHeight(EMPTY_TILE)).toBe(HEIGHTS.grassTop);
    expect(playerGroundHeight(null)).toBe(HEIGHTS.grassTop);
    expect(HEIGHTS.pathTop).toBeGreaterThan(HEIGHTS.grassTop);
  });

  it('lifts the root onto paths but keeps it at grass height over sunken soil', () => {
    expect(playerRootHeight(HEIGHTS.pathTop)).toBe(HEIGHTS.pathTop);
    expect(playerRootHeight(HEIGHTS.grassTop)).toBe(HEIGHTS.grassTop);
    expect(playerRootHeight(HEIGHTS.soilTop)).toBe(HEIGHTS.grassTop);
  });

  it('sits the ground blob just above the surface on grass, soil and paths', () => {
    const tiles: readonly Tile[] = [
      EMPTY_TILE,
      { ...EMPTY_TILE, state: TileState.Watered },
      objectTile({ kind: 'woodPath' }),
      objectTile({ kind: 'stonePath' }),
    ];
    for (const tile of tiles) {
      const surface = playerGroundHeight(tile);
      // The blob is a child of the root, so its world height is root height plus its local height.
      const blobWorld = playerRootHeight(surface) + playerBlobLocalHeight(surface);
      expect(blobWorld).toBeCloseTo(surface + BLOB_LIFT, 9);
    }
  });
});

describe('rain splash surface', () => {
  it('splashes on path planks, soil, grass and water, never on blocking objects or blockers', () => {
    expect(splashSurfaceHeight(objectTile({ kind: 'woodPath' }))).toBe(HEIGHTS.pathTop);
    expect(splashSurfaceHeight(objectTile({ kind: 'stonePath' }))).toBe(HEIGHTS.pathTop);
    expect(splashSurfaceHeight({ ...EMPTY_TILE, state: TileState.Watered })).toBe(HEIGHTS.soilTop);
    expect(splashSurfaceHeight(EMPTY_TILE)).toBe(HEIGHTS.grassTop);
    expect(splashSurfaceHeight(blockedTile(Blocker.Water))).toBe(HEIGHTS.waterSurface);
    expect(splashSurfaceHeight(blockedTile(Blocker.Tree, 4))).toBeNaN();
    for (const kind of PLACED_OBJECT_KINDS) {
      if (kind === 'woodPath' || kind === 'stonePath') continue;
      expect(splashSurfaceHeight(objectTile(SAMPLE_OBJECTS[kind])), kind).toBeNaN();
    }
    // A sprinkler on soil blocks the splash too.
    expect(splashSurfaceHeight({ ...EMPTY_TILE, state: TileState.Plowed, object: { kind: 'sprinkler' } })).toBeNaN();
  });
});

describe('terrain meadow under placed objects', () => {
  it('clears tufts and flowers from tiles with an object and brings them back when it goes', () => {
    const scene = new THREE.Scene();
    const grid = selectActiveWorld(BASE).grid;
    const terrain = new TerrainRenderer({ scene, grid } as unknown as SceneContext);
    terrain.sync(BASE, null);
    const meadowCount = (): number => {
      let total = 0;
      for (const name of ['terrain-tufts', 'terrain-flowers']) {
        const mesh = scene.getObjectByName(name);
        if (!(mesh instanceof THREE.InstancedMesh)) throw new Error(`no ${name}`);
        total += mesh.count;
      }
      return total;
    };
    const before = meadowCount();
    expect(before).toBeGreaterThan(0);
    // A path on every bare grass tile of the farm.
    let paved = BASE;
    forEachTile(selectActiveWorld(BASE), (tile, tx, tz) => {
      if (tile.state === TileState.Unplowed && tile.crop === null && tile.object === null) {
        paved = withTile(paved, { tx, tz }, { ...tile, object: { kind: 'stonePath' } });
      }
    });
    terrain.sync(paved, BASE);
    expect(meadowCount()).toBe(0);
    terrain.sync(BASE, paved);
    expect(meadowCount()).toBe(before);
    terrain.dispose();
  });
});
