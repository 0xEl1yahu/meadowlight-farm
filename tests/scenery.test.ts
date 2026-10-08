/**
 * Per-map structures and scenery (Phase 0 step 4, spec §7.2 StructureRenderer row and the rules
 * below the table), all pure layout and geometry that runs in node without a WebGL context:
 * - every warp opens a gap in the fence or wall, a clear corridor and a trail off the grid;
 * - forest and town planting profiles, the town's low stone wall with its west road gap;
 * - nothing outside a grid hides one of its tiles (the occlusion rule);
 * - the town's structures stay inside their rects (shops, the parts exchange and hedges), low
 *   (well) or thin (lamps), and the parts exchange is a two-storey workshop;
 * - StructureRenderer keeps one scenery per map, shows only the active one and shares one
 *   glow-glass material across every map.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Direction, MAP_IDS, Weather, type GameState, type MapId } from '../src/core/types';
import { createPartSet, type PartSet } from '../src/render/geometryParts';
import { getSharedGlowGlassMaterial } from '../src/render/materials';
import type { SceneContext } from '../src/render/SceneContext';
import {
  OPENING,
  FOREST_DENSITIES,
  TOWN_DENSITIES,
  WALL_SHAPE,
  createTrailGeometry,
  layoutWall,
  openingSpan,
  planScenery,
  warpOpenings,
} from '../src/render/sceneryGeometry';
import {
  BUSH_SHAPE,
  FARM_DENSITIES,
  FENCE_POST_RADIUS,
  FENCE_SHAPE,
  FLOWER_SHAPE,
  TREE_SHAPES,
  distanceOutside,
  layoutFence,
  placeBorderTrees,
  placeBushes,
  placeFlowers,
  wouldBoxOccludeFarm,
  wouldOccludeFarm,
} from '../src/render/structureGeometry';
import { StructureRenderer } from '../src/render/StructureRenderer';
import {
  LAMP_POST_SHAPE,
  PARTS_EXCHANGE_SHAPE,
  PARTS_EXCHANGE_STYLE,
  SHOP_INSET,
  SHOP_KINDS,
  SHOP_SHAPE,
  SHOP_STYLES,
  WELL_MAX_HEIGHT,
  mapStructureParts,
  structureParts,
} from '../src/render/townGeometry';
import type { FrameContext } from '../src/render/types';
import { tileCenterX, tileMinX, tileMinZ, worldRect } from '../src/world/grid';
import { MAPS, type StructurePlacement } from '../src/world/maps';
import { BASE, withPlayer } from './testUtils';

const EPS = 1e-6;

/** The fence around a map, as StructureRenderer lays it out. */
function fenceOf(id: MapId) {
  const def = MAPS[id];
  const plan = planScenery(def);
  return { plan, fence: layoutFence(plan.meadow.bounds, plan.meadow.topY, plan.gaps, def.cosmeticOffset) };
}

function wallOf(id: MapId) {
  const def = MAPS[id];
  const plan = planScenery(def);
  return layoutWall(plan.meadow.bounds, plan.meadow.topY, plan.gaps, def.cosmeticOffset);
}

describe('warp openings', () => {
  it('opens one tile of grass at each farm gate, with a dirt trail', () => {
    expect(warpOpenings(MAPS.farm)).toEqual([
      { side: 'west', start: 13, end: 14, surface: 'dirt' },
      { side: 'east', start: 38, end: 39, surface: 'dirt' },
    ]);
  });

  it('opens as wide as the forest trail and the town road where they meet the edge', () => {
    expect(warpOpenings(MAPS.forest)).toEqual([{ side: 'east', start: 14, end: 17, surface: 'dirt' }]);
    expect(warpOpenings(MAPS.town)).toEqual([{ side: 'west', start: 15, end: 18, surface: 'cobble' }]);
  });

  it('gives every warp of every map an opening that contains its tile', () => {
    for (const id of MAP_IDS) {
      const def = MAPS[id];
      const openings = warpOpenings(def);
      expect(openings).toHaveLength(def.warps.length);
      def.warps.forEach((warp, i) => {
        const opening = openings[i];
        if (opening === undefined) throw new Error(`${id}: no opening for warp ${i}`);
        const along = opening.side === 'west' || opening.side === 'east' ? warp.from.tz : warp.from.tx;
        expect(along).toBeGreaterThanOrEqual(opening.start);
        expect(along).toBeLessThan(opening.end);
      });
    }
  });
});

