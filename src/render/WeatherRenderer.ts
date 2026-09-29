/**
 * Precipitation: rain streaks with splash rings, and drifting snowflakes.
 *
 * Particle volume
 * - Particles live in world space (so rain does not slide with the player) inside a
 *   view-aligned parallelepiped around the camera focus: across the screen it spans the view
 *   width, and along the view it is sheared by the camera pitch so that every particle's
 *   ground-projected point (where the view ray through it meets the ground) lies inside the
 *   visible rectangle. Particles that leave the box are wrapped to the opposite side, which keeps
 *   the density uniform when the camera moves or zooms (the box follows ctx.rig.viewHeight and
 *   the camera aspect).
 * - State is kept in Float32Arrays (position, velocity, per-particle parameters). Matrices are
 *   written straight into the instance buffer: a particle's orientation / scale columns are
 *   written once when it spawns, and each frame only its translation changes. Only the live
 *   range of the buffer is uploaded.
 *
 * Weather
 * - Rain ~700 streaks, storms ~1300 faster, longer, more slanted streaks; snow ~850 flakes that
 *   sway as they fall. Sunny draws nothing (meshes hidden).
 * - When the weather changes, active counts ramp over ~1.5 s, so rain and snow cross-fade.
 * - Unlit materials are dimmed at night using the lighting keyframes' daylight factor.
 */
import * as THREE from 'three';
import { mulberry32 } from '../core/hash';
import { Blocker, TileState, Weather, type GameState, type WorldState } from '../core/types';
import { CAMERA, HEIGHTS } from './constants';
import { sampleDaylight } from './LightingManager';
import type { SceneContext } from './SceneContext';
import type { FrameContext, RenderSystem } from './types';
import { selectActiveWorld } from '../state/selectors';

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

interface RainStyle {
  /** Active drops. */
  readonly count: number;
  /** Downward speed (world units / s). */
  readonly fallSpeed: number;
  /** Horizontal wind velocity (world units / s). */
  readonly windX: number;
  readonly windZ: number;
  /** Streak length (world units). */
  readonly length: number;
}

const RAIN_STYLE: RainStyle = { count: 700, fallSpeed: 15, windX: 1.5, windZ: -0.9, length: 0.62 };
const STORM_STYLE: RainStyle = { count: 1300, fallSpeed: 19, windX: 3.8, windZ: -2.4, length: 0.85 };

const RAIN = {
  capacity: 1400,
  /** ± fraction of per-drop speed variation. */
  speedJitter: 0.16,
  /** ± fraction of per-drop length variation. */
  lengthJitter: 0.2,
  /** Streak width at the default view height; scaled with zoom so it stays ~2 px wide. */
  width: 0.034,
  /** Spawn height above the ground (world units) and random extra height for staggering. */
  spawnHeight: 11,
  spawnJitter: 2,
  dayColor: 0xdcebff,
  nightColor: 0x93a7d8,
  opacity: 0.55,
} as const;

const SNOW = {
  capacity: 900,
  count: 850,
  fallSpeed: 1.05,
  speedJitter: 0.35,
  windX: 0.45,
  windZ: -0.25,
  /** Sideways sway (world units) and its angular frequency (rad / s). */
  swayAmplitude: 0.32,
  swayFrequency: 1.2,
  sizeMin: 0.045,
  sizeMax: 0.085,
  spawnHeight: 10,
  spawnJitter: 1.5,
  dayColor: 0xffffff,
  nightColor: 0xc6d1f2,
  opacity: 0.92,
} as const;

const SPLASH = {
  capacity: 192,
  /** Fraction of landing drops that leave a ring (keeps the pool small). */
  chance: 0.22,
  /** Seconds a ring lives. */
  life: 0.32,
  radiusStart: 0.04,
  radiusEnd: 0.24,
  /** Lift above the surface to avoid z-fighting. */
  lift: 0.012,
  dayColor: 0xb8d2f0,
  nightColor: 0x5d6f99,
} as const;

/** Seconds for the active count to go from 0 to full capacity. */
const CROSSFADE_SECONDS = 1.5;
/** Extra margin around the visible view (world units). */
const VIEW_MARGIN = 1.5;
const GROUND_Y = HEIGHTS.grassTop;
const TWO_PI = Math.PI * 2;

