/**
 * Farmstead & scenery renderer: the farmhouse, the shipping bin, and everything around the farm
 * plateau (meadow, border woodland, fence, bushes and flower clumps).
 *
 * Lifecycle
 * - Static content is built once, on the first full rebuild (`sync(state, null)`), from LAYOUT
 *   and the grid. Later full rebuilds keep it (they only reset the animated bits), so they are
 *   idempotent; a rebuild with a different grid replaces it.
 * - Incremental syncs react to exactly two things: a successful 'ship' action (the lid springs
 *   open and slams shut) and changes to the pending shipment (a bobbing gold coin above the bin).
 * - update() animates only what moves: window glow (follows the clock and the weather), a few
 *   chimney smoke puffs, the lid while it is animating and the coin while it is shown.
 *
 * Draw calls: farmstead body (house + crate, merged, vertex-coloured), window glass, bin lid,
 * coin, smoke, meadow, trunks, two canopy species, fence posts, fence rails, bushes, flower
 * leaves and blossoms — fourteen in total, whatever the size of the woodland.
 */
import * as THREE from 'three';
import { LAYOUT, TIME } from '../config';
import { Weather, type GameState, type GridSpec, type TileCoord, type TileRect } from '../core/types';
import { tileCenterX, tileMinX, tileMinZ, worldRect } from '../world/grid';
import { HEIGHTS } from './constants';
import { createFlatMaterial, createSwayMaterial, sharedUniforms } from './materials';
import { PALETTE } from './palette';
import type { SceneContext } from './SceneContext';
import {
  STRUCTURE_COLORS,
  TREE_SHAPES,
  createBushGeometry,
  createCoinMarkerGeometry,
  createFarmhouseGeometry,
  createFencePostGeometry,
  createFenceRailGeometry,
  createFlowerBlossomGeometry,
  createFlowerLeavesGeometry,
  createMeadowGeometry,
  createPineCanopyGeometry,
  createRoundCanopyGeometry,
  createShippingBinGeometry,
  createSmokePuffGeometry,
  createTreeTrunkGeometry,
  layoutFence,
  mergeParts,
  placeBorderTrees,
  placeBushes,
  placeFlowers,
  smoothstep,
  type FarmhouseSpec,
  type FenceLayout,
  type FlowerPlacement,
  type MeadowSpec,
  type PropPlacement,
  type ShippingBinSpec,
  type TreePlacement,
} from './structureGeometry';
import type { FrameContext, RenderSystem } from './types';
import { selectActiveWorld } from '../state/selectors';

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

/** How far the farmhouse walls sit inside the house rect. The front inset holds the porch step. */
const HOUSE_INSET = { side: 0.3, back: 0.3, front: 0.6 } as const;
/** Porch step depth; it stays inside the house rect so it never overlaps walkable tiles. */
const PORCH_STEP_DEPTH = 0.52;
/** Crate inset inside the shipping-bin rect (the lid overhangs a little of it). */
const BIN_INSET = { x: 0.15, z: 0.11 } as const;

/**
 * Meadow ring around the plateau. At CAMERA.maxViewHeight the view spans roughly 60 × 34 world
 * units (wider on ultrawide screens), i.e. up to ~50 units from the focus to a screen corner on
 * the ground, and the focus can sit on the plateau edge — an 80-unit margin always covers it.
 */
const MEADOW = { margin: 80, cellSize: 4, drop: 0.06, holeInset: 0.5 } as const;

const WINDOW_GLOW = {
  /** Lamps left on at daybreak have faded by 07:05. */
  dawnEnd: 7 * 60 + 5,
  dawnStrength: 0.7,
  /** Lamps come on from 18:30 and are fully lit by 20:15. */
  eveningStart: 18 * 60 + 30,
  eveningFull: 20 * 60 + 15,
  /** Exponential approach rate (1/s), so weather changes fade instead of popping. */
  response: 2.5,
  intensity: 1.6,
} as const;

/** Gloomy weather keeps a lamp or two on during the day. */
const GLOW_BY_WEATHER: Readonly<Record<Weather, number>> = {
  [Weather.Sunny]: 0,
  [Weather.Rain]: 0.22,
  [Weather.Storm]: 0.4,
  [Weather.Snow]: 0.12,
};