describe('farm fence', () => {
  const { plan, fence } = fenceOf('farm');
  const def = MAPS.farm;

  it('leaves every warp opening free of posts and rails', () => {
    for (const opening of plan.openings) {
      const span = openingSpan(def, opening);
      const vertical = opening.side === 'west' || opening.side === 'east';
      const onSide = (x: number, z: number): boolean => {
        const b = plan.meadow.bounds;
        if (opening.side === 'west') return Math.abs(x - (b.minX - FENCE_SHAPE.offset)) < EPS;
        if (opening.side === 'east') return Math.abs(x - (b.maxX + FENCE_SHAPE.offset)) < EPS;
        if (opening.side === 'north') return Math.abs(z - (b.minZ - FENCE_SHAPE.offset)) < EPS;
        return Math.abs(z - (b.maxZ + FENCE_SHAPE.offset)) < EPS;
      };
      for (const rail of fence.rails.filter((r) => onSide(r.x, r.z))) {
        const mid = vertical ? rail.z : rail.x;
        expect(mid + rail.length / 2 <= span.min + EPS || mid - rail.length / 2 >= span.max - EPS).toBe(true);
      }
      for (const post of fence.posts.filter((p) => onSide(p.x, p.z))) {
        const at = vertical ? post.z : post.x;
        expect(at <= span.min - EPS || at >= span.max + EPS).toBe(true);
      }
    }
  });

  it('puts taller, wider gateposts only on the back (−X / −Z) sides, and low posts at front gap ends', () => {
    const b = plan.meadow.bounds;
    const west = b.minX - FENCE_SHAPE.offset;
    const east = b.maxX + FENCE_SHAPE.offset;
    const gateposts = fence.posts.filter((p) => p.height > FENCE_SHAPE.tallHeight + 0.05);
    expect(gateposts).toHaveLength(2);
    for (const post of gateposts) {
      expect(post.x).toBeCloseTo(west, 6);
      expect(post.height).toBeCloseTo(FENCE_SHAPE.gateHeight + 0.03, 6);
      expect(post.length).toBe(FENCE_SHAPE.gateWidth);
      expect(wouldOccludeFarm(b, post.x, post.z, FENCE_POST_RADIUS * post.length, post.height)).toBe(false);
    }
    const eastGate = plan.gaps.find((gap) => gap.side === 'east');
    if (eastGate === undefined) throw new Error('no east gap');
    const ends = fence.posts.filter((p) => Math.abs(p.x - east) < EPS && (Math.abs(p.z - eastGate.min) < EPS || Math.abs(p.z - eastGate.max) < EPS));
    expect(ends).toHaveLength(2);
    for (const post of ends) {
      expect(post.height).toBeCloseTo(FENCE_SHAPE.lowHeight + 0.03, 6);
      expect(post.length).toBe(1);
    }
  });
});

describe('town wall', () => {
  const def = MAPS.town;
  const bounds = worldRect(def.grid);
  const blocks = wallOf('town');

  it('runs along both back sides and only there', () => {
    const northZ = bounds.minZ - WALL_SHAPE.offset;
    const westX = bounds.minX - WALL_SHAPE.offset;
    expect(blocks.some((b) => Math.abs(b.z - northZ) < EPS)).toBe(true);
    expect(blocks.some((b) => Math.abs(b.x - westX) < EPS)).toBe(true);
    for (const block of blocks) expect(Math.abs(block.z - northZ) < EPS || Math.abs(block.x - westX) < EPS).toBe(true);
    // Stone courses (not just the pillars) run the whole length of each side, less the road gap.
    const courses = blocks.filter((b) => Math.abs(b.y - planScenery(def).meadow.topY) < EPS && b.height < WALL_SHAPE.pillarHeight);
    const north = courses.filter((b) => Math.abs(b.z - northZ) < EPS && b.width > b.depth);
    const west = courses.filter((b) => Math.abs(b.x - westX) < EPS && b.depth > b.width);
    expect(north.reduce((sum, b) => sum + b.width, 0)).toBeGreaterThan(bounds.maxX - bounds.minX - 0.5);
    expect(west.reduce((sum, b) => sum + b.depth, 0)).toBeGreaterThan(bounds.maxZ - bounds.minZ - 3 * def.grid.tileSize - 1.5);
  });

  it('leaves a gap for the west road (tz 15–17)', () => {
    const roadMin = tileMinZ(def.grid, 15);
    const roadMax = tileMinZ(def.grid, 18);
    const westX = bounds.minX - WALL_SHAPE.offset;
    for (const block of blocks.filter((b) => Math.abs(b.x - westX) < EPS)) {
      expect(block.z + block.depth / 2 <= roadMin || block.z - block.depth / 2 >= roadMax).toBe(true);
    }
  });

  it('is low, never hides a tile and has a single pillar at the back corner', () => {
    for (const block of blocks) {
      expect(block.y + block.height).toBeLessThan(1.1);
      expect(wouldBoxOccludeFarm(bounds, block.x, block.z, block.width / 2, block.depth / 2, block.y + block.height)).toBe(false);
      // Wholly outside the grid, behind it: nothing there can hide a tile.
      expect(block.x + block.width / 2 < bounds.minX || block.z + block.depth / 2 < bounds.minZ).toBe(true);
    }
    const corner = blocks.filter(
      (b) => Math.abs(b.x - (bounds.minX - WALL_SHAPE.offset)) < EPS && Math.abs(b.z - (bounds.minZ - WALL_SHAPE.offset)) < EPS,
    );
    expect(corner).toHaveLength(2); // one pillar and its cap
  });

  it('exists only in the town', () => {
    expect(planScenery(MAPS.town)).toMatchObject({ wall: true, fence: false });
    expect(planScenery(MAPS.farm)).toMatchObject({ wall: false, fence: true });
    expect(planScenery(MAPS.forest)).toMatchObject({ wall: false, fence: false });
  });
});

