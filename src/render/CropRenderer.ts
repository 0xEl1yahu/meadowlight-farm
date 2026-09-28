/**
 * CropRenderer: the visual half of the farming & growth pipeline.
 *
 * Instancing model
 * - Every crop part geometry (cropGeometry.ts) owns one InstancedMesh with capacity
 *   tileCount(grid), wrapped in an InstanceSlotMap keyed by the global tile index. A planted
 *   tile shows one foliage part, chosen by form and growth stage, plus at most one accent part:
 *   the soil mound of a freshly sown seed, or the produce once the crop is mature. When the
 *   stage bucket changes, the tile's key moves from one foliage map to another.
 * - Stage → model: stage 0 is a seedling (in a soil mound when sown), stage 1 a sprout, then
 *   the form's growing foliage until 70 % of the stages are done, then the form's mature
 *   foliage (also used by regrowing crops between harvests); mature crops add their produce,
 *   unless the plant itself is the harvest (produce 'none'). Fungi skip the seedling and
 *   sprout: a mushroom is a small button from the day it appears. Growing and mature foliage
 *   scale uniformly with growthProgress (0.4 → 1) × the crop's visual height, so every stage
 *   reads differently. Attached produce (head, berries, cob, ears) shares the foliage
 *   transform and sway; ground produce (bulb, gourd) sits on the ground, nudged toward the
 *   camera when a canopy would hide it.
 * - Wild crops (shade habitat) grow on untilled grass: they stand on HEIGHTS.grassTop, were
 *   never sown (no soil mound) and need no water (never dry-tinted, never thirsty).
 * - A separate droplet map marks thirsty crops: every living, not-yet-mature, non-wild crop on
 *   dry (Plowed) soil. Droplets bob and spin in the vertex shader, so they cost nothing per
 *   frame.
 *
 * Conditions: watered crops show their full colour; dry growing field crops are yellowed (more
 * so after consecutive dry nights) and slightly wilted; dead crops droop, lean and turn a
 * desaturated brown-grey, and lose their produce.
 *
 * Diffing and animation
 * - sync(state, null) clears every map and rebuilds from all tiles, without animation.
 * - Otherwise only dirty tiles of dirty chunks are described again. Changes tween the instance
 *   scale: new parts pop in with a gentle overshoot (easeOutBack, ~0.45 s), removed parts
 *   anticipate and shrink to nothing before their key is removed, fresh produce triggers a
 *   celebratory squash-and-stretch, harvesting a regrowing crop rustles it and watering gives
 *   a small "drink" wiggle. Overnight changes ripple across the field with a hashed delay.
 * - update() touches only layers with an active tween.
 */
import * as THREE from 'three';
import { Salt, hashFloat } from '../core/hash';
import { TileState, type Chunk, type CropInstance, type GameState, type GridSpec, type Tile } from '../core/types';
import {
  CROPS,
  daysRequiredForStage,
  growthProgress,
  isMature,
  stageCount,
  type CropDefinition,
  type CropForm,
  type ProduceForm,
} from '../farming/crops';
import { tileCenterX, tileCenterZ, tileCount, tileIndex } from '../world/grid';
import { CAMERA, HEIGHTS } from './constants';
import {
  createBerryClusterGeometry,
  createBulbGeometry,
  createBushGrowingGeometry,
  createBushMatureGeometry,
  createCobGeometry,
  createEarsGeometry,
  createFungusGrowingGeometry,
  createFungusMatureGeometry,
  createGourdGeometry,
  createGrainGrowingGeometry,
  createGrainMatureGeometry,
  createHeadGeometry,
  createLeafyGrowingGeometry,
  createLeafyMatureGeometry,
  createSeedlingGeometry,
  createSoilMoundGeometry,
  createSproutGeometry,
  createStalkGrowingGeometry,
  createStalkMatureGeometry,
  createThirstDropletGeometry,
  createVineGrowingGeometry,
  createVineMatureGeometry,
} from './cropGeometry';
import { InstanceSlotMap } from './InstanceSlotMap';
import { createFlatMaterial, createSwayMaterial, sharedUniforms } from './materials';
import { PALETTE } from './palette';
import type { SceneContext } from './SceneContext';
import type { FrameContext, RenderSystem } from './types';

// ---------------------------------------------------------------------------
// Parts
// ---------------------------------------------------------------------------

const PART_IDS = [
  'soilMound',
  'seedling',
  'sprout',
  'leafyGrowing',
  'leafyMature',
  'bushGrowing',
  'bushMature',
  'stalkGrowing',
  'stalkMature',
  'vineGrowing',
  'vineMature',
  'grainGrowing',
  'grainMature',
  'fungusGrowing',
  'fungusMature',
  'bulb',
  'head',
  'berries',
  'cob',
  'ears',
  'gourd',
  'droplet',
] as const;
type PartId = (typeof PART_IDS)[number];

/** Decides the instance colour, material and shadow flags of a part. */
type PartRole = 'foliage' | 'produce' | 'soil' | 'indicator';

interface PartSpec {
  readonly role: PartRole;
  readonly build: () => THREE.BufferGeometry;
  /** Horizontal sway at the part's top (world units at scale 1, wind strength 1). */
  readonly swayReach?: number;
  /** Attached produce sways exactly like the foliage it grows on (same amplitude and phase). */
  readonly swayWith?: PartId;
  readonly roughness?: number;
}

