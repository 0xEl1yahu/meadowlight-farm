/**
 * Feedback particles: the small bursts that make every action feel physical — clods from the
 * hoe, a stream of droplets from the watering can, chips from rocks and stumps, produce and
 * sparkles on harvest, gold glints at the shipping bin and a dust puff when a tool whiffs.
 *
 * Rendering
 * - One InstancedMesh of a tiny flat-shaded tetrahedron is the whole particle pool, so every
 *   effect together costs a single draw call (and none at all while the pool is empty).
 * - Live particles are packed into slots [0, count). A dying particle is replaced by the last
 *   live one (swap-remove), so `mesh.count` is always the live count and nothing hidden or
 *   zero-scaled is ever drawn. When the pool is full the oldest-ish slot is recycled.
 * - Particle state lives in typed arrays (structure of arrays). Colours are written straight
 *   into the pre-allocated instanceColor buffer, and a per-instance `aGlow` attribute adds a
 *   colour-matched emissive term so sparkles read as light even in shadow or at night.
 *
 * Simulation
 * - Gravity, exponential drag, a bounce against the surface of the tile the burst came from
 *   that decays into resting on the ground with sliding friction, spin about a random axis,
 *   a quick pop-in and a smooth shrink-out over the last part of each particle's life.
 * - A particle can carry a start delay (it stays hidden until the delay elapses), which turns
 *   a burst into a stream: the watering can pours rather than explodes.
 * - A particle can splash on landing (spawning a couple of tiny droplets) and can have its
 *   remaining life cut short when it lands (droplets soak in, clods settle and fade).
 *
 * Triggers
 * - sync() compares player.actionSeq with the previous state. A change means the reducer
 *   recorded a new ActionEvent in player.lastAction. The previous state's tile tells what was
 *   there before the action: the crop that was harvested, whether a rock was destroyed.
 * - The spread of each burst is deterministic: mulberry32 seeded from the action sequence
 *   number and the target tile (Salt.Cosmetic), so replaying a session replays its sparkle.
 */
import * as THREE from 'three';
import { LAYOUT } from '../config';
import { Salt, hash32, mulberry32 } from '../core/hash';
import {
  Blocker,
  TOOL_TYPES,
  TileState,
  type ActionEvent,
  type ActionKind,
  type GameState,
  type GridSpec,
  type Tile,
  type TileCoord,
  type ToolType,
} from '../core/types';
import { CROPS } from '../farming/crops';
import { DIRECTION_STEPS, rectContains, tileCenterX, tileCenterZ, tileMinX, tileMinZ } from '../world/grid';
import { getTile, isSoil } from '../world/tiles';
import { HEIGHTS } from './constants';
import { createFlatMaterial } from './materials';
import { PALETTE } from './palette';
import type { SceneContext } from './SceneContext';
import type { FrameContext, RenderSystem } from './types';

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

/** Maximum number of simultaneously live particles. */
const CAPACITY = 800;
const TAU = Math.PI * 2;

const SIM = {
  /** Seconds a new particle takes to scale up from nothing. */
  popInSeconds: 0.05,
  /** Final fraction of a particle's life spent shrinking out. */
  shrinkFraction: 0.35,
  /** Resting height of a particle's centre above the floor, as a fraction of its size. */
  restRadius: 0.3,
  /** After a bounce, upward speeds below this settle the particle onto the ground. */
  settleSpeed: 0.5,
  /** Sliding and spin friction while resting on the ground (1/s). */
  groundFriction: 7,
  /** Twinkle oscillation speed (rad/s). */
  twinkleRate: 22,
} as const;

/** Where struck props and held tools sit, so bursts spring from believable points. */
const ANCHORS = {
  /** Height above the ground where the pickaxe strikes a rock. */
  rockStrike: 0.3,
  /** Height above the ground where the axe strikes a stump. */
  stumpStrike: 0.28,
  /** Height of the shipping bin's lid. */
  binLid: 0.85,
  /** Crop bursts start at this fraction of the crop's mature height. */
  cropCentre: 0.5,
  /** Watering can spout: height above the ground and reach ahead of the player's tile centre. */
  spoutHeight: 0.72,
  spoutReach: 0.42,
} as const;

interface Range {
  readonly min: number;
  readonly max: number;
}

function range(min: number, max: number): Range {
  return { min, max };
}

function sample(r: Range, t: number): number {
  return r.min + (r.max - r.min) * t;
}

/** Declarative description of one burst of particles. */
interface BurstSpec {
  readonly count: number;
  /** sRGB hex colours; each particle picks one at random. */
  readonly colors: readonly number[];
  /** ± HSL lightness jitter per particle. */
  readonly shade: number;
  /** Half-extent of the square spawn area around the burst origin (world units). */
  readonly spread: number;
  /** Random extra spawn height above the origin. */
  readonly lift: number;
  /** Horizontal launch speed (units/s) in a random heading. */
  readonly speed: Range;
  /** Vertical launch speed (units/s). */
  readonly rise: Range;
  /** Particle edge size (world units). */
  readonly size: Range;
  /** Lifetime (s). */
  readonly life: Range;
  /** Start delays are spread uniformly over [0, stagger] seconds. */
  readonly stagger: number;
  /** Downward acceleration (units/s²). Negative values make particles drift upward. */
  readonly gravity: number;
  /** Exponential velocity damping (1/s). */
  readonly drag: number;
  /** Restitution when hitting the floor (0 = no bounce). */
  readonly bounce: number;
  /** Maximum spin speed (rad/s). */
  readonly spin: number;
  /** Emissive strength as a multiple of the particle's own colour. */
  readonly glow: number;
  /** 0 = steady size, up to ~0.7 = strong twinkle. */
  readonly twinkle: number;
  /** When > 0, life remaining after first touching the floor is capped to this many seconds. */
  readonly landLife: number;
  /** Tiny droplets spawned when the particle first lands. */
  readonly splash: number;
  /** Extra horizontal speed along the emit point's push direction. */
  readonly push: number;
}