// ---------------------------------------------------------------------------
// View basis (the camera orientation is fixed, see CameraRig)
// ---------------------------------------------------------------------------

const YAW = CAMERA.yawDeg * (Math.PI / 180);
const PITCH = CAMERA.pitchDeg * (Math.PI / 180);
/** Screen-right direction on the ground plane. */
const RIGHT_X = Math.cos(YAW);
const RIGHT_Z = -Math.sin(YAW);
/** Ground direction pointing away from the camera (screen-up on the ground). */
const FORWARD_X = -Math.sin(YAW);
const FORWARD_Z = -Math.cos(YAW);
/** Horizontal distance a view ray travels per unit of height. */
const COT_PITCH = Math.cos(PITCH) / Math.sin(PITCH);
const SIN_PITCH = Math.sin(PITCH);
/** Unit vector toward the camera; used as the (unused) third column of streak matrices. */
const TOWARD_CAMERA = new THREE.Vector3(
  Math.sin(YAW) * Math.cos(PITCH),
  Math.sin(PITCH),
  Math.cos(YAW) * Math.cos(PITCH),
).normalize();

/** Wraps `value` into [-half, half]. */
function wrapSymmetric(value: number, half: number): number {
  if (value >= -half && value <= half) return value;
  const span = half * 2;
  if (span <= 0) return 0;
  return ((((value + half) % span) + span) % span) - half;
}

function styleFor(weather: Weather): RainStyle {
  return weather === Weather.Storm ? STORM_STYLE : RAIN_STYLE;
}

function rainTargetCount(weather: Weather): number {
  if (weather === Weather.Rain) return RAIN_STYLE.count;
  if (weather === Weather.Storm) return STORM_STYLE.count;
  return 0;
}

function snowTargetCount(weather: Weather): number {
  return weather === Weather.Snow ? SNOW.count : 0;
}

/** Moves `current` toward `target` by at most `maxStep`. */
function approach(current: number, target: number, maxStep: number): number {
  if (current < target) return Math.min(target, current + maxStep);
  if (current > target) return Math.max(target, current - maxStep);
  return current;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/**
 * A tapered streak in the local XY plane: head (width 1) at y = 0, thin tail at y = 1. The alpha
 * channel of the vertex colour fades the tail. Instance matrices map local X to screen-right and
 * local Y to "up the fall path".
 */
function createStreakGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0.2, 1, 0, -0.2, 1, 0]);
  const colors = new Float32Array([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0.12, 1, 1, 1, 0.12]);
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  return geometry;
}

/** Flat ring of unit outer radius lying on the XZ plane, facing +Y. */
function createSplashGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.RingGeometry(0.72, 1, 10, 1);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

// ---------------------------------------------------------------------------
// Scratch
// ---------------------------------------------------------------------------

const scratchMatrix = new THREE.Matrix4();
const scratchQuaternion = new THREE.Quaternion();
const scratchEuler = new THREE.Euler();
const scratchPosition = new THREE.Vector3();
const scratchScale = new THREE.Vector3();

/** Per-frame view box, recomputed once at the start of update. */
interface ViewBox {
  focusX: number;
  focusZ: number;
  /** Half extent across the screen (world units). */
  halfU: number;
  /** Half extent of the ground-projected point along the view (world units). */
  halfV: number;
  /** Multiplier that keeps streak width constant in pixels across zoom levels. */
  widthScale: number;
}

// ---------------------------------------------------------------------------
// WeatherRenderer
// ---------------------------------------------------------------------------

export class WeatherRenderer implements RenderSystem {
  private readonly ctx: SceneContext;
  private readonly random = mulberry32(0x7a1f00d5);
  private readonly view: ViewBox = { focusX: 0, focusZ: 0, halfU: 1, halfV: 1, widthScale: 1 };

  private targetWeather: Weather = Weather.Sunny;
  /** Last rainy weather; controls the style of newly spawned drops while rain fades out. */
  private rainStyle: RainStyle = RAIN_STYLE;
  private world: WorldState | null = null;

