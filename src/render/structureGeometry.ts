/**
 * Pure geometry builders and deterministic scenery layout: the farmhouse, the shipping bin, and
 * the meadow, border trees, fence, bushes and flower clumps around a map's plateau. Nothing here
 * touches the scene or game state; StructureRenderer owns the results.
 *
 * Geometry conventions
 * - Parts come from geometryParts.ts: fresh, non-indexed BufferGeometry with `position` and
 *   `normal` attributes and no UVs or groups, so they merge cleanly and render flat-shaded. The
 *   caller owns (and must dispose) what it receives.
 * - "Painted" builders bake linear-space colours into a `color` attribute: render them with a
 *   white material and `vertexColors: true`. Instance-tinted builders (canopies, bushes) bake a
 *   grey shade instead, which multiplies the per-instance colour to give tiers some depth.
 * - Swaying geometry (canopies, bushes, flowers) has its base at local y = 0, because the sway
 *   shader displaces vertices by the square of their local height.
 * - Structures are authored facing +Z (the side the camera sees), origin on the ground at the
 *   centre of their footprint.
 *
 * Layout conventions
 * - Placement is a pure function of the plateau rectangle, the map's scenery profile and
 *   cosmetic hashes (Salt.Cosmetic) keyed by integer cell coordinates plus the map's
 *   `cosmeticOffset`, so the scenery is identical on every rebuild (and the farm, with offset 0,
 *   looks exactly as before maps existed).
 * - Occlusion: the camera looks from the (+X, +Z) diagonal at a pitch of atan(1/√2), so a point
 *   at height h covers the ground exactly h units further along both −X and −Z. Scenery that
 *   could hide grid tiles (the +X / +Z sides) is sized with {@link wouldOccludeFarm}.
 * - Warps: every warp opening gets a clear corridor (no trees, bushes or flowers) and a gap in
 *   the fence or wall; see sceneryGeometry.ts.
 */
import * as THREE from 'three';
import { Salt, hashFloat } from '../core/hash';
import type { GridSpec, TileCoord, TileRect } from '../core/types';
import { tileCenterX, tileMinX, tileMinZ, type WorldRect } from '../world/grid';
import { HEIGHTS } from './constants';
import {
  STRUCTURE_COLORS,
  at,
  box,
  createPartSet,
  doorParts,
  gableRoofFrame,
  gableRoofParts,
  gableWallPart,
  mergeParts,
  normalizePart,
  paint,
  pick,
  pose,
  shade,
  wallLanternParts,
  windowParts,
  withTintMask,
  type DoorColors,
  type GableRoofSpec,
  type PartSet,
  type RoofColors,
  type Vec2,
  type WindowOptions,
  type WindowStyle,
} from './geometryParts';
import { PALETTE } from './palette';

export { STRUCTURE_COLORS, mergeParts } from './geometryParts';

/** Deeper greens for bushes, so they read against the meadow. */
export const BUSH_TINTS = [0x74b86a, 0x6aae66, 0x82c275, 0x5fa866] as const;

/** Leaf tints for flower clumps. */
export const FLOWER_LEAF_TINTS = [0x7cc46e, PALETTE.grassTuft, 0x6fbb68] as const;

/** Per-feature salts, combined with Salt.Cosmetic so features sharing coordinates stay uncorrelated. */
const FEATURE = {
  meadowJitter: 11,
  meadowDiagonal: 12,
  meadowTone: 13,
  hills: 21,
  hillDetail: 22,
  tree: 31,
  bush: 41,
  flower: 51,
  fence: 61,
} as const;