const BURST_DEFAULTS: BurstSpec = {
  count: 8,
  colors: [0xffffff],
  shade: 0.03,
  spread: 0.15,
  lift: 0.05,
  speed: range(0.5, 1.2),
  rise: range(2, 3),
  size: range(0.07, 0.12),
  life: range(0.7, 1),
  stagger: 0,
  gravity: 14,
  drag: 0.6,
  bounce: 0.3,
  spin: 10,
  glow: 0,
  twinkle: 0,
  landLife: 0,
  splash: 0,
  push: 0,
};

function burst(overrides: Partial<BurstSpec>): BurstSpec {
  return { ...BURST_DEFAULTS, ...overrides };
}

const SOIL_COLORS = [PALETTE.soilPlowed, PALETTE.soilFurrow, PALETTE.earthSide, PALETTE.soilWatered] as const;
const STONE_COLORS = [PALETTE.rock, PALETTE.rockDark, 0xd9d6e6] as const;
const WOOD_COLORS = [PALETTE.stumpBark, PALETTE.stumpTop, PALETTE.treeTrunk] as const;
const WATER_COLORS = [PALETTE.water, PALETTE.waterDeep, 0xdff6ff] as const;
const WITHERED_COLORS = [0xcdb67f, 0xb49a68, 0x9a8458, 0xd9c79a] as const;
const DUST_COLORS = [0xefe9df, 0xe1dace, 0xd3cbbd] as const;