  // Rain
  private readonly rainGeometry: THREE.BufferGeometry;
  private readonly rainMaterial: THREE.MeshBasicMaterial;
  private readonly rainMesh: THREE.InstancedMesh;
  private readonly rainPosition = new Float32Array(RAIN.capacity * 3);
  private readonly rainVelocity = new Float32Array(RAIN.capacity * 3);
  private rainLevel = 0;
  private rainAlive = 0;

  // Splashes (dense: live rings occupy [0, splashAlive))
  private readonly splashGeometry: THREE.BufferGeometry;
  private readonly splashMaterial: THREE.MeshBasicMaterial;
  private readonly splashMesh: THREE.InstancedMesh;
  private readonly splashColorAttribute: THREE.InstancedBufferAttribute;
  private readonly splashPosition = new Float32Array(SPLASH.capacity * 3);
  private readonly splashAge = new Float32Array(SPLASH.capacity);
  private splashAlive = 0;
  private readonly splashColor = new THREE.Color();

  // Snow
  private readonly snowGeometry: THREE.BufferGeometry;
  private readonly snowMaterial: THREE.MeshBasicMaterial;
  private readonly snowMesh: THREE.InstancedMesh;
  private readonly snowPosition = new Float32Array(SNOW.capacity * 3);
  private readonly snowVelocity = new Float32Array(SNOW.capacity * 3);
  /** Per flake: sway phase, sway angular frequency. */
  private readonly snowSway = new Float32Array(SNOW.capacity * 2);
  private snowLevel = 0;
  private snowAlive = 0;

  private readonly rainDay = new THREE.Color(RAIN.dayColor);
  private readonly rainNight = new THREE.Color(RAIN.nightColor);
  private readonly snowDay = new THREE.Color(SNOW.dayColor);
  private readonly snowNight = new THREE.Color(SNOW.nightColor);
  private readonly splashDay = new THREE.Color(SPLASH.dayColor);
  private readonly splashNight = new THREE.Color(SPLASH.nightColor);

  constructor(ctx: SceneContext) {
    this.ctx = ctx;

    this.rainGeometry = createStreakGeometry();
    this.rainMaterial = new THREE.MeshBasicMaterial({
      color: RAIN.dayColor,
      vertexColors: true,
      transparent: true,
      opacity: RAIN.opacity,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.rainMesh = this.createParticleMesh(this.rainGeometry, this.rainMaterial, RAIN.capacity, 'weather:rain', 12);

    this.splashGeometry = createSplashGeometry();
    this.splashMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      // Additive rings fade to black; fog would instead add the (bright) fog colour.
      fog: false,
    });
    this.splashMesh = this.createParticleMesh(
      this.splashGeometry,
      this.splashMaterial,
      SPLASH.capacity,
      'weather:splash',
      11,
    );
    this.splashColorAttribute = new THREE.InstancedBufferAttribute(new Float32Array(SPLASH.capacity * 3), 3);
    this.splashColorAttribute.setUsage(THREE.DynamicDrawUsage);
    this.splashMesh.instanceColor = this.splashColorAttribute;

    this.snowGeometry = new THREE.OctahedronGeometry(1, 0);
    this.snowMaterial = new THREE.MeshBasicMaterial({
      color: SNOW.dayColor,
      transparent: true,
      opacity: SNOW.opacity,
      depthWrite: false,
    });
    this.snowMesh = this.createParticleMesh(this.snowGeometry, this.snowMaterial, SNOW.capacity, 'weather:snow', 12);

    ctx.scene.add(this.rainMesh, this.splashMesh, this.snowMesh);
  }

  sync(state: GameState, prev: GameState | null): void {
    this.world = selectActiveWorld(state);
    this.targetWeather = state.weather;
    if (state.weather === Weather.Rain || state.weather === Weather.Storm) this.rainStyle = styleFor(state.weather);
    if (prev === null) {
      // Full rebuild: show the target weather at full strength immediately. With no live
      // particles, the next update seeds the whole set inside the then-current view box (the
      // camera focus is only snapped to the player after the initial sync).
      this.rainLevel = rainTargetCount(state.weather);
      this.snowLevel = snowTargetCount(state.weather);
      this.rainAlive = 0;
      this.snowAlive = 0;
      this.splashAlive = 0;
    }
  }