describe('scatter around every map', () => {
  for (const id of MAP_IDS) {
    const def = MAPS[id];
    const plan = planScenery(def);
    const bounds = plan.meadow.bounds;
    const trees = placeBorderTrees(plan.scatter);
    const bushes = placeBushes(plan.scatter, trees);
    const flowers = placeFlowers(plan.scatter, trees, bushes);

    it(`${id}: keeps every tree, bush and flower out of the warp corridors`, () => {
      expect(plan.scatter.corridors).toHaveLength(def.warps.length);
      for (const corridor of plan.scatter.corridors) {
        for (const prop of [...trees, ...bushes, ...flowers]) {
          expect(distanceOutside(corridor, prop.x, prop.z)).toBeGreaterThanOrEqual(prop.radius - EPS);
        }
      }
    });

    it(`${id}: never hides a grid tile`, () => {
      for (const tree of trees) {
        const shape = TREE_SHAPES[tree.species];
        const height = (shape.canopyBase + shape.canopyHeight) * tree.scale;
        expect(wouldOccludeFarm(bounds, tree.x, tree.z, tree.radius, height)).toBe(false);
      }
      for (const bush of bushes) expect(wouldOccludeFarm(bounds, bush.x, bush.z, bush.radius, BUSH_SHAPE.height * bush.scale)).toBe(false);
      for (const flower of flowers) {
        expect(wouldOccludeFarm(bounds, flower.x, flower.z, flower.radius, FLOWER_SHAPE.height * flower.scale)).toBe(false);
      }
    });

    it(`${id}: is deterministic`, () => {
      expect(placeBorderTrees(planScenery(def).scatter)).toEqual(trees);
    });
  }

  it('plants the forest densely behind the grid, like the farm in front, and differently from the farm', () => {
    const backTrees = (id: MapId): number => {
      const plan = planScenery(MAPS[id]);
      const b = plan.meadow.bounds;
      return placeBorderTrees(plan.scatter).filter((t) => distanceOutside(b, t.x, t.z) <= 10 && (t.x < b.minX || t.z < b.minZ)).length;
    };
    expect(backTrees('forest')).toBeGreaterThan(backTrees('farm'));
    expect(backTrees('town')).toBeLessThan(backTrees('farm'));
    for (const d of [0, 3, 4, 8, 12, 20, 26, 40]) expect(FOREST_DENSITIES.tree(d, true)).toBe(FARM_DENSITIES.tree(d, true));
    expect(TOWN_DENSITIES.tree(8, false)).toBeLessThan(FARM_DENSITIES.tree(8, false));
    const [farmTree] = placeBorderTrees(planScenery(MAPS.farm).scatter);
    const [forestTree] = placeBorderTrees(planScenery(MAPS.forest).scatter);
    expect(forestTree).not.toEqual(farmTree);
  });
});