const EFFECTS = {
  /** Hoe: soil flung forward out of the new furrow. */
  clods: burst({
    count: 10,
    colors: SOIL_COLORS,
    spread: 0.2,
    speed: range(0.4, 1.3),
    rise: range(2, 3.2),
    size: range(0.07, 0.13),
    life: range(0.8, 1.2),
    bounce: 0.25,
    landLife: 0.4,
    push: 0.7,
  }),
  /** A lighter sprinkle of soil when soil is cleared rather than dug. */
  clodsLight: burst({
    count: 5,
    colors: SOIL_COLORS,
    spread: 0.2,
    speed: range(0.3, 1),
    rise: range(1.6, 2.6),
    size: range(0.06, 0.1),
    life: range(0.7, 1),
    bounce: 0.2,
    landLife: 0.35,
    push: 0.4,
  }),
  /** Torn-up grass blades when grass is tilled (or soil reverts to grass). */
  grassBits: burst({
    count: 6,
    colors: [PALETTE.grassTuft, ...PALETTE.grass],
    spread: 0.25,
    speed: range(0.5, 1.2),
    rise: range(1.6, 2.6),
    size: range(0.05, 0.08),
    life: range(0.6, 0.9),
    gravity: 8,
    drag: 1.8,
    bounce: 0.1,
    landLife: 0.25,
    push: 0.5,
  }),
  /** Dry, fluttering bits of a withered crop being cleared. */
  withered: burst({
    count: 10,
    colors: WITHERED_COLORS,
    spread: 0.18,
    lift: 0.15,
    speed: range(0.3, 0.9),
    rise: range(1.4, 2.4),
    size: range(0.06, 0.11),
    life: range(0.9, 1.3),
    gravity: 5,
    drag: 2.2,
    bounce: 0.05,
    spin: 7,
    landLife: 0.3,
  }),
  /** Refilling the can: a crown of water thrown up from the pond. */
  splash: burst({
    count: 16,
    colors: [...WATER_COLORS, 0xffffff],
    shade: 0.02,
    spread: 0.2,
    lift: 0.02,
    speed: range(0.4, 1.3),
    rise: range(2.4, 3.8),
    size: range(0.05, 0.09),
    life: range(0.6, 0.9),
    gravity: 12,
    drag: 0.4,
    bounce: 0,
    spin: 5,
    glow: 0.18,
    landLife: 0.05,
  }),
  /** Pickaxe on a rock that survives the hit. */
  stoneChips: burst({
    count: 8,
    colors: STONE_COLORS,
    spread: 0.15,
    lift: 0.08,
    speed: range(0.9, 1.9),
    rise: range(1.8, 3),
    size: range(0.06, 0.1),
    life: range(0.7, 1),
    bounce: 0.4,
    spin: 14,
    landLife: 0.35,
    push: 0.8,
  }),
  /** The rock shatters. */
  rockBreak: burst({
    count: 30,
    colors: [...STONE_COLORS, 0x8a879e],
    spread: 0.3,
    lift: 0.2,
    speed: range(1, 2.6),
    rise: range(2.2, 4.2),
    size: range(0.08, 0.17),
    life: range(0.9, 1.4),
    bounce: 0.35,
    spin: 12,
    landLife: 0.5,
  }),
  /** Axe on a stump that survives the hit. */
  woodChips: burst({
    count: 8,
    colors: WOOD_COLORS,
    spread: 0.15,
    lift: 0.08,
    speed: range(0.9, 1.8),
    rise: range(1.8, 3),
    size: range(0.06, 0.11),
    life: range(0.7, 1.1),
    gravity: 12,
    drag: 0.9,
    bounce: 0.3,
    spin: 16,
    landLife: 0.4,
    push: 0.8,
  }),
  /** The stump splits apart. */
  stumpBreak: burst({
    count: 28,
    colors: [...WOOD_COLORS, 0xf3dcb4],
    spread: 0.3,
    lift: 0.2,
    speed: range(1, 2.4),
    rise: range(2.2, 4),
    size: range(0.08, 0.16),
    life: range(0.9, 1.4),
    gravity: 12,
    drag: 0.8,
    bounce: 0.3,
    spin: 14,
    landLife: 0.5,
  }),
  /** Soft cloud that accompanies a rock or stump being destroyed. */
  dust: burst({
    count: 10,
    colors: DUST_COLORS,
    shade: 0.02,
    spread: 0.3,
    lift: 0.1,
    speed: range(0.3, 0.9),
    rise: range(0.3, 0.8),
    size: range(0.14, 0.24),
    life: range(0.6, 0.95),
    gravity: -0.35,
    drag: 3.2,
    bounce: 0,
    spin: 3,
  }),
  /** A tool used on something it cannot affect. */
  puff: burst({
    count: 6,
    colors: [0xe4ded3, 0xd2cbbf, 0xc2bbb0],
    shade: 0.02,
    spread: 0.12,
    lift: 0.04,
    speed: range(0.25, 0.6),
    rise: range(0.25, 0.6),
    size: range(0.09, 0.15),
    life: range(0.4, 0.65),
    gravity: -0.25,
    drag: 3.6,
    bounce: 0,
    spin: 3,
  }),
  /** A seed goes in: small green glints drifting up. */
  plantSparkles: burst({
    count: 8,
    colors: [0xb6f09a, 0xd9ffb8, 0x8fe07a, 0xf2ffd6],
    shade: 0.02,
    spread: 0.22,
    lift: 0.08,
    speed: range(0.15, 0.45),
    rise: range(0.5, 1.1),
    size: range(0.05, 0.08),
    life: range(0.6, 0.95),
    gravity: -0.5,
    drag: 2.4,
    spin: 6,
    glow: 0.65,
    twinkle: 0.55,
  }),
  /** Harvest: chunks in the produce colour pop out of the plant (colours supplied per crop). */
  produce: burst({
    count: 12,
    shade: 0.05,
    spread: 0.18,
    lift: 0.1,
    speed: range(0.5, 1.4),
    rise: range(2.4, 3.6),
    size: range(0.08, 0.14),
    life: range(0.8, 1.1),
    gravity: 13,
    drag: 0.5,
    bounce: 0.35,
    spin: 11,
    glow: 0.1,
    landLife: 0.4,
  }),
  /** Harvest: a few leaves in the crop's foliage colour (colours supplied per crop). */
  leaves: burst({
    count: 6,
    shade: 0.05,
    spread: 0.2,
    lift: 0.1,
    speed: range(0.4, 1),
    rise: range(1.4, 2.4),
    size: range(0.06, 0.1),
    life: range(0.8, 1.2),
    gravity: 5,
    drag: 2,
    bounce: 0.05,
    spin: 8,
    landLife: 0.3,
  }),
  /** Harvest: white sparkles floating upward. */
  harvestSparkles: burst({
    count: 7,
    colors: [0xffffff, 0xfff8dc, 0xfffbe8],
    shade: 0,
    spread: 0.2,
    lift: 0.2,
    speed: range(0.1, 0.4),
    rise: range(1, 1.8),
    size: range(0.05, 0.08),
    life: range(0.7, 1),
    gravity: -1.2,
    drag: 1.8,
    spin: 7,
    glow: 0.9,
    twinkle: 0.6,
  }),
  /** Shipping: golden sparkles rising above the bin. */
  goldSparkles: burst({
    count: 18,
    colors: [0xffd966, 0xffe8a3, 0xf6c343, 0xfff4cc],
    shade: 0.03,
    spread: 0.5,
    lift: 0.15,
    speed: range(0.15, 0.55),
    rise: range(0.6, 1.5),
    size: range(0.06, 0.1),
    life: range(0.9, 1.4),
    gravity: -0.8,
    drag: 1.4,
    spin: 8,
    glow: 0.8,
    twinkle: 0.6,
  }),
  /** Shipping: a few gold coins hop up and clatter back onto the lid. */
  coins: burst({
    count: 5,
    colors: [0xf6c343, 0xffd966],
    shade: 0.02,
    spread: 0.3,
    lift: 0.05,
    speed: range(0.05, 0.25),
    rise: range(2, 2.8),
    size: range(0.08, 0.11),
    life: range(0.7, 0.9),
    gravity: 12,
    drag: 0.3,
    bounce: 0.35,
    spin: 14,
    glow: 0.35,
    landLife: 0.15,
  }),
} as const;

/** The watering can's pour: droplets on ballistic arcs from the spout onto the target tile. */
const POUR = {
  count: 12,
  colors: WATER_COLORS,
  /** Seconds over which the droplets leave the spout. */
  stagger: 0.26,
  /** Seconds each droplet spends in the air. */
  flightTime: range(0.3, 0.42),
  /** Half-extent of the landing area around the tile centre. */
  landingSpread: 0.32,
  /** Half-extent of the jitter at the spout. */
  spoutJitter: 0.03,
  size: range(0.05, 0.075),
  gravity: 12,
  glow: 0.15,
  landLife: 0.06,
  splash: 2,
} as const;

/** Tiny droplets thrown up when a splashing particle lands. */
const SPLASHLET = {
  sizeScale: 0.6,
  speed: range(0.25, 0.6),
  rise: range(0.7, 1.2),
  life: 0.24,
  gravity: 10,
  drag: 0.5,
  landLife: 0.04,
} as const;

// ---------------------------------------------------------------------------
// Scratch objects (reused; never allocated per frame)
// ---------------------------------------------------------------------------