  update(frame: FrameContext): void {
    const dt = Number.isFinite(frame.dt) && frame.dt > 0 ? frame.dt : 0;
    this.updateViewBox();

    this.rainLevel = approach(this.rainLevel, rainTargetCount(this.targetWeather), (RAIN.capacity / CROSSFADE_SECONDS) * dt);
    this.snowLevel = approach(this.snowLevel, snowTargetCount(this.targetWeather), (SNOW.capacity / CROSSFADE_SECONDS) * dt);
    this.resizeRain(Math.round(this.rainLevel));
    this.resizeSnow(Math.round(this.snowLevel));

    const anything = this.rainAlive > 0 || this.snowAlive > 0 || this.splashAlive > 0;
    if (anything) this.updateColors(frame.clockMinutes);

    this.stepRain(dt);
    this.stepSplashes(dt);
    this.stepSnow(dt, frame.elapsed);
  }

  dispose(): void {
    this.ctx.scene.remove(this.rainMesh, this.splashMesh, this.snowMesh);
    this.rainMesh.dispose();
    this.splashMesh.dispose();
    this.snowMesh.dispose();
    this.rainGeometry.dispose();
    this.splashGeometry.dispose();
    this.snowGeometry.dispose();
    this.rainMaterial.dispose();
    this.splashMaterial.dispose();
    this.snowMaterial.dispose();
    this.world = null;
  }

  // -------------------------------------------------------------------------
  // Setup helpers
  // -------------------------------------------------------------------------