// ---------------------------------------------------------------------------
// Small math helpers
// ---------------------------------------------------------------------------

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Hermite smoothstep; 0 below edge0, 1 above edge1. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Integer offset added to the cell coordinates of every scenery hash (a map's `cosmeticOffset`). */
export interface CosmeticOffset {
  readonly x: number;
  readonly z: number;
}

export const NO_OFFSET: CosmeticOffset = { x: 0, z: 0 };

/** Uniform [0, 1) cosmetic hash for one feature at integer coordinates (a, b) shifted by `offset`, channel k. */
function cosmetic(offset: CosmeticOffset, feature: number, a: number, b: number, k: number): number {
  return hashFloat(Salt.Cosmetic, feature, a + offset.x, b + offset.z, k);
}

// ---------------------------------------------------------------------------
// Farmhouse
// ---------------------------------------------------------------------------

export interface FarmhouseSpec {
  /** Wall footprint along X (world units). */
  readonly width: number;
  /** Wall footprint along Z. The front (+Z) wall sits at z = depth / 2. */
  readonly depth: number;
  /** X of the door centre relative to the footprint centre (clamped to fit between the corners). */
  readonly doorOffsetX: number;
  /** Depth of the porch step in front of the +Z wall. */
  readonly stepDepth: number;
  /** Roof colour (sRGB hex); the shingle rows and the ridge are shades of it. Absent: the farm's roof. */
  readonly roofColor?: number;
}

export interface FarmhouseGeometry {
  /** Painted, opaque shell: walls, trim, roof, chimney, door, window frames, porch. */
  readonly body: THREE.BufferGeometry;
  /** Unpainted window panes and lantern glass, rendered with the glow material. */
  readonly glass: THREE.BufferGeometry;
  /** House-local position of the chimney mouth (origin of the smoke puffs). */
  readonly chimneyTop: THREE.Vector3;
  /** Highest point of the model above its base. */
  readonly height: number;
}

/** Proportions of the cottage (world units, radians). */
export const FARMHOUSE_SHAPE = {
  foundationHeight: 0.17,
  foundationLip: 0.07,
  wallHeight: 1.9,
  roofPitch: 0.65,
  roofThickness: 0.14,
  /**
   * Roof overhangs. Keep eaveOverhang ≤ FARMHOUSE_INSET.back and gableOverhang + 0.06 (barge
   * boards) ≤ FARMHOUSE_INSET.side, so the roof never reaches over neighbouring tiles.
   */
  eaveOverhang: 0.28,
  gableOverhang: 0.22,
  cornerPost: 0.18,
  frameWidth: 0.08,
  doorWidth: 0.78,
  doorHeight: 1.36,
  windowWidth: 0.72,
  windowHeight: 0.66,
  /** Window centre above the foundation top. */
  windowCenterHeight: 1.08,
  shutterWidth: 0.19,
  /** Free wall between the door frame and a front window; the lantern hangs there. */
  lanternGap: 0.3,
  chimneyWidth: 0.46,
  chimneyAboveRidge: 0.62,
} as const;

/** Derived measurements shared by the farmhouse part builders. */
interface HouseFrame {
  readonly halfW: number;
  readonly halfD: number;
  readonly foundationTop: number;
  readonly wallTop: number;
  readonly roof: GableRoofSpec;
  readonly slope: number;
  readonly rise: number;
  readonly ridgeTop: number;
  readonly doorX: number;
  readonly stepDepth: number;
}

const HOUSE_ROOF_COLORS: RoofColors = {
  roof: PALETTE.houseRoof,
  shingle: STRUCTURE_COLORS.roofShade,
  ridge: STRUCTURE_COLORS.roofRidge,
  barge: PALETTE.houseTrim,
};

const HOUSE_WINDOW_STYLE: WindowStyle = {
  frameWidth: FARMHOUSE_SHAPE.frameWidth,
  shutterWidth: FARMHOUSE_SHAPE.shutterWidth,
  trim: PALETTE.houseTrim,
  shutter: STRUCTURE_COLORS.shutter,
  shutterDark: STRUCTURE_COLORS.shutterDark,
};

const HOUSE_DOOR_COLORS: DoorColors = {
  trim: PALETTE.houseTrim,
  door: PALETTE.door,
  doorDark: STRUCTURE_COLORS.doorDark,
  awning: PALETTE.houseRoof,
};

/** A recoloured roof's shingle rows and ridge cap, as fractions of its colour (linear RGB), close to the farm's own shades. */
const ROOF_TONES = { shingle: 0.78, ridge: 0.6 } as const;

/** The farm's roof colours, or the same roof in `spec.roofColor`. */
function houseRoofColors(spec: FarmhouseSpec): RoofColors {
  if (spec.roofColor === undefined) return HOUSE_ROOF_COLORS;
  return {
    roof: spec.roofColor,
    shingle: new THREE.Color(spec.roofColor).multiplyScalar(ROOF_TONES.shingle),
    ridge: new THREE.Color(spec.roofColor).multiplyScalar(ROOF_TONES.ridge),
    barge: HOUSE_ROOF_COLORS.barge,
  };
}

/** The farm's door colours, with the awning in `spec.roofColor` when there is one. */
function houseDoorColors(spec: FarmhouseSpec): DoorColors {
  return spec.roofColor === undefined ? HOUSE_DOOR_COLORS : { ...HOUSE_DOOR_COLORS, awning: spec.roofColor };
}

function houseFrame(spec: FarmhouseSpec): HouseFrame {
  const S = FARMHOUSE_SHAPE;
  const halfW = spec.width / 2;
  const halfD = spec.depth / 2;
  const foundationTop = S.foundationHeight;
  const wallTop = foundationTop + S.wallHeight;
  const roof: GableRoofSpec = {
    halfW,
    halfD,
    wallTop,
    pitch: S.roofPitch,
    thickness: S.roofThickness,
    eaveOverhang: S.eaveOverhang,
    gableOverhang: S.gableOverhang,
  };
  const { slope, rise, ridgeTop } = gableRoofFrame(roof);
  const doorLimit = Math.max(0, halfW - S.cornerPost - S.doorWidth / 2 - 0.12);
  return {
    halfW,
    halfD,
    foundationTop,
    wallTop,
    roof,
    slope,
    rise,
    ridgeTop,
    doorX: THREE.MathUtils.clamp(spec.doorOffsetX, -doorLimit, doorLimit),
    stepDepth: Math.max(0.2, spec.stepDepth),
  };
}

/** Foundation, walls, gables, corner posts and trim beams. */
function shellParts(f: HouseFrame, out: PartSet): void {
  const S = FARMHOUSE_SHAPE;
  const width = f.halfW * 2;
  const depth = f.halfD * 2;
  const trim = PALETTE.houseTrim;

  out.body.push(
    box(
      width + 2 * S.foundationLip,
      f.foundationTop + 0.05,
      depth + 2 * S.foundationLip,
      { y: (f.foundationTop - 0.05) / 2 },
      STRUCTURE_COLORS.stone,
    ),
  );
  out.body.push(box(width, S.wallHeight, depth, { y: f.foundationTop + S.wallHeight / 2 }, PALETTE.houseWall));
  // Wooden sill band around the base of the walls.
  out.body.push(box(width + 0.02, 0.08, depth + 0.02, { y: f.foundationTop + 0.04 }, trim));
  out.body.push(gableWallPart(f.roof, PALETTE.houseWall));

  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      out.body.push(
        box(S.cornerPost, S.wallHeight, S.cornerPost, { x: sx * f.halfW, y: f.foundationTop + S.wallHeight / 2, z: sz * f.halfD }, trim),
      );
    }
  }

  const beamY = f.wallTop - 0.07;
  for (const sz of [-1, 1]) {
    out.body.push(box(width + 0.04, 0.14, 0.07, { y: beamY, z: sz * (f.halfD + 0.035) }, trim));
  }
  for (const sx of [-1, 1]) {
    out.body.push(box(0.07, 0.14, depth, { x: sx * (f.halfW + 0.035), y: beamY }, trim));
  }
}

/** Brick chimney through the back slope. Returns the house-local chimney mouth. */
function chimneyParts(f: HouseFrame, out: PartSet): THREE.Vector3 {
  const S = FARMHOUSE_SHAPE;
  const cx = -f.halfW + Math.min(0.85, f.halfW * 0.45);
  const cz = -f.halfD * 0.45;
  const bottom = f.wallTop + f.rise - Math.abs(cz) * f.slope - 0.05;
  const top = f.ridgeTop + S.chimneyAboveRidge;
  const w = S.chimneyWidth;
  out.body.push(box(w, top - bottom, w, { x: cx, y: (top + bottom) / 2, z: cz }, STRUCTURE_COLORS.brick));
  out.body.push(box(w + 0.04, 0.06, w + 0.04, { x: cx, y: top - 0.24, z: cz }, STRUCTURE_COLORS.brickDark));
  out.body.push(box(w + 0.12, 0.1, w + 0.12, { x: cx, y: top + 0.05, z: cz }, STRUCTURE_COLORS.brickDark));
  return new THREE.Vector3(cx, top + 0.1, cz);
}

/**
 * Cosy gabled cottage in house-local space: origin on the ground at the centre of the wall
 * footprint, front door on the +Z face. The ridge runs along X, so the camera sees the front
 * slope and the +X gable (with an attic window). The porch step reaches `stepDepth` past the
 * front wall; everything else stays within the wall footprint plus the roof overhang. With
 * `spec.roofColor` the roof and the door's awning take that colour; nothing else changes.
 */
export function createFarmhouseGeometry(spec: FarmhouseSpec): FarmhouseGeometry {
  const S = FARMHOUSE_SHAPE;
  const f = houseFrame(spec);
  const parts = createPartSet();

  shellParts(f, parts);
  gableRoofParts(f.roof, houseRoofColors(spec), parts);
  const chimneyTop = chimneyParts(f, parts);
  doorParts(
    { x: f.doorX, front: f.halfD, base: f.foundationTop, width: S.doorWidth, height: S.doorHeight, stepDepth: f.stepDepth },
    houseDoorColors(spec),
    parts,
  );

  // Front windows either side of the door, keeping a gap for the lantern.
  const frameHalf = S.doorWidth / 2 + 0.1;
  const postInner = f.halfW - S.cornerPost / 2;
  const windowHalf = S.windowWidth / 2 + S.frameWidth + S.shutterWidth + 0.01;
  const windowY = f.foundationTop + S.windowCenterHeight;
  const frontWindow: WindowOptions = { width: S.windowWidth, height: S.windowHeight, shutters: true, planter: true };
  const spans: readonly Vec2[] = [
    [-postInner, f.doorX - frameHalf - S.lanternGap],
    [f.doorX + frameHalf + S.lanternGap, postInner],
  ];
  const placement = new THREE.Matrix4();
  for (const [start, end] of spans) {
    if (end - start < windowHalf * 2) continue;
    windowParts(frontWindow, HOUSE_WINDOW_STYLE, placement.makeTranslation((start + end) / 2, windowY, f.halfD), parts);
  }

  const lanternX = f.doorX + frameHalf + S.lanternGap / 2;
  if (lanternX + 0.08 < postInner) wallLanternParts(lanternX, f.foundationTop + 1.34, f.halfD, parts);

  // +X side: a shuttered window on the wall and a small attic window in the gable.
  const faceEast = new THREE.Matrix4().makeRotationY(Math.PI / 2);
  if (f.halfD * 2 >= windowHalf * 2 + S.cornerPost) {
    placement.copy(faceEast).setPosition(f.halfW, windowY, 0);
    windowParts({ width: S.windowWidth, height: S.windowHeight, shutters: true, planter: false }, HOUSE_WINDOW_STYLE, placement, parts);
  }
  placement.copy(faceEast).setPosition(f.halfW, f.wallTop + f.rise * 0.36, 0);
  windowParts({ width: 0.4, height: 0.4, shutters: false, planter: false }, HOUSE_WINDOW_STYLE, placement, parts);

  return {
    body: mergeParts(parts.body, 'farmhouse body'),
    glass: mergeParts(parts.glass, 'farmhouse glass'),
    chimneyTop,
    height: chimneyTop.y,
  };
}

