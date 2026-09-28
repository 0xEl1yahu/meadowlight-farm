/**
 * TileHighlighter — the 3D bounding-box indicator of the active tile.
 *
 * - Target: selectTargetTile(state) (a DDA ray from the centre of the player's tile along the
 *   facing vector), recomputed on every sync in O(1).
 * - Shape: a wireframe box slightly larger than the tile, drawn as 12 thin box "beams" in ONE
 *   InstancedMesh (thicker and more legible than GL lines), plus a small diamond floating above
 *   it. The box stands on the tile's own ground (soil, grass or water surface) and is taller
 *   when the tile holds something (rock, stump, crop, water, shipping bin, house).
 * - Colour, unlit so it reads at night: cream-white when the selected item's primary action
 *   would do something, warm gold when only the context interaction would (harvest, ship,
 *   sleep, refill), soft red and dimmer otherwise. Validity comes from state/intents.ts — the
 *   same planner the reducer executes — so the preview and the outcome never disagree.
 * - Motion: exponential easing of position, size and colour between targets (~0.08 s), a gentle
 *   pulse, and a quick springy pop whenever the player acts. Hidden with a short fade when there
 *   is no target or a menu freezes the game.
 *
 * Nothing here allocates per frame; beam matrices are rewritten only while the box height is
 * animating.
 */
import * as THREE from 'three';
import { Blocker, type GameState, type Tile } from '../core/types';
import { CROPS, growthProgress } from '../farming/crops';
import { isActionable, planInteraction, planPrimaryAction } from '../state/intents';
import { selectIsFrozen, selectTargetTile } from '../state/selectors';
import { tileCenterX, tileCenterZ } from '../world/grid';
import { getTile, isSoil } from '../world/tiles';
import { HEIGHTS } from './constants';
import { PALETTE } from './palette';
import type { SceneContext } from './SceneContext';
import type { FrameContext, RenderSystem } from './types';

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

const BEAM_COUNT = 12;
/** Box footprint in tiles (slightly larger than the tile so it frames the contents). */
const FOOTPRINT = 1.04;
const BEAM_THICKNESS = 0.045;

/** Box heights (world units) by tile contents. */
const BOX_HEIGHT = {
  ground: 0.35,
  rock: 0.95,
  stump: 1.0,
  water: 0.9,
  shippingBin: 1.05,
  house: 1.2,
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

/** Height of the surface the box stands on. */
export function highlightGroundHeight(tile: Tile): number {
  if (tile.blocker === Blocker.Water) return HEIGHTS.waterSurface;
  return isSoil(tile) ? HEIGHTS.soilTop : HEIGHTS.grassTop;
}

/** Box height for the tile's contents: low for bare ground, taller when something stands on it. */
export function highlightBoxHeight(tile: Tile): number {
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
    state.world !== prev.world ||
    state.ui !== prev.ui ||
    state.time.season !== prev.time.season ||
    state.time.absoluteDay !== prev.time.absoluteDay
  );
}

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

  /** Whether the latest state wants the indicator shown. */
  private active = false;
  /** Fade-in/out factor in [0, 1]. */
  private presence = 0;
  private readonly targetPosition = new THREE.Vector3();
  private height: number = BOX_HEIGHT.ground;
  private targetHeight: number = BOX_HEIGHT.ground;
  /** Height the beam matrices were last laid out for (NaN = never). */
  private layoutHeight = Number.NaN;
  private readonly targetColor = new THREE.Color(PALETTE.highlightValid);
  private opacity = 0;
  private targetOpacity = 0;
  private popElapsed = Number.POSITIVE_INFINITY;
  private popAmplitude = 0;
  private actionSeq = -1;

  constructor(ctx: SceneContext) {
    this.ctx = ctx;

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
    this.group.add(this.beams, this.marker);
    this.group.visible = false;
    this.layoutBeams(this.height);
    ctx.scene.add(this.group);
  }

  sync(state: GameState, prev: GameState | null): void {
    if (prev !== null && !affectsHighlight(state, prev)) return;
    const rebuild = prev === null;
    const { player } = state;
    const actionChanged = player.actionSeq !== this.actionSeq;
    this.actionSeq = player.actionSeq;

    const target = selectIsFrozen(state) ? null : selectTargetTile(state);
    const tile = target === null ? null : getTile(state.world, target.tx, target.tz);
    if (target === null || tile === null) {
      this.active = false;
      if (rebuild) this.hideNow();
      return;
    }

    const grid = state.world.grid;
    this.targetPosition.set(tileCenterX(grid, target.tx), highlightGroundHeight(tile), tileCenterZ(grid, target.tz));
    this.targetHeight = highlightBoxHeight(tile);
    const style = STYLES[validityFor(state)];
    this.targetColor.setHex(style.color);
    this.targetOpacity = style.opacity;
    this.active = true;

    // Appearing (boot, load, menu closed): start in place instead of sweeping in from afar.
    if (rebuild || this.presence < 0.05) {
      this.group.position.copy(this.targetPosition);
      this.height = this.targetHeight;
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
    }
    if (!(Math.abs(this.height - this.layoutHeight) <= 1e-4)) this.layoutBeams(this.height);

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
    const footprint = 1 + PULSE_SCALE * wave + pop;
    const lift = 1 + pop * 0.6;
    this.beams.scale.set(footprint, lift, footprint);
    this.material.opacity = clamp(this.opacity * (1 + PULSE_OPACITY * wave) * this.presence, 0, 1);

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
  }

  private hideNow(): void {
    this.presence = 0;
    this.popElapsed = Number.POSITIVE_INFINITY;
    this.material.opacity = 0;
    this.group.visible = false;
  }

  /**
   * Places the 12 beams of a box with footprint FOOTPRINT tiles and the given height, standing
   * on the group origin: 4 bottom edges, 4 top edges, then 4 vertical edges.
   */
  private layoutBeams(height: number): void {
    const tileSize = this.ctx.grid.tileSize;
    const t = BEAM_THICKNESS;
    const half = (FOOTPRINT * tileSize) / 2;
    const span = FOOTPRINT * tileSize + t;
    const h = Math.max(height, t * 2);
    let index = 0;
    for (let ring = 0; ring < 2; ring++) {
      const y = ring === 0 ? t / 2 : h - t / 2;
      for (let side = -1; side <= 1; side += 2) {
        this.setBeam(index++, 0, y, side * half, span, t, t);
        this.setBeam(index++, side * half, y, 0, t, t, span);
      }
    }
    for (let sx = -1; sx <= 1; sx += 2) {
      for (let sz = -1; sz <= 1; sz += 2) {
        this.setBeam(index++, sx * half, h / 2, sz * half, t, h, t);
      }
    }
    this.beams.instanceMatrix.needsUpdate = true;
    this.beams.computeBoundingSphere();
    this.layoutHeight = height;
  }

  private setBeam(index: number, x: number, y: number, z: number, sx: number, sy: number, sz: number): void {
    scratchMatrix.makeScale(sx, sy, sz).setPosition(x, y, z);
    this.beams.setMatrixAt(index, scratchMatrix);
  }
}
