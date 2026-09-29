/**
 * ObjectRenderer: the player-placed objects of the active map (spec §7.3) — chests, sprinklers,
 * scarecrows, wood fences, paths, giant crops, forage, trophies and decorations.
 *
 * Instancing
 * - One InstancedMesh per (kind, part) from objectGeometry.ts's OBJECT_PARTS, each wrapped in an
 *   InstanceSlotMap keyed by the tileIndex of the object's anchor tile. Capacity is the largest
 *   map's tile count, allocated once; fence rails get twice that and are keyed by edge
 *   (tileIndex · 2 + {0: east, 1: south}). Empty meshes are invisible, so the draw calls are
 *   one per part in use.
 * - Objects stand on their tile's ground (soil or grass; a giant crop on its anchor's), centred on
 *   the tile (a giant crop on its 3×3 footprint), scaled by tileSize.
 *
 * Diff (objectLayout.ts holds the pure rules)
 * - sync walks chunk → tile references like TerrainRenderer and compares `tile.object`.
 * - A record per key remembers the look it shows (kind + look data), so a removal touches only
 *   the old kind's parts. A change is a placement (pop-in, matrix write) only when the key showed
 *   nothing or another kind; the same kind with another look swaps its parts in place; the same
 *   look rewrites nothing, so a chest deposit never re-pops the chest or closes its open lid.
 *   If only the ground under an unchanged object moves (soil under a sprinkler reverting to grass
 *   overnight), its matrices follow without a pop.
 * - A giant crop draws once, at its anchor; covered tiles are skipped.
 * - Fence rails: any object change at (tx, tz) recomputes the east and south rails of (tx, tz),
 *   the east rail of (tx − 1, tz) and the south rail of (tx, tz − 1). A rail stands between two
 *   neighbouring fences.
 * - prev = null (startup, load, map change) rebuilds everything without animation.
 *
 * Animation
 * - Placed objects and new rails pop in (ease-out-back, like CropRenderer's entrance).
 * - A chest's lid opens while `ui.panel` is that chest, eased in update().
 * - update() touches only popping objects and moving lids, committing with `{ bounds: false }`;
 *   bounds are recomputed once when an animation ends.
 *
 * Materials: a white vertex-colour material for painted parts, a gently swaying one for the
 * scarecrow's shirt, the tint-mask sway material for forage, and the shared glow glass (driven by
 * StructureRenderer, never disposed here) for lantern paper and lights.
 */
import * as THREE from 'three';
import type { Chunk, GameState, GridSpec, MapId, PlacedObject, Tile, WorldState } from '../core/types';
import { CROPS } from '../farming/crops';
import { selectActiveMapId, selectActiveWorld } from '../state/selectors';
import { inBounds, tileCenterX, tileCenterZ, tileCount, tileIndex } from '../world/grid';
import { MAX_MAP_TILE_COUNT, getMap } from '../world/maps';
import { GIANT_CROP_SIZE, requireTile } from '../world/tiles';
import { InstanceSlotMap } from './InstanceSlotMap';
import { createFlatMaterial, createSwayMaterial, createTintMaskSwayMaterial, getSharedGlowGlassMaterial } from './materials';
import {
  CHEST_SHAPE,
  FORAGE_LOOKS,
  OBJECT_PARTS,
  OBJECT_PART_IDS,
  OBJECT_SWAY,
  TROPHY_RIBBONS,
  objectPartsFor,
  type ObjectMaterialKind,
  type ObjectPartId,
} from './objectGeometry';
import {
  OBJECT_MOTION,
  RAIL_SIDE,
  approachLid,
  classifyObjectChange,
  drawnObject,
  fenceEdgesAround,
  fenceRailKey,
  hasFenceRail,
  objectCosmetic,
  objectGroundHeight,
  objectLook,
  openChestTile,
  popScale,
  railNeighbour,
  stonePathVariant,
  type FenceEdge,
  type ObjectLook,
} from './objectLayout';
import { PALETTE } from './palette';
import type { SceneContext } from './SceneContext';
import type { FrameContext, RenderSystem } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Part {
  readonly id: ObjectPartId;
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.Material;
  readonly useColor: boolean;
  mesh: THREE.InstancedMesh;
  slots: InstanceSlotMap;
  /** Edited since the last commit. */
  dirty: boolean;
  /** An animation on this part ended this frame: recompute its culling bounds at the commit. */
  settle: boolean;
}

