/**
 * TerrainRenderer: the ground, soil, meadow, debris and pond of the farm.
 *
 * Draw calls do not grow with the number of tiles: one InstancedMesh per chunk for the ground,
 * plus a fixed handful of global instanced meshes (furrows, grass tufts, flowers, three rock
 * variants, stumps, pond water and pond rim stones). Empty global meshes are hidden.
 *
 * Layers
 * - Ground (per chunk, fixed count, slot = chunk-local tile index): one bevelled slab per tile
 *   whose top sits on HEIGHTS.grassTop (grass, and under rocks / stumps / buildings),
 *   HEIGHTS.soilTop (plowed and watered soil) or HEIGHTS.pondBed (water tiles). Deterministic
 *   colour jitter plus a soft low-frequency field make the grid read as tiles without drawn
 *   lines. The ground shader paints the slab walls earth-brown with a little fake occlusion, so
 *   height steps (soil beds, the pond bank, the edge of the farm) read as cut earth.
 * - Shade (world/shade.ts): grass on shaded tiles, and the tufts on it, blend toward a cool
 *   blue-green and darken a little, deepest where the tile's neighbours are shaded too, so the
 *   patches where wild crops grow read as soft shadow rather than a painted stripe.
 * - Furrows, tufts, flowers, rocks and stumps: global InstanceSlotMaps keyed by tileIndex.
 *   Tufts and flowers make way for a crop growing wild on their grass tile.
 * - Pond: tile-sized water quads rippled in the vertex shader (sharedUniforms.uTime), tinted
 *   deeper away from the shore, plus pebbles along the bank. Rebuilt only when a water tile
 *   changes, which in normal play happens only on a full rebuild.
 *
 * Diffing follows the RenderSystem contract: sync() visits only chunks whose reference changed
 * and, inside them, only tiles whose reference changed. When a rock's or stump's blockerHp drops,
 * a 0.25 s squash-and-wobble plays (tilting away from the player); update() touches exactly the
 * instances that are animating and nothing else.
 */
import * as THREE from 'three';
import { TOOLS } from '../config';
import { Salt, hash32, hashFloat } from '../core/hash';
import { Blocker, TileState, type Direction, type GameState, type GridSpec, type Tile } from '../core/types';
import {
  DIRECTION_STEPS,
  chunkCount,
  chunkRectByIndex,
  directionStep,
  inBounds,
  locateTile,
  tileCenterX,
  tileCenterZ,
  tileCount,
  tileFromIndex,
  tileIndex,
  type ChunkRect,
} from '../world/grid';
import { isShadedTile } from '../world/shade';
import { HEIGHTS } from './constants';
import { InstanceSlotMap } from './InstanceSlotMap';
import { createFlatMaterial, createSwayMaterial, sharedUniforms } from './materials';
import { PALETTE } from './palette';
import type { SceneContext } from './SceneContext';
import {
  ROCK_VARIANT_COUNT,
  TERRAIN_ATTRIBUTE,
  TINT_MASK_ATTRIBUTE,
  createFlowerGeometry,
  createFurrowGeometry,
  createGrassTuftGeometry,
  createGroundSlabGeometry,
  createPondStoneGeometry,
  createRockGeometry,
  createStumpGeometry,
  createWaterSurfaceGeometry,
} from './terrainGeometry';
import type { FrameContext, RenderSystem } from './types';

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

const TAU = Math.PI * 2;

/** Share of unplowed tiles that carry a grass tuft. */
const TUFT_CHANCE = 0.4;
/** Share of unplowed tiles that carry a flower cluster. */
const FLOWER_CHANCE = 0.05;
/** A rock shrinks toward this fraction of its full size as its hit points run out. */
const ROCK_DEPLETED_SCALE = 0.72;
/** Rocks and stumps sink this far into the grass so their flat bases never float. */
const DEBRIS_SINK = 0.02;

/** Hit feedback for rocks and stumps. */
const HIT = {
  /** Seconds. */
  duration: 0.25,
  /** Peak vertical squash (fraction of height) at impact. */
  squash: 0.2,
  /** Peak tilt away from the player (radians). */
  tilt: 0.16,
  /** Peak shove away from the player (fraction of the instance scale). */
  push: 0.035,
  rockStrength: 1,
  stumpStrength: 0.75,
} as const;

const POND = {
  /** Amplitude of the vertex ripple (world units). */
  waveHeight: 0.028,
  opacity: 0.8,
  roughness: 0.12,
  /** Tiles from the shore at which water reaches PALETTE.waterDeep. */
  depthRings: 3,
  /** How much darker the pond bed gets at full depth. */
  bedDarkening: 0.3,
} as const;

/** Cool tint of shaded grass (see world/shade.ts). */
const SHADE_TINT = {
  /** Soft blue-green the grass blends toward. */
  color: 0x5c9a92,
  /** Blend toward `color` at full shade. */
  mix: 0.3,
  /** Brightness multiplier at full shade. */
  darken: 0.86,
  /** Share of full shade on a shaded tile with no shaded neighbours; enclosed tiles reach 1. */
  edge: 0.6,
} as const;

/** Independent cosmetic hash channels (combined with tile coordinates and Salt.Cosmetic). */
const Channel = {
  FieldCoarse: 101,
  FieldFine: 102,
  GrassPick: 103,
  GrassShade: 104,
  SoilShade: 105,
  BedShade: 106,
  FurrowYaw: 110,
  FurrowShade: 111,
  Tuft: 120,
  TuftAngle: 121,
  TuftRadius: 122,
  TuftYaw: 123,
  TuftScale: 124,
  TuftShade: 125,
  Flower: 130,
  FlowerAngle: 131,
  FlowerRadius: 132,
  FlowerYaw: 133,
  FlowerScale: 134,
  FlowerColor: 135,
  RockVariant: 140,
  RockOffsetX: 141,
  RockOffsetZ: 142,
  RockYaw: 143,
  RockScale: 144,
  RockStretch: 145,
  RockShade: 146,
  RockBright: 147,
  StumpOffsetX: 150,
  StumpOffsetZ: 151,
  StumpYaw: 152,
  StumpScale: 153,
  StumpShade: 154,
  StoneCount: 160,
  StoneAlong: 161,
  StoneInset: 162,
  StoneLift: 163,
  StoneYaw: 164,
  StoneScale: 165,
  StoneSquash: 166,
  StoneShade: 167,
  StoneMoss: 168,
} as const;