const PART_SPECS: Readonly<Record<PartId, PartSpec>> = {
  soilMound: { role: 'soil', build: createSoilMoundGeometry, roughness: 1 },
  seedling: { role: 'foliage', build: createSeedlingGeometry, swayReach: 0.012 },
  sprout: { role: 'foliage', build: createSproutGeometry, swayReach: 0.02 },
  leafyGrowing: { role: 'foliage', build: createLeafyGrowingGeometry, swayReach: 0.03 },
  leafyMature: { role: 'foliage', build: createLeafyMatureGeometry, swayReach: 0.035 },
  bushGrowing: { role: 'foliage', build: createBushGrowingGeometry, swayReach: 0.018 },
  bushMature: { role: 'foliage', build: createBushMatureGeometry, swayReach: 0.022 },
  stalkGrowing: { role: 'foliage', build: createStalkGrowingGeometry, swayReach: 0.045 },
  stalkMature: { role: 'foliage', build: createStalkMatureGeometry, swayReach: 0.07 },
  vineGrowing: { role: 'foliage', build: createVineGrowingGeometry, swayReach: 0.018 },
  vineMature: { role: 'foliage', build: createVineMatureGeometry, swayReach: 0.02 },
  grainGrowing: { role: 'foliage', build: createGrainGrowingGeometry, swayReach: 0.04 },
  grainMature: { role: 'foliage', build: createGrainMatureGeometry, swayReach: 0.06 },
  // Mushrooms are firm: a barely visible tremble rather than a sway.
  fungusGrowing: { role: 'foliage', build: createFungusGrowingGeometry, swayReach: 0.003, roughness: 0.75 },
  fungusMature: { role: 'foliage', build: createFungusMatureGeometry, swayReach: 0.005, roughness: 0.75 },
  bulb: { role: 'produce', build: createBulbGeometry, roughness: 0.8 },
  head: { role: 'produce', build: createHeadGeometry, swayWith: 'leafyMature', roughness: 0.85 },
  berries: { role: 'produce', build: createBerryClusterGeometry, swayWith: 'bushMature', roughness: 0.45 },
  cob: { role: 'produce', build: createCobGeometry, swayWith: 'stalkMature', roughness: 0.7 },
  ears: { role: 'produce', build: createEarsGeometry, swayWith: 'grainMature', roughness: 0.75 },
  gourd: { role: 'produce', build: createGourdGeometry, roughness: 0.6 },
  droplet: { role: 'indicator', build: createThirstDropletGeometry },
};

interface Part {
  readonly id: PartId;
  /** Position in PART_IDS; combined with the tile key to identify a slot across all maps. */
  readonly index: number;
  readonly role: PartRole;
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.MeshStandardMaterial;
  /** Highest local Y of the geometry (world units at scale 1). */
  readonly top: number;
  mesh: THREE.InstancedMesh;
  slots: InstanceSlotMap;
  /** Slot edits waiting for commit(). */
  dirty: boolean;
}

interface FormParts {
  readonly growing: PartId;
  readonly mature: PartId;
  /** Whether stages 0 and 1 use the shared seedling and sprout models (fungi go straight to growing). */
  readonly seedlings: boolean;
}

/** Foliage parts of each form. */
const FORM_PARTS: Readonly<Record<CropForm, FormParts>> = {
  leafy: { growing: 'leafyGrowing', mature: 'leafyMature', seedlings: true },
  bush: { growing: 'bushGrowing', mature: 'bushMature', seedlings: true },
  stalk: { growing: 'stalkGrowing', mature: 'stalkMature', seedlings: true },
  vine: { growing: 'vineGrowing', mature: 'vineMature', seedlings: true },
  grain: { growing: 'grainGrowing', mature: 'grainMature', seedlings: true },
  fungus: { growing: 'fungusGrowing', mature: 'fungusMature', seedlings: false },
};

interface ProducePart {
  readonly part: PartId;
  readonly placement: 'attached' | 'ground';
}

/**
 * Produce parts. `attached` produce is authored on its canonical foliage (head on the leafy
 * rosette, berries in the bush, cob on the stalk, ears on the grain) and shares the foliage
 * transform; `ground` produce rests on the ground with its own yaw. null: the mature plant is
 * itself the harvest and shows no produce part.
 */
const PRODUCE_PARTS: Readonly<Record<ProduceForm, ProducePart | null>> = {
  bulb: { part: 'bulb', placement: 'ground' },
  head: { part: 'head', placement: 'attached' },
  berries: { part: 'berries', placement: 'attached' },
  cob: { part: 'cob', placement: 'attached' },
  ears: { part: 'ears', placement: 'attached' },
  gourd: { part: 'gourd', placement: 'ground' },
  none: null,
};

/** How far ground produce slides toward the camera (× crop scale) so the canopy can't hide it. */
const GROUND_NUDGE: Readonly<Record<CropForm, number>> = {
  leafy: 0,
  bush: 0.3,
  stalk: 0.14,
  vine: 0.12,
  grain: 0.1,
  fungus: 0.2,
};

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);

/** Horizontal direction toward the camera (yaw measured from +Z toward +X, as in grid.ts). */
const VIEW_YAW = THREE.MathUtils.degToRad(CAMERA.yawDeg);
const VIEW_X = Math.sin(VIEW_YAW);
const VIEW_Z = Math.cos(VIEW_YAW);

const LOOK = {
  /** Max offset of a plant from its tile centre, per axis (world units). */
  placementJitter: 0.08,
  /** ± fractional size variety between plants of the same crop. */
  sizeJitter: 0.06,
  /** ± lightness variety of instance colours. */
  colorJitter: 0.05,
  /** Foliage scale factor at growthProgress 0 (it reaches 1 at maturity). */
  growthMinScale: 0.4,
  /** stage / stageCount at which the form's mature foliage replaces its growing foliage. */
  matureFoliageFraction: 0.7,
  /** Crop height at which seedlings and sprouts have their authored size. */
  youngReferenceHeight: 0.5,
  youngSizeMin: 0.75,
  youngSizeMax: 1.1,
  /** Young leaves are a little paler than the crop's foliage colour. */
  youngLighten: 0.15,
  /** Dry-soil tint toward straw, growing with consecutive dry nights. */
  dryTintBase: 0.2,
  dryTintPerNight: 0.08,
  /** Height lost per consecutive dry night (wilting). */
  wiltPerNight: 0.05,
  maxDryNights: 3,
  deadDroop: 0.55,
  deadSpread: 1.12,
  /** Lean of a dead plant (radians). */
  deadLean: 0.3,
  /** Gap between the top of the foliage and the thirst droplet's centre. */
  dropletClearance: 0.2,
  dropletMinTop: 0.1,
} as const;