export const LID_ANIMATION = {
  /** Total seconds from the first lift to the lid settling shut. */
  duration: 0.62,
  /** Seconds spent springing open (with overshoot) before it drops and bounces. */
  openTime: 0.17,
  /** Hinge angle (radians) at an opening amount of 1. */
  maxAngle: 1.1,
} as const;

const MARKER = {
  /** Height of the coin's centre above the closed lid (clear of the lid when it swings open). */
  lift: 0.95,
  bobHeight: 0.07,
  bobSpeed: 2.6,
  spinSpeed: 2.2,
  /** Spring used to pop the coin in and out. */
  stiffness: 170,
  damping: 11,
  /** A new shipment while the coin is shown gives it a quick bump. */
  popDecay: 2.8,
  popStrength: 0.35,
} as const;

const SMOKE = { puffs: 7, period: 3.8, rise: 1.9, drift: 0.5, size: 0.24 } as const;

const SWAY = {
  canopy: { amplitude: 0.018, frequency: 1.1 },
  bush: { amplitude: 0.06, frequency: 1.5 },
  flower: { amplitude: 0.35, frequency: 2.1 },
} as const;

// ---------------------------------------------------------------------------
// Pure animation curves
// ---------------------------------------------------------------------------

/** Target window glow in [0, 1]: off by day, warm from ~18:30, full at night, dimming at dawn. */
export function windowGlowAt(clockMinutes: number, weather: Weather): number {
  const evening = smoothstep(WINDOW_GLOW.eveningStart, WINDOW_GLOW.eveningFull, clockMinutes);
  const dawn = (1 - smoothstep(TIME.dayStartMinute, WINDOW_GLOW.dawnEnd, clockMinutes)) * WINDOW_GLOW.dawnStrength;
  return Math.max(evening, dawn, GLOW_BY_WEATHER[weather]);
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const u = t - 1;
  return 1 + c3 * u * u * u + c1 * u * u;
}

function easeOutBounce(t: number): number {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) {
    const u = t - 1.5 / d1;
    return n1 * u * u + 0.75;
  }
  if (t < 2.5 / d1) {
    const u = t - 2.25 / d1;
    return n1 * u * u + 0.9375;
  }
  const u = t - 2.625 / d1;
  return n1 * u * u + 0.984375;
}

/**
 * Lid opening amount (0 = shut, 1 = LID_ANIMATION.maxAngle, briefly ~1.1 at the overshoot)
 * `t` seconds into a ship animation that started with the lid at `from`: a springy lift, then a
 * drop that bounces shut.
 */
export function lidOpenAmount(t: number, from: number): number {
  const L = LID_ANIMATION;
  if (t <= 0) return from;
  if (t >= L.duration) return 0;
  if (t < L.openTime) return from + (1 - from) * easeOutBack(t / L.openTime);
  return 1 - easeOutBounce((t - L.openTime) / (L.duration - L.openTime));
}

// ---------------------------------------------------------------------------
// Scratch objects (no per-frame allocation)
// ---------------------------------------------------------------------------

const scratchMatrix = new THREE.Matrix4();
const scratchColor = new THREE.Color();
const scratchPosition = new THREE.Vector3();
const scratchQuaternion = new THREE.Quaternion();
const scratchScale = new THREE.Vector3();
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const GLASS_DAY = new THREE.Color(STRUCTURE_COLORS.glassDay);
const GLASS_NIGHT = new THREE.Color(PALETTE.window);

/** Translation · yaw rotation · non-uniform scale, written into `target`. */
function composeYaw(
  target: THREE.Matrix4,
  x: number,
  y: number,
  z: number,
  yaw: number,
  sx: number,
  sy: number,
  sz: number,
): THREE.Matrix4 {
  scratchPosition.set(x, y, z);
  scratchQuaternion.setFromAxisAngle(Y_AXIS, yaw);
  scratchScale.set(sx, sy, sz);
  return target.compose(scratchPosition, scratchQuaternion, scratchScale);
}

// ---------------------------------------------------------------------------
// Resource tracking
// ---------------------------------------------------------------------------

/** Everything the static scenery allocated on the GPU, released together. */
class ResourceBag {
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly instancedMeshes: THREE.InstancedMesh[] = [];