/** How far a farmhouse's walls sit inside its rect. The front inset holds the porch step and the awning. */
export const FARMHOUSE_INSET = { side: 0.3, back: 0.3, front: 0.6 } as const;

/** Porch step depth; it stays inside the house rect so it never overlaps walkable tiles. */
export const FARMHOUSE_STEP_DEPTH = 0.52;

/**
 * Wall footprint inside a house rect, with the door centred on the door tile's column (on the
 * footprint's centre without a door), and the world position of the model's origin. The farm's
 * farmhouse and the neighbours' houses share it, so they are built at the same scale.
 */
export function farmhousePlacement(
  grid: GridSpec,
  rect: TileRect,
  door: TileCoord | null,
): { readonly spec: FarmhouseSpec; readonly origin: THREE.Vector3 } {
  const minX = tileMinX(grid, rect.x0) + FARMHOUSE_INSET.side;
  const maxX = tileMinX(grid, rect.x0 + rect.width) - FARMHOUSE_INSET.side;
  const minZ = tileMinZ(grid, rect.z0) + FARMHOUSE_INSET.back;
  const maxZ = tileMinZ(grid, rect.z0 + rect.depth) - FARMHOUSE_INSET.front;
  const centerX = (minX + maxX) / 2;
  return {
    spec: {
      width: maxX - minX,
      depth: maxZ - minZ,
      doorOffsetX: door === null ? 0 : tileCenterX(grid, door.tx) - centerX,
      stepDepth: FARMHOUSE_STEP_DEPTH,
    },
    origin: new THREE.Vector3(centerX, HEIGHTS.grassTop, (minZ + maxZ) / 2),
  };
}

// ---------------------------------------------------------------------------
// Shipping bin
// ---------------------------------------------------------------------------

export interface ShippingBinSpec {
  /** Crate footprint along X (world units). */
  readonly width: number;
  /** Crate footprint along Z. */
  readonly depth: number;
}

export interface ShippingBinGeometry {
  /** Painted crate without its lid, origin on the ground at the footprint centre. */
  readonly body: THREE.BufferGeometry;
  /** Painted lid authored with its hinge on the local X axis, extending toward +Z. */
  readonly lid: THREE.BufferGeometry;
  /** Bin-local position of the hinge axis: place the lid's pivot here and rotate about X. */
  readonly hinge: THREE.Vector3;
  /** Height of the closed lid's top face. */
  readonly height: number;
}

export const SHIPPING_BIN_SHAPE = {
  height: 0.7,
  lidThickness: 0.1,
  lidOverhang: 0.06,
  post: 0.09,
} as const;

/** Wooden crate with corner posts, plank lines, a gold coin emblem and back hinges. */
export function createShippingBinGeometry(spec: ShippingBinSpec): ShippingBinGeometry {
  const S = SHIPPING_BIN_SHAPE;
  const w = spec.width;
  const d = spec.depth;
  const h = S.height;
  const body: THREE.BufferGeometry[] = [];

  body.push(box(w, h, d, { y: h / 2 }, PALETTE.binWood));
  body.push(box(w + 0.06, 0.08, d + 0.06, { y: 0.04 }, PALETTE.binLid));
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      body.push(box(S.post, h + 0.02, S.post, { x: (sx * w) / 2, y: (h + 0.02) / 2, z: (sz * d) / 2 }, PALETTE.binLid));
    }
  }
  for (const fraction of [0.36, 0.68]) {
    const y = h * fraction;
    for (const sz of [-1, 1]) body.push(box(w, 0.025, 0.02, { y, z: sz * (d / 2 + 0.005) }, STRUCTURE_COLORS.binPlank));
    for (const sx of [-1, 1]) body.push(box(0.02, 0.025, d, { x: sx * (w / 2 + 0.005), y }, STRUCTURE_COLORS.binPlank));
  }
  const emblemY = h * 0.52;
  body.push(paint(pose(new THREE.CylinderGeometry(0.13, 0.13, 0.03, 10), { y: emblemY, z: d / 2 + 0.015, rx: Math.PI / 2 }), STRUCTURE_COLORS.coin));
  body.push(paint(pose(new THREE.CylinderGeometry(0.08, 0.08, 0.04, 10), { y: emblemY, z: d / 2 + 0.02, rx: Math.PI / 2 }), STRUCTURE_COLORS.coinFace));
  for (const sx of [-1, 1]) {
    body.push(box(0.14, 0.08, 0.04, { x: (sx * w) / 3, y: h - 0.03, z: -d / 2 - 0.02 }, STRUCTURE_COLORS.iron));
  }

  const lidWidth = w + 2 * S.lidOverhang;
  const lidDepth = d + 2 * S.lidOverhang;
  const t = S.lidThickness;
  const lid: THREE.BufferGeometry[] = [];
  lid.push(box(lidWidth, t, lidDepth, { y: t / 2, z: lidDepth / 2 }, PALETTE.binLid));
  for (const sx of [-1, 1]) {
    lid.push(box(0.12, 0.03, lidDepth - 0.1, { x: sx * lidWidth * 0.3, y: t + 0.015, z: lidDepth / 2 }, PALETTE.binWood));
  }
  lid.push(box(0.3, 0.05, 0.05, { y: t / 2, z: lidDepth + 0.025 }, STRUCTURE_COLORS.iron));

  return {
    body: mergeParts(body, 'shipping bin body'),
    lid: mergeParts(lid, 'shipping bin lid'),
    hinge: new THREE.Vector3(0, h, -d / 2 - S.lidOverhang),
    height: h + t,
  };
}

/** Gold coin facing ±Z with a raised centre, for the pending-shipment marker. */
export function createCoinMarkerGeometry(): THREE.BufferGeometry {
  return mergeParts(
    [
      paint(pose(new THREE.CylinderGeometry(0.22, 0.22, 0.07, 12), { rx: Math.PI / 2 }), STRUCTURE_COLORS.coin),
      paint(pose(new THREE.CylinderGeometry(0.14, 0.14, 0.095, 12), { rx: Math.PI / 2 }), STRUCTURE_COLORS.coinFace),
    ],
    'coin marker',
  );
}