const MOTION = {
  growSeconds: 0.45,
  produceSeconds: 0.55,
  shrinkSeconds: 0.32,
  wiltSeconds: 0.9,
  bounceSeconds: 0.6,
  /** A new stage model pops from this fraction of its resting scale. */
  popFrom: 0.45,
  /** easeOutBack / easeInBack overshoot constant (1.70158 is the classic, stronger value). */
  overshoot: 1.35,
  accentStagger: 0.08,
  dropletStagger: 0.22,
  /** Max per-tile delay when a new day changes the whole field at once. */
  rippleSeconds: 0.35,
  celebrate: 0.22,
  rustle: 0.12,
  drink: 0.08,
  /** Never upload an exactly singular matrix. */
  minScale: 1e-4,
} as const;

const DROPLET = {
  color: 0x79c4ff,
  glow: 0x2e7fd6,
  /** Bob speed (rad/s), bob height (local units) and spin speed (rad/s). */
  bobSpeed: 2.6,
  bobHeight: 0.045,
  spinSpeed: 1.1,
} as const;

const WHITE = new THREE.Color(0xffffff);
const DRY_TINT = new THREE.Color(0xe6d27f);
const DEAD_BROWN = new THREE.Color(0xab8f6b);
const DEAD_GREY = new THREE.Color(0xa09a8f);
const SOIL_DRY = new THREE.Color(PALETTE.soilPlowed).lerp(WHITE, 0.06);
const SOIL_WET = new THREE.Color(PALETTE.soilWatered).lerp(WHITE, 0.06);

/** Independent cosmetic hash streams per tile (combined with Salt.Cosmetic). */
const Channel = {
  OffsetX: 1,
  OffsetZ: 2,
  Yaw: 3,
  Size: 4,
  LeanHeading: 5,
  FoliageShade: 6,
  MoundYaw: 7,
  MoundSize: 8,
  ProduceYaw: 9,
  ProduceShade: 10,
  Ripple: 11,
} as const;
type Channel = (typeof Channel)[keyof typeof Channel];

const IDENTITY_QUATERNION = new THREE.Quaternion();
const DROPLET_REST_SCALE = new THREE.Vector3(1, 1, 1);

const scratchMatrix = new THREE.Matrix4();
const scratchScale = new THREE.Vector3();
const scratchAxis = new THREE.Vector3();
const scratchQuaternion = new THREE.Quaternion();

// ---------------------------------------------------------------------------
// Layers and records
// ---------------------------------------------------------------------------

type Motion = 'grow' | 'wilt' | 'shrink' | 'bounce';

/** One instance of one part on one tile: its resting transform and its active tween. */
interface Layer {
  part: Part;
  readonly key: number;
  readonly position: THREE.Vector3;
  readonly quaternion: THREE.Quaternion;
  /** Resting scale. */
  readonly rest: THREE.Vector3;
  /** Scale currently uploaded to the GPU. */
  readonly shown: THREE.Vector3;
  /** Scale at the start of the active tween. */
  readonly from: THREE.Vector3;
  motion: Motion | null;
  elapsed: number;
  delay: number;
  duration: number;
  /** Squash-and-stretch strength of a bounce. */
  amplitude: number;
  /** The instance is shrinking away and is removed when its tween ends. */
  leaving: boolean;
}

/** Everything drawn for one planted tile. */
interface CropRecord {
  crop: CropInstance;
  readonly foliage: Layer;
  /** Soil mound (stage 0) or produce (mature). */
  accent: Layer | null;
  droplet: Layer | null;
}

/** Target appearance of one planted tile, recomputed whenever the tile changes. */
interface CropLook {
  foliage: PartId;
  readonly position: THREE.Vector3;
  readonly quaternion: THREE.Quaternion;
  readonly foliageScale: THREE.Vector3;
  readonly foliageColor: THREE.Color;
  accent: PartId | null;
  readonly accentPosition: THREE.Vector3;
  readonly accentQuaternion: THREE.Quaternion;
  readonly accentScale: THREE.Vector3;
  readonly accentColor: THREE.Color;
  thirsty: boolean;
  readonly dropletPosition: THREE.Vector3;
}

type FoliageBucket = 'seedling' | 'sprout' | 'growing' | 'mature';

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function recordOf<K extends string, V>(keys: readonly K[], value: (key: K, index: number) => V): Record<K, V> {
  const out: Partial<Record<K, V>> = {};
  keys.forEach((key, index) => {
    out[key] = value(key, index);
  });
  // Every key was assigned above.
  return out as Record<K, V>;
}

function geometryTop(geometry: THREE.BufferGeometry): number {
  if (geometry.boundingBox === null) geometry.computeBoundingBox();
  return geometry.boundingBox?.max.y ?? 0;
}

function cosmetic(tx: number, tz: number, plantedDay: number, channel: Channel): number {
  return hashFloat(tx, tz, plantedDay, Salt.Cosmetic, channel);
}