  geometry<T extends THREE.BufferGeometry>(geometry: T): T {
    this.geometries.push(geometry);
    return geometry;
  }

  material<T extends THREE.Material>(material: T): T {
    this.materials.push(material);
    return material;
  }

  instanced(mesh: THREE.InstancedMesh): THREE.InstancedMesh {
    this.instancedMeshes.push(mesh);
    return mesh;
  }

  dispose(): void {
    for (const mesh of this.instancedMeshes) mesh.dispose();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.instancedMeshes.length = 0;
    this.geometries.length = 0;
    this.materials.length = 0;
  }
}

/**
 * Static InstancedMesh with one instance per item. The colour buffer is allocated before the
 * first render so the shader is compiled with instance colours; bounds are computed once.
 */
function createStaticInstances<T>(
  bag: ResourceBag,
  name: string,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  items: readonly T[],
  write: (item: T, matrix: THREE.Matrix4, color: THREE.Color) => void,
): THREE.InstancedMesh {
  const capacity = Math.max(1, items.length);
  const mesh = bag.instanced(new THREE.InstancedMesh(geometry, material, capacity));
  mesh.name = name;
  const colors = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3);
  mesh.instanceColor = colors;
  items.forEach((item, index) => {
    write(item, scratchMatrix, scratchColor.setRGB(1, 1, 1));
    mesh.setMatrixAt(index, scratchMatrix);
    mesh.setColorAt(index, scratchColor);
  });
  mesh.count = items.length;
  mesh.instanceMatrix.needsUpdate = true;
  colors.needsUpdate = true;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  return mesh;
}

// ---------------------------------------------------------------------------
// Static scenery construction
// ---------------------------------------------------------------------------

interface Placement<TSpec> {
  readonly spec: TSpec;
  /** World position of the model's origin (ground level, footprint centre). */
  readonly origin: THREE.Vector3;
}

/** Animated handles into the farmstead. */
interface FarmsteadHandles {
  readonly glassMaterial: THREE.MeshStandardMaterial;
  readonly smoke: THREE.InstancedMesh;
  readonly smokeOrigin: THREE.Vector3;
  readonly lidPivot: THREE.Group;
  readonly marker: THREE.Mesh;
  readonly markerBase: THREE.Vector3;
}

interface StaticScenery extends FarmsteadHandles {
  readonly grid: GridSpec;
  readonly group: THREE.Group;
  readonly bag: ResourceBag;
}

function sameGrid(a: GridSpec, b: GridSpec): boolean {
  return (
    a.width === b.width &&
    a.depth === b.depth &&
    a.tileSize === b.tileSize &&
    a.originX === b.originX &&
    a.originZ === b.originZ
  );
}

/** Wall footprint inside the house rect, with the door centred on the door tile's column. */
function housePlacement(grid: GridSpec, rect: TileRect, door: TileCoord): Placement<FarmhouseSpec> {
  const minX = tileMinX(grid, rect.x0) + HOUSE_INSET.side;
  const maxX = tileMinX(grid, rect.x0 + rect.width) - HOUSE_INSET.side;
  const minZ = tileMinZ(grid, rect.z0) + HOUSE_INSET.back;
  const maxZ = tileMinZ(grid, rect.z0 + rect.depth) - HOUSE_INSET.front;
  const centerX = (minX + maxX) / 2;
  return {
    spec: {
      width: maxX - minX,
      depth: maxZ - minZ,
      doorOffsetX: tileCenterX(grid, door.tx) - centerX,
      stepDepth: PORCH_STEP_DEPTH,
    },
    origin: new THREE.Vector3(centerX, HEIGHTS.grassTop, (minZ + maxZ) / 2),
  };
}

function binPlacement(grid: GridSpec, rect: TileRect): Placement<ShippingBinSpec> {
  const minX = tileMinX(grid, rect.x0);
  const maxX = tileMinX(grid, rect.x0 + rect.width);
  const minZ = tileMinZ(grid, rect.z0);
  const maxZ = tileMinZ(grid, rect.z0 + rect.depth);
  return {
    spec: { width: maxX - minX - 2 * BIN_INSET.x, depth: maxZ - minZ - 2 * BIN_INSET.z },
    origin: new THREE.Vector3((minX + maxX) / 2, HEIGHTS.grassTop, (minZ + maxZ) / 2),
  };
}