  private createParticleMesh(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    capacity: number,
    name: string,
    renderOrder: number,
  ): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.name = name;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.renderOrder = renderOrder;
    return mesh;
  }

  /** Box around the focus that covers the visible view at the current zoom and aspect. */
  private updateViewBox(): void {
    const camera = this.ctx.camera;
    const viewHeight = this.ctx.rig.viewHeight;
    const frustumHeight = camera.top - camera.bottom;
    const frustumWidth = camera.right - camera.left;
    const aspect = frustumHeight > 0 && frustumWidth > 0 ? frustumWidth / frustumHeight : 16 / 9;
    const halfHeight = viewHeight / 2;
    const view = this.view;
    view.focusX = this.ctx.rig.focus.x;
    view.focusZ = this.ctx.rig.focus.z;
    view.halfU = halfHeight * aspect + VIEW_MARGIN;
    view.halfV = halfHeight / SIN_PITCH + VIEW_MARGIN;
    view.widthScale = viewHeight / CAMERA.viewHeight;
  }

  private updateColors(clockMinutes: number): void {
    const daylight = sampleDaylight(clockMinutes);
    this.rainMaterial.color.lerpColors(this.rainNight, this.rainDay, daylight);
    this.snowMaterial.color.lerpColors(this.snowNight, this.snowDay, daylight);
    this.splashColor.lerpColors(this.splashNight, this.splashDay, daylight);
  }

  // -------------------------------------------------------------------------
  // Rain
  // -------------------------------------------------------------------------

  private resizeRain(target: number): void {
    const count = Math.max(0, Math.min(RAIN.capacity, target));
    for (let i = this.rainAlive; i < count; i++) this.spawnDrop(i, false);
    this.rainAlive = count;
  }

  /** Places drop `i` in the view box (at the top, or anywhere in the column) and writes its basis. */
  private spawnDrop(i: number, fromTop: boolean): void {
    const random = this.random;
    const view = this.view;
    const style = this.rainStyle;

    const speedFactor = 1 + (random() * 2 - 1) * RAIN.speedJitter;
    const vx = style.windX * speedFactor;
    const vy = -style.fallSpeed * speedFactor;
    const vz = style.windZ * speedFactor;

    const height = fromTop ? RAIN.spawnHeight + random() * RAIN.spawnJitter : random() * RAIN.spawnHeight;
    const u = (random() * 2 - 1) * view.halfU;
    const v = (random() * 2 - 1) * view.halfV - height * COT_PITCH;

    const p = i * 3;
    this.rainPosition[p] = view.focusX + u * RIGHT_X + v * FORWARD_X;
    this.rainPosition[p + 1] = GROUND_Y + height;
    this.rainPosition[p + 2] = view.focusZ + u * RIGHT_Z + v * FORWARD_Z;
    this.rainVelocity[p] = vx;
    this.rainVelocity[p + 1] = vy;
    this.rainVelocity[p + 2] = vz;

    const speed = Math.hypot(vx, vy, vz);
    const length = style.length * (1 + (random() * 2 - 1) * RAIN.lengthJitter);
    const tail = speed > 0 ? length / speed : 0;
    const width = RAIN.width * view.widthScale;

    const e = this.rainMesh.instanceMatrix.array;
    const m = i * 16;
    // Column 0: streak width along screen-right.
    e[m] = RIGHT_X * width;
    e[m + 1] = 0;
    e[m + 2] = RIGHT_Z * width;
    e[m + 3] = 0;
    // Column 1: streak length pointing back up the fall path.
    e[m + 4] = -vx * tail;
    e[m + 5] = -vy * tail;
    e[m + 6] = -vz * tail;
    e[m + 7] = 0;
    // Column 2: keeps the matrix invertible (the streak is flat).
    e[m + 8] = TOWARD_CAMERA.x;
    e[m + 9] = TOWARD_CAMERA.y;
    e[m + 10] = TOWARD_CAMERA.z;
    e[m + 11] = 0;
    e[m + 15] = 1;
  }

  private stepRain(dt: number): void {
    const mesh = this.rainMesh;
    const alive = this.rainAlive;
    mesh.count = alive;
    mesh.visible = alive > 0;
    if (alive === 0) return;

    const view = this.view;
    const position = this.rainPosition;
    const velocity = this.rainVelocity;
    const e = mesh.instanceMatrix.array;

    for (let i = 0; i < alive; i++) {
      const p = i * 3;
      let x = (position[p] ?? 0) + (velocity[p] ?? 0) * dt;
      const y = (position[p + 1] ?? 0) + (velocity[p + 1] ?? 0) * dt;
      let z = (position[p + 2] ?? 0) + (velocity[p + 2] ?? 0) * dt;

      if (y <= GROUND_Y) {
        this.trySplash(x, z);
        this.spawnDrop(i, true);
      } else {
        // Wrap in view-aligned coordinates: u across the screen, g = ground-projected depth.
        const dx = x - view.focusX;
        const dz = z - view.focusZ;
        const u = dx * RIGHT_X + dz * RIGHT_Z;
        const v = dx * FORWARD_X + dz * FORWARD_Z;
        const lift = (y - GROUND_Y) * COT_PITCH;
        const g = v + lift;
        const wu = wrapSymmetric(u, view.halfU);
        const wg = wrapSymmetric(g, view.halfV);
        if (wu !== u || wg !== g) {
          const wv = wg - lift;
          x = view.focusX + wu * RIGHT_X + wv * FORWARD_X;
          z = view.focusZ + wu * RIGHT_Z + wv * FORWARD_Z;
        }
        position[p] = x;
        position[p + 1] = y;
        position[p + 2] = z;
      }

      const m = i * 16;
      e[m + 12] = position[p] ?? 0;
      e[m + 13] = position[p + 1] ?? 0;
      e[m + 14] = position[p + 2] ?? 0;
    }

    const attribute = mesh.instanceMatrix;
    attribute.clearUpdateRanges();
    attribute.addUpdateRange(0, alive * 16);
    attribute.needsUpdate = true;
  }

  // -------------------------------------------------------------------------
  // Splashes
  // -------------------------------------------------------------------------

  /** Surface height under a world point, or NaN where a splash should not appear. */
  private surfaceHeightAt(x: number, z: number): number {
    const world = this.world;
    if (world === null) return GROUND_Y;
    const grid = world.grid;
    const tx = Math.floor((x - grid.originX) / grid.tileSize);
    const tz = Math.floor((z - grid.originZ) / grid.tileSize);
    if (tx < 0 || tz < 0 || tx >= grid.width || tz >= grid.depth) return GROUND_Y;
    const cx = Math.floor(tx / grid.chunkSize);
    const cz = Math.floor(tz / grid.chunkSize);
    const chunk = world.chunks[cz * grid.chunksX + cx];
    if (chunk === undefined) return GROUND_Y;
    const tile = chunk.tiles[(tz - chunk.z0) * chunk.width + (tx - chunk.x0)];
    if (tile === undefined) return GROUND_Y;
    if (tile.blocker === Blocker.Water) return HEIGHTS.waterSurface;
    if (tile.state === TileState.Plowed || tile.state === TileState.Watered) return HEIGHTS.soilTop;
    if (tile.state === TileState.Blocked) return Number.NaN;
    return GROUND_Y;
  }

  private trySplash(x: number, z: number): void {
    if (this.splashAlive >= SPLASH.capacity) return;
    if (this.random() >= SPLASH.chance) return;
    const surface = this.surfaceHeightAt(x, z);
    if (Number.isNaN(surface)) return;
    const slot = this.splashAlive;
    const p = slot * 3;
    this.splashPosition[p] = x;
    this.splashPosition[p + 1] = surface + SPLASH.lift;
    this.splashPosition[p + 2] = z;
    this.splashAge[slot] = 0;
    // Rotation columns are constant (identity); only scale and translation change.
    const e = this.splashMesh.instanceMatrix.array;
    const m = slot * 16;
    e[m + 1] = 0;
    e[m + 2] = 0;
    e[m + 3] = 0;
    e[m + 4] = 0;
    e[m + 5] = 1;
    e[m + 6] = 0;
    e[m + 7] = 0;
    e[m + 8] = 0;
    e[m + 9] = 0;
    e[m + 11] = 0;
    e[m + 15] = 1;
    this.splashAlive = slot + 1;
  }

  private stepSplashes(dt: number): void {
    const mesh = this.splashMesh;
    const position = this.splashPosition;
    const age = this.splashAge;
    const e = mesh.instanceMatrix.array;
    const colors = this.splashColorAttribute.array;
    const base = this.splashColor;

    let i = 0;
    while (i < this.splashAlive) {
      const a = (age[i] ?? 0) + dt;
      if (a >= SPLASH.life) {
        // Swap-remove: move the last live ring into this slot and process it next.
        const last = this.splashAlive - 1;
        if (i !== last) this.copySplash(last, i);
        this.splashAlive = last;
        continue;
      }
      age[i] = a;
      const t = a / SPLASH.life;
      const eased = 1 - (1 - t) * (1 - t);
      const radius = SPLASH.radiusStart + (SPLASH.radiusEnd - SPLASH.radiusStart) * eased;
      const fade = (1 - t) * (1 - t);
      const p = i * 3;
      const m = i * 16;
      e[m] = radius;
      e[m + 10] = radius;
      e[m + 12] = position[p] ?? 0;
      e[m + 13] = position[p + 1] ?? 0;
      e[m + 14] = position[p + 2] ?? 0;
      colors[p] = base.r * fade;
      colors[p + 1] = base.g * fade;
      colors[p + 2] = base.b * fade;
      i++;
    }

    const alive = this.splashAlive;
    mesh.count = alive;
    mesh.visible = alive > 0;
    if (alive === 0) return;
    const matrixAttribute = mesh.instanceMatrix;
    matrixAttribute.clearUpdateRanges();
    matrixAttribute.addUpdateRange(0, alive * 16);
    matrixAttribute.needsUpdate = true;
    const colorAttribute = this.splashColorAttribute;
    colorAttribute.clearUpdateRanges();
    colorAttribute.addUpdateRange(0, alive * 3);
    colorAttribute.needsUpdate = true;
  }

  private copySplash(from: number, to: number): void {
    const position = this.splashPosition;
    const f = from * 3;
    const t = to * 3;
    position[t] = position[f] ?? 0;
    position[t + 1] = position[f + 1] ?? 0;
    position[t + 2] = position[f + 2] ?? 0;
    this.splashAge[to] = this.splashAge[from] ?? SPLASH.life;
  }

  // -------------------------------------------------------------------------
  // Snow
  // -------------------------------------------------------------------------

  private resizeSnow(target: number): void {
    const count = Math.max(0, Math.min(SNOW.capacity, target));
    for (let i = this.snowAlive; i < count; i++) this.spawnFlake(i, false);
    this.snowAlive = count;
  }

  private spawnFlake(i: number, fromTop: boolean): void {
    const random = this.random;
    const view = this.view;

    const height = fromTop ? SNOW.spawnHeight + random() * SNOW.spawnJitter : random() * SNOW.spawnHeight;
    const u = (random() * 2 - 1) * view.halfU;
    const v = (random() * 2 - 1) * view.halfV - height * COT_PITCH;

    const p = i * 3;
    this.snowPosition[p] = view.focusX + u * RIGHT_X + v * FORWARD_X;
    this.snowPosition[p + 1] = GROUND_Y + height;
    this.snowPosition[p + 2] = view.focusZ + u * RIGHT_Z + v * FORWARD_Z;

    const drift = 0.7 + random() * 0.6;
    this.snowVelocity[p] = SNOW.windX * drift;
    this.snowVelocity[p + 1] = -SNOW.fallSpeed * (1 + (random() * 2 - 1) * SNOW.speedJitter);
    this.snowVelocity[p + 2] = SNOW.windZ * drift;

    const s = i * 2;
    this.snowSway[s] = random() * TWO_PI;
    this.snowSway[s + 1] = SNOW.swayFrequency * (0.7 + random() * 0.6);

    // Random tumble and size, baked into the instance's rotation / scale columns.
    const size = SNOW.sizeMin + (SNOW.sizeMax - SNOW.sizeMin) * random();
    scratchEuler.set(random() * Math.PI, random() * Math.PI, random() * Math.PI);
    scratchQuaternion.setFromEuler(scratchEuler);
    scratchPosition.set(0, 0, 0);
    scratchScale.set(size, size * 1.15, size);
    scratchMatrix.compose(scratchPosition, scratchQuaternion, scratchScale);
    const source = scratchMatrix.elements;
    const e = this.snowMesh.instanceMatrix.array;
    const m = i * 16;
    for (let k = 0; k < 12; k++) e[m + k] = source[k] ?? 0;
    e[m + 15] = 1;
  }

  private stepSnow(dt: number, elapsed: number): void {
    const mesh = this.snowMesh;
    const alive = this.snowAlive;
    mesh.count = alive;
    mesh.visible = alive > 0;
    if (alive === 0) return;

    const view = this.view;
    const position = this.snowPosition;
    const velocity = this.snowVelocity;
    const sway = this.snowSway;
    const e = mesh.instanceMatrix.array;

    for (let i = 0; i < alive; i++) {
      const p = i * 3;
      let x = (position[p] ?? 0) + (velocity[p] ?? 0) * dt;
      const y = (position[p + 1] ?? 0) + (velocity[p + 1] ?? 0) * dt;
      let z = (position[p + 2] ?? 0) + (velocity[p + 2] ?? 0) * dt;

      if (y <= GROUND_Y) {
        this.spawnFlake(i, true);
      } else {
        const dx = x - view.focusX;
        const dz = z - view.focusZ;
        const u = dx * RIGHT_X + dz * RIGHT_Z;
        const v = dx * FORWARD_X + dz * FORWARD_Z;
        const lift = (y - GROUND_Y) * COT_PITCH;
        const g = v + lift;
        const wu = wrapSymmetric(u, view.halfU);
        const wg = wrapSymmetric(g, view.halfV);
        if (wu !== u || wg !== g) {
          const wv = wg - lift;
          x = view.focusX + wu * RIGHT_X + wv * FORWARD_X;
          z = view.focusZ + wu * RIGHT_Z + wv * FORWARD_Z;
        }
        position[p] = x;
        position[p + 1] = y;
        position[p + 2] = z;
      }

      // Sway is an offset on top of the drifting base position, so wrapping stays exact.
      const s = i * 2;
      const phase = (sway[s] ?? 0) + elapsed * (sway[s + 1] ?? SNOW.swayFrequency);
      const m = i * 16;
      e[m + 12] = (position[p] ?? 0) + Math.sin(phase) * SNOW.swayAmplitude;
      e[m + 13] = position[p + 1] ?? 0;
      e[m + 14] = (position[p + 2] ?? 0) + Math.cos(phase * 0.8 + 1.1) * SNOW.swayAmplitude * 0.6;
    }

    const attribute = mesh.instanceMatrix;
    attribute.clearUpdateRanges();
    attribute.addUpdateRange(0, alive * 16);
    attribute.needsUpdate = true;
  }
}