/** Mutable description of one particle, filled by emitters and copied into the pool. */
interface ParticleSeed {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  r: number;
  g: number;
  b: number;
  size: number;
  life: number;
  delay: number;
  gravity: number;
  drag: number;
  bounce: number;
  floor: number;
  spin: number;
  glow: number;
  twinkle: number;
  landLife: number;
  splash: number;
}

function createSeed(): ParticleSeed {
  return {
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    r: 1,
    g: 1,
    b: 1,
    size: 0,
    life: 0,
    delay: 0,
    gravity: 0,
    drag: 0,
    bounce: 0,
    floor: 0,
    spin: 0,
    glow: 0,
    twinkle: 0,
    landLife: 0,
    splash: 0,
  };
}

/** Used by emitters (from sync). */
const emitSeed = createSeed();
/** Used by landing splashes (from the simulation step). */
const splashSeed = createSeed();

const scratchMatrix = new THREE.Matrix4();
const scratchPosition = new THREE.Vector3();
const scratchAxis = new THREE.Vector3();
const scratchQuaternion = new THREE.Quaternion();
const scratchScale = new THREE.Vector3();
const scratchColor = new THREE.Color();
const HIDDEN_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);

type Rng = () => number;

/** Where a burst starts, which floor its particles bounce on, and which way they are pushed. */
interface EmitPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly floor: number;
  readonly pushX: number;
  readonly pushZ: number;
}

// ---------------------------------------------------------------------------
// Particle pool
// ---------------------------------------------------------------------------

interface Channel {
  readonly data: { copyWithin(target: number, start: number, end?: number): unknown };
  readonly stride: number;
}

/**
 * Standard flat material plus a per-instance glow: `emissive += albedo × aGlow`, where the
 * albedo already includes the instance colour.
 */
function createParticleMaterial(): THREE.MeshStandardMaterial {
  const material = createFlatMaterial(0xffffff, { roughness: 0.7 });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', ['#include <common>', 'attribute float aGlow;', 'varying float vGlow;'].join('\n'))
      .replace('#include <begin_vertex>', ['#include <begin_vertex>', 'vGlow = aGlow;'].join('\n'));
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', ['#include <common>', 'varying float vGlow;'].join('\n'))
      .replace(
        '#include <emissivemap_fragment>',
        ['#include <emissivemap_fragment>', 'totalEmissiveRadiance += diffuseColor.rgb * vGlow;'].join('\n'),
      );
  };
  material.customProgramCacheKey = () => 'meadowlight-particle-glow-v1';
  return material;
}

/** Smooth 0 → 1 → 0 size envelope: quick pop-in, then a smoothstep shrink over the tail. */
function lifeEnvelope(age: number, life: number): number {
  const popIn = Math.min(1, age / SIM.popInSeconds);
  const shrinkWindow = life * SIM.shrinkFraction;
  const remaining = life - age;
  if (remaining >= shrinkWindow) return popIn;
  const u = Math.max(0, remaining / shrinkWindow);
  return popIn * u * u * (3 - 2 * u);
}

class ParticlePool {
  readonly mesh: THREE.InstancedMesh;
  private readonly geometry: THREE.TetrahedronGeometry;
  private readonly material: THREE.MeshStandardMaterial;
  private readonly colorAttribute: THREE.InstancedBufferAttribute;
  private readonly glowAttribute: THREE.InstancedBufferAttribute;

  private readonly position = new Float32Array(CAPACITY * 3);
  private readonly velocity = new Float32Array(CAPACITY * 3);
  private readonly axis = new Float32Array(CAPACITY * 3);
  private readonly colors = new Float32Array(CAPACITY * 3).fill(1);
  private readonly glow = new Float32Array(CAPACITY);
  private readonly age = new Float32Array(CAPACITY);
  private readonly life = new Float32Array(CAPACITY);
  private readonly size = new Float32Array(CAPACITY);
  private readonly angle = new Float32Array(CAPACITY);
  private readonly spin = new Float32Array(CAPACITY);
  private readonly gravity = new Float32Array(CAPACITY);
  private readonly drag = new Float32Array(CAPACITY);
  private readonly bounce = new Float32Array(CAPACITY);
  private readonly floor = new Float32Array(CAPACITY);
  private readonly twinkle = new Float32Array(CAPACITY);
  private readonly landLife = new Float32Array(CAPACITY);
  private readonly splash = new Uint8Array(CAPACITY);
  private readonly landed = new Uint8Array(CAPACITY);
  /** Every per-particle array with its stride, for swap-remove. */
  private readonly channels: readonly Channel[];

  /** Cosmetic randomness for spin axes and landing splashes. */
  private readonly rng: Rng = mulberry32(hash32(CAPACITY, Salt.Cosmetic));
  private count = 0;
  private recycleCursor = 0;
  /** Colour / glow buffers changed since the last upload. */
  private attributesDirty = false;

  constructor() {
    this.geometry = new THREE.TetrahedronGeometry(0.5, 0);
    this.glowAttribute = new THREE.InstancedBufferAttribute(this.glow, 1);
    this.glowAttribute.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('aGlow', this.glowAttribute);
    this.material = createParticleMaterial();

    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, CAPACITY);
    this.mesh.name = 'effects.particles';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Must exist before the first render, or the program compiles without instance colours.
    this.colorAttribute = new THREE.InstancedBufferAttribute(this.colors, 3);
    this.colorAttribute.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = this.colorAttribute;
    this.mesh.count = 0;
    // Particles fly anywhere on the farm every frame; the bounds would never be current.
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;