/** What one anchor key shows, and where. */
interface ObjectRecord {
  readonly key: number;
  readonly tx: number;
  readonly tz: number;
  object: PlacedObject;
  look: ObjectLook;
  parts: readonly ObjectPartId[];
  /** Base of the object in world space, its yaw and its uniform scale (tileSize). */
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
  /** Cosmetic brightness for untinted parts. */
  shade: number;
  /** Seconds into the pop-in; ≥ OBJECT_MOTION.popSeconds when settled. */
  pop: number;
  /** Chest lid openness, 0 closed … 1 open. */
  lid: number;
}

/** One fence rail, keyed by edge. */
interface RailRecord {
  readonly key: number;
  readonly x: number;
  /** Mean ground height of the two fences it joins. */
  y: number;
  readonly z: number;
  readonly yaw: number;
  readonly scale: number;
  readonly shade: number;
  pop: number;
}

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

/** Cosmetic channels (objectCosmetic). */
const CHANNEL = { shade: 1, yaw: 2, offsetX: 3, offsetZ: 4, rail: 5 } as const;

const LOOK = {
  /** Untinted parts vary their brightness a little per tile. */
  shadeMin: 0.94,
  shadeRange: 0.08,
  /** Fence timber varies a little more. */
  fenceShadeMin: 0.9,
  fenceShadeRange: 0.12,
  /** Forage sits a little off-centre, turned any way. */
  forageJitter: 0.08,
} as const;

const WHITE = new THREE.Color(0xffffff);
const WOOD_FENCE = new THREE.Color(PALETTE.woodFence);
const scratchColor = new THREE.Color();
const scratchMatrix = new THREE.Matrix4();
const scratchFrame = new THREE.Matrix4();
const scratchHinge = new THREE.Matrix4();
const scratchPosition = new THREE.Vector3();
const scratchQuaternion = new THREE.Quaternion();
const scratchScale = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const RIGHT = new THREE.Vector3(1, 0, 0);

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function unit(hash: number): number {
  return hash / 4294967296;
}

function sameGridShape(a: GridSpec, b: GridSpec): boolean {
  return (
    a === b ||
    (a.width === b.width &&
      a.depth === b.depth &&
      a.chunkSize === b.chunkSize &&
      a.tileSize === b.tileSize &&
      a.originX === b.originX &&
      a.originZ === b.originZ)
  );
}

/** base · yaw · uniform scale. */
function composeBase(target: THREE.Matrix4, x: number, y: number, z: number, yaw: number, scale: number): THREE.Matrix4 {
  scratchPosition.set(x, y, z);
  scratchQuaternion.setFromAxisAngle(UP, yaw);
  scratchScale.setScalar(scale);
  return target.compose(scratchPosition, scratchQuaternion, scratchScale);
}

function createMaterials(): Readonly<Record<ObjectMaterialKind, THREE.Material>> {
  return {
    painted: createFlatMaterial(0xffffff, { vertexColors: true }),
    cloth: createSwayMaterial(0xffffff, OBJECT_SWAY.cloth, { vertexColors: true }),
    plant: createTintMaskSwayMaterial(OBJECT_SWAY.plant),
    glass: getSharedGlowGlassMaterial(),
  };
}

/** Fence rails are keyed by edge, so their mesh holds two instances per tile. */
function partCapacity(id: ObjectPartId, tiles: number): number {
  return id === 'fenceRail' ? tiles * 2 : tiles;
}

function createInstancing(
  id: ObjectPartId,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  useColor: boolean,
  tiles: number,
): { readonly mesh: THREE.InstancedMesh; readonly slots: InstanceSlotMap } {
  const mesh = new THREE.InstancedMesh(geometry, material, partCapacity(id, tiles));
  mesh.name = `object-${id}`;
  mesh.castShadow = OBJECT_PARTS[id].castShadow;
  mesh.receiveShadow = true;
  const slots = new InstanceSlotMap(mesh, useColor);
  mesh.visible = false;
  return { mesh, slots };
}