// ---------------------------------------------------------------------------
// Colours and scratch objects (module level: no allocations in hot paths)
// ---------------------------------------------------------------------------

const GRASS_DARK = new THREE.Color(PALETTE.grass[3]);
const GRASS_LIGHT = new THREE.Color(PALETTE.grass[2]);
const SOIL_DRY = new THREE.Color(PALETTE.soilPlowed);
const SOIL_WET = new THREE.Color(PALETTE.soilWatered);
const FURROW_DRY = new THREE.Color(PALETTE.soilFurrow);
const FURROW_WET = new THREE.Color(PALETTE.soilFurrowWet);
const POND_BED = new THREE.Color(PALETTE.pondBed);
const WATER_SHALLOW = new THREE.Color(PALETTE.water);
const WATER_DEEP = new THREE.Color(PALETTE.waterDeep);
const ROCK_LIGHT = new THREE.Color(PALETTE.rock);
const ROCK_DARK = new THREE.Color(PALETTE.rockDark);
const TUFT_GREEN = new THREE.Color(PALETTE.grassTuft);
const SHADE_COLOR = new THREE.Color(SHADE_TINT.color);

const UP = new THREE.Vector3(0, 1, 0);
/** Collapses an instance to nothing (only used for tiles missing from a malformed chunk). */
const HIDDEN_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);

const scratchMatrix = new THREE.Matrix4();
const scratchPosition = new THREE.Vector3();
const scratchScale = new THREE.Vector3();
const scratchAxis = new THREE.Vector3();
const scratchYaw = new THREE.Quaternion();
const scratchTilt = new THREE.Quaternion();
const scratchRotation = new THREE.Quaternion();
const scratchColor = new THREE.Color();
const scratchTint = new THREE.Color();

/** Rest placement of a rock or stump instance. */
interface Pose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Uniform scale (already multiplied by the tile size). */
  scale: number;
  /** Elongation along local X (positive) / Z (negative). */
  stretch: number;
}

const scratchPose: Pose = { x: 0, y: 0, z: 0, yaw: 0, scale: 1, stretch: 0 };

// ---------------------------------------------------------------------------
// Deterministic cosmetic variation
// ---------------------------------------------------------------------------

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function cosmetic(tx: number, tz: number, channel: number): number {
  return hashFloat(tx, tz, channel, Salt.Cosmetic);
}

function pickHex(list: readonly number[], hash: number): number {
  const value = list[hash % list.length];
  if (value === undefined) throw new RangeError('TerrainRenderer: cannot pick from an empty palette');
  return value;
}

function smoothstep01(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Bilinear value noise over a lattice of `cell` tiles, in [0, 1). */
function valueNoise(tx: number, tz: number, cell: number, channel: number): number {
  const gx = tx / cell;
  const gz = tz / cell;
  const x0 = Math.floor(gx);
  const z0 = Math.floor(gz);
  const fx = smoothstep01(gx - x0);
  const fz = smoothstep01(gz - z0);
  const a = cosmetic(x0, z0, channel);
  const b = cosmetic(x0 + 1, z0, channel);
  const c = cosmetic(x0, z0 + 1, channel);
  const d = cosmetic(x0 + 1, z0 + 1, channel);
  const top = a + (b - a) * fx;
  const bottom = c + (d - c) * fx;
  return top + (bottom - top) * fz;
}

/** Soft patches of lighter and darker ground spanning several tiles. */
function fieldNoise(tx: number, tz: number): number {
  return 0.65 * valueNoise(tx, tz, 7, Channel.FieldCoarse) + 0.35 * valueNoise(tx, tz, 3, Channel.FieldFine);
}

function grassColor(tx: number, tz: number, target: THREE.Color): THREE.Color {
  target.lerpColors(GRASS_DARK, GRASS_LIGHT, fieldNoise(tx, tz));
  scratchTint.setHex(pickHex(PALETTE.grass, hash32(tx, tz, Channel.GrassPick, Salt.Cosmetic)));
  target.lerp(scratchTint, 0.35);
  return target.multiplyScalar(0.97 + 0.06 * cosmetic(tx, tz, Channel.GrassShade));
}

function soilColor(tx: number, tz: number, wet: boolean, target: THREE.Color): THREE.Color {
  const shade = 0.955 + 0.05 * fieldNoise(tx, tz) + 0.035 * cosmetic(tx, tz, Channel.SoilShade);
  return target.copy(wet ? SOIL_WET : SOIL_DRY).multiplyScalar(shade);
}

/** `depth` ∈ [0, 1]: 0 at the shore, 1 in the middle of the pond. */
function pondBedColor(tx: number, tz: number, depth: number, target: THREE.Color): THREE.Color {
  const shade = (1 - POND.bedDarkening * depth) * (0.96 + 0.08 * cosmetic(tx, tz, Channel.BedShade));
  return target.copy(POND_BED).multiplyScalar(shade);
}

/**
 * How shaded a tile looks, in [0, 1]: 0 in the open, SHADE_TINT.edge on a lone shaded tile,
 * rising to 1 as its eight neighbours (orthogonal ones weighted double) are shaded too. Tiles
 * beyond the grid count as shaded so the farm's edge does not show a lighter rim.
 */
function shadeAmount(grid: GridSpec, tx: number, tz: number): number {
  if (!isShadedTile(grid, tx, tz)) return 0;
  let weight = 0;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dz === 0) continue;
      const x = tx + dx;
      const z = tz + dz;
      if (!inBounds(grid, x, z) || isShadedTile(grid, x, z)) weight += dx === 0 || dz === 0 ? 2 : 1;
    }
  }
  return SHADE_TINT.edge + (1 - SHADE_TINT.edge) * (weight / 12);
}