/** Farmhouse, shipping bin (body, hinged lid, coin marker), window glass and chimney smoke. */
function buildFarmstead(grid: GridSpec, bag: ResourceBag, painted: THREE.Material, group: THREE.Group): FarmsteadHandles {
  const house = housePlacement(grid, LAYOUT.house, LAYOUT.houseDoor);
  const houseGeometry = createFarmhouseGeometry(house.spec);
  houseGeometry.body.translate(house.origin.x, house.origin.y, house.origin.z);
  houseGeometry.glass.translate(house.origin.x, house.origin.y, house.origin.z);

  const bin = binPlacement(grid, LAYOUT.shippingBin);
  const binGeometry = createShippingBinGeometry(bin.spec);
  binGeometry.body.translate(bin.origin.x, bin.origin.y, bin.origin.z);

  const body = new THREE.Mesh(bag.geometry(mergeParts([houseGeometry.body, binGeometry.body], 'farmstead')), painted);
  body.name = 'farmstead';
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const glassMaterial = bag.material(
    createFlatMaterial(STRUCTURE_COLORS.glassDay, {
      emissive: STRUCTURE_COLORS.windowGlow,
      emissiveIntensity: 0,
      roughness: 0.35,
    }),
  );
  const glass = new THREE.Mesh(bag.geometry(houseGeometry.glass), glassMaterial);
  glass.name = 'farmhouse-windows';
  group.add(glass);

  const lidPivot = new THREE.Group();
  lidPivot.name = 'shipping-bin-lid';
  lidPivot.position.copy(bin.origin).add(binGeometry.hinge);
  const lid = new THREE.Mesh(bag.geometry(binGeometry.lid), painted);
  lid.castShadow = true;
  lid.receiveShadow = true;
  lidPivot.add(lid);
  group.add(lidPivot);

  const markerMaterial = bag.material(
    createFlatMaterial(0xffffff, {
      vertexColors: true,
      emissive: 0xb07a10,
      emissiveIntensity: 0.55,
      roughness: 0.45,
      metalness: 0.15,
    }),
  );
  const markerBase = new THREE.Vector3(bin.origin.x, bin.origin.y + binGeometry.height + MARKER.lift, bin.origin.z);
  const marker = new THREE.Mesh(bag.geometry(createCoinMarkerGeometry()), markerMaterial);
  marker.name = 'shipping-marker';
  marker.castShadow = true;
  marker.visible = false;
  marker.position.copy(markerBase);
  group.add(marker);

  const smokeOrigin = houseGeometry.chimneyTop.clone().add(house.origin);
  const smokeMaterial = bag.material(createFlatMaterial(STRUCTURE_COLORS.smoke, { roughness: 1 }));
  const smoke = bag.instanced(new THREE.InstancedMesh(bag.geometry(createSmokePuffGeometry()), smokeMaterial, SMOKE.puffs));
  smoke.name = 'chimney-smoke';
  smoke.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scratchMatrix.makeScale(0, 0, 0);
  for (let i = 0; i < SMOKE.puffs; i++) smoke.setMatrixAt(i, scratchMatrix);
  // Puffs move every frame; a fixed sphere around the whole plume keeps culling valid.
  const plumeReach = SMOKE.drift * 3;
  smoke.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(smokeOrigin.x + plumeReach / 2, smokeOrigin.y + SMOKE.rise / 2, smokeOrigin.z - plumeReach / 2),
    SMOKE.rise + plumeReach + SMOKE.size,
  );
  group.add(smoke);

  return { glassMaterial, smoke, smokeOrigin, lidPivot, marker, markerBase };
}