function createParts(
  tiles: number,
  materials: Readonly<Record<ObjectMaterialKind, THREE.Material>>,
  group: THREE.Group,
): Record<ObjectPartId, Part> {
  const entries = OBJECT_PART_IDS.map((id): [ObjectPartId, Part] => {
    const spec = OBJECT_PARTS[id];
    const geometry = spec.build();
    const material = materials[spec.material];
    const useColor = spec.material !== 'glass';
    const { mesh, slots } = createInstancing(id, geometry, material, useColor, tiles);
    group.add(mesh);
    return [id, { id, geometry, material, useColor, mesh, slots, dirty: false, settle: false }];
  });
  return Object.fromEntries(entries) as Record<ObjectPartId, Part>;
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

export class ObjectRenderer implements RenderSystem {
  private readonly scene: THREE.Scene;
  private readonly group = new THREE.Group();
  private readonly materials: Readonly<Record<ObjectMaterialKind, THREE.Material>>;
  private readonly parts: Readonly<Record<ObjectPartId, Part>>;
  private readonly partList: readonly Part[];
  /** What each anchor key shows. */
  private readonly records = new Map<number, ObjectRecord>();
  /** Fence rails by edge key. */
  private readonly rails = new Map<number, RailRecord>();
  /** The only instances update() touches. */
  private readonly popping = new Set<ObjectRecord>();
  private readonly poppingRails = new Set<RailRecord>();
  private readonly lids = new Set<ObjectRecord>();
  /** Fence edges to recompute once a sync has applied its tile changes, by rail key. */
  private readonly dirtyEdges = new Map<number, FenceEdge>();
  private capacity: number;
  private grid: GridSpec;
  /** Map on screen; null until the first rebuild. */
  private mapId: MapId | null = null;
  /** The active map's cosmeticOffset. */
  private ox = 0;
  private oz = 0;
  /** Key of the chest whose lid is (or is opening) open. */
  private openKey: number | null = null;

  constructor(ctx: SceneContext) {
    this.scene = ctx.scene;
    this.grid = ctx.grid;
    this.capacity = Math.max(MAX_MAP_TILE_COUNT, tileCount(ctx.grid));
    this.group.name = 'placed-objects';
    this.materials = createMaterials();
    this.parts = createParts(this.capacity, this.materials, this.group);
    this.partList = OBJECT_PART_IDS.map((id) => this.parts[id]);
    this.scene.add(this.group);
  }

  sync(state: GameState, prev: GameState | null): void {
    const mapId = selectActiveMapId(state);
    const world = selectActiveWorld(state);
    const rebuild =
      prev === null ||
      mapId !== this.mapId ||
      selectActiveMapId(prev) !== mapId ||
      !sameGridShape(world.grid, selectActiveWorld(prev).grid);
    if (rebuild) {
      this.rebuild(state);
      return;
    }
    const previousOpen = this.openKey;
    this.openKey = this.openKeyFor(state);
    const prevChunks = selectActiveWorld(prev).chunks;
    if (world.chunks !== prevChunks) {
      for (let ci = 0; ci < world.chunks.length; ci++) {
        const chunk = world.chunks[ci];
        const prevChunk = prevChunks[ci];
        if (chunk === undefined || chunk === prevChunk) continue;
        const prevTiles = prevChunk !== undefined && prevChunk.tiles.length === chunk.tiles.length ? prevChunk.tiles : null;
        this.applyChunk(chunk, prevTiles, true);
      }
      this.flushEdges(world, true);
    }
    if (previousOpen !== this.openKey) {
      for (const key of [previousOpen, this.openKey]) {
        const record = key === null ? undefined : this.records.get(key);
        if (record !== undefined && record.object.kind === 'chest') this.lids.add(record);
      }
    }
    this.commit(false);
  }

  update(frame: FrameContext): void {
    if (this.popping.size === 0 && this.poppingRails.size === 0 && this.lids.size === 0) return;
    const { popSeconds } = OBJECT_MOTION;
    for (const record of this.popping) {
      record.pop = Math.min(popSeconds, record.pop + frame.dt);
      const done = record.pop >= popSeconds;
      if (done) this.popping.delete(record);
      this.writeMatrices(record, record.parts, done);
    }
    for (const rail of this.poppingRails) {
      rail.pop = Math.min(popSeconds, rail.pop + frame.dt);
      const done = rail.pop >= popSeconds;
      if (done) this.poppingRails.delete(rail);
      this.writeRail(rail, false, done);
    }
    for (const record of this.lids) {
      const target = record.key === this.openKey ? 1 : 0;
      record.lid = approachLid(record.lid, target, frame.dt);
      const done = record.lid === target;
      if (done) this.lids.delete(record);
      if (!this.popping.has(record)) this.writeMatrices(record, ['chestLid'], done);
    }
    this.commit(true);
  }

  dispose(): void {
    this.scene.remove(this.group);
    for (const part of this.partList) {
      part.mesh.dispose();
      part.geometry.dispose();
    }
    // The glow glass is shared by every map and owned by StructureRenderer.
    this.materials.painted.dispose();
    this.materials.cloth.dispose();
    this.materials.plant.dispose();
    this.group.clear();
    this.records.clear();
    this.rails.clear();
    this.popping.clear();
    this.poppingRails.clear();
    this.lids.clear();
    this.dirtyEdges.clear();
  }

  // -------------------------------------------------------------------------
  // Diffing
  // -------------------------------------------------------------------------

  private rebuild(state: GameState): void {
    const world = selectActiveWorld(state);
    const mapId = selectActiveMapId(state);
    const { cosmeticOffset } = getMap(mapId);
    this.mapId = mapId;
    this.grid = world.grid;
    this.ox = cosmeticOffset.x;
    this.oz = cosmeticOffset.z;
    this.records.clear();
    this.rails.clear();
    this.popping.clear();
    this.poppingRails.clear();
    this.lids.clear();
    this.dirtyEdges.clear();
    this.ensureCapacity(tileCount(world.grid));
    for (const part of this.partList) {
      part.slots.clear();
      part.dirty = true;
      part.settle = false;
    }
    this.openKey = this.openKeyFor(state);
    for (const chunk of world.chunks) this.applyChunk(chunk, null, false);
    for (const record of this.records.values()) {
      if (record.object.kind === 'woodFence') this.queueEdges(record.tx, record.tz);
    }
    this.flushEdges(world, false);
    this.commit(false);
  }

  /** Applies every tile of `chunk` that differs from `prevTiles` (all tiles when null). */
  private applyChunk(chunk: Chunk, prevTiles: readonly Tile[] | null, animate: boolean): void {
    const tiles = chunk.tiles;
    for (let i = 0; i < tiles.length; i++) {
      const tile = tiles[i];
      const prevTile = prevTiles === null ? null : (prevTiles[i] ?? null);
      if (tile === undefined || tile === prevTile) continue;
      const lz = Math.floor(i / chunk.width);
      this.applyTile(chunk.x0 + (i - lz * chunk.width), chunk.z0 + lz, tile, prevTile, animate);
    }
  }

  private applyTile(tx: number, tz: number, tile: Tile, prevTile: Tile | null, animate: boolean): void {
    const key = tileIndex(this.grid, tx, tz);
    const record = this.records.get(key);
    if (prevTile !== null && tile.object === prevTile.object) {
      // Same object: only the ground under it may have moved (soil reverting to grass).
      if (record !== undefined && record.y !== objectGroundHeight(tile)) this.repose(record, tile);
      return;
    }
    if (prevTile !== null) this.queueEdges(tx, tz);
    const object = drawnObject(tile, tx, tz);
    const change = classifyObjectChange(record?.look, object === null ? null : objectLook(object));
    if (change === 'remove' || (change === 'place' && record !== undefined)) {
      if (record !== undefined) this.removeRecord(record);
    }
    if (object === null) return;
    if (change === 'place') {
      this.placeRecord(key, tx, tz, tile, object, animate);
    } else if (record !== undefined) {
      if (change === 'update') this.updateRecord(record, object);
      else record.object = object;
      if (record.y !== objectGroundHeight(tile)) this.repose(record, tile);
    }
  }

  private placeRecord(key: number, tx: number, tz: number, tile: Tile, object: PlacedObject, animate: boolean): void {
    const ts = this.grid.tileSize;
    const cosmetic = (channel: number): number => unit(objectCosmetic(tx, tz, this.ox, this.oz, channel));
    let x = tileCenterX(this.grid, tx);
    let z = tileCenterZ(this.grid, tz);
    let yaw = 0;
    if (object.kind === 'giantCrop') {
      x += ((GIANT_CROP_SIZE - 1) / 2) * ts;
      z += ((GIANT_CROP_SIZE - 1) / 2) * ts;
    } else if (object.kind === 'forage') {
      x += (cosmetic(CHANNEL.offsetX) * 2 - 1) * LOOK.forageJitter * ts;
      z += (cosmetic(CHANNEL.offsetZ) * 2 - 1) * LOOK.forageJitter * ts;
      yaw = cosmetic(CHANNEL.yaw) * Math.PI * 2;
    } else if (object.kind === 'stonePath') {
      yaw = Math.floor(cosmetic(CHANNEL.yaw) * 4) * (Math.PI / 2);
    }
    const fence = object.kind === 'woodFence';
    const shade = fence
      ? LOOK.fenceShadeMin + cosmetic(CHANNEL.shade) * LOOK.fenceShadeRange
      : LOOK.shadeMin + cosmetic(CHANNEL.shade) * LOOK.shadeRange;
    const record: ObjectRecord = {
      key,
      tx,
      tz,
      object,
      look: objectLook(object),
      parts: objectPartsFor(object, stonePathVariant(tx, tz, this.ox, this.oz)),
      x,
      y: objectGroundHeight(tile),
      z,
      yaw,
      scale: ts,
      shade,
      pop: animate ? 0 : OBJECT_MOTION.popSeconds,
      lid: key === this.openKey ? 1 : 0,
    };
    this.records.set(key, record);
    this.writeRecord(record);
    if (animate) this.popping.add(record);
  }

  /** Same kind, another look: swap the parts in place without a pop. */
  private updateRecord(record: ObjectRecord, object: PlacedObject): void {
    const parts = objectPartsFor(object, stonePathVariant(record.tx, record.tz, this.ox, this.oz));
    for (const id of record.parts) {
      if (parts.includes(id)) continue;
      this.parts[id].slots.remove(record.key);
      this.parts[id].dirty = true;
    }
    record.object = object;
    record.look = objectLook(object);
    record.parts = parts;
    this.writeRecord(record);
  }

  /** The ground under an unchanged object moved: follow it (and re-seat a fence's rails). */
  private repose(record: ObjectRecord, tile: Tile): void {
    record.y = objectGroundHeight(tile);
    this.writeRecord(record);
    if (record.object.kind === 'woodFence') this.queueEdges(record.tx, record.tz);
  }

  private removeRecord(record: ObjectRecord): void {
    for (const id of record.parts) {
      this.parts[id].slots.remove(record.key);
      this.parts[id].dirty = true;
    }
    this.records.delete(record.key);
    this.popping.delete(record);
    this.lids.delete(record);
  }

  // -------------------------------------------------------------------------
  // Fence rails
  // -------------------------------------------------------------------------

  private queueEdges(tx: number, tz: number): void {
    for (const edge of fenceEdgesAround(this.grid, tx, tz)) this.dirtyEdges.set(fenceRailKey(this.grid, edge), edge);
  }

  private flushEdges(world: WorldState, animate: boolean): void {
    for (const [key, edge] of this.dirtyEdges) this.syncRail(world, key, edge, animate);
    this.dirtyEdges.clear();
  }

  private syncRail(world: WorldState, key: number, edge: FenceEdge, animate: boolean): void {
    const rail = this.rails.get(key);
    if (!hasFenceRail(world, edge)) {
      if (rail === undefined) return;
      this.parts.fenceRail.slots.remove(key);
      this.parts.fenceRail.dirty = true;
      this.rails.delete(key);
      this.poppingRails.delete(rail);
      return;
    }
    const east = edge.side === RAIL_SIDE.east;
    const end = railNeighbour(edge);
    const y = (objectGroundHeight(requireTile(world, edge.tx, edge.tz)) + objectGroundHeight(requireTile(world, end.tx, end.tz))) / 2;
    if (rail !== undefined) {
      if (rail.y === y) return;
      rail.y = y;
      this.writeRail(rail, true, false);
      return;
    }
    const shade = LOOK.fenceShadeMin + unit(objectCosmetic(edge.tx, edge.tz, this.ox, this.oz, CHANNEL.rail + edge.side)) * LOOK.fenceShadeRange;
    const record: RailRecord = {
      key,
      x: tileCenterX(this.grid, edge.tx),
      y,
      z: tileCenterZ(this.grid, edge.tz),
      // Rails are authored along +X; a quarter turn points them along +Z (south).
      yaw: east ? 0 : -Math.PI / 2,
      scale: this.grid.tileSize,
      shade,
      pop: animate ? 0 : OBJECT_MOTION.popSeconds,
    };
    this.rails.set(key, record);
    this.writeRail(record, true, false);
    if (animate) this.poppingRails.add(record);
  }

  // -------------------------------------------------------------------------
  // Instance writes
  // -------------------------------------------------------------------------

  /** Matrix of one part of `record` at its current pop and lid pose. */
  private partMatrix(record: ObjectRecord, id: ObjectPartId, target: THREE.Matrix4): THREE.Matrix4 {
    const scale = record.scale * popScale(record.pop / OBJECT_MOTION.popSeconds);
    composeBase(target, record.x, record.y, record.z, record.yaw, scale);
    if (id !== 'chestLid') return target;
    scratchHinge.makeRotationAxis(RIGHT, -CHEST_SHAPE.openAngle * record.lid);
    scratchHinge.setPosition(0, CHEST_SHAPE.hingeY, CHEST_SHAPE.hingeZ);
    return target.multiply(scratchHinge);
  }

  /** Instance colour of one part: the object's tint where the part takes one, else a cosmetic shade. */
  private partColor(record: ObjectRecord, id: ObjectPartId, target: THREE.Color): THREE.Color {
    const object = record.object;
    switch (id) {
      case 'fencePost':
        return target.copy(WOOD_FENCE).multiplyScalar(record.shade);
      case 'giantHead':
      case 'giantGourd':
        return object.kind === 'giantCrop' ? target.set(CROPS[object.cropId].visual.produceColor) : target.copy(WHITE);
      case 'trophyRibbon':
        return object.kind === 'trophy' ? target.set(TROPHY_RIBBONS[object.festival]) : target.copy(WHITE);
      case 'foragePlant':
      case 'forageSprig':
      case 'forageBulb':
      case 'forageBerries':
      case 'forageNut':
      case 'forageCap':
      case 'forageRoot':
      case 'forageHolly':
        return object.kind === 'forage' ? target.set(FORAGE_LOOKS[object.itemId].color) : target.copy(WHITE);
      default:
        return target.copy(WHITE).multiplyScalar(record.shade);
    }
  }

  /** Inserts or rewrites every part of `record` (matrix and colour). */
  private writeRecord(record: ObjectRecord): void {
    for (const id of record.parts) {
      const part = this.parts[id];
      const matrix = this.partMatrix(record, id, scratchMatrix);
      part.slots.set(record.key, matrix, part.useColor ? this.partColor(record, id, scratchColor) : undefined);
      part.dirty = true;
    }
  }

  /** Rewrites only the matrices of `ids` (an animation frame). */
  private writeMatrices(record: ObjectRecord, ids: readonly ObjectPartId[], settle: boolean): void {
    for (const id of ids) {
      const part = this.parts[id];
      part.slots.setMatrix(record.key, this.partMatrix(record, id, scratchFrame));
      part.dirty = true;
      if (settle) part.settle = true;
    }
  }

  private writeRail(rail: RailRecord, withColor: boolean, settle: boolean): void {
    const part = this.parts.fenceRail;
    const scale = rail.scale * popScale(rail.pop / OBJECT_MOTION.popSeconds);
    const matrix = composeBase(scratchMatrix, rail.x, rail.y, rail.z, rail.yaw, scale);
    if (withColor) part.slots.set(rail.key, matrix, scratchColor.copy(WOOD_FENCE).multiplyScalar(rail.shade));
    else part.slots.setMatrix(rail.key, matrix);
    part.dirty = true;
    if (settle) part.settle = true;
  }

  /**
   * Uploads edited parts. A state sync recomputes culling bounds; an animation frame skips them
   * (`bounds: false`) except on parts whose animation just ended.
   */
  private commit(frame: boolean): void {
    for (const part of this.partList) {
      if (!part.dirty) continue;
      part.slots.commit(frame && !part.settle ? { bounds: false } : {});
      part.dirty = false;
      part.settle = false;
    }
  }

  /** Key of the chest open in `ui.panel` on the active map, or null. */
  private openKeyFor(state: GameState): number | null {
    const tile = this.mapId === null ? null : openChestTile(state, this.mapId);
    return tile !== null && inBounds(this.grid, tile.tx, tile.tz) ? tileIndex(this.grid, tile.tx, tile.tz) : null;
  }

  /**
   * Grows every part's instance buffers if a world ever has more tiles than MAX_MAP_TILE_COUNT.
   * Every map fits, so in practice the buffers are allocated once, in the constructor.
   */
  private ensureCapacity(required: number): void {
    if (required <= this.capacity) return;
    for (const part of this.partList) {
      this.group.remove(part.mesh);
      part.mesh.dispose();
      const { mesh, slots } = createInstancing(part.id, part.geometry, part.material, part.useColor, required);
      this.group.add(mesh);
      part.mesh = mesh;
      part.slots = slots;
      part.dirty = false;
    }
    this.capacity = required;
  }
}