function rippleDelay(tx: number, tz: number): number {
  return hashFloat(tx, tz, Salt.Cosmetic, Channel.Ripple) * MOTION.rippleSeconds;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function approxEqual(a: THREE.Vector3, b: THREE.Vector3): boolean {
  return Math.abs(a.x - b.x) < 1e-4 && Math.abs(a.y - b.y) < 1e-4 && Math.abs(a.z - b.z) < 1e-4;
}

function sameGridShape(a: GridSpec, b: GridSpec): boolean {
  return (
    a === b ||
    (a.width === b.width &&
      a.depth === b.depth &&
      a.tileSize === b.tileSize &&
      a.originX === b.originX &&
      a.originZ === b.originZ)
  );
}

function sameCrop(a: CropInstance, b: CropInstance): boolean {
  return a.cropId === b.cropId && a.plantedDay === b.plantedDay;
}

/** Which foliage model a crop shows (see the module header). */
function foliageBucket(def: CropDefinition, crop: CropInstance): FoliageBucket {
  const stages = stageCount(def);
  if (crop.stage >= stages || crop.regrowing) return 'mature';
  if (FORM_PARTS[def.visual.form].seedlings) {
    if (crop.stage === 0) return 'seedling';
    if (crop.stage === 1) return 'sprout';
  }
  return crop.stage / stages >= LOOK.matureFoliageFraction ? 'mature' : 'growing';
}

/** Progress through the current stage, 0 → 1. */
function stageFraction(def: CropDefinition, crop: CropInstance): number {
  if (crop.stage >= stageCount(def)) return 1;
  return Math.min(1, crop.daysInStage / daysRequiredForStage(def, crop));
}

/** Seedlings and sprouts of small crops stay small so no stage looks shorter than the last. */
function youngSize(def: CropDefinition): number {
  return THREE.MathUtils.clamp(def.visual.height / LOOK.youngReferenceHeight, LOOK.youngSizeMin, LOOK.youngSizeMax);
}

function easeOutBack(t: number): number {
  const c1 = MOTION.overshoot;
  const c3 = c1 + 1;
  const u = t - 1;
  return 1 + c3 * u * u * u + c1 * u * u;
}

function easeInBack(t: number): number {
  const c1 = MOTION.overshoot;
  const c3 = c1 + 1;
  return c3 * t * t * t - c1 * t * t;
}

function easeOutCubic(t: number): number {
  const u = 1 - t;
  return 1 - u * u * u;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Writes the layer's scale at normalised time t ∈ [0, 1] of its tween into `out`. */
function sampleMotion(layer: Layer, t: number, out: THREE.Vector3): void {
  switch (layer.motion) {
    case 'grow':
      out.lerpVectors(layer.from, layer.rest, easeOutBack(t));
      break;
    case 'wilt':
      out.lerpVectors(layer.from, layer.rest, easeInOutCubic(t));
      break;
    case 'shrink':
      out.copy(layer.from).multiplyScalar(1 - easeInBack(t));
      break;
    case 'bounce': {
      out.lerpVectors(layer.from, layer.rest, easeOutCubic(t));
      const squash = layer.amplitude * Math.sin(t * Math.PI * 3) * (1 - t) * (1 - t);
      out.x *= 1 - squash * 0.5;
      out.y *= 1 + squash;
      out.z *= 1 - squash * 0.5;
      break;
    }
    case null:
      out.copy(layer.rest);
      break;
  }
}

/** Composes the layer's shown transform into scratchMatrix. */
function composeLayer(layer: Layer): THREE.Matrix4 {
  scratchScale.set(
    Math.max(MOTION.minScale, layer.shown.x),
    Math.max(MOTION.minScale, layer.shown.y),
    Math.max(MOTION.minScale, layer.shown.z),
  );
  return scratchMatrix.compose(layer.position, layer.quaternion, scratchScale);
}

function createLook(): CropLook {
  return {
    foliage: 'seedling',
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    foliageScale: new THREE.Vector3(1, 1, 1),
    foliageColor: new THREE.Color(),
    accent: null,
    accentPosition: new THREE.Vector3(),
    accentQuaternion: new THREE.Quaternion(),
    accentScale: new THREE.Vector3(1, 1, 1),
    accentColor: new THREE.Color(),
    thirsty: false,
    dropletPosition: new THREE.Vector3(),
  };
}

// ---------------------------------------------------------------------------
// Materials and meshes
// ---------------------------------------------------------------------------

/**
 * Thirst droplet material: glossy, softly glowing blue (readable at night), bobbing and
 * spinning in the vertex shader with a per-instance phase taken from the instance position.
 */
function createDropletMaterial(): THREE.MeshStandardMaterial {
  const material = createFlatMaterial(DROPLET.color, {
    roughness: 0.3,
    emissive: DROPLET.glow,
    emissiveIntensity: 0.55,
  });
  const motion = { value: new THREE.Vector3(DROPLET.bobSpeed, DROPLET.bobHeight, DROPLET.spinSpeed) };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = sharedUniforms.uTime;
    shader.uniforms.uDropletMotion = motion;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', ['#include <common>', 'uniform float uTime;', 'uniform vec3 uDropletMotion;'].join('\n'))
      .replace(
        '#include <begin_vertex>',
        [
          '#include <begin_vertex>',
          '{',
          '  #ifdef USE_INSTANCING',
          '    vec2 dropletOrigin = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);',
          '  #else',
          '    vec2 dropletOrigin = vec2(modelMatrix[3][0], modelMatrix[3][2]);',
          '  #endif',
          '  float dropletPhase = dot(dropletOrigin, vec2(1.37, 2.11));',
          '  float dropletSpin = uTime * uDropletMotion.z + dropletPhase;',
          '  float dropletCos = cos(dropletSpin);',
          '  float dropletSin = sin(dropletSpin);',
          '  transformed.xz = vec2(',
          '    dropletCos * transformed.x - dropletSin * transformed.z,',
          '    dropletSin * transformed.x + dropletCos * transformed.z',
          '  );',
          '  transformed.y += sin(uTime * uDropletMotion.x + dropletPhase) * uDropletMotion.y;',
          '}',
        ].join('\n'),
      );
  };
  material.customProgramCacheKey = () => 'meadowlight-crop-droplet-v1';
  return material;
}

/** Sway amplitude for createSwayMaterial so the part's top moves by its swayReach. */
function swayAmplitude(id: PartId, geometries: Readonly<Record<PartId, THREE.BufferGeometry>>): number | null {
  const spec = PART_SPECS[id];
  if (spec.swayWith !== undefined) return swayAmplitude(spec.swayWith, geometries);
  if (spec.swayReach === undefined) return null;
  const top = geometryTop(geometries[id]);
  return spec.swayReach / Math.max(top * top, 1e-3);
}

function createPartMaterial(spec: PartSpec, amplitude: number | null): THREE.MeshStandardMaterial {
  if (spec.role === 'indicator') return createDropletMaterial();
  const params: THREE.MeshStandardMaterialParameters = { vertexColors: true, roughness: spec.roughness ?? 0.9 };
  return amplitude === null ? createFlatMaterial(0xffffff, params) : createSwayMaterial(0xffffff, { amplitude }, params);
}

function createInstancing(
  id: PartId,
  role: PartRole,
  geometry: THREE.BufferGeometry,
  material: THREE.MeshStandardMaterial,
  capacity: number,
): { readonly mesh: THREE.InstancedMesh; readonly slots: InstanceSlotMap } {
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.name = `crops:${id}`;
  mesh.castShadow = role === 'foliage' || role === 'produce';
  mesh.receiveShadow = role !== 'indicator';
  mesh.matrixAutoUpdate = false;
  const slots = new InstanceSlotMap(mesh, role !== 'indicator');
  mesh.visible = false;
  return { mesh, slots };
}

function createParts(capacity: number, group: THREE.Group): Record<PartId, Part> {
  const geometries = recordOf(PART_IDS, (id) => PART_SPECS[id].build());
  return recordOf(PART_IDS, (id, index) => {
    const spec = PART_SPECS[id];
    const geometry = geometries[id];
    const material = createPartMaterial(spec, swayAmplitude(id, geometries));
    const { mesh, slots } = createInstancing(id, spec.role, geometry, material, capacity);
    group.add(mesh);
    return { id, index, role: spec.role, geometry, material, top: geometryTop(geometry), mesh, slots, dirty: false };
  });
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

export class CropRenderer implements RenderSystem {
  private readonly scene: THREE.Scene;
  private readonly group = new THREE.Group();
  private readonly parts: Readonly<Record<PartId, Part>>;
  private readonly partList: readonly Part[];
  private readonly records = new Map<number, CropRecord>();
  /** Layers with a running tween: the only instances update() touches. */
  private readonly animating = new Set<Layer>();
  /** Layers shrinking away after their crop or part is gone, by slotKey(part, tile). */
  private readonly leaving = new Map<number, Layer>();
  /** Scratch target of describe(); copied into layers immediately. */
  private readonly look = createLook();
  private capacity: number;

  constructor(ctx: SceneContext) {
    this.scene = ctx.scene;
    this.capacity = tileCount(ctx.grid);
    this.group.name = 'crops';
    this.parts = createParts(this.capacity, this.group);
    this.partList = PART_IDS.map((id) => this.parts[id]);
    this.scene.add(this.group);
  }

  sync(state: GameState, prev: GameState | null): void {
    if (prev === null) {
      this.rebuild(state);
      return;
    }
    const chunks = state.world.chunks;
    const prevChunks = prev.world.chunks;
    if (chunks === prevChunks) return;
    const grid = state.world.grid;
    if (!sameGridShape(grid, prev.world.grid)) {
      this.rebuild(state);
      return;
    }
    const newDay = state.time.absoluteDay !== prev.time.absoluteDay;
    for (let ci = 0; ci < chunks.length; ci++) {
      const chunk = chunks[ci];
      const prevChunk = prevChunks[ci];
      if (chunk === undefined || chunk === prevChunk) continue;
      const prevTiles = prevChunk !== undefined && prevChunk.tiles.length === chunk.tiles.length ? prevChunk.tiles : null;
      this.applyChunk(grid, chunk, prevTiles, true, newDay);
    }
    this.commit();
  }

  update(frame: FrameContext): void {
    if (this.animating.size === 0) return;
    for (const layer of this.animating) {
      layer.elapsed += frame.dt;
      if (layer.elapsed < layer.delay) continue;
      const t = layer.duration > 0 ? (layer.elapsed - layer.delay) / layer.duration : 1;
      if (t >= 1) {
        this.finishMotion(layer);
        continue;
      }
      sampleMotion(layer, t, layer.shown);
      this.writeMatrix(layer);
    }
    this.commit();
  }

  dispose(): void {
    this.scene.remove(this.group);
    for (const part of this.partList) {
      part.mesh.dispose();
      part.geometry.dispose();
      part.material.dispose();
    }
    this.group.clear();
    this.records.clear();
    this.animating.clear();
    this.leaving.clear();
  }

  // -------------------------------------------------------------------------
  // Diffing
  // -------------------------------------------------------------------------

  private rebuild(state: GameState): void {
    const grid = state.world.grid;
    this.records.clear();
    this.animating.clear();
    this.leaving.clear();
    this.ensureCapacity(tileCount(grid));
    for (const part of this.partList) {
      part.slots.clear();
      part.dirty = true;
    }
    for (const chunk of state.world.chunks) this.applyChunk(grid, chunk, null, false, false);
    this.commit();
  }

  /**
   * Applies every tile of `chunk` that differs from `prevTiles` (all tiles when null).
   * `ripple` staggers the animations per tile, for whole-field overnight changes.
   */
  private applyChunk(grid: GridSpec, chunk: Chunk, prevTiles: readonly Tile[] | null, animate: boolean, ripple: boolean): void {
    const tiles = chunk.tiles;
    for (let i = 0; i < tiles.length; i++) {
      const tile = tiles[i];
      if (tile === undefined || (prevTiles !== null && prevTiles[i] === tile)) continue;
      const lz = Math.floor(i / chunk.width);
      this.applyTile(grid, chunk.x0 + (i - lz * chunk.width), chunk.z0 + lz, tile, animate, ripple);
    }
  }

  private applyTile(grid: GridSpec, tx: number, tz: number, tile: Tile, animate: boolean, ripple: boolean): void {
    const key = tileIndex(grid, tx, tz);
    const record = this.records.get(key);
    const crop = tile.crop;
    if (crop === null && record === undefined) return;
    const delay = animate && ripple ? rippleDelay(tx, tz) : 0;

    if (crop === null) {
      if (record !== undefined) {
        this.retireRecord(record, animate, delay);
        this.records.delete(key);
      }
      return;
    }

    const look = this.describe(grid, tx, tz, tile, crop);
    if (record === undefined || !sameCrop(record.crop, crop)) {
      if (record !== undefined) this.retireRecord(record, false, 0);
      this.records.set(key, this.createRecord(key, crop, look, animate, delay));
      return;
    }
    this.updateRecord(record, crop, look, animate, delay);
  }

  // -------------------------------------------------------------------------
  // Appearance
  // -------------------------------------------------------------------------

  /** Computes the target appearance of a planted tile into the shared scratch look. */
  private describe(grid: GridSpec, tx: number, tz: number, tile: Tile, crop: CropInstance): CropLook {
    const look = this.look;
    const def = CROPS[crop.cropId];
    const visual = def.visual;
    const day = crop.plantedDay;
    const dead = crop.dead;
    const mature = isMature(crop);
    const forms = FORM_PARTS[visual.form];
    const bucket = foliageBucket(def, crop);
    const sizeJitter = 1 + (cosmetic(tx, tz, day, Channel.Size) * 2 - 1) * LOOK.sizeJitter;
    // Uniform scale that makes the form's mature foliage exactly the crop's authored height.
    const cropScale = (visual.height / Math.max(0.01, this.parts[forms.mature].top)) * sizeJitter;

    // Placement ------------------------------------------------------------
    const x = tileCenterX(grid, tx) + (cosmetic(tx, tz, day, Channel.OffsetX) * 2 - 1) * LOOK.placementJitter;
    const z = tileCenterZ(grid, tz) + (cosmetic(tx, tz, day, Channel.OffsetZ) * 2 - 1) * LOOK.placementJitter;
    // Wild crops stand on untilled grass; everything else on the sunken soil.
    const untilled = tile.state === TileState.Unplowed;
    const ground = untilled ? HEIGHTS.grassTop : HEIGHTS.soilTop;
    look.position.set(x, ground, z);
    look.quaternion.setFromAxisAngle(UP, cosmetic(tx, tz, day, Channel.Yaw) * TAU);

    // Foliage model and scale ------------------------------------------------
    let scale: number;
    switch (bucket) {
      case 'seedling':
        look.foliage = 'seedling';
        scale = lerp(0.85, 1.05, stageFraction(def, crop)) * youngSize(def) * sizeJitter;
        break;
      case 'sprout':
        look.foliage = 'sprout';
        scale = lerp(0.7, 0.95, stageFraction(def, crop)) * youngSize(def) * sizeJitter;
        break;
      case 'growing':
      case 'mature':
        look.foliage = forms[bucket];
        scale = mature || crop.regrowing ? cropScale : cropScale * lerp(LOOK.growthMinScale, 1, growthProgress(crop));
        break;
    }
    look.foliageScale.setScalar(scale);

    // Wild crops need no water, so they never yellow, wilt or ask for a drink.
    const dry = !dead && !mature && !crop.wild && tile.state === TileState.Plowed;
    const dryNights = Math.min(crop.dryDays, LOOK.maxDryNights);
    if (dry) look.foliageScale.y *= 1 - LOOK.wiltPerNight * dryNights;
    if (dead) {
      look.foliageScale.set(scale * LOOK.deadSpread, scale * LOOK.deadDroop, scale * LOOK.deadSpread);
      const leanHeading = cosmetic(tx, tz, day, Channel.LeanHeading) * TAU;
      scratchAxis.set(Math.cos(leanHeading), 0, -Math.sin(leanHeading));
      look.quaternion.premultiply(scratchQuaternion.setFromAxisAngle(scratchAxis, LOOK.deadLean));
    }

    // Foliage colour ---------------------------------------------------------
    const shade = cosmetic(tx, tz, day, Channel.FoliageShade);
    if (dead) {
      look.foliageColor.copy(DEAD_BROWN).lerp(DEAD_GREY, shade * 0.7);
    } else {
      look.foliageColor.setHex(visual.foliageColor).offsetHSL(0, 0, (shade * 2 - 1) * LOOK.colorJitter);
      if (bucket === 'seedling' || bucket === 'sprout') look.foliageColor.lerp(WHITE, LOOK.youngLighten);
      if (dry) look.foliageColor.lerp(DRY_TINT, LOOK.dryTintBase + LOOK.dryTintPerNight * dryNights);
    }

    // Accent: soil mound of a freshly sown seed, or the produce of a mature crop -
    look.accent = null;
    const produce = PRODUCE_PARTS[visual.produce];
    const sown = !crop.wild && !untilled && forms.seedlings;
    if (crop.stage === 0 && !crop.regrowing && sown) {
      look.accent = 'soilMound';
      look.accentPosition.copy(look.position);
      look.accentQuaternion.setFromAxisAngle(UP, cosmetic(tx, tz, day, Channel.MoundYaw) * TAU);
      look.accentScale.setScalar(0.92 + 0.16 * cosmetic(tx, tz, day, Channel.MoundSize));
      look.accentColor.copy(tile.state === TileState.Watered ? SOIL_WET : SOIL_DRY);
    } else if (mature && produce !== null) {
      look.accent = produce.part;
      look.accentScale.setScalar(cropScale);
      if (produce.placement === 'attached') {
        look.accentPosition.copy(look.position);
        look.accentQuaternion.copy(look.quaternion);
      } else {
        const nudge = GROUND_NUDGE[visual.form] * cropScale;
        look.accentPosition.set(x + VIEW_X * nudge, ground, z + VIEW_Z * nudge);
        look.accentQuaternion.setFromAxisAngle(UP, cosmetic(tx, tz, day, Channel.ProduceYaw) * TAU);
      }
      look.accentColor
        .setHex(visual.produceColor)
        .offsetHSL(0, 0, (cosmetic(tx, tz, day, Channel.ProduceShade) * 2 - 1) * LOOK.colorJitter);
    }

    // Thirst indicator --------------------------------------------------------
    look.thirsty = dry;
    if (dry) {
      const top = Math.max(LOOK.dropletMinTop, this.parts[look.foliage].top * look.foliageScale.y);
      look.dropletPosition.set(x, ground + top + LOOK.dropletClearance, z);
    }
    return look;
  }

  // -------------------------------------------------------------------------
  // Records
  // -------------------------------------------------------------------------

  private createRecord(key: number, crop: CropInstance, look: CropLook, animate: boolean, delay: number): CropRecord {
    const foliage = this.spawnLayer(this.parts[look.foliage], key, look.position, look.quaternion, look.foliageScale);
    this.enter(foliage, animate, delay, MOTION.growSeconds);
    this.writeLayer(foliage, look.foliageColor);

    let accent: Layer | null = null;
    if (look.accent !== null) {
      const part = this.parts[look.accent];
      accent = this.spawnLayer(part, key, look.accentPosition, look.accentQuaternion, look.accentScale);
      const duration = part.role === 'produce' ? MOTION.produceSeconds : MOTION.growSeconds;
      this.enter(accent, animate, delay + MOTION.accentStagger, duration);
      this.writeLayer(accent, look.accentColor);
    }

    let droplet: Layer | null = null;
    if (look.thirsty) {
      droplet = this.spawnLayer(this.parts.droplet, key, look.dropletPosition, IDENTITY_QUATERNION, DROPLET_REST_SCALE);
      this.enter(droplet, animate, delay + MOTION.dropletStagger, MOTION.growSeconds);
      this.writeLayer(droplet, null);
    }
    return { crop, foliage, accent, droplet };
  }

  private updateRecord(record: CropRecord, crop: CropInstance, look: CropLook, animate: boolean, delay: number): void {
    const previous = record.crop;
    record.crop = crop;
    const key = record.foliage.key;
    const wasMature = isMature(previous);
    const nowMature = isMature(crop);
    const wasThirsty = record.droplet !== null;

    // Foliage ----------------------------------------------------------------
    const foliage = record.foliage;
    const foliagePart = this.parts[look.foliage];
    foliage.position.copy(look.position);
    foliage.quaternion.copy(look.quaternion);
    if (foliage.part !== foliagePart) {
      // New stage model: move the key to the other map and pop it in.
      this.movePart(foliage, foliagePart);
      foliage.rest.copy(look.foliageScale);
      if (animate) {
        foliage.from.copy(foliage.rest).multiplyScalar(MOTION.popFrom);
        this.startMotion(foliage, 'grow', delay, MOTION.growSeconds);
      } else {
        this.settle(foliage);
      }
    } else {
      const restChanged = !approxEqual(foliage.rest, look.foliageScale);
      foliage.rest.copy(look.foliageScale);
      if (!animate) {
        if (restChanged) this.settle(foliage);
      } else if (nowMature && !wasMature) {
        foliage.from.copy(foliage.shown);
        this.startMotion(foliage, 'bounce', delay, MOTION.bounceSeconds, MOTION.celebrate);
      } else if (restChanged) {
        const wilting = crop.dead && !previous.dead;
        foliage.from.copy(foliage.shown);
        this.startMotion(foliage, wilting ? 'wilt' : 'grow', delay, wilting ? MOTION.wiltSeconds : MOTION.growSeconds);
      } else if (foliage.motion === null && !crop.dead) {
        const harvested = wasMature && !nowMature;
        const drank = wasThirsty && !look.thirsty;
        const amplitude = harvested ? MOTION.rustle : drank ? MOTION.drink : 0;
        if (amplitude > 0) {
          foliage.from.copy(foliage.shown);
          this.startMotion(foliage, 'bounce', delay, MOTION.bounceSeconds, amplitude);
        }
      }
    }
    this.writeLayer(foliage, look.foliageColor);

    // Accent -----------------------------------------------------------------
    const accentPart = look.accent === null ? null : this.parts[look.accent];
    let accent = record.accent;
    if (accent !== null && accent.part !== accentPart) {
      this.retireLayer(accent, animate, delay);
      accent = null;
    }
    if (accentPart !== null) {
      if (accent === null) {
        accent = this.spawnLayer(accentPart, key, look.accentPosition, look.accentQuaternion, look.accentScale);
        const duration = accentPart.role === 'produce' ? MOTION.produceSeconds : MOTION.growSeconds;
        this.enter(accent, animate, delay + MOTION.accentStagger, duration);
      } else {
        accent.position.copy(look.accentPosition);
        accent.quaternion.copy(look.accentQuaternion);
        if (!approxEqual(accent.rest, look.accentScale)) {
          accent.rest.copy(look.accentScale);
          if (animate) {
            accent.from.copy(accent.shown);
            this.startMotion(accent, 'grow', delay, MOTION.growSeconds);
          } else {
            this.settle(accent);
          }
        }
      }
      this.writeLayer(accent, look.accentColor);
    }
    record.accent = accent;

    // Thirst droplet ---------------------------------------------------------
    let droplet = record.droplet;
    if (look.thirsty) {
      if (droplet === null) {
        droplet = this.spawnLayer(this.parts.droplet, key, look.dropletPosition, IDENTITY_QUATERNION, DROPLET_REST_SCALE);
        this.enter(droplet, animate, delay + MOTION.dropletStagger, MOTION.growSeconds);
      } else {
        droplet.position.copy(look.dropletPosition);
      }
      this.writeLayer(droplet, null);
    } else if (droplet !== null) {
      this.retireLayer(droplet, animate, delay);
      droplet = null;
    }
    record.droplet = droplet;
  }

  private retireRecord(record: CropRecord, animate: boolean, delay: number): void {
    this.retireLayer(record.foliage, animate, delay);
    if (record.accent !== null) this.retireLayer(record.accent, animate, delay);
    if (record.droplet !== null) this.retireLayer(record.droplet, animate, delay);
  }

  // -------------------------------------------------------------------------
  // Layers
  // -------------------------------------------------------------------------

  private slotKey(part: Part, key: number): number {
    return part.index * this.capacity + key;
  }

  /** A fresh layer in `part` for tile `key`, evicting any leaving instance that holds that slot. */
  private spawnLayer(
    part: Part,
    key: number,
    position: THREE.Vector3,
    quaternion: THREE.Quaternion,
    rest: THREE.Vector3,
  ): Layer {
    this.evictLeaving(part, key);
    return {
      part,
      key,
      position: position.clone(),
      quaternion: quaternion.clone(),
      rest: rest.clone(),
      shown: rest.clone(),
      from: new THREE.Vector3(),
      motion: null,
      elapsed: 0,
      delay: 0,
      duration: 0,
      amplitude: 0,
      leaving: false,
    };
  }

  /** Moves a live layer's instance to another part's map (the caller writes it afterwards). */
  private movePart(layer: Layer, part: Part): void {
    this.animating.delete(layer);
    layer.motion = null;
    layer.part.slots.remove(layer.key);
    layer.part.dirty = true;
    this.evictLeaving(part, layer.key);
    layer.part = part;
  }

  private evictLeaving(part: Part, key: number): void {
    const slotKey = this.slotKey(part, key);
    const ghost = this.leaving.get(slotKey);
    if (ghost === undefined) return;
    this.leaving.delete(slotKey);
    this.animating.delete(ghost);
    part.slots.remove(key);
    part.dirty = true;
  }

  /** Shrinks a layer away (or removes it at once) and forgets it when done. */
  private retireLayer(layer: Layer, animate: boolean, delay: number): void {
    if (!animate) {
      this.animating.delete(layer);
      layer.motion = null;
      layer.part.slots.remove(layer.key);
      layer.part.dirty = true;
      return;
    }
    layer.leaving = true;
    this.leaving.set(this.slotKey(layer.part, layer.key), layer);
    layer.from.copy(layer.shown);
    this.startMotion(layer, 'shrink', delay, MOTION.shrinkSeconds);
  }

  /** Entrance of a newly spawned layer: pop from nothing, or appear at rest without animation. */
  private enter(layer: Layer, animate: boolean, delay: number, duration: number): void {
    if (!animate) {
      this.settle(layer);
      return;
    }
    layer.from.set(0, 0, 0);
    this.startMotion(layer, 'grow', delay, duration);
  }

  private settle(layer: Layer): void {
    this.animating.delete(layer);
    layer.motion = null;
    layer.shown.copy(layer.rest);
  }

  /** Starts a tween; `layer.from` must already hold its starting scale. */
  private startMotion(layer: Layer, motion: Motion, delay: number, duration: number, amplitude = 0): void {
    layer.motion = motion;
    layer.elapsed = 0;
    layer.delay = delay;
    layer.duration = duration;
    layer.amplitude = amplitude;
    sampleMotion(layer, 0, layer.shown);
    this.animating.add(layer);
  }

  private finishMotion(layer: Layer): void {
    this.animating.delete(layer);
    layer.motion = null;
    if (layer.leaving) {
      this.leaving.delete(this.slotKey(layer.part, layer.key));
      layer.part.slots.remove(layer.key);
      layer.part.dirty = true;
      return;
    }
    layer.shown.copy(layer.rest);
    this.writeMatrix(layer);
  }

  /** Inserts or updates the layer's instance; colour maps must receive a colour on insert. */
  private writeLayer(layer: Layer, color: THREE.Color | null): void {
    layer.part.slots.set(layer.key, composeLayer(layer), color ?? undefined);
    layer.part.dirty = true;
  }

  private writeMatrix(layer: Layer): void {
    layer.part.slots.setMatrix(layer.key, composeLayer(layer));
    layer.part.dirty = true;
  }

  private commit(): void {
    for (const part of this.partList) {
      if (!part.dirty) continue;
      part.slots.commit();
      part.mesh.visible = part.slots.size > 0;
      part.dirty = false;
    }
  }

  /** Grows every part's instance buffers when a loaded world has more tiles than the last. */
  private ensureCapacity(required: number): void {
    if (required <= this.capacity) return;
    for (const part of this.partList) {
      this.group.remove(part.mesh);
      part.mesh.dispose();
      const { mesh, slots } = createInstancing(part.id, part.role, part.geometry, part.material, required);
      this.group.add(mesh);
      part.mesh = mesh;
      part.slots = slots;
      part.dirty = false;
    }
    this.capacity = required;
  }
}
