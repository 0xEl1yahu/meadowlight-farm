/**
 * TileHighlighter — the 3D bounding-box indicator of the active tile.
 *
 * - Target: selectTargetTile(state) (a DDA ray from the centre of the player's tile along the
 *   facing vector), recomputed on every sync in O(1). While seeds are selected the box frames
 *   the whole scatter patch instead (the axis-aligned bounds of selectScatterPatch), since a
 *   handful lands on every tile of it.
 * - Shape: a wireframe box slightly larger than the framed tiles, drawn as 12 thin box "beams"
 *   in ONE InstancedMesh (thicker and more legible than GL lines), plus a small diamond
 *   floating above its centre. The box stands on the tiles' ground (soil, grass, path or water
 *   surface; the highest one for a patch) and is taller when a tile holds something (a placed
 *   object, crop, rock, stump, tree, weeds, water, shipping bin, house or building).
 * - Map: everything reads the active map's world, and the grid is cached on every sync, so a
 *   map change (sync with prev = null) re-frames the box on the new grid without a sweep.
 * - Colour, unlit so it reads at night: cream-white when the selected item's primary action
 *   would do something, warm gold when only the context interaction would (harvest, ship,
 *   sleep, refill), soft red and dimmer otherwise. Validity comes from state/intents.ts — the
 *   same planner the reducer executes — so the preview and the outcome never disagree.
 * - Motion: exponential easing of position, footprint, height and colour between targets
 *   (~0.08 s), a gentle pulse, and a quick springy pop whenever the player acts. Pulse and pop
 *   move the box edges by the same distance whatever its footprint. Hidden with a short fade when there
 *   is no target or a menu freezes the game.
 *
 * - Placing: while a placeable item is selected, a translucent ghost of the object stands in the
 *   box (its own colours when it can go there, tinted red when it can't) and a sprinkler also
 *   shows the tiles it would water as flat blue plates.
 *
 * Nothing here allocates per frame; beam matrices are rewritten only while the box footprint or
 * height is animating.
 */
import * as THREE from 'three';
import { Blocker, type GameState, type GridSpec, type PlaceableItemId, type PlacedObjectKind, type Tile } from '../core/types';
import { isSprinklerKind, sprinklerCoverage } from '../farming/sprinklers';
import { CROPS, growthProgress } from '../farming/crops';
import { getItem } from '../items/items';
import { isActionable, planInteraction, planPrimaryAction } from '../state/intents';
import { selectedStack } from '../state/inventory';
import { selectActiveWorld, selectIsFrozen, selectScatterPatch, selectTargetTile } from '../state/selectors';
import { tileCenterX, tileCenterZ } from '../world/grid';
import { getTile, isPathObject, isSoil } from '../world/tiles';
import { HEIGHTS } from './constants';
import {
  createChestBodyGeometry,
  createQualitySprinklerGeometry,
  createScarecrowFrameGeometry,
  createSprinklerGeometry,
  createStonePathGeometry,
  createWoodFencePostGeometry,
  createWoodPathGeometry,
} from './objectGeometry';
import { PALETTE } from './palette';
import type { SceneContext } from './SceneContext';
import type { FrameContext, RenderSystem } from './types';

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

const BEAM_COUNT = 12;
/** Box footprint in tiles (slightly larger than the tile so it frames the contents). */
const FOOTPRINT = 1.04;
/** Extra footprint (tiles) around a multi-tile patch, matching the single-tile margin. */
const MARGIN = FOOTPRINT - 1;
const BEAM_THICKNESS = 0.045;

/** Box heights (world units) by tile contents. */
const BOX_HEIGHT = {
  ground: 0.35,
  rock: 0.95,
  stump: 1.0,
  water: 0.9,
  shippingBin: 1.05,
  house: 1.2,
  tree: 1.3,
  weeds: 0.6,
  building: 1.2,
  /** Placed objects, checked before crops and blockers. Paths are ground. */
  object: {
    chest: 0.8,
    sprinkler: 0.5,
    qualitySprinkler: 0.55,
    scarecrow: 1.4,
    woodFence: 0.9,
    woodPath: 0.35,
    stonePath: 0.35,
    giantCrop: 1.6,
    forage: 0.4,
    trophy: 0.9,
    decoration: 1.0,
  } satisfies Readonly<Record<PlacedObjectKind, number>>,
  cropMin: 0.9,
  cropMax: 1.3,
  /** Headroom added above a crop's current foliage height. */
  cropHeadroom: 0.4,
} as const;

