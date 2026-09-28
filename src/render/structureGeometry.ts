/**
 * Pure geometry builders and deterministic scenery layout for the farmstead: the farmhouse, the
 * shipping bin, and the meadow, border trees, fence, bushes and flower clumps around the farm
 * plateau. Nothing here touches the scene or game state; StructureRenderer owns the results.
 *
 * Geometry conventions
 * - Every builder returns fresh, non-indexed BufferGeometry with `position` and `normal`
 *   attributes and no UVs or groups, so parts merge cleanly with mergeGeometries and render
 *   flat-shaded. The caller owns (and must dispose) what it receives.
 * - "Painted" builders bake linear-space colours into a `color` attribute: render them with a
 *   white material and `vertexColors: true`. Instance-tinted builders (canopies, bushes) bake a
 *   grey shade instead, which multiplies the per-instance colour to give tiers some depth.
 * - Swaying geometry (canopies, bushes, flowers) has its base at local y = 0, because the sway
 *   shader displaces vertices by the square of their local height.
 * - Structures are authored facing +Z (the side the camera sees), origin on the ground at the
 *   centre of their footprint.
 *
 * Layout conventions
 * - Placement is a pure function of the plateau rectangle and cosmetic hashes (Salt.Cosmetic)
 *   keyed by integer cell coordinates, so the scenery is identical on every rebuild.
 * - Occlusion: the camera looks from the (+X, +Z) diagonal at a pitch of atan(1/√2), so a point
 *   at height h covers the ground exactly h units further along both −X and −Z. Scenery that
 *   could hide farm tiles (the +X / +Z sides) is sized with {@link wouldOccludeFarm}.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Salt, hashFloat } from '../core/hash';
import type { WorldRect } from '../world/grid';
import { PALETTE } from './palette';

// ---------------------------------------------------------------------------
// Colours missing from the shared palette
// ---------------------------------------------------------------------------

/** Local colours (sRGB hex) for structure details the shared palette does not cover. */
export const STRUCTURE_COLORS = {
  stone: 0xd6cdc1,
  brick: 0xd88c72,
  brickDark: 0x9e6c5e,
  roofShade: 0xd5776b,
  roofRidge: 0xc4685d,
  shutter: 0x9ec6d8,
  shutterDark: 0x84adc2,
  doorDark: 0x875c40,
  knob: 0xf2c94c,
  iron: 0x5b4a40,
  doormat: 0xe59c7f,
  leaf: 0x78c06b,
  binPlank: 0xae784c,
  coin: 0xffcc45,
  coinFace: 0xffe596,
  glassDay: 0xc4e2ec,
  windowGlow: 0xffc36a,
  smoke: 0xf4f0ea,
  meadowNear: 0x93c97c,
  meadowFar: 0xa9d1a1,
  meadowHill: 0xbadc9d,
  meadowSun: 0xa9d487,
} as const;

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

/** Uniform [0, 1) cosmetic hash for one feature at integer coordinates (a, b), channel k. */
function cosmetic(feature: number, a: number, b: number, k: number): number {
  return hashFloat(Salt.Cosmetic, feature, a, b, k);
}

/** Picks an entry of a non-empty list with a uniform [0, 1) value. */
function pick<T>(list: readonly T[], unit: number): T {
  const value = list[Math.min(list.length - 1, Math.max(0, Math.floor(unit * list.length)))];
  if (value === undefined) throw new RangeError('pick: list is empty');
  return value;
}

function at<T>(list: ArrayLike<T>, index: number): T {
  const value = list[index];
  if (value === undefined) throw new RangeError(`index ${index} outside [0, ${list.length})`);
  return value;
}

// ---------------------------------------------------------------------------
// Part helpers (build-time only)
// ---------------------------------------------------------------------------

type Vec2 = readonly [number, number];

/** Rotation (applied X, then Z, then Y) followed by a translation. */
interface Pose {
  readonly x?: number;
  readonly y?: number;
  readonly z?: number;
  readonly rx?: number;
  readonly ry?: number;
  readonly rz?: number;
}

/** Body parts are painted and opaque; glass parts are unpainted and use the glow material. */
interface PartSet {
  readonly body: THREE.BufferGeometry[];
  readonly glass: THREE.BufferGeometry[];
}

const paintColor = new THREE.Color();
const prismA = new THREE.Vector3();
const prismB = new THREE.Vector3();
const prismC = new THREE.Vector3();
const prismNormal = new THREE.Vector3();
const prismEdge = new THREE.Vector3();
const prismCentroid = new THREE.Vector3();