describe('trails off the grid', () => {
  for (const id of MAP_IDS) {
    const def = MAPS[id];
    const plan = planScenery(def);
    it(`${id}: paints a strip from under the rim out across the flat meadow at every opening`, () => {
      const bounds = plan.meadow.bounds;
      const unit = def.grid.tileSize;
      for (const opening of plan.openings) {
        const geometry = createTrailGeometry(def, opening, plan.meadow.topY);
        expect(Object.keys(geometry.attributes).sort()).toEqual(['color', 'normal', 'position']);
        const span = openingSpan(def, opening);
        const positions = geometry.getAttribute('position');
        let reach = 0;
        for (let i = 0; i < positions.count; i++) {
          const x = positions.getX(i);
          const z = positions.getZ(i);
          expect(positions.getY(i)).toBeGreaterThan(plan.meadow.topY);
          const along = opening.side === 'west' || opening.side === 'east' ? z : x;
          expect(along).toBeGreaterThan(span.min);
          expect(along).toBeLessThan(span.max);
          reach = Math.max(reach, distanceOutside(bounds, x, z));
        }
        expect(reach).toBeCloseTo(OPENING.trailLength * unit, 6);
        geometry.dispose();
      }
    });
  }

  it('continues the town road in cobbles and the dirt trails in dirt', () => {
    const colorOf = (id: MapId): THREE.Color => {
      const def = MAPS[id];
      const plan = planScenery(def);
      const opening = plan.openings[0];
      if (opening === undefined) throw new Error(`${id}: no opening`);
      const colors = createTrailGeometry(def, opening, plan.meadow.topY).getAttribute('color');
      return new THREE.Color(colors.getX(0), colors.getY(0), colors.getZ(0));
    };
    const town = colorOf('town');
    const forest = colorOf('forest');
    // Grey cobbles are nearly neutral; packed dirt leans warm.
    expect(town.r - town.b).toBeLessThan(forest.r - forest.b);
  });
});

/** Bounding box of every part pushed for one structure. */
function structureBox(s: StructurePlacement): { body: THREE.Box3; glass: THREE.Box3; parts: PartSet } {
  const parts = createPartSet();
  structureParts(MAPS.town.grid, MAPS.town.cosmeticOffset, s, parts);
  const body = new THREE.Box3();
  const glass = new THREE.Box3();
  for (const part of parts.body) body.union(new THREE.Box3().setFromBufferAttribute(part.getAttribute('position') as THREE.BufferAttribute));
  for (const part of parts.glass) glass.union(new THREE.Box3().setFromBufferAttribute(part.getAttribute('position') as THREE.BufferAttribute));
  return { body, glass, parts };
}