/** Exponential rates (1/s). MOVE_RATE settles ~95 % of the way in 0.08 s. */
const MOVE_RATE = 36;
const COLOR_RATE = 18;
const FADE_RATE = 22;

const PULSE_RATE = 3.2;
const PULSE_SCALE = 0.025;
const PULSE_OPACITY = 0.12;

/** Pop = amplitude · e^(−decay·t) · sin(frequency·t): a springy overshoot that peaks at ~50 ms. */
const POP_SECONDS = 0.5;
const POP_DECAY = 9;
const POP_FREQUENCY = 24;
const POP_SUCCESS = 0.25;
const POP_FAILED = 0.15;

const MARKER_RADIUS = 0.09;
const MARKER_STRETCH = 1.45;
const MARKER_HOVER = 0.26;
const MARKER_BOB = 0.045;
const MARKER_BOB_RATE = 2.4;
const MARKER_SPIN = 1.6;

/** Per-beam brightness: a subtle depth cue that keeps the bottom outline strongest. */
const SHADE_BOTTOM = 1;
const SHADE_VERTICAL = 0.92;
const SHADE_TOP = 0.84;

const TWO_PI = Math.PI * 2;

type Validity = 'valid' | 'interact' | 'invalid';

interface HighlightStyle {
  readonly color: number;
  readonly opacity: number;
}