function addTrees(trees: readonly TreePlacement[], bag: ResourceBag, trunkMaterial: THREE.Material, group: THREE.Group): void {
  const canopyMaterial = bag.material(createSwayMaterial(0xffffff, SWAY.canopy, { vertexColors: true }));
  const trunkColor = new THREE.Color(PALETTE.treeTrunk);

  const trunks = createStaticInstances(bag, 'tree-trunks', bag.geometry(createTreeTrunkGeometry()), trunkMaterial, trees, (tree, matrix, color) => {
    const shape = TREE_SHAPES[tree.species];
    const radius = shape.trunkRadius * tree.scale;
    composeYaw(matrix, tree.x, tree.y, tree.z, tree.yaw, radius, shape.trunkHeight * tree.scale, radius);
    color.copy(trunkColor).multiplyScalar(0.92 + (tree.shade - 0.9) * 0.6);
  });

  const writeCanopy = (tree: TreePlacement, matrix: THREE.Matrix4, color: THREE.Color): void => {
    const shape = TREE_SHAPES[tree.species];
    composeYaw(matrix, tree.x, tree.y + shape.canopyBase * tree.scale, tree.z, tree.yaw, tree.scale, tree.scale, tree.scale);
    color.set(tree.tint).multiplyScalar(tree.shade);
  };
  const pines = createStaticInstances(
    bag,
    'pine-canopies',
    bag.geometry(createPineCanopyGeometry()),
    canopyMaterial,
    trees.filter((tree) => tree.species === 'pine'),
    writeCanopy,
  );
  const rounds = createStaticInstances(
    bag,
    'round-canopies',
    bag.geometry(createRoundCanopyGeometry()),
    canopyMaterial,
    trees.filter((tree) => tree.species === 'round'),
    writeCanopy,
  );

  for (const mesh of [trunks, pines, rounds]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
}

function addBushes(bushes: readonly PropPlacement[], bag: ResourceBag, group: THREE.Group): void {
  const material = bag.material(createSwayMaterial(0xffffff, SWAY.bush, { vertexColors: true }));
  const mesh = createStaticInstances(bag, 'bushes', bag.geometry(createBushGeometry()), material, bushes, (bush, matrix, color) => {
    composeYaw(matrix, bush.x, bush.y, bush.z, bush.yaw, bush.scale, bush.scale * 0.92, bush.scale);
    color.set(bush.tint).multiplyScalar(bush.shade);
  });
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
}

function addFlowers(flowers: readonly FlowerPlacement[], bag: ResourceBag, group: THREE.Group): void {
  // Leaves and blossoms share the material and the instance matrices, so they sway as one.
  const material = bag.material(createSwayMaterial(0xffffff, SWAY.flower));
  const place = (flower: FlowerPlacement, matrix: THREE.Matrix4): void => {
    composeYaw(matrix, flower.x, flower.y, flower.z, flower.yaw, flower.scale, flower.scale, flower.scale);
  };
  const leaves = createStaticInstances(bag, 'flower-leaves', bag.geometry(createFlowerLeavesGeometry()), material, flowers, (flower, matrix, color) => {
    place(flower, matrix);
    color.set(flower.leafTint).multiplyScalar(flower.shade);
  });
  const blossoms = createStaticInstances(bag, 'flower-blossoms', bag.geometry(createFlowerBlossomGeometry()), material, flowers, (flower, matrix, color) => {
    place(flower, matrix);
    color.set(flower.tint).multiplyScalar(flower.shade);
  });
  for (const mesh of [leaves, blossoms]) {
    mesh.receiveShadow = true;
    group.add(mesh);
  }
}

function addFence(fence: FenceLayout, bag: ResourceBag, material: THREE.Material, group: THREE.Group): void {
  const fenceColor = new THREE.Color(PALETTE.fence);
  const posts = createStaticInstances(bag, 'fence-posts', bag.geometry(createFencePostGeometry()), material, fence.posts, (post, matrix, color) => {
    composeYaw(matrix, post.x, post.y, post.z, post.yaw, 1, post.height, 1);
    color.copy(fenceColor).multiplyScalar(post.shade);
  });
  const rails = createStaticInstances(bag, 'fence-rails', bag.geometry(createFenceRailGeometry()), material, fence.rails, (rail, matrix, color) => {
    composeYaw(matrix, rail.x, rail.y, rail.z, rail.yaw, rail.length, 1, 1);
    color.copy(fenceColor).multiplyScalar(rail.shade);
  });
  for (const mesh of [posts, rails]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
}

/** Meadow ring, border woodland, bushes, flower clumps and the fence around the plateau. */
function buildSurroundings(
  grid: GridSpec,
  bag: ResourceBag,
  painted: THREE.Material,
  tinted: THREE.Material,
  group: THREE.Group,
): void {
  const bounds = worldRect(grid);
  const unit = grid.tileSize;
  const meadow: MeadowSpec = {
    bounds,
    margin: MEADOW.margin,
    cellSize: MEADOW.cellSize,
    topY: HEIGHTS.grassTop - MEADOW.drop,
    holeInset: MEADOW.holeInset,
  };

  const ground = new THREE.Mesh(bag.geometry(createMeadowGeometry(meadow)), painted);
  ground.name = 'meadow';
  ground.receiveShadow = true;
  group.add(ground);

  const trees = placeBorderTrees(meadow, unit);
  const bushes = placeBushes(meadow, unit, trees);
  const flowers = placeFlowers(meadow, unit, trees, bushes);
  addTrees(trees, bag, tinted, group);
  addBushes(bushes, bag, group);
  addFlowers(flowers, bag, group);
  addFence(layoutFence(bounds, meadow.topY), bag, tinted, group);
}

function buildScenery(grid: GridSpec): StaticScenery {
  const bag = new ResourceBag();
  const group = new THREE.Group();
  group.name = 'farmstead-scenery';
  // White base colours: painted geometry supplies vertex colours, instanced meshes instance colours.
  const painted = bag.material(createFlatMaterial(0xffffff, { vertexColors: true }));
  const tinted = bag.material(createFlatMaterial(0xffffff));
  const handles = buildFarmstead(grid, bag, painted, group);
  buildSurroundings(grid, bag, painted, tinted, group);
  return { ...handles, grid, group, bag };
}

// ---------------------------------------------------------------------------
// Render system
// ---------------------------------------------------------------------------

export class StructureRenderer implements RenderSystem {
  private readonly ctx: SceneContext;
  private readonly root: THREE.Group;
  private scenery: StaticScenery | null = null;
  /** Seconds into the current lid animation, or −1 while the lid rests shut. */
  private lidTime = -1;
  private lidFrom = 0;
  private lidAmount = 0;
  private markerTarget = 0;
  private markerScale = 0;
  private markerVelocity = 0;
  private markerPop = 0;
  /** Smoothed window glow; −1 snaps to the target on the next frame. */
  private glow = -1;

  constructor(ctx: SceneContext) {
    this.ctx = ctx;
    this.root = new THREE.Group();
    this.root.name = 'StructureRenderer';
    ctx.scene.add(this.root);
  }

  sync(state: GameState, prev: GameState | null): void {
    if (prev === null) {
      this.rebuild(state);
      return;
    }
    const action = state.player.lastAction;
    if (action !== prev.player.lastAction && action !== null && action.kind === 'ship' && action.success) {
      this.lidFrom = this.lidAmount;
      this.lidTime = 0;
    }
    if (state.shipping.pending !== prev.shipping.pending) {
      const target = state.shipping.pending.length > 0 ? 1 : 0;
      if (target === 1 && this.markerTarget === 1) this.markerPop = 1;
      this.markerTarget = target;
    }
  }

  update(frame: FrameContext): void {
    const scenery = this.scenery;
    if (scenery === null) return;
    this.updateWindowGlow(scenery.glassMaterial, frame);
    this.updateSmoke(scenery.smoke, scenery.smokeOrigin, frame.elapsed);
    if (this.lidTime >= 0) this.updateLid(scenery.lidPivot, frame.dt);
    this.updateMarker(scenery.marker, scenery.markerBase, frame);
  }

  dispose(): void {
    this.releaseScenery();
    this.ctx.scene.remove(this.root);
  }

  /** Builds the static scenery once (or again for a different grid) and resets the animations. */
  private rebuild(state: GameState): void {
    const grid = selectActiveWorld(state).grid;
    if (this.scenery !== null && !sameGrid(this.scenery.grid, grid)) this.releaseScenery();
    let scenery = this.scenery;
    if (scenery === null) {
      scenery = buildScenery(grid);
      this.scenery = scenery;
      this.root.add(scenery.group);
    }

    this.lidTime = -1;
    this.lidFrom = 0;
    this.lidAmount = 0;
    scenery.lidPivot.rotation.x = 0;

    const hasPending = state.shipping.pending.length > 0;
    this.markerTarget = hasPending ? 1 : 0;
    this.markerScale = this.markerTarget;
    this.markerVelocity = 0;
    this.markerPop = 0;
    scenery.marker.visible = hasPending;
    scenery.marker.scale.setScalar(this.markerScale);
    scenery.marker.position.copy(scenery.markerBase);

    this.glow = -1;
  }

  private releaseScenery(): void {
    if (this.scenery === null) return;
    this.root.remove(this.scenery.group);
    this.scenery.bag.dispose();
    this.scenery = null;
  }

  private updateWindowGlow(material: THREE.MeshStandardMaterial, frame: FrameContext): void {
    const target = windowGlowAt(frame.clockMinutes, frame.state.weather);
    this.glow = this.glow < 0 ? target : this.glow + (target - this.glow) * (1 - Math.exp(-frame.dt * WINDOW_GLOW.response));
    const flicker = 1 + 0.035 * Math.sin(frame.elapsed * 9.1) + 0.02 * Math.sin(frame.elapsed * 23.3 + 1.7);
    material.emissiveIntensity = this.glow * WINDOW_GLOW.intensity * flicker;
    material.color.copy(GLASS_DAY).lerp(GLASS_NIGHT, this.glow);
  }

  /** Puffs rise, swell and fade on staggered loops, drifting screen-right with the wind. */
  private updateSmoke(smoke: THREE.InstancedMesh, origin: THREE.Vector3, elapsed: number): void {
    const wind = sharedUniforms.uWindStrength.value;
    for (let i = 0; i < SMOKE.puffs; i++) {
      const phase = elapsed / SMOKE.period + i / SMOKE.puffs;
      const age = phase - Math.floor(phase);
      const wobble = Math.sin(elapsed * 1.3 + i * 2.1) * 0.08 * age;
      const drift = age * SMOKE.drift * wind;
      const size = SMOKE.size * (0.35 + 0.65 * age) * Math.pow(Math.sin(Math.PI * age), 0.7);
      composeYaw(
        scratchMatrix,
        origin.x + drift + wobble,
        origin.y + age * SMOKE.rise,
        origin.z - drift + wobble * 0.5,
        age * 2 + i,
        size,
        size * 0.85,
        size,
      );
      smoke.setMatrixAt(i, scratchMatrix);
    }
    smoke.instanceMatrix.needsUpdate = true;
  }

  private updateLid(pivot: THREE.Group, dt: number): void {
    this.lidTime += dt;
    if (this.lidTime >= LID_ANIMATION.duration) {
      this.lidTime = -1;
      this.lidAmount = 0;
    } else {
      this.lidAmount = lidOpenAmount(this.lidTime, this.lidFrom);
    }
    // The lid extends toward +Z from its back hinge; a negative X rotation lifts its front edge.
    pivot.rotation.x = -this.lidAmount * LID_ANIMATION.maxAngle;
  }

  private updateMarker(marker: THREE.Mesh, base: THREE.Vector3, frame: FrameContext): void {
    if (this.markerTarget === 0 && this.markerScale === 0 && this.markerVelocity === 0) return;
    const dt = frame.dt;
    this.markerVelocity += (this.markerTarget - this.markerScale) * MARKER.stiffness * dt;
    this.markerVelocity *= Math.exp(-MARKER.damping * dt);
    this.markerScale += this.markerVelocity * dt;

    if (this.markerTarget === 0 && this.markerScale < 0.02 && Math.abs(this.markerVelocity) < 0.2) {
      this.markerScale = 0;
      this.markerVelocity = 0;
      this.markerPop = 0;
      marker.visible = false;
      return;
    }

    this.markerPop = Math.max(0, this.markerPop - dt * MARKER.popDecay);
    const scale = Math.max(0, this.markerScale) * (1 + MARKER.popStrength * Math.sin(Math.PI * this.markerPop));
    marker.visible = scale > 1e-3;
    marker.scale.setScalar(scale);
    marker.position.set(base.x, base.y + Math.sin(frame.elapsed * MARKER.bobSpeed) * MARKER.bobHeight, base.z);
    marker.rotation.y = frame.elapsed * MARKER.spinSpeed;
  }
}