describe('town structures', () => {
  const grid = MAPS.town.grid;
  const structures = MAPS.town.structures;

  it('builds every structure of the town and nothing on the other maps', () => {
    const town = createPartSet();
    mapStructureParts(MAPS.town, town);
    expect(town.body.length).toBeGreaterThan(structures.length);
    // Shop and parts exchange windows, door panes and wall lanterns, plus one lamp per post.
    expect(town.glass.length).toBeGreaterThanOrEqual((SHOP_KINDS.length + 1) * 3 + structures.filter((s) => s.kind === 'lampPost').length);
    for (const id of ['farm', 'forest'] as const) {
      const parts = createPartSet();
      mapStructureParts(MAPS[id], parts);
      expect(parts.body).toHaveLength(0);
      expect(parts.glass).toHaveLength(0);
    }
  });

  it('keeps every shop, hedge and the parts exchange inside its rect, so nothing reaches a walkable tile', () => {
    for (const s of structures.filter((st) => st.kind !== 'well' && st.kind !== 'lampPost')) {
      const { body } = structureBox(s);
      expect(body.min.x).toBeGreaterThanOrEqual(tileMinX(grid, s.rect.x0) - EPS);
      expect(body.max.x).toBeLessThanOrEqual(tileMinX(grid, s.rect.x0 + s.rect.width) + EPS);
      expect(body.min.z).toBeGreaterThanOrEqual(tileMinZ(grid, s.rect.z0) - EPS);
      expect(body.max.z).toBeLessThanOrEqual(tileMinZ(grid, s.rect.z0 + s.rect.depth) + EPS);
      expect(body.min.y).toBeGreaterThanOrEqual(-0.06);
    }
  });

  it('gives the four shops distinct palettes, a sign above the door and glowing windows', () => {
    expect(new Set(SHOP_KINDS.map((kind) => SHOP_STYLES[kind].wall)).size).toBe(4);
    expect(new Set(SHOP_KINDS.map((kind) => SHOP_STYLES[kind].roof.roof)).size).toBe(4);
    expect(new Set(SHOP_KINDS.map((kind) => SHOP_STYLES[kind].emblem)).size).toBe(4);
    for (const kind of SHOP_KINDS) {
      const s = structures.find((st) => st.kind === kind);
      if (s === undefined || s.door === null) throw new Error(`no ${kind} with a door`);
      const { body, glass } = structureBox(s);
      expect(glass.isEmpty()).toBe(false);
      // The sign stands above the door at the eave edge, still inside the rect (checked above).
      expect(body.max.z).toBeGreaterThan(tileMinZ(grid, s.rect.z0 + s.rect.depth) - SHOP_INSET.front + SHOP_SHAPE.eaveOverhang);
      expect(body.max.y).toBeGreaterThan(SHOP_STYLES[kind].wallHeight + SHOP_SHAPE.signHeight);
    }
  });

  it('builds the parts exchange as a two-storey workshop with a cog-and-claw sign, a big window and a crate by the door', () => {
    const s = structures.find((st) => st.kind === 'partsExchange');
    if (s === undefined || s.door === null) throw new Error('no parts exchange with a door');
    const { body, parts } = structureBox(s);
    const P = PARTS_EXCHANGE_SHAPE;
    const style = PARTS_EXCHANGE_STYLE;
    const boxOf = (part: THREE.BufferGeometry): THREE.Box3 =>
      new THREE.Box3().setFromBufferAttribute(part.getAttribute('position') as THREE.BufferAttribute);
    const base = SHOP_SHAPE.foundationHeight;

    // Two storeys, taller than any shop.
    expect(style.wallHeight).toBeGreaterThanOrEqual(2 * P.storeyHeight - EPS);
    expect(style.wallHeight).toBeGreaterThan(Math.max(...SHOP_KINDS.map((kind) => SHOP_STYLES[kind].wallHeight)));

    // Glow glass: the display window, two upper front windows, four +X windows, the gable window,
    // the door pane and the lantern; five of them upstairs.
    const glass = parts.glass.map(boxOf);
    expect(glass).toHaveLength(10);
    expect(glass.filter((g) => g.min.y > base + P.storeyHeight)).toHaveLength(5);

    // The big front window: wider and taller than a shop window, on the ground floor.
    expect(P.displayWidth).toBeGreaterThan(SHOP_SHAPE.windowWidth);
    expect(P.displayHeight).toBeGreaterThan(SHOP_SHAPE.windowHeight);
    const display = glass.filter((g) => g.max.x - g.min.x >= P.displayWidth - EPS && g.max.y - g.min.y >= P.displayHeight - EPS);
    expect(display).toHaveLength(1);
    expect(display[0]!.max.y).toBeLessThan(base + P.storeyHeight);

    // The sign stands above the door at the eave edge, like the shops', and shows a cog and a claw.
    const front = tileMinZ(grid, s.rect.z0 + s.rect.depth) - SHOP_INSET.front;
    expect(body.max.z).toBeGreaterThan(front + SHOP_SHAPE.eaveOverhang);
    expect(body.max.y).toBeGreaterThan(style.wallHeight + SHOP_SHAPE.signHeight);
    expect(style.emblem).toBe('cogClaw');
    for (const kind of SHOP_KINDS) {
      expect(SHOP_STYLES[kind].wall).not.toBe(style.wall);
      expect(SHOP_STYLES[kind].roof.roof).not.toBe(style.roof.roof);
      expect(SHOP_STYLES[kind].emblem).not.toBe(style.emblem);
    }

    // A crate of parts in front of the wall, east of the door step, low on the ground.
    const stepEast = tileCenterX(grid, s.door.tx) + SHOP_SHAPE.doorWidth / 2 + P.stepOverhang;
    const crate = parts.body.map(boxOf).filter((b) => b.min.z > front && b.min.x > stepEast && b.max.y < 2 * P.crateHeight);
    expect(crate.length).toBeGreaterThan(0);
  });

  it('keeps the well low and the lamp posts thin, with glowing lamps', () => {
    const well = structures.find((s) => s.kind === 'well');
    if (well === undefined) throw new Error('no well');
    expect(structureBox(well).body.max.y).toBeLessThanOrEqual(WELL_MAX_HEIGHT + EPS);
    const lamps = structures.filter((s) => s.kind === 'lampPost');
    expect(lamps).toHaveLength(6);
    expect(LAMP_POST_SHAPE.postWidth).toBeLessThanOrEqual(0.15);
    for (const lamp of lamps) {
      const { parts, glass } = structureBox(lamp);
      expect(glass.isEmpty()).toBe(false);
      const posts = parts.body.filter((part) => {
        const b = new THREE.Box3().setFromBufferAttribute(part.getAttribute('position') as THREE.BufferAttribute);
        return b.min.y < 0.5 && b.max.y > 1.5;
      });
      expect(posts).toHaveLength(1);
      const post = new THREE.Box3().setFromBufferAttribute(posts[0]?.getAttribute('position') as THREE.BufferAttribute);
      expect(post.max.x - post.min.x).toBeLessThanOrEqual(0.15 + EPS);
      expect(post.max.z - post.min.z).toBeLessThanOrEqual(0.15 + EPS);
    }
  });
});