const STYLES: Readonly<Record<Validity, HighlightStyle>> = {
  valid: { color: PALETTE.highlightValid, opacity: 0.9 },
  interact: { color: 0xffcf5c, opacity: 0.92 },
  invalid: { color: PALETTE.highlightInvalid, opacity: 0.5 },
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Frame-rate independent smoothing factor for an exponential approach at `rate` (1/s). */
function damp(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}

/** Height of the surface the box stands on. A path object is ground: the box stands on its planks. */
export function highlightGroundHeight(tile: Tile): number {
  if (tile.blocker === Blocker.Water) return HEIGHTS.waterSurface;
  if (tile.object !== null && isPathObject(tile.object)) return HEIGHTS.pathTop;
  return isSoil(tile) ? HEIGHTS.soilTop : HEIGHTS.grassTop;
}

/**
 * Box height for the tile's contents: low for bare ground, taller when something stands on it.
 * A placed object is checked first (paths count as ground), then a crop, then the blocker.
 */
export function highlightBoxHeight(tile: Tile): number {
  if (tile.object !== null) return BOX_HEIGHT.object[tile.object.kind];
  if (tile.crop !== null) {
    const foliage = CROPS[tile.crop.cropId].visual.height * growthProgress(tile.crop);
    return clamp(foliage + BOX_HEIGHT.cropHeadroom, BOX_HEIGHT.cropMin, BOX_HEIGHT.cropMax);
  }
  switch (tile.blocker) {
    case Blocker.None:
      return BOX_HEIGHT.ground;
    case Blocker.Rock:
      return BOX_HEIGHT.rock;
    case Blocker.Stump:
      return BOX_HEIGHT.stump;
    case Blocker.Water:
      return BOX_HEIGHT.water;
    case Blocker.ShippingBin:
      return BOX_HEIGHT.shippingBin;
    case Blocker.House:
      return BOX_HEIGHT.house;
    case Blocker.Tree:
      return BOX_HEIGHT.tree;
    case Blocker.Weeds:
      return BOX_HEIGHT.weeds;
    case Blocker.Building:
      return BOX_HEIGHT.building;
  }
}

/**
 * Whether a state change can alter the target, its contents, the action plans or the pop:
 * plans read the player, inventory, world, UI, season (planting) and day (harvest yield).
 * Plain clock ticks within a day therefore cost nothing.
 */
function affectsHighlight(state: GameState, prev: GameState): boolean {
  return (
    state.player !== prev.player ||
    state.inventory !== prev.inventory ||
    selectActiveWorld(state) !== selectActiveWorld(prev) ||
    state.ui !== prev.ui ||
    state.time.season !== prev.time.season ||
    state.time.absoluteDay !== prev.time.absoluteDay
  );
}

/** Whether the selected hotbar item is a seed, whose handful covers the whole scatter patch. */
function holdsSeeds(state: GameState): boolean {
  const stack = selectedStack(state.inventory);
  return stack !== null && getItem(stack.itemId).kind === 'seed';
}

/** The placeable item selected on the hotbar, or null. */
function heldPlaceable(state: GameState): PlaceableItemId | null {
  const stack = selectedStack(state.inventory);
  if (stack === null) return null;
  const item = getItem(stack.itemId);
  return item.kind === 'placeable' ? item.id : null;
}

function createGhostGeometry(kind: PlaceableItemId): THREE.BufferGeometry {
  switch (kind) {
    case 'chest':
      return createChestBodyGeometry();
    case 'sprinkler':
      return createSprinklerGeometry();
    case 'qualitySprinkler':
      return createQualitySprinklerGeometry();
    case 'scarecrow':
      return createScarecrowFrameGeometry();
    case 'woodFence':
      return createWoodFencePostGeometry();
    case 'woodPath':
      return createWoodPathGeometry();
    case 'stonePath':
      return createStonePathGeometry(0);
  }
}

const GHOST_OPACITY = 0.55;
const COVERAGE_OPACITY = 0.45;
const COVERAGE_PLATES = 8;
const COVERAGE_SIZE = 0.82;
const COVERAGE_COLOR = 0x7fc8f0;

/** Whether using the selected item, or failing that the context interaction, would do anything. */
function validityFor(state: GameState): Validity {
  if (isActionable(planPrimaryAction(state))) return 'valid';
  if (isActionable(planInteraction(state))) return 'interact';
  return 'invalid';
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

const scratchMatrix = new THREE.Matrix4();
const scratchColor = new THREE.Color();

export class TileHighlighter implements RenderSystem {
  private readonly ctx: SceneContext;
  private readonly group = new THREE.Group();
  private readonly beamGeometry: THREE.BoxGeometry;
  private readonly markerGeometry: THREE.OctahedronGeometry;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly beams: THREE.InstancedMesh;
  private readonly marker: THREE.Mesh;
  /** Grid of the active map, cached on every sync (a map change arrives as a full sync). */
  private grid: GridSpec;

  /** Whether the latest state wants the indicator shown. */
  private active = false;
  /** Fade-in/out factor in [0, 1]. */
  private presence = 0;
  private readonly targetPosition = new THREE.Vector3();
  private height: number = BOX_HEIGHT.ground;
  private targetHeight: number = BOX_HEIGHT.ground;
  /** Box footprint along X and Z (world units). */
  private sizeX: number;
  private sizeZ: number;
  private targetSizeX: number;
  private targetSizeZ: number;
  /** Height and footprint the beam matrices were last laid out for (NaN = never). */
  private layoutHeight = Number.NaN;
  private layoutSizeX = Number.NaN;
  private layoutSizeZ = Number.NaN;
  private readonly targetColor = new THREE.Color(PALETTE.highlightValid);
  private opacity = 0;
  private targetOpacity = 0;
  private popElapsed = Number.POSITIVE_INFINITY;
  private popAmplitude = 0;
  private actionSeq = -1;
  private readonly ghostMaterial = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false,
  });
  private readonly ghost = new THREE.Mesh(new THREE.BufferGeometry(), this.ghostMaterial);
  private readonly ghostGeometries = new Map<PlaceableItemId, THREE.BufferGeometry>();
  private readonly plateGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  private readonly plateMaterial = new THREE.MeshBasicMaterial({
    color: COVERAGE_COLOR,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  private readonly plates = new THREE.InstancedMesh(this.plateGeometry, this.plateMaterial, COVERAGE_PLATES);

  constructor(ctx: SceneContext) {
    this.ctx = ctx;
    this.grid = ctx.grid;
    const tileFootprint = FOOTPRINT * ctx.grid.tileSize;
    this.sizeX = tileFootprint;
    this.sizeZ = tileFootprint;
    this.targetSizeX = tileFootprint;
    this.targetSizeZ = tileFootprint;

    this.material = new THREE.MeshBasicMaterial({
      color: PALETTE.highlightValid,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });

    this.beamGeometry = new THREE.BoxGeometry(1, 1, 1);
    this.beams = new THREE.InstancedMesh(this.beamGeometry, this.material, BEAM_COUNT);
    this.beams.name = 'tile-highlight-beams';
    this.beams.castShadow = false;
    this.beams.receiveShadow = false;
    this.beams.renderOrder = 2;
    // Instance colours must exist before the first render; they encode the per-beam shade.
    for (let i = 0; i < BEAM_COUNT; i++) {
      const shade = i < 4 ? SHADE_BOTTOM : i < 8 ? SHADE_TOP : SHADE_VERTICAL;
      this.beams.setColorAt(i, scratchColor.setScalar(shade));
    }
    if (this.beams.instanceColor !== null) this.beams.instanceColor.needsUpdate = true;

    this.markerGeometry = new THREE.OctahedronGeometry(MARKER_RADIUS, 0);
    this.markerGeometry.scale(1, MARKER_STRETCH, 1);
    this.marker = new THREE.Mesh(this.markerGeometry, this.material);
    this.marker.name = 'tile-highlight-marker';
    this.marker.castShadow = false;
    this.marker.receiveShadow = false;
    this.marker.renderOrder = 2;

    this.group.name = 'tile-highlight';
    this.ghost.name = 'tile-highlight-ghost';
    this.ghost.visible = false;
    this.ghost.renderOrder = 1;
    this.plates.name = 'tile-highlight-coverage';
    this.plates.count = 0;
    this.plates.renderOrder = 1;
    this.plates.frustumCulled = false;
    this.group.add(this.beams, this.marker, this.ghost, this.plates);
    this.group.visible = false;
    this.layoutBeams();
    ctx.scene.add(this.group);
  }

  sync(state: GameState, prev: GameState | null): void {
    if (prev !== null && !affectsHighlight(state, prev)) return;
    this.grid = selectActiveWorld(state).grid;
    const rebuild = prev === null;
    const { player } = state;
    const actionChanged = player.actionSeq !== this.actionSeq;
    this.actionSeq = player.actionSeq;

    const framed = !selectIsFrozen(state) && (holdsSeeds(state) ? this.framePatch(state) : this.frameTile(state));
    if (!framed) {
      this.active = false;
      if (rebuild) this.hideNow();
      return;
    }

    const validity = validityFor(state);
    this.syncGhost(state, validity === 'valid');
    const style = STYLES[validity];
    this.targetColor.setHex(style.color);
    this.targetOpacity = style.opacity;
    this.active = true;

    // Appearing (boot, load, menu closed): start in place instead of sweeping in from afar.
    if (rebuild || this.presence < 0.05) {
      this.group.position.copy(this.targetPosition);
      this.height = this.targetHeight;
      this.sizeX = this.targetSizeX;
      this.sizeZ = this.targetSizeZ;
      this.material.color.copy(this.targetColor);
      this.opacity = this.targetOpacity;
    }

    const action = player.lastAction;
    if (!rebuild && actionChanged && action !== null && action.kind !== 'sleep') {
      this.popElapsed = 0;
      this.popAmplitude = action.success ? POP_SUCCESS : POP_FAILED;
    }
  }

  update(frame: FrameContext): void {
    const dt = frame.dt;
    this.presence += ((this.active ? 1 : 0) - this.presence) * damp(FADE_RATE, dt);
    if (!this.active && this.presence < 0.01) {
      if (this.group.visible) this.hideNow();
      return;
    }
    this.group.visible = true;

    if (this.active) {
      const follow = damp(MOVE_RATE, dt);
      this.group.position.lerp(this.targetPosition, follow);
      this.height += (this.targetHeight - this.height) * follow;
      this.sizeX += (this.targetSizeX - this.sizeX) * follow;
      this.sizeZ += (this.targetSizeZ - this.sizeZ) * follow;
    }
    // Negated comparisons so a NaN layout (never laid out) always counts as stale.
    if (
      !(Math.abs(this.height - this.layoutHeight) <= 1e-4) ||
      !(Math.abs(this.sizeX - this.layoutSizeX) <= 1e-4) ||
      !(Math.abs(this.sizeZ - this.layoutSizeZ) <= 1e-4)
    ) {
      this.layoutBeams();
    }

    const tint = damp(COLOR_RATE, dt);
    this.material.color.lerp(this.targetColor, tint);
    this.opacity += (this.targetOpacity - this.opacity) * tint;

    let pop = 0;
    if (this.popElapsed < POP_SECONDS) {
      this.popElapsed += dt;
      const t = this.popElapsed;
      pop = t < POP_SECONDS ? this.popAmplitude * Math.exp(-POP_DECAY * t) * Math.sin(POP_FREQUENCY * t) : 0;
    }

    const elapsed = frame.elapsed;
    const wave = Math.sin(elapsed * PULSE_RATE);
    // Scale relative to a single tile's box so a wide patch breathes by the same distance.
    const swell = PULSE_SCALE * wave + pop;
    const tileFootprint = FOOTPRINT * this.grid.tileSize;
    const lift = 1 + pop * 0.6;
    this.beams.scale.set(
      1 + (swell * tileFootprint) / this.sizeX,
      lift,
      1 + (swell * tileFootprint) / this.sizeZ,
    );
    this.material.opacity = clamp(this.opacity * (1 + PULSE_OPACITY * wave) * this.presence, 0, 1);
    this.ghostMaterial.opacity = GHOST_OPACITY * this.presence;
    this.plateMaterial.opacity = COVERAGE_OPACITY * this.presence;

    this.marker.position.y = this.height * lift + MARKER_HOVER + MARKER_BOB * Math.sin(elapsed * MARKER_BOB_RATE);
    this.marker.rotation.y = (elapsed * MARKER_SPIN + pop * 6) % TWO_PI;
    this.marker.scale.setScalar(1 + pop * 1.5);
  }

  dispose(): void {
    this.ctx.scene.remove(this.group);
    this.group.clear();
    this.beams.dispose();
    this.beamGeometry.dispose();
    this.markerGeometry.dispose();
    this.material.dispose();
    for (const geometry of this.ghostGeometries.values()) geometry.dispose();
    this.ghost.geometry.dispose();
    this.ghostMaterial.dispose();
    this.plates.dispose();
    this.plateGeometry.dispose();
    this.plateMaterial.dispose();
  }

  /**
   * Shows a ghost of the selected placeable (tinted when it can't go on the target) and, for a
   * sprinkler, a plate on every tile it would water, laid out relative to the box's origin.
   */
  private syncGhost(state: GameState, valid: boolean): void {
    const kind = heldPlaceable(state);
    this.ghost.visible = kind !== null;
    this.plates.count = 0;
    if (kind === null) return;
    let geometry = this.ghostGeometries.get(kind);
    if (geometry === undefined) {
      geometry = createGhostGeometry(kind);
      this.ghostGeometries.set(kind, geometry);
    }
    this.ghost.geometry = geometry;
    const ts = this.grid.tileSize;
    this.ghost.scale.setScalar(ts);
    this.ghostMaterial.color.setHex(valid ? 0xffffff : PALETTE.highlightInvalid);
    if (!isSprinklerKind(kind)) return;
    const coverage = sprinklerCoverage(kind, 0, 0);
    coverage.forEach((c, i) => {
      scratchMatrix.makeScale(COVERAGE_SIZE * ts, 1, COVERAGE_SIZE * ts).setPosition(c.tx * ts, 0.02, c.tz * ts);
      this.plates.setMatrixAt(i, scratchMatrix);
    });
    this.plates.count = coverage.length;
    this.plates.instanceMatrix.needsUpdate = true;
  }

  /** Targets the active tile alone. Returns false when there is none. */
  private frameTile(state: GameState): boolean {
    const target = selectTargetTile(state);
    const tile = target === null ? null : getTile(selectActiveWorld(state), target.tx, target.tz);
    if (target === null || tile === null) return false;
    const grid = this.grid;
    const footprint = FOOTPRINT * grid.tileSize;
    this.targetPosition.set(tileCenterX(grid, target.tx), highlightGroundHeight(tile), tileCenterZ(grid, target.tz));
    this.targetHeight = highlightBoxHeight(tile);
    this.targetSizeX = footprint;
    this.targetSizeZ = footprint;
    return true;
  }

  /**
   * Targets the bounding rectangle of the scatter patch, standing on the highest ground under it
   * and as tall as its tallest contents. Returns false when the patch is empty (off the grid).
   */
  private framePatch(state: GameState): boolean {
    const world = selectActiveWorld(state);
    const grid = this.grid;
    let minTx = Number.POSITIVE_INFINITY;
    let maxTx = Number.NEGATIVE_INFINITY;
    let minTz = Number.POSITIVE_INFINITY;
    let maxTz = Number.NEGATIVE_INFINITY;
    let ground = Number.NEGATIVE_INFINITY;
    let height = 0;
    for (const coord of selectScatterPatch(state)) {
      const tile = getTile(world, coord.tx, coord.tz);
      if (tile === null) continue;
      minTx = Math.min(minTx, coord.tx);
      maxTx = Math.max(maxTx, coord.tx);
      minTz = Math.min(minTz, coord.tz);
      maxTz = Math.max(maxTz, coord.tz);
      ground = Math.max(ground, highlightGroundHeight(tile));
      height = Math.max(height, highlightBoxHeight(tile));
    }
    if (ground === Number.NEGATIVE_INFINITY) return false;
    const ts = grid.tileSize;
    this.targetPosition.set(
      (tileCenterX(grid, minTx) + tileCenterX(grid, maxTx)) / 2,
      ground,
      (tileCenterZ(grid, minTz) + tileCenterZ(grid, maxTz)) / 2,
    );
    this.targetHeight = height;
    this.targetSizeX = (maxTx - minTx + 1 + MARGIN) * ts;
    this.targetSizeZ = (maxTz - minTz + 1 + MARGIN) * ts;
    return true;
  }

  private hideNow(): void {
    this.presence = 0;
    this.popElapsed = Number.POSITIVE_INFINITY;
    this.material.opacity = 0;
    this.group.visible = false;
  }

  /**
   * Places the 12 beams of a box with the current footprint (sizeX × sizeZ) and height, centred
   * on and standing on the group origin: 4 bottom edges, 4 top edges, then 4 vertical edges.
   */
  private layoutBeams(): void {
    const t = BEAM_THICKNESS;
    const halfX = this.sizeX / 2;
    const halfZ = this.sizeZ / 2;
    const spanX = this.sizeX + t;
    const spanZ = this.sizeZ + t;
    const h = Math.max(this.height, t * 2);
    let index = 0;
    for (let ring = 0; ring < 2; ring++) {
      const y = ring === 0 ? t / 2 : h - t / 2;
      for (let side = -1; side <= 1; side += 2) {
        this.setBeam(index++, 0, y, side * halfZ, spanX, t, t);
        this.setBeam(index++, side * halfX, y, 0, t, t, spanZ);
      }
    }
    for (let sx = -1; sx <= 1; sx += 2) {
      for (let sz = -1; sz <= 1; sz += 2) {
        this.setBeam(index++, sx * halfX, h / 2, sz * halfZ, t, h, t);
      }
    }
    this.beams.instanceMatrix.needsUpdate = true;
    this.beams.computeBoundingSphere();
    this.layoutHeight = this.height;
    this.layoutSizeX = this.sizeX;
    this.layoutSizeZ = this.sizeZ;
  }

  private setBeam(index: number, x: number, y: number, z: number, sx: number, sy: number, sz: number): void {
    scratchMatrix.makeScale(sx, sy, sz).setPosition(x, y, z);
    this.beams.setMatrixAt(index, scratchMatrix);
  }
}