    this.channels = [
      { data: this.position, stride: 3 },
      { data: this.velocity, stride: 3 },
      { data: this.axis, stride: 3 },
      { data: this.colors, stride: 3 },
      { data: this.glow, stride: 1 },
      { data: this.age, stride: 1 },
      { data: this.life, stride: 1 },
      { data: this.size, stride: 1 },
      { data: this.angle, stride: 1 },
      { data: this.spin, stride: 1 },
      { data: this.gravity, stride: 1 },
      { data: this.drag, stride: 1 },
      { data: this.bounce, stride: 1 },
      { data: this.floor, stride: 1 },
      { data: this.twinkle, stride: 1 },
      { data: this.landLife, stride: 1 },
      { data: this.splash, stride: 1 },
      { data: this.landed, stride: 1 },
    ];
  }

  get liveCount(): number {
    return this.count;
  }

  /** Adds one particle. When the pool is full, a live slot is recycled round-robin. */
  spawn(seed: ParticleSeed): void {
    let slot: number;
    if (this.count < CAPACITY) {
      slot = this.count;
      this.count++;
    } else {
      slot = this.recycleCursor;
      this.recycleCursor = (this.recycleCursor + 1) % CAPACITY;
    }
    const s3 = slot * 3;
    this.position[s3] = seed.x;
    this.position[s3 + 1] = seed.y;
    this.position[s3 + 2] = seed.z;
    this.velocity[s3] = seed.vx;
    this.velocity[s3 + 1] = seed.vy;
    this.velocity[s3 + 2] = seed.vz;
    this.colors[s3] = seed.r;
    this.colors[s3 + 1] = seed.g;
    this.colors[s3 + 2] = seed.b;
    this.writeRandomAxis(s3);
    this.glow[slot] = seed.glow;
    this.age[slot] = -Math.max(0, seed.delay);
    this.life[slot] = seed.life;
    this.size[slot] = seed.size;
    this.angle[slot] = this.rng() * TAU;
    this.spin[slot] = seed.spin;
    this.gravity[slot] = seed.gravity;
    this.drag[slot] = seed.drag;
    this.bounce[slot] = seed.bounce;
    this.floor[slot] = seed.floor;
    this.twinkle[slot] = seed.twinkle;
    this.landLife[slot] = seed.landLife;
    this.splash[slot] = seed.splash;
    this.landed[slot] = 0;
    // Hidden until the next step places it; step always runs before the frame is rendered.
    this.mesh.setMatrixAt(slot, HIDDEN_MATRIX);
    this.mesh.count = this.count;
    this.attributesDirty = true;
  }

  /** Advances every live particle by `dt` seconds and uploads the live range. */
  step(dt: number): void {
    if (this.count === 0) return;
    let i = 0;
    while (i < this.count) {
      const age = (this.age[i] ?? 0) + dt;
      if (age < 0) {
        // Still waiting for its start delay.
        this.age[i] = age;
        this.mesh.setMatrixAt(i, HIDDEN_MATRIX);
        i++;
        continue;
      }
      let life = this.life[i] ?? 0;
      if (age >= life) {
        this.removeAt(i);
        continue;
      }
      life = this.integrate(i, age, life, dt);
      this.age[i] = age;
      this.life[i] = life;
      this.writeMatrix(i, age, life);
      i++;
    }
    this.upload();
  }

  /** Removes every particle (full rebuild). */
  clear(): void {
    this.count = 0;
    this.recycleCursor = 0;
    this.mesh.count = 0;
  }

  dispose(): void {
    this.clear();
    this.mesh.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }

  /** Moves particle `i` one step; returns its (possibly shortened) lifetime. */
  private integrate(i: number, age: number, lifeIn: number, dt: number): number {
    let life = lifeIn;
    const i3 = i * 3;
    let x = this.position[i3] ?? 0;
    let y = this.position[i3 + 1] ?? 0;
    let z = this.position[i3 + 2] ?? 0;
    let vx = this.velocity[i3] ?? 0;
    let vy = this.velocity[i3 + 1] ?? 0;
    let vz = this.velocity[i3 + 2] ?? 0;
    let spin = this.spin[i] ?? 0;
    const gravity = this.gravity[i] ?? 0;

    const damping = Math.exp(-(this.drag[i] ?? 0) * dt);
    vy = (vy - gravity * dt) * damping;
    vx *= damping;
    vz *= damping;
    x += vx * dt;
    y += vy * dt;
    z += vz * dt;

    if (gravity > 0) {
      const floor = this.floor[i] ?? 0;
      const rest = floor + (this.size[i] ?? 0) * SIM.restRadius;
      if (y < rest) {
        y = rest;
        if (this.landed[i] === 0) {
          this.landed[i] = 1;
          const landLife = this.landLife[i] ?? 0;
          if (landLife > 0 && life - age > landLife) life = age + landLife;
          this.splashFrom(i, x, floor, z);
        }
        if (vy < 0) vy = -vy * (this.bounce[i] ?? 0);
        if (vy < SIM.settleSpeed) {
          vy = 0;
          const friction = Math.exp(-SIM.groundFriction * dt);
          vx *= friction;
          vz *= friction;
          spin *= friction;
        }
      }
    }

    this.position[i3] = x;
    this.position[i3 + 1] = y;
    this.position[i3 + 2] = z;
    this.velocity[i3] = vx;
    this.velocity[i3 + 1] = vy;
    this.velocity[i3 + 2] = vz;
    this.spin[i] = spin;
    this.angle[i] = (this.angle[i] ?? 0) + spin * dt;
    return life;
  }

  private writeMatrix(i: number, age: number, life: number): void {
    const i3 = i * 3;
    const axisX = this.axis[i3] ?? 0;
    let scale = (this.size[i] ?? 0) * lifeEnvelope(age, life);
    const twinkle = this.twinkle[i] ?? 0;
    if (twinkle > 0) {
      scale *= 1 - twinkle * 0.5 * (1 + Math.sin(age * SIM.twinkleRate + axisX * 9));
    }
    scratchPosition.set(this.position[i3] ?? 0, this.position[i3 + 1] ?? 0, this.position[i3 + 2] ?? 0);
    scratchAxis.set(axisX, this.axis[i3 + 1] ?? 1, this.axis[i3 + 2] ?? 0);
    scratchQuaternion.setFromAxisAngle(scratchAxis, this.angle[i] ?? 0);
    scratchScale.setScalar(scale);
    scratchMatrix.compose(scratchPosition, scratchQuaternion, scratchScale);
    this.mesh.setMatrixAt(i, scratchMatrix);
  }

  /** Spawns the tiny droplets of a landing splash, never recycling live slots for them. */
  private splashFrom(i: number, x: number, floor: number, z: number): void {
    const count = this.splash[i] ?? 0;
    if (count === 0) return;
    const i3 = i * 3;
    for (let n = 0; n < count && this.count < CAPACITY; n++) {
      const heading = this.rng() * TAU;
      const speed = sample(SPLASHLET.speed, this.rng());
      splashSeed.x = x;
      splashSeed.y = floor;
      splashSeed.z = z;
      splashSeed.vx = Math.cos(heading) * speed;
      splashSeed.vy = sample(SPLASHLET.rise, this.rng());
      splashSeed.vz = Math.sin(heading) * speed;
      splashSeed.r = this.colors[i3] ?? 1;
      splashSeed.g = this.colors[i3 + 1] ?? 1;
      splashSeed.b = this.colors[i3 + 2] ?? 1;
      splashSeed.size = (this.size[i] ?? 0) * SPLASHLET.sizeScale;
      splashSeed.life = SPLASHLET.life;
      splashSeed.delay = 0;
      splashSeed.gravity = SPLASHLET.gravity;
      splashSeed.drag = SPLASHLET.drag;
      splashSeed.bounce = 0;
      splashSeed.floor = floor;
      splashSeed.spin = 6;
      splashSeed.glow = this.glow[i] ?? 0;
      splashSeed.twinkle = 0;
      splashSeed.landLife = SPLASHLET.landLife;
      splashSeed.splash = 0;
      this.spawn(splashSeed);
    }
  }

  /** Swap-remove: the last live particle takes slot `i`. */
  private removeAt(i: number): void {
    const last = this.count - 1;
    if (i !== last) {
      for (const channel of this.channels) {
        channel.data.copyWithin(i * channel.stride, last * channel.stride, (last + 1) * channel.stride);
      }
      this.attributesDirty = true;
    }
    this.count = last;
  }

  /** Uniformly distributed unit vector for the spin axis. */
  private writeRandomAxis(offset: number): void {
    const z = this.rng() * 2 - 1;
    const phi = this.rng() * TAU;
    const radius = Math.sqrt(Math.max(0, 1 - z * z));
    this.axis[offset] = Math.cos(phi) * radius;
    this.axis[offset + 1] = z;
    this.axis[offset + 2] = Math.sin(phi) * radius;
  }

  /** Flags only the live range of each GPU buffer for upload. */
  private upload(): void {
    this.mesh.count = this.count;
    if (this.count === 0) return;
    const matrices = this.mesh.instanceMatrix;
    matrices.clearUpdateRanges();
    matrices.addUpdateRange(0, this.count * 16);
    matrices.needsUpdate = true;
    if (this.attributesDirty) {
      this.colorAttribute.clearUpdateRanges();
      this.colorAttribute.addUpdateRange(0, this.count * 3);
      this.colorAttribute.needsUpdate = true;
      this.glowAttribute.clearUpdateRanges();
      this.glowAttribute.addUpdateRange(0, this.count);
      this.glowAttribute.needsUpdate = true;
      this.attributesDirty = false;
    }
  }
}