/** Blends `target` toward the cool shade colour and darkens it by `amount` ∈ [0, 1]. */
function applyShade(amount: number, target: THREE.Color): THREE.Color {
  if (amount <= 0) return target;
  target.lerp(SHADE_COLOR, SHADE_TINT.mix * amount);
  return target.multiplyScalar(1 - (1 - SHADE_TINT.darken) * amount);
}

function furrowColor(tx: number, tz: number, wet: boolean, target: THREE.Color): THREE.Color {
  return target.copy(wet ? FURROW_WET : FURROW_DRY).multiplyScalar(0.97 + 0.06 * cosmetic(tx, tz, Channel.FurrowShade));
}

function tuftColor(tx: number, tz: number, target: THREE.Color): THREE.Color {
  return target.copy(TUFT_GREEN).multiplyScalar(0.9 + 0.16 * cosmetic(tx, tz, Channel.TuftShade));
}

function flowerColor(tx: number, tz: number, target: THREE.Color): THREE.Color {
  return target.setHex(pickHex(PALETTE.flower, hash32(tx, tz, Channel.FlowerColor, Salt.Cosmetic)));
}

function rockColor(tx: number, tz: number, target: THREE.Color): THREE.Color {
  target.lerpColors(ROCK_LIGHT, ROCK_DARK, 0.8 * cosmetic(tx, tz, Channel.RockShade));
  return target.multiplyScalar(0.96 + 0.08 * cosmetic(tx, tz, Channel.RockBright));
}

function stumpColor(tx: number, tz: number, target: THREE.Color): THREE.Color {
  return target.setScalar(0.92 + 0.12 * cosmetic(tx, tz, Channel.StumpShade));
}

function hasTuft(tx: number, tz: number): boolean {
  return cosmetic(tx, tz, Channel.Tuft) < TUFT_CHANCE;
}

function hasFlower(tx: number, tz: number): boolean {
  return cosmetic(tx, tz, Channel.Flower) < FLOWER_CHANCE;
}

function rockVariant(tx: number, tz: number): number {
  return hash32(tx, tz, Channel.RockVariant, Salt.Cosmetic) % ROCK_VARIANT_COUNT;
}

// ---------------------------------------------------------------------------
// Transforms
// ---------------------------------------------------------------------------

/**
 * Composes a pose with optional hit deformation: `squash` flattens (positive) or stretches
 * (negative) vertically with a matching bulge, `tilt` leans the top toward (dirX, dirZ) around the
 * base, and `push` shoves the whole instance along that direction.
 */
function composePose(
  pose: Pose,
  squash: number,
  tilt: number,
  dirX: number,
  dirZ: number,
  push: number,
  target: THREE.Matrix4,
): THREE.Matrix4 {
  scratchPosition.set(pose.x + dirX * push, pose.y, pose.z + dirZ * push);
  scratchYaw.setFromAxisAngle(UP, pose.yaw);
  // up × dir: rotating by +tilt around this axis leans the top toward dir.
  scratchAxis.set(dirZ, 0, -dirX);
  if (tilt !== 0 && scratchAxis.lengthSq() > 0) {
    scratchTilt.setFromAxisAngle(scratchAxis.normalize(), tilt);
    scratchRotation.multiplyQuaternions(scratchTilt, scratchYaw);
  } else {
    scratchRotation.copy(scratchYaw);
  }
  const bulge = 1 + squash * 0.5;
  scratchScale.set(
    pose.scale * (1 + pose.stretch) * bulge,
    pose.scale * (1 - squash),
    pose.scale * (1 - pose.stretch * 0.5) * bulge,
  );
  return target.compose(scratchPosition, scratchRotation, scratchScale);
}

function rockPose(grid: GridSpec, tx: number, tz: number, hp: number, out: Pose): Pose {
  const ts = grid.tileSize;
  const health = clamp01(hp / Math.max(1, TOOLS.rockHits));
  const size = (0.9 + 0.16 * cosmetic(tx, tz, Channel.RockScale)) * (ROCK_DEPLETED_SCALE + (1 - ROCK_DEPLETED_SCALE) * health);
  out.x = tileCenterX(grid, tx) + (cosmetic(tx, tz, Channel.RockOffsetX) - 0.5) * 0.12 * ts;
  out.y = HEIGHTS.grassTop - DEBRIS_SINK;
  out.z = tileCenterZ(grid, tz) + (cosmetic(tx, tz, Channel.RockOffsetZ) - 0.5) * 0.12 * ts;
  out.yaw = cosmetic(tx, tz, Channel.RockYaw) * TAU;
  out.scale = size * ts;
  out.stretch = (cosmetic(tx, tz, Channel.RockStretch) - 0.5) * 0.2;
  return out;
}

function stumpPose(grid: GridSpec, tx: number, tz: number, out: Pose): Pose {
  const ts = grid.tileSize;
  out.x = tileCenterX(grid, tx) + (cosmetic(tx, tz, Channel.StumpOffsetX) - 0.5) * 0.08 * ts;
  out.y = HEIGHTS.grassTop - DEBRIS_SINK;
  out.z = tileCenterZ(grid, tz) + (cosmetic(tx, tz, Channel.StumpOffsetZ) - 0.5) * 0.08 * ts;
  out.yaw = cosmetic(tx, tz, Channel.StumpYaw) * TAU;
  out.scale = (0.92 + 0.12 * cosmetic(tx, tz, Channel.StumpScale)) * ts;
  out.stretch = 0;
  return out;
}

function composeProp(x: number, y: number, z: number, yaw: number, sxz: number, sy: number, target: THREE.Matrix4): THREE.Matrix4 {
  scratchPosition.set(x, y, z);
  scratchRotation.setFromAxisAngle(UP, yaw);
  scratchScale.set(sxz, sy, sxz);
  return target.compose(scratchPosition, scratchRotation, scratchScale);
}