/** Unit low-poly puff (radius 1) for chimney smoke. */
export function createSmokePuffGeometry(): THREE.BufferGeometry {
  return normalizePart(new THREE.IcosahedronGeometry(1, 0));
}

// ---------------------------------------------------------------------------
// Plateau metrics & occlusion
// ---------------------------------------------------------------------------

/** Euclidean distance from (x, z) to the rectangle; 0 inside it. */
export function distanceOutside(rect: WorldRect, x: number, z: number): number {
  const dx = Math.max(rect.minX - x, 0, x - rect.maxX);
  const dz = Math.max(rect.minZ - z, 0, z - rect.maxZ);
  return Math.hypot(dx, dz);
}

/**
 * How far the camera's line of sight travels behind (x, z) — in steps of −1 on both X and Z —
 * before it reaches the farm rectangle. Anything at (x, z) taller than this hides farm ground.
 * Infinity when the line never crosses the farm (points on the −X / −Z sides and the far
 * corners), 0 inside the farm.
 */
export function occlusionClearance(rect: WorldRect, x: number, z: number): number {
  const enter = Math.max(x - rect.maxX, z - rect.maxZ, 0);
  const leave = Math.min(x - rect.minX, z - rect.minZ);
  return enter <= leave ? enter : Number.POSITIVE_INFINITY;
}

/**
 * True when an object with footprint radius `radius` and height `height` standing at (x, z)
 * would visually cover part of the farm. Samples the footprint centre and eight rim points.
 */
export function wouldOccludeFarm(rect: WorldRect, x: number, z: number, radius: number, height: number): boolean {
  if (occlusionClearance(rect, x, z) <= height) return true;
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    if (occlusionClearance(rect, x + Math.cos(angle) * radius, z + Math.sin(angle) * radius) <= height) return true;
  }
  return false;
}

/**
 * {@link wouldOccludeFarm} for an axis-aligned box: footprint centred on (x, z) with half extents
 * (halfX, halfZ), `height` tall. The footprint is sampled at least every 0.1 units, edges
 * included, so a long thin block (a wall course) is judged by its own outline rather than by a
 * circle around it.
 */