/** Non-indexed, no UVs, no groups, has normals. Disposes the source when a copy was needed. */
function normalizePart(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const geometry = source.index === null ? source : source.toNonIndexed();
  if (geometry !== source) source.dispose();
  if (geometry.hasAttribute('uv')) geometry.deleteAttribute('uv');
  geometry.clearGroups();
  if (!geometry.hasAttribute('normal')) geometry.computeVertexNormals();
  return geometry;
}

function pose<T extends THREE.BufferGeometry>(geometry: T, p: Pose): T {
  if (p.rx !== undefined && p.rx !== 0) geometry.rotateX(p.rx);
  if (p.rz !== undefined && p.rz !== 0) geometry.rotateZ(p.rz);
  if (p.ry !== undefined && p.ry !== 0) geometry.rotateY(p.ry);
  geometry.translate(p.x ?? 0, p.y ?? 0, p.z ?? 0);
  return geometry;
}

/** Fills a `color` attribute with one linear-space colour. */
function paintRgb(source: THREE.BufferGeometry, r: number, g: number, b: number): THREE.BufferGeometry {
  const geometry = normalizePart(source);
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function paint(source: THREE.BufferGeometry, color: THREE.ColorRepresentation): THREE.BufferGeometry {
  paintColor.set(color);
  return paintRgb(source, paintColor.r, paintColor.g, paintColor.b);
}

/** Grey vertex colour that multiplies an instance tint. */
function shade(source: THREE.BufferGeometry, value: number): THREE.BufferGeometry {
  return paintRgb(source, value, value, value);
}

function box(
  width: number,
  height: number,
  depth: number,
  p: Pose,
  color: THREE.ColorRepresentation,
): THREE.BufferGeometry {
  return paint(pose(new THREE.BoxGeometry(width, height, depth), p), color);
}

function glassBox(width: number, height: number, depth: number, p: Pose): THREE.BufferGeometry {
  return normalizePart(pose(new THREE.BoxGeometry(width, height, depth), p));
}

/**
 * Merges compatible parts (same attribute set, all non-indexed) into one geometry and disposes
 * the inputs. Throws when the parts are incompatible.
 */
export function mergeParts(parts: readonly THREE.BufferGeometry[], label: string): THREE.BufferGeometry {
  if (parts.length === 0) throw new RangeError(`mergeParts(${label}): nothing to merge`);
  const merged: THREE.BufferGeometry | null = mergeGeometries([...parts], false);
  for (const part of parts) part.dispose();
  if (merged === null) throw new Error(`mergeParts(${label}): parts have incompatible attributes`);
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

function transformParts(parts: readonly THREE.BufferGeometry[], matrix: THREE.Matrix4, out: THREE.BufferGeometry[]): void {
  for (const part of parts) out.push(part.applyMatrix4(matrix));
}

/**
 * Closed prism extruded along X from a convex profile of (z, y) points. Faces are oriented
 * outward whatever the profile's winding, so the result casts and receives shadows correctly.
 */
export function convexPrismX(profile: readonly Vec2[], x0: number, x1: number): THREE.BufferGeometry {
  const n = profile.length;
  if (n < 3) throw new RangeError('convexPrismX: a profile needs at least three points');
  let sumZ = 0;
  let sumY = 0;
  for (const [z, y] of profile) {
    sumZ += z;
    sumY += y;
  }
  prismCentroid.set((x0 + x1) / 2, sumY / n, sumZ / n);

  const positions: number[] = [];
  const pushTriangle = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): void => {
    prismNormal.subVectors(b, a).cross(prismEdge.subVectors(c, a));
    const cx = (a.x + b.x + c.x) / 3 - prismCentroid.x;
    const cy = (a.y + b.y + c.y) / 3 - prismCentroid.y;
    const cz = (a.z + b.z + c.z) / 3 - prismCentroid.z;
    const outward = prismNormal.x * cx + prismNormal.y * cy + prismNormal.z * cz >= 0;
    const second = outward ? b : c;
    const third = outward ? c : b;
    positions.push(a.x, a.y, a.z, second.x, second.y, second.z, third.x, third.y, third.z);
  };

  for (let i = 0; i < n; i++) {
    const [pz, py] = at(profile, i);
    const [qz, qy] = at(profile, (i + 1) % n);
    pushTriangle(prismA.set(x0, py, pz), prismB.set(x1, py, pz), prismC.set(x1, qy, qz));
    pushTriangle(prismA.set(x0, py, pz), prismB.set(x1, qy, qz), prismC.set(x0, qy, qz));
  }
  const [fz, fy] = at(profile, 0);
  for (let i = 1; i < n - 1; i++) {
    const [pz, py] = at(profile, i);
    const [qz, qy] = at(profile, i + 1);
    pushTriangle(prismA.set(x0, fy, fz), prismB.set(x0, py, pz), prismC.set(x0, qy, qz));
    pushTriangle(prismA.set(x1, fy, fz), prismB.set(x1, py, pz), prismC.set(x1, qy, qz));
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
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
   * Roof overhangs. Keep eaveOverhang ≤ the back inset and gableOverhang + 0.06 (barge boards)
   * ≤ the side inset the renderer uses, so the roof never reaches over neighbouring tiles.
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
  readonly slope: number;
  readonly rise: number;
  /** Vertical thickness of the roof panels. */
  readonly roofVertical: number;
  readonly ridgeTop: number;
  readonly doorX: number;
  readonly stepDepth: number;
}

function houseFrame(spec: FarmhouseSpec): HouseFrame {
  const S = FARMHOUSE_SHAPE;
  const halfW = spec.width / 2;
  const halfD = spec.depth / 2;
  const foundationTop = S.foundationHeight;
  const wallTop = foundationTop + S.wallHeight;
  const slope = Math.tan(S.roofPitch);
  const rise = halfD * slope;
  const roofVertical = S.roofThickness / Math.cos(S.roofPitch);
  const doorLimit = Math.max(0, halfW - S.cornerPost - S.doorWidth / 2 - 0.12);
  return {
    halfW,
    halfD,
    foundationTop,
    wallTop,
    slope,
    rise,
    roofVertical,
    ridgeTop: wallTop + rise + roofVertical,
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

  const gable: Vec2[] = [
    [-f.halfD, f.wallTop],
    [f.halfD, f.wallTop],
    [0, f.wallTop + f.rise],
  ];
  out.body.push(paint(convexPrismX(gable, -f.halfW, f.halfW), PALETTE.houseWall));

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

/** Two sloped panels with overhang, shingle rows, barge boards and a ridge cap. */
function roofParts(f: HouseFrame, out: PartSet): void {
  const S = FARMHOUSE_SHAPE;
  const halfLength = f.halfW + S.gableOverhang;
  const eaveZ = f.halfD + S.eaveOverhang;
  const eaveBottom = f.wallTop - S.eaveOverhang * f.slope;
  const ridgeBottom = f.wallTop + f.rise;
  const cos = Math.cos(S.roofPitch);
  const sin = Math.sin(S.roofPitch);
  const slopeLength = eaveZ / cos;

  for (const side of [1, -1]) {
    const panel: Vec2[] = [
      [0, f.ridgeTop],
      [side * eaveZ, eaveBottom + f.roofVertical],
      [side * eaveZ, eaveBottom],
      [0, ridgeBottom],
    ];
    out.body.push(paint(convexPrismX(panel, -halfLength, halfLength), PALETTE.houseRoof));

    // Outward normal of this slope and a point on its top surface `s` units down from the ridge.
    const normalY = cos;
    const normalZ = side * sin;
    const surfaceZ = (s: number): number => side * s * cos;
    const surfaceY = (s: number): number => f.ridgeTop - s * sin;

    const stripThickness = 0.035;
    for (const fraction of [0.3, 0.55, 0.8]) {
      const s = slopeLength * fraction;
      out.body.push(
        box(
          halfLength * 2,
          stripThickness,
          0.09,
          {
            y: surfaceY(s) + (normalY * stripThickness) / 2,
            z: surfaceZ(s) + (normalZ * stripThickness) / 2,
            rx: side * S.roofPitch,
          },
          STRUCTURE_COLORS.roofShade,
        ),
      );
    }

    const boardHeight = S.roofThickness + 0.1;
    const mid = slopeLength / 2;
    const inset = S.roofThickness / 2 + 0.03;
    for (const end of [-1, 1]) {
      out.body.push(
        box(
          0.06,
          boardHeight,
          slopeLength,
          {
            x: end * (halfLength + 0.03),
            y: surfaceY(mid) - normalY * inset,
            z: surfaceZ(mid) - normalZ * inset,
            rx: side * S.roofPitch,
          },
          PALETTE.houseTrim,
        ),
      );
    }
  }

  out.body.push(box(halfLength * 2 + 0.1, 0.13, 0.13, { y: f.ridgeTop, rx: Math.PI / 4 }, STRUCTURE_COLORS.roofRidge));
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

/** Door with frame, planks, window, knob, awning, porch step and doormat. */
function doorParts(f: HouseFrame, out: PartSet): void {
  const S = FARMHOUSE_SHAPE;
  const front = f.halfD;
  const x = f.doorX;
  const base = f.foundationTop;
  const frameHalf = S.doorWidth / 2 + 0.1;
  const frameHeight = S.doorHeight + 0.12;

  out.body.push(box(frameHalf * 2, frameHeight, 0.08, { x, y: base + frameHeight / 2, z: front + 0.03 }, PALETTE.houseTrim));
  out.body.push(box(S.doorWidth, S.doorHeight, 0.06, { x, y: base + S.doorHeight / 2, z: front + 0.08 }, PALETTE.door));
  for (const sx of [-1, 1]) {
    out.body.push(box(0.025, 0.82, 0.012, { x: x + sx * 0.14, y: base + 0.49, z: front + 0.114 }, STRUCTURE_COLORS.doorDark));
  }

  const paneY = base + S.doorHeight - 0.3;
  out.glass.push(glassBox(0.3, 0.2, 0.02, { x, y: paneY, z: front + 0.115 }));
  out.body.push(box(0.022, 0.2, 0.02, { x, y: paneY, z: front + 0.128 }, STRUCTURE_COLORS.doorDark));
  out.body.push(box(0.3, 0.022, 0.02, { x, y: paneY, z: front + 0.128 }, STRUCTURE_COLORS.doorDark));
  out.body.push(paint(pose(new THREE.IcosahedronGeometry(0.045, 0), { x: x + 0.27, y: base + 0.68, z: front + 0.13 }), STRUCTURE_COLORS.knob));

  // Little shed awning over the door, held by two diagonal brackets.
  const awningTilt = 0.42;
  const awningDepth = 0.5;
  out.body.push(
    box(
      frameHalf * 2 + 0.24,
      0.06,
      awningDepth,
      { x, y: base + frameHeight + 0.2, z: front + (awningDepth / 2) * Math.cos(awningTilt), rx: awningTilt },
      PALETTE.houseRoof,
    ),
  );
  for (const sx of [-1, 1]) {
    out.body.push(box(0.05, 0.05, 0.3, { x: x + sx * (frameHalf + 0.02), y: base + frameHeight + 0.05, z: front + 0.1, rx: -0.8 }, PALETTE.houseTrim));
  }

  out.body.push(box(1.3, 0.12, f.stepDepth, { x, y: 0.04, z: front + f.stepDepth / 2 }, STRUCTURE_COLORS.stone));
  const matDepth = Math.min(0.32, f.stepDepth - 0.12);
  out.body.push(box(0.7, 0.02, matDepth, { x, y: 0.11, z: front + f.stepDepth / 2 + 0.03 }, STRUCTURE_COLORS.doormat));
}

/** Wall lantern hanging from a bracket; its glass glows with the windows. */
function lanternParts(x: number, y: number, front: number, out: PartSet): void {
  const z = front + 0.16;
  out.body.push(box(0.04, 0.04, 0.17, { x, y: y + 0.19, z: front + 0.085 }, STRUCTURE_COLORS.iron));
  out.body.push(paint(pose(new THREE.ConeGeometry(0.105, 0.09, 4), { x, y: y + 0.145, z, ry: Math.PI / 4 }), STRUCTURE_COLORS.iron));
  out.body.push(box(0.15, 0.03, 0.15, { x, y: y - 0.075, z }, STRUCTURE_COLORS.iron));
  out.glass.push(glassBox(0.12, 0.16, 0.12, { x, y: y + 0.02, z }));
}

interface WindowOptions {
  readonly width: number;
  readonly height: number;
  readonly shutters: boolean;
  readonly planter: boolean;
}

/**
 * A window authored on a wall at z = 0 facing +Z, centred on the origin: frame, recessed pane,
 * muntins, sill, optional shutters and an optional flower box. `placement` moves it onto a wall.
 */
function windowParts(options: WindowOptions, placement: THREE.Matrix4, out: PartSet): void {
  const S = FARMHOUSE_SHAPE;
  const fw = S.frameWidth;
  const w = options.width;
  const h = options.height;
  const trim = PALETTE.houseTrim;
  const local: PartSet = { body: [], glass: [] };

  local.body.push(box(w + 2 * fw, fw, 0.09, { y: h / 2 + fw / 2, z: 0.045 }, trim));
  local.body.push(box(w + 2 * fw, fw, 0.09, { y: -h / 2 - fw / 2, z: 0.045 }, trim));
  local.body.push(box(fw, h, 0.09, { x: -w / 2 - fw / 2, z: 0.045 }, trim));
  local.body.push(box(fw, h, 0.09, { x: w / 2 + fw / 2, z: 0.045 }, trim));
  local.glass.push(glassBox(w, h, 0.02, { z: 0.02 }));
  local.body.push(box(0.035, h, 0.03, { z: 0.05 }, trim));
  local.body.push(box(w, 0.035, 0.03, { z: 0.05 }, trim));
  local.body.push(box(w + 2 * fw + 0.12, 0.06, 0.16, { y: -h / 2 - fw - 0.03, z: 0.08 }, trim));

  if (options.shutters) {
    for (const side of [-1, 1]) {
      const sx = side * (w / 2 + fw + S.shutterWidth / 2 + 0.01);
      local.body.push(box(S.shutterWidth, h + 2 * fw, 0.04, { x: sx, z: 0.02 }, STRUCTURE_COLORS.shutter));
      for (const sy of [-0.26, 0.26]) {
        local.body.push(box(S.shutterWidth * 0.72, 0.035, 0.016, { x: sx, y: sy * h, z: 0.047 }, STRUCTURE_COLORS.shutterDark));
      }
    }
  }

  if (options.planter) {
    const top = -h / 2 - fw - 0.07;
    const planterWidth = w + 2 * fw + 0.06;
    local.body.push(box(planterWidth, 0.2, 0.22, { y: top - 0.1, z: 0.12 }, PALETTE.binWood));
    local.body.push(box(planterWidth - 0.08, 0.02, 0.15, { y: top, z: 0.12 }, PALETTE.soilWatered));
    const blooms = 5;
    for (let i = 0; i < blooms; i++) {
      const fx = -planterWidth / 2 + 0.1 + (i / (blooms - 1)) * (planterWidth - 0.2);
      local.body.push(
        paint(pose(new THREE.TetrahedronGeometry(0.08, 0), { x: fx + 0.04, y: top + 0.04, z: 0.11, ry: i * 1.3 }), STRUCTURE_COLORS.leaf),
      );
      local.body.push(
        paint(
          pose(new THREE.OctahedronGeometry(0.06, 0), { x: fx, y: top + 0.1 + (i % 2) * 0.03, z: 0.13, ry: i * 0.7 }),
          pick(PALETTE.flower, (i % 3) / 3),
        ),
      );
    }
  }

  transformParts(local.body, placement, out.body);
  transformParts(local.glass, placement, out.glass);
}

/**
 * Cosy gabled cottage in house-local space: origin on the ground at the centre of the wall
 * footprint, front door on the +Z face. The ridge runs along X, so the camera sees the front
 * slope and the +X gable (with an attic window). The porch step reaches `stepDepth` past the
 * front wall; everything else stays within the wall footprint plus the roof overhang.
 */
export function createFarmhouseGeometry(spec: FarmhouseSpec): FarmhouseGeometry {
  const S = FARMHOUSE_SHAPE;
  const f = houseFrame(spec);
  const parts: PartSet = { body: [], glass: [] };

  shellParts(f, parts);
  roofParts(f, parts);
  const chimneyTop = chimneyParts(f, parts);
  doorParts(f, parts);

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
    windowParts(frontWindow, placement.makeTranslation((start + end) / 2, windowY, f.halfD), parts);
  }

  const lanternX = f.doorX + frameHalf + S.lanternGap / 2;
  if (lanternX + 0.08 < postInner) lanternParts(lanternX, f.foundationTop + 1.34, f.halfD, parts);

  // +X side: a shuttered window on the wall and a small attic window in the gable.
  const faceEast = new THREE.Matrix4().makeRotationY(Math.PI / 2);
  if (f.halfD * 2 >= windowHalf * 2 + S.cornerPost) {
    placement.copy(faceEast).setPosition(f.halfW, windowY, 0);
    windowParts({ width: S.windowWidth, height: S.windowHeight, shutters: true, planter: false }, placement, parts);
  }
  placement.copy(faceEast).setPosition(f.halfW, f.wallTop + f.rise * 0.36, 0);
  windowParts({ width: 0.4, height: 0.4, shutters: false, planter: false }, placement, parts);

  return {
    body: mergeParts(parts.body, 'farmhouse body'),
    glass: mergeParts(parts.glass, 'farmhouse glass'),
    chimneyTop,
    height: chimneyTop.y,
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
}

/** Rolling hills beyond the flat ring: tall behind the farm (−X / −Z), gentle in front. */
export const MEADOW_RELIEF = {
  flatDistance: 14,
  rampDistance: 26,
  backHillHeight: 4.4,
  frontHillHeight: 0.7,
  noiseScale: 12,
  detailScale: 5,
} as const;

function valueNoise(x: number, z: number, feature: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = cosmetic(feature, ix, iz, 0);
  const b = cosmetic(feature, ix + 1, iz, 0);
  const c = cosmetic(feature, ix, iz + 1, 0);
  const d = cosmetic(feature, ix + 1, iz + 1, 0);
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
    0.75 * valueNoise(x / R.noiseScale, z / R.noiseScale, FEATURE.hills) +
    0.25 * valueNoise(x / R.detailScale + 17, z / R.detailScale - 5, FEATURE.hillDetail);
  return spec.topY + ramp * amplitude * noise;
}

const meadowNear = new THREE.Color(STRUCTURE_COLORS.meadowNear);
const meadowFar = new THREE.Color(STRUCTURE_COLORS.meadowFar);
const meadowHill = new THREE.Color(STRUCTURE_COLORS.meadowHill);
const meadowSun = new THREE.Color(STRUCTURE_COLORS.meadowSun);

/** Face colour: lush near the farm, softer and hazier far away, lighter on hill tops, patchy. */
function meadowFaceColor(spec: MeadowSpec, x: number, y: number, z: number, a: number, c: number, tri: number, target: THREE.Color): THREE.Color {
  const d = distanceOutside(spec.bounds, x, z);
  target.copy(meadowNear).lerp(meadowFar, smoothstep(22, 78, d));
  target.lerp(meadowHill, 0.55 * clamp01((y - spec.topY) / MEADOW_RELIEF.backHillHeight));
  if (cosmetic(FEATURE.meadowTone, a * 2 + tri, c, 0) < 0.12) target.lerp(meadowSun, 0.45);
  let brightness = 0.96 + 0.07 * cosmetic(FEATURE.meadowTone, a * 2 + tri, c, 1);
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
        x += (cosmetic(FEATURE.meadowJitter, a, c, 0) - 0.5) * jitter;
        z += (cosmetic(FEATURE.meadowJitter, a, c, 1) - 0.5) * jitter;
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
  let cursor = 0;
  const writeTriangle = (i0: number, i1: number, i2: number, a: number, c: number, tri: number): void => {
    const x = (at(vx, i0) + at(vx, i1) + at(vx, i2)) / 3;
    const y = (at(vy, i0) + at(vy, i1) + at(vy, i2)) / 3;
    const z = (at(vz, i0) + at(vz, i1) + at(vz, i2)) / 3;
    meadowFaceColor(spec, x, y, z, a, c, tri, faceColor);
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
    if (cosmetic(FEATURE.meadowDiagonal, a, c, 0) < 0.5) {
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

/** Probability that a tree cell holds a tree, by distance (tiles) and side. */
function treeDensity(distanceTiles: number, front: boolean): number {
  if (front) {
    if (distanceTiles < 4) return 0;
    if (distanceTiles < 12) return 0.13;
    return distanceTiles < 26 ? 0.06 : 0;
  }
  if (distanceTiles < 2) return 0;
  if (distanceTiles <= 8) return 0.6;
  if (distanceTiles <= 18) return 0.3;
  return distanceTiles <= 34 ? 0.12 : 0;
}

/**
 * Border woodland: a dense band 2–8 tiles out on the −X / −Z sides (behind the farm as seen by
 * the camera) thinning into scattered trees on the hills, and only sparse, small trees ≥ 4 tiles
 * out on the +X / +Z sides, each shrunk until it can no longer hide a farm tile.
 */
export function placeBorderTrees(meadow: MeadowSpec, unit: number): TreePlacement[] {
  const bounds = meadow.bounds;
  const cell = 2.3 * unit;
  const trees: TreePlacement[] = [];
  forEachCell(bounds, cell, 36 * unit, (i, j) => {
    const x = (i + 0.2 + 0.6 * cosmetic(FEATURE.tree, i, j, 0)) * cell;
    const z = (j + 0.2 + 0.6 * cosmetic(FEATURE.tree, i, j, 1)) * cell;
    const d = distanceOutside(bounds, x, z) / unit;
    const front = Number.isFinite(occlusionClearance(bounds, x, z));
    if (cosmetic(FEATURE.tree, i, j, 2) >= treeDensity(d, front)) return;

    const species: TreeSpecies = cosmetic(FEATURE.tree, i, j, 3) < (front ? 0.3 : 0.5) ? 'pine' : 'round';
    const shape = TREE_SHAPES[species];
    const size = cosmetic(FEATURE.tree, i, j, 4);
    let scale = unit * (front ? 0.62 + 0.3 * size : d <= 8 ? 0.85 + 0.55 * size : 0.95 + 0.65 * size);
    // Front trees, and back trees whose canopy rim reaches past a far corner's diagonal, shrink
    // until they cannot hide a farm tile.
    const minScale = 0.5 * unit;
    const totalHeight = shape.canopyBase + shape.canopyHeight;
    while (scale >= minScale && wouldOccludeFarm(bounds, x, z, shape.canopyRadius * scale, totalHeight * scale + 0.35 * unit)) {
      scale -= 0.05 * unit;
    }
    if (scale < minScale) return;
    trees.push({
      species,
      x,
      y: meadowHeight(meadow, x, z) - 0.04 * unit,
      z,
      yaw: cosmetic(FEATURE.tree, i, j, 5) * Math.PI * 2,
      scale,
      radius: shape.canopyRadius * scale,
      tint: pick(PALETTE.treeCanopy, cosmetic(FEATURE.tree, i, j, 6)),
      shade: 0.9 + 0.16 * cosmetic(FEATURE.tree, i, j, 7),
    });
  });
  return trees;
}

/**
 * Bushes: a loose hedge row between the fence and the woodland on the −X / −Z sides, a few
 * scattered through the meadow, and rare low ones in front that never hide the farm.
 */
export function placeBushes(meadow: MeadowSpec, unit: number, trees: readonly PropPlacement[]): PropPlacement[] {
  const bounds = meadow.bounds;
  const cell = 1.7 * unit;
  const bushes: PropPlacement[] = [];
  forEachCell(bounds, cell, 22 * unit, (i, j) => {
    const x = (i + 0.2 + 0.6 * cosmetic(FEATURE.bush, i, j, 0)) * cell;
    const z = (j + 0.2 + 0.6 * cosmetic(FEATURE.bush, i, j, 1)) * cell;
    const d = distanceOutside(bounds, x, z) / unit;
    if (d > 22) return;
    const front = Number.isFinite(occlusionClearance(bounds, x, z));
    const density = front ? (d >= 1.5 ? 0.05 : 0) : d >= 0.95 && d <= 2.1 ? 0.32 : d > 2.1 ? 0.06 : 0;
    if (cosmetic(FEATURE.bush, i, j, 2) >= density) return;

    const scale = unit * (0.75 + 0.45 * cosmetic(FEATURE.bush, i, j, 3));
    const radius = BUSH_SHAPE.radius * scale;
    if (wouldOccludeFarm(bounds, x, z, radius, BUSH_SHAPE.height * scale + 0.25 * unit)) return;
    if (!isClearOf(trees, x, z, radius, 0.6)) return;
    bushes.push({
      x,
      y: meadowHeight(meadow, x, z) - 0.02 * unit,
      z,
      yaw: cosmetic(FEATURE.bush, i, j, 4) * Math.PI * 2,
      scale,
      radius,
      tint: pick(BUSH_TINTS, cosmetic(FEATURE.bush, i, j, 5)),
      shade: 0.9 + 0.14 * cosmetic(FEATURE.bush, i, j, 6),
    });
  });
  return bushes;
}

/** Flower clumps sprinkled through the meadow, densest just outside the fence. */
export function placeFlowers(
  meadow: MeadowSpec,
  unit: number,
  trees: readonly PropPlacement[],
  bushes: readonly PropPlacement[],
): FlowerPlacement[] {
  const bounds = meadow.bounds;
  const cell = 1.3 * unit;
  const flowers: FlowerPlacement[] = [];
  forEachCell(bounds, cell, 15 * unit, (i, j) => {
    const x = (i + 0.15 + 0.7 * cosmetic(FEATURE.flower, i, j, 0)) * cell;
    const z = (j + 0.15 + 0.7 * cosmetic(FEATURE.flower, i, j, 1)) * cell;
    const d = distanceOutside(bounds, x, z) / unit;
    if (d > 15) return;
    const front = Number.isFinite(occlusionClearance(bounds, x, z));
    const density = front ? (d >= 0.7 ? 0.09 : 0) : d >= 0.55 && d <= 3 ? 0.18 : d > 3 ? 0.07 : 0;
    if (cosmetic(FEATURE.flower, i, j, 2) >= density) return;

    const scale = unit * (0.8 + 0.45 * cosmetic(FEATURE.flower, i, j, 3));
    const radius = FLOWER_SHAPE.radius * scale;
    if (wouldOccludeFarm(bounds, x, z, radius, FLOWER_SHAPE.height * scale + 0.2 * unit)) return;
    if (!isClearOf(trees, x, z, radius, 0.55) || !isClearOf(bushes, x, z, radius, 0.9)) return;
    flowers.push({
      x,
      y: meadowHeight(meadow, x, z) - 0.01 * unit,
      z,
      yaw: cosmetic(FEATURE.flower, i, j, 4) * Math.PI * 2,
      scale,
      radius,
      tint: pick(PALETTE.flower, cosmetic(FEATURE.flower, i, j, 5)),
      leafTint: pick(FLOWER_LEAF_TINTS, cosmetic(FEATURE.flower, i, j, 6)),
      shade: 0.92 + 0.1 * cosmetic(FEATURE.flower, i, j, 7),
    });
  });
  return flowers;
}

// ---------------------------------------------------------------------------
// Fence
// ---------------------------------------------------------------------------

/** Tall on the −X / −Z sides (behind the farm), low on the +X / +Z sides so no tile is hidden. */
export const FENCE_SHAPE = {
  /** Distance of the fence line outside the plateau edge. */
  offset: 0.3,
  spacing: 2,
  tallHeight: 0.8,
  /** Post tops stay below the height at which they would start to cover the edge tiles. */
  lowHeight: 0.3,
  tallRails: [0.3, 0.58],
  lowRails: [0.18],
} as const;

/** One instanced fence piece: posts scale Y by `height`; rails scale X by `length`. */
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

function fenceShade(x: number, z: number): number {
  return 0.92 + 0.1 * cosmetic(FEATURE.fence, Math.round(x * 8), Math.round(z * 8), 0);
}

/** Posts and rails around the plateau, `FENCE_SHAPE.offset` outside its edge, standing on groundY. */
export function layoutFence(bounds: WorldRect, groundY: number): FenceLayout {
  const F = FENCE_SHAPE;
  const x0 = bounds.minX - F.offset;
  const x1 = bounds.maxX + F.offset;
  const z0 = bounds.minZ - F.offset;
  const z1 = bounds.maxZ + F.offset;
  const posts: FencePiece[] = [];
  const rails: FencePiece[] = [];

  const addPost = (x: number, z: number, tall: boolean): void => {
    posts.push({ x, y: groundY - 0.03, z, yaw: 0, length: 1, height: (tall ? F.tallHeight : F.lowHeight) + 0.03, shade: fenceShade(x, z) });
  };

  const sides = [
    { ax: x0, az: z0, bx: x1, bz: z0, tall: true },
    { ax: x0, az: z0, bx: x0, bz: z1, tall: true },
    { ax: x0, az: z1, bx: x1, bz: z1, tall: false },
    { ax: x1, az: z0, bx: x1, bz: z1, tall: false },
  ] as const;
  for (const side of sides) {
    const dx = side.bx - side.ax;
    const dz = side.bz - side.az;
    const length = Math.hypot(dx, dz);
    const segments = Math.max(1, Math.round(length / F.spacing));
    const step = length / segments;
    const yaw = Math.atan2(-dz, dx);
    const heights = side.tall ? F.tallRails : F.lowRails;
    for (let i = 0; i < segments; i++) {
      if (i > 0) addPost(side.ax + (dx * i) / segments, side.az + (dz * i) / segments, side.tall);
      const mx = side.ax + (dx * (i + 0.5)) / segments;
      const mz = side.az + (dz * (i + 0.5)) / segments;
      for (const height of heights) {
        rails.push({ x: mx, y: groundY + height, z: mz, yaw, length: step, height: 1, shade: fenceShade(mx, mz + height) });
      }
    }
  }
  addPost(x0, z0, true);
  addPost(x1, z0, true);
  addPost(x0, z1, true);
  addPost(x1, z1, false);
  return { posts, rails };
}