function tuftMatrix(grid: GridSpec, tx: number, tz: number, target: THREE.Matrix4): THREE.Matrix4 {
  const ts = grid.tileSize;
  const angle = cosmetic(tx, tz, Channel.TuftAngle) * TAU;
  const radius = (0.05 + 0.13 * cosmetic(tx, tz, Channel.TuftRadius)) * ts;
  const size = 0.8 + 0.35 * cosmetic(tx, tz, Channel.TuftScale);
  return composeProp(
    tileCenterX(grid, tx) + Math.cos(angle) * radius,
    HEIGHTS.grassTop,
    tileCenterZ(grid, tz) + Math.sin(angle) * radius,
    cosmetic(tx, tz, Channel.TuftYaw) * TAU,
    size * ts,
    size,
    target,
  );
}

/** Flowers sit roughly opposite the tile's tuft so the two never overlap. */
function flowerMatrix(grid: GridSpec, tx: number, tz: number, target: THREE.Matrix4): THREE.Matrix4 {
  const ts = grid.tileSize;
  const angle = cosmetic(tx, tz, Channel.TuftAngle) * TAU + Math.PI + (cosmetic(tx, tz, Channel.FlowerAngle) - 0.5) * 1.2;
  const radius = (0.12 + 0.16 * cosmetic(tx, tz, Channel.FlowerRadius)) * ts;
  const size = 0.85 + 0.3 * cosmetic(tx, tz, Channel.FlowerScale);
  return composeProp(
    tileCenterX(grid, tx) + Math.cos(angle) * radius,
    HEIGHTS.grassTop,
    tileCenterZ(grid, tz) + Math.sin(angle) * radius,
    cosmetic(tx, tz, Channel.FlowerYaw) * TAU,
    size * ts,
    size,
    target,
  );
}

function furrowMatrix(grid: GridSpec, tx: number, tz: number, target: THREE.Matrix4): THREE.Matrix4 {
  const ts = grid.tileSize;
  const yaw = (cosmetic(tx, tz, Channel.FurrowYaw) - 0.5) * 0.07;
  return composeProp(tileCenterX(grid, tx), HEIGHTS.soilTop, tileCenterZ(grid, tz), yaw, ts, 1, target);
}

// ---------------------------------------------------------------------------
// Pond rim stones
// ---------------------------------------------------------------------------

function stoneHash(tx: number, tz: number, direction: number, index: number, channel: number): number {
  return hashFloat(tx, tz, direction, index, channel, Salt.Cosmetic);
}

/** Number of pebbles on the bank edge of water tile (tx, tz) facing `direction`. */
function stonesOnEdge(tx: number, tz: number, direction: number): number {
  const roll = stoneHash(tx, tz, direction, 0, Channel.StoneCount);
  return roll < 0.25 ? 1 : roll < 0.85 ? 2 : 3;
}

function pondStoneMatrix(
  grid: GridSpec,
  tx: number,
  tz: number,
  direction: number,
  dx: number,
  dz: number,
  index: number,
  count: number,
  target: THREE.Matrix4,
): THREE.Matrix4 {
  const ts = grid.tileSize;
  const along = ((index + 0.5) / count - 0.5) * 0.78 + (stoneHash(tx, tz, direction, index, Channel.StoneAlong) - 0.5) * 0.12;
  const inset = 0.1 + 0.08 * stoneHash(tx, tz, direction, index, Channel.StoneInset);
  const size = (0.75 + 0.6 * stoneHash(tx, tz, direction, index, Channel.StoneScale)) * ts;
  const squash = 0.8 + 0.4 * stoneHash(tx, tz, direction, index, Channel.StoneSquash);
  scratchPosition.set(
    tileCenterX(grid, tx) + (dx * (0.5 - inset) - dz * along) * ts,
    HEIGHTS.waterSurface - 0.06 + 0.04 * stoneHash(tx, tz, direction, index, Channel.StoneLift),
    tileCenterZ(grid, tz) + (dz * (0.5 - inset) + dx * along) * ts,
  );
  scratchRotation.setFromAxisAngle(UP, stoneHash(tx, tz, direction, index, Channel.StoneYaw) * TAU);
  scratchScale.set(size, size * squash, size);
  return target.compose(scratchPosition, scratchRotation, scratchScale);
}

function pondStoneColor(tx: number, tz: number, direction: number, index: number, target: THREE.Color): THREE.Color {
  target.lerpColors(ROCK_LIGHT, ROCK_DARK, stoneHash(tx, tz, direction, index, Channel.StoneShade));
  if (stoneHash(tx, tz, direction, index, Channel.StoneMoss) < 0.35) target.lerp(TUFT_GREEN, 0.3);
  return target;
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

interface TerrainMaterials {
  readonly ground: THREE.MeshStandardMaterial;
  readonly furrow: THREE.MeshStandardMaterial;
  readonly tuft: THREE.MeshStandardMaterial;
  readonly flower: THREE.MeshStandardMaterial;
  readonly rock: THREE.MeshStandardMaterial;
  readonly stump: THREE.MeshStandardMaterial;
  readonly water: THREE.MeshStandardMaterial;
}

/**
 * Flat ground material. The slab's TERRAIN_ATTRIBUTE blends the instance colour toward
 * PALETTE.earthSide on the walls and applies the baked wall shading.
 */
function createGroundMaterial(): THREE.MeshStandardMaterial {
  const material = createFlatMaterial(0xffffff, { roughness: 0.95 });
  const earthSide = { value: new THREE.Color(PALETTE.earthSide) };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uEarthSide = earthSide;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        ['#include <common>', `attribute vec2 ${TERRAIN_ATTRIBUTE};`, 'varying vec2 vTerrain;'].join('\n'),
      )
      .replace('#include <begin_vertex>', ['#include <begin_vertex>', `vTerrain = ${TERRAIN_ATTRIBUTE};`].join('\n'));
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', ['#include <common>', 'uniform vec3 uEarthSide;', 'varying vec2 vTerrain;'].join('\n'))
      .replace(
        '#include <color_fragment>',
        ['#include <color_fragment>', 'diffuseColor.rgb = mix( diffuseColor.rgb, uEarthSide, vTerrain.x ) * vTerrain.y;'].join(
          '\n',
        ),
      );
  };
  material.customProgramCacheKey = () => 'meadowlight-terrain-ground-v1';
  return material;
}