export function wouldBoxOccludeFarm(rect: WorldRect, x: number, z: number, halfX: number, halfZ: number, height: number): boolean {
  const nx = Math.max(1, Math.ceil((2 * halfX) / 0.1));
  const nz = Math.max(1, Math.ceil((2 * halfZ) / 0.1));
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= nz; j++) {
      if (occlusionClearance(rect, x - halfX + (2 * halfX * i) / nx, z - halfZ + (2 * halfZ * j) / nz) <= height) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Meadow
// ---------------------------------------------------------------------------

export interface MeadowSpec {
  /** The farm plateau (grid rectangle in world space). */
  readonly bounds: WorldRect;
  /** How far the meadow extends past the plateau on every side. */
  readonly margin: number;
  /** Approximate edge length of one meadow quad. */
  readonly cellSize: number;
  /** Height of the flat meadow ring around the plateau. */
  readonly topY: number;
  /** The meadow reaches this far under the plateau edge, so no seam can open at the rim. */
  readonly holeInset: number;
  /** The map's cosmetic offset, added to every scenery hash. */
  readonly offset: CosmeticOffset;
  /** Ground colours of the meadow ring. */
  readonly tones: MeadowTones;
}

/** Meadow ground colours (sRGB hex): near the plateau, far away, on hill tops and sunny patches. */
export interface MeadowTones {
  readonly near: number;
  readonly far: number;
  readonly hill: number;
  readonly sun: number;
}

/** The farm's meadow; other maps pick their own tones (sceneryGeometry.ts). */
export const FARM_MEADOW_TONES: MeadowTones = {
  near: STRUCTURE_COLORS.meadowNear,
  far: STRUCTURE_COLORS.meadowFar,
  hill: STRUCTURE_COLORS.meadowHill,
  sun: STRUCTURE_COLORS.meadowSun,
};

/** Rolling hills beyond the flat ring: tall behind the farm (−X / −Z), gentle in front. */
export const MEADOW_RELIEF = {
  flatDistance: 14,
  rampDistance: 26,
  backHillHeight: 4.4,
  frontHillHeight: 0.7,
  noiseScale: 12,
  detailScale: 5,
} as const;

function valueNoise(offset: CosmeticOffset, x: number, z: number, feature: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = cosmetic(offset, feature, ix, iz, 0);
  const b = cosmetic(offset, feature, ix + 1, iz, 0);
  const c = cosmetic(offset, feature, ix, iz + 1, 0);
  const d = cosmetic(offset, feature, ix + 1, iz + 1, 0);
  return lerp(lerp(a, b, sx), lerp(c, d, sx), sz);
}

/**
 * Ground height of the meadow at (x, z): flat (spec.topY) within MEADOW_RELIEF.flatDistance of
 * the plateau, then easing into value-noise hills. Scenery placement uses the same function, so
 * props always sit on the ground.
 */
export function meadowHeight(spec: MeadowSpec, x: number, z: number): number {
  const R = MEADOW_RELIEF;
  const d = distanceOutside(spec.bounds, x, z);
  if (d <= R.flatDistance) return spec.topY;
  const ramp = smoothstep(R.flatDistance, R.flatDistance + R.rampDistance, d);
  const cx = (spec.bounds.minX + spec.bounds.maxX) / 2;
  const cz = (spec.bounds.minZ + spec.bounds.maxZ) / 2;
  const dx = x - cx;
  const dz = z - cz;
  const length = Math.hypot(dx, dz);
  const facing = length > 0 ? -(dx + dz) / (length * Math.SQRT2) : 0;
  const amplitude = lerp(R.frontHillHeight, R.backHillHeight, smoothstep(-0.35, 0.55, facing));
  const noise =
    0.75 * valueNoise(spec.offset, x / R.noiseScale, z / R.noiseScale, FEATURE.hills) +
    0.25 * valueNoise(spec.offset, x / R.detailScale + 17, z / R.detailScale - 5, FEATURE.hillDetail);
  return spec.topY + ramp * amplitude * noise;
}

interface MeadowPalette {
  readonly near: THREE.Color;
  readonly far: THREE.Color;
  readonly hill: THREE.Color;
  readonly sun: THREE.Color;
}

/** Face colour: lush near the plateau, softer and hazier far away, lighter on hill tops, patchy. */
function meadowFaceColor(
  spec: MeadowSpec,
  palette: MeadowPalette,
  x: number,
  y: number,
  z: number,
  a: number,
  c: number,
  tri: number,
  target: THREE.Color,
): THREE.Color {
  const d = distanceOutside(spec.bounds, x, z);
  target.copy(palette.near).lerp(palette.far, smoothstep(22, 78, d));
  target.lerp(palette.hill, 0.55 * clamp01((y - spec.topY) / MEADOW_RELIEF.backHillHeight));
  if (cosmetic(spec.offset, FEATURE.meadowTone, a * 2 + tri, c, 0) < 0.12) target.lerp(palette.sun, 0.45);
  let brightness = 0.96 + 0.07 * cosmetic(spec.offset, FEATURE.meadowTone, a * 2 + tri, c, 1);
  if (d < 1.2) brightness *= 0.94;
  return target.multiplyScalar(brightness);
}

/** Grid lines along one axis: `margin` outside the hole on both sides, ≈ cellSize apart. */
function axisLines(min: number, max: number, margin: number, cellSize: number): number[] {
  const lines: number[] = [];
  const outer = Math.max(1, Math.ceil(margin / cellSize));
  const outerStep = margin / outer;
  for (let i = outer; i > 0; i--) lines.push(min - i * outerStep);
  const inner = Math.max(1, Math.round((max - min) / cellSize));
  const innerStep = (max - min) / inner;
  for (let i = 0; i <= inner; i++) lines.push(i === inner ? max : min + i * innerStep);
  for (let i = 1; i <= outer; i++) lines.push(max + i * outerStep);
  return lines;
}

/**
 * Painted low-poly meadow ring around the plateau: a jittered quad grid with a hole under the
 * farm (inset by holeInset so it tucks under the plateau rim), random diagonals, per-face
 * colours and gentle hills far out. One draw call.
 */
export function createMeadowGeometry(spec: MeadowSpec): THREE.BufferGeometry {
  const hole: WorldRect = {
    minX: spec.bounds.minX + spec.holeInset,
    maxX: spec.bounds.maxX - spec.holeInset,
    minZ: spec.bounds.minZ + spec.holeInset,
    maxZ: spec.bounds.maxZ - spec.holeInset,
  };
  const reach = spec.margin + spec.holeInset;
  const xs = axisLines(hole.minX, hole.maxX, reach, spec.cellSize);
  const zs = axisLines(hole.minZ, hole.maxZ, reach, spec.cellSize);
  const nx = xs.length;
  const nz = zs.length;

  const vx = new Float32Array(nx * nz);
  const vy = new Float32Array(nx * nz);
  const vz = new Float32Array(nx * nz);
  const jitter = spec.cellSize * 0.55;
  for (let c = 0; c < nz; c++) {
    for (let a = 0; a < nx; a++) {
      let x = at(xs, a);
      let z = at(zs, c);
      if (distanceOutside(spec.bounds, x, z) > spec.cellSize * 0.6) {
        x += (cosmetic(spec.offset, FEATURE.meadowJitter, a, c, 0) - 0.5) * jitter;
        z += (cosmetic(spec.offset, FEATURE.meadowJitter, a, c, 1) - 0.5) * jitter;
      }
      const index = c * nx + a;
      vx[index] = x;
      vz[index] = z;
      vy[index] = meadowHeight(spec, x, z);
    }
  }

  const cells: number[] = [];
  for (let c = 0; c < nz - 1; c++) {
    const cz = (at(zs, c) + at(zs, c + 1)) / 2;
    for (let a = 0; a < nx - 1; a++) {
      const cx = (at(xs, a) + at(xs, a + 1)) / 2;
      if (cx > hole.minX && cx < hole.maxX && cz > hole.minZ && cz < hole.maxZ) continue;
      cells.push(a, c);
    }
  }

  const cellCount = cells.length / 2;
  const positions = new Float32Array(cellCount * 18);
  const colors = new Float32Array(cellCount * 18);
  const faceColor = new THREE.Color();
  const palette: MeadowPalette = {
    near: new THREE.Color(spec.tones.near),
    far: new THREE.Color(spec.tones.far),
    hill: new THREE.Color(spec.tones.hill),
    sun: new THREE.Color(spec.tones.sun),
  };
  let cursor = 0;
  const writeTriangle = (i0: number, i1: number, i2: number, a: number, c: number, tri: number): void => {
    const x = (at(vx, i0) + at(vx, i1) + at(vx, i2)) / 3;
    const y = (at(vy, i0) + at(vy, i1) + at(vy, i2)) / 3;
    const z = (at(vz, i0) + at(vz, i1) + at(vz, i2)) / 3;
    meadowFaceColor(spec, palette, x, y, z, a, c, tri, faceColor);
    for (const index of [i0, i1, i2]) {
      positions[cursor] = at(vx, index);
      positions[cursor + 1] = at(vy, index);
      positions[cursor + 2] = at(vz, index);
      colors[cursor] = faceColor.r;
      colors[cursor + 1] = faceColor.g;
      colors[cursor + 2] = faceColor.b;
      cursor += 3;
    }
  };

  for (let k = 0; k < cellCount; k++) {
    const a = at(cells, k * 2);
    const c = at(cells, k * 2 + 1);
    const i00 = c * nx + a;
    const i10 = i00 + 1;
    const i01 = i00 + nx;
    const i11 = i01 + 1;
    // Both diagonals keep counter-clockwise winding seen from +Y (normals point up).
    if (cosmetic(spec.offset, FEATURE.meadowDiagonal, a, c, 0) < 0.5) {
      writeTriangle(i00, i11, i10, a, c, 0);
      writeTriangle(i00, i01, i11, a, c, 1);
    } else {
      writeTriangle(i00, i01, i10, a, c, 0);
      writeTriangle(i10, i01, i11, a, c, 1);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

// ---------------------------------------------------------------------------
// Trees, bushes, flowers
// ---------------------------------------------------------------------------

export type TreeSpecies = 'pine' | 'round';

/** Unscaled tree proportions. The canopy's local y = 0 sits `canopyBase` above the ground. */
export interface TreeShape {
  readonly trunkHeight: number;
  readonly trunkRadius: number;
  readonly canopyBase: number;
  readonly canopyHeight: number;
  readonly canopyRadius: number;
}

export const TREE_SHAPES: Readonly<Record<TreeSpecies, TreeShape>> = {
  pine: { trunkHeight: 0.62, trunkRadius: 0.13, canopyBase: 0.42, canopyHeight: 2.0, canopyRadius: 0.95 },
  round: { trunkHeight: 0.82, trunkRadius: 0.15, canopyBase: 0.6, canopyHeight: 1.86, canopyRadius: 1.0 },
};

export const BUSH_SHAPE = { height: 0.72, radius: 0.58 } as const;
export const FLOWER_SHAPE = { height: 0.34, radius: 0.18 } as const;

/** Tapered 6-sided trunk: base radius 1, height 1, base at y = 0 (scale per instance). */
export function createTreeTrunkGeometry(): THREE.BufferGeometry {
  return normalizePart(pose(new THREE.CylinderGeometry(0.72, 1, 1, 6, 1), { y: 0.5 }));
}

/** Three stacked, alternately rotated cones; lower tiers are shaded darker. Base at y = 0. */
export function createPineCanopyGeometry(): THREE.BufferGeometry {
  const tiers = [
    { radius: 0.95, height: 1.1, base: 0, shade: 0.82 },
    { radius: 0.74, height: 0.95, base: 0.55, shade: 0.92 },
    { radius: 0.5, height: 0.8, base: 1.2, shade: 1 },
  ] as const;
  return mergeParts(
    tiers.map((tier, i) =>
      shade(pose(new THREE.ConeGeometry(tier.radius, tier.height, 7, 1), { y: tier.base + tier.height / 2, ry: i * 0.45 }), tier.shade),
    ),
    'pine canopy',
  );
}

/** Cluster of icosahedron blobs; the lowest blob is shaded darker. Base at y ≈ 0. */
export function createRoundCanopyGeometry(): THREE.BufferGeometry {
  const blobs = [
    { radius: 0.8, x: 0, y: 0.8, z: 0, shade: 0.84 },
    { radius: 0.56, x: 0.4, y: 1.18, z: 0.16, shade: 1 },
    { radius: 0.5, x: -0.34, y: 1.28, z: -0.2, shade: 0.93 },
    { radius: 0.42, x: 0.05, y: 1.5, z: -0.02, shade: 0.98 },
  ] as const;
  return mergeParts(
    blobs.map((blob, i) =>
      shade(pose(new THREE.IcosahedronGeometry(blob.radius, 0), { x: blob.x, y: blob.y, z: blob.z, ry: i * 0.9, rx: i * 0.3 }), blob.shade),
    ),
    'round canopy',
  );
}

/**
 * One whole tree of a species at its unscaled TREE_SHAPES proportions, base at y = 0: the tapered
 * trunk painted PALETTE.treeTrunk (TINT_MASK_ATTRIBUTE 0, keeps its colour) merged with the
 * species' canopy (TINT_MASK_ATTRIBUTE 1, grey shade that the instance colour tints). Render it
 * with createTintMaskSwayMaterial, so a single instanced mesh draws trunk and canopy together.
 */
export function createTreeGeometry(species: TreeSpecies): THREE.BufferGeometry {
  const shape = TREE_SHAPES[species];
  const trunk = paint(createTreeTrunkGeometry().scale(shape.trunkRadius, shape.trunkHeight, shape.trunkRadius), PALETTE.treeTrunk);
  const canopy = (species === 'pine' ? createPineCanopyGeometry() : createRoundCanopyGeometry()).translate(0, shape.canopyBase, 0);
  return mergeParts([withTintMask(trunk, 0), withTintMask(canopy, 1)], `${species} tree`);
}

/** Low mound of four blobs. Base at y ≈ 0. */
export function createBushGeometry(): THREE.BufferGeometry {
  const blobs = [
    { radius: 0.4, x: 0, y: 0.3, z: 0, shade: 0.88 },
    { radius: 0.3, x: 0.3, y: 0.24, z: 0.1, shade: 1 },
    { radius: 0.28, x: -0.26, y: 0.23, z: -0.12, shade: 0.94 },
    { radius: 0.24, x: 0.02, y: 0.5, z: 0.12, shade: 1 },
  ] as const;
  return mergeParts(
    blobs.map((blob, i) =>
      shade(pose(new THREE.IcosahedronGeometry(blob.radius, 0), { x: blob.x, y: blob.y, z: blob.z, ry: i * 1.1 }), blob.shade),
    ),
    'bush',
  );
}

interface Blade {
  readonly matrix: THREE.Matrix4;
  readonly height: number;
}

/** Five tilted blades around the clump centre, shared by the leaf and blossom builders. */
function flowerBlades(): Blade[] {
  const blades: Blade[] = [];
  const rotation = new THREE.Matrix4();
  const tilt = new THREE.Matrix4();
  const lift = new THREE.Matrix4();
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2 + 0.3;
    const height = 0.2 + 0.1 * ((i * 3) % 5) / 4;
    lift.makeTranslation(0, height / 2, 0);
    // Negative Z rotation leans the blade toward local +X, i.e. outward after the Y turn.
    tilt.makeRotationZ(-0.28);
    rotation.makeRotationY(angle);
    const matrix = new THREE.Matrix4()
      .makeTranslation(Math.cos(angle) * 0.06, 0, -Math.sin(angle) * 0.06)
      .multiply(rotation)
      .multiply(tilt)
      .multiply(lift);
    blades.push({ matrix, height });
  }
  return blades;
}

/** Leafy tuft of a flower clump (instance-tinted green). Base at y = 0. */
export function createFlowerLeavesGeometry(): THREE.BufferGeometry {
  return mergeParts(
    flowerBlades().map((blade) => normalizePart(new THREE.ConeGeometry(0.035, blade.height, 3, 1).applyMatrix4(blade.matrix))),
    'flower leaves',
  );
}

/** Blossoms on the tips of three blades (instance-tinted). Matches createFlowerLeavesGeometry. */
export function createFlowerBlossomGeometry(): THREE.BufferGeometry {
  const tip = new THREE.Vector3();
  const blossoms: THREE.BufferGeometry[] = [];
  flowerBlades().forEach((blade, i) => {
    if (i === 1 || i === 4) return;
    tip.set(0, blade.height / 2 + 0.02, 0).applyMatrix4(blade.matrix);
    blossoms.push(normalizePart(pose(new THREE.OctahedronGeometry(0.055, 0), { x: tip.x, y: tip.y, z: tip.z, ry: i })));
  });
  return mergeParts(blossoms, 'flower blossoms');
}

/** Scenery placement in world space. `radius` is the scaled footprint radius. */
export interface PropPlacement {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly scale: number;
  readonly radius: number;
  /** sRGB hex tint. */
  readonly tint: number;
  /** Brightness multiplier applied to the tint. */
  readonly shade: number;
}

export interface TreePlacement extends PropPlacement {
  readonly species: TreeSpecies;
}

export interface FlowerPlacement extends PropPlacement {
  readonly leafTint: number;
}

function isClearOf(props: readonly PropPlacement[], x: number, z: number, radius: number, overlap: number): boolean {
  for (const prop of props) {
    const min = prop.radius * overlap + radius;
    const dx = prop.x - x;
    const dz = prop.z - z;
    if (dx * dx + dz * dz < min * min) return false;
  }
  return true;
}

/** True when a footprint circle at (x, z) touches any of the rectangles (warp corridors). */
export function touchesAny(rects: readonly WorldRect[], x: number, z: number, radius: number): boolean {
  return rects.some((rect) => distanceOutside(rect, x, z) < radius);
}

/** Jittered sample cells covering the plateau expanded by `reach` (the plateau itself is skipped by the callers' distance rules). */
function forEachCell(bounds: WorldRect, cell: number, reach: number, visit: (i: number, j: number) => void): void {
  const i0 = Math.floor((bounds.minX - reach) / cell);
  const i1 = Math.ceil((bounds.maxX + reach) / cell);
  const j0 = Math.floor((bounds.minZ - reach) / cell);
  const j1 = Math.ceil((bounds.maxZ + reach) / cell);
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) visit(i, j);
  }
}

/** Probability that a sample cell holds a prop, by distance from the plateau (tiles) and side (front = +X / +Z). */
export type DensityFn = (distanceTiles: number, front: boolean) => number;

/** How thickly a map's surroundings are planted. */
export interface SceneryDensities {
  readonly tree: DensityFn;
  readonly bush: DensityFn;
  readonly flower: DensityFn;
  /** Share of pines among the trees behind (back) and in front of the plateau. */
  readonly pineShare: { readonly back: number; readonly front: number };
  readonly bushTints: readonly number[];
}

/**
 * The farm: a dense band 2–8 tiles out behind the farm thinning into scattered trees on the
 * hills, sparse small trees ≥ 4 tiles out in front; a loose hedge row of bushes just outside the
 * fence at the back; flowers densest just outside the fence.
 */
export const FARM_DENSITIES: SceneryDensities = {
  tree: (d, front) => {
    if (front) {
      if (d < 4) return 0;
      if (d < 12) return 0.13;
      return d < 26 ? 0.06 : 0;
    }
    if (d < 2) return 0;
    if (d <= 8) return 0.6;
    if (d <= 18) return 0.3;
    return d <= 34 ? 0.12 : 0;
  },
  bush: (d, front) => {
    if (d > 22) return 0;
    if (front) return d >= 1.5 ? 0.05 : 0;
    return d >= 0.95 && d <= 2.1 ? 0.32 : d > 2.1 ? 0.06 : 0;
  },
  flower: (d, front) => {
    if (d > 15) return 0;
    if (front) return d >= 0.7 ? 0.09 : 0;
    return d >= 0.55 && d <= 3 ? 0.18 : d > 3 ? 0.07 : 0;
  },
  pineShare: { back: 0.5, front: 0.3 },
  bushTints: BUSH_TINTS,
};

/** Everything the scatter placement needs to know about one map's surroundings. */
export interface ScatterSpec {
  readonly meadow: MeadowSpec;
  /** Tile size (world units). */
  readonly unit: number;
  readonly density: SceneryDensities;
  /** Warp corridors: no tree, bush or flower footprint may touch them. */
  readonly corridors: readonly WorldRect[];
}

/**
 * Border woodland: trees by the map's density profile, each shrunk until it can no longer hide
 * a grid tile (front trees, and back trees whose canopy rim reaches past a far corner's
 * diagonal), and kept out of the warp corridors.
 */
export function placeBorderTrees(spec: ScatterSpec): TreePlacement[] {
  const { meadow, unit, density } = spec;
  const bounds = meadow.bounds;
  const offset = meadow.offset;
  const cell = 2.3 * unit;
  const trees: TreePlacement[] = [];
  forEachCell(bounds, cell, 36 * unit, (i, j) => {
    const x = (i + 0.2 + 0.6 * cosmetic(offset, FEATURE.tree, i, j, 0)) * cell;
    const z = (j + 0.2 + 0.6 * cosmetic(offset, FEATURE.tree, i, j, 1)) * cell;
    const d = distanceOutside(bounds, x, z) / unit;
    const front = Number.isFinite(occlusionClearance(bounds, x, z));
    if (cosmetic(offset, FEATURE.tree, i, j, 2) >= density.tree(d, front)) return;

    const pineShare = front ? density.pineShare.front : density.pineShare.back;
    const species: TreeSpecies = cosmetic(offset, FEATURE.tree, i, j, 3) < pineShare ? 'pine' : 'round';
    const shape = TREE_SHAPES[species];
    const size = cosmetic(offset, FEATURE.tree, i, j, 4);
    let scale = unit * (front ? 0.62 + 0.3 * size : d <= 8 ? 0.85 + 0.55 * size : 0.95 + 0.65 * size);
    const minScale = 0.5 * unit;
    const totalHeight = shape.canopyBase + shape.canopyHeight;
    while (scale >= minScale && wouldOccludeFarm(bounds, x, z, shape.canopyRadius * scale, totalHeight * scale + 0.35 * unit)) {
      scale -= 0.05 * unit;
    }
    if (scale < minScale) return;
    const radius = shape.canopyRadius * scale;
    if (touchesAny(spec.corridors, x, z, radius)) return;
    trees.push({
      species,
      x,
      y: meadowHeight(meadow, x, z) - 0.04 * unit,
      z,
      yaw: cosmetic(offset, FEATURE.tree, i, j, 5) * Math.PI * 2,
      scale,
      radius,
      tint: pick(PALETTE.treeCanopy, cosmetic(offset, FEATURE.tree, i, j, 6)),
      shade: 0.9 + 0.16 * cosmetic(offset, FEATURE.tree, i, j, 7),
    });
  });
  return trees;
}

/**
 * Bushes by the map's density profile (on the farm: a loose hedge row between the fence and the
 * woodland at the back, a few scattered through the meadow, rare low ones in front), never
 * hiding a grid tile and kept out of the warp corridors.
 */
export function placeBushes(spec: ScatterSpec, trees: readonly PropPlacement[]): PropPlacement[] {
  const { meadow, unit, density } = spec;
  const bounds = meadow.bounds;
  const offset = meadow.offset;
  const cell = 1.7 * unit;
  const bushes: PropPlacement[] = [];
  forEachCell(bounds, cell, 22 * unit, (i, j) => {
    const x = (i + 0.2 + 0.6 * cosmetic(offset, FEATURE.bush, i, j, 0)) * cell;
    const z = (j + 0.2 + 0.6 * cosmetic(offset, FEATURE.bush, i, j, 1)) * cell;
    const d = distanceOutside(bounds, x, z) / unit;
    const front = Number.isFinite(occlusionClearance(bounds, x, z));
    if (cosmetic(offset, FEATURE.bush, i, j, 2) >= density.bush(d, front)) return;

    const scale = unit * (0.75 + 0.45 * cosmetic(offset, FEATURE.bush, i, j, 3));
    const radius = BUSH_SHAPE.radius * scale;
    if (wouldOccludeFarm(bounds, x, z, radius, BUSH_SHAPE.height * scale + 0.25 * unit)) return;
    if (!isClearOf(trees, x, z, radius, 0.6) || touchesAny(spec.corridors, x, z, radius)) return;
    bushes.push({
      x,
      y: meadowHeight(meadow, x, z) - 0.02 * unit,
      z,
      yaw: cosmetic(offset, FEATURE.bush, i, j, 4) * Math.PI * 2,
      scale,
      radius,
      tint: pick(density.bushTints, cosmetic(offset, FEATURE.bush, i, j, 5)),
      shade: 0.9 + 0.14 * cosmetic(offset, FEATURE.bush, i, j, 6),
    });
  });
  return bushes;
}

/** Flower clumps sprinkled through the meadow by the map's density profile, clear of the warp corridors. */
export function placeFlowers(spec: ScatterSpec, trees: readonly PropPlacement[], bushes: readonly PropPlacement[]): FlowerPlacement[] {
  const { meadow, unit, density } = spec;
  const bounds = meadow.bounds;
  const offset = meadow.offset;
  const cell = 1.3 * unit;
  const flowers: FlowerPlacement[] = [];
  forEachCell(bounds, cell, 15 * unit, (i, j) => {
    const x = (i + 0.15 + 0.7 * cosmetic(offset, FEATURE.flower, i, j, 0)) * cell;
    const z = (j + 0.15 + 0.7 * cosmetic(offset, FEATURE.flower, i, j, 1)) * cell;
    const d = distanceOutside(bounds, x, z) / unit;
    const front = Number.isFinite(occlusionClearance(bounds, x, z));
    if (cosmetic(offset, FEATURE.flower, i, j, 2) >= density.flower(d, front)) return;

    const scale = unit * (0.8 + 0.45 * cosmetic(offset, FEATURE.flower, i, j, 3));
    const radius = FLOWER_SHAPE.radius * scale;
    if (wouldOccludeFarm(bounds, x, z, radius, FLOWER_SHAPE.height * scale + 0.2 * unit)) return;
    if (!isClearOf(trees, x, z, radius, 0.55) || !isClearOf(bushes, x, z, radius, 0.9)) return;
    if (touchesAny(spec.corridors, x, z, radius)) return;
    flowers.push({
      x,
      y: meadowHeight(meadow, x, z) - 0.01 * unit,
      z,
      yaw: cosmetic(offset, FEATURE.flower, i, j, 4) * Math.PI * 2,
      scale,
      radius,
      tint: pick(PALETTE.flower, cosmetic(offset, FEATURE.flower, i, j, 5)),
      leafTint: pick(FLOWER_LEAF_TINTS, cosmetic(offset, FEATURE.flower, i, j, 6)),
      shade: 0.92 + 0.1 * cosmetic(offset, FEATURE.flower, i, j, 7),
    });
  });
  return flowers;
}

// ---------------------------------------------------------------------------
// Fence
// ---------------------------------------------------------------------------

/** A side of the plateau: north is −Z, south +Z, west −X, east +X. North and west are the back sides. */
export type PlateauSide = 'north' | 'south' | 'west' | 'east';

/** True for the sides behind the plateau as the camera sees it (−X / −Z): nothing there can hide a tile. */
export function isBackSide(side: PlateauSide): boolean {
  return side === 'north' || side === 'west';
}

/**
 * An opening in a boundary (fence or wall) on one side: world coordinates along the side's axis
 * (X on the north and south sides, Z on the west and east sides).
 */
export interface BoundaryGap {
  readonly side: PlateauSide;
  readonly min: number;
  readonly max: number;
}

/** The pieces of [start, end] left between the gaps (each clipped to the range), in order. */
export function boundaryRuns(start: number, end: number, gaps: readonly { readonly min: number; readonly max: number }[]): [number, number][] {
  const sorted = [...gaps].sort((a, b) => a.min - b.min);
  const runs: [number, number][] = [];
  let cursor = start;
  for (const gap of sorted) {
    if (gap.max <= cursor || gap.min >= end) continue;
    if (gap.min > cursor) runs.push([cursor, gap.min]);
    cursor = Math.max(cursor, gap.max);
  }
  if (cursor < end) runs.push([cursor, end]);
  return runs;
}

/**
 * Tall on the −X / −Z sides (behind the plateau), low on the +X / +Z sides so no tile is hidden.
 * Gaps at the warps get taller, thicker gateposts on the back sides only; a gap on a front side
 * ends in ordinary low posts.
 */
export const FENCE_SHAPE = {
  /** Distance of the fence line outside the plateau edge. */
  offset: 0.3,
  spacing: 2,
  tallHeight: 0.8,
  /** Post tops stay below the height at which they would start to cover the edge tiles. */
  lowHeight: 0.3,
  tallRails: [0.3, 0.58],
  lowRails: [0.18],
  gateHeight: 1.12,
  /** Horizontal scale of a gatepost relative to an ordinary post. */
  gateWidth: 1.45,
} as const;

/** One instanced fence piece: posts scale Y by `height` and X / Z by `length`; rails scale X by `length`. */
export interface FencePiece {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly length: number;
  readonly height: number;
  readonly shade: number;
}

export interface FenceLayout {
  readonly posts: readonly FencePiece[];
  readonly rails: readonly FencePiece[];
}

/** Half the diagonal of an unscaled fence post's square footprint (0.13 wide). */
export const FENCE_POST_RADIUS = 0.13 * Math.SQRT1_2;

/** Square post with a pyramid cap: 0.13 wide, height 1, base at y = 0 (scale Y per instance). */
export function createFencePostGeometry(): THREE.BufferGeometry {
  return mergeParts(
    [
      normalizePart(pose(new THREE.BoxGeometry(0.13, 0.92, 0.13), { y: 0.46 })),
      normalizePart(pose(new THREE.ConeGeometry(0.0919, 0.08, 4, 1), { y: 0.96, ry: Math.PI / 4 })),
    ],
    'fence post',
  );
}

/** Unit-length rail along local X, centred on the origin (scale X per instance). */
export function createFenceRailGeometry(): THREE.BufferGeometry {
  return normalizePart(new THREE.BoxGeometry(1, 0.07, 0.045));
}

function fenceShade(offset: CosmeticOffset, x: number, z: number): number {
  return 0.92 + 0.1 * cosmetic(offset, FEATURE.fence, Math.round(x * 8), Math.round(z * 8), 0);
}

/**
 * Posts and rails around the plateau, `FENCE_SHAPE.offset` outside its edge, standing on groundY,
 * with an opening at every gap. Each side runs in increasing X or Z.
 */
export function layoutFence(bounds: WorldRect, groundY: number, gaps: readonly BoundaryGap[], offset: CosmeticOffset): FenceLayout {
  const F = FENCE_SHAPE;
  const x0 = bounds.minX - F.offset;
  const x1 = bounds.maxX + F.offset;
  const z0 = bounds.minZ - F.offset;
  const z1 = bounds.maxZ + F.offset;
  const posts: FencePiece[] = [];
  const rails: FencePiece[] = [];

  const addPost = (x: number, z: number, height: number, width: number): void => {
    posts.push({ x, y: groundY - 0.03, z, yaw: 0, length: width, height: height + 0.03, shade: fenceShade(offset, x, z) });
  };

  const sides = [
    { side: 'north', ax: x0, az: z0, bx: x1, bz: z0 },
    { side: 'west', ax: x0, az: z0, bx: x0, bz: z1 },
    { side: 'south', ax: x0, az: z1, bx: x1, bz: z1 },
    { side: 'east', ax: x1, az: z0, bx: x1, bz: z1 },
  ] as const;
  for (const side of sides) {
    const tall = isBackSide(side.side);
    const alongX = side.bz === side.az;
    const start = alongX ? side.ax : side.az;
    const end = alongX ? side.bx : side.bz;
    const point = (t: number): [number, number] => (alongX ? [t, side.az] : [side.ax, t]);
    const yaw = alongX ? 0 : -Math.PI / 2;
    const heights = tall ? F.tallRails : F.lowRails;
    for (const [r0, r1] of boundaryRuns(start, end, gaps.filter((gap) => gap.side === side.side))) {
      const length = r1 - r0;
      const segments = Math.max(1, Math.round(length / F.spacing));
      const step = length / segments;
      for (let i = 0; i < segments; i++) {
        if (i > 0) addPost(...point(r0 + (length * i) / segments), tall ? F.tallHeight : F.lowHeight, 1);
        const [mx, mz] = point(r0 + (length * (i + 0.5)) / segments);
        for (const height of heights) {
          rails.push({ x: mx, y: groundY + height, z: mz, yaw, length: step, height: 1, shade: fenceShade(offset, mx, mz + height) });
        }
      }
      for (const edge of [r0 === start ? null : r0, r1 === end ? null : r1]) {
        if (edge === null) continue;
        const [px, pz] = point(edge);
        // A gatepost keeps the occlusion rule like every other scenery piece; on a back side it always passes.
        const gate = tall && !wouldOccludeFarm(bounds, px, pz, FENCE_POST_RADIUS * F.gateWidth, F.gateHeight);
        addPost(px, pz, gate ? F.gateHeight : tall ? F.tallHeight : F.lowHeight, gate ? F.gateWidth : 1);
      }
    }
  }
  addPost(x0, z0, F.tallHeight, 1);
  addPost(x1, z0, F.tallHeight, 1);
  addPost(x0, z1, F.tallHeight, 1);
  addPost(x1, z1, F.lowHeight, 1);
  return { posts, rails };
}