/** Meshes the renderer would draw: visible, and instanced meshes only when they hold instances. */
function drawCalls(root: THREE.Object3D): number {
  let calls = 0;
  root.traverseVisible((object) => {
    if (object instanceof THREE.InstancedMesh) calls += object.count > 0 ? 1 : 0;
    else if (object instanceof THREE.Mesh) calls += 1;
  });
  return calls;
}

function frameAt(state: GameState, clockMinutes: number): FrameContext {
  return { dt: 1 / 60, elapsed: 10, state, clockMinutes };
}

describe('StructureRenderer', () => {
  const sunny: GameState = { ...BASE, weather: Weather.Sunny };
  const FARM = sunny;
  const FOREST = withPlayer(sunny, { tx: 34, tz: 15 }, Direction.West, 'forest');
  const TOWN = withPlayer(sunny, { tx: 1, tz: 16 }, Direction.East, 'town');

  function setup(): { scene: THREE.Scene; renderer: StructureRenderer; root: THREE.Object3D } {
    const scene = new THREE.Scene();
    const renderer = new StructureRenderer({ scene } as unknown as SceneContext);
    const root = scene.getObjectByName('StructureRenderer');
    if (root === undefined) throw new Error('no root group');
    return { scene, renderer, root };
  }

  it('builds each map once, shows only the active one and stays within the draw-call budget', () => {
    const { renderer, root } = setup();
    for (const [id, state] of [['farm', FARM], ['forest', FOREST], ['town', TOWN], ['farm', FARM]] as const) {
      renderer.sync(state, null);
      const groups = root.children;
      expect(groups.filter((g) => g.visible).map((g) => g.name)).toEqual([`scenery-${id}`]);
      expect(drawCalls(root)).toBeGreaterThan(5);
      expect(drawCalls(root)).toBeLessThanOrEqual(14);
    }
    expect(root.children.map((g) => g.name)).toEqual(['scenery-farm', 'scenery-forest', 'scenery-town']);
    renderer.dispose();
  });

  it('draws every map\'s window and lamp glass with the one shared glow material, lit by the clock on any map', () => {
    const { renderer, root } = setup();
    const shared = getSharedGlowGlassMaterial();
    renderer.sync(FARM, null);
    renderer.sync(TOWN, null);
    const glass: THREE.Mesh[] = [];
    root.traverse((object) => {
      if (object instanceof THREE.Mesh && object.name === 'glow-glass') glass.push(object);
    });
    expect(glass.map((mesh) => mesh.parent?.name)).toEqual(['scenery-farm', 'scenery-town']);
    for (const mesh of glass) expect(mesh.material).toBe(shared);

    renderer.update(frameAt(TOWN, 12 * 60));
    expect(shared.emissiveIntensity).toBe(0);
    renderer.sync(TOWN, null);
    renderer.update(frameAt(TOWN, 23 * 60));
    expect(shared.emissiveIntensity).toBeGreaterThan(1);
    renderer.dispose();
  });

  it('ignores shipping off the farm and releases everything, the shared glass once, on dispose', () => {
    const { scene, renderer, root } = setup();
    renderer.sync(FARM, null);
    renderer.sync(TOWN, null);
    const pending: GameState = { ...TOWN, shipping: { ...TOWN.shipping, pending: [{ itemId: 'parsnip', quantity: 1, quality: 0 }] } };
    renderer.sync(pending, TOWN);
    renderer.update(frameAt(pending, 12 * 60));
    expect(root.getObjectByName('shipping-marker')?.visible).toBe(false);
    expect(root.getObjectByName('scenery-town')?.getObjectByName('shipping-marker')).toBeUndefined();

    const shared = getSharedGlowGlassMaterial();
    renderer.dispose();
    expect(scene.children).toHaveLength(0);
    expect(root.children).toHaveLength(0);
    expect(getSharedGlowGlassMaterial()).not.toBe(shared);
  });
});