// ---------------------------------------------------------------------------
// Emitters
// ---------------------------------------------------------------------------

function pickColor(colors: readonly number[], shade: number, rng: Rng): void {
  const hex = colors[Math.floor(rng() * colors.length)] ?? colors[0] ?? 0xffffff;
  scratchColor.setHex(hex);
  const jitter = (rng() * 2 - 1) * shade;
  if (jitter !== 0) scratchColor.offsetHSL(0, 0, jitter);
}

/** A lighter or darker variant of an sRGB hex colour. */
function shadeHex(hex: number, lightness: number): number {
  return scratchColor.setHex(hex).offsetHSL(0, 0, lightness).getHex();
}

function emitBurst(pool: ParticlePool, spec: BurstSpec, rng: Rng, at: EmitPoint, colors = spec.colors): void {
  for (let n = 0; n < spec.count; n++) {
    const heading = rng() * TAU;
    const speed = sample(spec.speed, rng());
    const push = spec.push * (0.5 + rng());
    emitSeed.x = at.x + (rng() * 2 - 1) * spec.spread;
    emitSeed.y = at.y + rng() * spec.lift;
    emitSeed.z = at.z + (rng() * 2 - 1) * spec.spread;
    emitSeed.vx = Math.cos(heading) * speed + at.pushX * push;
    emitSeed.vy = sample(spec.rise, rng());
    emitSeed.vz = Math.sin(heading) * speed + at.pushZ * push;
    pickColor(colors, spec.shade, rng);
    emitSeed.r = scratchColor.r;
    emitSeed.g = scratchColor.g;
    emitSeed.b = scratchColor.b;
    emitSeed.size = sample(spec.size, rng());
    emitSeed.life = sample(spec.life, rng());
    emitSeed.delay = rng() * spec.stagger;
    emitSeed.gravity = spec.gravity;
    emitSeed.drag = spec.drag;
    emitSeed.bounce = spec.bounce;
    emitSeed.floor = at.floor;
    emitSeed.spin = (rng() * 2 - 1) * spec.spin;
    emitSeed.glow = spec.glow;
    emitSeed.twinkle = spec.twinkle;
    emitSeed.landLife = spec.landLife;
    emitSeed.splash = spec.splash;
    pool.spawn(emitSeed);
  }
}