/**
 * Swaying flower material: petals (TINT_MASK_ATTRIBUTE = 1) take the instance colour, while stems,
 * leaves and hearts keep their baked vertex colour.
 */
function createFlowerMaterial(): THREE.MeshStandardMaterial {
  const material = createSwayMaterial(0xffffff, { amplitude: 1.2, frequency: 2.2 }, { vertexColors: true });
  const applySway = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    applySway.call(material, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', ['#include <common>', `attribute float ${TINT_MASK_ATTRIBUTE};`].join('\n'))
      .replace(
        '#include <color_vertex>',
        [
          '#include <color_vertex>',
          '#if defined( USE_COLOR ) && defined( USE_INSTANCING_COLOR )',
          `  vColor.rgb = mix( color.rgb, vColor.rgb, ${TINT_MASK_ATTRIBUTE} );`,
          '#endif',
        ].join('\n'),
      );
  };
  // Distinct from the plain sway key: the shader source differs, so the program must not be shared.
  material.customProgramCacheKey = () => 'meadowlight-sway-flower-v1';
  return material;
}

/**
 * Slightly transparent, glossy water. The surface ripples with a sum of sines evaluated in world
 * space, so neighbouring tiles move together and the faceted surface stays seamless.
 */
function createWaterMaterial(): THREE.MeshStandardMaterial {
  const material = createFlatMaterial(0xffffff, {
    transparent: true,
    opacity: POND.opacity,
    roughness: POND.roughness,
    metalness: 0.05,
  });
  const waveHeight = { value: POND.waveHeight };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = sharedUniforms.uTime;
    shader.uniforms.uWaveHeight = waveHeight;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', ['#include <common>', 'uniform float uTime;', 'uniform float uWaveHeight;'].join('\n'))
      .replace(
        '#include <begin_vertex>',
        [
          '#include <begin_vertex>',
          '{',
          '  #ifdef USE_INSTANCING',
          '    vec4 waterWorld = modelMatrix * instanceMatrix * vec4( transformed, 1.0 );',
          '  #else',
          '    vec4 waterWorld = modelMatrix * vec4( transformed, 1.0 );',
          '  #endif',
          '  float wave = sin( waterWorld.x * 1.7 + uTime * 1.3 ) * 0.5',
          '    + sin( waterWorld.z * 2.3 - uTime * 1.1 ) * 0.35',
          '    + sin( ( waterWorld.x + waterWorld.z ) * 3.1 + uTime * 2.0 ) * 0.15;',
          '  transformed.y += wave * uWaveHeight;',
          '}',
        ].join('\n'),
      );
  };
  material.customProgramCacheKey = () => 'meadowlight-terrain-water-v1';
  return material;
}

function createTerrainMaterials(): TerrainMaterials {
  return {
    ground: createGroundMaterial(),
    furrow: createFlatMaterial(0xffffff, { vertexColors: true, roughness: 0.95 }),
    tuft: createSwayMaterial(0xffffff, { amplitude: 0.9, frequency: 1.8 }, { vertexColors: true }),
    flower: createFlowerMaterial(),
    rock: createFlatMaterial(0xffffff, { vertexColors: true, roughness: 0.85 }),
    stump: createFlatMaterial(0xffffff, { vertexColors: true, roughness: 0.9 }),
    water: createWaterMaterial(),
  };
}

function disposeMaterials(materials: TerrainMaterials): void {
  materials.ground.dispose();
  materials.furrow.dispose();
  materials.tuft.dispose();
  materials.flower.dispose();
  materials.rock.dispose();
  materials.stump.dispose();
  materials.water.dispose();
}

// ---------------------------------------------------------------------------
// Geometries
// ---------------------------------------------------------------------------

interface TerrainGeometries {
  readonly slab: THREE.BufferGeometry;
  readonly furrow: THREE.BufferGeometry;
  readonly tuft: THREE.BufferGeometry;
  readonly flower: THREE.BufferGeometry;
  readonly rocks: readonly THREE.BufferGeometry[];
  readonly stump: THREE.BufferGeometry;
  readonly pondStone: THREE.BufferGeometry;
  readonly water: THREE.BufferGeometry;
}

function createTerrainGeometries(): TerrainGeometries {
  const rocks: THREE.BufferGeometry[] = [];
  for (let variant = 0; variant < ROCK_VARIANT_COUNT; variant++) rocks.push(createRockGeometry(variant));
  return {
    slab: createGroundSlabGeometry(),
    furrow: createFurrowGeometry(),
    tuft: createGrassTuftGeometry(),
    flower: createFlowerGeometry(),
    rocks,
    stump: createStumpGeometry(),
    pondStone: createPondStoneGeometry(),
    water: createWaterSurfaceGeometry(),
  };
}

function disposeGeometries(geometries: TerrainGeometries): void {
  geometries.slab.dispose();
  geometries.furrow.dispose();
  geometries.tuft.dispose();
  geometries.flower.dispose();
  for (const rock of geometries.rocks) rock.dispose();
  geometries.stump.dispose();
  geometries.pondStone.dispose();
  geometries.water.dispose();
}

/** An InstancedMesh whose colour buffer exists before the first render (see InstanceSlotMap). */
function createInstancedMesh(
  name: string,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  count: number,
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.name = name;
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3).fill(1), 3);
  return mesh;
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

interface ChunkLayer {
  readonly rect: ChunkRect;
  readonly mesh: THREE.InstancedMesh;
  matrixDirty: boolean;
  colorDirty: boolean;
}

/** Everything sized by the grid; recreated only if a loaded game uses a different grid. */
interface TerrainLayers {
  readonly chunks: readonly ChunkLayer[];
  readonly furrows: InstanceSlotMap;
  readonly tufts: InstanceSlotMap;
  readonly flowers: InstanceSlotMap;
  /** One slot map per rock variant. */
  readonly rocks: readonly InstanceSlotMap[];
  readonly stumps: InstanceSlotMap;
  /** All of the slot maps above, for batch clear / commit. */
  readonly slotMaps: readonly InstanceSlotMap[];
}

interface PondMeshes {
  readonly water: THREE.InstancedMesh;
  readonly stones: THREE.InstancedMesh | null;
}

interface HitAnimation {
  readonly key: number;
  readonly map: InstanceSlotMap;
  /** Rest pose the animation returns to. */
  readonly pose: Pose;
  /** Unit grid step from the player toward the hit tile. */
  readonly dirX: number;
  readonly dirZ: number;
  readonly strength: number;
  /** FrameContext.elapsed of the first animated frame; NaN until then. */
  start: number;
}

function sameGrid(a: GridSpec, b: GridSpec): boolean {
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

export class TerrainRenderer implements RenderSystem {
  private readonly scene: THREE.Scene;
  private readonly root = new THREE.Group();
  private readonly geometries: TerrainGeometries;
  private readonly materials: TerrainMaterials;
  private grid: GridSpec;
  private layers: TerrainLayers;
  private pond: PondMeshes | null = null;
  /** Global indices of every water tile; drives the pond meshes. */
  private readonly waterTiles = new Set<number>();
  private pondDirty = false;
  private readonly hits: HitAnimation[] = [];

  constructor(ctx: SceneContext) {
    this.scene = ctx.scene;
    this.grid = ctx.grid;
    this.geometries = createTerrainGeometries();
    this.materials = createTerrainMaterials();
    this.root.name = 'terrain';
    this.layers = this.createLayers(this.grid);
    this.scene.add(this.root);
  }

  /** Full rebuild when `prev` is null (or the grid changed); otherwise a reference diff. */
  sync(state: GameState, prev: GameState | null): void {
    const world = state.world;
    if (prev === null || !sameGrid(world.grid, this.grid)) {
      this.rebuild(state);
      return;
    }
    if (world.chunks === prev.world.chunks) return;

    const facing = state.player.facing;
    const count = Math.min(world.chunks.length, this.layers.chunks.length);
    for (let ci = 0; ci < count; ci++) {
      const chunk = world.chunks[ci];
      const prevChunk = prev.world.chunks[ci];
      const layer = this.layers.chunks[ci];
      if (chunk === undefined || layer === undefined || chunk === prevChunk) continue;
      const width = layer.rect.width;
      for (let li = 0; li < chunk.tiles.length; li++) {
        const tile = chunk.tiles[li];
        const prevTile = prevChunk?.tiles[li] ?? null;
        if (tile === undefined || tile === prevTile) continue;
        const lz = Math.floor(li / width);
        this.applyTile(layer, li, layer.rect.x0 + (li - lz * width), layer.rect.z0 + lz, tile, prevTile, facing);
      }
    }
    this.flush();
  }

  /** Animates only rocks / stumps that were just hit. */
  update(frame: FrameContext): void {
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const hit = this.hits[i];
      if (hit === undefined) continue;
      if (Number.isNaN(hit.start)) hit.start = frame.elapsed;
      const t = (frame.elapsed - hit.start) / HIT.duration;
      if (t >= 1) {
        hit.map.setMatrix(hit.key, composePose(hit.pose, 0, 0, 0, 0, 0, scratchMatrix));
        hit.map.commit();
        this.removeHitAt(i);
        continue;
      }
      const envelope = (1 - t) * (1 - t) * hit.strength;
      const squash = HIT.squash * envelope * Math.cos(t * Math.PI * 5);
      const wobble = envelope * Math.sin(t * Math.PI * 6);
      const matrix = composePose(
        hit.pose,
        squash,
        HIT.tilt * wobble,
        hit.dirX,
        hit.dirZ,
        HIT.push * wobble * hit.pose.scale,
        scratchMatrix,
      );
      if (hit.map.setMatrix(hit.key, matrix)) {
        // Upload only; bounds are refreshed once the animation settles.
        hit.map.mesh.instanceMatrix.needsUpdate = true;
      } else {
        this.removeHitAt(i);
      }
    }
  }

  dispose(): void {
    this.hits.length = 0;
    this.disposePond();
    this.destroyLayers();
    this.waterTiles.clear();
    this.scene.remove(this.root);
    disposeGeometries(this.geometries);
    disposeMaterials(this.materials);
  }

  // -------------------------------------------------------------------------
  // Construction
  // -------------------------------------------------------------------------

  private createLayers(grid: GridSpec): TerrainLayers {
    const { geometries, materials } = this;
    const chunks: ChunkLayer[] = [];
    for (let index = 0; index < chunkCount(grid); index++) {
      const rect = chunkRectByIndex(grid, index);
      const mesh = createInstancedMesh(
        `terrain-ground-${rect.cx}-${rect.cz}`,
        geometries.slab,
        materials.ground,
        rect.width * rect.depth,
      );
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceColor?.setUsage(THREE.DynamicDrawUsage);
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      this.root.add(mesh);
      chunks.push({ rect, mesh, matrixDirty: false, colorDirty: false });
    }

    const capacity = tileCount(grid);
    const furrows = this.createSlotMap('terrain-furrows', geometries.furrow, materials.furrow, capacity, false);
    const tufts = this.createSlotMap('terrain-tufts', geometries.tuft, materials.tuft, capacity, false);
    const flowers = this.createSlotMap('terrain-flowers', geometries.flower, materials.flower, capacity, false);
    const rocks = geometries.rocks.map((geometry, variant) =>
      this.createSlotMap(`terrain-rocks-${variant}`, geometry, materials.rock, capacity, true),
    );
    const stumps = this.createSlotMap('terrain-stumps', geometries.stump, materials.stump, capacity, true);
    return { chunks, furrows, tufts, flowers, rocks, stumps, slotMaps: [furrows, tufts, flowers, ...rocks, stumps] };
  }

  private createSlotMap(
    name: string,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    capacity: number,
    castShadow: boolean,
  ): InstanceSlotMap {
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.name = name;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    mesh.visible = false;
    this.root.add(mesh);
    return new InstanceSlotMap(mesh);
  }

  private destroyLayers(): void {
    for (const layer of this.layers.chunks) {
      this.root.remove(layer.mesh);
      layer.mesh.dispose();
    }
    for (const map of this.layers.slotMaps) {
      this.root.remove(map.mesh);
      map.mesh.dispose();
    }
  }

  // -------------------------------------------------------------------------
  // Sync
  // -------------------------------------------------------------------------

  private rebuild(state: GameState): void {
    const world = state.world;
    if (!sameGrid(world.grid, this.grid)) {
      this.destroyLayers();
      this.layers = this.createLayers(world.grid);
    }
    this.grid = world.grid;
    for (const map of this.layers.slotMaps) map.clear();
    this.hits.length = 0;
    this.waterTiles.clear();
    this.pondDirty = true;

    for (let ci = 0; ci < this.layers.chunks.length; ci++) {
      const layer = this.layers.chunks[ci];
      if (layer === undefined) continue;
      const chunk = world.chunks[ci];
      const { width, depth, x0, z0 } = layer.rect;
      for (let li = 0; li < width * depth; li++) {
        const tile = chunk?.tiles[li];
        if (tile === undefined) {
          layer.mesh.setMatrixAt(li, HIDDEN_MATRIX);
          layer.matrixDirty = true;
          continue;
        }
        const lz = Math.floor(li / width);
        this.applyTile(layer, li, x0 + (li - lz * width), z0 + lz, tile, null, null);
      }
    }
    this.flush();
  }

  /** Brings every layer in line with one tile. `facing` is null during full rebuilds. */
  private applyTile(
    layer: ChunkLayer,
    localIndex: number,
    tx: number,
    tz: number,
    tile: Tile,
    prevTile: Tile | null,
    facing: Direction | null,
  ): void {
    const key = tileIndex(this.grid, tx, tz);
    this.writeGround(layer, localIndex, tx, tz, tile);
    this.syncFurrow(key, tx, tz, tile);
    this.syncMeadow(key, tx, tz, tile);
    this.syncRock(key, tx, tz, tile, prevTile, facing);
    this.syncStump(key, tx, tz, tile, prevTile, facing);
    this.syncWater(key, tile);
  }

  private writeGround(layer: ChunkLayer, localIndex: number, tx: number, tz: number, tile: Tile): void {
    let top: number;
    if (tile.state === TileState.Plowed || tile.state === TileState.Watered) {
      top = HEIGHTS.soilTop;
      soilColor(tx, tz, tile.state === TileState.Watered, scratchColor);
    } else if (tile.blocker === Blocker.Water) {
      // Provisional shore colour; rebuildPond() repaints the bed by depth.
      top = HEIGHTS.pondBed;
      pondBedColor(tx, tz, 0, scratchColor);
    } else {
      top = HEIGHTS.grassTop;
      applyShade(shadeAmount(this.grid, tx, tz), grassColor(tx, tz, scratchColor));
    }
    const ts = this.grid.tileSize;
    scratchMatrix.makeScale(ts, 1, ts).setPosition(tileCenterX(this.grid, tx), top, tileCenterZ(this.grid, tz));
    layer.mesh.setMatrixAt(localIndex, scratchMatrix);
    layer.mesh.setColorAt(localIndex, scratchColor);
    layer.matrixDirty = true;
    layer.colorDirty = true;
  }

  private syncFurrow(key: number, tx: number, tz: number, tile: Tile): void {
    const furrows = this.layers.furrows;
    if (tile.state !== TileState.Plowed && tile.state !== TileState.Watered) {
      furrows.remove(key);
      return;
    }
    furrows.set(
      key,
      furrowMatrix(this.grid, tx, tz, scratchMatrix),
      furrowColor(tx, tz, tile.state === TileState.Watered, scratchColor),
    );
  }

  /**
   * Tufts and flowers live on a fixed subset of unplowed tiles and return when soil reverts. A
   * crop growing wild on the grass takes the tile over, so they step aside until it is gone.
   */
  private syncMeadow(key: number, tx: number, tz: number, tile: Tile): void {
    const meadow = tile.state === TileState.Unplowed && tile.crop === null;
    const { tufts, flowers } = this.layers;
    if (meadow && hasTuft(tx, tz)) {
      if (!tufts.has(key)) {
        const color = applyShade(shadeAmount(this.grid, tx, tz), tuftColor(tx, tz, scratchColor));
        tufts.set(key, tuftMatrix(this.grid, tx, tz, scratchMatrix), color);
      }
    } else {
      tufts.remove(key);
    }
    if (meadow && hasFlower(tx, tz)) {
      if (!flowers.has(key)) {
        flowers.set(key, flowerMatrix(this.grid, tx, tz, scratchMatrix), flowerColor(tx, tz, scratchColor));
      }
    } else {
      flowers.remove(key);
    }
  }

  private syncRock(key: number, tx: number, tz: number, tile: Tile, prevTile: Tile | null, facing: Direction | null): void {
    const map = this.rockMap(tx, tz);
    if (tile.blocker !== Blocker.Rock) {
      if (map.remove(key)) this.cancelHit(key, map);
      return;
    }
    const pose = rockPose(this.grid, tx, tz, tile.blockerHp, scratchPose);
    map.set(key, composePose(pose, 0, 0, 0, 0, 0, scratchMatrix), rockColor(tx, tz, scratchColor));
    if (facing !== null && prevTile !== null && prevTile.blocker === Blocker.Rock && tile.blockerHp < prevTile.blockerHp) {
      this.startHit(key, map, pose, facing, HIT.rockStrength);
    }
  }

  private syncStump(key: number, tx: number, tz: number, tile: Tile, prevTile: Tile | null, facing: Direction | null): void {
    const map = this.layers.stumps;
    if (tile.blocker !== Blocker.Stump) {
      if (map.remove(key)) this.cancelHit(key, map);
      return;
    }
    const pose = stumpPose(this.grid, tx, tz, scratchPose);
    map.set(key, composePose(pose, 0, 0, 0, 0, 0, scratchMatrix), stumpColor(tx, tz, scratchColor));
    if (facing !== null && prevTile !== null && prevTile.blocker === Blocker.Stump && tile.blockerHp < prevTile.blockerHp) {
      this.startHit(key, map, pose, facing, HIT.stumpStrength);
    }
  }

  private syncWater(key: number, tile: Tile): void {
    if (tile.blocker === Blocker.Water) {
      this.waterTiles.add(key);
      // Any change to a water tile rewrote its bed colour, so the pond must repaint it.
      this.pondDirty = true;
    } else if (this.waterTiles.delete(key)) {
      this.pondDirty = true;
    }
  }

  private rockMap(tx: number, tz: number): InstanceSlotMap {
    const map = this.layers.rocks[rockVariant(tx, tz)];
    if (map === undefined) throw new RangeError('TerrainRenderer: rock variant out of range');
    return map;
  }

  /** Uploads every pending edit: pond, dirty chunks, slot maps. */
  private flush(): void {
    if (this.pondDirty) {
      this.pondDirty = false;
      this.rebuildPond();
    }
    for (const layer of this.layers.chunks) {
      if (layer.matrixDirty) {
        layer.mesh.instanceMatrix.needsUpdate = true;
        layer.mesh.computeBoundingSphere();
        layer.matrixDirty = false;
      }
      if (layer.colorDirty && layer.mesh.instanceColor !== null) {
        layer.mesh.instanceColor.needsUpdate = true;
        layer.colorDirty = false;
      }
    }
    for (const map of this.layers.slotMaps) {
      map.commit();
      map.mesh.visible = map.size > 0;
    }
  }

  // -------------------------------------------------------------------------
  // Hit animations
  // -------------------------------------------------------------------------

  private startHit(key: number, map: InstanceSlotMap, pose: Pose, facing: Direction, strength: number): void {
    this.cancelHit(key, map);
    const step = directionStep(facing);
    this.hits.push({ key, map, pose: { ...pose }, dirX: step.dx, dirZ: step.dz, strength, start: Number.NaN });
  }

  private cancelHit(key: number, map: InstanceSlotMap): void {
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const hit = this.hits[i];
      if (hit !== undefined && hit.key === key && hit.map === map) this.removeHitAt(i);
    }
  }

  /** Swap-remove; safe while iterating the list backwards. */
  private removeHitAt(index: number): void {
    const last = this.hits.pop();
    if (last !== undefined && index < this.hits.length) this.hits[index] = last;
  }

  // -------------------------------------------------------------------------
  // Pond
  // -------------------------------------------------------------------------

  private isWater(tx: number, tz: number): boolean {
    return inBounds(this.grid, tx, tz) && this.waterTiles.has(tileIndex(this.grid, tx, tz));
  }

  /** Chebyshev distance to the nearest non-water tile minus one, capped at POND.depthRings. */
  private shoreDistance(tx: number, tz: number): number {
    for (let ring = 1; ring <= POND.depthRings; ring++) {
      for (let dz = -ring; dz <= ring; dz++) {
        for (let dx = -ring; dx <= ring; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
          if (!this.isWater(tx + dx, tz + dz)) return ring - 1;
        }
      }
    }
    return POND.depthRings;
  }

  private paintPondBed(tx: number, tz: number, depth: number): void {
    const loc = locateTile(this.grid, tx, tz);
    const layer = this.layers.chunks[loc.chunkIndex];
    if (layer === undefined) return;
    layer.mesh.setColorAt(loc.localIndex, pondBedColor(tx, tz, depth, scratchColor));
    layer.colorDirty = true;
  }

  /** Recreates the water surface and rim stones (exactly sized) from the water tile set. */
  private rebuildPond(): void {
    this.disposePond();
    if (this.waterTiles.size === 0) return;
    const grid = this.grid;
    const ts = grid.tileSize;
    const keys = Array.from(this.waterTiles).sort((a, b) => a - b);

    let stoneCount = 0;
    for (const key of keys) {
      const { tx, tz } = tileFromIndex(grid, key);
      for (const [direction, step] of DIRECTION_STEPS.entries()) {
        if (!this.isWater(tx + step.dx, tz + step.dz)) stoneCount += stonesOnEdge(tx, tz, direction);
      }
    }

    const water = createInstancedMesh('terrain-pond-water', this.geometries.water, this.materials.water, keys.length);
    water.receiveShadow = true;
    water.castShadow = false;
    const stones =
      stoneCount > 0
        ? createInstancedMesh('terrain-pond-stones', this.geometries.pondStone, this.materials.rock, stoneCount)
        : null;
    if (stones !== null) {
      stones.castShadow = true;
      stones.receiveShadow = true;
    }

    let stoneSlot = 0;
    keys.forEach((key, slot) => {
      const { tx, tz } = tileFromIndex(grid, key);
      const depth = this.shoreDistance(tx, tz) / POND.depthRings;
      scratchMatrix.makeScale(ts, 1, ts).setPosition(tileCenterX(grid, tx), HEIGHTS.waterSurface, tileCenterZ(grid, tz));
      water.setMatrixAt(slot, scratchMatrix);
      water.setColorAt(slot, scratchColor.lerpColors(WATER_SHALLOW, WATER_DEEP, depth));
      this.paintPondBed(tx, tz, depth);
      if (stones === null) return;
      for (const [direction, step] of DIRECTION_STEPS.entries()) {
        if (this.isWater(tx + step.dx, tz + step.dz)) continue;
        const count = stonesOnEdge(tx, tz, direction);
        for (let index = 0; index < count; index++) {
          stones.setMatrixAt(stoneSlot, pondStoneMatrix(grid, tx, tz, direction, step.dx, step.dz, index, count, scratchMatrix));
          stones.setColorAt(stoneSlot, pondStoneColor(tx, tz, direction, index, scratchColor));
          stoneSlot++;
        }
      }
    });

    water.computeBoundingSphere();
    this.root.add(water);
    if (stones !== null) {
      stones.computeBoundingSphere();
      this.root.add(stones);
    }
    this.pond = { water, stones };
  }

  private disposePond(): void {
    if (this.pond === null) return;
    this.root.remove(this.pond.water);
    this.pond.water.dispose();
    if (this.pond.stones !== null) {
      this.root.remove(this.pond.stones);
      this.pond.stones.dispose();
    }
    this.pond = null;
  }
}