/**
 * Droplets leave the spout one after another and follow exact ballistic arcs (no drag) that
 * land at random points on the target tile: v = (Δ − ½·a·T²) / T for a flight time T.
 */
function emitPour(pool: ParticlePool, rng: Rng, spoutX: number, spoutY: number, spoutZ: number, target: EmitPoint): void {
  for (let n = 0; n < POUR.count; n++) {
    const flight = sample(POUR.flightTime, rng());
    const size = sample(POUR.size, rng());
    const fromX = spoutX + (rng() * 2 - 1) * POUR.spoutJitter;
    const fromZ = spoutZ + (rng() * 2 - 1) * POUR.spoutJitter;
    const toX = target.x + (rng() * 2 - 1) * POUR.landingSpread;
    const toZ = target.z + (rng() * 2 - 1) * POUR.landingSpread;
    const toY = target.floor + size * SIM.restRadius;
    emitSeed.x = fromX;
    emitSeed.y = spoutY;
    emitSeed.z = fromZ;
    emitSeed.vx = (toX - fromX) / flight;
    emitSeed.vy = (toY - spoutY + 0.5 * POUR.gravity * flight * flight) / flight;
    emitSeed.vz = (toZ - fromZ) / flight;
    pickColor(POUR.colors, 0.02, rng);
    emitSeed.r = scratchColor.r;
    emitSeed.g = scratchColor.g;
    emitSeed.b = scratchColor.b;
    emitSeed.size = size;
    // Long enough to always land; landLife then soaks the droplet in right after impact.
    emitSeed.life = flight + 0.4;
    emitSeed.delay = (n / POUR.count) * POUR.stagger + rng() * 0.02;
    emitSeed.gravity = POUR.gravity;
    emitSeed.drag = 0;
    emitSeed.bounce = 0;
    emitSeed.floor = target.floor;
    emitSeed.spin = (rng() * 2 - 1) * 4;
    emitSeed.glow = POUR.glow;
    emitSeed.twinkle = 0;
    emitSeed.landLife = POUR.landLife;
    emitSeed.splash = POUR.splash;
    pool.spawn(emitSeed);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isToolKind(kind: ActionKind): kind is ToolType {
  return (TOOL_TYPES as readonly string[]).includes(kind);
}

/** Height of the visible top surface of a tile. */
function surfaceHeight(tile: Tile): number {
  if (tile.blocker === Blocker.Water) return HEIGHTS.waterSurface;
  return isSoil(tile) ? HEIGHTS.soilTop : HEIGHTS.grassTop;
}

function withHeight(at: EmitPoint, y: number): EmitPoint {
  return { ...at, y };
}

function withPush(at: EmitPoint, pushX: number, pushZ: number): EmitPoint {
  return { ...at, pushX, pushZ };
}

/** Centre of the shipping bin footprint if the target is part of it, else the tile centre. */
function shippingBinCentre(grid: GridSpec, target: TileCoord, fallback: EmitPoint): { x: number; z: number } {
  const bin = LAYOUT.shippingBin;
  if (!rectContains(bin, target.tx, target.tz)) return { x: fallback.x, z: fallback.z };
  return {
    x: tileMinX(grid, bin.x0) + (bin.width * grid.tileSize) / 2,
    z: tileMinZ(grid, bin.z0) + (bin.depth * grid.tileSize) / 2,
  };
}

// ---------------------------------------------------------------------------
// Render system
// ---------------------------------------------------------------------------

export class EffectsRenderer implements RenderSystem {
  private readonly scene: THREE.Scene;
  private readonly pool: ParticlePool;

  constructor(ctx: SceneContext) {
    this.scene = ctx.scene;
    this.pool = new ParticlePool();
    this.scene.add(this.pool.mesh);
  }

  sync(state: GameState, prev: GameState | null): void {
    if (prev === null) {
      // New game or load: nothing that was flying belongs to the new world.
      this.pool.clear();
      return;
    }
    if (state.player.actionSeq === prev.player.actionSeq) return;
    const event = state.player.lastAction;
    if (event === null || event.seq !== state.player.actionSeq) return;
    this.react(event, state, prev);
  }

  update(frame: FrameContext): void {
    if (this.pool.liveCount === 0) return;
    this.pool.step(frame.dt);
  }

  dispose(): void {
    this.scene.remove(this.pool.mesh);
    this.pool.dispose();
  }

  private react(event: ActionEvent, state: GameState, prev: GameState): void {
    const target = event.target;
    if (target === null) return;
    const before = getTile(prev.world, target.tx, target.tz);
    const after = getTile(state.world, target.tx, target.tz);
    if (before === null || after === null) return;

    const grid = state.world.grid;
    const facing = DIRECTION_STEPS[state.player.facing];
    const floor = surfaceHeight(after);
    const ground: EmitPoint = {
      x: tileCenterX(grid, target.tx),
      y: floor,
      z: tileCenterZ(grid, target.tz),
      floor,
      pushX: facing.dx,
      pushZ: facing.dz,
    };
    const rng = mulberry32(hash32(event.seq, target.tx, target.tz, Salt.Cosmetic));

    if (!event.success) {
      if (isToolKind(event.kind)) emitBurst(this.pool, EFFECTS.puff, rng, withPush(ground, 0, 0));
      return;
    }

    switch (event.kind) {
      case 'hoe':
        this.hoe(before, ground, rng);
        return;
      case 'wateringCan':
        this.water(state, ground, rng);
        return;
      case 'refill':
        emitBurst(this.pool, EFFECTS.splash, rng, withPush(ground, 0, 0));
        return;
      case 'pickaxe':
        this.strike(before, after, ground, rng, Blocker.Rock);
        return;
      case 'axe':
        this.strike(before, after, ground, rng, Blocker.Stump);
        return;
      case 'scythe':
      case 'harvest':
        this.harvest(before, ground, rng);
        return;
      case 'plant':
        emitBurst(this.pool, EFFECTS.plantSparkles, rng, withPush(withHeight(ground, ground.y + 0.05), 0, 0));
        return;
      case 'ship':
        this.ship(grid, target, ground, rng);
        return;
      case 'sleep':
      case 'none':
        return;
    }
  }

  /** Tilling throws clods and torn grass; clearing a withered crop scatters dry leaves. */
  private hoe(before: Tile, ground: EmitPoint, rng: Rng): void {
    const crop = before.crop;
    if (crop !== null && crop.dead) {
      const height = CROPS[crop.cropId].visual.height * ANCHORS.cropCentre;
      emitBurst(this.pool, EFFECTS.withered, rng, withHeight(ground, ground.floor + height));
      emitBurst(this.pool, EFFECTS.clodsLight, rng, ground);
      return;
    }
    emitBurst(this.pool, EFFECTS.clods, rng, ground);
    if (before.state === TileState.Unplowed) emitBurst(this.pool, EFFECTS.grassBits, rng, ground);
  }

  /** A stream of droplets pours from the spout, just ahead of the player, onto the tile. */
  private water(state: GameState, ground: EmitPoint, rng: Rng): void {
    const grid = state.world.grid;
    const { player } = state;
    const step = DIRECTION_STEPS[player.facing];
    const spoutX = tileCenterX(grid, player.tx) + step.dx * ANCHORS.spoutReach * grid.tileSize;
    const spoutZ = tileCenterZ(grid, player.tz) + step.dz * ANCHORS.spoutReach * grid.tileSize;
    emitPour(this.pool, rng, spoutX, HEIGHTS.grassTop + ANCHORS.spoutHeight, spoutZ, ground);
  }

  /**
   * Pickaxe / axe. Chips fly back off the struck face toward the player; destroying the
   * blocker is a big radial burst plus a dust cloud. A pickaxe used on empty soil (turning it
   * back into grass) kicks up soil instead.
   */
  private strike(before: Tile, after: Tile, ground: EmitPoint, rng: Rng, blocker: typeof Blocker.Rock | typeof Blocker.Stump): void {
    if (before.blocker !== blocker) {
      emitBurst(this.pool, EFFECTS.clodsLight, rng, ground);
      emitBurst(this.pool, EFFECTS.grassBits, rng, ground);
      return;
    }
    const isRock = blocker === Blocker.Rock;
    const strikeHeight = ground.floor + (isRock ? ANCHORS.rockStrike : ANCHORS.stumpStrike);
    const impact = withHeight(ground, strikeHeight);
    if (after.blocker === Blocker.None) {
      emitBurst(this.pool, isRock ? EFFECTS.rockBreak : EFFECTS.stumpBreak, rng, withPush(impact, 0, 0));
      emitBurst(this.pool, EFFECTS.dust, rng, withPush(ground, 0, 0));
      return;
    }
    emitBurst(this.pool, isRock ? EFFECTS.stoneChips : EFFECTS.woodChips, rng, withPush(impact, -ground.pushX, -ground.pushZ));
  }

  /** Harvest (interaction or scythe): produce pops out with leaves and rising sparkles. */
  private harvest(before: Tile, ground: EmitPoint, rng: Rng): void {
    const crop = before.crop;
    if (crop === null) return;
    const visual = CROPS[crop.cropId].visual;
    const centre = withPush(withHeight(ground, ground.floor + visual.height * ANCHORS.cropCentre), 0, 0);
    if (crop.dead) {
      emitBurst(this.pool, EFFECTS.withered, rng, centre);
      return;
    }
    const produceColors = [visual.produceColor, shadeHex(visual.produceColor, 0.06), shadeHex(visual.produceColor, -0.06)];
    const leafColors = [visual.foliageColor, shadeHex(visual.foliageColor, 0.06)];
    emitBurst(this.pool, EFFECTS.produce, rng, centre, produceColors);
    emitBurst(this.pool, EFFECTS.leaves, rng, centre, leafColors);
    emitBurst(this.pool, EFFECTS.harvestSparkles, rng, withHeight(centre, centre.y + 0.1));
  }

  /** Golden sparkles rise above the whole bin while a few coins hop on its lid. */
  private ship(grid: GridSpec, target: TileCoord, ground: EmitPoint, rng: Rng): void {
    const centre = shippingBinCentre(grid, target, ground);
    const lid = HEIGHTS.grassTop + ANCHORS.binLid;
    const top: EmitPoint = { x: centre.x, y: lid + 0.05, z: centre.z, floor: lid, pushX: 0, pushZ: 0 };
    emitBurst(this.pool, EFFECTS.goldSparkles, rng, top);
    emitBurst(this.pool, EFFECTS.coins, rng, top);
  }
}
